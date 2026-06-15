-- ============================================================
-- Residente — Officer delivery affidavit (Phase 4 / Step 7)
-- Run once in the Supabase SQL editor AFTER supabase/financials.sql.
-- Idempotent; safe to re-run.
-- ============================================================
-- Condo officers must attest DELIVERY of the annual financial report
-- (FS 718.111(13), per HB 913, eff. 2025-07-01) — it attests *delivery*, NOT
-- accuracy. Modeled as a write-once, immutable e-signature on the existing
-- ev_financial_filings row (filing_type='annual_financial_report'): a typed name +
-- auth.uid() + timestamp. It CANNOT be signed before the report is completed
-- (completed_at), and once signed it cannot be altered. HOAs have no affidavit.
--
-- This is the human-in-the-loop step the whole initiative is built around: the app
-- prepares everything; the officer just signs. Statutory text/citations stay
-- advisory (validated:false) pending attorney sign-off. See [[eliminate-back-office-plan]].

-- ---------- 1) Affidavit columns on the filings spine ----------
alter table public.ev_financial_filings add column if not exists affidavit_signer_name text;
alter table public.ev_financial_filings add column if not exists affidavit_signed_by uuid references public.profiles(id) on delete set null;
alter table public.ev_financial_filings add column if not exists affidavit_signed_at timestamptz;

-- ---------- 2) The one signing path: sign_delivery_affidavit ----------
-- SECURITY DEFINER + search_path='' (everything schema-qualified). Gated by
-- has_permission('financials.manage') (NOT profiles.role — covers the seeded
-- Treasurer custom role and legacy board/admin via my_permissions '*'). Enforces:
-- own community · condo only · AFR filing · completed_at set · not already signed.
create or replace function public.sign_delivery_affidavit(p_filing uuid, p_signer_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid   uuid;
  f     public.ev_financial_filings%rowtype;
  assoc text;
begin
  if not public.has_permission('financials.manage') then
    raise exception 'not allowed';
  end if;
  if coalesce(btrim(p_signer_name), '') = '' then
    raise exception 'a typed signer name is required';
  end if;

  select community_id into cid from public.profiles where id = auth.uid();
  if cid is null then
    raise exception 'not a member of any community';
  end if;

  select * into f from public.ev_financial_filings where id = p_filing;
  if not found or f.community_id <> cid then
    raise exception 'filing is not in your community';
  end if;
  if f.filing_type <> 'annual_financial_report' then
    raise exception 'a delivery affidavit applies only to the annual financial report';
  end if;

  select association_type into assoc from public.communities where id = cid;
  if coalesce(assoc, '') = 'hoa' then
    raise exception 'the delivery affidavit applies to condominium associations only';
  end if;

  if f.completed_at is null then
    raise exception 'mark the annual financial report completed before signing the affidavit';
  end if;
  if f.affidavit_signed_at is not null then
    raise exception 'this affidavit has already been signed';
  end if;

  update public.ev_financial_filings
     set affidavit_signer_name = btrim(p_signer_name),
         affidavit_signed_by   = auth.uid(),
         affidavit_signed_at   = now(),
         delivered_at          = coalesce(delivered_at, current_date),
         status                = 'delivered'
   where id = p_filing;

  -- Best-effort audit (never block the signature on the audit insert).
  begin
    insert into public.ev_audit_log (community_id, event_type, target_type, target_id, metadata)
    values (cid, 'financial.affidavit_signed', 'financial_filing', p_filing,
            jsonb_build_object('signer', btrim(p_signer_name), 'fiscal_year', f.fiscal_year));
  exception when others then null;
  end;
end $$;

revoke all on function public.sign_delivery_affidavit(uuid, text) from public, anon;
grant execute on function public.sign_delivery_affidavit(uuid, text) to authenticated;

-- ---------- 3) Immutability: a signed affidavit can't be altered ----------
-- Defense-in-depth on top of the write-once check above: blocks any direct UPDATE
-- (via the board-write RLS policy on ev_financial_filings) that would change or
-- clear the attestation fields once signed. Other columns (e.g. status) stay editable.
create or replace function public.guard_affidavit_immutable() returns trigger
language plpgsql as $$
begin
  if old.affidavit_signed_at is not null and (
        new.affidavit_signed_at   is distinct from old.affidavit_signed_at
     or new.affidavit_signer_name is distinct from old.affidavit_signer_name
     or new.affidavit_signed_by   is distinct from old.affidavit_signed_by
  ) then
    raise exception 'a signed delivery affidavit is immutable';
  end if;
  return new;
end $$;

drop trigger if exists ev_filings_affidavit_immutable on public.ev_financial_filings;
create trigger ev_filings_affidavit_immutable
  before update on public.ev_financial_filings
  for each row execute function public.guard_affidavit_immutable();
