-- ============================================================
-- Residente — Accounts payable + DUAL-CONTROL vendor disbursement
-- Run once in the Supabase SQL editor AFTER supabase/gl-spine.sql,
-- supabase/gl-writer.sql and supabase/custom-roles.sql.
-- Idempotent; safe to re-run.
-- ============================================================
-- Wave 1 of "eliminate the management company" — the one money task the platform
-- structurally could not do: pay a vendor bill with controls. POSTURE = "link,
-- don't hold" (see MONEY_FLOW_PLAN.md): the platform runs the full AP lifecycle —
-- capture -> code -> TWO-SIGNATURE approval -> record payment -> auto-reconcile —
-- but the money itself leaves through the board's OWN bank bill-pay. Residente
-- never touches funds. A real ACH-out provider is a later bolt-on on this spine.
--
-- WHAT THIS ADDS
--   • vendor_payout_methods — W-9 / COI / remittance per vendor (sensitive; board-only,
--                             NOT on the resident-readable `vendors` directory).
--   • vendor_bills          — the accounts-payable obligation (accrual).
--   • disbursements         — one authorization to pay a bill; the DUAL-CONTROL record.
--   • disbursement_approvals— each distinct approver (a person can't approve twice,
--                             and the approver can never be the initiator).
--   • GL chart account 2010 "Accounts payable" + source_types 'bill' / 'bill_payment'
--     (accrual: bill posts Dr expense / Cr 2010; payment posts Dr 2010 / Cr cash).
--     The GL stays a REGENERABLE PROJECTION — lib/gl/project.ts buildLedger() emits
--     these legs; app/api/admin/gl/rebuild persists them. The reconciliation matcher
--     auto-matches the cash leg against the Plaid money-out row with no changes.
--   • Two new permissions disbursements.initiate / disbursements.approve (mirror in
--     lib/permissions.ts), back-filled onto the Treasurer + Board member roles so
--     dual-control works out of the box. NOTE: this widens money authority on
--     existing communities the moment you run it — by design; the approver != initiator
--     wall below is the real guarantee, not the permission split.
--
-- COMPLIANCE: keep statutory text advisory (validated:false) — this file does not
-- certify legal language. Lien recording / foreclosure stay attorney-driven.

-- ============================================================
-- 1) CHART: Accounts-payable liability account + source_type enum
-- ============================================================
insert into public.gl_accounts (community_id, code, name, type, fund_hint, sort_order) values
  (null, '2010', 'Accounts payable', 'liability', 'operating', 55)
on conflict (coalesce(community_id, '00000000-0000-0000-0000-000000000000'::uuid), code) do nothing;

-- Extend the journal-entry source_type CHECK with 'bill' + 'bill_payment'. The list
-- MUST stay in sync with gl-spine.sql (reproduce it in full, then add the two).
alter table public.gl_journal_entries drop constraint if exists gl_journal_entries_source_type_check;
alter table public.gl_journal_entries
  add constraint gl_journal_entries_source_type_check check (source_type in (
    'accrual','opening_balance','interest','late_fee','payment','fine',
    'amenity','expense','reserve_open','reserve_transfer','bank_interest',
    'ach_return','manual_adjustment','bill','bill_payment'));

-- Shared updated_at touch used by the AP tables below.
create or replace function public.disbursements_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ============================================================
-- 2) VENDOR PAYOUT METHODS (W-9 / COI / remittance) — board-only, sensitive
-- ============================================================
-- Deliberately a SEPARATE table from public.vendors: residents can READ the vendor
-- directory, so tax/insurance/banking data must never live there.
create table if not exists public.vendor_payout_methods (
  id                 uuid primary key default gen_random_uuid(),
  community_id       uuid not null references public.communities(id) on delete cascade,
  vendor_id          uuid not null references public.vendors(id) on delete cascade,
  method             text not null default 'bank_bill_pay'
                       check (method in ('bank_bill_pay','check','ach','card','other')),
  remit_to_name      text,
  remit_to_address   text,
  payment_reference  text,                  -- our account number with the vendor
  w9_on_file         boolean not null default false,
  w9_tin_last4       text,                  -- last 4 only; never store a full TIN
  w9_storage_path    text,
  coi_on_file        boolean not null default false,
  coi_expires_on     date,                  -- drives an "insurance expired" warning at pay time
  coi_storage_path   text,
  bank_routing_last4 text,                  -- forward placeholders for the real-ACH bolt-on;
  bank_account_last4 text,                  -- v1 (bank bill-pay) never needs/uses these
  is_active          boolean not null default true,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (vendor_id)
);
create index if not exists vendor_payout_community_idx on public.vendor_payout_methods (community_id);

