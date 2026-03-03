const express = require("express");
const crypto = require("crypto");
const axios = require("axios");
const router = express.Router();
const prisma = require("../prisma");

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
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

// ── Cola por contacto: serializa el procesamiento de mensajes por teléfono ──
const phoneQueues = new Map();
const QUEUE_CLEANUP_MS = 60_000;

function enqueue(phone, task) {
    const prev = phoneQueues.get(phone) || Promise.resolve();
    const next = prev.then(() => task()).catch((err) => {
        console.error(`❌ [Dynamic] Error en cola de ${phone}:`, err.message);
    });
    phoneQueues.set(phone, next);

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

// ── Procesar un mensaje ──
async function processMessage(flow, phone, name, msgId, messageInfo, payload, io) {
    // 1. Buscar URL de n8n
    let n8nUrl = process.env[`N8N_${flow.toUpperCase()}_URL`]
        || process.env[`N8N_${flow.toUpperCase()}_WEBHOOK_URL`];

    // Fallbacks para Nombres antiguos
    if (!n8nUrl) {
        if (flow === 'ventas') n8nUrl = process.env.N8N_WEBHOOK_URL;
        else if (flow === 'citas') n8nUrl = process.env.N8N_CITAS_WEBHOOK_URL;
        else if (flow === 'contact') n8nUrl = process.env.N8N_CONTACT_WEBHOOK_URL;
    }

    if (!n8nUrl) {
        console.error(`❌ [Dynamic] No se encontró variable de entorno para el flujo: ${flow}`);
        return;
    }

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
    } catch (err) {
        console.error("❌ [Dynamic] Error upserting contacto:", err.message);
        return;
    }

    // ── 2. Obtener o crear conversación ──
    try {
        if (contact.conversations.length > 0) {
            conversationId = contact.conversations[0].id;
            await prisma.conversation.update({
                where: { id: conversationId },
                data: { status: 'unread', lastMessageAt: new Date() }
            });
        } else {
            const newConv = await prisma.conversation.create({
                data: { contactId: contact.id, status: 'unread', botEnabled: true, lastMessageAt: new Date() }
            });
            conversationId = newConv.id;
        }
    } catch (err) {
        console.error("❌ [Dynamic] Error gestionando conversación:", err.message);
        return;
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
    } catch (err) {
        if (err.code !== 'P2002') console.error("❌ [Dynamic] Error guardando mensaje:", err.message);
    }

    // Socket emit
    if (io) {
        io.emit('conversation:updated', { id: conversationId, status: 'unread', type: 'new_message' });
        io.emit('message:new', {
            conversationId,
            message: { id: msgId, content, type, direction: 'inbound', status: 'delivered', timestamp: new Date() }
        });
    }

    // ── 4. Reenviar a n8n ──
    try {
        console.log(`➡️ [Dynamic] Reenviando flujo '${flow}' a n8n: ${n8nUrl}`);
        const n8nResult = await axios.post(n8nUrl, payload, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 60_000
        });

        const botResponse = n8nResult.data?.response || null;

        // ── 5. Guardar respuesta si n8n la devuelve ──
        if (botResponse) {
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

            await prisma.conversation.update({
                where: { id: conversationId },
                data: { lastMessageAt: new Date(), status: 'open' }
            });

            if (io) {
                io.emit('message:new', {
                    conversationId,
                    message: { id: outMsgId, content: botResponse, type: 'text', direction: 'outbound', status: 'sent', timestamp: new Date() }
                });
            }
        }
    } catch (err) {
        console.error(`❌ [Dynamic] Error en n8n (${flow}):`, err.message);
    }
}

// GET: Verificación de Meta
router.get("/:flow", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
        console.log(`✅ [Dynamic] Webhook verificado para flujo: ${req.params.flow}`);
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

// POST: Recepción de WhatsApp
router.post("/:flow", async (req, res) => {
    res.sendStatus(200);
    const { flow } = req.params;

    try {
        const { body } = req;
        if (body.object !== "whatsapp_business_account") return;

        const changes = body.entry?.[0]?.changes?.[0]?.value;
        if (!changes) return;

        // Caso: Mensaje
        if (changes.messages?.[0]) {
            const contactInfo = changes.contacts[0];
            const messageInfo = changes.messages[0];
            const phone = contactInfo.wa_id;
            const name = contactInfo.profile.name;
            const msgId = messageInfo.id;

            if (isDuplicate(msgId)) return;

            enqueue(phone, () => processMessage(flow, phone, name, msgId, messageInfo, body, req.io));
            console.log(`📥 [Dynamic] Mensaje encolado flujo '${flow}' de ${name}`);
        }
        // Caso: Estatus
        else if (changes.statuses?.[0]) {
            const { id, status } = changes.statuses[0];
            try {
                await prisma.message.update({ where: { id }, data: { status } });
                if (req.io) req.io.emit('message:status', { messageId: id, status });
            } catch (e) { }
        }
    } catch (error) {
        console.error(`❌ [Dynamic] Error procesando webhook ${flow}:`, error);
    }
});

module.exports = router;
