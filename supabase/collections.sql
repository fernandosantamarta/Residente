-- ============================================================
-- Residente — Assessments, Liens & Collections (FS 718.116/.121 condo / FS 720.3085/.305 HOA)
-- Run once in the Supabase SQL editor. Safe to re-run.
-- Depends on: compliance-foundation.sql (communities profile cols, ev_notices
--             kinds) and easy-voice.sql (ev_notices / ev_notice_recipients).
-- ============================================================
--
-- A board works a delinquent owner through the statutory collection ladder on
-- /admin/collections: delinquent → 30-day notice of late assessment → 45-day
-- notice of intent to record a claim of lien → claim of lien recorded → 45-day
-- notice of intent to foreclose → foreclosure. The day-counts, the lien
-- enforcement window (condo 1 yr / HOA 5 yr), the certified-mail rule, and the
-- payoff math live in lib/compliance/collections.ts + lib/dues.ts; the app
-- stamps the stage timestamps when it logs a notice. Each statutory notice
-- fires a PERSONAL in-app courtesy notice to the owner (profile_id) only — same
-- pattern as ev_violations / ev_estoppel_requests. Posture: advisory, never
-- blocking. Every generated letter / ledger carries the attorney-review gate.

-- ---------- ev_collection_cases: the per-owner escalation case ----------
create table if not exists public.ev_collection_cases (
  id                           uuid primary key default gen_random_uuid(),
  community_id                 uuid not null references public.communities(id) on delete cascade,
  profile_id                   uuid references public.profiles(id) on delete set null,  -- the owner (if a linked account)
  resident_id                  uuid references public.residents(id) on delete set null,
  unit_label                   text,            -- denormalized "Name · Unit"
  stage                        text not null default 'delinquent'
                                 check (stage in ('delinquent','notice_30','intent_to_lien','lien_recorded',
                                                  'intent_to_foreclose','foreclosure','resolved','cancelled')),
  opened_at                    date not null default current_date,
  delinquent_since             date,            -- first installment that went unpaid
  -- stage timestamps (denormalized from ev_collection_notices for fast signal math)
  notice_30_sent_at            date,
  intent_to_lien_sent_at       date,
  lien_recorded_at             date,
  intent_to_foreclose_sent_at  date,
  foreclosure_filed_at         date,
  resolved_at                  date,
  -- money snapshot (dollars); the authoritative payoff is recomputed in lib/dues.ts casePayoff()
  principal_balance            numeric,
  interest_balance             numeric,
  late_fee_balance             numeric,
  cost_balance                 numeric,         -- recorded collection / attorney costs
  total_balance                numeric,
  -- flags
  is_fine_only                 boolean not null default false,  -- HOA: case driven only by an unpaid fine (HB 1203 $1k floor)
  on_payment_plan              boolean not null default false,
  notes                        text,
  created_by                   uuid references public.profiles(id) on delete set null,
  created_at                   timestamptz not null default now()
);

create index if not exists ev_collection_cases_community_idx on public.ev_collection_cases (community_id, opened_at desc);
create index if not exists ev_collection_cases_profile_idx   on public.ev_collection_cases (profile_id);
create index if not exists ev_collection_cases_stage_idx     on public.ev_collection_cases (community_id, stage);
create index if not exists ev_collection_cases_resident_idx  on public.ev_collection_cases (resident_id);

alter table public.ev_collection_cases enable row level security;
grant select, insert, update, delete on public.ev_collection_cases to authenticated;
grant select, insert, update, delete on public.ev_collection_cases to service_role;

-- Owner sees only their own case.
drop policy if exists "owner reads own collection case" on public.ev_collection_cases;
create policy "owner reads own collection case"
  on public.ev_collection_cases for select to authenticated
  using ( profile_id = auth.uid() );

-- Board sees + manages every collection case in their community.
drop policy if exists "board reads community collection cases" on public.ev_collection_cases;
create policy "board reads community collection cases"
  on public.ev_collection_cases for select to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

