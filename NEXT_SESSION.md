# Next session — Residente

Last touched: 2026-05-24 (Easy Voice Phase 4 in flight on
`andres/easy-voice-nextjs` — pilot launch readiness).

## ⚠️ FIRST THING (Phase 4) — re-run `supabase/easy-voice.sql`

Phase 4 appends new blocks to the bottom of `supabase/easy-voice.sql`.
Open the file in Supabase SQL editor and run the **PHASE 4** sections at
the very bottom (safe to re-run — everything uses `IF NOT EXISTS`):

- **Commit 1 (Owner roster CSV import)** — adds
  `residents.first_name`, `residents.last_name`, and a unique partial
  index on `(community_id, lower(email))`. Without it, the new
  `/admin/voice/roster` page will save data but won't enforce dedupe.

## Phase 4 — what's shipped so far on `andres/easy-voice-nextjs`

- **Commit 1 — Owner roster CSV import (admin)**
  New page `/admin/voice/roster` with a sub-nav between Meetings and
  Roster. Drop a CSV (header: `unit_number, first_name, last_name,
  email, phone`) → live preview table flagging per-row errors (bad
  email, missing fields, duplicates, unit/email already in roster) →
  one-click import upserts `ev_units` then `residents` (idempotent;
  existing owners matched by email are updated, not duplicated).
  `residents.full_name` is kept in sync (`first || ' ' || last`) so
  the dues dashboard and right-rail remain unaffected. Logs
  `roster.imported` audit event with counts.
  Files: `lib/voiceRoster.ts`, `app/admin/voice/roster/page.tsx`,
  CSS additions in `app/admin.css`, new audit event types in
  `lib/audit.ts`. Build green; route appears in build output.

