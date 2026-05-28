-- ============================================================
-- Residente — resident self-service (stable account link + editable email)
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================
--
-- The roster used to identify a resident by their email, which made email
-- both the join key AND a field — so it couldn't be edited without losing
-- the match. This switches the link to the resident's account id
-- (profiles.id = auth.uid), the same stable link the notices/voice tables
-- already use. After this, email is just an editable detail.

-- 1. Stable link column on the roster.
alter table public.residents
  add column if not exists profile_id uuid references public.profiles(id) on delete set null;
create index if not exists residents_profile_id_idx on public.residents (profile_id);

-- 2. Backfill: claim each existing roster row for the account whose email
--    matches (within the same community). One-time migration of the old
--    email-based link to the new id-based link.
update public.residents r
set profile_id = p.id
from public.profiles p
where r.profile_id is null
  and p.community_id = r.community_id
  and r.email is not null
  and lower(p.email) = lower(r.email);

-- 3. Grant + policies. The board's existing "board writes" policy is
--    untouched; RLS combines permissive policies with OR, so the board can
--    still edit any row.
grant update on public.residents to authenticated;

-- 3a. A resident may CLAIM an unclaimed row that matches their email
--     (one-time), pinning it to their account id. After this, the email
--     match is never used again for that row.
drop policy if exists "residents claim own row by email" on public.residents;
create policy "residents claim own row by email"
  on public.residents for update to authenticated
  using (
    profile_id is null
    and community_id = (select community_id from public.profiles where id = auth.uid())
    and email is not null
    and lower(email) = lower((select email from public.profiles where id = auth.uid()))
  )
  with check ( profile_id = auth.uid() );

-- 3b. A resident may UPDATE their own (claimed) row — name, phone, email.
--     The with-check pins the row to them so they can't reassign or claim
--     someone else's record.
drop policy if exists "residents update own row" on public.residents;
create policy "residents update own row"
  on public.residents for update to authenticated
  using ( profile_id = auth.uid() )
  with check ( profile_id = auth.uid() );
