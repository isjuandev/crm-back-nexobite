const express = require('express');
const http = require('http');
const cors = require('cors');
const dotenv = require('dotenv');

// Configuración de variables de entorno
dotenv.config();

// Ignorar error de certificados autofirmados (usado por Supabase)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Importar rutas
const webhookRoutes = require('./routes/webhook');
const messagesRoutes = require('./routes/messages');
const conversationsRoutes = require('./routes/conversations');
const labelsRoutes = require('./routes/labels');
const contactsRoutes = require('./routes/contacts');

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

const { Client } = require('pg');

// RUTAS
app.get('/', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'CRM Backend API is running' });
});

app.use('/webhook', webhookRoutes);
app.use('/messages', messagesRoutes);
app.use('/conversations', conversationsRoutes);
app.use('/labels', labelsRoutes);
app.use('/contacts', contactsRoutes);

// INICIAR SERVIDOR
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor ejecutándose en http://localhost:${PORT}`);
});
