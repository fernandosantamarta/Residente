<!-- Generated 2026-06-05 -->

# Residente: Is It Worth Paying For? A Decision-Ready Strategy Report

*Founder-to-founder. Grounded in the codebase as it actually ships, the market as it actually exists, and the critic's corrections. No overclaims.*

---

## 1. Verdict

**Today, Residente is worth paying for by exactly one buyer: a small self-managed Florida condo or HOA staring down the records-website compliance deadline, that wants its residents to actually see where the money goes.** For that buyer it is genuinely differentiated and arguably the best fit on the market — resident-first by design, with a live FS 718/720 compliance engine and operator-blind secret ballots that no incumbent ships. But it is **not yet a complete back-office**: there is no ACH (card-only payments), no general ledger, no work-order system, and no native mobile app. A self-managed treasurer cannot run their association on Residente alone today — they'd still need QuickBooks underneath, which breaks the "replace the spreadsheet" promise the landing page makes. The honest answer: **worth paying for as a transparency-and-compliance layer right now; not yet worth paying for as the single system of record.** The strategy and the code point in opposite directions in a few places (most sharply: the anti-fee wedge vs. card-only payments), and closing that gap is what turns "promising" into "undeniable."

---

## 2. The Market & Where We Sit

The HOA/condo software market has one defining structural feature: **it is 100% built for the buyer, who is almost never the resident.** The board or management company pays and configures; the resident is a payer and data subject who sees only what the operator chooses to expose. That is the white space.

### Tier 1 — PM Incumbents (rentals-first, retrofitted to HOAs)

| Vendor | Who pays | Transparency stance |
|---|---|---|
| **AppFolio** | Management company (per-unit, ~$298/mo min + $400–$5k onboarding) | Manager-first; owner visibility is a manager-enabled function, not a right. Killed free resident eCheck (2023), $9.99 debit fee |
| **Buildium** (RealPage-owned) | Manager/board (tiered + per-EFT/bank/eSign fees) | Manager-first; HOA features bolted onto a rentals core |
| **Yardi** (Breeze/Voyager) | Manager (per-unit, $400/mo min) | Manager/board-first; CondoCafe portal curated by manager |
| **DoorLoop** | Manager/board (~$1/unit + merchant acct) | Manager-first, role-gated; HOA module new |
| **RealPage** | Manager (enterprise quote) | Strongly extraction-oriented; monetizes resale/estoppel docs, insurance, payment fees. DOJ algorithmic-pricing suit, settled 2025 |

### Tier 2 — HOA Platforms (HOA-native, still manager-sold)

| Vendor | Who pays | Transparency stance |
|---|---|---|
| **Vantaca** | Management company (quote-only, annual lock-in) | Operational transparency *to boards*; owners pay ~3.49–4.9% card + $2.99 ACH via Vantaca Pay |
| **CINC Systems** | Management company (quote + integrated banking) | Transparency pitched to boards; banking/payment-flow economics are the real model |
| **FRONTSTEPS** | Manager/self-managed (quote, modular) | Portals marketed as transparency; resident experience undercut by data-hygiene/support failures |
| **Enumerate** (ex-TOPS) | Manager/self-managed (quote) | Strong board-control/records-ownership messaging; Engage layer feels bolted on |
| **Pilera** | Manager/self-managed (modular) | The partial exception — strong resident-facing doc access + transparent e-elections |

### Tier 3 — "Resident-First" (mostly still board-paid)

