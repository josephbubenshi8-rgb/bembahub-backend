import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { GoogleGenAI } from "@google/genai";

import * as db from "./db.js";
import { signToken, requireAuth, requireRole, optionalAuth, publicUser } from "./auth.js";
import { sendPasswordResetEmail } from "./mailer.js";
import { LANGUAGES, LANG_CODES, isValidLang } from "./db.js";

dotenv.config();

const app = express();

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim());
app.use(cors({ origin: allowedOrigins.includes("*") ? true : allowedOrigins }));
app.use(express.json({ limit: "12mb" }));

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const FRONTEND_URL = process.env.FRONTEND_URL || "https://bemba-hub-jfk5.onrender.com";

function asyncRoute(fn) {
  return (req, res) => fn(req, res).catch((err) => {
    console.error(err);
    res.status(500).json({ error: "Server unavailable. Please try again shortly." });
  });
}

// Minimal in-memory rate limiter for contribution-style endpoints (report,
// suggest). Resets on restart and is per-instance only — acceptable for a
// single Render web service; note this in docs if you ever scale to >1
// instance, since it would need a shared store (e.g. Redis) at that point.
const rateBuckets = new Map();
function rateLimit(key, max, windowMs) {
  return (req, res, next) => {
    const id = `${key}:${req.user ? req.user.id : req.ip}`;
    const now = Date.now();
    const bucket = (rateBuckets.get(id) || []).filter((t) => now - t < windowMs);
    if (bucket.length >= max) return res.status(429).json({ error: "Too many requests. Please slow down and try again shortly." });
    bucket.push(now);
    rateBuckets.set(id, bucket);
    next();
  };
}

/* ══════════════════════════════════════════
   HEALTH
══════════════════════════════════════════ */
app.get("/", (req, res) => res.json({ status: "BembaHub Backend is running!" }));

/* ══════════════════════════════════════════
   AUTH
══════════════════════════════════════════ */
app.post("/auth/register", asyncRoute(async (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: "name, email and password are required." });
  if (await db.getUserByEmail(email)) return res.status(409).json({ error: "Email already registered." });
  const allowedRoles = ["visitor", "translator"];
  const finalRole = allowedRoles.includes(role) ? role : "visitor";
  const passHash = bcrypt.hashSync(password, 10);
  const user = await db.createUser({ name, email, passHash, role: finalRole });
  await db.logActivity(`${user.name} registered as ${user.role}`, "gold");
  await db.createNotification(user.id, `Welcome to BembaHub, ${user.name}! Start by browsing the dictionary or trying a translation.`, "info");
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
}));

app.post("/auth/login", asyncRoute(async (req, res) => {
  const { email, password } = req.body || {};
  const user = await db.getUserByEmail(email || "");
  if (!user || !user.pass_hash || !bcrypt.compareSync(password || "", user.pass_hash)) {
    return res.status(401).json({ error: "Invalid email or password." });
  }
  if (user.status === "suspended") return res.status(403).json({ error: "Account suspended. Contact admin." });
  await db.logActivity(`${user.name} signed in`, "green");
  res.json({ token: signToken(user), user: publicUser(user) });
}));

app.post("/auth/guest", asyncRoute(async (req, res) => {
  const guest = await db.getOrCreateGuestUser();
  res.json({ token: signToken(guest), user: publicUser(guest) });
}));

app.get("/auth/me", requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

app.put("/auth/me", requireAuth, asyncRoute(async (req, res) => {
  const { name, email } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: "name and email are required." });
  const user = await db.updateUserProfile(req.user.id, { name, email });
  res.json({ user: publicUser(user) });
}));

app.put("/auth/theme", requireAuth, asyncRoute(async (req, res) => {
  const { theme } = req.body || {};
  if (!["light", "dark"].includes(theme)) return res.status(400).json({ error: "theme must be 'light' or 'dark'." });
  const user = await db.updateUserTheme(req.user.id, theme);
  res.json({ user: publicUser(user) });
}));

app.put("/auth/password", requireAuth, asyncRoute(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: "New password must be at least 6 characters." });
  if (req.user.pass_hash && !bcrypt.compareSync(currentPassword || "", req.user.pass_hash)) {
    return res.status(401).json({ error: "Current password is incorrect." });
  }
  await db.updateUserPassword(req.user.id, bcrypt.hashSync(newPassword, 10));
  res.json({ success: true });
}));

app.post("/auth/forgot-password", asyncRoute(async (req, res) => {
  const { email } = req.body || {};
  const user = email ? await db.getUserByEmail(email) : null;
  if (user) {
    const token = await db.createPasswordReset(user.id);
    const resetUrl = `${FRONTEND_URL}/?resetToken=${token}`;
    const result = await sendPasswordResetEmail(user.email, resetUrl);
    if (!result.delivered && process.env.NODE_ENV !== "production") {
      return res.json({ success: true, devLink: result.devLink });
    }
  }
  res.json({ success: true, message: "If that email is registered, a reset link has been sent." });
}));

app.post("/auth/reset-password", asyncRoute(async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: "A valid token and a password of at least 6 characters are required." });
  }
  const reset = await db.consumePasswordReset(token);
  if (!reset) return res.status(400).json({ error: "This reset link is invalid or has expired." });
  await db.updateUserPassword(reset.user_id, bcrypt.hashSync(newPassword, 10));
  res.json({ success: true });
}));

/* ══════════════════════════════════════════
   TRANSLATE — supports all 8 languages (English + 7 Zambian languages).
   Backward compatible with the original {text, direction:'en-bm'|'bm-en'}
   shape; new callers should send {text, sourceLang, targetLang}.
══════════════════════════════════════════ */
async function aiTranslate(text, srcLang, tgtLang) {
  const srcName = LANGUAGES[srcLang], tgtName = LANGUAGES[tgtLang];
  const prompt = `Translate the following ${srcName} text into natural ${tgtName}. Return only the translation, nothing else:\n\n${text}`;
  const response = await ai.models.generateContent({ model: "gemini-flash-latest", contents: prompt });
  return (response.text || "").trim();
}

app.post("/translate", optionalAuth, asyncRoute(async (req, res) => {
  const { text, direction } = req.body || {};
  let { sourceLang, targetLang } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: "text is required." });

  if (!sourceLang || !targetLang) { // legacy 'direction' param
    if (direction === "en-bm") { sourceLang = "eng"; targetLang = "bem"; }
    else { sourceLang = "bem"; targetLang = "eng"; }
  }
  if (!isValidLang(sourceLang) || !isValidLang(targetLang)) {
    return res.status(400).json({ error: `Unsupported language. Supported codes: ${LANG_CODES.join(", ")}` });
  }
  if (sourceLang === targetLang) return res.status(400).json({ error: "Source and target language must be different." });

  const hit = await db.findWordMatch(text, sourceLang, targetLang);
  if (hit) {
    db.recordTranslationUsage({ en: text.trim(), bm: hit.translation.trim(), sourceLang, targetLang, source: hit.source, userId: req.user ? req.user.id : null })
      .catch((e) => console.error("[dictionary-save]", e));
    return res.json(hit);
  }

  // Neither side is English: pivot through English rather than risk an
  // unreliable single-hop cross-language prompt (spec #2).
  const viaEnglish = sourceLang !== "eng" && targetLang !== "eng";
  try {
    let translation;
    if (!viaEnglish) {
      translation = await aiTranslate(text, sourceLang, targetLang);
    } else {
      const toEnglish = await aiTranslate(text, sourceLang, "eng");
      translation = toEnglish ? await aiTranslate(toEnglish, "eng", targetLang) : "";
    }
    if (!translation) return res.status(404).json({ error: "Word not found." });
    db.recordTranslationUsage({ en: text.trim(), bm: translation, sourceLang, targetLang, source: "ai", userId: req.user ? req.user.id : null })
      .catch((e) => console.error("[dictionary-save]", e));
    res.json({
      translation, source: "ai",
      label: viaEnglish
        ? "AI Translation (via English) — experimental for this language pair, verify carefully."
        : "AI Translation — verify accuracy. You can suggest a correction below.",
    });
  } catch (e) {
    console.error(e);
    // Never save anything, never claim success — spec #14.
    res.status(503).json({ error: "Translation service temporarily unavailable. Please try again shortly." });
  }
}));

