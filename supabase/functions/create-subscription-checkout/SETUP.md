# Community subscription billing — setup

Turns on "pay on the spot" at signup. ≤25 homes stay free (no card); 26+ get an
on-the-spot Stripe subscription before their community activates. Pricing is
per-home, billed monthly (Pro $2, Premium $5, Enterprise $10).

The code is in the repo. No Stripe products/prices to create — checkout uses
inline `price_data`, so the only Stripe thing you need is the secret key you
already use for dues.

## 1. Run the SQL
Supabase SQL editor → run `supabase/community-billing.sql` (adds plan /
home_count / stripe ids to `communities`). Idempotent.

## 2. Deploy / update the edge functions (dashboard "Via editor")
Three functions, all single-file, paste-and-Deploy:

| Function | New or updated | Notes |
|---|---|---|
| `create-subscription-checkout` | **NEW** | create it, paste, Deploy |
| `signup-provision` | **UPDATED** | re-paste over the existing one |
| `stripe-webhook` | **UPDATED** | re-paste; keep **Verify JWT OFF** |

Secrets — already set for the dues flow, nothing new:
`STRIPE_SECRET_KEY`, `APP_URL`.

## 3. Add subscription events to the Stripe webhook
You already have a Stripe webhook endpoint pointing at `stripe-webhook`
(for dues). Open it in the Stripe Dashboard → **Add events**:

- `checkout.session.completed` (already there — activates the subscription)
- `invoice.paid` (keeps it active on renewals)
- `invoice.payment_failed` (marks past_due)
- `customer.subscription.deleted` (marks canceled)

Same endpoint, same signing secret — no new webhook needed.

## 4. Test (Stripe test mode)
1. Sign up a brand-new community with **30 homes** (a Pro band).
2. After the account step it should redirect straight into Stripe Checkout
   showing **$60/mo** (30 × $2). Pay with `4242 4242 4242 4242`.
3. You land back on `/admin?activated=1`; within a moment the badge reads
   "Pro plan" and the Activate banner is gone.
4. Sign up another with **10 homes** → no checkout, straight to `/admin`,
   badge reads "Free plan".

If checkout is skipped or the banner stays, tail logs:
`supabase functions logs create-subscription-checkout` and `... stripe-webhook`.

## Notes
- The Activate banner on `/admin` is the safety net: if someone abandons
  checkout (or email-confirmation deferred their provisioning), they can pay
  from there anytime. Free communities never see it.
- Enterprise (500+) currently self-serves at $10/home like the rest. If you want
  it to be "contact sales" instead, gate the redirect on `plan !== 'enterprise'`.
- Go-live = swap `STRIPE_SECRET_KEY` to `sk_live_` (same as the dues flow).
