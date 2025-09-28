
import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import { AccessToken } from "livekit-server-sdk";

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

// ============================
// LiveKit: gerar token JWT
// ============================
app.get("/get-token", (req, res) => {
  const { roomName, participantName } = req.query;

  if (!roomName || !participantName) {
    return res.status(400).json({ error: "roomName e participantName são obrigatórios" });
  }

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  const at = new AccessToken(apiKey, apiSecret, {
    identity: participantName.toString(),
  });
  at.addGrant({ roomJoin: true, room: roomName.toString(), canPublish: true, canSubscribe: true });

  const token = at.toJwt();
  res.json({ token });
});

// ============================
// Armazenar informações das salas (chat + whiteboard)
// ============================
const rooms = new Map();

io.on("connection", (socket) => {
  console.log("Cliente conectado:", socket.id);

  // Entrar em uma sala
  socket.on("joinRoom", (roomId) => {
    socket.join(roomId);
    console.log(`Socket ${socket.id} entrou na sala ${roomId}`);
    
    if (!rooms.has(roomId)) {
      rooms.set(roomId, { participants: new Set() });
    }
    const room = rooms.get(roomId);
    room.participants.add(socket.id);

    // Notificar outros participantes
    socket.to(roomId).emit("newParticipant", socket.id);
  });

  // Sair de uma sala
  socket.on("leaveRoom", (roomId) => {
    if (!roomId) return;
    socket.leave(roomId);

    const room = rooms.get(roomId);
    if (room) {
      room.participants.delete(socket.id);
      socket.to(roomId).emit("participantLeft", socket.id);

      if (room.participants.size === 0) {
        rooms.delete(roomId);
      }
    }
  });

  // Chat
  socket.on("chatMessage", ({ roomId, ...msg }) => {
    console.log(`Mensagem de chat na sala ${roomId}:`, msg);
    io.to(roomId).emit("chatMessage", msg);
  });

  // Quadro colaborativo
  socket.on("whiteboardUpdate", ({ roomId, ...data }) => {
    socket.to(roomId).emit("whiteboardUpdate", data);
  });

  // Desconexão
  socket.on("disconnect", () => {
    console.log("Cliente desconectou:", socket.id);
    for (const [roomId, room] of rooms.entries()) {
      if (room.participants.has(socket.id)) {
        room.participants.delete(socket.id);
        socket.to(roomId).emit("participantLeft", socket.id);

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
