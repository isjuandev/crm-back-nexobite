const express = require('express');
const http = require('http');
const cors = require('cors');
const dotenv = require('dotenv');

// Configuración de variables de entorno
dotenv.config();

// Importar rutas
const webhookRoutes = require('./routes/webhook');
const messagesRoutes = require('./routes/messages');
const conversationsRoutes = require('./routes/conversations');
const labelsRoutes = require('./routes/labels');
const contactsRoutes = require('./routes/contacts');
const contactFormRoutes = require('./routes/contact');
const citasRoutes = require('./routes/citas');

const app = express();
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, {
  cors: {
    origin: '*',
  }
});

// Middleware para inyectar io en las peticiones
app.use((req, res, next) => {
  req.io = io;
  next();
});

io.on('connection', (socket) => {
  console.log('📱 Cliente conectado:', socket.id);

  socket.on('disconnect', () => {
    console.log('📱 Cliente desconectado');
  });
});

// MIDDLEWARES
app.use(cors());
// IMPORTANTE: Para el webhook de Meta necesitamos el raw body en ocasiones (para X-Hub-Signature-256),
// pero con express.json() regular se puede obtener. Usaremos un middleware simple:
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));


// RUTAS
app.get('/', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'CRM Backend API is running' });
});

app.use('/webhook', webhookRoutes);
app.use('/messages', messagesRoutes);
app.use('/conversations', conversationsRoutes);
app.use('/labels', labelsRoutes);
app.use('/contacts', contactsRoutes);
app.use('/contact', contactFormRoutes);
app.use('/citas-webhook', citasRoutes);   // Sistema de citas multinegocio
app.use('/w', require('./routes/whatsapp-dynamic')); // WEBHOOKS DINÁMICOS: /w/ventas, /w/citas, etc.

// INICIAR SERVIDOR
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor ejecutándose en http://localhost:${PORT}`);
});

// GRACEFUL SHUTDOWN
const shutdown = (signal) => {
  console.log(`\n⏹️  ${signal} recibido. Cerrando servidor...`);
  server.close(() => {
    console.log('✅ Servidor HTTP cerrado');
    process.exit(0);
  });
  // Forzar cierre si tarda más de 10s
  setTimeout(() => {
    console.error('❌ Forzando cierre tras 10s de timeout');
    process.exit(1);
  }, 10_000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
