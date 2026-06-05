-- ============================================================
-- Residente — Resident-requested payment plans (request/review layer)
-- Run once in the Supabase SQL editor. Safe to re-run. Run AFTER collections.sql.
-- ============================================================
--
-- ev_payment_plans already exists (collections.sql) as a board-created plan on a
-- collection case. This adds the REQUEST/REVIEW layer modeled on ARC
-- (ev_arc_requests + ev_arc_notify): the plan row IS the request. A resident
-- proposes terms (request_status='requested'); the board approves / modifies /
-- denies. Existing board-created plans default to request_status='approved' so
-- they are untouched.

alter table public.ev_payment_plans
  add column if not exists requested_by_owner    boolean not null default false,
  add column if not exists request_status        text not null default 'approved',
  add column if not exists requested_amount       numeric,
  add column if not exists requested_count        int,
  add column if not exists requested_frequency_days int,
  add column if not exists decision_reason        text,
  add column if not exists decided_at             date,
  add column if not exists decided_by             uuid references public.profiles(id) on delete set null,
  add column if not exists profile_id             uuid references public.profiles(id) on delete set null,
  add column if not exists autopay_opt_in         boolean not null default false;

do $$ begin
  alter table public.ev_payment_plans
    add constraint ev_payment_plans_request_status_chk
    check (request_status in ('requested','approved','modified','denied','withdrawn'));
exception when duplicate_object then null; end $$;

-- One open (requested or active) plan per case. Best-effort: if a case somehow
-- already has two, the index simply isn't created (swallowed) so the script
-- still completes — the UI enforces single-plan too.
do $$ begin
  create unique index ev_payment_plans_one_open_per_case
    on public.ev_payment_plans (case_id)
    where status = 'active' and request_status in ('requested','approved','modified');
exception when others then null; end $$;

-- ---------- RLS: owner can request + manage their pending request ----------
-- (board insert/update already covered by "board writes community payment plans")
drop policy if exists "owner requests payment plan" on public.ev_payment_plans;
create policy "owner requests payment plan"
  on public.ev_payment_plans for insert to authenticated
  with check (
    requested_by_owner = true
    and request_status = 'requested'
    and profile_id = auth.uid()
    and community_id = (select community_id from public.profiles where id = auth.uid())
    and exists (
      select 1 from public.ev_collection_cases cc
       where cc.id = case_id and cc.profile_id = auth.uid()
    )
  );

-- The owner may edit terms / withdraw ONLY while still 'requested' — never an
-- approved plan (those are board-owned).
drop policy if exists "owner manages own pending plan request" on public.ev_payment_plans;
create policy "owner manages own pending plan request"
  on public.ev_payment_plans for update to authenticated
  using (profile_id = auth.uid() and request_status = 'requested')
  with check (profile_id = auth.uid() and request_status in ('requested','withdrawn'));

-- ---------- INTERCONNECT: request -> board bell; decision -> owner notice ----
-- Both directions in one security-definer trigger (a resident's session can't
-- write ev_notices / other people's recipient rows under RLS).
create or replace function public.ev_payment_plan_request_notify()
returns trigger language plpgsql security definer as $$
declare
  nid  uuid;
  v_body text;
begin
  -- New owner request → alert the board (empty channels → broadcast fanout skips).
  if tg_op = 'INSERT' then
    if not new.requested_by_owner or new.request_status <> 'requested' then
      return new;
    end if;
    insert into public.ev_notices (community_id, kind, channels, subject, body, sent_by)
    values (
      new.community_id, 'collections_update', array[]::text[],
      'Payment plan requested',
      'An owner requested a payment plan. Review it on the collection case in Collections.',
      new.profile_id
    ) returning id into nid;
    insert into public.ev_notice_recipients (notice_id, community_id, profile_id, channel)
    select nid, new.community_id, p.id, 'in_app'
      from public.profiles p
     where p.community_id = new.community_id
       and p.role in ('board_member','admin')
    on conflict (notice_id, profile_id, channel) do nothing;
    return new;
  end if;

  -- Board decision → personal notice to the owner.
  if tg_op = 'UPDATE' then
    if new.request_status = old.request_status then return new; end if;
    if new.request_status not in ('approved','modified','denied') then return new; end if;
    if new.profile_id is null then return new; end if;
    v_body := case new.request_status
      when 'denied'   then 'Your payment plan request was declined.'
                           || coalesce(' Reason: ' || nullif(new.decision_reason, ''), '')
      when 'modified' then 'Your payment plan was approved with adjusted terms. Open Easy Track to review and pay your installments.'
      else                 'Your payment plan was approved. Open Easy Track to review and pay your installments.'
    end;
    insert into public.ev_notices (community_id, kind, channels, subject, body, sent_by)
    values (
      new.community_id, 'collections_update', array['personal'],
      'Payment plan ' || replace(new.request_status, '_', ' '),
      v_body, new.decided_by
    ) returning id into nid;
    insert into public.ev_notice_recipients (notice_id, community_id, profile_id, channel)
    values (nid, new.community_id, new.profile_id, 'in_app')
    on conflict (notice_id, profile_id, channel) do nothing;
    return new;
  end if;

  return new;
end $$;

drop trigger if exists ev_payment_plan_request_notify_trg on public.ev_payment_plans;
create trigger ev_payment_plan_request_notify_trg
  after insert or update of request_status on public.ev_payment_plans
  for each row execute function public.ev_payment_plan_request_notify();
