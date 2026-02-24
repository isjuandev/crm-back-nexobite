const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { sendWhatsAppMessage, getTemplates, sendTemplateMessage } = require('../services/whatsapp.service');
const { emitEvent } = require('../services/socket.service');

// GET /messages/templates - Obtener plantillas de Meta
router.get('/templates', async (req, res) => {
    try {
        const templates = await getTemplates();
        // Filtramos solo las que están aprobadas si queremos, o devolvemos todas
        res.status(200).json(templates);
    } catch (error) {
        console.error('Error fetching templates:', error);
        res.status(500).json({ error: 'Error al obtener plantillas de Meta' });
    }
});

// POST /messages/send-template - Enviar plantilla
router.post('/send-template', async (req, res) => {
    try {
        const { conversationId, templateName, languageCode } = req.body;

        if (!conversationId || !templateName) {
            return res.status(400).json({ error: 'Faltan campos requeridos (conversationId, templateName)' });
        }

        // Obtener la conversación y el contacto
        const conversation = await prisma.conversation.findUnique({
            where: { id: conversationId },
            include: { contact: true }
        });

        if (!conversation) {
            return res.status(404).json({ error: 'Conversación no encontrada' });
        }

        // 1. Enviar el mensaje vía Meta Cloud API
        const response = await sendTemplateMessage(conversation.contact.phone, templateName, languageCode);

        let msgId = response.messages?.[0]?.id || `outbound-template-${Date.now()}`;

        // 2. Guardar el mensaje en la base de datos
        const newMessage = await prisma.message.create({
            data: {
                id: msgId,
                conversationId,
                content: `[Plantilla enviada: ${templateName}]`, // Guardamos una respresentación en texto
                type: 'text',
                direction: 'outbound',
                status: 'sent',
            }
        });

        // 3. Actualizar la fecha de último mensaje
        await prisma.conversation.update({
            where: { id: conversationId },
            data: {
                lastMessageAt: new Date(),
                status: 'open'
            }
        });

        // 4. Emitir evento por Socket.io para el frontend
        emitEvent('newMessage', {
            message: newMessage,
            conversationId: conversationId
        });

        res.status(200).json(newMessage);
    } catch (error) {
        console.error('Error enviando plantilla:', error);
        res.status(500).json({ error: 'Error al enviar plantilla' });
    }
});

// POST /messages/send - Enviar mensaje
router.post('/send', async (req, res) => {
    try {
        const { conversationId, content } = req.body;

        if (!conversationId || !content) {
            return res.status(400).json({ error: 'Faltan campos requeridos (conversationId, content)' });
        }

        // Obtener la conversación y el contacto
        const conversation = await prisma.conversation.findUnique({
            where: { id: conversationId },
            include: { contact: true }
        });

        if (!conversation) {
            return res.status(404).json({ error: 'Conversación no encontrada' });
        }

        // 1. Enviar el mensaje vía Meta Cloud API
        const response = await sendWhatsAppMessage(conversation.contact.phone, content);

        let msgId = response.messages?.[0]?.id || `outbound-${Date.now()}`;

        // 2. Guardar el mensaje en la base de datos
        const newMessage = await prisma.message.create({
            data: {
                id: msgId,
                conversationId,
                content,
                type: 'text',
                direction: 'outbound',
                status: 'sent', // Asumimos enviado
            }
        });

        // 3. Actualizar la fecha de último mensaje
        await prisma.conversation.update({
            where: { id: conversationId },
            data: {
                lastMessageAt: new Date(),
                status: 'open' // Aseguramos que se marca como abierta si estaba cerrada
            }
        });

        // 4. Emitir evento por Socket.io para el frontend
        emitEvent('newMessage', {
            message: newMessage,
            conversationId: conversationId
        });

        res.status(200).json(newMessage);
    } catch (error) {
        console.error('Error enviando mensaje:', error);
        res.status(500).json({ error: 'Error al enviar mensaje' });
    }
});
// POST /messages/sync - Sincronización en tiempo real desde n8n
router.post('/sync', (req, res) => {
    try {
        const payload = req.body;
        if (payload && payload.message) {
            emitEvent('newMessage', payload);
            res.status(200).json({ success: true });
        } else {
            res.status(400).json({ error: "Invalid payload format" });
        }
    } catch (error) {
        console.error("❌ Error en endpoint sync:", error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