drop policy if exists "board writes community collection cases" on public.ev_collection_cases;
create policy "board writes community collection cases"
  on public.ev_collection_cases for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- ---------- ev_collection_notices: the statutory notice ledger ----------
create table if not exists public.ev_collection_notices (
  id                 uuid primary key default gen_random_uuid(),
  community_id       uuid not null references public.communities(id) on delete cascade,
  case_id            uuid not null references public.ev_collection_cases(id) on delete cascade,
  kind               text not null
                       check (kind in ('late_assessment_30','intent_to_lien_45','intent_to_foreclose_45',
                                       'tenant_rent_demand','detailed_accounting')),
  sent_at            date not null default current_date,
  method             text check (method in ('certified_mail','first_class','both','electronic','hand')),
  tracking_number    text,            -- certified / registered mail tracking #
  return_receipt_at  date,            -- date the green card / receipt came back
  recipient_name     text,            -- who it was addressed to (owner or tenant)
  -- dual-address evidence (see collections-addresses.sql for the full rationale):
  -- the statutory collection notices must be mailed to the owner's record address
  -- AND, if different, the unit/parcel address ("deemed delivered upon mailing").
  mailed_to_record_address text,       -- owner's last address per association records
  mailed_to_unit_address   text,       -- unit/parcel address (set only when it differs)
  dual_address_required     boolean,    -- the two differed, so a second copy was required
  document_id        uuid references public.documents(id) on delete set null,  -- the generated letter, if stored
  notes              text,
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now()
);

create index if not exists ev_collection_notices_case_idx      on public.ev_collection_notices (case_id, sent_at desc);
create index if not exists ev_collection_notices_community_idx  on public.ev_collection_notices (community_id, sent_at desc);

alter table public.ev_collection_notices enable row level security;
grant select, insert, update, delete on public.ev_collection_notices to authenticated;
grant select, insert, update, delete on public.ev_collection_notices to service_role;

-- Owner reads notices on their own case (via the parent case's profile_id).
drop policy if exists "owner reads own collection notices" on public.ev_collection_notices;
create policy "owner reads own collection notices"
  on public.ev_collection_notices for select to authenticated
  using (
    exists (
      select 1 from public.ev_collection_cases cc
      where cc.id = ev_collection_notices.case_id and cc.profile_id = auth.uid()
    )
  );

drop policy if exists "board reads community collection notices" on public.ev_collection_notices;
create policy "board reads community collection notices"
  on public.ev_collection_notices for select to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

drop policy if exists "board writes community collection notices" on public.ev_collection_notices;
create policy "board writes community collection notices"
  on public.ev_collection_notices for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- ---------- ev_payment_plans: a structured installment plan on a case ----------
create table if not exists public.ev_payment_plans (
  id                  uuid primary key default gen_random_uuid(),
  community_id        uuid not null references public.communities(id) on delete cascade,
  case_id             uuid not null references public.ev_collection_cases(id) on delete cascade,
  status              text not null default 'active'
                        check (status in ('active','completed','defaulted','cancelled')),
  start_date          date not null default current_date,
  installment_amount  numeric,
  installment_count   int,
  frequency_days      int not null default 30,   -- 30 = monthly
  next_due_at         date,
  paid_count          int not null default 0,
  notes               text,
  created_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now()
);

create index if not exists ev_payment_plans_case_idx      on public.ev_payment_plans (case_id);
create index if not exists ev_payment_plans_community_idx  on public.ev_payment_plans (community_id, status);

alter table public.ev_payment_plans enable row level security;
grant select, insert, update, delete on public.ev_payment_plans to authenticated;
grant select, insert, update, delete on public.ev_payment_plans to service_role;

drop policy if exists "owner reads own payment plans" on public.ev_payment_plans;
create policy "owner reads own payment plans"
  on public.ev_payment_plans for select to authenticated
  using (
    exists (
      select 1 from public.ev_collection_cases cc
      where cc.id = ev_payment_plans.case_id and cc.profile_id = auth.uid()
    )
  );

drop policy if exists "board reads community payment plans" on public.ev_payment_plans;
create policy "board reads community payment plans"
  on public.ev_payment_plans for select to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

drop policy if exists "board writes community payment plans" on public.ev_payment_plans;
create policy "board writes community payment plans"
  on public.ev_payment_plans for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- ---------- ALTER payments: per-charge ledger tagging ----------
-- charge_type lets a board tag a payment to a statutory bucket; applied_to_case
-- links a payment to the collection case it satisfies. Both nullable — existing
-- dues payments are untouched (NULL = ordinary dues payment).
alter table public.payments
  add column if not exists charge_type text
    check (charge_type is null or charge_type in ('assessment','interest','late_fee','cost','fine','other')),
  add column if not exists applied_to_case uuid references public.ev_collection_cases(id) on delete set null;

-- ---------- ALTER residents: owner mailing address + tenant (rent-demand) ----------
-- last_known_address = the OWNER'S MAILING ADDRESS OF RECORD (the off-site address
-- an absentee owner furnished). The physical UNIT/PARCEL address is the existing
-- residents.address column. The statutory collection notices go to both when they
-- differ — see collections-addresses.sql and lib/compliance/collections.ts.
alter table public.residents
  add column if not exists last_known_address text,
  add column if not exists is_rented   boolean not null default false,
  add column if not exists tenant_name  text,
  add column if not exists tenant_email text,
  add column if not exists tenant_phone text;