/* ══════════════════════════════════════════
   OCR
══════════════════════════════════════════ */
app.post("/ocr", asyncRoute(async (req, res) => {
  const { imageBase64, mimeType } = req.body || {};
  if (!imageBase64) return res.status(400).json({ error: "imageBase64 is required." });
  try {
    const response = await ai.models.generateContent({
      model: "gemini-flash-latest",
      contents: [{
        role: "user",
        parts: [
          { text: "You are an OCR specialist. Extract ALL visible text from this image exactly as it appears. If no text is visible, respond with: NO_TEXT_FOUND\nReturn ONLY the text — no commentary." },
          { inlineData: { mimeType: mimeType || "image/jpeg", data: imageBase64 } },
        ],
      }],
    });
    const text = (response.text || "").trim();
    res.json({ text: text || "NO_TEXT_FOUND" });
  } catch (e) {
    console.error(e);
    res.status(503).json({ error: "Translation service temporarily unavailable. Please try again shortly." });
  }
}));

/* ══════════════════════════════════════════
   AI CHAT ASSISTANT (with persisted history)
══════════════════════════════════════════ */
app.get("/chat/history", requireAuth, asyncRoute(async (req, res) => {
  res.json({ messages: await db.listChatMessages(req.user.id) });
}));

app.post("/chat", requireAuth, asyncRoute(async (req, res) => {
  const { message } = req.body || {};
  if (!message) return res.status(400).json({ error: "message is required." });

  const past = await db.listChatMessages(req.user.id);
  const contents = [
    { role: "user", parts: [{ text: "You are the BembaHub AI assistant. Help with English-Bemba translation, grammar explanations, and vocabulary questions. Be concise and friendly." }] },
    { role: "model", parts: [{ text: "Understood — I'm ready to help with Bemba translation and grammar." }] },
    ...past.slice(-20).map((h) => ({ role: h.role === "assistant" ? "model" : "user", parts: [{ text: h.text }] })),
    { role: "user", parts: [{ text: message }] },
  ];

  await db.saveChatMessage(req.user.id, "user", message);
  try {
    const response = await ai.models.generateContent({ model: "gemini-flash-latest", contents });
    const reply = response.text || "Sorry, I couldn't generate a response.";
    await db.saveChatMessage(req.user.id, "assistant", reply);
    res.json({ reply });
  } catch (e) {
    console.error(e);
    res.status(503).json({ error: "Translation unavailable. Please try again shortly." });
  }
}));

app.delete("/chat/history", requireAuth, asyncRoute(async (req, res) => {
  await db.clearChatMessages(req.user.id);
  res.json({ cleared: true });
}));

/* ══════════════════════════════════════════
   DICTIONARY  (public) — 8 languages: English + 7 Zambian languages
══════════════════════════════════════════ */
app.get("/languages", (req, res) => res.json({ languages: LANGUAGES }));

app.get("/dictionary", asyncRoute(async (req, res) => {
  const { q, cat, sourceLang, targetLang } = req.query;
  if (q && q.trim().length >= 2) db.logSearch(q.trim()).catch((e) => console.error("[search-log]", e));
  const [words, categories] = await Promise.all([db.searchWords(q, sourceLang, targetLang, cat), db.getCategories()]);
  res.json({ words, categories, languages: LANGUAGES });
}));

// Same as GET /dictionary — a dedicated path per the API spec, for
// autocomplete/search-focused callers. Shares the exact same logic.
app.get("/dictionary/search", asyncRoute(async (req, res) => {
  const { q, sourceLang, targetLang } = req.query;
  if (q && q.trim().length >= 2) db.logSearch(q.trim()).catch((e) => console.error("[search-log]", e));
  const words = await db.searchWords(q, sourceLang, targetLang, null);
  res.json({ words });
}));

app.get("/dictionary/stats", requireAuth, requireRole("admin", "moderator"), asyncRoute(async (req, res) => {
  res.json(await db.dictionaryStats());
}));

app.get("/dictionary/word-of-day", asyncRoute(async (req, res) => {
  const word = await db.wordOfDay(req.query.targetLang);
  if (!word) return res.status(404).json({ error: "Word not found." });
  res.json({ word });
}));

