import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false },
});

const SEED_WORDS = [
  { en: "Good morning", bm: "Mwashibukeni", cat: "Greetings", pos: "phrase", pron: "mwa-shi-bu-KE-ni", ex: "Mwashibukeni, muli shani?", syn: [], ant: [], contrib: "System" },
  { en: "Good evening", bm: "Mwabombeni", cat: "Greetings", pos: "phrase", pron: "mwa-BOM-be-ni", ex: "Mwabombeni, nakutemenwa.", syn: [], ant: [], contrib: "System" },
  { en: "How are you", bm: "Muli shani", cat: "Greetings", pos: "phrase", pron: "moo-li SHA-ni", ex: "Muli shani? Nalikwata bwino.", syn: [], ant: [], contrib: "System" },
  { en: "Thank you", bm: "Natotela", cat: "Common Phrases", pos: "interjection", pron: "na-TO-te-la", ex: "Natotela sana!", syn: ["Twatotela"], ant: [], contrib: "System" },
  { en: "I love you", bm: "Nakutemenwa", cat: "Common Phrases", pos: "phrase", pron: "na-ku-TE-me-nwa", ex: "Nakutemenwa, umukwai.", syn: [], ant: [], contrib: "System" },
  { en: "Welcome", bm: "Mwapokelelwa", cat: "Greetings", pos: "interjection", pron: "mwa-po-ke-LEL-wa", ex: "Mwapokelelwa ku Zambia!", syn: [], ant: [], contrib: "System" },
  { en: "Water", bm: "Amenshi", cat: "Daily", pos: "noun", pron: "a-MEN-shi", ex: "Ndefwaya amenshi.", syn: [], ant: [], contrib: "System" },
  { en: "Food", bm: "Ifilyo", cat: "Daily", pos: "noun", pron: "i-FI-lyo", ex: "Ifilyo fyali ifyabufi!", syn: [], ant: [], contrib: "System" },
  { en: "God", bm: "Lesa", cat: "Church", pos: "noun", pron: "LE-sa", ex: "Lesa alelefya.", syn: [], ant: [], contrib: "System" },
  { en: "Father", bm: "Tata", cat: "Family", pos: "noun", pron: "TA-ta", ex: "Tata wandi alikwata imyaka makumi yabili.", syn: [], ant: ["Mayo"], contrib: "System" },
  { en: "Mother", bm: "Mayo", cat: "Family", pos: "noun", pron: "MA-yo", ex: "Mayo wandi alimba ubwali.", syn: [], ant: ["Tata"], contrib: "System" },
  { en: "School", bm: "Sukuulu", cat: "School", pos: "noun", pron: "su-KOO-lu", ex: "Naya ku sukuulu.", syn: [], ant: [], contrib: "System" },
  { en: "Money", bm: "Impiya", cat: "Business", pos: "noun", pron: "IM-pi-ya", ex: "Nalikwata impiya yambula.", syn: [], ant: [], contrib: "System" },
  { en: "Road", bm: "Inzila", cat: "Travel", pos: "noun", pron: "IN-zi-la", ex: "Inzila ya ku Lusaka.", syn: [], ant: [], contrib: "System" },
  { en: "Doctor", bm: "Ndoshi", cat: "Health", pos: "noun", pron: "NDO-shi", ex: "Naya ku Ndoshi.", syn: [], ant: [], contrib: "System" },
];

const SEED_USERS = []; // No demo/seed users are created. See adminBootstrap() below —
// the only account ever auto-created is a real admin from your own env vars, and a
// single shared "guest" identity that is always excluded from leaderboards/stats.

