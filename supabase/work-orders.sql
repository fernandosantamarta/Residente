-- ============================================================
-- Residente — work orders (vendor assignment + lifecycle + completion)
-- Run once in the Supabase SQL editor. Safe to re-run (idempotent).
-- ============================================================
--
-- The board turns a maintenance issue (a resident_request) — or a standalone
-- task — into a work order, assigns a vendor, sets a priority + SLA, and then
-- advances it through assigned → in_progress → completed (or cancelled). On
-- completion the board records actual cost + notes (and optionally a photo).
--
-- A work order may be linked back to the resident_request it came from so the
-- submitting resident can see that their issue is being worked. The reverse
-- pointer resident_requests.active_work_order_id flags the request as "has an
-- open work order" without a join.

create table if not exists public.work_orders (
  id                     uuid primary key default gen_random_uuid(),
  community_id           uuid not null references public.communities(id) on delete cascade,
  request_id             uuid references public.resident_requests(id) on delete set null,
  vendor_id              uuid references public.vendors(id) on delete set null,
  assigned_by            uuid references public.profiles(id) on delete set null,
  assigned_at            timestamptz not null default now(),
  title                  text not null,
  description            text,
  priority               text not null default 'normal'
                           check (priority in ('low','normal','urgent','emergency')),
  status                 text not null default 'assigned'
                           check (status in ('assigned','in_progress','completed','cancelled')),
  started_at             timestamptz,
  completed_at           timestamptz,
  sla_due_at             timestamptz,
  estimated_cost         numeric(12,2),
  actual_cost            numeric(12,2),
  completion_notes       text,
  completion_photo_path  text,
  completion_photo_name  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists work_orders_community_status_idx on public.work_orders (community_id, status);
create index if not exists work_orders_vendor_status_idx    on public.work_orders (vendor_id, status);
create index if not exists work_orders_request_idx          on public.work_orders (request_id);

-- Reverse pointer so a request row can flag "has an open work order" cheaply.
alter table public.resident_requests
  add column if not exists active_work_order_id uuid
    references public.work_orders(id) on delete set null;

alter table public.work_orders enable row level security;
grant references, trigger, truncate on public.work_orders to anon;
grant select, insert, update, delete on public.work_orders to authenticated;
grant all on public.work_orders to service_role;

-- ---------- RLS ----------
-- The board manages every work order in their community. Role-based so this
-- ships without needing a brand-new permission; admins/board members already
-- run the maintenance queue.

drop policy if exists "board reads community work orders" on public.work_orders;
create policy "board reads community work orders"
  on public.work_orders for select to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (
      (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
      or public.has_permission('violations.manage')
    )
  );

drop policy if exists "board inserts community work orders" on public.work_orders;
create policy "board inserts community work orders"
  on public.work_orders for insert to authenticated
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (
      (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
      or public.has_permission('violations.manage')
    )
  );

drop policy if exists "board updates community work orders" on public.work_orders;
create policy "board updates community work orders"
  on public.work_orders for update to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (
      (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
      or public.has_permission('violations.manage')
    )
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (
      (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
      or public.has_permission('violations.manage')
    )
  );

drop policy if exists "board deletes community work orders" on public.work_orders;
create policy "board deletes community work orders"
  on public.work_orders for delete to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (
      (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
      or public.has_permission('violations.manage')
    )
  );

-- A resident may read the work orders tied to their own request so they can see
-- their maintenance issue is being handled.
drop policy if exists "residents read own request work orders" on public.work_orders;
create policy "residents read own request work orders"
  on public.work_orders for select to authenticated
  using (
    exists (
      select 1 from public.resident_requests r
      where r.id = work_orders.request_id
        and r.profile_id = auth.uid()
    )
  );

-- Keep updated_at fresh on every write.
create or replace function public.work_orders_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists work_orders_touch on public.work_orders;
create trigger work_orders_touch
  before update on public.work_orders
  for each row execute function public.work_orders_touch_updated_at();
