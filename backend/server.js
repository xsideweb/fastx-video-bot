/**
 * Backend for Xside AI Mini App — Video Generation
 * Models: kling-2.6/image-to-video, kling-2.6/motion-control, kling-3.0/video
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const sharp = require("sharp");
const { v4: uuidv4 } = require("uuid");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");

const mediaStore = new Map();
const taskMeta   = new Map();
const taskResults = new Map();

const DB_URL = process.env.DATABASE_URL || process.env.database_url;
const pool = new Pool({
  connectionString: DB_URL,
  ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "image/jpeg","image/png","image/webp",
      "video/mp4","video/quicktime","video/x-matroska",
    ];
    cb(null, allowed.includes(file.mimetype));
  },
});

app.use(cors());
app.use(express.json({ limit: "20mb" }));
const publicDir = path.join(__dirname, "..");
app.use(express.static(publicDir));

const MEDIA_TTL_MS = 5 * 60 * 1000;
app.get("/api/image/:id", (req, res) => {
  const entry = mediaStore.get(req.params.id);
  if (!entry) return res.status(404).json({ error: "Not found" });
  res.set("Content-Type", entry.mimeType || "application/octet-stream");
  res.send(entry.buffer);
  setTimeout(() => mediaStore.delete(req.params.id), MEDIA_TTL_MS);
});

app.get("/api/thumb", async (req, res) => {
  const rawUrl = req.query.url;
  if (!rawUrl || !rawUrl.startsWith("https://")) return res.status(400).json({ error: "Invalid url" });
  try {
    const r = await fetch(rawUrl, { redirect: "follow" });
    if (!r.ok) return res.status(502).json({ error: "Failed to fetch" });
    const buf = Buffer.from(await r.arrayBuffer());
    const ctype = r.headers.get("content-type") || "application/octet-stream";
    if (ctype.startsWith("video/")) {
      res.set("Content-Type", ctype);
      res.set("Cache-Control", "public, max-age=86400, immutable");
      return res.send(buf);
    }
    try {
      const out = await sharp(buf).resize(256, 256, { fit: "inside", withoutEnlargement: true }).toBuffer();
      res.set("Content-Type", ctype);
      res.set("Content-Disposition", "inline");
      res.set("Cache-Control", "public, max-age=86400, immutable");
      return res.send(out);
    } catch { res.set("Content-Type", ctype); res.set("Cache-Control", "public, max-age=86400, immutable"); return res.send(buf); }
  } catch { res.status(502).json({ error: "Failed to fetch" }); }
});

app.get("/api/view", async (req, res) => {
  const rawUrl = req.query.url;
  if (!rawUrl || !rawUrl.startsWith("https://")) return res.status(400).json({ error: "Invalid url" });
  const w = parseInt(req.query.w, 10), h = parseInt(req.query.h, 10);
  const needResize = (w > 0 && w <= 4096) || (h > 0 && h <= 4096);
  try {
    const r = await fetch(rawUrl, { redirect: "follow" });
    if (!r.ok) return res.status(502).json({ error: "Failed to fetch" });
    const buf = Buffer.from(await r.arrayBuffer());
    const ctype = r.headers.get("content-type") || "application/octet-stream";
    if (needResize && !ctype.startsWith("video/")) {
      try {
        const out = await sharp(buf).resize(w > 0 ? w : null, h > 0 ? h : null, { fit: "inside", withoutEnlargement: true }).toBuffer();
        res.set("Content-Type", ctype); res.set("Content-Disposition", "inline"); res.set("Cache-Control", "public, max-age=3600"); return res.send(out);
      } catch { /* fall through */ }
    }
    res.set("Content-Type", ctype); res.set("Content-Disposition", "inline"); res.set("Cache-Control", "public, max-age=3600"); res.send(buf);
  } catch { res.status(502).json({ error: "Failed to fetch" }); }
});