alter table public.vendor_payout_methods enable row level security;
grant references, trigger, truncate on public.vendor_payout_methods to anon;
grant select, insert, update, delete on public.vendor_payout_methods to authenticated;
grant all on public.vendor_payout_methods to service_role;

drop policy if exists "financials read payout methods" on public.vendor_payout_methods;
create policy "financials read payout methods"
  on public.vendor_payout_methods for select to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and public.has_permission('financials.view')
  );

drop policy if exists "financials write payout methods" on public.vendor_payout_methods;
create policy "financials write payout methods"
  on public.vendor_payout_methods for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and public.has_permission('financials.manage')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and public.has_permission('financials.manage')
  );

drop trigger if exists vendor_payout_touch on public.vendor_payout_methods;
create trigger vendor_payout_touch
  before update on public.vendor_payout_methods
  for each row execute function public.disbursements_touch_updated_at();

-- ============================================================
-- 3) VENDOR BILLS (accounts payable obligation)
-- ============================================================
create table if not exists public.vendor_bills (
  id                 uuid primary key default gen_random_uuid(),
  community_id       uuid not null references public.communities(id) on delete cascade,
  vendor_id          uuid references public.vendors(id) on delete set null,
  payee_name         text,                  -- for a one-off payee with no vendor row
  bill_number        text,                  -- the vendor's invoice number
  bill_date          date not null default current_date,
  due_date           date,
  amount             numeric(14,2) not null check (amount > 0),
  fund               text not null default 'operating' check (fund in ('operating','reserve')),
  gl_account_code    text not null default '5000',  -- expense account (5000 operating / 5010 reserve)
  budget_category_id uuid references public.budget_categories(id) on delete set null,
  contract_id        uuid,                  -- ev_contracts(id) when linked (no hard FK: install-order safe)
  description        text,
  invoice_storage_path text,                -- the scanned invoice (private bucket)
  status             text not null default 'open'
                       check (status in ('draft','open','paid','void')),
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists vendor_bills_community_status_idx on public.vendor_bills (community_id, status);
create index if not exists vendor_bills_vendor_idx on public.vendor_bills (vendor_id);

alter table public.vendor_bills enable row level security;
grant references, trigger, truncate on public.vendor_bills to anon;
grant select, insert, update, delete on public.vendor_bills to authenticated;
grant all on public.vendor_bills to service_role;

-- Capturing/coding a bill is financials.manage (low-risk); AUTHORIZING the payment
-- is the controlled action and goes through the dual-control RPCs in section 5.
drop policy if exists "financials read bills" on public.vendor_bills;
create policy "financials read bills"
  on public.vendor_bills for select to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and public.has_permission('financials.view')
  );

drop policy if exists "financials write bills" on public.vendor_bills;
create policy "financials write bills"
  on public.vendor_bills for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and public.has_permission('financials.manage')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and public.has_permission('financials.manage')
  );

-- A paid bill can't be silently re-coded (void + re-enter instead). The status flip
-- to 'paid' itself (done by disbursement_record_payment) is allowed because amount/
-- fund/account don't change in that update.
create or replace function public.guard_vendor_bill_locked() returns trigger
language plpgsql as $$
begin
  if old.status = 'paid' and (
        new.amount          is distinct from old.amount
     or new.fund            is distinct from old.fund
     or new.gl_account_code is distinct from old.gl_account_code
     or new.budget_category_id is distinct from old.budget_category_id
  ) then
    raise exception 'a paid bill cannot be re-coded; void and re-enter instead';
  end if;
  return new;
end $$;

drop trigger if exists vendor_bills_locked on public.vendor_bills;
create trigger vendor_bills_locked
  before update on public.vendor_bills
  for each row execute function public.guard_vendor_bill_locked();

drop trigger if exists vendor_bills_touch on public.vendor_bills;
create trigger vendor_bills_touch
  before update on public.vendor_bills
  for each row execute function public.disbursements_touch_updated_at();

