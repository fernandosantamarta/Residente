-- ============================================================
-- Residente — Special assessments as first-class charges
-- (FS 718.112(2)(c)/718.116 condo · FS 720.303(2)/720.3085 HOA)
-- Run once in the Supabase SQL editor. Idempotent / safe to re-run.
-- Depends on: communities, residents, profiles (custom-roles for roles),
--             stripe-webhook (marks charges paid by metadata).
-- ============================================================
--
-- A special assessment is a board-levied, one-off (or installment) charge laid
-- on every affected unit — post-Surfside, the #1 new money-in event. Modeled
-- like fines (ev_violations): each per-unit charge settles on ITS OWN row when
-- paid, and NEVER lands in public.payments — so it can't contaminate the
-- formula-based monthly-dues balance (lib/dues sums every payments row).
--
--   ev_special_assessments         — the campaign (title, per-unit amount, status)
--   ev_special_assessment_charges  — one row per affected unit per installment
--
-- Authorization: a special assessment must be properly noticed/voted per the
-- declaration + statute. The app records the board's authorization reference
-- (authorized_note / authorized_vote_id) and the UI requires it before a draft
-- can be levied — but the platform does not adjudicate whether the vote was
-- valid. ⚠ EDUCATIONAL, NOT LEGAL ADVICE — confirm notice + approval with the
-- association's attorney before levying.

-- ---------- 1) the campaign ----------
create table if not exists public.ev_special_assessments (
  id               uuid primary key default gen_random_uuid(),
  community_id     uuid not null references public.communities(id) on delete cascade,
  title            text not null,
  description      text,
  per_unit_amount  numeric not null check (per_unit_amount >= 0),
  installments     int not null default 1 check (installments between 1 and 60),
  effective_date   date,                       -- first installment due date basis
  status           text not null default 'draft'
                     check (status in ('draft','active','cancelled','completed')),
  authorized_vote_id uuid,                      -- optional link to a passed ev_votes row
  authorized_note  text,                        -- board authorization reference (meeting/motion/vote)
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists ev_special_assessments_community_idx
  on public.ev_special_assessments (community_id, created_at desc);

-- ---------- 2) per-unit charges ----------
create table if not exists public.ev_special_assessment_charges (
  id               uuid primary key default gen_random_uuid(),
  community_id     uuid not null references public.communities(id) on delete cascade,
  assessment_id    uuid not null references public.ev_special_assessments(id) on delete cascade,
  resident_id      uuid not null references public.residents(id) on delete cascade,
  installment_no   int not null default 1,
  amount           numeric not null check (amount >= 0),
  due_date         date,
  status           text not null default 'pending'
                     check (status in ('pending','paid','waived','reversed')),
  paid_at          timestamptz,
  stripe_session_id text,
  payment_account_id text,                      -- connected account it was charged on (for refunds)
  created_at       timestamptz not null default now(),
  unique (assessment_id, resident_id, installment_no)
);

create index if not exists ev_sa_charges_assessment_idx
  on public.ev_special_assessment_charges (assessment_id);
create index if not exists ev_sa_charges_resident_idx
  on public.ev_special_assessment_charges (resident_id, status);
create unique index if not exists ev_sa_charges_session_idx
  on public.ev_special_assessment_charges (stripe_session_id)
  where stripe_session_id is not null;

-- ---------- updated_at trigger on the campaign ----------
create or replace function public.ev_special_assessments_touch() returns trigger
language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists ev_special_assessments_touch_trg on public.ev_special_assessments;
create trigger ev_special_assessments_touch_trg
  before update on public.ev_special_assessments
  for each row execute function public.ev_special_assessments_touch();

-- ---------- grants ----------
grant references, trigger, truncate on public.ev_special_assessments to anon;
grant references, trigger, truncate on public.ev_special_assessment_charges to anon;
grant select, insert, update, delete on public.ev_special_assessments to authenticated;
grant select, insert, update, delete on public.ev_special_assessment_charges to authenticated;
grant select, insert, update, delete on public.ev_special_assessments to service_role;
grant select, insert, update, delete on public.ev_special_assessment_charges to service_role;

-- ---------- RLS: campaigns ----------
alter table public.ev_special_assessments enable row level security;

-- Members read their community's special assessments (so residents see what's
-- being levied); only active/cancelled/completed are meaningful to them, but the
-- charge-level RLS is what actually gates their money view.
drop policy if exists "members read special assessments" on public.ev_special_assessments;
create policy "members read special assessments"
  on public.ev_special_assessments for select to authenticated
  using (community_id = (select community_id from public.profiles where id = auth.uid()));

drop policy if exists "board writes special assessments" on public.ev_special_assessments;
create policy "board writes special assessments"
  on public.ev_special_assessments for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- ---------- RLS: charges ----------
alter table public.ev_special_assessment_charges enable row level security;

-- A resident reads (and can pay) their OWN special-assessment charges.
drop policy if exists "resident reads own sa charges" on public.ev_special_assessment_charges;
create policy "resident reads own sa charges"
  on public.ev_special_assessment_charges for select to authenticated
  using (
    exists (
      select 1 from public.residents r
      where r.id = ev_special_assessment_charges.resident_id
        and r.profile_id = auth.uid()
    )
  );

-- The board reads/writes its community's full charge ledger.
drop policy if exists "board manages sa charges" on public.ev_special_assessment_charges;
create policy "board manages sa charges"
  on public.ev_special_assessment_charges for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );
