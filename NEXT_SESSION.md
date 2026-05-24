# Next session — Residente

Last touched: 2026-05-20 (heavy session — admin section + dues ledger built)

## ⚠️ FIRST THING TOMORROW — confirm the SQL ran

The schema lives only in Supabase (no migration files in the repo). Today's
final SQL block must be run in the Supabase SQL editor or Board / Residents /
Pay will error. Each line starts with `alter` / `create` / `grant`:

```sql
alter table public.residents add column if not exists board_position text;
alter table public.residents add column if not exists opening_balance numeric default 0;

create table if not exists public.payments (
  id                uuid primary key default gen_random_uuid(),
  community_id      uuid not null references public.communities(id) on delete cascade,
  resident_id       uuid not null references public.residents(id) on delete cascade,
  amount            numeric not null,
  paid_on           date not null default current_date,
  stripe_session_id text,
  created_at        timestamptz not null default now()
);
alter table public.payments enable row level security;
grant select, insert, update, delete on public.payments to authenticated;

create policy "members read payments"
  on public.payments for select to authenticated
  using (community_id = (select community_id from public.profiles where id = auth.uid()));

create policy "board writes payments"
  on public.payments for all to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );
```

Gotcha (learned twice): every new SQL-editor table needs an explicit
`grant ... to authenticated` — RLS policies alone fail with "permission denied".

## TOP ITEM TOMORROW — Stripe card payments

The dues ledger foundation is done. The Stripe code is **scaffolded** (see
below); the only thing blocking go-live is **Fernando's Stripe account**
(homework — create it, get the keys).

Scaffolded 2026-05-21 — code is written, not yet deployed:
1. ✅ `supabase/functions/create-checkout/` — authenticated; creates a Stripe
   Checkout session, returns the hosted-checkout URL. Secret key server-only.
2. ✅ `supabase/functions/stripe-webhook/` — verifies the Stripe signature, on
   `checkout.session.completed` inserts a row into `payments`. Idempotent on
   `stripe_session_id`.
3. ✅ Pay button wired → `supabase.functions.invoke('create-checkout')` →
   redirects to Stripe. Gated behind `REACT_APP_STRIPE_ENABLED` — stays
   disabled (current behavior) until that flag is `true`.

Remaining — all on Fernando, follow **`supabase/README.md`** step by step:
- Create the Stripe account; `supabase link`.
- Run the `payments_stripe_session_id_key` unique index SQL.
- `supabase secrets set STRIPE_SECRET_KEY / APP_URL / STRIPE_WEBHOOK_SECRET`.
- `supabase functions deploy create-checkout` and
  `supabase functions deploy stripe-webhook --no-verify-jwt`.
- Register the webhook endpoint in the Stripe dashboard.
- Set `REACT_APP_STRIPE_ENABLED=true` in Vercel and redeploy.

## Shipped 2026-05-20 (today)

Full board-only admin section + the whole dues system. Commits `4aec28b`
through `c2faad5` on `main`.

- **Admin section** `/admin` — `AdminLayout` + nested routes, board-only gate
  (`role IN board_member/admin`). Tabs: Community, Residents, Board.
- **Community Settings** — edits the `communities` row + a budget-categories
  editor (clean-replace save) + **CSV import** for categories.
- **Residents roster** — grouped by **subdivision**; each household shows
  name / address / email / phone; **CSV import** (name,subdivision,address,
  email,phone); inline **opening-balance** field; balance + Paid/Due/Late are
  computed, not toggled.
- **Board page** — board-members section: a **name typeahead** over the roster
  to add members; each member gets a **position** (President / VP / Secretary /
  Treasurer / Member at Large). Plus the decisions feed (add/delete).
- **Home wired to Supabase** — `useCommunityData` hook; hero, budget rings,
  money/pace block, category cards all read real data; falls back to a Sunset
  Lakes demo when no community is linked.
- **"Your money" panel on Home** — personal lens: you contribute / community
  collects / your share of each category, from `monthly_dues`.
- **Dues ledger** — `src/lib/dues.js`: balance = opening_balance +
  (monthsOwed × monthly_dues) − payments; status derived. Current month counts.
