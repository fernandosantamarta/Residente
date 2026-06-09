-- Per-role HOLDER CAPACITY. Upgrades the coarse allow_multiple boolean to a real
-- count: a role can be held by up to N board members (e.g. 2 secretaries, 3
-- guards). max_holders = 1 (single holder, the default), a positive int (cap), or
-- 0 (no limit). allow_multiple is kept in sync (true when the cap isn't exactly 1)
-- so older code paths keep working. Idempotent. Run in the Supabase SQL editor.

alter table public.ev_roles
  add column if not exists max_holders int not null default 1;

-- Backfill from the old flag: previously "allow multiple" meant unlimited.
update public.ev_roles
  set max_holders = case when allow_multiple then 0 else 1 end
  where max_holders is null or (allow_multiple and max_holders = 1);

-- Collapse ev_role_save to a single capacity-aware signature. Drop the older 3-
-- and 4-arg versions so a call by named args can't become ambiguous against the
-- defaults below.
drop function if exists public.ev_role_save(uuid, text, text[]);
drop function if exists public.ev_role_save(uuid, text, text[], boolean);

create or replace function public.ev_role_save(
  p_id uuid,
  p_name text,
  p_perms text[],
  p_multi boolean default false,
  p_max_holders int default 1
)
returns uuid language plpgsql security definer as $$
declare cid uuid; rid uuid; cap int;
begin
  if not public.has_permission('roles.manage') then raise exception 'not allowed'; end if;
  select community_id into cid from public.profiles where id = auth.uid();
  if cid is null then raise exception 'no community'; end if;
  -- Normalize: negative is meaningless; treat as the single-holder default.
  cap := greatest(coalesce(p_max_holders, 1), 0);
  if p_id is null then
    insert into public.ev_roles (community_id, name, permissions, allow_multiple, max_holders)
    values (cid, trim(p_name), coalesce(p_perms,'{}'), coalesce(p_multi, cap <> 1), cap)
    returning id into rid;
  else
    update public.ev_roles
      set name = trim(p_name), permissions = coalesce(p_perms,'{}'),
          allow_multiple = coalesce(p_multi, cap <> 1), max_holders = cap
      where id = p_id and community_id = cid and not is_admin
      returning id into rid;
    if rid is null then raise exception 'role not found or protected'; end if;
  end if;
  return rid;
end $$;

grant execute on function public.ev_role_save(uuid, text, text[], boolean, int) to authenticated;