app.get("/api/download", async (req, res) => {
  const rawUrl = req.query.url, filename = req.query.filename || "video.mp4";
  if (!rawUrl || !rawUrl.startsWith("https://")) return res.status(400).json({ error: "Invalid url" });
  try {
    const r = await fetch(rawUrl, { redirect: "follow" });
    if (!r.ok) return res.status(502).json({ error: "Failed to fetch" });
    const buf = Buffer.from(await r.arrayBuffer());
    res.set("Content-Type", r.headers.get("content-type") || "video/mp4");
    res.set("Content-Disposition", `attachment; filename="${filename.replace(/"/g, "%22")}"`);
    res.send(buf);
  } catch { res.status(502).json({ error: "Failed to fetch" }); }
});

app.post("/api/callback", async (req, res) => {
  const { code, msg, data } = req.body || {};
  const taskId = data?.taskId;
  if (!taskId) return res.status(400).json({ error: "Missing taskId" });
  let resultUrl;
  if (typeof data?.resultJson === "string") {
    try {
      const parsed = JSON.parse(data.resultJson);
      const urls = parsed.resultUrls || parsed.urls || parsed.videos || parsed.images || [];
      if (Array.isArray(urls) && urls.length > 0) resultUrl = urls[0];
    } catch { /* ignore */ }
  }
  let successFlag = code === 200 && data?.state === "success" ? 1 : 3;
  let errorMessage = data?.failMsg || msg || (successFlag !== 1 ? "Generation failed" : "");
  let errorCode;
  let remainingCredits;
  let galleryItem;
  const meta = taskMeta.get(taskId);
  const chargeUserId = meta?.userId != null && String(meta.userId) !== "" ? String(meta.userId) : null;
  if (successFlag === 1 && resultUrl) {
    if (chargeUserId) {
      try {
        const charge = await tryDeductUserCredits(chargeUserId, Number(meta?.tokensSpent || 0));
        if (!charge.ok) {
          successFlag = 3;
          errorCode = "INSUFFICIENT_CREDITS";
          errorMessage = "Недостаточно токенов";
          remainingCredits = charge.credits;
        } else {
          remainingCredits = charge.credits;
        }
      } catch (e) {
        console.error("Failed to deduct credits after success:", e.message);
        successFlag = 3;
        errorMessage = "Не удалось списать токены";
      }
    }
    if (successFlag === 1 && chargeUserId) {
      const id = uuidv4(), createdAt = new Date(meta.createdAt || Date.now());
      galleryItem = { id, url: resultUrl, prompt: meta.prompt || "", createdAt: createdAt.getTime() };
      try {
        await pool.query(
          "INSERT INTO video_generations (id, user_id, url, prompt, model, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
          [id, chargeUserId, resultUrl, meta.prompt || "", meta.modelKey || null, createdAt]
        );
      } catch (e) { console.error("Failed to insert gallery item:", e.message); }
    }
  }
  taskResults.set(taskId, {
    successFlag,
    resultUrl: resultUrl || undefined,
    errorMessage: errorMessage || undefined,
    error: errorCode,
    required: meta?.tokensSpent,
    credits: remainingCredits,
    galleryItem,
  });
  taskMeta.delete(taskId);
  res.status(200).json({ status: "received" });
});

app.get("/api/task/:taskId", (req, res) => {
  const result = taskResults.get(req.params.taskId);
  if (!result) return res.json({ successFlag: 0 });
  res.json({
    successFlag: result.successFlag,
    resultUrl: result.resultUrl,
    errorMessage: result.errorMessage,
    error: result.error,
    required: result.required,
    credits: result.credits,
    galleryItem: result.galleryItem,
  });
});

app.get("/api/gallery", async (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.json([]);
  try {
    const result = await pool.query(
      "SELECT id, url, prompt, created_at FROM video_generations WHERE user_id=$1 ORDER BY created_at DESC LIMIT 200",
      [String(userId)]
    );
    res.json(result.rows.map(row => ({ id: row.id, url: row.url, prompt: row.prompt, createdAt: row.created_at ? new Date(row.created_at).getTime() : null })));
  } catch (e) { console.error(e.message); res.status(500).json({ error: "Failed to load gallery" }); }
});

