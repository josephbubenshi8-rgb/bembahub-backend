import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { GoogleGenAI } from "@google/genai";

import * as db from "./db.js";
import { signToken, requireAuth, requireRole, publicUser } from "./auth.js";
import { sendPasswordResetEmail } from "./mailer.js";

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
  const guest = await db.getUserByEmail("guest@bembahub.com");
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
   TRANSLATE
══════════════════════════════════════════ */
app.post("/translate", asyncRoute(async (req, res) => {
  const { text, direction } = req.body || {};
  if (!text) return res.status(400).json({ error: "text is required." });
  const dir = direction === "en-bm" ? "en-bm" : "bm-en";

  const hit = await db.findWordMatch(text, dir);
  if (hit) return res.json(hit);

  const prompt = dir === "en-bm"
    ? `Translate the following English text into natural Bemba. Return only the translation:\n\n${text}`
    : `Translate the following Bemba text into English. Return only the translation:\n\n${text}`;

  try {
    const response = await ai.models.generateContent({ model: "gemini-flash-latest", contents: prompt });
    const translation = response.text;
    if (!translation) return res.status(404).json({ error: "Word not found." });
    res.json({ translation, source: "ai", label: "AI Translation — verify accuracy. You can suggest a correction below." });
  } catch (e) {
    console.error(e);
    res.status(503).json({ error: "Translation unavailable. Please try again shortly." });
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
    res.status(503).json({ error: "Translation unavailable. Please try again shortly." });
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
   DICTIONARY  (+ Word of the Day)
══════════════════════════════════════════ */
app.get("/dictionary", asyncRoute(async (req, res) => {
  const { q, cat } = req.query;
  const [words, categories] = await Promise.all([db.searchWords(q, cat), db.getCategories()]);
  res.json({ words, categories });
}));

app.get("/dictionary/word-of-day", asyncRoute(async (req, res) => {
  const word = await db.wordOfDay();
  if (!word) return res.status(404).json({ error: "Word not found." });
  res.json({ word });
}));

app.post("/dictionary/suggest", requireAuth, asyncRoute(async (req, res) => {
  const { en, bm, cat, pos, pron, ex, synonyms, antonyms } = req.body || {};
  if (!en || !bm) return res.status(400).json({ error: "en and bm are required." });
  const entry = await db.createPending({
    type: "word", en, bm, cat, pos, pron, ex,
    synonyms: Array.isArray(synonyms) ? synonyms : [], antonyms: Array.isArray(antonyms) ? antonyms : [],
    by_name: req.user.name, by_id: req.user.id,
  });
  const user = await db.addUserPoints(req.user.id, 2);
  await db.logActivity(`"${en}" submitted by ${req.user.name}`, "gold");
  res.status(201).json({ entry, user: publicUser(user) });
}));

app.post("/dictionary/correct", requireAuth, asyncRoute(async (req, res) => {
  const { wordId, suggested, reason } = req.body || {};
  const original = await db.getWordById(Number(wordId));
  if (!original) return res.status(404).json({ error: "Word not found." });
  const entry = await db.createPending({
    type: "correction", en: original.en, original: original.bm, suggested, reason, cat: original.cat,
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
        synonyms: entry.synonyms, antonyms: entry.antonyms, contrib: entry.by_name,
      });
    } else if (entry.type === "correction") {
      await db.updateWordTranslation(entry.en, entry.suggested);
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
  const direction = req.query.direction === "bm-en" ? "bm-en" : "en-bm";
  const words = await db.randomWords(Math.max(count, 4));
  if (words.length < 4) return res.status(404).json({ error: "Word not found." });
  const questions = words.slice(0, count).map((w) => {
    const promptText = direction === "en-bm" ? w.en : w.bm;
    const correctAnswer = direction === "en-bm" ? w.bm : w.en;
    const distractors = words.filter((x) => x.id !== w.id).sort(() => Math.random() - 0.5).slice(0, 3)
      .map((x) => (direction === "en-bm" ? x.bm : x.en));
    const choices = [...distractors, correctAnswer].sort(() => Math.random() - 0.5);
    return { wordId: w.id, prompt: promptText, choices };
  });
  res.json({ direction, questions });
}));

app.post("/quiz/submit", requireAuth, asyncRoute(async (req, res) => {
  const { answers, direction } = req.body || {}; // answers: [{wordId, chosen}]
  if (!Array.isArray(answers) || !answers.length) return res.status(400).json({ error: "answers array is required." });
  const dir = direction === "bm-en" ? "bm-en" : "en-bm";
  let score = 0;
  const results = [];
  for (const a of answers) {
    const word = await db.getWordById(Number(a.wordId));
    if (!word) continue;
    const correctAnswer = dir === "en-bm" ? word.bm : word.en;
    const isCorrect = (a.chosen || "").trim().toLowerCase() === correctAnswer.trim().toLowerCase();
    if (isCorrect) score++;
    results.push({ wordId: word.id, correct: isCorrect, correctAnswer });
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
