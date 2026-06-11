<!-- Generated 2026-06-10. Method: 30-agent audit (9 code-domain mappers, 5 workload researchers,
5 gap analysts, 1 merge/rank) + manual grep verification of the 10 load-bearing claims. -->

# Eliminating the Back Office: Code Audit × Workload Audit

**Goal under test:** eliminate 90% of the work traditionally associated with self-managing a community.

---

## 1. Verdict — which 90% is real

**90% of *total* board workload is not reachable. 90% of the *manager-replaceable* workload plausibly is.**

A ~50-unit self-managed FL association runs **~30–65 board-hours/month** (midpoint ~45, ±40% — no
time-and-motion study exists; triangulated from per-door management pricing, management-contract scope
lists, and board self-reports). Of that, **~12–20 hrs/month is an irreducible human core**: fiduciary
judgment (budgets, assessment levels, enforcement/ARC discretion, insurance choices), chairing and
attending meetings, physical presence (inspections, vendor walk-behinds, emergencies, capital-project
oversight — which even paid managers price *outside* base scope at +2–5% of project cost), fining-committee
hearings, and neighbor-conflict emotional labor. Hurricane months add 20–60+ hours nothing removes.

So the math caps total elimination at roughly **55–75%**:

| Layer | Hours removed (of ~45/mo midpoint) |
|---|---|
| Shipped code, fully activated | ~4–7 (only ~3–5 realized today — key switches are off) |
| Already-approved plans (Steps 3–7 etc.) | ~6–9 additional |
| The ranked proposals below (overlap-adjusted) | ~13–18 additional |
| **Total removable** | **~23–34 hrs/mo** |
| Residual human core | ~12–20 hrs/mo |

But the work a **$12k–30k/yr management contract actually sells** — money ops, communications mechanics,
statutory choreography, records, dispatch coordination — is **~28–38 of the 45 hours**. Against *that*
denominator, 23–34 hours eliminated reaches **~80–90% at the optimistic end**.

**Recommended claim:** "eliminate 90% of the work you would otherwise pay a manager for" — defensible.
"90% of all board work" — not.

### The four gaps between here and there

1. **Activation, not code.** A large share of shipped capability is parked: `NEXT_PUBLIC_STRIPE_ENABLED`
   pending on the host, GL writer/statements built-unmerged on `feat/back-office-phase3b-writer`,
   Connect/Plaid merged but their SQL not run in prod, charge engines built but unscheduled, and savings
   scale linearly with autopay enrollment and resident app adoption.
2. **Attorney sign-off.** Every statutory constant is `validated:false` — this blocks *unattended*
   statutory automation (certified-mail dispatch, member-facing compliance, unreviewed estoppel delivery).
3. **The inquiry firehose is unbuilt.** Resident inquiries (8–20 hrs/mo) are the single largest pool in
   the research, and the platform is **outbound-complete, inbound-blind** — zero inbound email handling.
4. **Spike months.** Capital projects, storms, election season — exclude them from the claim.

---

## 2. The hours model (50-unit self-managed FL association)

Per-category baseline (monthly equivalents; infrequent tasks annualized):

| Category | Hrs/mo | Notes |
|---|---|---|
| Owner communications / complaints / records requests | 5–12 | Raw inquiry firehose alone scored 8–20; ~35% of board time |
| Maintenance & vendor management | 5–12 | Work orders 30–60 min each, 5–15/mo |
| Assessment collection / AR | 4–10 | Board-killer #1; check posting dominates |
| Bookkeeping / AP / reconciliation / statements | 4–8 | The canonical "nobody wants to be treasurer" outsourcing trigger |
| Board meeting cycle | 3–6 | Agenda+notice, packet, minutes × 8–12 meetings/yr |
| Enforcement / violations / ARC | 2–6 | Hearings stay human |
| Statutory notices & certified mailings | 2–6 | Most formality-dense recurring task; errors forfeit fees/liens |
| Annual meeting / election | 1.5–3 | Quorum chasing, two 50-envelope mailings |
| Budget + reserves | 1.5–3 | SIRS-era: non-waivable reserves |
| Insurance cycle | 1–2.5 | |
| Compliance monitoring | 1–3 | |
| After-hours emergencies | 0.5–3 | |
| Tax / audit / filings | 0.5–1.5 | 1120-H, 1099s, annual report |
| Estoppels | 0.5–1.5 | Revenue if automated; fee forfeiture if late |
| Member-vote campaigns | 0–2 | |

