-- waitlist — public landing page email capture.
--
-- Anyone (signed-out prospect from the marketing site) can insert. Nobody
-- can read via the API — emails are private, you pull them from the
-- Supabase dashboard or build an admin view later.
--
-- Run once in Supabase SQL editor.

create table if not exists public.waitlist (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  community   text,
  source      text,
  created_at  timestamptz not null default now()
);

-- Same email twice → 23505 unique-violation, which Landing.jsx catches
-- and turns into a friendly "you're already on the list" message.
create unique index if not exists waitlist_email_key
  on public.waitlist (lower(email));

alter table public.waitlist enable row level security;

-- Anon insert is the whole point of this surface; no select policy on
-- purpose so the anon key can't dump the list.
grant insert on public.waitlist to anon, authenticated;

drop policy if exists "anyone can join waitlist" on public.waitlist;
create policy "anyone can join waitlist"
  on public.waitlist for insert
  to anon, authenticated
  with check (true);
