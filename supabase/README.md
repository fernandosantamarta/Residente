# Supabase edge functions

This folder ships four edge function setups:

1. **Stripe card payments** — `create-checkout` + `stripe-webhook`. Powers
   the Pay button. (Sections below.)
2. **Waitlist email notification** — `waitlist-notify`. Emails you whenever
   someone joins the landing page waitlist. (See [§ Waitlist](#waitlist-email-notifications).)
3. **Easy Voice owner invites** — `voice-invite-owner`. Sends an authenticated
   board user's "join Easy Voice" invitation to an owner by email.
   (See [§ Easy Voice owner invites](#easy-voice-owner-invites).)
4. **Easy Voice notice email fan-out** — `notice-email-fanout`. DB-webhook
   triggered; emails every queued email-channel recipient of a new notice
   via Resend. (See [§ Easy Voice email fan-out](#easy-voice-notice-email-fan-out)
   at the bottom.)

The four setups are independent — you can ship any subset without the others.

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

---

# Easy Voice owner invites

`voice-invite-owner` is the bridge between the **Voice → Roster** admin page
and an owner's inbox. The browser calls it (authenticated) with a
`resident_id`; the function generates a Supabase auth invite/magic link and
emails it via Resend with a branded body. Idempotent — re-inviting an
existing owner falls through to a magic link, never duplicates the account.

## Prerequisites

- Resend account + `RESEND_API_KEY` already set (from the Waitlist section).
- Supabase CLI linked.
- A community in Supabase + at least one row in `residents` with an `email`
  (use `/admin/voice/roster` to import).

## 1. Set the function secrets

```bash
supabase secrets set APP_URL=https://residente.io   # already set for Stripe
# Optional — default is "Residente <onboarding@resend.dev>", which works
# without DNS. Once notices@residente.io is verified in Resend, set this:
supabase secrets set NOTIFY_FROM_VOICE="Residente <notices@residente.io>"
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are
injected automatically. The service-role key is needed because
`auth.admin.generateLink` is privileged.

## 2. Deploy the function

```bash
supabase functions deploy voice-invite-owner
```

Note: **no** `--no-verify-jwt` — the function is called by the browser with
a real session and verifies the caller is a `board_member` or `admin`
for the owner's community.

## Test it

1. Sign in as a board member.
2. `/admin/voice/roster` → Import a CSV with one row (your own email).
3. Click **Invite** on that row.
4. Within seconds you should receive a "You're invited to … on Residente"
   email from `NOTIFY_FROM_VOICE`. The link redirects to `/onboard`.
5. The row's status flips to **Invited**, and `residents.invited_at` is set.

Tail logs while testing:

```bash
supabase functions logs voice-invite-owner
```

## Notes

- The default Resend sender (`onboarding@resend.dev`) lands in inboxes
  fine for early invites; the deliverability story improves once your own
  domain is verified.
- Magic links expire after 24 hours. The Roster page exposes a **Re-invite**
  button on already-invited rows for that case.
- Service-role calls in this function bypass RLS — every code path therefore
  re-checks `community_id` against the caller's profile before writing.

---

# Easy Voice notice email fan-out

`notice-email-fanout` is the email side of Easy Voice notifications. The
in-app side ships through the `ev_notice_fanout` DB trigger (Phase 2);
this function handles the email channel.

## How it works

1. Admin sends a notice from `/admin/voice` → row inserted into
   `ev_notices` with `channels` including `'email'`.
2. `ev_notice_fanout` DB trigger materialises one `ev_notice_recipients`
   row per owner who has both a profile and an email, with
   `email_status = 'queued'`.
3. Supabase DB webhook on `ev_notices` INSERT calls this function.
4. The function fetches all `queued` rows for the notice, batches them
   through Resend's `/emails/batch` (up to 100 per call), and flips
   each row's `email_status` to `'sent'` or `'bounced'`.
5. Per-profile statuses are merged into `ev_notices.delivery_report`
   (jsonb) so the board can audit who got what.

## Prerequisites

- `RESEND_API_KEY` secret already set (from the Waitlist section).
- Supabase CLI linked.
- The Phase 4 SQL block at the bottom of `supabase/easy-voice.sql` has
  been run (extends `ev_notice_fanout()` to emit email-channel rows).

## 1. Set the function secrets

```bash
supabase secrets set NOTICE_WEBHOOK_SECRET=$(openssl rand -hex 32)
# APP_URL and NOTIFY_FROM_VOICE are already set from the invite function.
```

Save the `NOTICE_WEBHOOK_SECRET` value — step 3 needs it.

## 2. Deploy the function

```bash
supabase functions deploy notice-email-fanout --no-verify-jwt
```

`--no-verify-jwt` is required — DB webhooks don't carry a Supabase token.
The function instead checks the `NOTICE_WEBHOOK_SECRET` header.

## 3. Wire the database webhook

Supabase dashboard → **Database** → **Webhooks** → **Create a new hook**:

- **Name:** `ev-notices-email-fanout`
- **Table:** `public.ev_notices`
- **Events:** `INSERT`
- **Type:** `Supabase Edge Function`
- **Edge Function:** `notice-email-fanout`
- **HTTP Headers:** add one row
  - Key: `X-Webhook-Secret`
  - Value: *(the `NOTICE_WEBHOOK_SECRET` value from step 1)*

## Test it

1. Sign in as a board member.
2. `/admin/voice` → pick a meeting → **Notify** tab.
3. Compose a test notice with **both In-app and Email** checked.
4. Within seconds your inbox should have a "Notice" email matching the
   subject + body, with a "View in Residente" button linking to the
   meeting.
5. SQL spot-check:
   - `select email_status, count(*) from ev_notice_recipients where notice_id = '<id>' group by 1;` → all `sent`.
   - `select delivery_report from ev_notices where id = '<id>';` → jsonb
     map of profile → `'sent'`.

Tail logs while testing:

```bash
supabase functions logs notice-email-fanout
```

## Notes

- The auto-notice triggers `ev_vote_opened_notice` and
  `ev_vote_results_notice` now default to both channels (`['in_app',
  'email']`) so the email loop fires for every vote-opened and
  vote-results notice too.
- Resend's free tier allows 100 emails/day. A 500-unit pilot can blow
  through that with a single meeting-notice broadcast — upgrade to a
  paid Resend plan before pilot launch.
- Bounces are surfaced as `email_status = 'bounced'`; the function does
  not retry. A future job could re-queue bounced rows for a different
  channel (SMS, once Twilio is wired).
