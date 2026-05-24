# Supabase edge functions

This folder ships two edge function setups:

1. **Stripe card payments** — `create-checkout` + `stripe-webhook`. Powers
   the Pay button. (Sections below.)
2. **Waitlist email notification** — `waitlist-notify`. Emails you whenever
   someone joins the landing page waitlist. (See [§ Waitlist](#waitlist-email-notifications) at the bottom.)

The two setups are independent — you can ship either one without the other.

---

# Stripe card payments

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

---

# Waitlist email notifications

The landing page (`/`) drops emails into `public.waitlist`. `waitlist-notify`
emails you the moment that happens, via [Resend](https://resend.com). Without
it, signups still get stored — you just have to remember to check the
Supabase table editor.

## Prerequisites

- A Resend account → https://resend.com (free tier is plenty)
- The `waitlist` table from `supabase/waitlist.sql` already created
- Supabase CLI linked (see step 1 of the Stripe section above)

## 1. Set the function secrets

```bash
supabase secrets set RESEND_API_KEY=re_xxx                  # Resend → API Keys
supabase secrets set NOTIFY_EMAIL=cyberneticsintelligence@gmail.com
supabase secrets set WAITLIST_WEBHOOK_SECRET=$(openssl rand -hex 32)
# Optional: set a custom From address (defaults to onboarding@resend.dev,
# which works without verifying a domain — fine for early signups).
supabase secrets set NOTIFY_FROM="Residente <waitlist@residente.io>"
```

Save the value you generated for `WAITLIST_WEBHOOK_SECRET` — step 3 needs it.

If you set `NOTIFY_FROM` to a `@residente.io` address, you must add Resend's
DNS records (SPF, DKIM) in Namecheap. Until then, use the default
`@resend.dev` from address.

## 2. Deploy the function

```bash
supabase functions deploy waitlist-notify --no-verify-jwt
```

`--no-verify-jwt` is required — DB webhooks don't carry a Supabase token.
The function instead checks the shared `WAITLIST_WEBHOOK_SECRET` header.

## 3. Wire the database webhook

Supabase dashboard → **Database** → **Webhooks** → **Create a new hook**:

- **Name:** `waitlist-insert-notify`
- **Table:** `public.waitlist`
- **Events:** `INSERT`
- **Type:** `Supabase Edge Function`
- **Edge Function:** `waitlist-notify`
- **HTTP Headers:** add one row
  - Key: `X-Webhook-Secret`
  - Value: *(the `WAITLIST_WEBHOOK_SECRET` value from step 1)*

Save. Anonymous edge function call needs no Authorization header here —
`config.toml` already turns off JWT verification for this function.

## Test it

1. Open https://residente.io, scroll to the waitlist card, submit your email.
2. Within a few seconds you should get an email at `NOTIFY_EMAIL`.
3. The row should also appear in Supabase → Table editor → `waitlist`.

Tail logs while testing:

```bash
supabase functions logs waitlist-notify
```

## Notes

- The unique index is on `lower(email)`, so case differences are dedup'd at
  the DB level. The frontend shows a friendly "you're already on the list"
  message when it hits `23505`.
- Resend has a 100 emails/day free tier — generous for early access volume.
- The webhook payload also goes to the function `old_record` field for
  UPDATEs and DELETEs; this function only listens for INSERT (per the
  webhook config) so that path never fires.
