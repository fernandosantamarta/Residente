-- ============================================================
-- Residente — Estoppel Certificates (FS 718.116(8) condo / FS 720.30851 HOA)
-- Run once in the Supabase SQL editor. Safe to re-run.
-- Depends on: compliance-foundation.sql (ev_notices 'estoppel_update' kind).
-- ============================================================
--
-- A board (or Residente operator) intakes an estoppel request at
-- /admin/requests#estoppel. The statutory delivery clock (10 business days, or
-- 3 if expedited) and the fee engine live in lib/compliance/estoppel.ts; the
-- app stamps due_at / fees on insert. The owner (profile_id) sees their own
-- request + the issued certificate on /app/track. Receipt and delivery fire a
-- PERSONAL in-app notice to the owner only (same pattern as ev_violations).

create table if not exists public.ev_estoppel_requests (
  id                       uuid primary key default gen_random_uuid(),
  community_id             uuid not null references public.communities(id) on delete cascade,
  profile_id               uuid references public.profiles(id) on delete set null, -- the owner (if a linked account)
  resident_id              uuid references public.residents(id) on delete set null,
  unit_label               text,           -- denormalized "Name · Unit"
  requestor_name           text,
  requestor_email          text,
  requestor_type           text check (requestor_type in ('owner','owner_designee','mortgagee','mortgagee_designee')),
  request_method           text check (request_method in ('written','electronic')),
  received_at              date not null default current_date,
  due_at                   date,           -- received + 10 (or 3 expedited) business days; set by app
  expedited                boolean not null default false,
  delinquent               boolean not null default false, -- derived at issuance
  status                   text not null default 'new'
                             check (status in ('new','in_progress','delivered','fee_waived','cancelled')),
  delivery_method          text check (delivery_method in ('electronic','hand','mail')),
  delivered_at             date,
  effective_until          date,           -- delivered + 30/35 calendar days
  fee_base                 numeric,
  fee_expedited            numeric,
  fee_delinquency          numeric,
  fee_total                numeric,
  fee_waived               boolean not null default false,
  aggregate_group_id       uuid,           -- simultaneous same-owner requests
  certificate_document_id  uuid references public.documents(id) on delete set null,
  payoff_good_through      date,
  notes                    text,
  created_by               uuid references public.profiles(id) on delete set null,
  created_at               timestamptz not null default now()
);

create index if not exists ev_estoppel_community_idx on public.ev_estoppel_requests (community_id, received_at desc);
create index if not exists ev_estoppel_profile_idx   on public.ev_estoppel_requests (profile_id);
create index if not exists ev_estoppel_status_idx    on public.ev_estoppel_requests (community_id, status);

-- Slice-1 detective fields: NO FEE if the certificate is delivered late
-- (718.116(8)(d) / 720.30851(4)), and a REFUND within 30 days if the closing
-- does not occur (718.116(8)(h) / 720.30851(8)).
alter table public.ev_estoppel_requests
  add column if not exists fee_paid            boolean not null default false,
  add column if not exists closing_cancelled_at date,
  add column if not exists refund_due          boolean not null default false,
  add column if not exists refund_issued_at    date;

alter table public.ev_estoppel_requests enable row level security;
grant select, insert, update, delete on public.ev_estoppel_requests to authenticated;
grant select, insert, update, delete on public.ev_estoppel_requests to service_role;

-- Owner sees only their own requests.
drop policy if exists "owner reads own estoppel" on public.ev_estoppel_requests;
create policy "owner reads own estoppel"
  on public.ev_estoppel_requests for select to authenticated
  using ( profile_id = auth.uid() );

-- Board sees + manages every estoppel request in their community.
drop policy if exists "board reads community estoppel" on public.ev_estoppel_requests;
create policy "board reads community estoppel"
  on public.ev_estoppel_requests for select to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

drop policy if exists "board writes community estoppel" on public.ev_estoppel_requests;
create policy "board writes community estoppel"
  on public.ev_estoppel_requests for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- ---------- INTERCONNECT: estoppel received / delivered -> PERSONAL notice ----------
-- Fires to ONLY the owner (profile_id), like ev_violation_notify(). channels =
-- ['personal'] so the broadcast fanout skips it; we add one recipient row.
create or replace function public.ev_estoppel_notify()
returns trigger language plpgsql security definer as $$
declare
  nid uuid;
  v_subject text;
  v_body text;
begin
  if new.profile_id is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_subject := 'Estoppel request received';
    v_body := 'An estoppel certificate has been requested for your unit. '
           || 'It will be delivered by ' || coalesce(new.due_at::text, 'the statutory deadline') || '.';
  elsif tg_op = 'UPDATE' and new.status = 'delivered' and coalesce(old.status, '') <> 'delivered' then
    v_subject := 'Estoppel certificate delivered';
    v_body := 'Your estoppel certificate has been issued'
           || case when new.effective_until is not null
                   then ' and is effective through ' || new.effective_until::text || '.'
                   else '.' end;
  else
    return new;
  end if;

  insert into public.ev_notices (community_id, kind, channels, subject, body, sent_by)
  values (new.community_id, 'estoppel_update', array['personal'], v_subject, v_body, new.created_by)
  returning id into nid;

  insert into public.ev_notice_recipients (notice_id, community_id, profile_id, channel)
  values (nid, new.community_id, new.profile_id, 'in_app')
  on conflict (notice_id, profile_id, channel) do nothing;

  return new;
end $$;

drop trigger if exists ev_estoppel_notify_trg on public.ev_estoppel_requests;
create trigger ev_estoppel_notify_trg
  after insert or update on public.ev_estoppel_requests
  for each row execute function public.ev_estoppel_notify();
