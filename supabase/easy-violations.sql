-- ============================================================
-- Residente — Violations & Enforcement
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================
--
-- The board issues warnings / fines against a specific resident at
-- /admin/violations. Each violation is OWNED by that resident (profile_id),
-- so they see only their own on /app/voice (Contact) and the rule book strip,
-- while the board sees the whole community. Issuing one fires a PERSONAL
-- in-app notice — only the targeted resident's bell lights up, not everyone's.

create table if not exists public.ev_violations (
  id                uuid primary key default gen_random_uuid(),
  community_id      uuid not null references public.communities(id) on delete cascade,
  profile_id        uuid references public.profiles(id) on delete set null, -- resident it's against
  resident_label    text,            -- denormalized "Name · Unit" for board display
  kind              text not null default 'warning' check (kind in ('warning','fine')),
  rule_id           uuid references public.rules(id) on delete set null,
  rule_title        text,            -- denormalized title at issuance
  amount            numeric,         -- dollars, only for kind=fine
  status            text not null default 'open' check (status in ('open','appealed','closed')),
  resolution        text check (resolution in ('stripe-paid','manual-paid','waived','dismissed')),
  stripe_invoice_id text,
  notes             text,
  opened_at         date not null default current_date,
  closed_at         date,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now()
);

create index if not exists ev_violations_community_idx on public.ev_violations (community_id, opened_at desc);
create index if not exists ev_violations_profile_idx   on public.ev_violations (profile_id);

alter table public.ev_violations enable row level security;
grant select, insert, update, delete on public.ev_violations to authenticated;
grant select, insert, update, delete on public.ev_violations to service_role;

-- A resident sees only the violations issued against them.
drop policy if exists "residents read own violations" on public.ev_violations;
create policy "residents read own violations"
  on public.ev_violations for select to authenticated
  using ( profile_id = auth.uid() );

-- The board sees + manages every violation in their community.
drop policy if exists "board reads community violations" on public.ev_violations;
create policy "board reads community violations"
  on public.ev_violations for select to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

drop policy if exists "board writes community violations" on public.ev_violations;
create policy "board writes community violations"
  on public.ev_violations for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- ---------- INTERCONNECT: new violation -> PERSONAL notice ----------
-- Unlike the schedule/broadcast path, a violation must reach ONLY the
-- targeted resident. So we insert the ev_notices row with a non-'in_app'
-- channel (the broadcast fanout trigger skips it) and then add a single
-- recipient row for that one profile. security definer: residents can't
-- write ev_notices / other people's recipient rows.
create or replace function public.ev_violation_notify()
returns trigger language plpgsql security definer as $$
declare nid uuid;
begin
  if new.profile_id is not null then
    insert into public.ev_notices (community_id, kind, channels, subject, body, sent_by)
    values (
      new.community_id,
      'violation',         -- routed to /app/documents by noticeHref (widen the
                           -- ev_notices kind CHECK first — see violation-notices.sql)
      array['personal'],   -- NOT 'in_app' → broadcast fanout skips this notice
      case when new.kind = 'fine'
           then 'New fine: ' || coalesce(new.rule_title, 'rule violation')
           else 'Notice: '   || coalesce(new.rule_title, 'rule reminder') end,
      coalesce(nullif(new.notes, ''), 'See the Contact tab for details.')
        || case when new.amount is not null then '  ($' || new.amount || ')' else '' end,
      new.created_by
    )
    returning id into nid;

    insert into public.ev_notice_recipients (notice_id, community_id, profile_id, channel)
    values (nid, new.community_id, new.profile_id, 'in_app')
    on conflict (notice_id, profile_id, channel) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists ev_violation_notify_trg on public.ev_violations;
create trigger ev_violation_notify_trg
  after insert on public.ev_violations
  for each row execute function public.ev_violation_notify();
