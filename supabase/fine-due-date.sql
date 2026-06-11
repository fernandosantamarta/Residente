-- Fine due date ------------------------------------------------------------
-- A real, per-fine payment deadline the board sets when issuing a fine.
-- Previously the resident Pay card computed "issued + 30 days" on the fly;
-- this stores it so the date is authoritative and the board can override it.
-- Safe to re-run (idempotent).

alter table public.ev_violations
  add column if not exists due_at date;

-- Backfill existing fines that predate this column with a 30-day window.
update public.ev_violations
   set due_at = opened_at + 30
 where kind = 'fine' and due_at is null;

-- Safety net: any fine inserted without an explicit due date still gets a sane
-- deadline (issued + 30 days). Warnings carry no due date.
create or replace function public.ev_violation_default_due()
returns trigger language plpgsql as $$
begin
  if new.kind = 'fine' and new.due_at is null then
    new.due_at := coalesce(new.opened_at, current_date) + 30;
  end if;
  return new;
end;
$$;

drop trigger if exists ev_violation_default_due_trg on public.ev_violations;
create trigger ev_violation_default_due_trg
  before insert on public.ev_violations
  for each row execute function public.ev_violation_default_due();
