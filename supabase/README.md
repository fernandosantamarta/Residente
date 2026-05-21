# Supabase edge functions — Stripe card payments

Two functions turn the Pay page's "Pay" button into real card payments:

- **`create-checkout`** — a signed-in resident hits it; it creates a Stripe
  Checkout session and returns the hosted-checkout URL. The browser redirects
  there. The Stripe **secret key never leaves the server.**
- **`stripe-webhook`** — Stripe calls it after a successful payment; it
  verifies the signature and inserts a row into `payments`. That row is what
  makes the resident's balance go down.

Everything below is one-time setup. Until it's done, the Pay button stays
disabled (gated by `REACT_APP_STRIPE_ENABLED`, see step 5).

## Prerequisites

- A Stripe account → https://dashboard.stripe.com
- Supabase CLI → `npm i -g supabase` (or `brew install supabase/tap/supabase`)
- The keys SQL block from `NEXT_SESSION.md` already run (the `payments` table)

## 1. Link the CLI to the project

```bash
cd "HOA Project/residente"
supabase login
supabase link --project-ref nozzfcxijdnllkiydhfi
```

## 2. Add a uniqueness guard on payments (run in the Supabase SQL editor)

The webhook dedups in code, but a DB constraint is the real safety net
against a double-recorded payment:

```sql
create unique index if not exists payments_stripe_session_id_key
  on public.payments (stripe_session_id)
  where stripe_session_id is not null;
```

## 3. Set the function secrets

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are
injected automatically — do **not** set them. You only set these:

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_live_xxx        # Stripe → Developers → API keys
supabase secrets set APP_URL=https://residente.io         # where Stripe returns the user
# STRIPE_WEBHOOK_SECRET is set after step 4 (you need the endpoint first)
```

Use `sk_test_...` while testing, `sk_live_...` for production.

## 4. Deploy the functions

```bash
supabase functions deploy create-checkout
supabase functions deploy stripe-webhook --no-verify-jwt
```

`--no-verify-jwt` on the webhook is required — Stripe has no Supabase token.
(`config.toml` sets the same thing; the flag is the explicit fallback.)

Then register the webhook in Stripe → Developers → Webhooks → Add endpoint:

- **URL:** `https://nozzfcxijdnllkiydhfi.supabase.co/functions/v1/stripe-webhook`
- **Event:** `checkout.session.completed`

Copy the endpoint's **Signing secret** (`whsec_...`) and set it:

```bash
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxx
```

## 5. Turn the Pay button on

In Vercel → Project → Settings → Environment Variables, add:

```
REACT_APP_STRIPE_ENABLED = true
```

Redeploy the frontend. The Pay button goes live. (Local dev: add the same
line to `.env.local` and restart `npm start`.)

## Test it

1. Pay page → "Pay $X" → redirects to Stripe Checkout.
2. Use a Stripe test card: `4242 4242 4242 4242`, any future expiry, any CVC.
3. After paying you land back on `/pay?paid=1`.
4. Within a few seconds the webhook fires; reload — the payment shows in
   history and the balance drops.

Watch logs while testing: `supabase functions logs stripe-webhook`.

## Notes

- `payments.paid_on` defaults to `current_date` and `created_at` to `now()`,
  so the webhook only inserts `community_id`, `resident_id`, `amount`,
  `stripe_session_id`.
- `create-checkout` runs under the caller's JWT, so RLS already stops a
  resident from starting checkout for another community's household.
- The webhook records `amount_total` straight from Stripe — the source of
  truth for what was actually charged.
