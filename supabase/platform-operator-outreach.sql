-- ============================================================
-- Residente — operator → community outreach
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================
--
-- Lets a Residente operator open a support thread ADDRESSED TO a community from
-- the Platform Console, and lets that community's board read + reply to it.
-- Reuses platform_requests / platform_request_messages; the only new thing is
-- RLS so the community side can see a thread it didn't submit itself.

-- 1. Operators may open a ticket for any community.
drop policy if exists "platform admins open requests" on public.platform_requests;
create policy "platform admins open requests"
  on public.platform_requests for insert to authenticated
  with check ( public.is_platform_admin(auth.uid()) );

-- 2. A board member sees every ticket for their community — not only ones they
--    personally submitted — so operator-opened threads show up in /admin/support.
drop policy if exists "board reads community requests" on public.platform_requests;
create policy "board reads community requests"
  on public.platform_requests for select to authenticated
  using (
    from_community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- 3. Board reads messages on any ticket for their community.
drop policy if exists "board reads community request messages" on public.platform_request_messages;
create policy "board reads community request messages"
  on public.platform_request_messages for select to authenticated
  using (exists (
    select 1 from public.platform_requests r
    where r.id = request_id
      and r.from_community_id = (select community_id from public.profiles where id = auth.uid())
      and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  ));

-- 4. Board replies on any ticket for their community.
drop policy if exists "board writes community request messages" on public.platform_request_messages;
create policy "board writes community request messages"
  on public.platform_request_messages for insert to authenticated
  with check (
    author_role = 'board'
    and author_profile_id = auth.uid()
    and exists (
      select 1 from public.platform_requests r
      where r.id = request_id
        and r.from_community_id = (select community_id from public.profiles where id = auth.uid())
        and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
    )
  );
