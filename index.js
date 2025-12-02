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

const allowedOrigins = [
  "https://knowledgehub-nine.vercel.app",
  "http://localhost:3000",
];

app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST"],
  })
);

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
  },
});

app.use(express.static(path.join(__dirname, "public")));

// === Geração de token LiveKit ===
app.get("/get-token", (req, res) => {
  const { roomName, participantName } = req.query;

  if (!roomName || !participantName) {
    return res
      .status(400)
      .json({ error: "roomName e participantName são obrigatórios" });
  }

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  const at = new AccessToken(apiKey, apiSecret, {
    identity: participantName.toString(),
  });
  at.addGrant({
    roomJoin: true,
    room: roomName.toString(),
    canPublish: true,
    canSubscribe: true,
  });

  const token = at.toJwt();
  res.json({ token });
});

// === Estrutura principal ===
const rooms = new Map();
const onlineUsers = new Map(); // userId -> socketId

// === Função auxiliar para broadcast de status ===
function broadcastUserStatus(userId, isOnline) {
  io.emit("userStatus", { userId, isOnline });
  console.log(`Status broadcast: ${userId} está ${isOnline ? "online" : "offline"}`);
}

// === Função para enviar lista de usuários online ===
function sendOnlineUsersList(socket) {
  const onlineUserIds = Array.from(onlineUsers.keys());
  socket.emit("onlineUsers", onlineUserIds);
  console.log(`Lista de usuários online enviada: ${onlineUserIds.length} usuários`);
}

io.on("connection", (socket) => {
  console.log("Cliente conectado:", socket.id);

  // === Registrar usuário conectado ===
  socket.on("registerUser", (userId) => {
    onlineUsers.set(userId, socket.id);
    console.log(`Usuário ${userId} registrado no socket ${socket.id}`);
    
    // Notificar todos sobre o novo usuário online
    broadcastUserStatus(userId, true);
    
    // Enviar lista de usuários online para o novo usuário
    sendOnlineUsersList(socket);
  });

  // === Entrar numa sala ===
  socket.on("joinRoom", (roomId) => {
    socket.join(roomId);
    console.log(`Socket ${socket.id} entrou na sala ${roomId}`);

    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        participants: new Set(),
        slides: [],
        currentSlide: 0,
        showSlides: false,
      });
    }
    const room = rooms.get(roomId);
    room.participants.add(socket.id);

    if (room.showSlides && room.slides.length > 0) {
      socket.emit("slidesUpdate", {
        slides: room.slides,
        currentSlide: room.currentSlide,
        showSlides: room.showSlides,
      });
    }

    socket.to(roomId).emit("newParticipant", socket.id);
  });

  // === Sair da sala ===
  socket.on("leaveRoom", (roomId) => {
    if (!roomId) return;
    socket.leave(roomId);

    const room = rooms.get(roomId);
    if (room) {
      room.participants.delete(socket.id);
      socket.to(roomId).emit("participantLeft", socket.id);

      if (room.participants.size === 0) {
        rooms.delete(roomId);
        console.log(`Sala ${roomId} removida (sem participantes)`);
      }
    }
  });

  // === Mensagem em sala (LiveKit/chat) ===
  socket.on("chatMessage", ({ roomId, senderId, message }) => {
    console.log(`Mensagem na sala ${roomId} de ${senderId}:`, message);
    io.to(roomId).emit("chatMessage", message);

    // Notificação para destinatário se houver
    const recipientId = message?.receiverId;
    if (recipientId && onlineUsers.has(recipientId)) {
      const targetSocket = onlineUsers.get(recipientId);
      io.to(targetSocket).emit("notification", {
        title: "Nova mensagem",
        body: `${message.sender?.name || "Usuário"} te enviou: "${message.text}"`,
      });
    }
  });

  // === Mensagem privada (conversas normais) ===
  socket.on("privateMessage", ({ senderId, receiverId, message }) => {
    console.log(`Mensagem privada de ${senderId} para ${receiverId}:`, message);

    if (receiverId && onlineUsers.has(receiverId)) {
      const targetSocket = onlineUsers.get(receiverId);
      io.to(targetSocket).emit("privateMessage", {
        senderId,
        message,
      });

      // Notificação em tempo real
      io.to(targetSocket).emit("notification", {
        title: "Nova mensagem",
        body: `${message.sender?.name || "Usuário"} te enviou: "${message.text}"`,
      });
    }

    // Também devolve para quem enviou atualizar chat
    socket.emit("privateMessage", { senderId, message });
  });

  // === WHITEBOARD ===
  socket.on("whiteboardUpdate", ({ roomId, ...data }) => {
    socket.to(roomId).emit("whiteboardUpdate", data);
  });

  // === SLIDES ===
  socket.on("slidesUpdate", (data) => {
    const { roomId, slides, currentSlide, showSlides } = data;

    const room = rooms.get(roomId);
    if (room) {
      room.slides = slides;
      room.currentSlide = currentSlide;
      room.showSlides = showSlides;
      console.log(
        `Slides atualizados na sala ${roomId}: ${slides.length} slides, mostrando: ${showSlides}`
      );
    }

    io.to(roomId).emit("slidesUpdate", {
      slides,
      currentSlide,
      showSlides,
    });
  });

  socket.on("slideChanged", (data) => {
    const { roomId, slideIndex } = data;

    const room = rooms.get(roomId);
    if (room) {
      room.currentSlide = slideIndex;
      console.log(`Slide mudado na sala ${roomId}: slide ${slideIndex}`);
    }

    io.to(roomId).emit("slideChanged", slideIndex);
  });

  // === Desconexão ===
  socket.on("disconnect", () => {
    console.log("Cliente desconectou:", socket.id);

    // Remove da lista de usuários online e notifica todos
    let disconnectedUserId = null;
    for (const [userId, sockId] of onlineUsers.entries()) {
      if (sockId === socket.id) {
        disconnectedUserId = userId;
        onlineUsers.delete(userId);
        console.log(`Usuário ${userId} desconectado`);
        
        // Notificar todos que o usuário ficou offline
        broadcastUserStatus(userId, false);
        break;
      }
    }

    // Remove de salas
    for (const [roomId, room] of rooms.entries()) {
      if (room.participants.has(socket.id)) {
        room.participants.delete(socket.id);
        socket.to(roomId).emit("participantLeft", socket.id);

        if (room.participants.size === 0) {
          rooms.delete(roomId);
          console.log(`Sala ${roomId} removida (último participante saiu)`);
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