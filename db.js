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

/* ─────────── LANGUAGES ─────────── */
export const LANGUAGES = {
  eng: "English", bem: "Bemba", nya: "Nyanja", toi: "Tonga",
  loz: "Lozi", kqn: "Kaonde", lun: "Lunda", lue: "Luvale",
};
export const LANG_CODES = Object.keys(LANGUAGES);
export function isValidLang(code) { return LANG_CODES.includes(code); }

// Configurable via env — not hardcoded throughout the app (spec #6).
const HIGH_CONFIDENCE_MIN_USES = Number(process.env.HIGH_CONFIDENCE_MIN_USES || 10);
const HIGH_CONFIDENCE_MIN_CONTRIBUTORS = Number(process.env.HIGH_CONFIDENCE_MIN_CONTRIBUTORS || 3);

/* ─────────── WORDS / DICTIONARY ─────────── */
export async function searchWords(q, sourceLang, targetLang, cat) {
  let sql = "SELECT * FROM words WHERE status='verified'";
  const params = [];
  if (q) { params.push(`%${q.toLowerCase()}%`); sql += ` AND (LOWER(en) LIKE $${params.length} OR LOWER(bm) LIKE $${params.length} OR LOWER(cat) LIKE $${params.length})`; }
  if (sourceLang) { params.push(sourceLang); sql += ` AND source_lang = $${params.length}`; }
  if (targetLang) { params.push(targetLang); sql += ` AND target_lang = $${params.length}`; }
  if (cat) { params.push(cat); sql += ` AND cat = $${params.length}`; }
  sql += " ORDER BY en ASC LIMIT 200";
  const { rows } = await pool.query(sql, params);
  return rows;
}
export async function getCategories() {
  const { rows } = await pool.query("SELECT DISTINCT cat FROM words WHERE status='verified' ORDER BY cat");
  return rows.map((r) => r.cat);
}
export async function getWordById(id) {
  const { rows } = await pool.query("SELECT * FROM words WHERE id=$1", [id]);
  return rows[0] || null;
}

// Looks up an existing translation for a specific language pair. Checks
// verified first, then unverified (reusing an AI result already generated
// for this exact phrase saves an API call and is how usage_count climbs),
// then a partial/fuzzy verified match. Never matches a 'rejected' entry.
export async function findWordMatch(text, sourceLang, targetLang) {
  const q = (text || "").trim().toLowerCase();
  if (!q || !isValidLang(sourceLang) || !isValidLang(targetLang)) return null;

  const { rows: verified } = await pool.query(
    `SELECT * FROM words WHERE status='verified' AND source_lang=$1 AND target_lang=$2 AND LOWER(TRIM(en)) = $3 LIMIT 1`,
    [sourceLang, targetLang, q]
  );
  if (verified[0]) {
    return { translation: verified[0].bm, source: "dictionary", confidence: verified[0].confidence_score, label: `Verified — BembaHub dictionary${verified[0].contrib ? " · " + verified[0].contrib : ""}` };
  }

  const { rows: cached } = await pool.query(
    `SELECT * FROM words WHERE status='unverified' AND source_lang=$1 AND target_lang=$2 AND LOWER(TRIM(en)) = $3 ORDER BY usage_count DESC LIMIT 1`,
    [sourceLang, targetLang, q]
  );
  if (cached[0]) {
    return { translation: cached[0].bm, source: "ai", confidence: cached[0].confidence_score, label: cached[0].high_confidence ? "AI Translation (high-confidence, awaiting admin verification)" : "AI Translation (previously generated, awaiting verification)" };
  }

  if (q.length >= 4) {
    const { rows: partial } = await pool.query(
      `SELECT * FROM words WHERE status='verified' AND source_lang=$1 AND target_lang=$2 AND LOWER(TRIM(en)) LIKE $3 LIMIT 1`,
      [sourceLang, targetLang, `%${q}%`]
    );
    if (partial[0]) return { translation: partial[0].bm, source: "dictionary", confidence: partial[0].confidence_score, label: "Verified (close match) — BembaHub dictionary" };
  }
  return null;
}

