const express = require('express');
const router = express.Router();
const prisma = require('../prisma');

// GET /conversations - Obtener todas las conversaciones
router.get('/', async (req, res) => {
    try {
        const { status } = req.query; // opcional: ?status=open o ?status=closed

        const whereClause = status ? { status } : {};

        const conversations = await prisma.conversation.findMany({
            where: whereClause,
            include: {
                contact: true,
                messages: {
                    orderBy: { timestamp: 'desc' },
                    take: 1 // Solo traer el último mensaje para la lista
                },
                _count: {
                    select: {
                        messages: {
                            where: {
                                direction: 'inbound',
                                status: { in: ['sent', 'delivered'] } // Simple hack para no-leídos (requires custom logic in real prod)
                            }
                        }
                    }
                }
            },
            orderBy: { lastMessageAt: 'desc' }
        });

        res.json(conversations);
    } catch (error) {
        console.error('Error fetching conversations:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// GET /conversations/:id/messages - Obtener mensajes de una conversación
router.get('/:id/messages', async (req, res) => {
    try {
        const { id } = req.params;

        const messages = await prisma.message.findMany({
            where: { conversationId: id },
            orderBy: { timestamp: 'asc' }
        });

        // Marcar mensajes entrantes como leídos
        await prisma.message.updateMany({
            where: {
                conversationId: id,
                direction: 'inbound',
                status: { not: 'read' }
            },
            data: { status: 'read' }
        });

        res.json(messages);
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// PUT /conversations/:id/bot - Cambiar estado del bot AI (activar/desactivar)
router.put('/:id/bot', async (req, res) => {
    try {
        const { id } = req.params;
        const { botEnabled } = req.body;

        if (typeof botEnabled !== 'boolean') {
            return res.status(400).json({ error: 'botEnabled debe ser un booleano' });
        }

        const conversation = await prisma.conversation.update({
            where: { id },
            data: { botEnabled }
        });

        res.json(conversation);
    } catch (error) {
        console.error('Error updating bot status:', error);
        res.status(500).json({ error: 'Error al actualizar el estado del bot' });
    }
});

// PUT /conversations/:id/status - Cambiar estado (cerrar/abrir)
router.put('/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!['open', 'closed'].includes(status)) {
            return res.status(400).json({ error: 'Status inválido' });
        }

        const conversation = await prisma.conversation.update({
            where: { id },
            data: { status }
        });

        res.json(conversation);
    } catch (error) {
        console.error('Error updating conversation:', error);
        res.status(500).json({ error: 'Error al actualizar estado' });
    }
});

module.exports = router;
