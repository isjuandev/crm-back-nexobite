const axios = require('axios');
require('dotenv').config();

const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

/**
 * Envia un mensaje de texto a través de WhatsApp Cloud API
 * @param {string} to Número de teléfono destino
 * @param {string} body Contenido del mensaje
 * @returns {object} Respuesta de Meta
 */
const sendWhatsAppMessage = async (to, body) => {
    try {
        const url = `https://graph.facebook.com/v22.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
        const payload = {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: to,
            type: "text",
            text: {
                preview_url: false,
                body: body
            }
        };

        const response = await axios.post(url, payload, {
            headers: {
                Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
                "Content-Type": "application/json"
            }
        });

        return response.data;
    } catch (error) {
        console.error("❌ Error enviando mensaje de WhatsApp:", error.response?.data || error.message);
        throw error;
    }
};

/**
 * Obtiene las plantillas disponibles de Meta API
 * Primero obtiene el WABA ID usando el Phone Number ID, luego devuelve las plantillas.
 */
const getTemplates = async () => {
    try {
        let wabaId = process.env.META_WABA_ID;

        // 1. Obtener WABA ID dinámicamente si no está en el .env
        if (!wabaId) {
            try {
                const phoneUrl = `https://graph.facebook.com/v22.0/${WHATSAPP_PHONE_NUMBER_ID}?fields=whatsapp_business_account`;
                const phoneResponse = await axios.get(phoneUrl, {
                    headers: { Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}` }
                });
                wabaId = phoneResponse.data?.whatsapp_business_account?.id;
            } catch (err) {
                console.warn("⚠️ No se pudo obtener el WABA ID dinámicamente. Asegúrate de añadir META_WABA_ID al archivo .env si usas un número de prueba o faltan permisos.");
            }
        }

        if (!wabaId) {
            throw new Error("No se encontró el WABA ID (WhatsApp Business Account ID). Agrégalo a tu .env como META_WABA_ID.");
        }

        // 2. Obtener plantillas
        const templatesUrl = `https://graph.facebook.com/v22.0/${wabaId}/message_templates`;
        const templatesResponse = await axios.get(templatesUrl, {
            headers: { Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}` }
        });

        return templatesResponse.data.data;
    } catch (error) {
        console.error("❌ Error obteniendo plantillas de WhatsApp:", error.response?.data || error.message);
        throw error;
    }
};

/**
 * Envía un mensaje de plantilla a través de WhatsApp Cloud API
 * @param {string} to Número de teléfono destino
 * @param {string} templateName Nombre de la plantilla
 * @param {string} languageCode Código de lenguaje (ej. "es_MX")
 * @returns {object} Respuesta de Meta
 */
const sendTemplateMessage = async (to, templateName, languageCode = "es_MX") => {
    try {
        const url = `https://graph.facebook.com/v22.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
        const payload = {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: to,
            type: "template",
            template: {
                name: templateName,
                language: {
                    code: languageCode
                }
            }
        };

        const response = await axios.post(url, payload, {
            headers: {
                Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
                "Content-Type": "application/json"
            }
        });

        return response.data;
    } catch (error) {
        console.error("❌ Error enviando plantilla de WhatsApp:", error.response?.data || error.message);
        throw error;
    }
};

module.exports = {
    sendWhatsAppMessage,
    getTemplates,
    sendTemplateMessage
};