// Explicit manual-record endpoint per API spec. In normal operation
// /translate already records automatically (spec #21) — this exists for
// completeness and for any future caller that translates outside that route
// (still requires auth so it can't be used to spam the dictionary anonymously).
app.post("/dictionary/record-translation", requireAuth, rateLimit("record", 60, 60_000), asyncRoute(async (req, res) => {
  const { sourceText, translatedText, sourceLang, targetLang, source } = req.body || {};
  if (!isValidLang(sourceLang) || !isValidLang(targetLang)) return res.status(400).json({ error: "Invalid source/target language." });
  const word = await db.recordTranslationUsage({ en: sourceText, bm: translatedText, sourceLang, targetLang, source: source || "user_contribution", userId: req.user.id });
  if (!word) return res.status(400).json({ error: "Nothing valid to record." });
  res.status(201).json({ word });
}));

app.post("/dictionary/report", requireAuth, rateLimit("report", 20, 60 * 60_000), asyncRoute(async (req, res) => {
  const { wordId, reason } = req.body || {};
  const allowed = ["incorrect", "wrong_language", "spelling", "offensive", "duplicate", "other"];
  if (!wordId || !allowed.includes(reason)) return res.status(400).json({ error: "wordId and a valid reason are required." });
  const word = await db.getWordById(Number(wordId));
  if (!word) return res.status(404).json({ error: "Word not found." });
  const report = await db.createReport(word.id, req.user.id, reason);
  await db.logActivity(`"${word.en}" reported (${reason}) by ${req.user.name}`, "red");
  res.status(201).json({ report });
}));

app.post("/dictionary/suggest", requireAuth, rateLimit("suggest", 30, 60 * 60_000), asyncRoute(async (req, res) => {
  const { en, bm, cat, pos, pron, ex, definition, synonyms, antonyms, sourceLang, targetLang } = req.body || {};
  if (!en || !bm) return res.status(400).json({ error: "en and bm are required." });
  const srcLang = isValidLang(sourceLang) ? sourceLang : "eng";
  const tgtLang = isValidLang(targetLang) ? targetLang : "bem";
  const entry = await db.createPending({
    type: "word", en, bm, cat, pos, pron, ex, definition, sourceLang: srcLang, targetLang: tgtLang,
    synonyms: Array.isArray(synonyms) ? synonyms : [], antonyms: Array.isArray(antonyms) ? antonyms : [],
    by_name: req.user.name, by_id: req.user.id,
  });
  const user = await db.addUserPoints(req.user.id, 2);
  await db.logActivity(`"${en}" submitted by ${req.user.name}`, "gold");
  res.status(201).json({ entry, user: publicUser(user) });
}));

app.post("/dictionary/correct", requireAuth, rateLimit("correct", 30, 60 * 60_000), asyncRoute(async (req, res) => {
  const { wordId, suggested, reason } = req.body || {};
  const original = await db.getWordById(Number(wordId));
  if (!original) return res.status(404).json({ error: "Word not found." });
  const entry = await db.createPending({
    type: "correction", en: original.en, original: original.bm, suggested, reason, cat: original.cat,
    sourceLang: original.source_lang, targetLang: original.target_lang,
    by_name: req.user.name, by_id: req.user.id,
  });
  await db.logActivity(`Correction for "${original.en}" submitted by ${req.user.name}`, "gold");
  res.status(201).json({ entry });
}));

app.get("/dictionary/mine", requireAuth, asyncRoute(async (req, res) => {
  res.json({ entries: await db.listPendingByUser(req.user.id) });
}));

app.get("/dictionary/pending", requireAuth, requireRole("admin", "moderator"), asyncRoute(async (req, res) => {
  res.json({ entries: await db.listPending() });
}));