app.delete("/api/gallery", async (req, res) => {
  const { userId, id } = req.body || {};
  if (!userId || !id) return res.status(400).json({ error: "Missing userId or id" });
  try {
    const result = await pool.query("DELETE FROM video_generations WHERE id=$1 AND user_id=$2", [id, String(userId)]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Not found" });
    res.status(204).send();
  } catch (e) { res.status(500).json({ error: "Failed to delete" }); }
});

const initFavoritesTable = async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS favorite_prompts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id TEXT NOT NULL, prompt TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'photo', created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_id, prompt, type))`);
    await pool.query(`ALTER TABLE favorite_prompts ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'photo'`);
  } catch (e) { console.error(e.message); }
};

app.get("/api/favorites", async (req, res) => {
  const userId = req.query.userId;
  const type = req.query.type || "video";
  if (!userId) return res.json([]);
  try {
    const r = await pool.query("SELECT prompt FROM favorite_prompts WHERE user_id=$1 AND type=$2 ORDER BY created_at DESC", [String(userId), type]);
    res.json(r.rows.map(r => r.prompt));
  } catch (e) { res.status(500).json({ error: "Failed" }); }
});
app.post("/api/favorites", async (req, res) => {
  const { userId, prompt, type } = req.body || {};
  const promptType = type || "video";
  if (!userId || !prompt) return res.status(400).json({ error: "Missing" });
  try {
    await pool.query("INSERT INTO favorite_prompts (user_id, prompt, type) VALUES ($1,$2,$3) ON CONFLICT (user_id, prompt, type) DO NOTHING", [String(userId), String(prompt).trim(), promptType]);
    const r = await pool.query("SELECT prompt FROM favorite_prompts WHERE user_id=$1 AND type=$2 ORDER BY created_at DESC", [String(userId), promptType]);
    res.json(r.rows.map(r => r.prompt));
  } catch (e) { res.status(500).json({ error: "Failed" }); }
});
app.delete("/api/favorites", async (req, res) => {
  const { userId, prompt, type } = req.body || {};
  const promptType = type || "video";
  if (!userId) return res.status(400).json({ error: "Missing userId" });
  try {
    await pool.query("DELETE FROM favorite_prompts WHERE user_id=$1 AND prompt=$2 AND type=$3", [String(userId), String(prompt || ""), promptType]);
    const r = await pool.query("SELECT prompt FROM favorite_prompts WHERE user_id=$1 AND type=$2 ORDER BY created_at DESC", [String(userId), promptType]);
    res.json(r.rows.map(r => r.prompt));
  } catch (e) { res.status(500).json({ error: "Failed" }); }
});

const initUserCreditsTable = async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS user_credits (user_id TEXT PRIMARY KEY, credits BIGINT NOT NULL DEFAULT 0)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS star_payments (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id TEXT NOT NULL, telegram_payment_charge_id TEXT NOT NULL, credits_added BIGINT NOT NULL, payload TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
  } catch (e) { console.error(e.message); }
};

const initGenerationsTable = async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS video_generations (id UUID PRIMARY KEY, user_id TEXT NOT NULL, url TEXT NOT NULL, prompt TEXT, model TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
  } catch (e) { console.error(e.message); }
};

const INITIAL_CREDITS = 100;
const ensureUserCredits = async (userId) => {
  if (!userId) return;
  try { await pool.query("INSERT INTO user_credits (user_id, credits) VALUES ($1,$2) ON CONFLICT (user_id) DO NOTHING", [String(userId), INITIAL_CREDITS]); }
  catch (e) { console.error(e.message); }
};

const getUserCredits = async (userId) => {
  if (!userId) return 0;
  await ensureUserCredits(userId);
  const r = await pool.query("SELECT credits FROM user_credits WHERE user_id=$1", [String(userId)]);
  return r.rows.length ? Number(r.rows[0].credits) : INITIAL_CREDITS;
};

const tryDeductUserCredits = async (userId, amount) => {
  if (!userId) return { ok: true, credits: undefined };
  await ensureUserCredits(userId);
  const upd = await pool.query(
    "UPDATE user_credits SET credits = credits - $2 WHERE user_id=$1 AND credits >= $2 RETURNING credits",
    [String(userId), amount]
  );
  if (upd.rowCount === 0) return { ok: false, credits: await getUserCredits(userId) };
  return { ok: true, credits: Number(upd.rows[0].credits) };
};

app.get("/api/credits", async (req, res) => {
  if (!req.query.userId) return res.json({ credits: 0 });
  try {
    res.json({ credits: await getUserCredits(req.query.userId) });
  } catch (e) { res.status(500).json({ error: "Failed" }); }
});

const STAR_PACKS = [
  { id: "25",  stars: 25,  credits: 50,  title: "50 монет",           description: "25 Stars — 50 монет",           priceRub: 49  },
  { id: "50",  stars: 50,  credits: 100, title: "100 монет",          description: "50 Stars — 100 монет",          priceRub: 95  },
  { id: "100", stars: 100, credits: 210, title: "200 монет +10 бонус", description: "100 Stars — 200 монет +10 бонус", priceRub: 179 },
  { id: "250", stars: 250, credits: 530, title: "500 монет +30 бонус", description: "250 Stars — 500 монет +30 бонус", priceRub: 429 },
];
const DEFAULT_PACK = STAR_PACKS[0];

app.get("/api/packs", (_req, res) => res.json(STAR_PACKS));

app.post("/api/invoice-link", async (req, res) => {
  const token = process.env.TELEGRAM_BOT_TOKEN || process.env.telegram_bot_token || process.env.BOT_TOKEN;
  if (!token) return res.status(503).json({ error: "Payments not configured" });
  const userId = req.body?.userId != null ? String(req.body.userId) : "";
  const pack = STAR_PACKS.find(p => p.id === String(req.body?.pack || "")) || DEFAULT_PACK;
  if (!userId) return res.status(400).json({ error: "Missing userId" });
  const payload = JSON.stringify({ userId, pack: pack.id });
  if (Buffer.byteLength(payload, "utf8") > 128) return res.status(400).json({ error: "Payload too long" });
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/createInvoiceLink`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: pack.title, description: pack.description, payload, currency: "XTR", prices: [{ label: pack.description, amount: pack.stars }] }),
    });
    const data = await r.json();
    if (!data.ok || !data.result) return res.status(502).json({ error: "Failed", description: data.description });
    res.json({ invoiceUrl: data.result });
  } catch (e) { res.status(502).json({ error: "Failed", message: e.message }); }
});

