-- ============================================================
-- Residente — Emergency vendor dispatch (Wave 1 item 2, slice 2C)
-- Run once in the Supabase SQL editor AFTER supabase/emergency-dispatch.sql,
-- supabase/work-orders.sql and supabase/disbursements.sql. Idempotent.
-- ============================================================
-- The on-call director turns a live emergency into action in ONE step:
-- dispatch a vendor (a work order) AND pre-authorize payment — bypassing the
-- normal two-signature wall WHEN the amount is within the community's emergency
-- spend cap. Above the cap (or cap = 0) it falls back to full dual-control. This
-- maps to the FL procurement "emergency" exemption.
--
-- WIRING: dispatch writes straight onto the money-OUT spine (disbursements.sql):
--   * a work_orders row (priority 'emergency')                — the dispatch
--   * a vendor_bills row, status 'open'                       — Dr expense / Cr 2010 (AP)
--   * a disbursements row                                     — 'approved' (<= cap) or 'initiated' (> cap)
-- The cash leg posts only when the board records the real bank payment in
-- Payables (status -> 'paid'), so "link, don't hold" is preserved.
--
-- GOVERNANCE: the auto-approval is governed by the dollar CAP, not by whether a
-- vendor was pre-designated — so an unanticipated emergency is never blocked for
-- lack of setup. emergency_vendors is a convenience registry (a suggested vendor
-- per category in the dispatch picker), not a gate.

-- ============================================================
-- 1) PER-COMMUNITY EMERGENCY SPEND CAP
-- ============================================================
-- The dollar threshold under which the on-call director may auto-authorize an
-- emergency payment without a second signature. Default $2,500. Set to 0 to
-- require dual-control for every emergency payment (no exemption).
alter table public.communities
  add column if not exists emergency_spend_cap numeric(14,2) not null default 2500;

-- Set the cap. Gated to a money/owner officer (NOT plain voice.manage) — the cap
-- is a spending-authority policy, so it stays with the people who own the books.
create or replace function public.emergency_set_cap(p_cap numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare cid uuid;
begin
  if not (public.has_permission('financials.manage') or public.has_permission('community.manage')) then
    raise exception 'not allowed to set the emergency spend cap';
  end if;
  select community_id into cid from public.profiles where id = auth.uid();
  if cid is null then raise exception 'not a member of any community'; end if;
  if coalesce(p_cap, 0) < 0 then raise exception 'the cap cannot be negative'; end if;

  update public.communities set emergency_spend_cap = round(coalesce(p_cap, 0), 2) where id = cid;

  begin
    insert into public.ev_audit_log (community_id, event_type, target_type, target_id, metadata)
    values (cid, 'emergency.cap_set', 'community', cid, jsonb_build_object('cap', round(coalesce(p_cap, 0), 2)));
  exception when others then null;
  end;
end $$;
revoke all on function public.emergency_set_cap(numeric) from public, anon;
grant execute on function public.emergency_set_cap(numeric) to authenticated;

-- ============================================================
-- 2) PRE-AUTHORIZED EMERGENCY VENDORS (suggested default per category)
-- ============================================================
create table if not exists public.emergency_vendors (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  vendor_id    uuid not null references public.vendors(id) on delete cascade,
  category     text not null
                 check (category in ('water','fire','electrical','security','structural','medical','other')),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (community_id, category)   -- one designated vendor per emergency category
);
create index if not exists emergency_vendors_community_idx on public.emergency_vendors (community_id);

alter table public.emergency_vendors enable row level security;
grant references, trigger, truncate on public.emergency_vendors to anon;
grant select, insert, update, delete on public.emergency_vendors to authenticated;
grant all on public.emergency_vendors to service_role;

drop policy if exists "board reads emergency vendors" on public.emergency_vendors;
create policy "board reads emergency vendors"
  on public.emergency_vendors for select to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (
      public.has_permission('voice.manage')
      or (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
    )
  );

drop policy if exists "voice writes emergency vendors" on public.emergency_vendors;
create policy "voice writes emergency vendors"
  on public.emergency_vendors for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and public.has_permission('voice.manage')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and public.has_permission('voice.manage')
  );

