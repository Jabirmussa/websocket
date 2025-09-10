import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

io.on("connection", (socket) => {
  console.log("Cliente conectado:", socket.id);

  socket.on("broadcaster", () => {
    console.log("Broadcaster registrado:", socket.id);
    socket.broadcast.emit("broadcaster");
  });

  socket.on("watcher", () => {
    console.log("Viewer conectado:", socket.id);
    socket.broadcast.emit("watcher", socket.id);
  });

  socket.on("offer", (id, message) => {
    console.log("Offer do broadcaster para viewer:", id);
    io.to(id).emit("offer", socket.id, message);
  });

  socket.on("answer", (id, message) => {
    console.log("Answer do viewer para broadcaster:", id);
    io.to(id).emit("answer", socket.id, message);
  });

  socket.on("candidate", (id, message) => {
    console.log("Candidate de", socket.id, "para", id);
    io.to(id).emit("candidate", socket.id, message);
  });

  socket.on("disconnect", () => {
    console.log("Cliente desconectou:", socket.id);
    socket.broadcast.emit("disconnectPeer", socket.id);
  });
});

const PORT = 3000;
server.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