| Vendor | Who pays | Transparency stance |
|---|---|---|
| **TownSq** (Associa) | Board/manager (per-door) | Transparency as satisfaction driver; ~75% resident non-use cited, rated as low as 1.2/5 |
| **PayHOA** | Board (published flat tiers, ~$1.17/unit at scale) | **Strongest explicit transparency pitch in the cluster** — but financial, *to the board*; no resident mobile app |
| **Condo Control** | Board (quote, modular, mandatory setup) | Transparency as feature; stacks 1%/$2 on top of Stripe cards |
| **HOALife / Smartwebs** | Board (enforcement point tools) | Inherently board-adversarial toward residents |
| **HOA Express / Neighborhood.online** | Community (flat/free) | Website + engagement; closest to resident-facing framing, but thin on workflow |
| **Voting specialists** (ElectionBuddy, vote.direct, Vote HOA Now, TrueHOA) | Association (per-election/per-door) | "Verifiable" = duplicate-IP checks, admin audit logs, or hash-chains — **none ship operator-blind crypto ballots** |

### The white space

Three gaps that no one fills:
1. **Resident as the first-class customer** with default-on visibility as a *right*, not a permission.
2. **Owner-facing FS 718/720 compliance** — incumbents (even Vantaca's SIRS reporting) expose compliance only to managers.
3. **Operator-blind, voter-verifiable elections** — the entire voting field "gestures at verifiable" and one (CINC) literally markets *eliminating* third-party verification.

Residente is the only product positioned in all three. The reason incumbents can't follow is structural: their two biggest revenue engines are **manager-curated gatekeeping** and **payment-rail/float monetization** (Vantaca 3.49–4.9%, Condo Control +1%/$2, AppFolio $9.99 debit, CINC's payment-flow banking model). Resident-first transparency and zero-cut payments directly cannibalize both. **A feature is copyable in a quarter; a revenue model is not.**

---

## 3. Our Unfair Advantages

Separated into what's **shipped** versus what's **aspirational** (the critic flagged several "moats" that are real in code but invisible to users, or marketed beyond what the code does).

### REAL / shipped — verified in code

| Advantage | Evidence | Why hard to copy |
|---|---|---|
| **Operator-blind secret ballots** | `lib/ballotCrypto.ts`: client-side NaCl box + PBKDF2-SHA256 @ 200k iterations, password-wrapped keys. DB constraints: `election_must_be_secret`, one-ballot-per-unit unique, `ev_ballot_consent_guard`, `ev_proxy_election_guard` | Residente genuinely *cannot* decrypt a secret ballot. No HOA competitor ships this; theirs is duplicate-IP or audit-log "verifiable" |
| **Live FS 718/720 compliance engine** | `lib/compliance/` — 12 signal-producer modules (estoppel, collections, financials, elections, governance, enforcement, meetings, structural/SIRS, ARC, official-records, rules-core). Date-aware business-day math, dual-address lien rules, statute citations per constant | Encodes attorney labor against a *moving target* (SB 4-D→154, HB 1021/1203/913, CPI-indexed estoppel). National incumbents have low incentive to deep-specialize in one churning state |
| **Zero payment markup** | `create-checkout`, `create-fine-checkout`, `stripe-webhook`: charge exactly `cents`, no `application_fee_amount`, no `transfer_data`, no Connect destination | Incumbents structurally can't match without cannibalizing float/markup revenue |
| **Published flat pricing** | `lib/plan.ts`: Free ≤25 homes, then $2/$5/$10 per home, residents always free | Entire incumbent field is quote-only/demo-gated |
| **Resident-first read transparency** | Resident dashboard computes real spending pace (actual vs expected %), reserve balance, per-category breakdown; searchable board-decision feed; append-only `ev_audit_log` (50+ event types, no delete grants); immutable consent records | Structural — incumbents would have to re-architect to owner-first |
| **ARC decision rationale to residents** | `app/app/arc/page.tsx:199–204` shows `decision_reason` on approved/denied/conditions | *(Critic correction: this is shipped — the digest wrongly claimed it was hidden)* |

### Aspirational — do NOT market as shipped