export async function initSchema() {
  const dir = path.join(__dirname, "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), "utf8");
    await pool.query(sql);
    console.log(`Migration applied: ${f}`);
  }

  const { rows: wc } = await pool.query("SELECT COUNT(*)::int AS n FROM words");
  if (wc[0].n === 0) {
    for (const w of SEED_WORDS) {
      await pool.query(
        `INSERT INTO words (en,bm,cat,pos,pron,ex,synonyms,antonyms,contrib,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'approved')`,
        [w.en, w.bm, w.cat, w.pos, w.pron, w.ex, w.syn, w.ant, w.contrib]
      );
    }
  }

  const { rows: uc } = await pool.query("SELECT COUNT(*)::int AS n FROM users");
  if (uc[0].n === 0) {
    for (const u of SEED_USERS) {
      const hash = u.pass ? bcrypt.hashSync(u.pass, 10) : null;
      await pool.query(
        `INSERT INTO users (name,email,pass_hash,role,pts,status,initials,color) VALUES ($1,$2,$3,$4,$5,'active',$6,$7)`,
        [u.name, u.email, hash, u.role, u.pts, u.initials, u.color]
      );
    }
  }
  await adminBootstrap();
  console.log("Database ready.");
}

// Creates exactly one real admin account from your own environment variables —
// never a hardcoded/demo login. Runs on every boot but only acts once (skips if
// any admin already exists). If the env vars aren't set, it does nothing and
// logs a reminder instead of inventing credentials.
export async function adminBootstrap() {
  const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE role='admin'");
  if (rows[0].n > 0) return;
  const { ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.warn("No admin account exists yet, and ADMIN_EMAIL/ADMIN_PASSWORD are not set — set them in your environment to auto-create your real admin login on next boot.");
    return;
  }
  const passHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  await createUser({ name: ADMIN_NAME || "Admin", email: ADMIN_EMAIL, passHash, role: "admin" });
  console.log(`Admin account created for ${ADMIN_EMAIL}.`);
}

// Single shared "guest" identity for the "Continue as Guest" button. It's a real
// row (so foreign keys work), but is_guest=true excludes it from every
// leaderboard, top-contributors list, and user-count statistic.
export async function getOrCreateGuestUser() {
  const { rows } = await pool.query("SELECT * FROM users WHERE is_guest=true LIMIT 1");
  if (rows[0]) return rows[0];
  const { rows: created } = await pool.query(
    `INSERT INTO users (name,email,pass_hash,role,initials,color,is_guest) VALUES ('Guest','guest@bembahub.local',NULL,'visitor','G','#9E9E9E',true) RETURNING *`
  );
  return created[0];
}

export async function logActivity(text, color = "green") {
  await pool.query("INSERT INTO activity (text, color) VALUES ($1,$2)", [text, color]);
}

export function publicUser(row) {
  if (!row) return null;
  const { pass_hash, ...rest } = row;
  return rest;
}

