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

io.on("connection", (socket) => {
  console.log("Cliente conectado:", socket.id);

  // Criar/entrar em uma sala
  socket.on("joinRoom", (roomId) => {
    socket.join(roomId);
    console.log(`Socket ${socket.id} entrou na sala ${roomId}`);
    // Avisar outros na sala que tem um novo participante
    socket.to(roomId).emit("newParticipant", socket.id);
  });

  socket.on("broadcaster", (roomId) => {
    console.log(`Broadcaster registrado: ${socket.id} na sala ${roomId}`);
    socket.to(roomId).emit("broadcaster");
  });

  socket.on("watcher", (roomId) => {
    console.log(`Viewer conectado: ${socket.id} na sala ${roomId}`);
    socket.to(roomId).emit("watcher", socket.id);
  });

  socket.on("offer", (id, message) => {
    console.log(`Offer de ${socket.id} para ${id}`);
    io.to(id).emit("offer", socket.id, message);
  });

  socket.on("answer", (id, message) => {
    console.log(`Answer de ${socket.id} para ${id}`);
    io.to(id).emit("answer", socket.id, message);
  });

  socket.on("candidate", (id, message) => {
    console.log(`Candidate de ${socket.id} para ${id}`);
    io.to(id).emit("candidate", socket.id, message);
  });

  socket.on("chatMessage", ({ roomId, ...msg }) => {
    socket.to(roomId).emit("chatMessage", msg);
  });

  socket.on("whiteboardUpdate", ({ roomId, ...data }) => {
    socket.to(roomId).emit("whiteboardUpdate", data);
  });

  socket.on("disconnect", () => {
    console.log("Cliente desconectou:", socket.id);
    socket.broadcast.emit("disconnectPeer", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));