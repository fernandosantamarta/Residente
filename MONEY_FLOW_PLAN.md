# Residente — Money Flow Plan ("Link, don't hold")

## Core principle
Residente **never takes custody of community money.** A regulated partner holds and
moves every dollar; Residente only sends instructions and records what happened.
This keeps us out of money-transmitter licensing.

- **Stripe** = hands for money *in* (and any future Stripe→Stripe payout). Holds funds.
- **Plaid** = eyes on the HOA's bank (read-only data). Never moves money.
- **Residente** = brain + dashboard (instructions + ledger). Never the hands.

## The model: each HOA links its own accounts
- **Stripe Connect — Standard (OAuth).** The HOA owns a full Stripe account; Residente
  gets scoped API access to *act on and read* it. Resident payments land in the HOA's
  balance from second one. The HOA is merchant of record and carries dispute/compliance
  liability — Residente carries the least.
- **Plaid (read-only).** The HOA links its operating + reserve bank accounts. Residente
  reads deposits and withdrawals (including vendor checks/ACH paid outside Stripe) to
  reconcile and categorize. Never initiates movement.

## The one line we never cross
We never gain the power to push money *out* of the HOA's account to a third party.
- ✅ Read the HOA bank via Plaid (data only)
- ✅ Run charges that land **in** the HOA's own Stripe (that's what Connect is for)
- ❌ Pull from the HOA bank via Plaid Transfer (or any rail) to pay a vendor — that's
  money transmission. Vendors are paid by the HOA itself (we watch), or later via a
  Stripe→Stripe transfer where Stripe moves it (only after legal review).

> Not legal advice. The vendor-payout leg specifically needs a fintech lawyer's sign-off
> before any in-app payout is built. Everything else here is the standard HOA-platform pattern.

## Runtime flows
### Monthly dues
Resident pays (card or ACH) → **direct charge on the HOA's connected account** →
HOA balance → Stripe payout to HOA bank. Residente records a `payments` row, tags it
**operating**, updates balance. Plaid later sees the bank deposit → auto-reconcile.

### Violations / fines
Board issues a violation → payable fine (Stripe = source of truth). Resident pays via
`create-fine-checkout` **on the HOA's account** → recorded + tagged. Same path as dues.

### Vendor payouts (watch, don't touch)
HOA logs vendor + invoice in Residente → **HOA pays the vendor itself** from its bank →
**Plaid reads the bank**, Residente matches the outflow to the open invoice, marks it
paid, categorizes (operating/reserve), updates the fund balance. Residente never moves it.

## Revenue (stays clean)
Residente's SaaS fee (the 26+ home subscription) stays a **direct charge to Residente**
(`stripe_customer_id` / `stripe_subscription_id` on `communities`) — that's legitimately
our money. Community dues run entirely on the HOA's linked account; we take no per-dues cut
unless a community-level `application_fee` is ever configured.

## Build order (sandbox-first, $0)
1. **Enable Connect** in the Residente Stripe dashboard (test mode). ← do in dashboard
2. **DB columns** — `community-connect.sql` (stripe_account_id, plaid refs).  ✅ slice 1
3. **`connect-onboard` edge fn** — "Connect with Stripe" Standard onboarding URL. ✅ slice 1
4. **Redirect checkouts** — `create-checkout` (then fine/amenity/autopay) charge on the
   connected account when present; fall back to legacy if not linked. ✅ slice 1 (dues)
5. **Plaid Link (sandbox)** — `plaid-link-exchange` + `plaid-sync-transactions`. slice 2
6. **Read-only ledger** — operating/reserve tagging + balances UI. slice 2
7. **Vendor/Bills feature** + Plaid reconciliation. slice 3
8. **(optional, post-legal)** Stripe→Stripe vendor payouts. slice 4

## Account ownership (who opens what)
- **Plaid:** Residente holds ONE platform developer account (the API keys). HOAs open
  nothing — they link their bank inside Plaid Link, under our account. Plaid bills us.
- **Stripe:** Residente holds ONE platform account. Each HOA ends up with its OWN
  connected account (merchant of record, pays Stripe's processing fees), but it's
  created through our "Connect with Stripe" button — never a cold signup. Per-HOA KYC
  happens inside Stripe's own onboarding screens.
- The HOA's whole experience = two buttons in our app: "Connect Stripe" + "Link bank".

## Slice 2/3 — Plaid budget tracking + money-map (spec)
Goal: the budget tracks itself from the bank feed, and the board can see where dues go.

**Data**
- `bank_transactions` table (community_id, plaid_transaction_id unique, posted_date,
  amount, name/merchant, plaid_category, mapped_budget_category_id, fund tag, raw jsonb).
- Category-mapping table: plaid_category -> budget_category_id (per community, editable),
  so re-syncs auto-apply learned mappings; manual override allowed.

**Functions**
- `plaid-link-exchange` — public_token -> access_token (token stored as a secret,
  only a ref in `communities.plaid_access_token_ref`), set plaid_status='active'.
- `plaid-sync-transactions` — pulls/updates transactions (cron + on-demand), upserts on
  plaid_transaction_id (idempotent), applies the category map. Read-only; never moves money.

**Views (on financials page)**
- Budget vs Actual: each budget line = budgeted vs summed actuals from bank_transactions,
  with % used + variance color (mirrors the existing reserve %-funded styling).
- Money-map: IN (dues+fines from Stripe `payments`) -> operating/reserve fund balances ->
  OUT (vendor/expense transactions by budget category from Plaid).

**The Stripe + Plaid split (must combine both):**
- WHO paid dues (per resident/unit): Stripe -> `payments`.
- Did it hit the bank / aggregate deposit: Plaid (sees the Stripe lump-sum payout, not
  individual residents).
- Where money went OUT: Plaid transactions.
Attribute individuals from Stripe; confirm/track cash reality + outflows from Plaid.

**Limits to design around**
- Plaid auto-category is good not perfect -> learning map + manual recategorize.
- Read-only always (no Plaid Transfer pull-to-vendor — see "the one line").
- Dues arrive at the bank as a Stripe lump sum, not per-resident.

## Gatekeeping reality
- Stripe Connect: self-serve, same-day, free to build. Per-HOA KYC is inside Stripe's own
  onboarding click — we never re-apply.
- Plaid: sandbox instant/free; production = one platform-level access request (a few days),
  then per-HOA bank linking happens inside Plaid Link. We apply once, as the platform.