app.post("/webhook/telegram", (req, res) => {
  const update = req.body;
  if (!update || typeof update !== "object") return res.status(200).send();
  const token = process.env.TELEGRAM_BOT_TOKEN || process.env.telegram_bot_token || process.env.BOT_TOKEN;
  if (!token) return res.status(200).send();
  const baseUrl = "https://api.telegram.org/bot" + token;

  // URLs for Mini Apps shown on /start.
  // Keep compatibility with both old and new env var names.
  const videoAppUrl = (process.env.APP_VIDEO_URL || process.env.BASE_URL || "").replace(/\/$/, "");
  const imageAppUrl = (process.env.APP_IMAGE_URL || process.env.APP2_URL || "").replace(/\/$/, "");
  const profileAppUrl = (process.env.APP_PROFILE_URL || process.env.APP3_URL || "").replace(/\/$/, "");

  (async () => {
    // ——— /start: send app launcher buttons ———
    if (update.message?.text === "/start") {
      const chatId = update.message.chat.id;

      // Build inline keyboard rows
      const rows = [];
      if (videoAppUrl) {
        rows.push([{ text: "🎬 AI Видео", web_app: { url: videoAppUrl } }]);
      }
      if (imageAppUrl) {
        rows.push([{ text: "🖼 AI Фото", web_app: { url: imageAppUrl } }]);
      }
      if (profileAppUrl) {
        rows.push([{ text: "👤 Профиль", web_app: { url: profileAppUrl } }]);
      }

      const body = {
        chat_id: chatId,
        text: "Выберите приложение:",
        reply_markup: rows.length
          ? { inline_keyboard: rows }
          : undefined,
      };

      await fetch(baseUrl + "/sendMessage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    // ——— Payments ———
    if (update.pre_checkout_query) {
      await fetch(baseUrl + "/answerPreCheckoutQuery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pre_checkout_query_id: update.pre_checkout_query.id, ok: true }) });
    }
    if (update.message?.successful_payment) {
      const sp = update.message.successful_payment;
      let userId, packId;
      try { const p = JSON.parse(sp.invoice_payload || "{}"); userId = p.userId; packId = p.pack; } catch { return; }
      if (!userId) return;
      const pack = STAR_PACKS.find(p => p.id === packId) || DEFAULT_PACK;
      await initUserCreditsTable();
      await pool.query("INSERT INTO user_credits (user_id, credits) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET credits = user_credits.credits + $2", [String(userId), pack.credits]);
      await pool.query("INSERT INTO star_payments (user_id, telegram_payment_charge_id, credits_added, payload) VALUES ($1,$2,$3,$4)", [String(userId), sp.telegram_payment_charge_id || "", pack.credits, sp.invoice_payload || ""]);
    }
  })().then(() => res.status(200).send(), () => res.status(200).send());
});

async function handleGenerate(req, res) {
  const apiKey = process.env.KIE_API_KEY || process.env.NANO_BANANA_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "Backend not configured: KIE_API_KEY" });

  const body = req.body || {};
  const modelKey     = String(body.model || "kling-img2vid");
  const prompt       = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const userId       = body.userId !== undefined ? body.userId : "";
  const duration     = String(body.duration     || "5");
  const sound        = body.sound === "true" || body.sound === true;
  const motionMode   = String(body.motionMode   || "720p");
  const orientation  = String(body.orientation  || "video");
  const videoQuality = String(body.videoQuality || "std");
  const videoAspect  = String(body.videoAspect  || "16:9");

  let imageIds = [], videoIds = [];
  if (req.files) {
    for (const f of (req.files.images  || []).slice(0, 4)) { const id = uuidv4(); mediaStore.set(id, { buffer: f.buffer, mimeType: f.mimetype }); imageIds.push(id); }
    for (const f of (req.files.refvideo || []).slice(0, 1)) { const id = uuidv4(); mediaStore.set(id, { buffer: f.buffer, mimeType: f.mimetype }); videoIds.push(id); }
  }

  if (modelKey === "kling-img2vid"  && !prompt)            return res.status(400).json({ error: "Промпт обязателен" });
  if (modelKey === "kling-img2vid"  && imageIds.length === 0) return res.status(400).json({ error: "Загрузите опорное изображение" });
  if (modelKey === "kling-motion"   && imageIds.length === 0) return res.status(400).json({ error: "Загрузите опорное изображение" });
  if (modelKey === "kling-motion"   && videoIds.length === 0) return res.status(400).json({ error: "Загрузите референс видео" });
  if (modelKey === "kling-video"    && !prompt && imageIds.length === 0) return res.status(400).json({ error: "Введите промпт или загрузите изображение" });

  const calcImgVidCost = (dur, snd) => dur === "10" ? (snd ? 176 : 88) : (snd ? 88 : 44);
  const calcMotionCost = (mode, dur) => mode === "1080p" ? (dur === "10" ? 72 : 36) : (dur === "10" ? 72 : 36);
  const calcKling3Cost = (qual, snd, dur) => {
    const is1080p = qual === "pro";
    if (is1080p) return snd ? (dur === "10" ? 319 : 160) : (dur === "10" ? 216 : 107);
    return snd ? (dur === "10" ? 239 : 120) : (dur === "10" ? 160 : 80);
  };
  let tokensSpent = modelKey === "kling-img2vid"
    ? calcImgVidCost(duration, sound)
    : modelKey === "kling-motion"
    ? calcMotionCost(motionMode, duration)
    : calcKling3Cost(videoQuality, sound, duration);

  if (userId !== undefined && userId !== null && String(userId) !== "") {
    const uid = String(userId);
    try {
      const currentCredits = await getUserCredits(uid);
      if (currentCredits < tokensSpent) {
        return res.status(402).json({ error: "INSUFFICIENT_CREDITS", message: "Недостаточно токенов", required: tokensSpent, credits: currentCredits });
      }
    } catch (e) { console.error(e.message); return res.status(500).json({ error: "Failed to validate credits" }); }
  }

  const callBackUrl = `${BASE_URL}/api/callback`;
  const imageUrls = imageIds.map(id => `${BASE_URL}/api/image/${id}`);
  const videoUrls = videoIds.map(id => `${BASE_URL}/api/image/${id}`);

  let payload;
  if (modelKey === "kling-img2vid") {
    payload = { model: "kling-2.6/image-to-video", callBackUrl, input: { prompt, image_urls: imageUrls.slice(0, 1), sound, duration: String(duration) } };
  } else if (modelKey === "kling-motion") {
    const input = { input_urls: imageUrls.slice(0, 1), video_urls: videoUrls.slice(0, 1), character_orientation: orientation, mode: motionMode, duration: String(duration) };
    if (prompt) input.prompt = prompt;
    payload = { model: "kling-2.6/motion-control", callBackUrl, input };
  } else {
    const input = { mode: videoQuality, sound, duration: String(duration), multi_shots: false, aspect_ratio: videoAspect };
    if (prompt) input.prompt = prompt;
    if (imageUrls.length > 0) input.image_urls = imageUrls.slice(0, 2);
    payload = { model: "kling-3.0/video", callBackUrl, input };
  }

  try {
    const r = await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(payload),
    });
    const data = await r.json();
    if (data?.code !== 200 || !data?.data?.taskId) {
      console.error("KIE error:", data?.code, data?.message || data?.msg);
      return res.status(502).json({ error: "KIE API error", message: data?.message || data?.msg || "No taskId", code: data?.code });
    }
    const taskId = data.data.taskId;
    taskMeta.set(taskId, { userId, prompt, createdAt: Date.now(), modelKey, tokensSpent });
    res.status(200).json({ taskId });
  } catch (e) { res.status(502).json({ error: "Failed to call KIE API", message: e.message }); }
}

app.post("/api/generate",
  (req, res, next) => { if (req.is("application/json")) return handleGenerate(req, res).catch(next); next(); },
  upload.fields([{ name: "images", maxCount: 4 }, { name: "refvideo", maxCount: 1 }]),
  (req, res, next) => handleGenerate(req, res).catch(next)
);

(async () => {
  await initFavoritesTable();
  await initUserCreditsTable();
  await initGenerationsTable();
  app.listen(PORT, () => {
    console.log(`Server running at ${BASE_URL || "http://localhost:" + PORT}`);
    const token = process.env.TELEGRAM_BOT_TOKEN || process.env.telegram_bot_token || process.env.BOT_TOKEN;
    const baseUrl = process.env.BASE_URL;
    if (token && baseUrl?.startsWith("https://")) {
      fetch(`https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(baseUrl.replace(/\/$/, "") + "/webhook/telegram")}`)
        .then(r => r.json()).then(d => d.ok ? console.log("Telegram webhook set") : console.warn("setWebhook:", d.description))
        .catch(e => console.warn("setWebhook failed:", e.message));
    }
  });
})();