- **Commit 2 — Owner invitation flow + magic-link emails**
  New edge function `supabase/functions/voice-invite-owner` — board user
  in `/admin/voice/roster` clicks **Invite** (per row) or **Send N
  invitations** (bulk). The function verifies caller's board role
  against the resident's community, generates a Supabase auth invite
  (falls back to magic link if the auth user already exists), sends
  a branded "You're invited to … on Residente" email via Resend
  (default sender `onboarding@resend.dev` until `notices@residente.io`
  is DNS-verified), and writes back `residents.invited_at` +
  `residents.profile_id`. Resend logs success. Logs `invite.sent`
  audit event. Re-invite button on already-invited rows handles the
  24-hour magic-link expiry.
  **Deploy (one-time):** see [§ Easy Voice owner invites](supabase/README.md#easy-voice-owner-invites)
  in the supabase README. Needs `supabase functions deploy
  voice-invite-owner` and optionally setting `NOTIFY_FROM_VOICE`.

- **Commit 3 — Onboarding + electronic voting consent**
  New public route `/onboard` — the magic-link landing page for invited
  owners. Multi-step flow: **password → terms → consent**. The consent
  step is a visually-distinct red-tinted screen with four plain-English
  disclosures (PLACEHOLDER COPY — Andres should review before pilot),
  a single "I consent" button, and a foot-note explaining the immutable
  log. Writes a row to `ev_consents` with server-derived IP (via new
  `/api/ip` route) and `navigator.userAgent`. Sets
  `residents.activated_at` once consent succeeds (idempotent — only if
  null). Already-activated users with no consent row skip straight to
  the consent step.

  SQL appended: `ev_has_consented(profile, community)` stable helper +
  `ev_ballot_consent_guard` trigger on `ev_ballots` BEFORE INSERT.
  Result: even if a buggy client bypasses the UI, **the database refuses
  to record a ballot from a profile without a consent row in that
  community** (FL 718.128 / 720.317 hard block).

  Resident voting UI catches the new error: when `cast()` fails with
  "consent required", the vote card shows a friendly red banner with a
  one-tap **Consent now →** link to `/onboard` instead of a raw error.

  Files: `app/onboard/page.tsx`, `app/onboard/onboard.css`,
  `app/api/ip/route.ts`, additions to `lib/voice.ts`
  (`CONSENT_DISCLOSURES`), `app/app/voice/[id]/page.tsx` (friendlier
  error path), and the SQL block at the bottom of
  `supabase/easy-voice.sql`.

- **Commit 4 — Email notice delivery via Resend**
  Notices sent from the admin Notify panel now fan out by email in
  addition to in-app. New edge function `notice-email-fanout` (DB
  webhook on `ev_notices` INSERT) reads queued `ev_notice_recipients`
  for the new notice, batches sends through Resend `/emails/batch`
  (up to 100/req), flips each row's `email_status` to `sent` or
  `bounced`, and merges per-profile statuses into
  `ev_notices.delivery_report` jsonb.

  SQL: `ev_notice_fanout()` now also materialises email-channel
  recipient rows (for every profile in the community with a non-null
  email). The auto-notice triggers (`vote_opened`, `vote_results`)
  default to both channels.

  Admin Notify panel: replaced the "in-app only (email coming soon)"
  readout with two real checkboxes — In-app and Email — defaulting to
  both. The two other in-page notices (meeting_published auto-send +
  agenda/minutes upload auto-send) now use `DEFAULT_CHANNELS` from
  `lib/voice.ts` so they pick up the email channel automatically too.

  **Deploy (one-time):** see [§ Easy Voice notice email fan-out](supabase/README.md#easy-voice-notice-email-fan-out).
  Needs `supabase functions deploy notice-email-fanout --no-verify-jwt`,
  a new `NOTICE_WEBHOOK_SECRET` secret, and a DB webhook wired in the
  Supabase dashboard.

- **Commit 5 — Ballot encryption for secret ballots (tweetnacl)**
  Secret ballots are now end-to-end encrypted client-side. New
  `lib/ballotCrypto.ts` wraps tweetnacl + tweetnacl-util (added as
  prod deps). Per-vote nacl.box keypair; the secret key is wrapped to
  the admin's tally password with PBKDF2-SHA256 (200k iters) +
  nacl.secretbox and stored on `ev_votes.wrapped_secret_key`. The
  platform operator never holds the unwrapped key.

  Wire format documented in the header of `lib/ballotCrypto.ts`. All
  bytes are base64-encoded text in the DB (Supabase bytea is awkward
  through PostgREST); the existing unused `ev_ballots.encrypted_answer`
  column is converted from bytea to text in the migration.

  **Admin VoteForm**: secret votes now prompt for a tally password
  (with a confirm-it-was-saved checkbox), generate the keypair, wrap
  the secret key, and force download a key card text file as the
  offline recovery path. Lose both the password AND the card → ballots
  are unrecoverable, which is the legal point of a secret ballot.

  **Admin VoteRow**: secret votes get a two-step close flow — first
  click "Close vote" (flips status to `closed` so no new ballots
  arrive), then "Decrypt & tally" prompts for the password,
  unwraps the secret in-browser, decrypts every ballot's
  `encrypted_answer`, and writes back plaintext `answer`. The tally
  trigger picks up the UPDATE and updates `yes/no/abstain_count`.

  **Resident `/app/voice/[id]`**: cast() detects `ballot_type=secret`,
  encrypts the answer with the vote's public key, and inserts
  `answer=null, encrypted_answer=<base64>`.

  SQL: `ev_votes` gains `public_key`, `wrapped_secret_key`,
  `key_created_by`. `ev_ballot_tally()` now handles the
  null→answer UPDATE path so the tally trigger fires on decrypt.
  `grant update (answer)` + board-only RLS policy for `ev_ballots`.

  No edge function — all crypto is client-side, intentionally.

## ⚠️ FIRST THING — confirm both SQL blocks ran

Two unmerged migrations now live in `supabase/` as `.sql` files. Both must
be run in the Supabase SQL editor — neither is committed to the DB yet.

### 1. Waitlist table (new, for the landing page)

`supabase/waitlist.sql` — creates `public.waitlist`, unique index on
`lower(email)`, RLS, and an `insert` grant to `anon`. Without it the
landing's email form fails on submit.

### 2. Payments + residents schema (carried over from 2026-05-20)

The block below must still be run if it wasn't last time. If Board / Residents
/ Pay error, this is why. Each line starts with `alter` / `create` / `grant`:

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

## TOP ITEM — Landing page deploy (NEW, 2026-05-23)

Landing page shipped at `/`. Cockpit moved to `/app/*`. Form writes to the
new `public.waitlist` table. Optionally — email-on-signup via the
`waitlist-notify` edge function.

**To make signups work (required):**
1. Run `supabase/waitlist.sql` in the Supabase SQL editor.
2. Visit https://residente.io after the next Vercel deploy — drop your own
   email in the form, then check Supabase → Table editor → `waitlist`.

**To get an email on every signup (optional, follow `supabase/README.md`):**
- Create a [Resend](https://resend.com) account, copy the API key.
- `supabase functions deploy waitlist-notify --no-verify-jwt`
- `supabase secrets set RESEND_API_KEY=... NOTIFY_EMAIL=cyberneticsintelligence@gmail.com WAITLIST_WEBHOOK_SECRET=$(openssl rand -hex 32)`
- Dashboard → Database → Webhooks → create a webhook on `public.waitlist`
  INSERT pointing at `waitlist-notify`, with header
  `X-Webhook-Secret: <the value you set above>`.

Until the Resend wiring is done, signups still land in the table — you just
won't get a ping.

## TOP ITEM — Stripe card payments

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

## Shipped 2026-05-23 (today)

Public landing page at `/` (waitlist + brand), cockpit moved under `/app/*`.

- **Landing page** `/` — `Landing.jsx` + `landing.css`. Hero with photo,
  "What is Residente?" + 3 feature cards (1 cream + 2 dark navy), trust
  strip, "Built for both sides" use-cases, waitlist CTA, footer. Mobile
  responsive. Palette: terracotta + cream + dark navy (its own surface,
  cockpit theme tokens don't bleed in).
- **Hero image** `public/hero.jpg` — Hvar, Croatia at golden hour
  (Cody Black via Unsplash). Easy to swap: drop a custom render at the
  same path.
- **Waitlist table** `supabase/waitlist.sql` — `public.waitlist` with
  unique `lower(email)` index, RLS, insert grant to `anon`. **Not yet run
  in Supabase** — see top of this file.
- **Waitlist edge function** `supabase/functions/waitlist-notify/` —
  scaffolded; called by a DB webhook on INSERT, emails Fernando via Resend.
  **Not yet deployed** — full steps in `supabase/README.md`.
- **Route refactor** — cockpit moved from `/*` to `/app/*` (Home is `/app`).
  Login redirects to `/app`. AdminLayout "Back to app" → `/app`. Stripe
  success/cancel URLs → `/app/pay?paid=1` / `/app/pay`. Logged-in `/`
  redirects to `/app`.
- **Body min-width** — landing escapes the cockpit's 1440px floor via
  `body:has(.landing-screen) { min-width: 0 }` (same pattern as login).

## Shipped 2026-05-20

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
- `waitlist` — id, email (unique on lower()), community, source, created_at

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
- right rail renders only on `/app` (Home — moved from `/` on 2026-05-23)
- CSS tokens in `src/index.css`; admin styles in `src/admin.css`;
  landing styles in `src/landing.css` (its own tokens, no cockpit overlap)

## Key file map

```
src/App.jsx                       — auth bootstrap, router (/, /login, /admin, /app/*), /admin gate
src/pages/Landing.jsx             — public marketing landing + waitlist form
src/landing.css                   — landing palette + layout (terracotta/cream/navy)
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
