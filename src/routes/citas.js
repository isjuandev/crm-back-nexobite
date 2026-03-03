const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const router = express.Router();

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const APP_SECRET = process.env.WHATSAPP_APP_SECRET;

// URL del webhook de citas en n8n (WF1 - Recepción WhatsApp + Agente IA)
const N8N_CITAS_WEBHOOK_URL = process.env.N8N_CITAS_WEBHOOK_URL || 'https://n8n.nexobite.com/webhook/whatsapp-citas';

// ── Deduplicación simple de mensajes ──
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

// ── Validar firma X-Hub-Signature-256 de Meta ──
function verifySignature(req) {
    if (!APP_SECRET) return true; // Si no hay secret configurado, no validar (dev mode)
    const signature = req.headers['x-hub-signature-256'];
    if (!signature) return false;
    const body = req.rawBody || JSON.stringify(req.body);
    const expected = `sha256=${crypto.createHmac('sha256', APP_SECRET).update(body).digest('hex')}`;
    return signature === expected;
}

// ──────────────────────────────────────────────
// GET /citas-webhook — Verificación de Meta (handshake)
// ──────────────────────────────────────────────
router.get('/', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('✅ [Citas] Webhook de Meta verificado correctamente');
        return res.status(200).send(challenge);
    }

    console.error('❌ [Citas] Fallo en verificación del webhook - token inválido');
    return res.sendStatus(403);
});

// ──────────────────────────────────────────────
// POST /citas-webhook — Recepción de mensajes de WhatsApp para el sistema de citas
// ──────────────────────────────────────────────
router.post('/', async (req, res) => {
    // Responder 200 a Meta INMEDIATAMENTE para evitar reintentos
    res.sendStatus(200);

    try {
        const { body } = req;

        // Solo procesar eventos de WhatsApp Business Account
        if (body.object !== 'whatsapp_business_account') return;

        // Validar firma de Meta (seguridad)
        if (!verifySignature(req)) {
            console.error('❌ [Citas] Firma inválida - request rechazado');
            return;
        }

        const changes = body.entry?.[0]?.changes?.[0];
        const value = changes?.value;

        // ── Procesar mensajes entrantes ──
        if (value?.messages?.[0]) {
            const messageInfo = value.messages[0];
            const contactInfo = value.contacts?.[0];
            const metadata = value.metadata;

            const phone = contactInfo?.wa_id || messageInfo.from;
            const name = contactInfo?.profile?.name || 'Cliente';
            const msgId = messageInfo.id;

            // Guard deduplicación
            if (isDuplicate(msgId)) {
                console.log(`⚡ [Citas] Duplicado ignorado: ${msgId} de ${name} (${phone})`);
                return;
            }

            console.log(`📥 [Citas] Mensaje de ${name} (${phone}) recibido. Tipo: ${messageInfo.type}. Reenviando a n8n...`);

            // Reenviar payload completo al WF1 de n8n (Agente IA de Citas)
            try {
                await axios.post(N8N_CITAS_WEBHOOK_URL, body, {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 5_000  // Corto: n8n procesa async, no necesitamos la respuesta aquí
                });
                console.log(`✅ [Citas] Payload de ${name} (${phone}) entregado a n8n.`);
            } catch (err) {
                // n8n puede tardar más de 5s pero ya escuchó el evento — no es un error crítico
                if (err.code !== 'ECONNABORTED' && err.code !== 'ETIMEDOUT') {
                    console.error(`❌ [Citas] Error reenviando a n8n:`, err.message);
                } else {
                    console.log(`⏱️ [Citas] n8n procesando (timeout esperado, evento entregado).`);
                }
            }

            // ── Actualización de estado de mensaje (delivered, read) ──
        } else if (value?.statuses?.[0]) {
            const { id, status } = value.statuses[0];
            console.log(`🔄 [Citas] Estado de mensaje ${id}: ${status} (no almacenado en citas)`);
        }

    } catch (error) {
        console.error('❌ [Citas] Error procesando webhook:', error.message);
    }
});

module.exports = router;