-- ============================================================
-- 4) DISBURSEMENTS + APPROVALS — the dual-control record
-- ============================================================
create table if not exists public.disbursements (
  id                  uuid primary key default gen_random_uuid(),
  community_id        uuid not null references public.communities(id) on delete cascade,
  bill_id             uuid not null references public.vendor_bills(id) on delete cascade,
  amount              numeric(14,2) not null check (amount > 0),
  fund                text not null default 'operating' check (fund in ('operating','reserve')),
  method              text not null default 'bank_bill_pay'
                        check (method in ('bank_bill_pay','check','ach','card','other')),
  required_approvals  int not null default 1 check (required_approvals >= 1),
  status              text not null default 'initiated'
                        check (status in ('initiated','approved','paid','void')),
  initiated_by        uuid not null references public.profiles(id) on delete restrict,
  initiated_at        timestamptz not null default now(),
  approved_at         timestamptz,          -- when the last required approval landed
  paid_on             date,                 -- date the board executed the payment in their bank
  payment_reference   text,                 -- bank bill-pay confirmation number
  matched_bank_txn_id uuid references public.bank_transactions(id) on delete set null,
  idempotency_key     text not null,        -- guards against double-create / double-pay
  memo                text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (community_id, idempotency_key)
);
create index if not exists disbursements_community_status_idx on public.disbursements (community_id, status);
create index if not exists disbursements_bill_idx on public.disbursements (bill_id);

create table if not exists public.disbursement_approvals (
  id              uuid primary key default gen_random_uuid(),
  disbursement_id uuid not null references public.disbursements(id) on delete cascade,
  community_id    uuid not null references public.communities(id) on delete cascade,
  approver_id     uuid not null references public.profiles(id) on delete restrict,
  approved_at     timestamptz not null default now(),
  unique (disbursement_id, approver_id)     -- a person can't approve the same one twice
);
create index if not exists disbursement_approvals_disb_idx on public.disbursement_approvals (disbursement_id);

-- Reads for any financials.view officer; ALL WRITES go through the definer RPCs in
-- section 5 (mirrors the GL spine's "no write DML to authenticated").
alter table public.disbursements enable row level security;
alter table public.disbursement_approvals enable row level security;
grant select on public.disbursements to authenticated;
grant select on public.disbursement_approvals to authenticated;
grant all on public.disbursements to service_role;
grant all on public.disbursement_approvals to service_role;

drop policy if exists "financials read disbursements" on public.disbursements;
create policy "financials read disbursements"
  on public.disbursements for select to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and public.has_permission('financials.view')
  );

drop policy if exists "financials read disbursement approvals" on public.disbursement_approvals;
create policy "financials read disbursement approvals"
  on public.disbursement_approvals for select to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and public.has_permission('financials.view')
  );

-- A paid disbursement is immutable (defense-in-depth; reconciliation may still set
-- matched_bank_txn_id / updated_at after the fact).
create or replace function public.guard_disbursement_immutable() returns trigger
language plpgsql as $$
begin
  if old.status = 'paid' and (
        new.amount       is distinct from old.amount
     or new.bill_id      is distinct from old.bill_id
     or new.status       is distinct from old.status
     or new.paid_on      is distinct from old.paid_on
     or new.initiated_by is distinct from old.initiated_by
  ) then
    raise exception 'a paid disbursement is immutable';
  end if;
  return new;
end $$;

drop trigger if exists disbursements_immutable on public.disbursements;
create trigger disbursements_immutable
  before update on public.disbursements
  for each row execute function public.guard_disbursement_immutable();

drop trigger if exists disbursements_touch on public.disbursements;
create trigger disbursements_touch
  before update on public.disbursements
  for each row execute function public.disbursements_touch_updated_at();

-- ============================================================
-- 5) DUAL-CONTROL RPCs (SECURITY DEFINER, search_path='')
-- ============================================================

