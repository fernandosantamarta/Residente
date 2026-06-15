# Florida statutory review packet — Residente compliance constants

**Purpose.** Residente's compliance features encode Florida condominium (Ch. 718)
and HOA (Ch. 720) duties — deadlines, thresholds, vote standards, dollar caps —
as hard-coded constants. **Every one of these is currently flagged
`validated: false`**: the app treats them as *advisory* and never auto-acts on
them (it never levies a fine, removes a director, blocks a meeting, or files
anything). This document is the single place for **Florida community-association
counsel** to review those constants so they can be marked `validated: true`.

**This is not legal advice and nothing here is certified.** Residente generated
this packet from its own source code; the citations and values below are *our
reading* and must be independently confirmed against current Florida Statutes,
Administrative Code (Rule 61B), and recent session laws.

---

## How the flag works (for the engineer applying sign-off)

Each constant is wrapped in a `rule(value, citation, { note })` helper
(see `lib/compliance/rules-core.ts`) that carries `validated: false`. After
counsel confirms a value + citation, we flip that constant (or the whole domain)
to `validated: true` and record **reviewer name + date + statute edition** in the
commit. Nothing about the runtime behavior changes when a flag flips — it only
records that a human lawyer signed off. Confirm each item below as one of:

- ✅ **Correct** — value + citation accurate as of the current statute.
- ✏️ **Amend** — give the corrected value/citation.
- ❓ **Out of scope / remove** — not actually a current obligation.

---

## PRIORITY items (uncertain or self-flagged "confirm with counsel")

These are the constants we are least sure about — review first.

