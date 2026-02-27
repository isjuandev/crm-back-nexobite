const express = require('express');
const router = express.Router();
const prisma = require('../prisma');

// GET /labels - Listar todas las etiquetas disponibles
router.get('/', async (req, res) => {
    try {
        const labels = await prisma.label.findMany({
            orderBy: { name: 'asc' }
        });
        res.json(labels);
    } catch (error) {
        console.error('Error fetching labels:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// POST /labels - Crear nueva etiqueta (nombre + color hex)
router.post('/', async (req, res) => {
    try {
        const { name, color } = req.body;

        if (!name || !color) {
            return res.status(400).json({ error: 'Nombre y color son requeridos' });
        }

        const label = await prisma.label.create({
            data: { name, color }
        });

        res.status(201).json(label);
    } catch (error) {
        if (error.code === 'P2002') {
            return res.status(400).json({ error: 'Ya existe una etiqueta con este nombre' });
        }
        console.error('Error creating label:', error);
        res.status(500).json({ error: 'Error al crear la etiqueta' });
    }
});

// DELETE /labels/:id - Eliminar etiqueta
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        await prisma.label.delete({
            where: { id }
        });

        res.status(204).send();
    } catch (error) {
        console.error('Error deleting label:', error);
        res.status(500).json({ error: 'Error al eliminar la etiqueta' });
    }
});

module.exports = router;
