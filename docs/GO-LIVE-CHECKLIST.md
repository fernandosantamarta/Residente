# Residente — Go-Live Checklist (first paying client)

What to do the moment you land your first real community — **before** they enter
any real data. The guiding principle: the instant a client trusts you with their
community's data, that data becomes irreplaceable, so the safety nets (paid tier +
backups) and real payments must be on **first**, not as a follow-up.

Order matters. Do steps 1–4 before onboarding; do 5 during.

---

## Why "upgrade when we get a client" needs the right timing

Staying on the Supabase **Hobby (Free)** tier until you have a client is the right
call financially. The trap is the gap between *"client starts entering data"* and
*"I remembered to upgrade."* Two Free-tier behaviors bite exactly when a real
client exists:

- **No Point-in-Time Recovery (PITR) / no real backups.** PITR only protects data
  **from the moment it's enabled, forward** — it cannot recover anything from
  before. If a client's data is corrupted or deleted while on Free, it may be gone.
- **Auto-pause after ~7 days idle.** Free projects pause when inactive. A prospect
  signing up — or a live demo — against a paused database hits errors at the worst
  possible moment.

---

## First-client checklist (do BEFORE real data lands)

1. **Upgrade Supabase to Pro** (~$25/mo). Removes auto-pause; unlocks backups.
   - Dashboard → Project Settings → Subscription/Billing.
2. **Enable Point-in-Time Recovery.**
   - Dashboard → Database → Backups → enable PITR.
   - Reminder: it protects data created *after* you turn it on — so do this before
     the client's first record.
3. **Flip Stripe sandbox → live.** Run `stripe-go-live.ps1` (repo root).
   - Set `NEXT_PUBLIC_STRIPE_ENABLED=true` only after the Stripe edge functions are
     deployed live (see `supabase/README.md`).
   - Note: Stripe **test-mode** customers/subscriptions do NOT carry over to live.
     Live starts clean — fine, since there are no real payers yet.
4. **Re-confirm the build gate.** `next build` skips type-check + lint, so run the
   manual gate locally: `node node_modules/typescript/bin/tsc --noEmit` (must be 0
   errors). On this machine `NODE_ENV=production` is set globally, so install dev
   deps first: `npm install --include=dev`. (Plain `npx tsc` misfires here — call
   the local binary directly.)
5. **Then onboard the client** and let them load real data.

---

## Before any demo (while still on Free)

- Hit the app a few minutes beforehand so the project isn't paused mid-demo, or
  upgrade a day early once a lead is serious.
- Delete the throwaway test community ("ZZ Fresh Test HOA (delete me)") from prod
  before showing the app to anyone real.

---

## Already verified (2026-06-18) — don't re-litigate

- **RLS coverage: CLEAN.** Live audit returned zero RLS-disabled public tables —
  every table has Row-Level Security on, no anon/authenticated cross-tenant
  exposure. Re-run anytime via `supabase/verify-rls.sql` (paste into the Dashboard
  SQL editor; Q2 must return zero rows). The **live DB is the source of truth** for
  RLS — policies live in the dashboard, not in migrations.
- **Service-role key never reaches the browser** — only server-side
  `process.env.SUPABASE_SERVICE_ROLE_KEY`. All `app/api/cron|admin/*` routes are
  `CRON_SECRET`-gated; the public `app/api/cpa-share` endpoint validates a ≥32-char
  token, scopes every query to the token's `community_id`, and returns aggregate
  data only (no PII).
- **No raw Postgres connections** — all traffic goes through supabase-js/PostgREST,
  so connection pooling is Supabase's concern, not yours.

---

## Quick reference

| Need | Where |
| --- | --- |
| RLS audit | `supabase/verify-rls.sql` → Dashboard SQL editor |
| Stripe go-live | `stripe-go-live.ps1` (repo root) |
| Stripe edge-fn setup | `supabase/README.md` |
| Typecheck (manual gate) | `node node_modules/typescript/bin/tsc --noEmit` |
| Backups / PITR | Dashboard → Database → Backups |
| Auto-pause / tier | Dashboard → Project Settings → Subscription |
