// config/logger.js — Winston loggers, one per concern, separate files.
//
// Usage: const { loginLogger, workerLogger, socketLogger, dbLogger, errorLogger } = require("../config/logger");
//
// SECURITY: every message passes through a redaction formatter that strips
// anything that looks like a credential (JWTs, feed tokens, TOTP codes, the
// Angel One API key / password / TOTP secret from process.env). Never rely on
// callers remembering not to log secrets — but also never log token objects
// on purpose; this is a second line of defence, not a licence.

const fs = require("fs");
const path = require("path");
const winston = require("winston");

const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, "..", "logs");
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// Values that must never appear in any log line, whatever the level.
function secretValues() {
    return [
        process.env.ANGEL_API_KEY,
        process.env.ANGEL_PASSWORD,
        process.env.ANGEL_TOTP_SECRET,
        process.env.DB_PASSWORD,
        process.env.JWT_SECRET,
    ].filter((v) => typeof v === "string" && v.length >= 4);
}

const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

function redactString(str) {
    let out = str.replace(JWT_RE, "[REDACTED_JWT]");
    for (const secret of secretValues()) {
        // split/join instead of RegExp to avoid regex-escaping issues
        out = out.split(secret).join("[REDACTED]");
    }
    return out;
}

const redact = winston.format((info) => {
    if (typeof info.message === "string") info.message = redactString(info.message);
    for (const key of Object.keys(info)) {
        if (typeof info[key] === "string" && key !== "level") info[key] = redactString(info[key]);
    }
    return info;
});

const baseFormat = winston.format.combine(
    redact(),
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, label, stack, ...meta }) => {
        const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
        return `${timestamp} [${label}] ${level}: ${stack || message}${extra}`;
    })
);

// error.log is shared: every logger mirrors its error-level entries there.
const sharedErrorTransport = new winston.transports.File({
    filename: path.join(LOG_DIR, "error.log"),
    level: "error",
    maxsize: 5 * 1024 * 1024,
    maxFiles: 3,
});

function makeLogger(label, filename) {
    return winston.createLogger({
        level: process.env.LOG_LEVEL || "info",
        format: winston.format.combine(winston.format.label({ label }), baseFormat),
        transports: [
            new winston.transports.File({
                filename: path.join(LOG_DIR, filename),
                maxsize: 5 * 1024 * 1024,
                maxFiles: 3,
            }),
            sharedErrorTransport,
            new winston.transports.Console({ level: process.env.CONSOLE_LOG_LEVEL || "info" }),
        ],
    });
}

module.exports = {
    loginLogger: makeLogger("login", "login.log"),
    workerLogger: makeLogger("worker", "worker.log"),
    socketLogger: makeLogger("socket", "socket.log"),
    dbLogger: makeLogger("database", "database.log"),
    errorLogger: makeLogger("error", "error.log"),
    LOG_DIR,
};
