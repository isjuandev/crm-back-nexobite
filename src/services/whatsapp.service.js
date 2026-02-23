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
        const url = `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
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

module.exports = {
    sendWhatsAppMessage
};
