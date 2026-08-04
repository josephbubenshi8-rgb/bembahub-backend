import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { GoogleGenAI } from "@google/genai";

import { db, publicUser, findWordMatch, logActivity } from "./db.js";
import { signToken, requireAuth, requireRole } from "./auth.js";

dotenv.config();

const app = express();

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((s) => s.trim());

app.use(
  cors({
    origin: allowedOrigins.includes("*") ? true : allowedOrigins,
  })
);
app.use(express.json({ limit: "12mb" })); // images come through as base64

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

/* ══════════════════════════════════════════
   HEALTH
══════════════════════════════════════════ */
app.get("/", (req, res) => {
  res.json({ status: "BembaHub Backend is running!" });
});

/* ══════════════════════════════════════════
   AUTH
══════════════════════════════════════════ */
app.post("/auth/register", (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: "name, email and password are required." });
  }
  if (db.users.find((u) => u.email.toLowerCase() === String(email).toLowerCase())) {
    return res.status(409).json({ error: "Email already registered." });
  }
  const allowedRoles = ["visitor", "translator"]; // self-registration can't grant mod/admin
  const finalRole = allowedRoles.includes(role) ? role : "visitor";
  const initials = name.split(" ").map((w) => w[0]).join("").substring(0, 2).toUpperCase();
  const colors = ["#7C3A12", "#1251A3", "#1E5C20", "#4A1299", "#C8793A"];
  const user = {
    id: db.nextUserId++,
    name,
    email,
    passHash: bcrypt.hashSync(password, 10),
    role: finalRole,
    pts: 0,
    status: "active",
    initials,
    color: colors[db.users.length % colors.length],
  };
  db.users.push(user);
  logActivity(`${user.name} registered as ${user.role}`, "gold");
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

app.post("/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  const user = db.users.find((u) => u.email.toLowerCase() === String(email || "").toLowerCase());
  if (!user || !user.passHash || !bcrypt.compareSync(password || "", user.passHash)) {
    return res.status(401).json({ error: "Invalid email or password." });
  }
  if (user.status === "suspended") return res.status(403).json({ error: "Account suspended. Contact admin." });
  logActivity(`${user.name} signed in`, "green");
  res.json({ token: signToken(user), user: publicUser(user) });
});

app.post("/auth/guest", (req, res) => {
  const guest = db.users.find((u) => u.role === "visitor" && u.name === "Guest");
  res.json({ token: signToken(guest), user: publicUser(guest) });
});

app.get("/auth/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.put("/auth/me", requireAuth, (req, res) => {
  const { name, email } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: "name and email are required." });
  req.user.name = name;
  req.user.email = email;
  res.json({ user: publicUser(req.user) });
});

