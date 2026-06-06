-- ============================================================
-- Residente — Fine disputes (statutory right to contest before imposition)
-- Run once in the Supabase SQL editor. Safe to re-run. Run AFTER enforcement.sql.
-- ============================================================
--
-- HB 1021 (condo FS 718.303) / HB 1203 (HOA FS 720.305): an owner may CONTEST a
-- fine before an independent committee BEFORE it is imposed. This adds an in-app
-- dispute that routes into the EXISTING enforcement track (ev_violation_hearings
-- + ev_fining_committee_members) — not a parallel system. The owner files via a
-- security-definer RPC (writes only the dispute_* fields after verifying
-- ownership — avoids an over-broad owner-update policy / amount tampering).

alter table public.ev_violations
  add column if not exists dispute_filed_at        date,
  add column if not exists dispute_reason          text,
  add column if not exists dispute_status          text,
  add column if not exists dispute_decided_at      date,
  add column if not exists dispute_decision_note   text,
  add column if not exists reduced_amount          numeric,
  add column if not exists dispute_attachment_path text,
  add column if not exists dispute_attachment_name text;

do $$ begin
  alter table public.ev_violations
    add constraint ev_violations_dispute_status_chk
    check (dispute_status is null or dispute_status in ('filed','under_review','upheld','dismissed','reduced'));
exception when duplicate_object then null; end $$;

-- ---------- RPC: owner files a dispute on their OWN fine ----------
-- security definer so it can set the dispute_* fields without granting the owner
-- a broad UPDATE on ev_violations (which would let them tamper with amount). The
-- caller's identity is taken from auth.uid(), never the payload. Evidence is
-- uploaded client-side to the existing 'request-attachments' bucket first; the
-- path/name are recorded here.
create or replace function public.file_fine_dispute(
  p_violation_id    uuid,
  p_reason          text,
  p_attachment_path text default null,
  p_attachment_name text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_owner   uuid;
  v_kind    text;
  v_status  text;
  v_filed   date;
  v_stage   text;
begin
  select profile_id, kind, status, dispute_filed_at, enforcement_stage
    into v_owner, v_kind, v_status, v_filed, v_stage
    from public.ev_violations where id = p_violation_id;

  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'You can only contest your own fine' using errcode = 'P0001';
  end if;
  if v_kind <> 'fine' then
    raise exception 'Only fines can be contested' using errcode = 'P0001';
  end if;
  if v_status = 'closed' then
    raise exception 'This fine is already settled' using errcode = 'P0001';
  end if;
  if v_filed is not null then
    raise exception 'A dispute has already been filed on this fine' using errcode = 'P0001';
  end if;

  update public.ev_violations set
    dispute_filed_at        = current_date,
    dispute_reason          = p_reason,
    dispute_status          = 'filed',
    dispute_attachment_path = p_attachment_path,
    dispute_attachment_name = p_attachment_name,
    -- Contesting moves the fine onto the hearing track so it can't be imposed
    -- until a committee rules (enforcementSignals engages on 'proposed').
    status                  = 'appealed',
    hearing_required        = true,
    enforcement_stage       = case when coalesce(v_stage,'none') = 'none' then 'proposed' else v_stage end
  where id = p_violation_id;
end $$;

grant execute on function public.file_fine_dispute(uuid, text, text, text) to authenticated;

-- ---------- INTERCONNECT: filed -> board bell; decided -> owner notice --------
create or replace function public.ev_fine_dispute_notify()
returns trigger language plpgsql security definer as $$
declare
  nid  uuid;
  v_body text;
begin
  -- Newly filed → alert the board to route it to the fining committee.
  if new.dispute_status = 'filed' and old.dispute_status is distinct from 'filed' then
    insert into public.ev_notices (community_id, kind, channels, subject, body, sent_by)
    values (
      new.community_id, 'custom_broadcast', array[]::text[],
      'A fine is being contested',
      'An owner is contesting a fine. Route it to the fining committee and schedule a hearing in Enforcement.',
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

  -- Committee decision → personal notice to the owner.
  if new.dispute_status in ('upheld','dismissed','reduced')
     and new.dispute_status is distinct from old.dispute_status then
    if new.profile_id is null then return new; end if;
    v_body := case new.dispute_status
      when 'dismissed' then 'Your contest was upheld — the fine has been dismissed.'
      when 'reduced'   then 'After your contest, the fine was reduced. Open Easy Track to review and pay the adjusted amount.'
      else                  'After a hearing, the committee upheld the fine. Open Easy Track to review and pay.'
    end || coalesce(' Note: ' || nullif(new.dispute_decision_note, ''), '');
    insert into public.ev_notices (community_id, kind, channels, subject, body, sent_by)
    values (
      new.community_id, 'custom_broadcast', array['personal'],
      'Decision on your contested fine',
      v_body, new.created_by
    ) returning id into nid;
    insert into public.ev_notice_recipients (notice_id, community_id, profile_id, channel)
    values (nid, new.community_id, new.profile_id, 'in_app')
    on conflict (notice_id, profile_id, channel) do nothing;
    return new;
  end if;

  return new;
end $$;

drop trigger if exists ev_fine_dispute_notify_trg on public.ev_violations;
create trigger ev_fine_dispute_notify_trg
  after update of dispute_status on public.ev_violations
  for each row execute function public.ev_fine_dispute_notify();