---

## 3. Ranked: the 15 highest-value improvements

Every "exists today / verified absent" claim below was grep-confirmed against the repo on 2026-06-10
(branch `feat/back-office-phase3b-writer`, which includes the merged origin/main Connect+Plaid work).

### #1 — Offline payment posting (S) — 2–5 hrs/mo + unlocks everything downstream
Record check/cash/money-order/bill-pay payments into the real ledger via an append-only
`record_offline_payment` RPC (`gl_post_manual_adjustment` pattern), corrections as negative contra rows,
"Record payment" buttons on residents + collections detail. **Why #1:** the only writer to `payments`
today is `stripe-webhook` (`index.ts:188,245` — verified); the documented workaround (editing
`residents.opening_balance`) silently falsifies `residentBalance()`, `casePayoff()`, estoppel certificates,
and the GL AR tie-out for any community not 100% on Stripe. Most 50-unit communities still have check
payers. All consumers (`lib/dues.ts:141-162`, GL projection) are already generic over payments rows —
zero downstream changes. *Not in any plan.*

### #2 — Turn the built money engines ON: scheduler + dunning (S) — 2–6 hrs/mo
`charge-autopay` and `charge-plan-installment` are complete, idempotent, CRON_SECRET-gated — and absent
from `vercel.json` (verified: 4 advisory crons only). Add thin cron routes: charge-autopay (monthly),
charge-plan-installments (daily), plaid-sync (nightly), gl-rebuild (nightly, dry-run tie-out → commit;
failure raises a board notice instead of serving stale statements; schedule before the 13:00 signal crons).
Dunning closes a silent-loss defect: a declined off-session charge today produces no retry, no notice, no
record — handle `payment_intent.payment_failed`, retry ×2, auto-pause autopay, surface on the collections
digest. **Sequencing caveat:** scheduling the engines increases platform-side fund volume until #12 lands —
ship the Connect-routing fix for the charge engines with or before this. *Scheduler deliberately punted in
supabase/README; dunning in no plan.*

