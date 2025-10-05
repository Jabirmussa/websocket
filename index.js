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

const rooms = new Map();

io.on("connection", (socket) => {
  console.log("Cliente conectado:", socket.id);

  socket.on("joinRoom", (roomId) => {
    socket.join(roomId);
    console.log(`Socket ${socket.id} entrou na sala ${roomId}`);
    
    if (!rooms.has(roomId)) {
      rooms.set(roomId, { 
        participants: new Set(),
        slides: [],
        currentSlide: 0,
        showSlides: false
      });
    }
    const room = rooms.get(roomId);
    room.participants.add(socket.id);

    if (room.showSlides && room.slides.length > 0) {
      socket.emit("slidesUpdate", {
        slides: room.slides,
        currentSlide: room.currentSlide,
        showSlides: room.showSlides
      });
    }

    socket.to(roomId).emit("newParticipant", socket.id);
  });

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

  socket.on("chatMessage", ({ roomId, ...msg }) => {
    console.log(`Mensagem de chat na sala ${roomId}:`, msg);
    io.to(roomId).emit("chatMessage", msg);
  });

  socket.on("whiteboardUpdate", ({ roomId, ...data }) => {
    socket.to(roomId).emit("whiteboardUpdate", data);
  });

  socket.on('slidesUpdate', (data) => {
    const { roomId, slides, currentSlide, showSlides } = data;
    
    const room = rooms.get(roomId);
    if (room) {
      room.slides = slides;
      room.currentSlide = currentSlide;
      room.showSlides = showSlides;
      
      console.log(`Slides atualizados na sala ${roomId}: ${slides.length} slides, mostrando: ${showSlides}`);
    }
    
    io.to(roomId).emit('slidesUpdate', {
      slides,
      currentSlide,
      showSlides
    });
  });

  socket.on('slideChanged', (data) => {
    const { roomId, slideIndex } = data;
    
    const room = rooms.get(roomId);
    if (room) {
      room.currentSlide = slideIndex;
      console.log(`Slide mudado na sala ${roomId}: slide ${slideIndex}`);
    }
    
    io.to(roomId).emit('slideChanged', slideIndex);
  });

  socket.on("disconnect", () => {
    console.log("Cliente desconectou:", socket.id);
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