// Recomputes confidence_score and the high_confidence flag from real signals
// only: usage, DISTINCT contributors, and open reports. Never influenced by
// the same user repeating a request. Called any time one of those inputs
// changes. Verified/admin-sourced entries are anchored near 100.
function computeConfidence({ usageCount, uniqueContributors, openReports, status, translationSource }) {
  if (status === "verified") return 100;
  let score = Math.min(60, usageCount * 2) + Math.min(30, uniqueContributors * 10);
  if (translationSource === "admin") score += 20;
  score -= openReports * 15;
  return Math.max(0, Math.min(99, Math.round(score)));
}

// Called after EVERY successful /translate response (dictionary-hit or AI) to
// grow the dictionary automatically — fire-and-forget from the route handler,
// so a failure here NEVER affects the translation the user already received.
// Upserts on (source_lang, target_lang, en, bm): a repeat of the same phrase
// in the same direction just increments usage_count/last_used_at; a new
// phrase is inserted as an unverified candidate. Never touches an existing
// row's verification status.
export async function recordTranslationUsage({ en, bm, sourceLang, targetLang, source, userId }) {
  const cleanEn = (en || "").trim();
  const cleanBm = (bm || "").trim();
  if (!cleanEn || !cleanBm) return null; // never save empty/invalid translations
  if (cleanEn.length > 200 || cleanBm.length > 200) return null; // not a dictionary-sized phrase
  if (!isValidLang(sourceLang) || !isValidLang(targetLang)) return null;

  const { rows } = await pool.query(
    `INSERT INTO words (en,bm,source_lang,target_lang,cat,pos,pron,ex,definition,synonyms,antonyms,contrib,status,source,usage_count,last_used_at,created_at,updated_at)
     VALUES ($1,$2,$3,$4,'General','','','','','{}','{}','Community','unverified',$5,1,now(),now(),now())
     ON CONFLICT (source_lang, target_lang, LOWER(TRIM(en)), LOWER(TRIM(bm)))
     DO UPDATE SET usage_count = words.usage_count + 1, last_used_at = now(), updated_at = now()
     RETURNING *`,
    [cleanEn, cleanBm, sourceLang, targetLang, source || "ai"]
  );
  let word = rows[0];

  // Unique-contributor tracking: only possible for an authenticated request
  // (anonymous/guest usage still grows usage_count above, just can't add a
  // verified-distinct contributor — see migration 005 notes).
  if (userId) {
    const ins = await pool.query(
      "INSERT INTO word_contributors (word_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING id",
      [word.id, userId]
    );
    if (ins.rows[0]) {
      const upd = await pool.query("UPDATE words SET unique_contributors = unique_contributors + 1 WHERE id=$1 RETURNING *", [word.id]);
      word = upd.rows[0];
    }
  }

  await recalcConfidence(word.id);
  return word;
}

// Re-derives confidence_score/high_confidence for one word from its current
// real counters. Called after usage, contribution, or a new report.
export async function recalcConfidence(wordId) {
  const { rows: wr } = await pool.query("SELECT * FROM words WHERE id=$1", [wordId]);
  const w = wr[0]; if (!w) return null;
  const { rows: rr } = await pool.query("SELECT COUNT(*)::int AS n FROM dictionary_reports WHERE word_id=$1 AND status='open'", [wordId]);
  const openReports = rr[0].n;
  const score = computeConfidence({
    usageCount: w.usage_count, uniqueContributors: w.unique_contributors,
    openReports, status: w.status, translationSource: w.source,
  });
  const highConfidence = w.status !== "verified"
    && w.usage_count >= HIGH_CONFIDENCE_MIN_USES
    && w.unique_contributors >= HIGH_CONFIDENCE_MIN_CONTRIBUTORS
    && openReports === 0;
  const { rows } = await pool.query(
    "UPDATE words SET confidence_score=$1, high_confidence=$2, updated_at=now() WHERE id=$3 RETURNING *",
    [score, highConfidence, wordId]
  );
  return rows[0];
}