- **Pay page** — real page: live balance, opening+accrued−payments breakdown,
  payment history. Pay button staged disabled until Stripe.
- **Right-rail feed + household** wired — board decisions feed + "what you owe".

## Database schema (in Supabase only — no migration files in repo)

- `profiles` — id, full_name, unit_number, email, phone, role, community_id
- `communities` — id, name, location, unit_count, fiscal_year, annual_budget, monthly_dues
- `budget_categories` — id, community_id, name, budget, spent, sort_order
- `board_decisions` — id, community_id, title, vendor, amount, status, decided_on
- `residents` — id, community_id, full_name, unit_number, email, phone,
  subdivision, address, is_board, board_position, opening_balance, created_at
  (legacy unused cols: dues_status, balance)
- `payments` — id, community_id, resident_id, amount, paid_on, stripe_session_id

All non-profiles tables: RLS "members read their community" + "board writes",
plus `grant ... to authenticated`.

## How to see real data (Fernando)

1. Run the SQL above.
2. Admin → Community: set homes, annual budget, **monthly dues**, categories.
3. Admin → Residents: add yourself with your **login email**
   (`fernandosantamarta@rocketmail.com`) — Home/Pay match you to the roster by
   email. Set opening balances.
4. Home + Pay then show your real balance.

## Follow-ups (after Stripe)

- **Resident account invites** — magic-link / service-role edge function so
  residents get logins. Roster works without it; invites are a separate ~30-line
  function + deploy.
- **Burn chart** — Home's 12-month burn shows only the current month; needs a
  `monthly_spend` table + a small entry surface.
- **Household "next assessment"** line was removed — would come from the dues
  schedule once Stripe/recurring is in.

## Live state

- **Production**: https://residente.io (apex canonical, www 307 → apex)
- **Vercel**: residente-nine.vercel.app, auto-deploy from `main`
- **GitHub**: github.com/fernandosantamarta/Residente
- **Supabase**: project `nozzfcxijdnllkiydhfi`, region East US (N. Virginia)
- Build check before every commit: `CI=true npm run build` (warnings = errors).

## Critical rules

- **NEVER use `.catch()` on Supabase calls** — always `try/catch async`.
- **Always wrap network promises in `withTimeout()`** (10s default).
- **Anon key is PUBLIC** — never mark it "Sensitive" in Vercel. RLS does security.
- **Stripe secret key** never touches the frontend — Supabase function secret only.
- **`.env.local` is gitignored.**
- Every new Supabase table needs `grant ... to authenticated`, not just RLS.

## Design constraints (LOCKED)

- **bg** `#0A0A12`, **bg-elev** `#14141F`, **bg-card** `#16162A`
- **grad** `linear-gradient(135deg,#FF3B5F,#B83377,#4F2B8C)`, **grad-warn** `#FF3B5F→#FF8BA8`
- **font** Space Grotesk; Fraunces for editorial pages
- demo: Sunset Lakes, 166 homes, Miramar FL
- right rail renders only on `/` (Home)
- CSS tokens in `src/index.css`; admin styles in `src/admin.css`

## Key file map

```
src/App.jsx                       — auth bootstrap, router, /admin gate
src/components/Layout.jsx         — cockpit chrome, nav, right rail (feed + household)
src/components/AdminLayout.jsx    — admin chrome + nested nav
src/lib/supabase.js               — env-guarded client, getProfile
src/lib/dues.js                   — dues accrual + status (shared)
src/hooks/useCommunityData.js     — community + budget_categories
src/hooks/useBoardDecisions.js    — board feed
src/hooks/useMyResident.js        — signed-in user's roster row + computed balance
src/pages/Home.jsx                — dashboard, wired + "Your money" panel
src/pages/Pay.jsx                 — dues balance, breakdown, history
src/pages/admin/CommunitySettings.jsx — community + budget categories + CSV
src/pages/admin/Residents.jsx     — roster, subdivisions, dues, CSV
src/pages/admin/Board.jsx         — board members + positions + decisions
src/index.css / src/admin.css     — styles
```

## Local dev

```bash
cd "C:\Users\Fernando\OneDrive\Documents\HOA Project\residente"
npm start
```
