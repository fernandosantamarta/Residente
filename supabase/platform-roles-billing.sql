-- ============================================================
-- Residente — Platform: add the "billing" operator role
-- Run once in the Supabase SQL editor. Safe to re-run. ADDITIVE ONLY:
-- it widens the allowed role set and never remaps existing rows, so no
-- current operator (incl. owners) can lose access.
-- ============================================================
--
-- Role labels in the console map to these DB values:
--   owner    → "Founder"     (everything + manage the team)
--   operator → "Onboarding"  (communities + support, no billing)
--   billing  → "Billing"     (subscriptions & invoices)   ← NEW
--   support  → "Support"     (support inbox only; cannot enter communities)

-- 1) Widen the table constraint to allow 'billing'.
do $$ begin
  alter table public.platform_admins drop constraint if exists platform_admins_role_chk;
  alter table public.platform_admins
    add constraint platform_admins_role_chk check (role in ('owner','operator','support','billing'));
end $$;

-- 2) Allow assigning 'billing' when adding an operator.
create or replace function public.platform_add_operator(target_email text, target_role text default 'operator')
returns void language plpgsql security definer as $$
declare tgt uuid;
begin
  if not public.is_platform_owner(auth.uid()) then
    raise exception 'only owners can manage operators';
  end if;
  if target_role not in ('owner','operator','support','billing') then
    raise exception 'invalid role';
  end if;
  select id into tgt from public.profiles where lower(email) = lower(trim(target_email));
  if tgt is null then
    raise exception 'No Residente account found for %', target_email;
  end if;
  insert into public.platform_admins (profile_id, role, added_by)
  values (tgt, target_role, auth.uid())
  on conflict (profile_id) do update set role = excluded.role;
  perform public.platform_log('operator_added', 'operator', tgt::text,
    jsonb_build_object('email', target_email, 'role', target_role));
end $$;
grant execute on function public.platform_add_operator(text, text) to authenticated;

-- 3) Allow changing an operator to 'billing'.
create or replace function public.platform_set_operator_role(target uuid, new_role text)
returns void language plpgsql security definer as $$
declare cur_role text; owner_count int;
begin
  if not public.is_platform_owner(auth.uid()) then
    raise exception 'only owners can manage operators';
  end if;
  if new_role not in ('owner','operator','support','billing') then
    raise exception 'invalid role';
  end if;
  select role into cur_role from public.platform_admins where profile_id = target;
  if cur_role is null then raise exception 'not an operator'; end if;
  if cur_role = 'owner' and new_role <> 'owner' then
    select count(*) into owner_count from public.platform_admins where role = 'owner';
    if owner_count <= 1 then raise exception 'cannot demote the last owner'; end if;
  end if;
  update public.platform_admins set role = new_role where profile_id = target;
  perform public.platform_log('operator_role_changed', 'operator', target::text,
    jsonb_build_object('from', cur_role, 'to', new_role));
end $$;
grant execute on function public.platform_set_operator_role(uuid, text) to authenticated;

-- platform_enter_community already blocks only 'support', so 'billing' (like
-- owner/operator) can drop into a community — no change needed there.