-- ---------- ev_notices.kind: add the collections kinds (append-only) ----------
alter table public.ev_notices drop constraint if exists ev_notices_kind_check;
alter table public.ev_notices add constraint ev_notices_kind_check
  check (kind in ('meeting_published','meeting_reminder','document_uploaded',
                  'vote_opened','vote_reminder','vote_results','minutes_published',
                  'proxy_submitted','custom_broadcast','amenity_booked','dues_due',
                  'compliance_alert','estoppel_update',
                  'collections_deadline','collections_update'));

-- ---------- INTERCONNECT: collection notice logged -> PERSONAL notice ----------
-- When the board logs a statutory notice on a case, send a PERSONAL in-app
-- courtesy notice to ONLY the owner (the case's profile_id). channels =
-- ['personal'] so the broadcast fanout skips it; we add one recipient row.
-- security definer: a resident's session can't write ev_notices / other
-- people's recipient rows under RLS.
create or replace function public.ev_collection_notice_notify()
returns trigger language plpgsql security definer as $$
declare
  nid        uuid;
  v_profile  uuid;
  v_community uuid;
  v_subject  text;
begin
  select cc.profile_id, cc.community_id
    into v_profile, v_community
    from public.ev_collection_cases cc
   where cc.id = new.case_id;

  if v_profile is null then
    return new;
  end if;

  v_subject := case new.kind
    when 'late_assessment_30'     then 'Notice of late assessment'
    when 'intent_to_lien_45'      then 'Notice of intent to record a lien'
    when 'intent_to_foreclose_45' then 'Notice of intent to foreclose'
    when 'tenant_rent_demand'     then 'Demand for rent'
    when 'detailed_accounting'    then 'Account statement available'
    else 'Account update' end;

  insert into public.ev_notices (community_id, kind, channels, subject, body, sent_by)
  values (
    coalesce(new.community_id, v_community),
    'collections_update',
    array['personal'],   -- NOT 'in_app' → broadcast fanout skips this notice
    v_subject,
    'Your association has recorded a collection notice on your account. '
      || 'Open Easy Track to review your balance and payment options.',
    new.created_by
  )
  returning id into nid;

  insert into public.ev_notice_recipients (notice_id, community_id, profile_id, channel)
  values (nid, coalesce(new.community_id, v_community), v_profile, 'in_app')
  on conflict (notice_id, profile_id, channel) do nothing;

  return new;
end $$;

drop trigger if exists ev_collection_notice_notify_trg on public.ev_collection_notices;
create trigger ev_collection_notice_notify_trg
  after insert on public.ev_collection_notices
  for each row execute function public.ev_collection_notice_notify();