/* ─────────── USERS ─────────── */
export async function getUserByEmail(email) {
  const { rows } = await pool.query("SELECT * FROM users WHERE LOWER(email)=LOWER($1)", [email]);
  return rows[0] || null;
}
export async function getUserById(id) {
  const { rows } = await pool.query("SELECT * FROM users WHERE id=$1", [id]);
  return rows[0] || null;
}
export async function createUser({ name, email, passHash, role }) {
  const initials = name.split(" ").map((w) => w[0]).join("").substring(0, 2).toUpperCase();
  const colors = ["#7C3A12", "#1251A3", "#1E5C20", "#4A1299", "#C8793A"];
  const color = colors[Math.floor(Math.random() * colors.length)];
  const { rows } = await pool.query(
    `INSERT INTO users (name,email,pass_hash,role,initials,color) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [name, email, passHash, role, initials, color]
  );
  return rows[0];
}
export async function updateUserProfile(id, { name, email }) {
  const { rows } = await pool.query(`UPDATE users SET name=$1, email=$2 WHERE id=$3 RETURNING *`, [name, email, id]);
  return rows[0];
}
export async function updateUserPassword(id, passHash) {
  await pool.query("UPDATE users SET pass_hash=$1 WHERE id=$2", [passHash, id]);
}
export async function updateUserTheme(id, theme) {
  const { rows } = await pool.query("UPDATE users SET theme=$1 WHERE id=$2 RETURNING *", [theme, id]);
  return rows[0];
}
export async function addUserPoints(id, delta) {
  const { rows } = await pool.query("UPDATE users SET pts = pts + $1 WHERE id=$2 RETURNING *", [delta, id]);
  return rows[0];
}
export async function setUserStatus(id, status) {
  const { rows } = await pool.query("UPDATE users SET status=$1 WHERE id=$2 RETURNING *", [status, id]);
  return rows[0];
}
export async function listUsers() {
  const { rows } = await pool.query("SELECT * FROM users WHERE is_guest=false ORDER BY pts DESC");
  return rows;
}

/* ─────────── PASSWORD RESET ─────────── */
export async function createPasswordReset(userId) {
  const token = [...Array(40)].map(() => Math.floor(Math.random() * 36).toString(36)).join("");
  const expires = new Date(Date.now() + 1000 * 60 * 30);
  await pool.query("INSERT INTO password_resets (token,user_id,expires_at) VALUES ($1,$2,$3)", [token, userId, expires]);
  return token;
}
export async function consumePasswordReset(token) {
  const { rows } = await pool.query(
    "SELECT * FROM password_resets WHERE token=$1 AND used=false AND expires_at > now()",
    [token]
  );
  if (!rows[0]) return null;
  await pool.query("UPDATE password_resets SET used=true WHERE token=$1", [token]);
  return rows[0];
}

/* ─────────── WORDS / DICTIONARY ─────────── */
export async function searchWords(q, cat) {
  let sql = "SELECT * FROM words WHERE 1=1";
  const params = [];
  if (q) { params.push(`%${q.toLowerCase()}%`); sql += ` AND (LOWER(en) LIKE $${params.length} OR LOWER(bm) LIKE $${params.length} OR LOWER(cat) LIKE $${params.length})`; }
  if (cat) { params.push(cat); sql += ` AND cat = $${params.length}`; }
  sql += " ORDER BY en ASC";
  const { rows } = await pool.query(sql, params);
  return rows;
}
export async function getCategories() {
  const { rows } = await pool.query("SELECT DISTINCT cat FROM words ORDER BY cat");
  return rows.map((r) => r.cat);
}
export async function getWordById(id) {
  const { rows } = await pool.query("SELECT * FROM words WHERE id=$1", [id]);
  return rows[0] || null;
}
export async function findWordMatch(text, direction) {
  const q = text.toLowerCase().trim();
  const col = direction === "en-bm" ? "en" : "bm";
  const outCol = direction === "en-bm" ? "bm" : "en";
  const { rows: exact } = await pool.query(`SELECT * FROM words WHERE LOWER(${col}) = $1 LIMIT 1`, [q]);
  if (exact[0]) return { translation: exact[0][outCol], source: "dictionary", label: `Approved — verified by BembaHub · by ${exact[0].contrib}` };
  if (q.length >= 4) {
    const { rows: partial } = await pool.query(`SELECT * FROM words WHERE LOWER(${col}) LIKE $1 LIMIT 1`, [`%${q}%`]);
    if (partial[0]) return { translation: partial[0][outCol], source: "dictionary", label: "Approved (close match) — BembaHub" };
  }
  return null;
}
export async function insertApprovedWord(w) {
  const { rows } = await pool.query(
    `INSERT INTO words (en,bm,cat,pos,pron,ex,synonyms,antonyms,contrib,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'approved') RETURNING *`,
    [w.en, w.bm, w.cat || "General", w.pos || "", w.pron || "—", w.ex || "—", w.synonyms || [], w.antonyms || [], w.contrib]
  );
  return rows[0];
}
export async function updateWordTranslation(en, bm) {
  await pool.query("UPDATE words SET bm=$1 WHERE en=$2", [bm, en]);
}
export async function wordOfDay() {
  const { rows: c } = await pool.query("SELECT COUNT(*)::int AS n FROM words");
  if (!c[0].n) return null;
  const dayIndex = Math.floor(Date.now() / 86400000); // days since epoch — stable all day, rotates daily
  const offset = dayIndex % c[0].n;
  const { rows } = await pool.query("SELECT * FROM words ORDER BY id ASC OFFSET $1 LIMIT 1", [offset]);
  return rows[0] || null;
}

/* ─────────── PENDING SUBMISSIONS ─────────── */
export async function createPending(p) {
  const { rows } = await pool.query(
    `INSERT INTO pending (type,en,bm,original,suggested,cat,pos,pron,ex,synonyms,antonyms,reason,by_name,by_id,status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'pending') RETURNING *`,
    [p.type, p.en, p.bm || null, p.original || null, p.suggested || null, p.cat || "General", p.pos || "", p.pron || "", p.ex || "", p.synonyms || [], p.antonyms || [], p.reason || "", p.by_name, p.by_id]
  );
  return rows[0];
}
export async function listPending() {
  const { rows } = await pool.query("SELECT * FROM pending ORDER BY created_at DESC");
  return rows;
}
export async function listPendingByUser(userId) {
  const { rows } = await pool.query("SELECT * FROM pending WHERE by_id=$1 ORDER BY created_at DESC", [userId]);
  return rows;
}
export async function getPendingById(id) {
  const { rows } = await pool.query("SELECT * FROM pending WHERE id=$1", [id]);
  return rows[0] || null;
}
export async function setPendingStatus(id, status) {
  const { rows } = await pool.query("UPDATE pending SET status=$1 WHERE id=$2 RETURNING *", [status, id]);
  return rows[0];
}

/* ─────────── FAVORITES ─────────── */
export async function listFavorites(userId) {
  const { rows } = await pool.query(
    `SELECT w.*, f.created_at AS favorited_at FROM favorites f JOIN words w ON w.id=f.word_id WHERE f.user_id=$1 ORDER BY f.created_at DESC`,
    [userId]
  );
  return rows;
}
export async function addFavorite(userId, wordId) {
  await pool.query(`INSERT INTO favorites (user_id, word_id) VALUES ($1,$2) ON CONFLICT (user_id,word_id) DO NOTHING`, [userId, wordId]);
}
export async function removeFavorite(userId, wordId) {
  await pool.query("DELETE FROM favorites WHERE user_id=$1 AND word_id=$2", [userId, wordId]);
}

/* ─────────── HISTORY ─────────── */
export async function listHistory(userId, kind) {
  const params = [userId];
  let sql = "SELECT * FROM history WHERE user_id=$1";
  if (kind) { params.push(kind); sql += ` AND kind=$${params.length}`; }
  sql += " ORDER BY created_at DESC LIMIT 50";
  const { rows } = await pool.query(sql, params);
  return rows;
}
export async function addHistory(userId, kind, input, output, source) {
  const { rows } = await pool.query(
    `INSERT INTO history (user_id,kind,input,output,source) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [userId, kind, input, output, source || ""]
  );
  return rows[0];
}
export async function clearHistory(userId, kind) {
  if (kind) await pool.query("DELETE FROM history WHERE user_id=$1 AND kind=$2", [userId, kind]);
  else await pool.query("DELETE FROM history WHERE user_id=$1", [userId]);
}