app.post("/dictionary/pending/:id/review", requireAuth, requireRole("admin", "moderator"), asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  if (!["approved", "rejected"].includes(status)) return res.status(400).json({ error: "status must be approved or rejected." });
  const entry = await db.getPendingById(id);
  if (!entry) return res.status(404).json({ error: "Pending entry not found." });
  await db.setPendingStatus(id, status);

  if (status === "approved") {
    if (entry.type === "word") {
      await db.insertApprovedWord({
        en: entry.en, bm: entry.bm, cat: entry.cat, pos: entry.pos, pron: entry.pron, ex: entry.ex,
        definition: entry.definition, synonyms: entry.synonyms, antonyms: entry.antonyms, contrib: entry.by_name,
        sourceLang: entry.source_lang, targetLang: entry.target_lang,
      });
    } else if (entry.type === "correction") {
      await db.updateWordTranslation(entry.en, entry.suggested, entry.source_lang, entry.target_lang);
    }
    await db.addUserPoints(entry.by_id, entry.type === "correction" ? 5 : 10);
    await db.logActivity(`"${entry.en}" approved by ${req.user.name}`, "green");
    await db.createNotification(entry.by_id, `Your submission "${entry.en}" was approved! +${entry.type === "correction" ? 5 : 10} pts`, "success");
  } else {
    await db.logActivity(`"${entry.en}" rejected by ${req.user.name}`, "red");
    await db.createNotification(entry.by_id, `Your submission "${entry.en}" was not approved.`, "warning");
  }
  res.json({ entry: await db.getPendingById(id) });
}));

/* ── /dictionary/candidates — kept for backward compatibility with the
   previous (single-language) admin panel. Equivalent to /admin/dictionary/*
   below; both share the same db functions. New frontend code uses the
   /admin/dictionary/* namespace per the current API spec. ── */
app.get("/dictionary/candidates", requireAuth, requireRole("admin"), asyncRoute(async (req, res) => {
  const { status, q, sourceLang, targetLang, sort } = req.query;
  res.json({ entries: await db.listDictionaryCandidates({ status, q, sourceLang, targetLang, sort }) });
}));
app.post("/dictionary/candidates/:id/verify", requireAuth, requireRole("admin"), asyncRoute(async (req, res) => {
  const word = await db.setWordStatus(Number(req.params.id), "verified");
  if (!word) return res.status(404).json({ error: "Word not found." });
  await db.logActivity(`"${word.en}" verified by ${req.user.name}`, "green");
  res.json({ word });
}));
app.post("/dictionary/candidates/:id/reject", requireAuth, requireRole("admin"), asyncRoute(async (req, res) => {
  const word = await db.setWordStatus(Number(req.params.id), "rejected");
  if (!word) return res.status(404).json({ error: "Word not found." });
  await db.logActivity(`"${word.en}" rejected by ${req.user.name}`, "red");
  res.json({ word });
}));
app.put("/dictionary/candidates/:id", requireAuth, requireRole("admin"), asyncRoute(async (req, res) => {
  const { en, bm, cat, pos, pron, ex, definition, synonyms, antonyms, sourceLang, targetLang } = req.body || {};
  if (!en || !bm) return res.status(400).json({ error: "en and bm are required." });
  const word = await db.updateWordFull(Number(req.params.id), {
    en, bm, cat, pos, pron, ex, definition, sourceLang, targetLang,
    synonyms: Array.isArray(synonyms) ? synonyms : [], antonyms: Array.isArray(antonyms) ? antonyms : [],
  });
  if (!word) return res.status(404).json({ error: "Word not found." });
  res.json({ word });
}));
app.delete("/dictionary/candidates/:id", requireAuth, requireRole("admin"), asyncRoute(async (req, res) => {
  const ok = await db.deleteWord(Number(req.params.id));
  if (!ok) return res.status(404).json({ error: "Word not found." });
  res.json({ deleted: true });
}));

