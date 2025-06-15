import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import { appendFile } from "fs/promises";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, "public")));

io.on("connection", (socket) => {
  let ip = socket.handshake.address;
  if (ip.startsWith("::ffff:")) ip = ip.replace("::ffff:", "");

  console.log(`✅ Usuario conectado desde ${ip}`);

  socket.on("chat message", async (msg) => {
    const timestamp = new Date().toISOString();
    const messageWithIp = `[${ip}] ${msg}`;
    const logLine = `${timestamp} ${messageWithIp}\n`;

    console.log(messageWithIp);
    io.emit("chat message", messageWithIp);

    try {
      await appendFile("chat.log", logLine, "utf8");
    } catch (err) {
      console.error("❌ Error escribiendo log:", err);
    }
  });

  socket.on("disconnect", () => {
    console.log(`❌ Usuario desconectado desde ${ip}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, (err) => {
  if (err) {
    console.error("❌ Error iniciando el servidor:", err);
    process.exit(1);
    return;
  }
  console.log(`🟢 Servidor en http://localhost:${PORT}`);
});
