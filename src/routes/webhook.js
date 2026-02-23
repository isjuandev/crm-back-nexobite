const express = require("express");
const crypto = require("crypto");
const axios = require("axios");
const router = express.Router();
const prisma = require("../prisma");
const { emitEvent } = require("../services/socket.service");

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const APP_SECRET = process.env.WHATSAPP_APP_SECRET; // Opcional, dependiendo de si Meta lo pide explícitamente, normalmente la signature se saca del app secret. Si no lo pasas, ignorar o quitar.
// En caso de que no lo tengamos, omitimos la validación estricta para simplificar o requerimos tenerlo.

// GET: Verificación del Webhook (Reto de Meta)
router.get("/", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
        console.log("✅ Webhook verificado!");
        res.status(200).send(challenge);
    } else {
        console.error("❌ Falló verificación del webhook");
        res.sendStatus(403);
    }
});

// Función de ayuda para extraer la firma
const verifySignature = (req) => {
    // Para simplificar la validación en este ejemplo, si no hay APP_SECRET simplemente devolvemos true. 
    // En producción DEBERÍA haber un APP_SECRET de la aplicación de Meta.
    if (!APP_SECRET) return true;

    const signature = req.headers["x-hub-signature-256"];
    if (!signature) return false;

    const body = req.rawBody || JSON.stringify(req.body); // req.rawBody viene del middleware en app.js
    const expectedSignature = `sha256=${crypto.createHmac("sha256", APP_SECRET).update(body).digest("hex")}`;

    return signature === expectedSignature;
}

// POST: Recepción de mensajes de WhatsApp
router.post("/", async (req, res) => {
    // Respondemos 200 INMEDIATAMENTE a Meta
    res.sendStatus(200);

    try {
        const { body } = req;

        // Si es un evento de prueba, retornamos
        if (body.object !== "whatsapp_business_account") return;

        if (
            body.entry &&
            body.entry[0].changes &&
            body.entry[0].changes[0] &&
            body.entry[0].changes[0].value.messages &&
            body.entry[0].changes[0].value.messages[0]
        ) {
            const contactInfo = body.entry[0].changes[0].value.contacts[0];
            const messageInfo = body.entry[0].changes[0].value.messages[0];

            const phone = contactInfo.wa_id;
            const name = contactInfo.profile.name;
            const msgId = messageInfo.id;
            const type = messageInfo.type; // "text", "image", "audio", "document"
            const content = type === "text" ? messageInfo.text.body : "[Mensaje multimedia]";
            const mediaUrl = type !== "text" ? messageInfo[type].id : null; // Guardamos el ID del media por ahora

            // 1. Buscar o Crear el Contacto
            let contact = await prisma.contact.findUnique({ where: { phone } });
            if (!contact) {
                contact = await prisma.contact.create({ data: { phone, name } });
            } else if (contact.name !== name) {
                contact = await prisma.contact.update({ where: { phone }, data: { name } });
            }

            // 2. Buscar o Crear la Conversación
            let conversation = await prisma.conversation.findFirst({
                where: { contactId: contact.id },
                orderBy: { lastMessageAt: 'desc' },
            });

            if (!conversation || conversation.status === "closed") {
                conversation = await prisma.conversation.create({
                    data: { contactId: contact.id, status: "open" }
                });
            } else {
                // Actualizar el timestamp
                conversation = await prisma.conversation.update({
                    where: { id: conversation.id },
                    data: { lastMessageAt: new Date() }
                });
            }

            // 3. Crear el mensaje
            const newMessage = await prisma.message.create({
                data: {
                    id: msgId, // Opcional, usar el de WhatsApp para evitar duplicados, o dejar generarlo
                    conversationId: conversation.id,
                    content,
                    type,
                    direction: "inbound",
                    status: "delivered",
                    mediaUrl
                }
            });

            console.log(`📩 Mensaje recibido de ${name} (${phone}): ${content}`);

            // 4. Emitir evento por Socket.io
            emitEvent("newMessage", {
                message: newMessage,
                contact: contact,
                conversation: conversation
            });

            // 5. Reenviar a n8n si el bot está habilitado
            if (conversation.botEnabled && process.env.N8N_WEBHOOK_URL) {
                try {
                    await axios.post(process.env.N8N_WEBHOOK_URL, req.body, {
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    });
                    console.log(`🤖 Payload reenviado a n8n exitosamente.`);
                } catch (err) {
                    console.error("❌ Error reenviando a n8n:", err.message);
                }
            }

        } else if (
            body.entry &&
            body.entry[0].changes &&
            body.entry[0].changes[0] &&
            body.entry[0].changes[0].value.statuses &&
            body.entry[0].changes[0].value.statuses[0]
        ) {
            // Evento de actualización de estado del mensaje (entregado, leído, etc.)
            const statusEvent = body.entry[0].changes[0].value.statuses[0];
            const { id, status } = statusEvent; // id del mensaje, status: 'sent', 'delivered', 'read'

            try {
                const updatedMessage = await prisma.message.update({
                    where: { id },
                    data: { status }
                });

                // Emitir evento por Socket.io
                emitEvent("messageStatus", {
                    messageId: id,
                    status: status,
                    conversationId: updatedMessage.conversationId
                });
                console.log(`🔄 Estado de mensaje actualizado a: ${status}`);
            } catch (e) {
                // Es posible que recibamos el status antes de guardar o de un ID que no creamos con ese ID de WS. 
                // Manejamos en silencio.
            }
        }
    } catch (error) {
        console.error("❌ Error procesando webhook:", error);
    }
});

module.exports = router;
