-- Backfill document categories renamed in the EasyDocs admin UI refactor.
-- Old short names → new full names aligned with FL 718.111(12)(g) / 720.303(4)(b).
-- Run once against your Supabase project (SQL editor or supabase db push).

UPDATE documents SET category = 'Reports & Meeting Minutes' WHERE category = 'Minutes';
UPDATE documents SET category = 'Financial Documents'       WHERE category = 'Financials';
UPDATE documents SET category = 'Vendor & Contracts'        WHERE category = 'Contracts';
UPDATE documents SET category = 'Notices & Announcements'   WHERE category = 'Notices';
