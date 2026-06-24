-- Emergency contact number shown to residents on Easy Voice → Contact.
-- Set by the board in Admin → Community & Compliance (Association details).
-- NULL = no number on file → residents see the generic "contact your
-- management office or board" line instead of a placeholder.
--
-- Idempotent: safe to run more than once. No RLS change needed — the column
-- inherits the communities table's existing "members read / board updates"
-- policies, and select('*') surfaces it to the app automatically.
ALTER TABLE communities ADD COLUMN IF NOT EXISTS emergency_phone text;