export async function insertApprovedWord(w) {
  const { rows } = await pool.query(
    `INSERT INTO words (en,bm,source_lang,target_lang,cat,pos,pron,ex,definition,synonyms,antonyms,contrib,status,source,usage_count,last_used_at,created_at,updated_at,confidence_score)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'verified','user_contribution',1,now(),now(),now(),100)
     ON CONFLICT (source_lang, target_lang, LOWER(TRIM(en)), LOWER(TRIM(bm)))
     DO UPDATE SET status='verified', source='user_contribution', confidence_score=100, cat=EXCLUDED.cat, pos=EXCLUDED.pos,
       pron=EXCLUDED.pron, ex=EXCLUDED.ex, definition=EXCLUDED.definition,
       synonyms=EXCLUDED.synonyms, antonyms=EXCLUDED.antonyms, contrib=EXCLUDED.contrib,
       last_used_at=now(), updated_at=now()
     RETURNING *`,
    [w.en, w.bm, w.sourceLang || "eng", w.targetLang || "bem", w.cat || "General", w.pos || "", w.pron || "—", w.ex || "—", w.definition || "", w.synonyms || [], w.antonyms || [], w.contrib]
  );
  return rows[0];
}
export async function updateWordTranslation(en, bm, sourceLang, targetLang) {
  await pool.query(
    "UPDATE words SET bm=$1, last_used_at=now(), updated_at=now() WHERE en=$2 AND source_lang=$3 AND target_lang=$4",
    [bm, en, sourceLang || "eng", targetLang || "bem"]
  );
}
export async function wordOfDay(targetLang) {
  const lang = isValidLang(targetLang) ? targetLang : "bem";
  const { rows: c } = await pool.query("SELECT COUNT(*)::int AS n FROM words WHERE status='verified' AND target_lang=$1", [lang]);
  if (!c[0].n) return null;
  const dayIndex = Math.floor(Date.now() / 86400000); // days since epoch — stable all day, rotates daily
  const offset = dayIndex % c[0].n;
  const { rows } = await pool.query("SELECT * FROM words WHERE status='verified' AND target_lang=$1 ORDER BY id ASC OFFSET $2 LIMIT 1", [lang, offset]);
  return rows[0] || null;
}

/* ─────────── DICTIONARY CANDIDATES (admin-only growth management) ─────────── */
export async function listDictionaryCandidates({ status, q, sourceLang, targetLang, sort } = {}) {
  let sql = "SELECT * FROM words WHERE 1=1";
  const params = [];
  if (status === "high_confidence") {
    sql += " AND high_confidence = true AND status != 'verified'";
  } else if (status && ["unverified", "verified", "rejected"].includes(status)) {
    params.push(status); sql += ` AND status = $${params.length}`;
  }
  if (q) { params.push(`%${q.toLowerCase()}%`); sql += ` AND (LOWER(en) LIKE $${params.length} OR LOWER(bm) LIKE $${params.length})`; }
  if (sourceLang) { params.push(sourceLang); sql += ` AND source_lang = $${params.length}`; }
  if (targetLang) { params.push(targetLang); sql += ` AND target_lang = $${params.length}`; }
  const orderBy = { most_used: "usage_count DESC", recent: "created_at DESC", contributors: "unique_contributors DESC" }[sort] || "last_used_at DESC";
  sql += ` ORDER BY ${orderBy} LIMIT 200`;
  const { rows } = await pool.query(sql, params);
  return rows;
}
export async function setWordStatus(id, status) {
  const { rows } = await pool.query("UPDATE words SET status=$1, updated_at=now() WHERE id=$2 RETURNING *", [status, id]);
  if (!rows[0]) return null;
  return recalcConfidence(id);
}
export async function updateWordFull(id, w) {
  const { rows } = await pool.query(
    `UPDATE words SET en=$1, bm=$2, cat=$3, pos=$4, pron=$5, ex=$6, definition=$7, synonyms=$8, antonyms=$9, source_lang=$10, target_lang=$11, updated_at=now()
     WHERE id=$12 RETURNING *`,
    [w.en, w.bm, w.cat || "General", w.pos || "", w.pron || "", w.ex || "", w.definition || "", w.synonyms || [], w.antonyms || [], w.sourceLang, w.targetLang, id]
  );
  return rows[0] || null;
}
export async function deleteWord(id) {
  const { rowCount } = await pool.query("DELETE FROM words WHERE id=$1", [id]);
  return rowCount > 0;
}
export async function resetConfidence(id) {
  await pool.query("UPDATE words SET usage_count=0, unique_contributors=0, confidence_score=0, high_confidence=false, updated_at=now() WHERE id=$1", [id]);
  await pool.query("DELETE FROM word_contributors WHERE word_id=$1", [id]);
  const { rows } = await pool.query("SELECT * FROM words WHERE id=$1", [id]);
  return rows[0] || null;
}
export async function logSearch(query) {
  await pool.query("INSERT INTO search_log (query) VALUES ($1)", [query]);
}
export async function dictionaryStats() {
  const q = (sql) => pool.query(sql).then((r) => r.rows[0]);
  const [total, verified, unverified, rejected, highConf] = await Promise.all([
    q("SELECT COUNT(*)::int AS n FROM words"),
    q("SELECT COUNT(*)::int AS n FROM words WHERE status='verified'"),
    q("SELECT COUNT(*)::int AS n FROM words WHERE status='unverified'"),
    q("SELECT COUNT(*)::int AS n FROM words WHERE status='rejected'"),
    q("SELECT COUNT(*)::int AS n FROM words WHERE high_confidence=true AND status != 'verified'"),
  ]);
  const { rows: mostTranslated } = await pool.query("SELECT id,en,bm,source_lang,target_lang,usage_count,status FROM words ORDER BY usage_count DESC LIMIT 10");
  const { rows: recentlyAdded } = await pool.query("SELECT id,en,bm,source_lang,target_lang,status,created_at FROM words ORDER BY created_at DESC LIMIT 10");
  const { rows: mostSearched } = await pool.query("SELECT query, COUNT(*)::int AS n FROM search_log GROUP BY query ORDER BY n DESC LIMIT 10");
  const { rows: byLanguage } = await pool.query(
    "SELECT source_lang, target_lang, COUNT(*)::int AS n FROM words WHERE status='verified' GROUP BY source_lang, target_lang ORDER BY n DESC"
  );
  const { rows: mostContributors } = await pool.query(
    "SELECT id,en,bm,unique_contributors FROM words WHERE unique_contributors > 0 ORDER BY unique_contributors DESC LIMIT 10"
  );
  return {
    totalEntries: total.n, verifiedCount: verified.n, unverifiedCount: unverified.n,
    rejectedCount: rejected.n, highConfidenceCount: highConf.n,
    mostTranslated, recentlyAdded, mostSearched, byLanguage, mostContributors,
  };
}

