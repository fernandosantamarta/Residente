-- ============================================================
-- Residente — General-ledger WRITER (Phase 3 / Workstream B finish)
-- Run once in the Supabase SQL editor AFTER supabase/gl-spine.sql.
-- Idempotent; safe to re-run.
-- ============================================================
-- gl-spine.sql created the tables, the deferred per-fund balanced-entry trigger,
-- the security_invoker trial-balance view, RLS, and the one human write path
-- (gl_post_manual_adjustment). This file adds the MACHINE write path: a single
-- service-role RPC that PERSISTS the regenerable projection lib/gl/project.ts
-- computes, atomically and only if it ties out.
--
-- WHO CALLS IT: app/api/admin/gl/rebuild (a Next.js route with the service-role
-- key, gated by CRON_SECRET) builds the journal entries with the canonical
-- buildLedger() and hands them here as JSONB. Keeping the projection in TS
-- (single source of truth, proven by `npm run verify:gl`) and the *persist* in
-- one Postgres transaction is what makes the write atomic and the tie-out a hard
-- pre-commit guard. See [[eliminate-back-office-plan]].
--
-- WHY service-role only: the spine's contract is "GL writes are service-role
-- only" — no INSERT/UPDATE/DELETE grants to `authenticated`. This function is
-- SECURITY DEFINER but EXECUTE is granted to `service_role` ONLY (revoked from
-- anon/authenticated), so a logged-in board member can never trigger a rebuild;
-- their one write path stays gl_post_manual_adjustment().
--
-- IDEMPOTENT REBUILD SEMANTICS (per the plan: "upsert entries on
-- (community_id, source_key)"):
--   • Each incoming entry is UPSERTED on (community_id, source_key). Entry ids
--     are therefore STABLE across rebuilds — important so a future reconciliation
--     link (gl_transactions.matched_entry_id, Workstream D) is not orphaned by a
--     routine rebuild.
--   • An entry's lines are replaced wholesale (delete-by-entry then insert) — the
--     deferred trigger validates the final per-fund balance at COMMIT.
--   • Machine entries whose source_key is no longer produced (a deleted payment,
--     a removed resident) are garbage-collected. source_type='manual_adjustment'
--     entries (the human path) are NEVER touched.
--
-- TIE-OUT GUARD (the whole point): before the transaction commits, the operating
-- "Assessments receivable" (1100) net of the MACHINE entries must equal the
-- Σ residentBalance() the caller passes in p_expected_ar. A mismatch RAISES,
-- which rolls back the entire rebuild — nothing is ever persisted out of balance.
-- (Manual AR adjustments are an INTENTIONAL deviation and are excluded from this
-- guard; the machine projection is what must tie to lib/dues.ts.)

create or replace function public.gl_rebuild_community(
  p_community   uuid,
  p_entries     jsonb,
  p_expected_ar numeric,
  p_dry_run     boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e jsonb;
  l jsonb;
  v_entry      uuid;
  v_acct       uuid;
  v_code       text;
  v_keys       text[] := '{}';      -- every incoming source_key (for orphan GC)
  v_unknown    text[] := '{}';      -- codes that don't resolve in this community's chart
  v_unbalanced int := 0;            -- entries whose lines don't net to 0 within their fund
  v_n_entries  int := 0;
  v_n_lines    int := 0;
  v_ar_net     numeric := 0;        -- operating 1100 net implied by the incoming entries
  v_bad_funds  int;                 -- funds within one entry that don't net to zero
  v_ties       boolean;
  v_deleted    int := 0;            -- machine entries GC'd as orphans
  v_db_ar      numeric;            -- post-write machine 1100 net, re-read from rows
begin
  if p_community is null then
    raise exception 'community is required';
  end if;
  if not exists (select 1 from public.communities where id = p_community) then
    raise exception 'community % does not exist', p_community;
  end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'p_entries must be a json array';
  end if;

  -- ---- 1) Analyze the incoming entries WITHOUT writing ----
  -- Validate each entry balances within its (single) fund, that every account
  -- code resolves, and accumulate the operating 1100 net + the source_key set.
  for e in select value from jsonb_array_elements(p_entries)
  loop
    v_n_entries := v_n_entries + 1;
    v_keys := array_append(v_keys, e->>'source_key');

    -- Per-fund balance — mirror gl_assert_entry_balanced() in gl-spine.sql exactly:
    -- the entry must net to 0 within EACH fund, not merely globally. (Entries from
    -- the canonical builder are single-fund, but a malformed multi-fund payload that
    -- nets to 0 globally must still be reported here, not silently deferred to the
    -- trigger.)
    select count(*) into v_bad_funds from (
      select round(coalesce(sum((ln->>'debit')::numeric), 0)
                 - coalesce(sum((ln->>'credit')::numeric), 0), 2) as net
        from jsonb_array_elements(e->'lines') ln
       group by (ln->>'fund')
    ) s
    where s.net <> 0;
    if v_bad_funds > 0 then
      v_unbalanced := v_unbalanced + 1;
    end if;

    for l in select value from jsonb_array_elements(e->'lines')
    loop
      v_n_lines := v_n_lines + 1;
      v_code := l->>'account';
      if not exists (
        select 1 from public.gl_accounts
         where code = v_code and (community_id = p_community or community_id is null)
      ) then
        if not (v_code = any(v_unknown)) then
          v_unknown := array_append(v_unknown, v_code);
        end if;
      end if;
      if v_code = '1100' and (l->>'fund') = 'operating' then
        v_ar_net := v_ar_net
          + round(coalesce((l->>'debit')::numeric, 0) - coalesce((l->>'credit')::numeric, 0), 2);
      end if;
    end loop;
  end loop;
  v_ar_net := round(v_ar_net, 2);
  v_ties := round(v_ar_net - coalesce(p_expected_ar, 0), 2) = 0;

  -- ---- 2) Dry run: report and stop. No rows touched. ----
  if p_dry_run then
    return jsonb_build_object(
      'dry_run', true,
      'entries', v_n_entries,
      'lines', v_n_lines,
      'unbalanced_entries', v_unbalanced,
      'unknown_codes', to_jsonb(v_unknown),
      'operating_ar_net', v_ar_net,
      'expected_ar', round(coalesce(p_expected_ar, 0), 2),
      'ties_out', v_ties
    );
  end if;

  -- ---- 3) Commit path: refuse to persist anything that isn't sound ----
  if array_length(v_unknown, 1) is not null then
    raise exception 'unknown account code(s): %', array_to_string(v_unknown, ', ');
  end if;
  if v_unbalanced > 0 then
    raise exception '% entr(ies) do not balance within their fund', v_unbalanced;
  end if;
  if not v_ties then
    raise exception 'tie-out FAILED: operating AR(1100) net % <> expected Σ residentBalance %',
      v_ar_net, round(coalesce(p_expected_ar, 0), 2);
  end if;

  -- ---- 4) Upsert each entry + replace its lines (one transaction) ----
  for e in select value from jsonb_array_elements(p_entries)
  loop
    insert into public.gl_journal_entries
      (community_id, entry_date, fiscal_year, fund, source_type, source_id,
       source_key, resident_id, memo, posted_by)
    values
      (p_community, (e->>'entry_date')::date, (e->>'fiscal_year')::int, e->>'fund',
       e->>'source_type', nullif(e->>'source_id', '')::uuid, e->>'source_key',
       nullif(e->>'resident_id', '')::uuid, e->>'memo', null)
    on conflict (community_id, source_key) do update set
       entry_date  = excluded.entry_date,
       fiscal_year = excluded.fiscal_year,
       fund        = excluded.fund,
       source_type = excluded.source_type,
       source_id   = excluded.source_id,
       resident_id = excluded.resident_id,
       memo        = excluded.memo
    returning id into v_entry;

    -- Replace the entry's lines wholesale; deferred trigger checks balance at COMMIT.
    delete from public.gl_entry_lines where entry_id = v_entry;
    for l in select value from jsonb_array_elements(e->'lines')
    loop
      select id into v_acct from public.gl_accounts
        where code = (l->>'account') and (community_id = p_community or community_id is null)
        order by (community_id is not null) desc   -- prefer the community-specific account
        limit 1;
      insert into public.gl_entry_lines
        (entry_id, community_id, account_id, fund, resident_id, category_id, debit, credit)
      values
        (v_entry, p_community, v_acct, l->>'fund',
         nullif(l->>'resident_id', '')::uuid, nullif(l->>'category_id', '')::uuid,
         round(coalesce((l->>'debit')::numeric, 0), 2),
         round(coalesce((l->>'credit')::numeric, 0), 2));
    end loop;
  end loop;

  -- ---- 5) Garbage-collect machine entries no longer produced ----
  -- (deleted source rows, removed residents). NEVER touches manual adjustments.
  with gone as (
    delete from public.gl_journal_entries
     where community_id = p_community
       and source_type <> 'manual_adjustment'
       and not (source_key = any(v_keys))
    returning 1
  )
  select count(*) into v_deleted from gone;

  -- ---- 6) Final pre-commit re-assert from the persisted rows ----
  -- Belt-and-suspenders: recompute the MACHINE 1100/operating net from what we
  -- actually wrote and compare again. A divergence here (vs the jsonb figure)
  -- would mean an insert-path bug; RAISE rolls the whole rebuild back.
  select round(coalesce(sum(l.debit - l.credit), 0), 2) into v_db_ar
    from public.gl_entry_lines l
    join public.gl_journal_entries en on en.id = l.entry_id
    join public.gl_accounts a on a.id = l.account_id
   where en.community_id = p_community
     and en.source_type <> 'manual_adjustment'
     and a.code = '1100'
     and l.fund = 'operating';
  if round(v_db_ar - coalesce(p_expected_ar, 0), 2) <> 0 then
    raise exception 'post-write tie-out FAILED: persisted AR(1100) net % <> expected %',
      v_db_ar, round(coalesce(p_expected_ar, 0), 2);
  end if;

  -- ---- 7) Best-effort audit (never block the rebuild on the audit insert) ----
  begin
    insert into public.ev_audit_log (community_id, event_type, target_type, target_id, metadata)
    values (p_community, 'financial.gl_rebuild', 'community', p_community,
            jsonb_build_object('entries', v_n_entries, 'lines', v_n_lines,
                               'orphans_removed', v_deleted, 'ar_net', v_db_ar));
  exception when others then null;
  end;

  return jsonb_build_object(
    'dry_run', false,
    'entries', v_n_entries,
    'lines', v_n_lines,
    'orphans_removed', v_deleted,
    'unbalanced_entries', 0,
    'unknown_codes', '[]'::jsonb,
    'operating_ar_net', v_db_ar,
    'expected_ar', round(coalesce(p_expected_ar, 0), 2),
    'ties_out', true
  );
end $$;

-- Machine writes are service-role ONLY (mirrors gl-spine's "no write DML to
-- authenticated"). Revoke the default PUBLIC execute, then grant to service_role.
revoke all on function public.gl_rebuild_community(uuid, jsonb, numeric, boolean) from public;
revoke all on function public.gl_rebuild_community(uuid, jsonb, numeric, boolean) from anon, authenticated;
grant execute on function public.gl_rebuild_community(uuid, jsonb, numeric, boolean) to service_role;
