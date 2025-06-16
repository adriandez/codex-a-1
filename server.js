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
import rateLimit from "express-rate-limit";
import sanitizeHtml from "sanitize-html";
import { fileTypeFromFile } from "file-type";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const sessionId = randomUUID();
let chatHistory = [];
const nicknames = new Map();
const messageTimestamps = new Map();
const uploadCountersPerMinute = new Map();
const uploadCountersPerSession = new Map();

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
app.use("/uploads", express.static(path.join(__dirname, "public/uploads")));

// 🛡️ Limitador por IP para evitar flood general
const uploadLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 20,
  message: "Demasiadas peticiones, espera un minuto.",
});

const uploadDir = path.join(__dirname, "public/uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const safeName = file.originalname.replace(/[^a-z0-9.\-_]/gi, "_");
    cb(null, `${timestamp}-${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    const isImage = /^image\/(jpeg|png|gif|webp)$/.test(file.mimetype);
    if (!isImage) {
      return cb(new Error("Solo se permiten imágenes JPEG, PNG, GIF o WebP"));
    }
    cb(null, true);
  },
});

// 🔁 Reinicia contador de minuto cada 60 segundos
setInterval(() => uploadCountersPerMinute.clear(), 60_000);

app.post("/upload", uploadLimiter, upload.single("image"), async (req, res) => {
  const ip = req.ip;
  const socketId = req.headers["x-socket-id"];

  if (!socketId) {
    return res.status(400).json({ error: "Falta header x-socket-id" });
  }

  // ⏱️ Limite por minuto (IP)
  const minuteCount = uploadCountersPerMinute.get(ip) || 0;
  if (minuteCount >= 4) {
    return res.status(429).json({ error: "Máximo 4 imágenes por minuto." });
  }
  uploadCountersPerMinute.set(ip, minuteCount + 1);

  // 🧑‍💻 Límite por sesión (socket.id)
  const sessionCount = uploadCountersPerSession.get(socketId) || 0;
  if (sessionCount >= 30) {
    return res.status(429).json({ error: "Máximo 30 imágenes por sesión." });
  }
  uploadCountersPerSession.set(socketId, sessionCount + 1);

  if (!req.file) {
    return res.status(400).json({ error: "No se subió ningún archivo" });
  }

  // 🧪 Verificación real del tipo de archivo
  const detected = await fileTypeFromFile(req.file.path);
  if (
    !detected ||
    !["image/jpeg", "image/png", "image/gif", "image/webp"].includes(
      detected.mime
    )
  ) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "Tipo de archivo no permitido" });
  }

  const imageUrl = `/uploads/${req.file.filename}`;
  logger.info(`📸 Imagen subida: ${imageUrl}`);
  res.json({ imageUrl });
});

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
    const now = Date.now();
    const lastMsg = messageTimestamps.get(socket.id) || 0;
    if (now - lastMsg < 800) return;
    messageTimestamps.set(socket.id, now);

    const cleanMsg =
      typeof msg === "string"
        ? sanitizeHtml(msg.replace(/\u00A0/g, " ").replace(/\u200B/g, ""), {
            allowedTags: [],
            allowedAttributes: {},
          })
        : String(msg);

    const messageWithInfo = formatMessage(ip, nickname, cleanMsg);
    chatHistory = chatHistory.slice(-999).concat(messageWithInfo);
    io.emit("chat message", messageWithInfo);
    logger.info(messageWithInfo);
  });

  socket.on("disconnect", () => {
    logger.info(`❌ Usuario desconectado desde ${ip}`);
    nicknames.delete(socket.id);
  });
});

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