### #3 — Execute the approved Steps 3–6 (ACH-in, Plaid, reconciliation, /admin/accounting) (XL) — 4–8 hrs/mo
Validated as the largest planned hour block: bank reconciliation ("#1 internal control, most error-prone
volunteer task"), ACH (kills the card-fee objection keeping owners on checks — verified zero
`us_bank_account` hits repo-wide), the 4–8 hr/mo bookkeeping bundle. **Two re-scopes from this audit:**
(a) add a "Map bank categories" panel to Step 6 — `plaid_category_map` has zero UI references while the
Budget page tells users to map categories (S build, +1–2 hrs/mo, makes budget-vs-actual self-maintaining);
(b) Step 3 ACH and all scheduled charges must run on the HOA's **connected** account or Step 5 payout
reconciliation will be structurally wrong (see #12).

### #4 — AI front desk: inbound email → triage → grounded draft replies + RLS-scoped resident concierge (L) — 4–8 hrs/mo
Attacks the single largest pool (inquiries 8–20 hrs/mo; "what's my balance / when is trash day"). The
deflection substrate is fully built (live balance, documents, calendar, rules, trilingual) and the platform
is verified **inbound-blind** (zero inbound handling; outbound Resend fanout only). Build: per-community
inbound address → triage edge fn (the `extract-setup` Claude forced-tool idiom) → `resident_requests` with
category/draft-reply; board approve/edit/send queue (human always clicks send); records-request emails
auto-start the FS 718.111(12) 10-working-day clock; resident-side `ask-concierge` constructs the Supabase
client with the **caller's JWT** so every tool read is RLS-scoped; ground every dollar figure server-side
from `residentBalance()` — the model never invents amounts. Log deflected-vs-escalated: this metric is the
"board hours cut" case study STRATEGY wants. *Absent from every plan; also de-risks the FS 718.112(2)(a)2
certified-inquiry 30-day trap.*

### #5 — Real owner statements (S–M) — 1–3 hrs/mo + a trust landmine defused
Verified: real residents currently see hard-coded **fake** statements (`DEMO_STATEMENTS`,
`PaySection.tsx:43` and `.mobile.tsx:43`) — directly contradicting the "owner-verifiable" positioning.
Build `buildOwnerStatement()` from the same inputs as `residentBalance()` (ties out by construction),
swap the UI, printable monthly statement page, later a snapshot cron + email. Deflects the #1 repeat
inquiry. Completeness for check-payers depends on #1.

### #6 — Notification completion: email the targeted notices, reminder cron, vote auto-close (S) — 1.5–4 hrs/mo
One wiring pass over the already-built Resend fanout. Verified: all four cron notice builders insert
`channels: []` — dues reminders reach only app-active owners' in-app bells, never email
(`dues-reminders/route.ts:115`). Add a transactional `insert_targeted_notice` SQL helper (also fixes the
documented push-before-recipients race), flip vote triggers to in_app+email, new daily engagement cron
(meeting T-3d/T-1d, vote nudges to non-voters via identity tables only — never touches ballots), auto-close
votes past `closes_at`. Quorum chasing in election months saves 5–15 hrs of door-knocking. Requires the
Resend custom domain (statutory-adjacent mail from `onboarding@resend.dev` is a deliverability risk).

### #7 — Certified-mail dispatch rail: headless PDF + Lob with tracking write-back (M–L) — 2–6 hrs/mo + liability defusal
The hard 90% is built: every statutory letter (FS 718.116/.121 30/45/45 collections ladder, 14-day fining
notices, election mailings) is drafted print-ready with live `casePayoff()` figures and dual-address blocks.
The board then prints, drives to the post office, and **types tracking numbers back by hand** (verified: no
mail vendor anywhere in the repo). Build the long-deferred shared headless-PDF route (playwright-core +
@sparticuz/chromium rendering the existing /document pages), `ev_mailings` evidence table, board-invoked
`send-mailing` edge fn (certified + statutory first-class duplicate to both addresses, per-piece cost rolled
into the case payoff), Lob webhook updates delivery evidence. Defective notice = forfeited attorney-fee
recovery / voided liens — a top-2 outsourcing trigger. Gate sends behind explicit board confirm until
attorney sign-off. PDF service is then reused by #10 and #11.

### #8 — Work-order pipeline: request → vendor magic-link dispatch → completion proof → auto-posted expense (L) — 3–7 hrs/mo
Verified absent (no work-order table, no vendor assignment, no invoice linkage) while both ends exist
(resident requests with photos + notify triggers; curated vendor directory with ratings). Build
`ev_work_orders` with a signed-token vendor magic-link page (no vendor auth accounts — `home-transfer`
action-link idiom): accept/schedule/upload completion photo; on completion with invoice amount, auto-insert
the `ev_expenses` row → flows into GL and budget-vs-actual with no re-keying. COI-expiry signal joins the
weekly compliance scan. Physical coordination stays human — software removes triage, status-chasing,
lost tickets, and invoice re-keying. *STRATEGY P1 one-liner; concretized here.*

### #9 — AP bill inbox: invoice ingestion → AI extraction → dual approval → Plaid-matched paid status + 1099 pack (L) — 3–6 hrs/mo
AP is the core of the #1 outsourcing trigger and entirely absent (verified: `ev_expenses` is hand-keyed,
no AP account in the GL, zero hits for 1099/1120/W-9). Build a `vendors` table (unifies free-text names),
`ev_vendor_bills` + dual-approval RPC requiring two distinct `financials.manage` profiles (digital
dual-control — the #1 fraud control), `extract-invoice` edge fn cloned from `extract-setup` (Claude vision),
GL account 2010 Accounts Payable with bill/bill_payment source types, paid-status auto-closed by Step 5's
reconcile matcher. Tax leg: W-9 capture via tokenized upload page, January 1099-NEC worksheet cron, 1120-H
exempt/non-exempt split riding Step 7's CPA bundle. Money movement stays a human bank action — the locked
"link, don't hold" posture is preserved. *Materially re-scopes MONEY_FLOW slice 3.*

### #10 — Estoppel front door: public title-company intake + statutory-fee checkout + stored-PDF delivery (M) — 0.5–2 hrs/mo + revenue
Uniquely **revenue**: ~$900–1,800/yr at 50 units at the statutory caps — a fee management companies keep.
The statutory middle is the most complete machinery in the product (due-date stamping, itemized fee,
casePayoff-fed financials, auto-waiver when late); both edges are missing — intake is re-keyed from
title-company emails, fee settlement is a manual checkbox, the certificate is never stored
(`certificate_document_id` has zero writers). Public `/estoppel/[slug]` intake (dedicated slug — never the
join code), `create-estoppel-checkout` cloned from `create-fine-checkout` (~75 lines), Connect-routed,
delivery stores the PDF and emails a signed URL. Fee forfeiture on a blown 10-business-day deadline is
eliminated.

### #11 — Meeting-cycle copilot: data-driven agenda + one-click board packet + AI minutes draft (M) — 2–5 hrs/mo
Verified: the statutory meeting-notice document prints **"[Insert agenda items]"**
(`app/admin/meetings/[id]/document/page.tsx:190`) — and FS 718.112(2)(c) requires the posted notice to
identify all agenda items. Agenda builder seeded from live data (collection cases needing board action,
ARC deadlines, due-soon signals, pending plan requests); packet print route compiling the already-computed
GL statements + budget-vs-actual + delinquency brackets + open requests (pure reads, zero AI); `draft-minutes`
edge fn from agenda + secretary's rough bullets, saved as DRAFT for edit, publish fires the existing notice.
No audio transcription in v1.

### #12 — Unify Stripe Connect routing: fines, amenities, saved cards, autopay, refunds (M) — correctness gate
Verified: `stripeAccount` is passed **only** in `create-checkout` — every fine/amenity/saved-card/autopay
dollar lands in Residente's **platform** balance, which falsifies the "$0 of your community's money" claim
for non-dues payments and will structurally poison Step 5 payout reconciliation. Thread the existing
connected-account lookup through all six edge fns; hard part is saved-PM migration (clone PMs to the
connected account or re-enroll); webhook must read `event.account`. Must land with/before #2's scheduler.

### #13 — Special assessments as first-class billable charges (M) — 1–3 hrs/mo annualized; 10–20 in campaign months
In the post-Surfside SIRS + insurance-shock era, special assessments are the #1 new FL money-in event —
and verified unrepresentable today (`special_assessment` exists only as a vote-topic kind;
`residentBalance` knows only opening balance + flat monthly dues). Campaigns fall back to spreadsheets +
`opening_balance` hacks that break GL tie-out, and the estoppel certificate's special-assessment block — a
**binding** document — is a hand-confirmed placeholder. Build `ev_special_assessments` + per-resident
charge schedules, fold into `residentBalance()`/`casePayoff()` (guarded by `verify:dues`), checkout +
payment plans already exist, fund-aware GL entries begin real reserve-fund activity.

### #14 — AI violation intake: photo → rule-book match → board-confirmed letter (M) — 2–4 hrs/mo
Everything downstream is built (violations log with per-rule fines, auto owner notices, 14-day statutory
letters, fine checkout + dispute track); everything upstream is hand-logged. Mobile capture page →
`match-violation` edge fn (image + the community's rule book, forced tool) → staging row → board confirm.
"Convert to violation" on photo-bearing resident requests closes the report-to-violation gap. The rule book
is already seeded from CC&Rs by `extract-setup` at onboarding. Hearings and committee judgment stay human.

### #15 — Records-request production room: responsive-doc attachment + AI PII flag + auto-posting (M) — 1–3 hrs/mo + tail-risk cap
Weaponized serial records requests are a top cited reason small boards capitulate ($50/day minimum damages,
prevailing-party fees, 2024 criminal exposure). The clock and letters shipped with compliance Domain B; the
fulfillment layer is schema-only stubs with zero writers (`checklist_doc_id`, `redaction_status`). Attach
responsive docs to the request, advisory-only PII scan against the FS 718.111(12)(c) protected list (flags,
never auto-redacts), gate "Mark posted" while flagged, auto-post on upload for the 2026-01-01 website duty.

---

## 4. Build sequence

**Wave 0 — activation, not code (this week):** merge `feat/back-office-phase3b-writer`; run
`community-connect.sql` + `community-plaid.sql` in prod; set `NEXT_PUBLIC_STRIPE_ENABLED`; verify the
Resend custom domain; start the attorney review (it gates Waves 2–4's unattended automation).

**Wave 1 — truth + switches (S builds, ~2–3 weeks):** #1 offline payments → #12 Connect unification →
#2 scheduler + dunning → #5 real statements → #6 notification completion. After Wave 1 the money surface
is *true* (no fake statements, no invisible check payers, engines actually fire, notices actually send).

**Wave 2 — the approved money plan (XL):** #3 Steps 3–6 as planned + the two re-scopes (mapper UI;
ACH on connected account). Step 7 (CPA bundle) absorbs #9's tax leg.

**Wave 3 — the new layers (L builds, biggest new hours):** #4 AI front desk, #8 work orders, #9 AP inbox.
These three attack the inquiry firehose, maintenance, and AP — the three largest untouched pools.

**Wave 4 — statutory edges (M builds, mostly independent):** #7 certified mail, #10 estoppel front door,
#11 meeting copilot, #13 special assessments, #14 violation intake, #15 records room. #7 first within this
wave (its PDF service is reused by #10 and #11).

---

## 5. What stays human (don't promise it away)

Budget adoption and assessment levels; escalate-to-attorney calls; ARC and enforcement discretion;
insurance coverage choices; chairing meetings; fining-committee hearings (FS 718.303/720.305 independent
committee); vendor walk-behinds, inspections, emergencies; capital-project oversight; broker/banker/CPA/
attorney relationships; neighbor-conflict emotional labor; hurricanes. The software compresses the
documentation, money mechanics, and chasing *around* all of these — the judgment and the body-on-site remain.

## 6. Verification notes

Grep-confirmed on 2026-06-10: payments written only by stripe-webhook (188/245); vercel.json has exactly
4 crons (no charge/plaid/gl jobs); `DEMO_STATEMENTS` rendered to real residents; cron notices insert
`channels: []`; `stripeAccount` only in create-checkout; "[Insert agenda items]" in the statutory notice;
`special_assessment` only as a vote-topic kind; zero `us_bank_account` (no ACH); no print-mail vendor; no
inbound email handling. Hours figures are research-triangulated ranges (±40%), not measurements — treat
relative ranking as more reliable than absolute values. Full agent outputs (9 domain maps, 5 research
areas, 5 lens analyses) are in the session workflow directory; this document is the durable synthesis.
