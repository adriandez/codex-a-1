import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { createLogger, format, transports } from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import { formatMessage } from "./utils.js";
import multer from "multer";
import fs from "fs";

// Setup básico
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const sessionId = randomUUID();
const chatHistory = [];
const nicknames = new Map();

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

// Rutas estáticas
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "public/uploads")));

// 📸 Configurar subida de imágenes con Multer
const uploadDir = path.join(__dirname, "public/uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const safeName = file.originalname.replace(/[^a-z0-9\.\-_]/gi, "_");
    cb(null, `${timestamp}-${safeName}`);
  },
});

const upload = multer({ storage });

app.post("/upload", upload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const imageUrl = `/uploads/${req.file.filename}`;
  logger.info(`📸 Imagen subida: ${imageUrl}`);
  res.json({ imageUrl });
});

// 🧠 Socket
io.on("connection", (socket) => {
  let ip = socket.handshake.address;
  if (ip.startsWith("::ffff:")) ip = ip.replace("::ffff:", "");

  logger.info(`✅ Usuario conectado desde ${ip}`);
  let nickname = "Anon";

  socket.on("set nickname", (name) => {
    nickname = name?.trim() || "Anon";
    nicknames.set(socket.id, { ip, nickname });
  });

  socket.emit("chat history", { sessionId, history: chatHistory });

  socket.on("chat message", (msg) => {
    const cleanMsg =
      typeof msg === "string"
        ? msg
            .replace(/\r\n/g, "\n")
            .replace(/\u00A0/g, " ")
            .replace(/\u200B/g, "")
        : String(msg);

    const messageWithInfo = formatMessage(ip, nickname, cleanMsg);
    chatHistory.push(messageWithInfo);
    io.emit("chat message", messageWithInfo);
    logger.info(messageWithInfo);
  });

  socket.on("disconnect", () => {
    logger.info(`❌ Usuario desconectado desde ${ip}`);
    nicknames.delete(socket.id);
  });
});

// 🚀 Start
export function startServer(port = process.env.PORT || 3000) {
  server.listen(port, (err) => {
    if (err) {
      logger.error("❌ Error iniciando el servidor:", err);
      process.exit(1);
    } else {
      logger.info(`🟢 Servidor en http://localhost:${port}`);
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer();
}