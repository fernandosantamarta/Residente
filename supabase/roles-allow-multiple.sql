-- Per-role "allow multiple holders" flag. Off by default → a custom role can be
-- held by only one board member; turn it on to let several share it.
-- Idempotent. Run in the Supabase SQL editor.

alter table public.ev_roles
  add column if not exists allow_multiple boolean not null default false;

-- ev_role_save gains a p_multi flag. Drop the old 3-arg version first so the
-- existing 3-arg calls resolve to this one through the default (no ambiguity).
drop function if exists public.ev_role_save(uuid, text, text[]);

create or replace function public.ev_role_save(p_id uuid, p_name text, p_perms text[], p_multi boolean default false)
returns uuid language plpgsql security definer as $$
declare cid uuid; rid uuid;
begin
  if not public.has_permission('roles.manage') then raise exception 'not allowed'; end if;
  select community_id into cid from public.profiles where id = auth.uid();
  if cid is null then raise exception 'no community'; end if;
  if p_id is null then
    insert into public.ev_roles (community_id, name, permissions, allow_multiple)
    values (cid, trim(p_name), coalesce(p_perms,'{}'), coalesce(p_multi,false)) returning id into rid;
  else
    update public.ev_roles
      set name = trim(p_name), permissions = coalesce(p_perms,'{}'), allow_multiple = coalesce(p_multi,false)
      where id = p_id and community_id = cid and not is_admin
      returning id into rid;
    if rid is null then raise exception 'role not found or protected'; end if;
  end if;
  return rid;
end $$;

grant execute on function public.ev_role_save(uuid, text, text[], boolean) to authenticated;