/* ─────────── DICTIONARY REPORTS ─────────── */
export async function createReport(wordId, userId, reason) {
  const { rows } = await pool.query(
    "INSERT INTO dictionary_reports (word_id,user_id,reason) VALUES ($1,$2,$3) RETURNING *",
    [wordId, userId, reason]
  );
  await recalcConfidence(wordId); // a new report should reduce confidence immediately
  return rows[0];
}
export async function listReportsForWord(wordId) {
  const { rows } = await pool.query("SELECT * FROM dictionary_reports WHERE word_id=$1 ORDER BY created_at DESC", [wordId]);
  return rows;
}
export async function markReportReviewed(id) {
  const { rows } = await pool.query("UPDATE dictionary_reports SET status='reviewed' WHERE id=$1 RETURNING *", [id]);
  return rows[0] || null;
}

/* ─────────── PENDING SUBMISSIONS ─────────── */
export async function createPending(p) {
  const { rows } = await pool.query(
    `INSERT INTO pending (type,en,bm,original,suggested,cat,pos,pron,ex,definition,synonyms,antonyms,reason,by_name,by_id,source_lang,target_lang,status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'pending') RETURNING *`,
    [p.type, p.en, p.bm || null, p.original || null, p.suggested || null, p.cat || "General", p.pos || "", p.pron || "", p.ex || "", p.definition || "", p.synonyms || [], p.antonyms || [], p.reason || "", p.by_name, p.by_id, p.sourceLang || "eng", p.targetLang || "bem"]
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
export async function randomWords(count, sourceLang, targetLang) {
  const params = [];
  let sql = "SELECT * FROM words WHERE status='verified'";
  if (sourceLang) { params.push(sourceLang); sql += ` AND source_lang = $${params.length}`; }
  if (targetLang) { params.push(targetLang); sql += ` AND target_lang = $${params.length}`; }
  params.push(count);
  sql += ` ORDER BY random() LIMIT $${params.length}`;
  const { rows } = await pool.query(sql, params);
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
