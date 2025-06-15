import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { createLogger, format, transports } from "winston";
import DailyRotateFile from "winston-daily-rotate-file";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const sessionId = randomUUID();
const chatHistory = [];

const logPath = process.env.LOG_PATH || "logs/chat-%DATE%.log";

const logger = createLogger({
  level: "info",
  format: format.combine(
    format.timestamp(),
    format.printf(({ timestamp, message }) => `${timestamp} ${message}`)
  ),
  transports: [
    new DailyRotateFile({
      filename: logPath,
      datePattern: "YYYY-MM-DD",
      maxSize: "20m",
      maxFiles: "14d",
    }),
    new transports.Console(),
  ],
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, "public")));

io.on("connection", (socket) => {
  let ip = socket.handshake.address;
  if (ip.startsWith("::ffff:")) ip = ip.replace("::ffff:", "");

  logger.info(`✅ Usuario conectado desde ${ip}`);

  socket.emit("chat history", { sessionId, history: chatHistory });

  socket.on("chat message", (msg) => {
    const messageWithIp = `[${ip}] ${msg}`;

    chatHistory.push(messageWithIp);
    io.emit("chat message", messageWithIp);
    logger.info(messageWithIp);
  });

  socket.on("disconnect", () => {
    logger.info(`❌ Usuario desconectado desde ${ip}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, (err) => {
  if (err) {
    logger.error("❌ Error iniciando el servidor:", err);
    process.exit(1);
    return;
  }
  logger.info(`🟢 Servidor en http://localhost:${PORT}`);
});
