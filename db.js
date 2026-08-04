import bcrypt from "bcryptjs";

/* ══════════════════════════════════════════
   IN-MEMORY DATA STORE
   NOTE: This resets whenever the server restarts/redeploys
   (e.g. on Render's free tier). For real persistence, swap
   this module for a real database (Postgres/Mongo) — every
   function below is written so that swap only touches this file.
══════════════════════════════════════════ */

const hash = (pw) => bcrypt.hashSync(pw, 10);

export const db = {
  nextUserId: 7,
  nextWordId: 16,
  nextPendingId: 1,
  nextFavId: 1,
  nextHistoryId: 1,

  users: [
    { id: 1, name: "Joseph Bubenshi", email: "admin@bembahub.com", passHash: hash("admin123"), role: "admin", pts: 350, status: "active", initials: "JB", color: "#4A1299" },
    { id: 2, name: "Mary Mutale", email: "mod@bembahub.com", passHash: hash("mod123"), role: "moderator", pts: 180, status: "active", initials: "MM", color: "#1251A3" },
    { id: 3, name: "Peter Chanda", email: "trans@bembahub.com", passHash: hash("trans123"), role: "translator", pts: 120, status: "active", initials: "PC", color: "#1E5C20" },
    { id: 4, name: "Gift Mwansa", email: "gift@bembahub.com", passHash: hash("gift123"), role: "translator", pts: 95, status: "active", initials: "GM", color: "#7C3A12" },
    { id: 5, name: "Grace Tembo", email: "grace@bembahub.com", passHash: hash("grace123"), role: "visitor", pts: 12, status: "active", initials: "GT", color: "#616161" },
    { id: 6, name: "Guest", email: "guest@bembahub.com", passHash: null, role: "visitor", pts: 0, status: "active", initials: "G", color: "#9E9E9E" },
  ],

  words: [
    { id: 1, en: "Good morning", bm: "Mwashibukeni", cat: "Greetings", pron: "mwa-shi-bu-KE-ni", ex: "Mwashibukeni, muli shani?", contrib: "System", status: "approved" },
    { id: 2, en: "Good evening", bm: "Mwabombeni", cat: "Greetings", pron: "mwa-BOM-be-ni", ex: "Mwabombeni, nakutemenwa.", contrib: "System", status: "approved" },
    { id: 3, en: "How are you", bm: "Muli shani", cat: "Greetings", pron: "moo-li SHA-ni", ex: "Muli shani? Nalikwata bwino.", contrib: "System", status: "approved" },
    { id: 4, en: "Thank you", bm: "Natotela", cat: "Common Phrases", pron: "na-TO-te-la", ex: "Natotela sana!", contrib: "Admin", status: "approved" },
    { id: 5, en: "I love you", bm: "Nakutemenwa", cat: "Common Phrases", pron: "na-ku-TE-me-nwa", ex: "Nakutemenwa, umukwai.", contrib: "Admin", status: "approved" },
    { id: 6, en: "Welcome", bm: "Mwapokelelwa", cat: "Greetings", pron: "mwa-po-ke-LEL-wa", ex: "Mwapokelelwa ku Zambia!", contrib: "Joseph B", status: "approved" },
    { id: 7, en: "Water", bm: "Amenshi", cat: "Daily", pron: "a-MEN-shi", ex: "Ndefwaya amenshi.", contrib: "System", status: "approved" },
    { id: 8, en: "Food", bm: "Ifilyo", cat: "Daily", pron: "i-FI-lyo", ex: "Ifilyo fyali ifyabufi!", contrib: "System", status: "approved" },
    { id: 9, en: "God", bm: "Lesa", cat: "Church", pron: "LE-sa", ex: "Lesa alelefya.", contrib: "Admin", status: "approved" },
    { id: 10, en: "Father", bm: "Tata", cat: "Family", pron: "TA-ta", ex: "Tata wandi alikwata imyaka makumi yabili.", contrib: "System", status: "approved" },
    { id: 11, en: "Mother", bm: "Mayo", cat: "Family", pron: "MA-yo", ex: "Mayo wandi alimba ubwali.", contrib: "System", status: "approved" },
    { id: 12, en: "School", bm: "Sukuulu", cat: "School", pron: "su-KOO-lu", ex: "Naya ku sukuulu.", contrib: "System", status: "approved" },
    { id: 13, en: "Money", bm: "Impiya", cat: "Business", pron: "IM-pi-ya", ex: "Nalikwata impiya yambula.", contrib: "Admin", status: "approved" },
    { id: 14, en: "Road", bm: "Inzila", cat: "Travel", pron: "IN-zi-la", ex: "Inzila ya ku Lusaka.", contrib: "System", status: "approved" },
    { id: 15, en: "Doctor", bm: "Ndoshi", cat: "Health", pron: "NDO-shi", ex: "Naya ku Ndoshi.", contrib: "System", status: "approved" },
  ],

  pending: [],      // { id, type:'word'|'correction', en, bm, cat, pron, ex, by, byId, status, time }
  favorites: [],     // { id, userId, wordId, time }
  history: [],       // { id, userId, kind:'translation'|'camera'|'voice', input, output, source, time }
  activity: [],       // { id, text, color, time }
};

export function logActivity(text, color = "green") {
  db.activity.unshift({ id: db.activity.length + 1, text, color, time: new Date().toISOString() });
  db.activity = db.activity.slice(0, 100);
}

export function publicUser(u) {
  if (!u) return null;
  const { passHash, ...rest } = u;
  return rest;
}

export function findWordMatch(text, direction) {
  const q = text.toLowerCase().trim();
  const enToBm = direction === "en-bm";
  const pool = [
    ...db.pending.filter((p) => p.status === "approved" && p.type === "word"),
    ...db.words,
  ];
  for (const d of pool) {
    const key = (enToBm ? d.en : d.bm) || "";
    if (key.toLowerCase().trim() === q) {
      return { translation: enToBm ? d.bm : d.en, source: "dictionary", label: `Approved — verified by BembaHub${d.contrib ? " · by " + d.contrib : ""}` };
    }
  }
  for (const d of db.words) {
    const key = enToBm ? d.en : d.bm;
    if (q.length >= 4 && key.toLowerCase().includes(q)) {
      return { translation: enToBm ? d.bm : d.en, source: "dictionary", label: "Approved (close match) — BembaHub" };
    }
  }
  return null;
}
