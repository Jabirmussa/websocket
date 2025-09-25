import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Lista de origens permitidas
const allowedOrigins = [
  "https://knowledgehub-nine.vercel.app",
  "http://localhost:3000"
];

app.use(cors({
  origin: allowedOrigins,
  methods: ["GET", "POST"]
}));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"]
  }
});

app.use(express.static(path.join(__dirname, "public")));

// Armazenar informações das salas
const rooms = new Map();

io.on("connection", (socket) => {
  console.log("Cliente conectado:", socket.id);

  // Entrar em uma sala
  socket.on("joinRoom", (roomId) => {
    socket.join(roomId);
    console.log(`Socket ${socket.id} entrou na sala ${roomId}`);
    
    // Inicializar sala se não existir
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        participants: new Set(),
        broadcaster: null
      });
    }
    
    const room = rooms.get(roomId);
    room.participants.add(socket.id);
    
    // Notificar outros participantes
    socket.to(roomId).emit("newParticipant", socket.id);
    
    // Se já existe um broadcaster, notificar o novo participante
    if (room.broadcaster && room.broadcaster !== socket.id) {
      socket.emit("broadcaster");
    }
  });

  // Sair de uma sala
  socket.on("leaveRoom", (roomId) => {
    if (!roomId) return;
    
    socket.leave(roomId);
    console.log(`Socket ${socket.id} saiu da sala ${roomId}`);
    
    const room = rooms.get(roomId);
    if (room) {
      room.participants.delete(socket.id);
      
      // Se era o broadcaster, remover
      if (room.broadcaster === socket.id) {
        room.broadcaster = null;
      }
      
      // Notificar outros participantes
      socket.to(roomId).emit("participantLeft", socket.id);
      
      // Se não há mais participantes, remover a sala
      if (room.participants.size === 0) {
        rooms.delete(roomId);
      }
    }
  });

  // Registrar como broadcaster
  socket.on("broadcaster", (roomId) => {
    console.log(`Broadcaster registrado: ${socket.id} na sala ${roomId}`);
    
    const room = rooms.get(roomId);
    if (room) {
      room.broadcaster = socket.id;
      // Notificar todos os outros na sala que há um broadcaster
      socket.to(roomId).emit("broadcaster");
    }
  });

  // Alguém quer assistir
  socket.on("watcher", (roomId) => {
    console.log(`Viewer conectado: ${socket.id} na sala ${roomId}`);
    
    const room = rooms.get(roomId);
    if (room && room.broadcaster) {
      // Notificar o broadcaster sobre o novo watcher
      io.to(room.broadcaster).emit("watcher", socket.id);
    }
  });

  // WebRTC signaling
  socket.on("offer", (targetId, message) => {
    console.log(`Offer de ${socket.id} para ${targetId}`);
    io.to(targetId).emit("offer", socket.id, message);
  });

  socket.on("answer", (targetId, message) => {
    console.log(`Answer de ${socket.id} para ${targetId}`);
    io.to(targetId).emit("answer", socket.id, message);
  });

  socket.on("candidate", (targetId, message) => {
    console.log(`ICE Candidate de ${socket.id} para ${targetId}`);
    io.to(targetId).emit("candidate", socket.id, message);
  });

  // Chat
  socket.on("chatMessage", ({ roomId, ...msg }) => {
    console.log(`Mensagem de chat na sala ${roomId}:`, msg);
    // Enviar para todos na sala, incluindo o remetente
    io.to(roomId).emit("chatMessage", msg);
  });

  // Quadro colaborativo
  socket.on("whiteboardUpdate", ({ roomId, ...data }) => {
    // Enviar para todos na sala, exceto o remetente
    socket.to(roomId).emit("whiteboardUpdate", data);
  });

  // Desconexão
  socket.on("disconnect", () => {
    console.log("Cliente desconectou:", socket.id);
    
    // Remover de todas as salas
    for (const [roomId, room] of rooms.entries()) {
      if (room.participants.has(socket.id)) {
        room.participants.delete(socket.id);
        
        // Se era o broadcaster, remover
        if (room.broadcaster === socket.id) {
          room.broadcaster = null;
        }
        
        // Notificar outros participantes
        socket.to(roomId).emit("participantLeft", socket.id);
        socket.to(roomId).emit("disconnectPeer", socket.id);
        
        // Se não há mais participantes, remover a sala
        if (room.participants.size === 0) {
          rooms.delete(roomId);
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log("CORS configurado para:", allowedOrigins);
});