- **"Voter-verifiable" elections.** What ships is *operator-blind* secrecy. `decryptAndTally()` (`admin/voice/page.tsx`) has the **admin** unwrap the key and write back plaintext; the audit log records `ballot.cast` + an UPDATE, **not what was decrypted**. There is no per-voter receipt, no public reconcilable tally, no hash-chained audit. **Claim "sealed even from us" — never "verify your vote was counted."**
- **The compliance engine is legally inert until attorney sign-off.** Critic correction: it's worse than the digest's "21 constants" — `rule()` *defaults* `validated` to `false` (`rules-core.ts:37`), so **every constant not explicitly marked true is unvalidated.** Member-facing display is gated behind `ATTORNEY_REVIEW_BANNER`.
- **Trilingual (EN/ES/PT).** `es.ts`/`pt.ts` exist, but **no language-toggle component was found in `app/` or `components/`.** A Spanish/Portuguese speaker likely cannot switch languages in the UI. This is a *latent* asset, not a shipped one — treat as a near-term build, not a current GTM weapon.

---

## 4. Where We'll Lose Deals Today

Honest table-stakes gaps, verified against the code, prioritized by how often they kill a deal.

| # | Gap | Verified status | Why it loses the deal |
|---|---|---|---|
| 1 | **No ACH / bank payments** | Every checkout fn is Stripe card-only; zero `us_bank_account`/Plaid | Card-only = ~2.9%+$0.30 on every dues payment + high declines with older FL owners. **This makes Residente the *most* expensive way to pay** — and directly contradicts our own anti-fee wedge |
| 2 | **No general ledger / accounting** | CSV + QB-bank-feed *export* only; no GL/AR/AP/reconciliation | A self-managed treasurer still needs QuickBooks underneath. Kills "replace the QuickBooks black box." PayHOA — our closest competitor — *is* an accounting platform |
| 3 | **No work-order / maintenance system** | No work_order entity anywhere; only a generic 5-category "Contact the board" form | "How do residents report a broken pump and how do I dispatch a vendor?" — the demo dies here. Table-stakes in every cluster |
| 4 | **No native mobile app** | Responsive web only; web-push infra partial (`libwebPush.ts`) | PayHOA's missing app is its #1 complaint; we're repeating it. Fatal for a resident-*first* adoption thesis |
| 5 | **No bulk / newsletter comms** | Only one-off `custom_broadcast`; statutory fan-out exists, general comms don't | Boards expect "pool closed this weekend" to everyone in two clicks. This is what drives *daily* engagement |
| 6 | **No community engagement layer** | Resident↔board only; no forums/polls/directory/events | No daily reason to return between dues cycles → the same ~75% non-use trap we're built to beat |
| 7 | **Global (not per-kind) notification prefs** | `email_pref`/`sms_pref`/`push_pref` are single all/important/none values | Can't say "SMS for fines, mute amenity updates" → opt-out fatigue |
| 8 | **No resident money-agency** | Can pay; can't request payment plan, dispute a violation, or get amenity refunds in-app | Transparency without agency — we show you the lien ladder but give you no lever |

**The unifying problem:** items 1–3 are the things the marketing copy implies are *solved* ("replaces QuickBooks," dues "in 30 seconds," "100% of activity visible"). A board doing a real evaluation finds this fast. **Close the gap or soften the copy.**

---

## 5. Positioning

### The category to own
**The owner-verifiable HOA platform — built for residents, run on the law.**

This is the one position the entire manager-first field is *structurally barred* from claiming: the resident as a first-class customer, transparency as a right enforced in code, backed by the crypto-voting moat and the live FS engine. It's distinct from "resident portal" (a feature incumbents bolt on) and "management software" (their whole identity).

### The one-liner
*"See where every dollar goes, vote in a ballot we can't read, and know your community is on the right side of Florida law — built for residents, not a management company."*

### The three pillars (each backed by shipped code)

