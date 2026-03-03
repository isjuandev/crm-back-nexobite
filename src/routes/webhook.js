const express = require("express");
const crypto = require("crypto");
const axios = require("axios");
const router = express.Router();
const prisma = require("../prisma");
const { isDuplicate, verifySignature, enqueue, handleIncomingMessage, handleBotResponse } = require('../services/webhook.service');

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// GET: Verificación del Webhook (Reto de Meta)
const verifyWebhook = (req, res) => {
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
};

router.get("/", verifyWebhook);
router.get("/:flow", verifyWebhook);

// ── Procesar un mensaje (se ejecuta dentro de la cola por contacto) ──
async function processMessage(phone, name, msgId, messageInfo, payload, io) {
    // 1. Manejo Genérico de Entrada (Contactos, Conversaciones y Mensaje Inicial)
    const conversationId = await handleIncomingMessage(io, phone, name, msgId, messageInfo);
    if (!conversationId) return;

    // ── 2. Reenviar a n8n y esperar respuesta del bot ──
    let botResponse = null;

    // Obtener todas las variables de entorno de webhooks de n8n (excluyendo N8N_CONTACT_WEBHOOK_URL)
    const agentUrls = Object.keys(process.env)
        .filter(key => key.startsWith('N8N_') && key.includes('WEBHOOK_URL') && key !== 'N8N_CONTACT_WEBHOOK_URL')
        .map(key => process.env[key])
        .filter(Boolean);

    let sentSuccessfully = false;

    if (agentUrls.length > 0) {
        for (const url of agentUrls) {
            try {
                const n8nResult = await axios.post(url, payload, {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 60_000 // 60s máximo para AI
                });
                botResponse = n8nResult.data?.response || null;
                console.log(`🤖 Payload de ${name} (${phone}) procesado exitosamente por n8n en ${url}.`);
                sentSuccessfully = true;
                break; // Se encontró el webhook activo, salir del bucle
            } catch (err) {
                if (err.response && err.response.status === 404) {
                    console.log(`⚠️ Webhook inactivo (404) en ${url}, probando el siguiente...`);
                    continue; // Intentar con el siguiente webhook
                }
                console.error(`❌ Error reenviando a n8n en ${url}:`, err.message);
                break; // Error distinto a 404, interrumpir flujo
            }
        }

        if (!sentSuccessfully) {
            console.error(`❌ Ningún webhook de n8n pudo procesar el mensaje (todos inactivos o fallaron).`);
        }
    } else {
        console.error(`❌ No se encontraron variables de entorno con webhooks de n8n configuradas.`);
    }

    // ── 3. Guardar respuesta del bot como mensaje outbound ──
    if (botResponse) {
        await handleBotResponse(io, conversationId, botResponse);
    }
}

// POST: Recepción de mensajes de WhatsApp
const handleMessage = async (req, res) => {
    // Respondemos 200 INMEDIATAMENTE a Meta
    res.sendStatus(200);

    try {
        const { body } = req;

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

            // Guard: deduplicación por messageId
            if (isDuplicate(msgId)) {
                console.log(`⚡ Duplicado ignorado: ${msgId} de ${name} (${phone})`);
                return;
            }

            // Encolar: el mensaje se procesa en serie por contacto
            const payload = body;
            const io = req.io;
            enqueue(phone, () => processMessage(phone, name, msgId, messageInfo, payload, io));

            console.log(`📥 Mensaje de ${name} (${phone}) encolado.`);

        } else if (
            body.entry &&
            body.entry[0].changes &&
            body.entry[0].changes[0] &&
            body.entry[0].changes[0].value.statuses &&
            body.entry[0].changes[0].value.statuses[0]
        ) {
            const statusEvent = body.entry[0].changes[0].value.statuses[0];
            const { id, status } = statusEvent;

            try {
                await prisma.message.update({
                    where: { id },
                    data: { status }
                });
                console.log(`🔄 Estado actualizado a: ${status}`);

                // Emitir actualización de estado al CRM frontend
                if (req.io) {
                    req.io.emit('message:status', { messageId: id, status });
                }
            } catch (e) {
                // Silencio
            }
        }
    } catch (error) {
        console.error("❌ Error procesando webhook:", error);
    }
};

router.post("/", handleMessage);
router.post("/:flow", handleMessage);

module.exports = router;
