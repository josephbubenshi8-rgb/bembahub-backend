-- Normalize legacy seed status. Current dictionary APIs expose verified/unverified/rejected.
-- The original schema used 'approved' for seed rows, which made them invisible to
-- the public dictionary because searchWords() correctly queries status='verified'.
UPDATE words SET status='verified' WHERE status='approved';