1. **SEE EVERYTHING** — real-time spending pace, reserve balance, per-category breakdown, searchable board-decision feed, append-only audit log. *(Replace "100% of activity visible" — it's literally false; executive sessions and manager emails aren't shown.)*
2. **YOUR VOTE IS SEALED — EVEN FROM US** — NaCl box + PBKDF2 ballots, DB-enforced secret-ballot constraint, immutable consent. *(Not "verify your vote was counted" — that's not shipped.)*
3. **BUILT ON THE LAW** — 12-module FS 718/720 engine with date-aware deadlines, fining due-process, estoppel/lien math. *(Behind the attorney-review banner until validated.)*

### The villain narrative: **Opacity by Design**

The enemy isn't a brand — it's a business model. **The incumbents need residents in the dark because that's how they make money.** They sell to managers, monetize the money flowing through their rails, and gate the books behind manager configuration. The #1 documented resident grievance across every forum is financial opacity ("no visibility to where our money is being spent"), followed by surprise special assessments and "fees to pay your own dues." Cite the *credible, public* villain (per-transaction resident fees; the RealPage/Buildium antitrust litigation) — but state it carefully, because we're a trust-first brand and over-stated disparagement is its own liability.

**Two claims to fix immediately (zero cost, pure credibility protection):**
- "100% of activity visible" → an enumerated, defensible claim.
- "No middleman" → "no management company between you and your community." (We *are* a middleman — Stripe, Supabase. The honest claim is the elimination of the management layer.)

---

## 6. How Communities Choose & Switch Us

### Beachhead
**Self-managed FL condos, 25–150 units, past their compliance cliff.** The records-website mandate is *already in force* (condo 2026-01-01, HOA 2025-01-01) with **no statutory grace window.** As of today (2026-06-05), every in-scope condo 25+ units that hasn't posted records is technically non-compliant and exposed to daily penalties and personal director liability. Self-managed is the right tip: **no incumbent contract to break,** and the incumbents explicitly don't serve them ($280–$400/mo minimums, multi-year lock-in price them out).

**One unresolved trap to name honestly:** this beachhead's table-stakes is full accounting (a self-managed treasurer needs books) — which is our largest, slowest gap. So the beachhead we pick *cannot be fully served* until accounting ships. **Resolve this explicitly (see Roadmap #7): either ship QBO sync, or re-scope the pitch to "compliance + transparency layer alongside your existing books" and stop saying "replaces QuickBooks."**

### The wedge / trigger (sequenced by urgency)
1. **Compliance deadline already breached** — fear of fines + personal liability. Present-tense, time-boxed, strongest.
2. **Special-assessment outrage** from underfunded reserves — our reserve dial turns trauma into a switch moment.
3. **Fee fatigue** — incumbents make owners "pay twice." *(Gated on shipping ACH first — see risks.)*
4. **Election-fraud / recall anxiety** — the crypto ballot, for the move-upmarket story, not the entry wedge.

### Buyer vs. user
The **board** decides and pays (sell them a compliance/liability solution — rational trigger); the **residents** benefit and use (deliver the transparency they're "quietly hoping for" — emotional pull that drives adoption and referral). The board signs; the residents make it sticky. Free-≤25-homes lets the smallest boards say yes with zero budget approval.

**The objection no lens confronted, and you must:** *many boards do not want radical transparency* — it exposes them to scrutiny and recall. "Why would I buy a tool that lets my residents audit me?" is a real structural sales objection. Lead with **compliance fear** (which they can't opt out of) and let resident demand pull from below; don't assume transparency sells itself to the people it constrains.

### Switching-cost neutralizers
- **Import in one CSV** (`parseResidentsCsv` already supports name/subdivision/address/email/phone with header auto-detect) — self-managed boards have no incumbent to rip out.
- **`join_code`** invites every household instantly.
- **Make "own your data, one-click export, no lock-in" an explicit, loud promise** to weaponize the incumbent records-held-hostage complaint. Pair every export with a **migration-IN tool** that ingests competitor CSVs (lowers cost to *adopt*, while compliance/crypto/economics raise cost to *leave*).

### Channels (by buyer trust graph, not paid ads)
1. **FL community-association attorneys — primary.** They advise boards on the exact statutes we operationalize, fear malpractice from non-compliant clients, and can recommend the tool that makes their advice executable. Our attorney-review posture is purpose-built to earn their endorsement — and **recruiting them to validate the (large) unvalidated constant set unblocks member-facing compliance display *and* creates referral partners. Two birds.**
2. **Director-education channel** — the mandated 4-hour curriculum trains every new director on milestone/SIRS/elections/records/fines. Map onboarding to it.
3. **Resident word-of-mouth** — *once the language toggle ships*, the trilingual app reaches the Hispanic/Lusophone owner base incumbents ignore.
4. **Property managers — deliberately later, carefully framed.** Selling to managers cannibalizes the "for residents, not a management company" position that *is* our differentiation.

### Network-effect loop
Owner-to-board, **cross-community**: a resident in Community A who loves the transparency becomes the evangelist who tells a friend on Community B's board. This is the *inverse* of incumbent top-down distribution and is defensible because incumbents structurally can't deliver resident love. Instrument it: in-app "Bring Residente to a community you're on the board of" with attribution; "your community is X% on Residente" nudge. Core metrics: activated-residents-per-community, referrals-per-resident.

---

## 7. Pricing & Business Model

### Recommended packaging

Keep the **community-billed, residents-free, per-home** structure — it correctly aligns buyer and user and removes the adoption-killer of resident-side paid models. But restructure around **value, not just headcount:**

| Move | Detail | Why |
|---|---|---|
| **Lower the per-home base** | Competitive with PayHOA (~$1.17/unit) / TrueHOA ($0.50/door) for platform + transparency | Premium $5 / Enterprise $10 look 4–10x competitors on a TCO calculator a board builds in 5 minutes |
| **Compliance as the premium axis** | Gate *automation*: deadline monitoring, statutory records portal, fining state-machine, estoppel automation, verifiable elections | Compliance is the one thing FL buyers are legally *forced* to solve — strongest willingness-to-pay. Today it's given away flat, so there's nothing to anchor a premium against |
| **Keep ALL resident read-transparency free forever** | Budgets, votes, minutes, violation status, financials | Protects the resident-first brand; the board pays for *its own* legal protection, not residents for visibility |
| **Replace IT add-ons** | Drop SSO $99 / API $49 (irrelevant to volunteer boards) for compliance/elections value-aligned upsells | Match willingness-to-pay to what boards fear penalties over |

### The no-fee-gouging trust angle

This is the **single most competitor-untouchable message we have, and it's currently unsaid.** Verified: zero platform markup in any checkout function, residents free. Make **"We take $0 of your community's money"** the headline — with a **screenshot-able at-cost fee table** ("Residente takes 0%; you pay only Stripe's at-cost rate, shown to the penny"). It directly attacks Condo Control's 1%/$2 stack, Vantaca's 3.49–4.9%, AppFolio's $9.99 debit, and CINC's float model — none of which they can match without cannibalizing revenue. Add a board toggle to *absorb vs. pass-through* fees with full in-portal disclosure, turning AppFolio's 2023 eCheck backlash into a conversion lever.

**Critical sequencing (the sharpest code/strategy contradiction):** **ship at-cost/free ACH first.** Today, card-only means residents still eat ~3% — the *most* extractive posture. Promoting "no fee-gouging" while card-only undercuts the entire message.

### Unit-economics caution (the critic was right to flag this)
Residente has **no float/banking cushion** — the subscription + compliance tier must carry the whole business. Do **not** simultaneously (a) raise the free tier to 50 homes, (b) take zero markup, *and* (c) cut Premium/Enterprise rates without an offsetting lever. **Gate the free-tier expansion and rate cuts on validating compliance-tier willingness-to-pay** with a small set of communities facing the 2026 deadline. Tie billing to roster/parcel count with periodic reconciliation to prevent under-reporting.

### The free-vs-paid compliance boundary (resolves the Pricing-vs-GTM conflict)
**Diagnosis is free; remediation/monitoring is paid.** The public "Is your HOA compliant?" checker gives a board enough to *hook* (you're non-compliant on X, here's your exposure) but not enough to *solve* — that's the premium tier. State this boundary explicitly or the two recommendations conflict.

---

## 8. Roadmap to "Undeniably Worth Paying For"

| Move | Why | Effort | Impact |
|---|---|---|---|
| **NOW (P0)** | | | |
| Ship Stripe ACH (`us_bank_account`); make at-cost/free ACH the default dues rail | Resolves the sharpest code/strategy contradiction; card-only makes us the *most* expensive way to pay and breaks the anti-fee wedge. Known delta on existing checkout/autopay fns | Medium | High |
| Fix two false claims now: "100% visible" → enumerated claim; "no middleman" → "no management company" | Literally false vs. the code; clashes with the law-grade rigor the brand earns | Quick | High |
| Constrain voting messaging to "sealed even from us"; do NOT claim "verify your vote was counted" | Admin write-back tally is unverifiable, no per-voter receipt/hash-chain. Top erosion/litigation risk in a contested FL recall | Quick | High |
| Start attorney sign-off on the (default-false, larger-than-stated) constant set | Compliance moat is legally inert until validated; member-facing display is blocked. Prerequisite for the lead-gen wedge | Large | High |
| **NEXT (P1)** | | | |
| Publish "We take $0 of your community's money" + at-cost fee table (after ACH) | Structurally un-copyable by float-monetizing incumbents; cleanest trust wedge | Quick | High |
| Ship the free, advisory "Is your FL association compliant?" checker (diagnosis free, monitoring paid) | Present-tense demand from the in-force records mandate; no incumbent serves it owner-side. Zero-CAC top-of-funnel | Medium | High |
| Build the FL attorney referral channel as primary GTM | Highest-leverage, on-brand; also unblocks the constant validation | Large | High |
| Resolve the beachhead trap: ship QBO sync OR re-scope away from "replaces QuickBooks" | The self-managed beachhead is unservable until treasurers have books | Large | High |
| Repackage: compliance as premium tier; resident read-transparency free forever | Anchors premium price against legal value, not headcount; lets us cut uncompetitive per-home rates | Medium | High |
| Ship a language toggle so EN/ES/PT is actually reachable | A "moat" asset that's currently latent — translations exist but no UI switch | Quick–Medium | Medium |
| Ship a maintenance / work-order pipeline (report → triage → dispatch → status → photos) | Table-stakes in every cluster; composes existing vendor roster + photo + request primitives; feeds the dormant vendor-ratings loop | Large | High |
| PWA + web-push as the mobile first step (native later) | Resident adoption is the whole thesis; PayHOA's missing app is its #1 complaint | Medium | Medium |
| Add a security/trust posture: landing-page security messaging, key-recovery escrow for secret elections, SOC2/breach plan | We hold votes + money + PII with zero security messaging and a single-point-of-failure key card. A board's counsel *will* ask | Medium | High |
| **LATER (P2)** | | | |
| Per-kind notification prefs + resident money-agency (payment plans, fine disputes, refunds) | Prevents opt-out fatigue; transparency without agency is half the promise | Medium | Medium |
| Ship true E2E voter-verifiability (per-voter receipt + reconcilable public tally + hash-chained audit) | Upgrades the crypto moat from "operator-blind" to "verify-it-yourself"; only then can we make the verifiability claim | Large | High |
| Community engagement layer (forums/polls/directory/events) bridged to the system of record | Gives a daily reason to return; bridges Nextdoor-style reach with authoritative records | Large | High |
| Migration-IN tool ingesting competitor CSVs | Turns portability from an anti-moat into an acquisition wedge | Medium | Medium |
| 3–5 lighthouse FL case studies (X% active, board hours cut, compliance hit by deadline, $ saved) | Landing has zero social proof; adoption is the universal incumbent failure | Large | Medium |

**Deliberately dropped/demoted:** "Show ARC rationale" (already shipped — `arc/page.tsx:199`); raise free tier to 50 homes + cut Premium/Enterprise rates (gate on compliance-tier WTP given no float cushion); cross-community vendor-ratings flywheel (depends on adoption scale that doesn't exist yet); native mobile app before PWA (wrong sequencing).

---

## 9. Risks & Honest Caveats

**Strategy/code contradictions (fix before marketing):**
- **The anti-fee wedge vs. card-only payments.** We name "fee-free ACH" as our sharpest wedge yet ship the most extractive payment posture. Most fixable, highest-trust-payoff fix; leaving it unaddressed undercuts the entire resident-fair positioning.
- **"Replaces QuickBooks" vs. no GL.** The copy promises a back-office the code doesn't have. A real evaluation finds this fast.

**Latent moats that don't win deals until realized:**
- **Compliance engine is legally inert** until attorney validation — and the backlog is *larger* than stated, because `validated` defaults to false. Member-facing value is hard-blocked. A single wrong statutory deadline shown to a member is a trust *and* legal exposure. This is a business blocker, not a legal nicety.
- **Crypto voting is operator-blind, not voter-verifiable.** Marketing this as "verify your vote was counted" is a verifiable falsehood the transparency-focused buyer will probe — and a contested FL recall (DBPR arbitration within 60 days) could expose it.
- **Trilingual is latent** — no language toggle found. Don't lean on it as a live GTM asset yet.

**Unexamined strategic constraints:**
- **FL-only is a hard TAM ceiling.** The compliance engine has no state abstraction (`rules-core` branches only condo/hoa). National expansion is a re-architecture, not config. There's a genuine fork: expand thin nationally (lose the moat) or stay deep in FL (cap the TAM). Name it as a deliberate, time-boxed bet.
- **Security/breach liability is unaddressed.** We hold votes, money, and PII with zero security messaging, a tamper-*resistant* (not tamper-*evident*) audit log, and a key card whose loss makes an election permanently unrecoverable (no escrow). For a trust brand, one botched election or breach is existential.
- **Support is a *cost*, not just a wedge.** Resident-first *multiplies* the support surface — thousands of non-technical residents (older owners, eventually 3 languages) directly, not one board contact. Our positioning creates the largest support load in the category. Budget for it.
- **Boards may not *want* transparency.** The buyer is the entity the product constrains. Lead with compliance fear (non-optional), not "transparency sells itself."
- **Adoption is existential and unsolved.** We lack the two biggest adoption drivers (native app, engagement layer) while the widest-distributed incumbent (TownSq) fails on exactly adoption (~75% non-use). Transparency without a reason to return inherits the same trap.

**Demo-data dependence:** the proof surface leans on `DEMO_AMENITIES`, `DEMO_STATEMENTS`, seeded ratings, and demo dashboard figures. A board's *first live experience* may look empty vs. the polished demo — a conversion risk for the GTM motion.

**Competitor facts to handle carefully:** "CINC monetizes $11B+ in float" is a vendor throughput figure, not audited revenue — lean on the *harder* facts (Vantaca 3.49–4.9%, Condo Control +1%/$2, AppFolio $9.99) for the structural-conflict argument. The RealPage settlement framing is plausible but single-news-cycle — cite it cautiously for a trust-first brand.

---

**Bottom line:** Residente owns a position the incumbents structurally cannot take, backed by two genuine moats (the FS engine and operator-blind ballots) and one un-copyable economic stance (zero payment cut). But the moats are partly latent and the table-stakes are incomplete. The path to "undeniably worth paying for" is narrow and clear: **ship ACH, tell the no-cut truth, unblock the compliance engine with attorneys, give treasurers books (or stop promising them), and make the claims match the code.** Do that for the FL self-managed compliance-cliff beachhead, and you're not competing in this market — you're defining a category no one else can enter.