/* ══════════════════════════════════════════
   ADMIN DICTIONARY NAMESPACE — the primary admin dictionary-management API.
   Same underlying logic as /dictionary/candidates above.
══════════════════════════════════════════ */
app.get("/admin/dictionary", requireAuth, requireRole("admin"), asyncRoute(async (req, res) => {
  const { status, q, sourceLang, targetLang, sort } = req.query;
  res.json({ entries: await db.listDictionaryCandidates({ status, q, sourceLang, targetLang, sort }) });
}));
app.get("/admin/dictionary/candidates", requireAuth, requireRole("admin"), asyncRoute(async (req, res) => {
  const { status, q, sourceLang, targetLang, sort } = req.query;
  res.json({ entries: await db.listDictionaryCandidates({ status: status || "unverified", q, sourceLang, targetLang, sort }) });
}));
app.post("/admin/dictionary/:id/verify", requireAuth, requireRole("admin"), asyncRoute(async (req, res) => {
  const word = await db.setWordStatus(Number(req.params.id), "verified");
  if (!word) return res.status(404).json({ error: "Word not found." });
  await db.logActivity(`"${word.en}" verified by ${req.user.name}`, "green");
  res.json({ word });
}));
app.post("/admin/dictionary/:id/reject", requireAuth, requireRole("admin"), asyncRoute(async (req, res) => {
  const word = await db.setWordStatus(Number(req.params.id), "rejected");
  if (!word) return res.status(404).json({ error: "Word not found." });
  await db.logActivity(`"${word.en}" rejected by ${req.user.name}`, "red");
  res.json({ word });
}));
app.post("/admin/dictionary/:id/high-confidence", requireAuth, requireRole("admin"), asyncRoute(async (req, res) => {
  const { rows } = await db.pool.query("UPDATE words SET high_confidence=true, updated_at=now() WHERE id=$1 RETURNING *", [Number(req.params.id)]);
  if (!rows[0]) return res.status(404).json({ error: "Word not found." });
  res.json({ word: rows[0] });
}));
app.post("/admin/dictionary/:id/reset-confidence", requireAuth, requireRole("admin"), asyncRoute(async (req, res) => {
  const word = await db.resetConfidence(Number(req.params.id));
  if (!word) return res.status(404).json({ error: "Word not found." });
  res.json({ word });
}));
app.get("/admin/dictionary/:id/reports", requireAuth, requireRole("admin"), asyncRoute(async (req, res) => {
  res.json({ reports: await db.listReportsForWord(Number(req.params.id)) });
}));
app.post("/admin/dictionary/reports/:id/reviewed", requireAuth, requireRole("admin"), asyncRoute(async (req, res) => {
  const report = await db.markReportReviewed(Number(req.params.id));
  if (!report) return res.status(404).json({ error: "Report not found." });
  await db.recalcConfidence(report.word_id);
  res.json({ report });
}));
app.put("/admin/dictionary/:id", requireAuth, requireRole("admin"), asyncRoute(async (req, res) => {
  const { en, bm, cat, pos, pron, ex, definition, synonyms, antonyms, sourceLang, targetLang } = req.body || {};
  if (!en || !bm) return res.status(400).json({ error: "en and bm are required." });
  const word = await db.updateWordFull(Number(req.params.id), {
    en, bm, cat, pos, pron, ex, definition, sourceLang, targetLang,
    synonyms: Array.isArray(synonyms) ? synonyms : [], antonyms: Array.isArray(antonyms) ? antonyms : [],
  });
  if (!word) return res.status(404).json({ error: "Word not found." });
  res.json({ word });
}));
app.delete("/admin/dictionary/:id", requireAuth, requireRole("admin"), asyncRoute(async (req, res) => {
  const ok = await db.deleteWord(Number(req.params.id));
  if (!ok) return res.status(404).json({ error: "Word not found." });
  res.json({ deleted: true });
}));

// MUST be the last /dictionary/* route registered — otherwise it would
// shadow every literal path above (e.g. /dictionary/search, /dictionary/mine).
app.get("/dictionary/:id", asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(404).json({ error: "Word not found." });
  const word = await db.getWordById(id);
  if (!word || word.status !== "verified") return res.status(404).json({ error: "Word not found." });
  res.json({ word });
}));

/* ══════════════════════════════════════════
   FAVORITES
══════════════════════════════════════════ */
app.get("/favorites", requireAuth, asyncRoute(async (req, res) => {
  res.json({ favorites: await db.listFavorites(req.user.id) });
}));
app.post("/favorites", requireAuth, asyncRoute(async (req, res) => {
  const { wordId } = req.body || {};
  const word = await db.getWordById(Number(wordId));
  if (!word) return res.status(404).json({ error: "Word not found." });
  await db.addFavorite(req.user.id, word.id);
  res.status(201).json({ favorited: true });
}));
app.delete("/favorites/:wordId", requireAuth, asyncRoute(async (req, res) => {
  await db.removeFavorite(req.user.id, Number(req.params.wordId));
  res.json({ favorited: false });
}));

