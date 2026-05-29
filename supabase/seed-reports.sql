-- ============================================================
-- Residente — demo Reports seed (optional)
-- Populates the `reports` table so the Easy Track → Reports section shows a
-- realistic board-published list for a logged-in community. Summary rows have
-- no file (they render as "View"); upload a PDF to the `reports` bucket and set
-- storage_path to make a row downloadable ("Download").
--
-- Edit the community_id below (or rely on the "first community" lookup) and run
-- once in the Supabase SQL editor. Safe to re-run: clears prior demo rows first.
-- ============================================================

do $$
declare
  cid uuid;
begin
  -- Target community — change this, or leave it to grab the first community.
  select id into cid from public.communities order by created_at limit 1;
  if cid is null then
    raise notice 'No community found — nothing seeded.';
    return;
  end if;

  -- Clear previously-seeded demo reports for an idempotent re-run.
  delete from public.reports where community_id = cid and title like '[demo]%';

  insert into public.reports (community_id, title, category, status, blurb, file_size, featured, report_date) values
    (cid, '[demo] Monthly Financial Summary', 'financial',   'published', 'Income, expenses, and reserve balances for the month.', 2202010, true,  current_date - 5),
    (cid, '[demo] Board Meeting Minutes',     'board',       'published', 'Decisions, votes, and action items from the last meeting.', 819200, true,  current_date - 12),
    (cid, '[demo] Maintenance Report',        'maintenance', 'published', 'Completed jobs and the pending ticket backlog.', 1572864, true,  current_date - 20),
    (cid, '[demo] Resident Survey',           'community',   'updated',   'Quarterly satisfaction pulse — latest results.', 614400, true,  current_date - 3),
    (cid, '[demo] Reserve Study Summary',     'financial',   'published', 'Long-range funding outlook for major components.', 3145728, false, current_date - 8),
    (cid, '[demo] Amenity Usage Report',      'operations',  'published', 'Pool, gym, and clubhouse utilization.', 1153434, false, current_date - 10),
    (cid, '[demo] Vendor Performance Report', 'vendor',      'published', 'Response times and resident ratings by vendor.', 942080, false, current_date - 14),
    (cid, '[demo] Insurance Audit',           'compliance',  'published', 'Coverage review and renewal recommendations.', 1782579, false, current_date - 30),
    (cid, '[demo] Fire Drill Report',         'safety',      'published', 'Evacuation timing and findings.', 409600, false, current_date - 35);

  raise notice 'Seeded demo reports for community %', cid;
end $$;
