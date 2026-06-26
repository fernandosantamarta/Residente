-- mail-usage.sql — run-once, idempotent. Paste into the Supabase SQL editor.
-- Run AFTER mail-controls.sql (needs ev_mail_log + communities.lob_enabled).
-- Owner-only Platform Console reporting for Lob mailing spend + the kill switch,
-- mirroring platform_ai_usage / platform_set_ai_cap (ai-usage.sql).

-- Per-community mailing spend (this month + all time) and the Lob on/off state.
create or replace function public.platform_mail_usage()
returns table (
  community_id uuid, name text, plan text, lob_enabled boolean,
  month_cost numeric, month_count bigint,
  total_cost numeric, total_count bigint,
  last_sent_at timestamptz
)
language plpgsql security definer as $$
begin
  if not public.is_platform_owner(auth.uid()) then raise exception 'not a platform owner'; end if;
  return query
    select c.id, c.name, c.plan, coalesce(c.lob_enabled, true),
      coalesce((select sum(m.cost) from public.ev_mail_log m
        where m.community_id = c.id and m.created_at >= date_trunc('month', now())), 0),
      (select count(*) from public.ev_mail_log m
        where m.community_id = c.id and m.created_at >= date_trunc('month', now())),
      coalesce((select sum(m.cost) from public.ev_mail_log m where m.community_id = c.id), 0),
      (select count(*) from public.ev_mail_log m where m.community_id = c.id),
      (select max(m.created_at) from public.ev_mail_log m where m.community_id = c.id)
    from public.communities c
    order by 7 desc nulls last, c.name;
end $$;

-- Operator kill switch: turn Lob mailing on/off for one community.
create or replace function public.platform_set_lob_enabled(p_community uuid, p_enabled boolean)
returns void language plpgsql security definer as $$
begin
  if not public.is_platform_owner(auth.uid()) then raise exception 'not a platform owner'; end if;
  update public.communities set lob_enabled = coalesce(p_enabled, true) where id = p_community;
end $$;

-- Operator can also clear/adjust a community's accrued mailing cost balances
-- (e.g. after writing them off) across that community's cases.
create or replace function public.platform_clear_mailing_costs(p_community uuid)
returns void language plpgsql security definer as $$
begin
  if not public.is_platform_owner(auth.uid()) then raise exception 'not a platform owner'; end if;
  update public.ev_collection_cases set mailing_cost_balance = 0 where community_id = p_community;
end $$;

grant execute on function public.platform_mail_usage() to authenticated;
grant execute on function public.platform_set_lob_enabled(uuid, boolean) to authenticated;
grant execute on function public.platform_clear_mailing_costs(uuid) to authenticated;