-- 5a) INITIATE — a financials.initiate officer proposes paying an open bill.
-- Idempotent on (community, idempotency_key): a retried call returns the same row.
create or replace function public.disbursement_initiate(
  p_bill            uuid,
  p_amount          numeric,
  p_method          text,
  p_idempotency_key text,
  p_memo            text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid          uuid;
  b            public.vendor_bills%rowtype;
  v_committed  numeric;
  v_existing   uuid;
  v_id         uuid;
begin
  if not public.has_permission('disbursements.initiate') then
    raise exception 'not allowed to initiate disbursements';
  end if;
  if coalesce(btrim(p_idempotency_key), '') = '' then
    raise exception 'an idempotency key is required';
  end if;

  select community_id into cid from public.profiles where id = auth.uid();
  if cid is null then raise exception 'not a member of any community'; end if;

  -- Short-circuit a retry before touching anything else.
  select id into v_existing from public.disbursements
   where community_id = cid and idempotency_key = btrim(p_idempotency_key);
  if v_existing is not null then return v_existing; end if;

  select * into b from public.vendor_bills where id = p_bill;
  if not found or b.community_id <> cid then
    raise exception 'bill is not in your community';
  end if;
  if b.status <> 'open' then
    raise exception 'only an open bill can be paid (status is %)', b.status;
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'amount must be positive';
  end if;

  -- No overpay: committed (non-void) disbursements + this one must not exceed the bill.
  select coalesce(sum(amount), 0) into v_committed
    from public.disbursements where bill_id = p_bill and status <> 'void';
  if round(v_committed + p_amount, 2) > round(b.amount, 2) then
    raise exception 'disbursement exceeds the remaining bill balance (% of %)',
      round(b.amount - v_committed, 2), b.amount;
  end if;

  insert into public.disbursements
    (community_id, bill_id, amount, fund, method, initiated_by, idempotency_key, memo)
  values
    (cid, p_bill, round(p_amount, 2), b.fund,
     coalesce(nullif(btrim(p_method), ''), 'bank_bill_pay'),
     auth.uid(), btrim(p_idempotency_key), p_memo)
  returning id into v_id;

  begin
    insert into public.ev_audit_log (community_id, event_type, target_type, target_id, metadata)
    values (cid, 'disbursement.initiated', 'disbursement', v_id,
            jsonb_build_object('bill', p_bill, 'amount', round(p_amount, 2)));
  exception when others then null;
  end;

  return v_id;
end $$;

revoke all on function public.disbursement_initiate(uuid, numeric, text, text, text) from public, anon;
grant execute on function public.disbursement_initiate(uuid, numeric, text, text, text) to authenticated;

-- 5b) APPROVE — a SECOND, distinct officer signs. The approver can never be the
-- initiator. Reaching required_approvals flips the disbursement to 'approved'.
create or replace function public.disbursement_approve(p_disbursement uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid     uuid;
  d       public.disbursements%rowtype;
  v_count int;
begin
  if not public.has_permission('disbursements.approve') then
    raise exception 'not allowed to approve disbursements';
  end if;
  select community_id into cid from public.profiles where id = auth.uid();
  if cid is null then raise exception 'not a member of any community'; end if;

  select * into d from public.disbursements where id = p_disbursement;
  if not found or d.community_id <> cid then
    raise exception 'disbursement is not in your community';
  end if;
  if d.status <> 'initiated' then
    raise exception 'only an initiated disbursement can be approved (status is %)', d.status;
  end if;
  -- THE DUAL-CONTROL WALL: the person who initiated cannot be an approver.
  if d.initiated_by = auth.uid() then
    raise exception 'the initiator cannot approve their own disbursement';
  end if;

  -- Record this approval (unique constraint blocks a second approval by the same person).
  begin
    insert into public.disbursement_approvals (disbursement_id, community_id, approver_id)
    values (p_disbursement, cid, auth.uid());
  exception when unique_violation then
    raise exception 'you have already approved this disbursement';
  end;

  select count(*) into v_count from public.disbursement_approvals
   where disbursement_id = p_disbursement;

  if v_count >= d.required_approvals then
    update public.disbursements
       set status = 'approved', approved_at = now()
     where id = p_disbursement;
  end if;

  begin
    insert into public.ev_audit_log (community_id, event_type, target_type, target_id, metadata)
    values (cid, 'disbursement.approved', 'disbursement', p_disbursement,
            jsonb_build_object('approvals', v_count, 'required', d.required_approvals));
  exception when others then null;
  end;

  return case when v_count >= d.required_approvals then 'approved' else 'initiated' end;
end $$;

revoke all on function public.disbursement_approve(uuid) from public, anon;
grant execute on function public.disbursement_approve(uuid) to authenticated;

-- 5c) RECORD PAYMENT — after dual-control, the officer who executed the payment in
-- the HOA's own bank records it (paid_on + confirmation). This is the only step that
-- moves the bill to 'paid' and lets the GL post the cash leg on the next rebuild.
create or replace function public.disbursement_record_payment(
  p_disbursement uuid,
  p_paid_on      date,
  p_reference    text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid       uuid;
  d         public.disbursements%rowtype;
  v_paid    numeric;
  v_bill    numeric;
begin
  if not (public.has_permission('disbursements.initiate')
          or public.has_permission('financials.manage')) then
    raise exception 'not allowed to record payments';
  end if;
  select community_id into cid from public.profiles where id = auth.uid();
  if cid is null then raise exception 'not a member of any community'; end if;

  select * into d from public.disbursements where id = p_disbursement;
  if not found or d.community_id <> cid then
    raise exception 'disbursement is not in your community';
  end if;
  if d.status <> 'approved' then
    raise exception 'a disbursement must be approved before it is paid (status is %)', d.status;
  end if;

  update public.disbursements
     set status = 'paid',
         paid_on = coalesce(p_paid_on, current_date),
         payment_reference = nullif(btrim(p_reference), '')
   where id = p_disbursement;

  -- Mark the bill paid once paid disbursements cover it.
  select coalesce(sum(amount), 0) into v_paid
    from public.disbursements where bill_id = d.bill_id and status = 'paid';
  select amount into v_bill from public.vendor_bills where id = d.bill_id;
  if round(v_paid, 2) >= round(v_bill, 2) then
    update public.vendor_bills set status = 'paid' where id = d.bill_id;
  end if;

  begin
    insert into public.ev_audit_log (community_id, event_type, target_type, target_id, metadata)
    values (cid, 'disbursement.paid', 'disbursement', p_disbursement,
            jsonb_build_object('bill', d.bill_id, 'amount', d.amount,
                               'paid_on', coalesce(p_paid_on, current_date)));
  exception when others then null;
  end;
end $$;

revoke all on function public.disbursement_record_payment(uuid, date, text) from public, anon;
grant execute on function public.disbursement_record_payment(uuid, date, text) to authenticated;

-- 5d) VOID — cancel a disbursement that has NOT been paid. (A paid one needs a
-- reversal, which is out of v1 scope.)
create or replace function public.disbursement_void(p_disbursement uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  d   public.disbursements%rowtype;
begin
  if not (public.has_permission('disbursements.initiate')
          or public.has_permission('financials.manage')) then
    raise exception 'not allowed';
  end if;
  select community_id into cid from public.profiles where id = auth.uid();
  if cid is null then raise exception 'not a member of any community'; end if;

  select * into d from public.disbursements where id = p_disbursement;
  if not found or d.community_id <> cid then
    raise exception 'disbursement is not in your community';
  end if;
  if d.status not in ('initiated', 'approved') then
    raise exception 'only an unpaid disbursement can be voided (status is %)', d.status;
  end if;

  update public.disbursements set status = 'void' where id = p_disbursement;

  begin
    insert into public.ev_audit_log (community_id, event_type, target_type, target_id, metadata)
    values (cid, 'disbursement.voided', 'disbursement', p_disbursement,
            jsonb_build_object('reason', nullif(btrim(p_reason), '')));
  exception when others then null;
  end;
end $$;

revoke all on function public.disbursement_void(uuid, text) from public, anon;
grant execute on function public.disbursement_void(uuid, text) to authenticated;

-- ============================================================
-- 6) PERMISSIONS — new keys + back-fill onto existing money roles
-- ============================================================
-- Mirror these keys in lib/permissions.ts. Granting them to existing roles makes
-- dual-control usable immediately: Treasurer can initiate AND be one approver; a
-- Board member supplies the second, distinct signature. Idempotent (append-if-absent).
update public.ev_roles set permissions = array_append(permissions, 'disbursements.initiate')
  where name = 'Treasurer' and not is_admin and not ('disbursements.initiate' = any(permissions));
update public.ev_roles set permissions = array_append(permissions, 'disbursements.approve')
  where name = 'Treasurer' and not is_admin and not ('disbursements.approve' = any(permissions));
update public.ev_roles set permissions = array_append(permissions, 'disbursements.approve')
  where name = 'Board member' and not is_admin and not ('disbursements.approve' = any(permissions));
