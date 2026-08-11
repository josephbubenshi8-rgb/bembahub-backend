-- Migration 003: Remove demo/seed data, add guest-account tracking.
--
-- WHAT THIS DOES:
-- 1. Adds an is_guest flag so the shared "Continue as Guest" identity can be
--    excluded from every leaderboard/contributor/user-count statistic, without
--    needing to delete it (deleting it mid-session would break active guests).
-- 2. Permanently deletes the fake demo accounts that used to be auto-seeded
--    (Mary Mutale, Peter Chanda, Gift Mwansa, Grace Tembo, and the old seeded
--    "Guest" row) — matched ONLY by their exact known seed email addresses, so
--    this can never touch a real user who happens to share a first name.
--    Their favorites/history/pending submissions/community posts/comments/
--    likes/reports/quiz attempts/chat messages/notifications are removed
--    automatically via the existing ON DELETE CASCADE foreign keys.
-- 3. Resets admin@bembahub.com's points back to 0 — but ONLY if they still
--    equal the old hardcoded seed value (350), so this is safe to run even if
--    that account has since earned real points through real approvals.
-- 4. Normalizes old dictionary "contrib" attributions of "Admin" / "Joseph B"
--    to "System", since those were seed-time labels, not real contributors.
--
-- Safe to run more than once — every step is idempotent.

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_guest BOOLEAN NOT NULL DEFAULT false;

DELETE FROM users
WHERE email IN (
  'mod@bembahub.com',
  'trans@bembahub.com',
  'gift@bembahub.com',
  'grace@bembahub.com',
  'guest@bembahub.com'
);

UPDATE users SET pts = 0 WHERE email = 'admin@bembahub.com' AND pts = 350;

UPDATE words SET contrib = 'System' WHERE contrib IN ('Admin', 'Joseph B');