-- ============================================================
-- 3) DISPATCH — work order + bill + (cap-governed) disbursement, atomically
-- ============================================================
create or replace function public.emergency_dispatch(
  p_event       uuid,
  p_vendor      uuid default null,
  p_payee_name  text default null,
  p_amount      numeric default 0,
  p_description text default null,
  p_fund        text default 'operating'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid        uuid;
  ev         public.emergency_events%rowtype;
  v_cap      numeric;
  v_fund     text;
  v_amt      numeric;
  v_acct     text;
  v_wo       uuid;
  v_bill     uuid;
  v_disb     uuid;
  v_auto     boolean;
begin
  select * into ev from public.emergency_events where id = p_event;
  if not found then raise exception 'emergency not found'; end if;
  cid := ev.community_id;

  -- Authority = the on-call roster or a voice.manage officer. The board grants
  -- emergency spend authority by who they place on call + the cap they set.
  select community_id into cid from public.profiles where id = auth.uid() and community_id = ev.community_id;
  if cid is null then raise exception 'emergency is not in your community'; end if;
  if not (public.has_permission('voice.manage')
          or exists (select 1 from public.on_call_contacts where profile_id = auth.uid() and community_id = cid)) then
    raise exception 'not allowed to dispatch emergency vendors';
  end if;

  v_amt := round(coalesce(p_amount, 0), 2);
  if v_amt <= 0 then raise exception 'a positive estimated amount is required'; end if;
  if p_vendor is null and coalesce(btrim(p_payee_name), '') = '' then
    raise exception 'pick a vendor or enter a payee'; end if;

  v_fund := case when p_fund = 'reserve' then 'reserve' else 'operating' end;
  v_acct := case when v_fund = 'reserve' then '5010' else '5000' end;
  select coalesce(emergency_spend_cap, 0) into v_cap from public.communities where id = cid;
  v_auto := (v_cap > 0 and v_amt <= v_cap);

  -- 3a) the dispatch (work order)
  insert into public.work_orders
    (community_id, vendor_id, assigned_by, title, description, priority, status, estimated_cost)
  values
    (cid, p_vendor, auth.uid(),
     '🚨 ' || upper(coalesce(nullif(ev.category, ''), 'emergency')) || ' emergency',
     coalesce(nullif(btrim(p_description), ''), ev.description),
     'emergency', 'assigned', v_amt)
  returning id into v_wo;

  -- 3b) the obligation (open bill -> posts Dr expense / Cr 2010 on next GL rebuild)
  insert into public.vendor_bills
    (community_id, vendor_id, payee_name, amount, fund, gl_account_code, description, status, created_by)
  values
    (cid, p_vendor, case when p_vendor is null then nullif(btrim(p_payee_name), '') else null end,
     v_amt, v_fund, v_acct,
     'Emergency dispatch — ' || coalesce(nullif(btrim(p_description), ''), ev.description),
     'open', auth.uid())
  returning id into v_bill;

  -- 3c) the payment authorization (cap-governed). Within the cap it is
  -- auto-approved (dual-control exemption); above it, it queues for two
  -- signatures via the normal Payables flow. Idempotency key ties it to the WO.
  insert into public.disbursements
    (community_id, bill_id, amount, fund, method, initiated_by, idempotency_key, memo,
     status, approved_at)
  values
    (cid, v_bill, v_amt, v_fund, 'bank_bill_pay', auth.uid(),
     'emergency:' || v_wo::text,
     case when v_auto
          then 'Emergency auto-authorization within $' || v_cap::text || ' cap (event ' || p_event::text || ')'
          else 'Emergency dispatch over cap — needs a second approval' end,
     case when v_auto then 'approved' else 'initiated' end,
     case when v_auto then now() else null end)
  returning id into v_disb;

  -- 3d) link the event to the work order + mark it dispatched
  update public.emergency_events
     set work_order_id = v_wo,
         status = case when status = 'resolved' then status else 'dispatched' end
   where id = p_event;

  begin
    insert into public.ev_audit_log (community_id, event_type, target_type, target_id, metadata)
    values (cid,
            case when v_auto then 'emergency.dispatched_authorized' else 'emergency.dispatched_pending' end,
            'emergency_event', p_event,
            jsonb_build_object('work_order', v_wo, 'bill', v_bill, 'disbursement', v_disb,
                               'amount', v_amt, 'cap', v_cap, 'auto_approved', v_auto, 'vendor', p_vendor));
  exception when others then null;
  end;

  return jsonb_build_object(
    'work_order_id', v_wo, 'bill_id', v_bill, 'disbursement_id', v_disb,
    'amount', v_amt, 'cap', v_cap, 'auto_approved', v_auto, 'over_cap', not v_auto);
end $$;
revoke all on function public.emergency_dispatch(uuid, uuid, text, numeric, text, text) from public, anon;
grant execute on function public.emergency_dispatch(uuid, uuid, text, numeric, text, text) to authenticated;
