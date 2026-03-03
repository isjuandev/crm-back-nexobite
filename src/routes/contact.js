const express = require('express');
const axios = require('axios');
const router = express.Router();

const N8N_CONTACT_WEBHOOK_URL = process.env.N8N_CONTACT_WEBHOOK_URL || 'https://n8n.nexobite.com/webhook/contact';

// POST /contact — Recibir formulario de contacto y reenviar a n8n
router.post('/', async (req, res) => {
    try {
        const { nombre, correo, negocio, telefono, descripcion } = req.body;

        // Validación básica en el backend
        if (!nombre || !correo || !descripcion) {
            return res.status(400).json({
                success: false,
                message: 'Los campos nombre, correo y descripción son obligatorios.',
            });
        }

        // Validar formato de correo
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(correo)) {
            return res.status(400).json({
                success: false,
                message: 'El formato del correo electrónico no es válido.',
            });
        }

        // Reenviar al webhook de n8n
        const n8nResponse = await axios.post(N8N_CONTACT_WEBHOOK_URL, {
            nombre: nombre.trim(),
            correo: correo.trim(),
            negocio: (negocio || '').trim(),
            telefono: (telefono || '').trim(),
            descripcion: descripcion.trim(),
            source: 'website_form',
            timestamp: new Date().toISOString(),
        });

        return res.status(200).json(n8nResponse.data);
    } catch (error) {
        console.error('❌ Error al enviar formulario de contacto a n8n:', error.message);

        // Si n8n respondió con un error específico
        if (error.response) {
            return res.status(error.response.status).json({
                success: false,
                message: error.response.data?.message || 'Error al procesar la solicitud.',
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Error interno del servidor. Inténtalo de nuevo más tarde.',
        });
    }
});

module.exports = router;