/* ─────────── ACTIVITY / LEADERBOARD ─────────── */
export async function listActivity() {
  const { rows } = await pool.query("SELECT * FROM activity ORDER BY created_at DESC LIMIT 100");
  return rows;
}
export async function leaderboard() {
  const { rows } = await pool.query("SELECT * FROM users WHERE is_guest=false ORDER BY pts DESC");
  return rows;
}

/* ─────────── NOTIFICATIONS ─────────── */
export async function createNotification(userId, text, type = "info") {
  await pool.query("INSERT INTO notifications (user_id,text,type) VALUES ($1,$2,$3)", [userId, text, type]);
}
export async function listNotifications(userId) {
  const { rows } = await pool.query("SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30", [userId]);
  return rows;
}
export async function markNotificationRead(id, userId) {
  await pool.query("UPDATE notifications SET read=true WHERE id=$1 AND user_id=$2", [id, userId]);
}
export async function markAllNotificationsRead(userId) {
  await pool.query("UPDATE notifications SET read=true WHERE user_id=$1", [userId]);
}

/* ─────────── COMMUNITY (Q&A) ─────────── */
export async function createPost(userId, title, body) {
  const { rows } = await pool.query(
    "INSERT INTO community_posts (user_id,title,body) VALUES ($1,$2,$3) RETURNING *",
    [userId, title, body]
  );
  return rows[0];
}
export async function listPosts() {
  const { rows } = await pool.query(`
    SELECT p.*, u.name AS author_name, u.initials AS author_initials, u.color AS author_color,
      (SELECT COUNT(*)::int FROM community_likes l WHERE l.post_id=p.id) AS like_count,
      (SELECT COUNT(*)::int FROM community_comments c WHERE c.post_id=p.id) AS comment_count
    FROM community_posts p JOIN users u ON u.id=p.user_id
    WHERE p.status='visible' ORDER BY p.created_at DESC LIMIT 100`);
  return rows;
}
export async function getPost(id) {
  const { rows } = await pool.query(`
    SELECT p.*, u.name AS author_name, u.initials AS author_initials, u.color AS author_color
    FROM community_posts p JOIN users u ON u.id=p.user_id WHERE p.id=$1`, [id]);
  return rows[0] || null;
}
export async function listComments(postId) {
  const { rows } = await pool.query(`
    SELECT c.*, u.name AS author_name, u.initials AS author_initials, u.color AS author_color
    FROM community_comments c JOIN users u ON u.id=c.user_id WHERE c.post_id=$1 ORDER BY c.created_at ASC`, [postId]);
  return rows;
}
export async function addComment(postId, userId, body) {
  const { rows } = await pool.query(
    "INSERT INTO community_comments (post_id,user_id,body) VALUES ($1,$2,$3) RETURNING *",
    [postId, userId, body]
  );
  return rows[0];
}
export async function toggleLike(postId, userId) {
  const { rows } = await pool.query("SELECT 1 FROM community_likes WHERE post_id=$1 AND user_id=$2", [postId, userId]);
  if (rows[0]) {
    await pool.query("DELETE FROM community_likes WHERE post_id=$1 AND user_id=$2", [postId, userId]);
    return false;
  }
  await pool.query("INSERT INTO community_likes (post_id,user_id) VALUES ($1,$2)", [postId, userId]);
  return true;
}
export async function reportPost(postId, userId, reason) {
  const { rows } = await pool.query(
    "INSERT INTO community_reports (post_id,user_id,reason) VALUES ($1,$2,$3) RETURNING *",
    [postId, userId, reason]
  );
  return rows[0];
}
export async function listReports() {
  const { rows } = await pool.query(`
    SELECT r.*, p.title AS post_title, u.name AS reporter_name
    FROM community_reports r JOIN community_posts p ON p.id=r.post_id JOIN users u ON u.id=r.user_id
    WHERE r.status='open' ORDER BY r.created_at DESC`);
  return rows;
}
export async function resolveReport(id, removePost) {
  const { rows } = await pool.query("UPDATE community_reports SET status='resolved' WHERE id=$1 RETURNING *", [id]);
  const report = rows[0];
  if (report && removePost) {
    await pool.query("UPDATE community_posts SET status='removed' WHERE id=$1", [report.post_id]);
  }
  return report;
}

