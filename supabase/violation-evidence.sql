-- Violation photo evidence — store the photo a board reads/attaches when proposing
-- a fine, as evidence on the case. Private bucket; board-only; community-scoped.
-- Retention: kept while the case is OPEN, then auto-purged a configurable number of
-- days after it CLOSES (default 365). The trigger sets/clears the expiry; the app
-- (and an optional scheduled sweep) deletes the storage objects past expiry.
--
-- Safe to re-run. Run once in the Supabase SQL editor.

-- ---------- columns ----------
alter table public.ev_violations
  add column if not exists evidence_path text,
  add column if not exists evidence_expires_at timestamptz;

-- Per-community retention window (days after a case closes). Default 1 year.
alter table public.communities
  add column if not exists evidence_retention_days int default 365;

-- ---------- private bucket ----------
insert into storage.buckets (id, name, public)
values ('violation-evidence', 'violation-evidence', false)
on conflict (id) do nothing;

-- Files live under <community_id>/<violation_id>.<ext>. The first path segment is
-- the community id. Evidence is board-only (it can contain PII) — no member read.
drop policy if exists "board reads violation evidence" on storage.objects;
create policy "board reads violation evidence"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'violation-evidence'
    and (storage.foldername(name))[1]
        = (select community_id from public.profiles where id = auth.uid())::text
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

drop policy if exists "board uploads violation evidence" on storage.objects;
create policy "board uploads violation evidence"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'violation-evidence'
    and (storage.foldername(name))[1]
        = (select community_id from public.profiles where id = auth.uid())::text
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

drop policy if exists "board deletes violation evidence" on storage.objects;
create policy "board deletes violation evidence"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'violation-evidence'
    and (storage.foldername(name))[1]
        = (select community_id from public.profiles where id = auth.uid())::text
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- ---------- retention clock ----------
-- Start the purge clock only when a case closes (or is otherwise resolved); keep
-- evidence indefinitely while the case is open, and clear the clock if reopened.
create or replace function public.ev_violation_evidence_expiry()
returns trigger language plpgsql as $$
declare days int;
begin
  if new.evidence_path is not null and (new.status = 'closed' or new.resolution is not null) then
    if new.evidence_expires_at is null then
      select coalesce(evidence_retention_days, 365) into days from public.communities where id = new.community_id;
      new.evidence_expires_at := now() + make_interval(days => coalesce(days, 365));
    end if;
  else
    new.evidence_expires_at := null;  -- open / reopened → never purge active evidence
  end if;
  return new;
end $$;

drop trigger if exists ev_violation_evidence_expiry_trg on public.ev_violations;
create trigger ev_violation_evidence_expiry_trg
  before insert or update on public.ev_violations
  for each row execute function public.ev_violation_evidence_expiry();
