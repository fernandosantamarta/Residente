-- ============================================================
-- Residente — AI front desk: inbound email → resident request (+ AI triage)
-- Run once in the Supabase SQL editor. Safe to re-run.
-- Depends on: resident-requests.sql + request-triage.sql + request-messages.sql.
-- ============================================================
--
-- Turns the association's email inbox into a triaged queue. The board points an
-- inbound address (Resend Inbound) at the inbound-email-receiver edge function;
-- each arriving email is matched to the sender's account, opened as a
-- resident_request thread (origin='email'), and — when AI is configured — given
-- a category, priority, and a DRAFT reply the board reviews before sending.
--
-- POSTURE — "dark until configured": nothing turns on until (a) the inbound DNS +
-- webhook are wired in Resend and (b) ANTHROPIC_API_KEY is set for the AI triage.
-- Until then this schema is inert; the in-app Contact form is unaffected. All
-- additive + nullable.

-- ---------- communities: the per-community inbound routing token ----------
-- The inbound address local-part carries this token (e.g. fd-<token>@inbound.…);
-- the receiver looks the community up by it. Unique so one address = one HOA.
alter table public.communities
  add column if not exists inbound_email_token text;
create unique index if not exists communities_inbound_token_idx
  on public.communities (inbound_email_token)
  where inbound_email_token is not null;

-- ---------- resident_requests: link to the source email + the AI draft ----------
alter table public.resident_requests
  -- the AI-suggested reply for an emailed request (board reviews, edits, sends).
  add column if not exists ai_draft_reply  text,
  -- back-link to the inbound email that created this request (traceability).
  add column if not exists inbound_email_id uuid;
-- NOTE: origin already exists (request-messages.sql); inbound mail uses
-- origin='email', which the first-message seed trigger treats as a resident
-- message (author_role='resident') — exactly what we want.

-- ---------- ev_inbound_emails: the raw inbound log (dedup + unmatched mail) ----------
create table if not exists public.ev_inbound_emails (
  id                 uuid primary key default gen_random_uuid(),
  community_id       uuid references public.communities(id) on delete cascade, -- null when unrouted
  message_id         text,                 -- the email Message-ID; dedups replays
  from_email         text,
  from_name          text,
  to_address         text,                 -- the inbound address it was sent to
  subject            text,
  body_text          text,
  -- resolution
  matched_profile_id  uuid references public.profiles(id) on delete set null,
  matched_resident_id uuid references public.residents(id) on delete set null,
  request_id          uuid references public.resident_requests(id) on delete set null,
  status             text not null default 'received'
                       check (status in ('received','matched','unmatched_community',
                                         'unmatched_sender','unmatched_no_account','error')),
  -- AI triage results (null until AI is configured)
  ai_category        text,
  ai_priority        text,
  ai_draft_reply     text,
  error_detail       text,
  created_at         timestamptz not null default now()
);
create unique index if not exists ev_inbound_emails_message_idx
  on public.ev_inbound_emails (message_id) where message_id is not null;
create index if not exists ev_inbound_emails_community_idx
  on public.ev_inbound_emails (community_id, created_at desc);

alter table public.ev_inbound_emails enable row level security;
grant select on public.ev_inbound_emails to authenticated;   -- writes are service-role only (the edge fn)
grant all on public.ev_inbound_emails to service_role;

-- Board-only read of its community's inbound log (unmatched mail, AI drafts).
drop policy if exists "board reads community inbound email" on public.ev_inbound_emails;
create policy "board reads community inbound email"
  on public.ev_inbound_emails for select to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );
