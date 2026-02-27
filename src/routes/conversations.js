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
                labels: {
                    include: {
                        label: true
                    }
                },
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

// PATCH /conversations/:id/status - Cambiar estado (abierto, cerrado, pendiente, sin leer)
router.patch('/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!['open', 'closed', 'pending', 'unread'].includes(status)) {
            return res.status(400).json({ error: 'Status inválido' });
        }

        const conversation = await prisma.conversation.update({
            where: { id },
            data: { status }
        });

        // Emitir evento "conversation:updated" vía Socket.io
        if (req.io) {
            req.io.emit('conversation:updated', {
                id,
                status,
                type: 'status_updated'
            });
        }

        res.json(conversation);
    } catch (error) {
        console.error('Error updating conversation status:', error);
        res.status(500).json({ error: 'Error al actualizar estado' });
    }
});

// POST /conversations/:id/labels - Asignar etiqueta a conversación
router.post('/:id/labels', async (req, res) => {
    try {
        const { id } = req.params;
        const { labelId } = req.body;

        if (!labelId) {
            return res.status(400).json({ error: 'labelId es requerido' });
        }

        const conversationLabel = await prisma.conversationLabel.create({
            data: {
                conversationId: id,
                labelId: labelId
            },
            include: {
                label: true
            }
        });

        // Emitir evento "conversation:updated" vía Socket.io
        if (req.io) {
            req.io.emit('conversation:updated', {
                id,
                label: conversationLabel.label,
                type: 'label_added'
            });
        }

        res.status(201).json(conversationLabel);
    } catch (error) {
        if (error.code === 'P2002') {
            return res.status(400).json({ error: 'La etiqueta ya está asignada a esta conversación' });
        }
        console.error('Error assigning label:', error);
        res.status(500).json({ error: 'Error al asignar etiqueta' });
    }
});

// DELETE /conversations/:id/labels/:labelId - Quitar etiqueta
router.delete('/:id/labels/:labelId', async (req, res) => {
    try {
        const { id, labelId } = req.params;

        await prisma.conversationLabel.delete({
            where: {
                conversationId_labelId: {
                    conversationId: id,
                    labelId: labelId
                }
            }
        });

        // Emitir evento "conversation:updated" vía Socket.io
        if (req.io) {
            req.io.emit('conversation:updated', {
                id,
                labelId,
                type: 'label_removed'
            });
        }

        res.status(204).send();
    } catch (error) {
        console.error('Error removing label:', error);
        res.status(500).json({ error: 'Error al quitar la etiqueta' });
    }
});

module.exports = router;
