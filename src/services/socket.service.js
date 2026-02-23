const { Server } = require("socket.io");

let io;

/**
 * Inicializa el servidor de Socket.io
 */
const initSocket = (server) => {
    io = new Server(server, {
        cors: {
            origin: "*", // En producción, cambiar esto a la URL del frontend
            methods: ["GET", "POST"],
        },
    });

    io.on("connection", (socket) => {
        console.log(`⚡ Cliente conectado a WebSocket: ${socket.id}`);

        socket.on("disconnect", () => {
            console.log(`🔌 Cliente desconectado: ${socket.id}`);
        });
    });

    return io;
};

/**
 * Emite un evento a todos los clientes conectados
 * @param {string} event Nombre del evento
 * @param {any} data Datos a enviar
 */
const emitEvent = (event, data) => {
    if (io) {
        io.emit(event, data);
    }
};

module.exports = {
    initSocket,
    emitEvent,
};