/* ══════════════════════════════════════════
   HISTORY
══════════════════════════════════════════ */
app.get("/history", requireAuth, asyncRoute(async (req, res) => {
  res.json({ entries: await db.listHistory(req.user.id, req.query.kind) });
}));
app.post("/history", requireAuth, asyncRoute(async (req, res) => {
  const { kind, input, output, source } = req.body || {};
  if (!kind || !input || !output) return res.status(400).json({ error: "kind, input and output are required." });
  res.status(201).json({ entry: await db.addHistory(req.user.id, kind, input, output, source) });
}));
app.delete("/history", requireAuth, asyncRoute(async (req, res) => {
  await db.clearHistory(req.user.id, req.query.kind);
  res.json({ cleared: true });
}));

/* ══════════════════════════════════════════
   NOTIFICATIONS
══════════════════════════════════════════ */
app.get("/notifications", requireAuth, asyncRoute(async (req, res) => {
  res.json({ notifications: await db.listNotifications(req.user.id) });
}));
app.post("/notifications/:id/read", requireAuth, asyncRoute(async (req, res) => {
  await db.markNotificationRead(Number(req.params.id), req.user.id);
  res.json({ success: true });
}));
app.post("/notifications/read-all", requireAuth, asyncRoute(async (req, res) => {
  await db.markAllNotificationsRead(req.user.id);
  res.json({ success: true });
}));

/* ══════════════════════════════════════════
   COMMUNITY (Q&A)
══════════════════════════════════════════ */
app.get("/community/posts", asyncRoute(async (req, res) => {
  res.json({ posts: await db.listPosts() });
}));
app.post("/community/posts", requireAuth, asyncRoute(async (req, res) => {
  const { title, body } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: "title and body are required." });
  const post = await db.createPost(req.user.id, title, body);
  await db.logActivity(`${req.user.name} asked: "${title}"`, "sky");
  res.status(201).json({ post });
}));
app.get("/community/posts/:id", asyncRoute(async (req, res) => {
  const post = await db.getPost(Number(req.params.id));
  if (!post) return res.status(404).json({ error: "Post not found." });
  const comments = await db.listComments(post.id);
  res.json({ post, comments });
}));
app.post("/community/posts/:id/comments", requireAuth, asyncRoute(async (req, res) => {
  const { body } = req.body || {};
  if (!body) return res.status(400).json({ error: "body is required." });
  const post = await db.getPost(Number(req.params.id));
  if (!post) return res.status(404).json({ error: "Post not found." });
  const comment = await db.addComment(post.id, req.user.id, body);
  if (post.user_id !== req.user.id) await db.createNotification(post.user_id, `${req.user.name} answered your question: "${post.title}"`, "info");
  res.status(201).json({ comment });
}));
app.post("/community/posts/:id/like", requireAuth, asyncRoute(async (req, res) => {
  const liked = await db.toggleLike(Number(req.params.id), req.user.id);
  res.json({ liked });
}));
app.post("/community/posts/:id/report", requireAuth, asyncRoute(async (req, res) => {
  const { reason } = req.body || {};
  if (!reason) return res.status(400).json({ error: "reason is required." });
  const report = await db.reportPost(Number(req.params.id), req.user.id, reason);
  res.status(201).json({ report });
}));
app.get("/community/reports", requireAuth, requireRole("admin", "moderator"), asyncRoute(async (req, res) => {
  res.json({ reports: await db.listReports() });
}));
app.patch("/community/reports/:id", requireAuth, requireRole("admin", "moderator"), asyncRoute(async (req, res) => {
  const { removePost } = req.body || {};
  const report = await db.resolveReport(Number(req.params.id), !!removePost);
  if (!report) return res.status(404).json({ error: "Report not found." });
  await db.logActivity(`Report #${report.id} resolved by ${req.user.name}${removePost ? " (post removed)" : ""}`, "red");
  res.json({ report });
}));