/* ─────────── QUIZ ─────────── */
export async function randomWords(count) {
  const { rows } = await pool.query("SELECT * FROM words ORDER BY random() LIMIT $1", [count]);
  return rows;
}
export async function saveQuizAttempt(userId, score, total) {
  const { rows } = await pool.query(
    "INSERT INTO quiz_attempts (user_id,score,total) VALUES ($1,$2,$3) RETURNING *",
    [userId, score, total]
  );
  return rows[0];
}
export async function listQuizAttempts(userId) {
  const { rows } = await pool.query("SELECT * FROM quiz_attempts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20", [userId]);
  return rows;
}

/* ─────────── AI CHAT ─────────── */
export async function saveChatMessage(userId, role, text) {
  await pool.query("INSERT INTO chat_messages (user_id,role,text) VALUES ($1,$2,$3)", [userId, role, text]);
}
export async function listChatMessages(userId) {
  const { rows } = await pool.query("SELECT * FROM chat_messages WHERE user_id=$1 ORDER BY created_at ASC LIMIT 100", [userId]);
  return rows;
}
export async function clearChatMessages(userId) {
  await pool.query("DELETE FROM chat_messages WHERE user_id=$1", [userId]);
}

/* ─────────── ANALYTICS (admin) ─────────── */
export async function analyticsSummary() {
  const q = (sql) => pool.query(sql).then((r) => r.rows[0]);
  const [users, words, pending, posts, quizzes, historyToday, historyWeek] = await Promise.all([
    q("SELECT COUNT(*)::int AS n FROM users WHERE is_guest=false"),
    q("SELECT COUNT(*)::int AS n FROM words"),
    q("SELECT COUNT(*)::int AS n FROM pending WHERE status='pending'"),
    q("SELECT COUNT(*)::int AS n FROM community_posts WHERE status='visible'"),
    q("SELECT COUNT(*)::int AS n, COALESCE(AVG(score::float/NULLIF(total,0)),0) AS avg FROM quiz_attempts"),
    q("SELECT COUNT(*)::int AS n FROM history WHERE created_at > now() - interval '1 day'"),
    q("SELECT COUNT(*)::int AS n FROM history WHERE created_at > now() - interval '7 days'"),
  ]);
  const { rows: topContributors } = await pool.query(
    "SELECT name, pts, role FROM users WHERE is_guest=false AND pts > 0 ORDER BY pts DESC LIMIT 5"
  );
  return {
    totalUsers: users.n, totalWords: words.n, pendingReview: pending.n, communityPosts: posts.n,
    quizAttempts: quizzes.n, quizAvgScore: Math.round((quizzes.avg || 0) * 100),
    translationsToday: historyToday.n, translationsThisWeek: historyWeek.n,
    topContributors,
  };
}

// Lightweight real-data stats every signed-in user can see on their Dashboard
// (unlike analyticsSummary, which is admin-only). Every number here is a live
// count from Postgres — nothing invented, nothing hardcoded.
export async function statsOverview() {
  const q = (sql) => pool.query(sql).then((r) => r.rows[0]);
  const [totalTranslations, imageTranslations, totalWords, totalUsers, pending, categories] = await Promise.all([
    q("SELECT COUNT(*)::int AS n FROM history"),
    q("SELECT COUNT(*)::int AS n FROM history WHERE kind='camera'"),
    q("SELECT COUNT(*)::int AS n FROM words"),
    q("SELECT COUNT(*)::int AS n FROM users WHERE is_guest=false"),
    q("SELECT COUNT(*)::int AS n FROM pending WHERE status='pending'"),
    q("SELECT COUNT(DISTINCT cat)::int AS n FROM words"),
  ]);
  return {
    totalTranslations: totalTranslations.n,
    imageTranslations: imageTranslations.n,
    totalWords: totalWords.n,
    totalUsers: totalUsers.n,
    pendingReview: pending.n,
    categories: categories.n,
  };
}