/* ══════════════════════════════════════════
   TRANSLATE  (dictionary lookup first, AI fallback)
══════════════════════════════════════════ */
app.post("/translate", async (req, res) => {
  try {
    const { text, direction } = req.body || {};
    if (!text) return res.status(400).json({ error: "text is required." });
    const dir = direction === "en-bm" ? "en-bm" : "bm-en";

    const hit = findWordMatch(text, dir);
    if (hit) return res.json(hit);

    const prompt =
      dir === "en-bm"
        ? `Translate the following English text into natural Bemba. Return only the translation:\n\n${text}`
        : `Translate the following Bemba text into English. Return only the translation:\n\n${text}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    res.json({
      translation: response.text,
      source: "ai",
      label: "AI Translation — verify accuracy. You can suggest a correction below.",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Translation failed." });
  }
});

/* ══════════════════════════════════════════
   OCR  (image -> extracted text, via Gemini vision)
══════════════════════════════════════════ */
app.post("/ocr", async (req, res) => {
  try {
    const { imageBase64, mimeType } = req.body || {};
    if (!imageBase64) return res.status(400).json({ error: "imageBase64 is required." });

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { text: "You are an OCR specialist. Extract ALL visible text from this image exactly as it appears. If no text is visible, respond with: NO_TEXT_FOUND\nReturn ONLY the text — no commentary." },
            { inlineData: { mimeType: mimeType || "image/jpeg", data: imageBase64 } },
          ],
        },
      ],
    });

    const text = (response.text || "").trim();
    res.json({ text: text || "NO_TEXT_FOUND" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "OCR failed." });
  }
});

/* ══════════════════════════════════════════
   DICTIONARY
══════════════════════════════════════════ */
app.get("/dictionary", (req, res) => {
  const { q, cat } = req.query;
  let results = db.words;
  if (q) {
    const needle = String(q).toLowerCase();
    results = results.filter(
      (d) => d.en.toLowerCase().includes(needle) || d.bm.toLowerCase().includes(needle) || d.cat.toLowerCase().includes(needle)
    );
  }
  if (cat) results = results.filter((d) => d.cat === cat);
  res.json({ words: results, categories: [...new Set(db.words.map((d) => d.cat))] });
});

app.post("/dictionary/suggest", requireAuth, (req, res) => {
  const { en, bm, cat, pron, ex } = req.body || {};
  if (!en || !bm) return res.status(400).json({ error: "en and bm are required." });
  const entry = {
    id: db.nextPendingId++,
    type: "word",
    en,
    bm,
    cat: cat || "General",
    pron: pron || "",
    ex: ex || "",
    by: req.user.name,
    byId: req.user.id,
    status: "pending",
    time: new Date().toISOString(),
  };
  db.pending.push(entry);
  req.user.pts += 2;
  logActivity(`"${en}" submitted by ${req.user.name}`, "gold");
  res.status(201).json({ entry, user: publicUser(req.user) });
});

app.post("/dictionary/correct", requireAuth, (req, res) => {
  const { wordId, suggested, reason } = req.body || {};
  const original = db.words.find((w) => w.id === Number(wordId));
  if (!original) return res.status(404).json({ error: "Word not found." });
  const entry = {
    id: db.nextPendingId++,
    type: "correction",
    en: original.en,
    original: original.bm,
    suggested,
    reason: reason || "",
    cat: original.cat,
    by: req.user.name,
    byId: req.user.id,
    status: "pending",
    time: new Date().toISOString(),
  };
  db.pending.push(entry);
  logActivity(`Correction for "${original.en}" submitted by ${req.user.name}`, "gold");
  res.status(201).json({ entry });
});

app.get("/dictionary/mine", requireAuth, (req, res) => {
  res.json({ entries: db.pending.filter((p) => p.byId === req.user.id) });
});

app.get("/dictionary/pending", requireAuth, requireRole("admin", "moderator"), (req, res) => {
  res.json({ entries: db.pending });
});

app.post("/dictionary/pending/:id/review", requireAuth, requireRole("admin", "moderator"), (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  if (!["approved", "rejected"].includes(status)) return res.status(400).json({ error: "status must be approved or rejected." });
  const entry = db.pending.find((p) => p.id === id);
  if (!entry) return res.status(404).json({ error: "Pending entry not found." });
  entry.status = status;

  if (status === "approved") {
    if (entry.type === "word") {
      db.words.push({
        id: db.nextWordId++,
        en: entry.en,
        bm: entry.bm,
        cat: entry.cat || "General",
        pron: entry.pron || "—",
        ex: entry.ex || "—",
        contrib: entry.by,
        status: "approved",
      });
    } else if (entry.type === "correction") {
      const w = db.words.find((w) => w.en === entry.en);
      if (w) w.bm = entry.suggested;
    }
    const contributor = db.users.find((u) => u.id === entry.byId);
    if (contributor) contributor.pts += entry.type === "correction" ? 5 : 10;
    logActivity(`"${entry.en}" approved by ${req.user.name}`, "green");
  } else {
    logActivity(`"${entry.en}" rejected by ${req.user.name}`, "red");
  }
  res.json({ entry });
});

/* ══════════════════════════════════════════
   FAVORITES
══════════════════════════════════════════ */
app.get("/favorites", requireAuth, (req, res) => {
  const mine = db.favorites.filter((f) => f.userId === req.user.id);
  const words = mine.map((f) => ({ ...db.words.find((w) => w.id === f.wordId), favoritedAt: f.time })).filter(Boolean);
  res.json({ favorites: words });
});

app.post("/favorites", requireAuth, (req, res) => {
  const { wordId } = req.body || {};
  const word = db.words.find((w) => w.id === Number(wordId));
  if (!word) return res.status(404).json({ error: "Word not found." });
  const existing = db.favorites.find((f) => f.userId === req.user.id && f.wordId === word.id);
  if (existing) return res.json({ favorited: true, alreadyExisted: true });
  db.favorites.push({ id: db.nextFavId++, userId: req.user.id, wordId: word.id, time: new Date().toISOString() });
  res.status(201).json({ favorited: true });
});

app.delete("/favorites/:wordId", requireAuth, (req, res) => {
  const wordId = Number(req.params.wordId);
  db.favorites = db.favorites.filter((f) => !(f.userId === req.user.id && f.wordId === wordId));
  res.json({ favorited: false });
});

/* ══════════════════════════════════════════
   HISTORY  (translation / camera / voice)
══════════════════════════════════════════ */
app.get("/history", requireAuth, (req, res) => {
  const { kind } = req.query;
  let mine = db.history.filter((h) => h.userId === req.user.id);
  if (kind) mine = mine.filter((h) => h.kind === kind);
  res.json({ entries: mine.slice(0, 50) });
});

app.post("/history", requireAuth, (req, res) => {
  const { kind, input, output, source } = req.body || {};
  if (!kind || !input || !output) return res.status(400).json({ error: "kind, input and output are required." });
  const entry = { id: db.nextHistoryId++, userId: req.user.id, kind, input, output, source: source || "", time: new Date().toISOString() };
  db.history.unshift(entry);
  res.status(201).json({ entry });
});

app.delete("/history", requireAuth, (req, res) => {
  const { kind } = req.query;
  db.history = db.history.filter((h) => !(h.userId === req.user.id && (!kind || h.kind === kind)));
  res.json({ cleared: true });
});

/* ══════════════════════════════════════════
   USERS (admin) + LEADERBOARD
══════════════════════════════════════════ */
app.get("/users", requireAuth, requireRole("admin"), (req, res) => {
  res.json({ users: db.users.map(publicUser) });
});

app.patch("/users/:id/status", requireAuth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const user = db.users.find((u) => u.id === id);
  if (!user) return res.status(404).json({ error: "User not found." });
  user.status = user.status === "active" ? "suspended" : "active";
  logActivity(`User "${user.name}" ${user.status} by admin`, "red");
  res.json({ user: publicUser(user) });
});

app.get("/leaderboard", (req, res) => {
  const sorted = [...db.users].sort((a, b) => b.pts - a.pts).map(publicUser);
  res.json({ leaderboard: sorted });
});

app.get("/activity", requireAuth, requireRole("admin", "moderator"), (req, res) => {
  res.json({ activity: db.activity });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
