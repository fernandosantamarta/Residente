-- ============================================================
-- Residente — Offline payment posting (check / cash / money order / bill-pay)
-- Run once in the Supabase SQL editor. Safe to re-run (idempotent).
-- ============================================================
--
-- Until now the ONLY writer to public.payments was the stripe-webhook. Any
-- community with check payers had no way to record a payment without editing
-- residents.opening_balance — which silently falsifies residentBalance(),
-- casePayoff(), estoppel certificates, and the GL AR tie-out. This adds an
-- append-only, audited write path the board can use.
--
-- DUES ONLY — by design. Every payments row is a DUES payment: that invariant is
-- what lib/dues.ts (sumPayments) and lib/gl/project.ts (credit AR 1100 for every
-- roster payment) both rely on, and it is what makes the GL tie out to
-- Σ residentBalance() by construction. So this RPC NEVER records a fine or
-- amenity payment:
--   • fines collected offline  -> mark the violation manual-paid (lib/violations.ts
--                                 markManualPaid); the GL recognizes that as fine
--                                 revenue (project.ts), and NO payments row is made.
--   • amenities                -> the reservation is flipped to paid; no payments row.
-- charge_type is therefore left NULL ("ordinary dues payment", per collections.sql).
--
-- CORRECTIONS are negative contra rows, never edits/deletes — the ledger stays
-- append-only and audit-complete. A negative amount is rejected unless it names
-- the payment it reverses.

-- ---------- columns ----------
alter table public.payments
  add column if not exists method       text,   -- how the money arrived (offline + future ACH/card)
  add column if not exists memo          text,   -- free-text note (check #, "voids payment …", etc.)
  add column if not exists recorded_by   uuid,   -- auth.uid() of the officer; NULL for Stripe/system writes
  add column if not exists client_key    text;   -- RPC idempotency key (a retry reuses it -> no double post)

-- Forward-compatible with the ACH-in work (Wave 2 / Step 3) and a future card tag.
alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check
  check (method is null or method in
    ('cash','check','money_order','ach','card','bill_pay','other'));

-- One offline post per (community, client_key): the idempotency backstop.
create unique index if not exists payments_client_key_key
  on public.payments (community_id, client_key) where client_key is not null;

create index if not exists payments_recorded_by_idx on public.payments (recorded_by);

-- ---------- the offline write path: record_offline_payment ----------
-- SECURITY DEFINER + payments.manage-gated, mirroring gl_post_manual_adjustment.
-- payments.manage is the permission that already gates board payment writes
-- (roles-rls-financials.sql) — Treasurer and above. We use it (NOT profiles.role)
-- so the seeded custom roles work; reads stay governed by the existing policies.
--
-- p_amount > 0 : an ordinary offline dues payment.
-- p_amount < 0 : a correction — ALLOWED ONLY when p_corrects names the payment it
--                reverses. Stored as a contra row (append-only); nothing is edited.
create or replace function public.record_offline_payment(
  p_community  uuid,
  p_resident   uuid,
  p_amount     numeric,
  p_method     text,
  p_paid_on    date,
  p_memo       text    default null,
  p_client_key text    default null,
  p_corrects   uuid    default null,
  p_case       uuid    default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  cid        uuid;
  v_existing uuid;
  v_payment  uuid;
begin
  if not public.has_permission('payments.manage') then
    raise exception 'not allowed';
  end if;

  select community_id into cid from public.profiles where id = auth.uid();
  if cid is null or cid <> p_community then
    raise exception 'not a member of this community';
  end if;

  if p_method is null or p_method not in
       ('cash','check','money_order','ach','bill_pay','other') then
    raise exception 'invalid offline payment method %', p_method;
  end if;

  if p_amount is null or round(p_amount, 2) = 0 then
    raise exception 'amount must be non-zero';
  end if;

  if not exists (select 1 from public.residents
                 where id = p_resident and community_id = p_community) then
    raise exception 'resident is not in this community';
  end if;

  -- Corrections only: a negative amount must reference the payment it reverses.
  if round(p_amount, 2) < 0 then
    if p_corrects is null then
      raise exception 'a negative (correction) amount must reference the payment it corrects';
    end if;
    if not exists (select 1 from public.payments
                   where id = p_corrects and community_id = p_community) then
      raise exception 'corrected payment % not found in this community', p_corrects;
    end if;
  end if;

  -- An applied_to_case tag (collections detail) must belong to this community.
  if p_case is not null and not exists (
       select 1 from public.ev_collection_cases
       where id = p_case and community_id = p_community) then
    raise exception 'collection case % not in this community', p_case;
  end if;

  -- Idempotency: a retry with the same client_key returns the original row.
  if p_client_key is not null then
    select id into v_existing from public.payments
      where community_id = p_community and client_key = p_client_key limit 1;
    if v_existing is not null then return v_existing; end if;
  end if;

  begin
    insert into public.payments
      (community_id, resident_id, amount, paid_on, method, memo,
       recorded_by, client_key, applied_to_case)
    values
      (p_community, p_resident, round(p_amount, 2), coalesce(p_paid_on, current_date),
       p_method, p_memo, auth.uid(), p_client_key, p_case)
    returning id into v_payment;
  exception when unique_violation then
    -- A concurrent call with the same client_key won the race; return its row.
    select id into v_payment from public.payments
      where community_id = p_community and client_key = p_client_key limit 1;
    return v_payment;
  end;

  -- Best-effort audit (never block the posting on the audit insert).
  begin
    insert into public.ev_audit_log (community_id, event_type, target_type, target_id)
    values (p_community,
            case when round(p_amount, 2) < 0
                 then 'financial.offline_payment_correction'
                 else 'financial.offline_payment' end,
            'payment', v_payment);
  exception when others then null;
  end;

  return v_payment;
end $$;

revoke all on function public.record_offline_payment(uuid,uuid,numeric,text,date,text,text,uuid,uuid)
  from public, anon;
grant execute on function public.record_offline_payment(uuid,uuid,numeric,text,date,text,text,uuid,uuid)
  to authenticated;

-- ---------- guard the payment-received receipt against contra rows ----------
-- payment_notify_received() (request-payment-notices.sql) fires on EVERY payments
-- insert and emails "Payment received: $<amount>. Thank you!". A correction is a
-- negative contra row (and a future ACH return will be too) — skip those so no one
-- gets a thank-you for a reversal. Positive offline payments still send the receipt.
create or replace function public.payment_notify_received()
returns trigger language plpgsql security definer as $$
declare nid uuid;
        pid uuid;
        amt text := trim(to_char(new.amount, 'FM999G999G990D00'));
begin
  if new.amount is null or new.amount <= 0 then return new; end if;  -- contra/reversal: no receipt

  select profile_id into pid from public.residents where id = new.resident_id;
  if pid is null then return new; end if;

  insert into public.ev_notices (community_id, kind, channels, subject, body, sent_by)
  values (
    new.community_id,
    'payment_received',
    array[]::text[],
    'Payment received: $' || amt,
    'We received your payment of $' || amt
      || ' on ' || to_char(new.paid_on, 'FMMon FMDD, YYYY') || '. Thank you!',
    null
  )
  returning id into nid;

  insert into public.ev_notice_recipients (notice_id, community_id, profile_id, channel)
  values (nid, new.community_id, pid, 'in_app')
  on conflict (notice_id, profile_id, channel) do nothing;

  return new;
end $$;
-- (trigger payment_notify_received_trg already bound in request-payment-notices.sql)
