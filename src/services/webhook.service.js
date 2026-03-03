const crypto = require("crypto");
const prisma = require("../prisma");

const APP_SECRET = process.env.WHATSAPP_APP_SECRET;

// ── Deduplicación: cache de messageIds ya procesados ──
const processedMessages = new Map();
const DEDUP_TTL_MS = 30_000;

function isDuplicate(messageId) {
    if (processedMessages.has(messageId)) return true;
    processedMessages.set(messageId, Date.now());
    if (processedMessages.size > 500) {
        const now = Date.now();
        for (const [id, ts] of processedMessages) {
            if (now - ts > DEDUP_TTL_MS) processedMessages.delete(id);
        }
    }
    return false;
}

// ── Función de ayuda para extraer la firma ──
function verifySignature(req) {
    if (!APP_SECRET) return true; // Si no hay secret configurado, no validar (dev mode)

    const signature = req.headers["x-hub-signature-256"];
    if (!signature) return false;

    const body = req.rawBody || JSON.stringify(req.body);
    const expectedSignature = `sha256=${crypto.createHmac("sha256", APP_SECRET).update(body).digest("hex")}`;

    return signature === expectedSignature;
}

// ── Cola por contacto: serializa el procesamiento de mensajes por teléfono ──
// Evita race conditions cuando el cliente envía mensajes rápido.
const phoneQueues = new Map();
const QUEUE_CLEANUP_MS = 60_000;

function enqueue(phone, task, prefixLog = "Webhook") {
    const prev = phoneQueues.get(phone) || Promise.resolve();
    const next = prev.then(() => task()).catch((err) => {
        console.error(`❌ [${prefixLog}] Error en cola de ${phone}:`, err.message);
    });
    phoneQueues.set(phone, next);

    // Limpieza: cuando la cadena termina, eliminar la referencia
    next.finally(() => {
        if (phoneQueues.get(phone) === next) {
            setTimeout(() => {
                if (phoneQueues.get(phone) === next) {
                    phoneQueues.delete(phone);
                }
            }, QUEUE_CLEANUP_MS);
        }
    });
}

// ── Extraer contenido del mensaje según tipo ──
function extractMessageContent(messageInfo) {
    const type = messageInfo.type || 'text';
    switch (type) {
        case 'text':
            return { content: messageInfo.text?.body || '', type: 'text' };
        case 'image':
            return { content: messageInfo.image?.caption || '[Imagen]', type: 'image', mediaUrl: messageInfo.image?.id || null };
        case 'audio':
            return { content: '[Audio]', type: 'audio', mediaUrl: messageInfo.audio?.id || null };
        case 'video':
            return { content: messageInfo.video?.caption || '[Video]', type: 'video', mediaUrl: messageInfo.video?.id || null };
        case 'document':
            return { content: messageInfo.document?.filename || '[Documento]', type: 'document', mediaUrl: messageInfo.document?.id || null };
        case 'location':
            const loc = messageInfo.location || {};
            return { content: `📍 ${loc.latitude}, ${loc.longitude}`, type: 'location' };
        case 'interactive':
            const interactive = messageInfo.interactive;
            if (interactive?.type === 'button_reply') {
                return { content: interactive.button_reply?.title || '', type: 'text' };
            } else if (interactive?.type === 'list_reply') {
                return { content: interactive.list_reply?.title || '', type: 'text' };
            }
            return { content: '[Interactivo]', type: 'text' };
        default:
            return { content: `[${type}]`, type: 'text' };
    }
}

/**
 * Handle incoming message generic logic: upsert contact, conversation, message and emit socket events.
 * Returns the conversationId if successful, otherwise null.
 */
async function handleIncomingMessage(io, phone, name, msgId, messageInfo) {
    let conversationId = null;

    // ── 1. Upsert contacto ──
    let contact;
    try {
        contact = await prisma.contact.upsert({
            where: { phone },
            update: { name: name || undefined },
            create: {
                phone,
                name: name || 'Sin nombre',
                interestStatus: 'new'
            },
            include: {
                conversations: {
                    orderBy: { lastMessageAt: 'desc' },
                    take: 1
                }
            }
        });
        console.log(`👤 Contacto ${contact.id} (${name}) - ${contact.conversations.length > 0 ? 'existente' : 'nuevo'}`);
    } catch (err) {
        console.error("❌ Error upserting contacto:", err.message);
        return null; // Sin contacto no podemos continuar
    }

    // ── 2. Obtener o crear conversación ──
    try {
        if (contact.conversations.length > 0) {
            conversationId = contact.conversations[0].id;
            await prisma.conversation.update({
                where: { id: conversationId },
                data: {
                    status: 'unread',
                    lastMessageAt: new Date()
                }
            });
        } else {
            const newConv = await prisma.conversation.create({
                data: {
                    contactId: contact.id,
                    status: 'unread',
                    botEnabled: true,
                    lastMessageAt: new Date()
                }
            });
            conversationId = newConv.id;
            console.log(`💬 Nueva conversación creada: ${conversationId}`);
        }
    } catch (err) {
        console.error("❌ Error gestionando conversación:", err.message);
        return null;
    }

    // ── 3. Guardar mensaje entrante ──
    const { content, type, mediaUrl } = extractMessageContent(messageInfo);
    try {
        await prisma.message.create({
            data: {
                id: msgId,
                conversationId,
                content,
                type,
                direction: 'inbound',
                status: 'delivered',
                mediaUrl: mediaUrl || null
            }
        });
        console.log(`💾 Mensaje inbound guardado: ${msgId}`);
    } catch (err) {
        // Si falla por duplicado (constraint), ignorar
        if (err.code === 'P2002') {
            console.log(`⚡ Mensaje ya existe en DB: ${msgId}`);
        } else {
            console.error("❌ Error guardando mensaje inbound:", err.message);
        }
    }

    // Emitir evento de nuevo mensaje al CRM frontend
    if (io) {
        io.emit('conversation:updated', {
            id: conversationId,
            status: 'unread',
            type: 'new_message'
        });
        io.emit('message:new', {
            conversationId,
            message: { id: msgId, content, type, direction: 'inbound', status: 'delivered', timestamp: new Date() }
        });
    }

    return conversationId;
}

/**
 * Guardo la respuesta del bot como mensaje saliente e informo a los WebSockets.
 */
async function handleBotResponse(io, conversationId, botResponse) {
    if (!botResponse) return;

    try {
        const outMsgId = `bot-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
        await prisma.message.create({
            data: {
                id: outMsgId,
                conversationId,
                content: botResponse,
                type: 'text',
                direction: 'outbound',
                status: 'sent'
            }
        });

        // Actualizar último mensaje de la conversación
        await prisma.conversation.update({
            where: { id: conversationId },
            data: {
                lastMessageAt: new Date(),
                status: 'open'
            }
        });

        console.log(`💾 Respuesta bot guardada: ${outMsgId}`);

        // Emitir al CRM frontend
        if (io) {
            io.emit('message:new', {
                conversationId,
                message: { id: outMsgId, content: botResponse, type: 'text', direction: 'outbound', status: 'sent', timestamp: new Date() }
            });
            io.emit('conversation:updated', {
                id: conversationId,
                status: 'open',
                type: 'bot_response'
            });
        }
    } catch (err) {
        console.error("❌ Error guardando respuesta del bot:", err.message);
    }
}


module.exports = {
    isDuplicate,
    verifySignature,
    extractMessageContent,
    enqueue,
    handleIncomingMessage,
    handleBotResponse
};