| # | Constant (file) | Our value | Citation | The question for counsel |
|---|---|---|---|---|
| P1 | `HOA_AUDITED_CUTOFF_CHANGE_DATE` / `AUDITED_CUTOFF.hoa_after` (`financials.ts`) | HOA "audited" threshold drops **$500k → $250k on 2026-07-01** | FS 720.303(7) | **Is this enacted and is the date right?** Flagged internally as possibly unenacted. If not in force, we revert HOA to $500k. |
| P2 | `RESERVE_WAIVER_VOTE_BASIS.condo` (`financials.ts`) | condo waiver = "a majority of the **total** voting interests" | FS 718.112(2)(f)2 | Confirm the **condo** waiver vote basis (the HOA basis — majority *present* at a quorum meeting, 720.303(6)(f) — we're more confident on). |
| P3 | `SIRS_WAIVER_PROHIBITED_SINCE` = 2024-12-31; `SIRS_FULL_FUNDING_EFFECTIVE` = 2026-01-01 (`financials.ts` / `structural.ts`) | SIRS reserves un-waivable for budgets adopted on/after 2024-12-31; full funding from 2026-01-01 | FS 718.112(2)(g)2 | Confirm both effective dates and that "adopted on/after" is the right trigger. |
| P4 | Records-website posting deadlines (`official-records.ts`) | condo (25+ units) **2026-01-01**; HOA (100+ parcels) **2025-01-01**; no grace window | FS 718.111(12)(g) / 720.303(4)(b) (HB 913 / HB 1203) | Confirm both go-live dates, the unit/parcel thresholds, and that there is no grace period. |
| P5 | Delivery affidavit (`financials.ts` + `supabase/affidavit.sql`) | condo officer attests **delivery** (not accuracy) of the AFR; effective 2025-07-01 | FS 718.111(13) (HB 913) | Confirm the affidavit is a condo-only duty, attests *delivery*, and the effective date. HOAs: none. |
| P6 | Holiday / business-day tolling set (`rules-core.ts`) | FL legal holidays (FS 110.117) + federal holidays used to toll "business day" deadlines | FS 110.117 | Confirm **which** holidays actually toll each statutory deadline (the precise tolling set is explicitly unverified). |
| P7 | Fine caps & no-lien rule (`enforcement.ts`) | $100/day, $1,000 aggregate cap; fines not lienable; 90-day delinquency → suspension without hearing | FS 718.303 / 720.305 | Confirm caps, the no-lien rule, and the without-hearing suspension trigger. |

---

## AFR / financial-statement constants (the accounting context)

From `lib/compliance/financials.ts` — most relevant to the CPA handoff + audit-tier logic:

| Constant | Value | Citation |
|---|---|---|
| `AUDIT_TIER_CUTOFFS` | <$150k cash · $150–300k compiled · $300–500k reviewed · ≥cutoff audited | FS 718.111(13) / 720.303(7) |
| `AUDITED_CUTOFF` | condo ≥$500k; HOA ≥$500k now, ≥$250k from 2026-07-01 (**see P1**) | FS 718.111(13) / 720.303(7) |
| `HOA_PARCELS_FORCE_AUDITED` | HOA ≥1000 parcels → audited regardless of revenue | FS 720.303(7) |
| `BUDGET_NOTICE_LEAD_DAYS` | 14 days before the adoption meeting | FS 718.112(2)(e) / 720.303(2)(c) |
| `AFR_COMPLETE_DAYS` | complete within 90 days after FY-end | FS 718.111(13) / 720.303(7) |
| `AFR_DELIVER_DAYS` | deliver within 21 days of completion / request | FS 718.111(13) / 720.303(7) |
| `MIN_RESERVE_FUNDING_PCT` | advisory 50% floor before flagging a reserve line | FS 718.112(2)(f) / 720.303(6) |
| `RESERVE_WAIVER_VALID_YEARS` | HOA waiver lasts 1 budget year, renew annually | FS 720.303(6)(f) |
| CPA statement levels | reviewed/audited prepared by an independent CPA | Rule 61B-22.006(1) |

---

## Domains to review (each file is `Enable + Monitor`, advisory, all `validated:false`)

| Domain | File | Headline statutes |
|---|---|---|
| Financial reporting, audit tiers, reserves | `lib/compliance/financials.ts` | 718.111(13), 718.112(2)(e)(f)(g), 720.303(6)(7) |
| Official records (retention, website, inspection SLA) | `lib/compliance/official-records.ts` | 718.111(12), 720.303(4)(5) |
| Structural / SIRS / milestone inspections | `lib/compliance/structural.ts` | 553.899, 718.112(2)(g), 718.301(4) |
| Governance (eligibility, certification, conflicts, CAM) | `lib/compliance/governance.ts` | 718.112(2)(d), 718.1265, 718.3027, 720.3033, Ch. 468 Pt VIII |
| Enforcement (fines, hearings, suspensions) | `lib/compliance/enforcement.ts` | 718.303, 720.305, 720.3085 |
| Meetings & statutory notice | `lib/compliance/meetings.ts` | 718.112(2)(c)(d), 720.303(2) |
| Elections & recall | `lib/compliance/elections.ts` | 718.112(2)(d), 720.306(9) |
| Architectural review (ARC) | `lib/compliance/arc.ts` | 720.3035, 718.113 |
| Insurance (property appraisal, fidelity bond) | `lib/compliance/insurance.ts` | 718.111(11), 720.3033(5) |
| Procurement / contracts | `lib/compliance/contracts.ts` | 718.3026, 720.3055, Ch. 468 |
| Niche / event-driven advisories | `lib/compliance/advisories.ts` | long-tail Ch. 718/720 |
| Shared deadline/business-day engine | `lib/compliance/rules-core.ts` | 110.117 (tolling) |

---

## Appendix — full citation index

Every Florida citation the code references (grouped; frequency in parentheses is
how often it appears, not a measure of importance). Confirm each is current.

**Condominium (Ch. 718):** 718.111(11)(a)(h), 718.111(12)(a)(c)(g), 718.111(13),
718.112(2)(b)(c)(d)(e)(f)(g), 718.113(2)(8), 718.116 + (3)(8)(8)(d), 718.121(5)(6),
718.301(4), 718.3025, 718.3026(1), 718.3027, 718.303 + (3)(b)(5), 718.501(1)(2)(a)(3),
553.899.

**HOA (Ch. 720):** 720.303(2)(2)(c)(4)(4)(b)(5)(6)(7), 720.3033 + (1)(5),
720.3035(3), 720.3053, 720.3055(1), 720.305(2)(2)(b)(2)(d), 720.306(1)(b)(5)(8),
720.307(4), 720.3085 + (3)(3)(d)(4)(b), 720.30851, 720.309 (HOA contract duty).

**Other statutes:** 617.0830 (director reliance safe harbor), 110.117 (FL holidays),
Ch. 468 Part VIII (CAM licensure).

**Administrative Code:** Rule 61B-22.005(2) (reserve cash moved within 30 days),
Rule 61B-22.006(1) (accrual + fund accounting; CPA statement levels).

**Session laws referenced (confirm enacted text + effective dates):** HB 913,
HB 1021, HB 1203, SB 4.

---

## Sign-off

| Reviewer (FL Bar #) | Date | Statute edition reviewed | Items confirmed / amended |
|---|---|---|---|
|  |  |  |  |

After review, the engineer flips the confirmed constants from `validated: false`
to `validated: true` in the files above and records this reviewer + date in the
commit message. Anything amended is corrected to counsel's value first.
