-- ============================================================
-- Residente — CPA share links (Phase 4 / Step 7 follow-up)
-- Run once in the Supabase SQL editor AFTER supabase/gl-spine.sql.
-- Idempotent; safe to re-run.
-- ============================================================
-- Lets a board officer hand their outside CPA a short-lived, revocable, login-free
-- link to a READ-ONLY view of the CPA handoff package (aggregate trial balance +
-- financial position, by fund — NO owner names/units, so no PII). The link is a
-- random token with an hours-scale expiry; every open is audit-logged by the
-- public route (app/api/cpa-share). Officers mint/revoke via the RPCs below.
-- See app/cpa/[token]/page.tsx + [[eliminate-back-office-plan]].

create table if not exists public.cpa_share_tokens (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  token        text not null unique,
  fiscal_year  int,
  expires_at   timestamptz not null,
  revoked      boolean not null default false,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists cpa_share_tokens_community_idx on public.cpa_share_tokens (community_id, created_at desc);
create index if not exists cpa_share_tokens_token_idx on public.cpa_share_tokens (token);

alter table public.cpa_share_tokens enable row level security;
grant select on public.cpa_share_tokens to authenticated;
-- A financials.manage officer may list their own community's links (to copy/revoke).
-- The token itself is the share secret; only same-community officers see it. Writes
-- go through the definer RPCs below (no insert/update/delete grant to authenticated).
drop policy if exists cpa_share_read on public.cpa_share_tokens;
create policy cpa_share_read on public.cpa_share_tokens for select to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and public.has_permission('financials.manage')
  );

-- ---- mint: create a link for the caller's community (hours-scale expiry) ----
create or replace function public.cpa_share_create(p_fiscal_year int, p_hours int default 72)
returns public.cpa_share_tokens
language plpgsql security definer set search_path = ''
as $$
declare
  cid    uuid;
  v_hours int;
  v_row  public.cpa_share_tokens%rowtype;
begin
  if not public.has_permission('financials.manage') then
    raise exception 'not allowed';
  end if;
  select community_id into cid from public.profiles where id = auth.uid();
  if cid is null then raise exception 'not a member of any community'; end if;

  v_hours := least(greatest(coalesce(p_hours, 72), 1), 720);  -- clamp 1 hour .. 30 days
  insert into public.cpa_share_tokens (community_id, token, fiscal_year, expires_at, created_by)
  values (
    cid,
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),  -- 64 hex chars
    p_fiscal_year,
    now() + make_interval(hours => v_hours),
    auth.uid()
  )
  returning * into v_row;

  begin
    insert into public.ev_audit_log (community_id, event_type, target_type, target_id, metadata)
    values (cid, 'financial.cpa_share_created', 'financial_filing', v_row.id,
            jsonb_build_object('fiscal_year', p_fiscal_year, 'expires_at', v_row.expires_at));
  exception when others then null;
  end;

  return v_row;
end $$;

revoke all on function public.cpa_share_create(int, int) from public, anon;
grant execute on function public.cpa_share_create(int, int) to authenticated;

-- ---- revoke: kill a link early (own community only) ----
create or replace function public.cpa_share_revoke(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare cid uuid;
begin
  if not public.has_permission('financials.manage') then
    raise exception 'not allowed';
  end if;
  select community_id into cid from public.profiles where id = auth.uid();
  update public.cpa_share_tokens set revoked = true where id = p_id and community_id = cid;
end $$;

revoke all on function public.cpa_share_revoke(uuid) from public, anon;
grant execute on function public.cpa_share_revoke(uuid) to authenticated;