/* ══════════════════════════════════════════
   QUIZ
══════════════════════════════════════════ */
app.get("/quiz", asyncRoute(async (req, res) => {
  const count = Math.min(Number(req.query.count) || 10, 20);
  let { sourceLang, targetLang, direction } = req.query;
  if (!sourceLang || !targetLang) {
    if (direction === "bm-en") { sourceLang = "bem"; targetLang = "eng"; }
    else { sourceLang = "eng"; targetLang = "bem"; }
  }
  if (!isValidLang(sourceLang) || !isValidLang(targetLang)) {
    return res.status(400).json({ error: `Unsupported language. Supported codes: ${LANG_CODES.join(", ")}` });
  }
  const words = await db.randomWords(Math.max(count, 4), sourceLang, targetLang);
  if (words.length < 4) return res.status(404).json({ error: "Not enough verified words for this language pair yet." });
  const questions = words.slice(0, count).map((w) => {
    const distractors = words.filter((x) => x.id !== w.id).sort(() => Math.random() - 0.5).slice(0, 3).map((x) => x.bm);
    const choices = [...distractors, w.bm].sort(() => Math.random() - 0.5);
    return { wordId: w.id, prompt: w.en, choices };
  });
  res.json({ sourceLang, targetLang, questions });
}));

app.post("/quiz/submit", requireAuth, asyncRoute(async (req, res) => {
  const { answers } = req.body || {}; // answers: [{wordId, chosen}]
  if (!Array.isArray(answers) || !answers.length) return res.status(400).json({ error: "answers array is required." });
  let score = 0;
  const results = [];
  for (const a of answers) {
    const word = await db.getWordById(Number(a.wordId));
    if (!word) continue;
    const isCorrect = (a.chosen || "").trim().toLowerCase() === word.bm.trim().toLowerCase();
    if (isCorrect) score++;
    results.push({ wordId: word.id, correct: isCorrect, correctAnswer: word.bm });
  }
  await db.saveQuizAttempt(req.user.id, score, answers.length);
  await db.addUserPoints(req.user.id, score);
  res.json({ score, total: answers.length, results });
}));

app.get("/quiz/history", requireAuth, asyncRoute(async (req, res) => {
  res.json({ attempts: await db.listQuizAttempts(req.user.id) });
}));

/* ══════════════════════════════════════════
   USERS (admin) + LEADERBOARD + ANALYTICS
══════════════════════════════════════════ */
app.get("/users", requireAuth, requireRole("admin"), asyncRoute(async (req, res) => {
  res.json({ users: (await db.listUsers()).map(publicUser) });
}));
app.patch("/users/:id/status", requireAuth, requireRole("admin"), asyncRoute(async (req, res) => {
  const target = await db.getUserById(Number(req.params.id));
  if (!target) return res.status(404).json({ error: "User not found." });
  const next = target.status === "active" ? "suspended" : "active";
  const user = await db.setUserStatus(target.id, next);
  await db.logActivity(`User "${user.name}" ${user.status} by admin`, "red");
  res.json({ user: publicUser(user) });
}));
app.get("/leaderboard", asyncRoute(async (req, res) => {
  res.json({ leaderboard: (await db.leaderboard()).map(publicUser) });
}));
app.get("/stats/overview", requireAuth, asyncRoute(async (req, res) => {
  res.json(await db.statsOverview());
}));
app.get("/activity", requireAuth, requireRole("admin", "moderator"), asyncRoute(async (req, res) => {
  res.json({ activity: await db.listActivity() });
}));
app.get("/analytics", requireAuth, requireRole("admin"), asyncRoute(async (req, res) => {
  res.json(await db.analyticsSummary());
}));

/* ══════════════════════════════════════════
   404 + STARTUP
══════════════════════════════════════════ */
app.use((req, res) => res.status(404).json({ error: "Not found." }));

const PORT = process.env.PORT || 3000;
db.initSchema()
  .then(() => app.listen(PORT, () => console.log(`Server running on port ${PORT}`)))
  .catch((err) => {
    console.error("Failed to initialize database schema:", err);
    process.exit(1);
  });
