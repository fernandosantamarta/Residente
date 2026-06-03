-- ============================================================
-- Residente — safe active-community switching
-- Run once in the Supabase SQL editor. Safe to re-run (idempotent).
-- ============================================================
--
-- Bug: CommunitySwitcher PATCHed profiles.community_id directly, but the
-- `authenticated` role has no UPDATE privilege on that column (only full_name,
-- per profile-self-update.sql), so the switch 403'd (42501) and silently failed.
--
-- We deliberately do NOT `grant update (community_id)` to authenticated: that
-- would let any resident PATCH community_id to an arbitrary value and read
-- another community's data through RLS (community_id gates every ev_* row).
--
-- Instead this SECURITY DEFINER function does the write as the table owner, but
-- ONLY after checking the caller actually belongs to the target community
-- (ev_membership). That membership check is what makes the privileged write
-- safe — a user can only point their active community at one they're a member
-- of. last_active_at is bumped in the same call so the boot default can prefer
-- the most recently used community.

create or replace function public.set_active_community(p_community_id uuid)
returns void language plpgsql security definer as $$
begin
  if p_community_id is null then
    raise exception 'community is required';
  end if;

  -- Membership gate: the caller must belong to the target community.
  if not exists (
    select 1 from public.ev_membership
    where profile_id = auth.uid()
      and community_id = p_community_id
  ) then
    raise exception 'not a member of that community';
  end if;

  update public.profiles
     set community_id = p_community_id
   where id = auth.uid();

  update public.ev_membership
     set last_active_at = now()
   where profile_id = auth.uid()
     and community_id = p_community_id;
end $$;

grant execute on function public.set_active_community(uuid) to authenticated;
