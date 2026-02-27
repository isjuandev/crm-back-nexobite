const express = require('express');
const router = express.Router();
const prisma = require('../prisma');

// GET /contacts - Listar contactos con búsqueda por nombre o teléfono
router.get('/', async (req, res) => {
    try {
        const { search } = req.query;

        const whereClause = search ? {
            OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search } }
            ]
        } : {};

        const contacts = await prisma.contact.findMany({
            where: whereClause,
            orderBy: { name: 'asc' }
        });

        res.json(contacts);
    } catch (error) {
        console.error('Error fetching contacts:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// GET /contacts/:id - Obtener perfil completo del contacto
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const contact = await prisma.contact.findUnique({
            where: { id },
            include: {
                contactNotes: {
                    orderBy: { createdAt: 'desc' }
                }
            }
        });

        if (!contact) {
            return res.status(404).json({ error: 'Contacto no encontrado' });
        }

        res.json(contact);
    } catch (error) {
        console.error('Error fetching contact details:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// PATCH /contacts/:id - Actualizar datos del contacto
router.patch('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, email, company, notes, avatarUrl, customFields } = req.body;

        const contact = await prisma.contact.update({
            where: { id },
            data: {
                name,
                email,
                company,
                notes,
                avatarUrl,
                customFields
            }
        });

        res.json(contact);
    } catch (error) {
        console.error('Error updating contact:', error);
        res.status(500).json({ error: 'Error al actualizar el contacto' });
    }
});

// GET /contacts/:id/conversations - Historial de TODAS las conversaciones del contacto
router.get('/:id/conversations', async (req, res) => {
    try {
        const { id } = req.params;

        const conversations = await prisma.conversation.findMany({
            where: { contactId: id },
            orderBy: { lastMessageAt: 'desc' },
            include: {
                _count: {
                    select: { messages: true }
                }
            }
        });

        res.json(conversations);
    } catch (error) {
        console.error('Error fetching contact conversations:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// POST /contacts/:id/notes - Agregar nota al contacto
router.post('/:id/notes', async (req, res) => {
    try {
        const { id } = req.params;
        const { content, createdBy } = req.body;

        if (!content) {
            return res.status(400).json({ error: 'El contenido de la nota es requerido' });
        }

        const note = await prisma.note.create({
            data: {
                contactId: id,
                content,
                createdBy
            }
        });

        res.status(201).json(note);
    } catch (error) {
        console.error('Error creating note:', error);
        res.status(500).json({ error: 'Error al crear la nota' });
    }
});

module.exports = router;
