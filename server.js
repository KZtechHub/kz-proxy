/**
 * ============================================================
 *  KZ Proxy Server — Kriptomech AI Gateway
 *  Secure Anthropic API proxy for Claude-powered artifacts
 *  Version: 1.0.0
 *  Author:  Kriptomech
 * ============================================================
 *
 *  HOW TO RUN:
 *    1. cp .env.example .env
 *    2. Add your ANTHROPIC_API_KEY to .env
 *    3. npm install
 *    4. npm start
 *
 *  NEVER commit your .env file or paste your API key in code.
 * ============================================================
 */

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import fetch from "node-fetch";

dotenv.config();

// ─── Config ─────────────────────────────────────────────────
const PORT            = process.env.PORT || 3001;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim())
  : ["http://localhost:3000", "http://localhost:5173"];

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL     = "claude-sonnet-4-20250514";
const MAX_TOKENS        = process.env.MAX_TOKENS ? parseInt(process.env.MAX_TOKENS) : 1000;

// ─── Validate environment on boot ───────────────────────────
if (!ANTHROPIC_API_KEY) {
  console.error("\n❌  ANTHROPIC_API_KEY is missing from your .env file.");
  console.error("    Create a .env file from .env.example and add your key.\n");
  process.exit(1);
}

// ─── App Setup ───────────────────────────────────────────────
const app = express();

// CORS — only allow specified origins
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, Postman) in dev
    if (!origin && process.env.NODE_ENV !== "production") return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: Origin '${origin}' not allowed.`));
  },
  methods: ["POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json({ limit: "1mb" }));

// ─── Rate Limiting ───────────────────────────────────────────
const limiter = rateLimit({
  windowMs : 60 * 1000,   // 1 minute window
  max      : 30,           // max 30 requests per IP per minute
  message  : { error: "Too many requests. Please slow down." },
  standardHeaders: true,
  legacyHeaders  : false,
});
app.use("/api/", limiter);

// ─── Health Check ────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.json({
    service : "KZ Proxy Server — Kriptomech AI Gateway",
    status  : "online",
    version : "1.0.0",
    model   : DEFAULT_MODEL,
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// ─── Main Proxy Endpoint ─────────────────────────────────────
/**
 * POST /api/claude
 * Body: {
 *   messages   : [ { role: "user", content: "..." } ],  // required
 *   system     : "...",                                  // optional
 *   max_tokens : 1000,                                   // optional
 *   model      : "claude-sonnet-4-20250514",             // optional
 * }
 */
app.post("/api/claude", async (req, res) => {
  const { messages, system, max_tokens, model } = req.body;

  // ── Input validation ──
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array is required and must not be empty." });
  }

  for (const msg of messages) {
    if (!msg.role || !msg.content) {
      return res.status(400).json({ error: "Each message must have 'role' and 'content'." });
    }
    if (!["user", "assistant"].includes(msg.role)) {
      return res.status(400).json({ error: `Invalid role '${msg.role}'. Must be 'user' or 'assistant'.` });
    }
  }

  // ── Build Anthropic payload ──
  const payload = {
    model      : model      || DEFAULT_MODEL,
    max_tokens : max_tokens || MAX_TOKENS,
    messages,
  };
  if (system) payload.system = system;

  // ── Forward to Anthropic ──
  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method  : "POST",
      headers : {
        "Content-Type"      : "application/json",
        "x-api-key"         : ANTHROPIC_API_KEY,
        "anthropic-version" : ANTHROPIC_VERSION,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Anthropic API error:", data);
      return res.status(response.status).json({
        error : data?.error?.message || "Anthropic API error.",
        type  : data?.error?.type    || "unknown",
      });
    }

    return res.json(data);

  } catch (err) {
    console.error("Proxy fetch error:", err.message);
    return res.status(502).json({ error: "Failed to reach Anthropic API.", details: err.message });
  }
});

// ─── 404 Handler ─────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "Route not found. Use POST /api/claude" });
});

// ─── Global Error Handler ─────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err.message);
  res.status(500).json({ error: err.message || "Internal server error." });
});

// ─── Start ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\nKZ Proxy Server running on http://localhost:${PORT}`);
  console.log(`Allowed origins: ${ALLOWED_ORIGINS.join(", ")}`);
  console.log(`Default model:   ${DEFAULT_MODEL}\n`);
});
