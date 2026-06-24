-- ============================================================
-- Residente — Structured minutes templates + capture
-- (FS 718.111(12) / 720.303(4) — minutes are official records owners may inspect)
-- Run once in the Supabase SQL editor. Idempotent / safe to re-run.
-- Depends on: easy-voice.sql (ev_meetings), compliance-foundation.sql, custom-roles.sql
--             (for public.has_permission).
-- ============================================================
--
-- Board meetings already track NOTICE compliance in ev_meetings + /admin/meetings.
-- Minutes were previously captured only as uploaded files (ev_meeting_docs).
-- This migration adds STRUCTURED minutes: a per-community section template per
-- meeting type, and the captured minutes (sections_data) for each meeting. The
-- default section schema lives in lib/compliance/minutes-templates.ts (not seeded
-- here); a board may override it by inserting a minutes_templates row.
--
-- Posture: Enable — the capture helper at /admin/meetings/[id]/minutes drafts and
-- publishes structured minutes. Publishing sets ev_meetings.minutes_status +
-- minutes_published_at so the existing notice-compliance math sees them.
--
-- ⚠ REQUIRES ATTORNEY REVIEW — the default minutes sections and the secretary
--   certification language are aids; confirm against the governing documents.

-- ---------- minutes_templates ----------
create table if not exists public.minutes_templates (
  id            uuid primary key default gen_random_uuid(),
  community_id  uuid not null references public.communities(id) on delete cascade,
  meeting_type  text not null check (meeting_type in ('board','annual','special','committee')),
  name          text not null default 'Default',
  sections      jsonb not null default '[]'::jsonb,   -- section schema (see lib/compliance/minutes-templates.ts)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (community_id, meeting_type, name)
);

create index if not exists minutes_templates_community_idx
  on public.minutes_templates (community_id, meeting_type);

-- ---------- meeting_minutes ----------
create table if not exists public.meeting_minutes (
  id             uuid primary key default gen_random_uuid(),
  meeting_id     uuid not null references public.ev_meetings(id) on delete cascade,
  community_id   uuid not null references public.communities(id) on delete cascade,
  template_id    uuid references public.minutes_templates(id) on delete set null,
  sections_data  jsonb not null default '{}'::jsonb,   -- captured values keyed by section/field id
  status         text not null default 'draft' check (status in ('draft','approved','published')),
  draft_at       timestamptz,
  approved_at    timestamptz,
  approved_by    uuid references public.profiles(id),
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (meeting_id)
);

create index if not exists meeting_minutes_community_idx
  on public.meeting_minutes (community_id, status);

-- ---------- link column on ev_meetings ----------
alter table public.ev_meetings
  add column if not exists minutes_template_id uuid references public.minutes_templates(id) on delete set null;

-- ---------- RLS + grants ----------
alter table public.minutes_templates enable row level security;
alter table public.meeting_minutes   enable row level security;

grant references, trigger, truncate on public.minutes_templates to anon;
grant references, trigger, truncate on public.meeting_minutes   to anon;
grant select, insert, update, delete on public.minutes_templates to authenticated;
grant select, insert, update, delete on public.meeting_minutes   to authenticated;
grant select, insert, update, delete on public.minutes_templates to service_role;
grant select, insert, update, delete on public.meeting_minutes   to service_role;

-- minutes_templates: the board manages templates in their community.
drop policy if exists "board manages minutes templates" on public.minutes_templates;
create policy "board manages minutes templates"
  on public.minutes_templates for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (
      (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
      or public.has_permission('voice.manage')
    )
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (
      (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
      or public.has_permission('voice.manage')
    )
  );

-- meeting_minutes: the board manages all minutes in their community.
drop policy if exists "board manages meeting minutes" on public.meeting_minutes;
create policy "board manages meeting minutes"
  on public.meeting_minutes for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (
      (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
      or public.has_permission('voice.manage')
    )
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (
      (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
      or public.has_permission('voice.manage')
    )
  );

-- meeting_minutes: every member may READ PUBLISHED minutes in their community
-- (minutes are official records owners may inspect).
drop policy if exists "community reads published minutes" on public.meeting_minutes;
create policy "community reads published minutes"
  on public.meeting_minutes for select to authenticated
  using (
    status = 'published'
    and community_id = (select community_id from public.profiles where id = auth.uid())
  );

-- ---------- optional seeding (commented) ----------
-- Templates are NOT seeded here; lib/compliance/minutes-templates.ts provides the
-- per-type defaults the capture page falls back to. To override the default for
-- one community/type, insert a row, e.g.:
--   insert into public.minutes_templates (community_id, meeting_type, name, sections)
--   values ('<community-uuid>', 'board', 'Default', '<sections-json>'::jsonb)
--   on conflict (community_id, meeting_type, name) do update set sections = excluded.sections, updated_at = now();

-- Refresh the PostgREST schema cache so the new tables/column are queryable.
notify pgrst, 'reload schema';
