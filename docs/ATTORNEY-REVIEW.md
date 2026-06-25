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

---

## 2026-06-24 review — items requiring confirmation

A 31-agent internal audit (full detail in `docs/COMPLIANCE-REVIEW.md`) surfaced **26 statutory-value / interpretation questions** below. Each gives *what the code does today* and *what the audit suspects*; **none of these has been changed in code** — all remain `validated:false` pending your confirmation. For each, mark one box. Where you mark ✏️ Amend, give the correct value and we update the constant + flip its flag.

> ⚠️ The "what the audit suspects" line is an automated reading and may itself be wrong — please treat it as a prompt for your judgment, not a recommendation. Each item shows its source location (`file:line`) so you can check our reading against the code.

### Financial reporting & reserves  ·  FS 718.111(13) / 720.303(7)

**1. [CRITICAL] HOA audit tier thresholds wrong: $150k-$300k returns 'compiled', $300k-$500k returns 'reviewed' — both incorrect per FS 720.303(7)**
- *Where:* `lib/compliance/financials.ts:34-38, 141-153`  ·  *Citation (our reading):* FS 720.303(7)
- *What the code does today:* requiredAuditTier() uses AUDIT_TIER_CUTOFFS (compiledMin=$150k, reviewedMin=$300k) for both condo and HOA. FS 720.303(7) defines a completely different structure for HOA: (a) below $300k → cash-basis report of receipts/disbursements (no CPA required); (b) $300k-$500k → compiled financial statements; (c) $500k or more → audited. The condo thresholds (FS 718.111(13)) are $150k/$300k/$500k with a reviewed tier at $300k-$500k. Sharing the condo thresholds for HOA produces two wrong results: an HOA at $150k-$300k is told it needs 'compiled' statements (it needs cash), and an HOA at $300k-$500k is told it needs 'reviewed' statements (it needs 'compiled'). The code comment on line 33 ('Shared across regimes; only the audited cutoff differs') documents the incorrect assumption. The false-positive for $150k-$300k HOA produces an 'overdue' severity signal when the association's cash-basis report is fully compliant.
- *What the audit suspects:* Split AUDIT_TIER_CUTOFFS into regime-specific objects. For HOA: compiledMin=$300k, no reviewedMin. Update requiredAuditTier() to branch on regime before applying thresholds: if regime==='hoa' { if (rev >= auditedCutoff) return 'audited'; if (rev >= 300_000) return 'compiled'; return 'cash'; }. Update the AUDIT_TIER_CUTOFFS rule note to distinguish the regimes. The 'reviewed' tier label remains valid for condo only.
- *Counsel:*  ☐ Correct as-is   ☐ Amend → ________________________   ☐ Out of scope / remove

**2. [HIGH] HOA AFR delivery deadline uses 21 days (condo clock) instead of the FS 720.303(7)(d) HOA window**
- *Where:* `lib/compliance/financials.ts:59, 300-311`  ·  *Citation (our reading):* FS 720.303(7)(d)
- *What the code does today:* AFR_DELIVER_DAYS is set to 21 and cited as 'FS 718.111(13) / 720.303(7)' with note 'days after completion / request to deliver to members'. The 21-day-after-completion clock is from FS 718.111(13)(b) for condo associations. FS 720.303(7)(d) for HOA specifies a different delivery requirement: the financial report must be provided to parcel owners no later than 60 days after the close of the fiscal year (not 21 days from completion). The code applies the condo delivery clock to both regimes: addCalendarDays(afr.completed_at ?? fyEnd, 21). For HOA, both the duration (21 vs 60 days) and the start date (completion vs FY-end) are wrong. The effect is that HOA boards receive a delivery signal that fires 39+ days sooner than statutorily required, and the signal references the wrong anchor date.
- *What the audit suspects:* Add a regime-specific delivery constant: HOA_AFR_DELIVER_DAYS = rule(60, 'FS 720.303(7)(d)', { note: 'days after FY-end to provide financial report to parcel owners' }). In financialSignals(), branch the delivery deadline calculation: for condo use addCalendarDays(afr.completed_at ?? fyEnd, 21) (current behavior); for HOA use addCalendarDays(fyEnd, 60) anchored to FY-end. Validate the exact HOA window with counsel since 720.303(7) wording has varied across recent legislative amendments.
- *Counsel:*  ☐ Correct as-is   ☐ Amend → ________________________   ☐ Out of scope / remove

**3. [MEDIUM] No signal fires when required audit tier is 'compiled' or 'reviewed' and community has zero filings on record**
- *Where:* `lib/compliance/financials.ts:227-269`  ·  *Citation (our reading):* FS 718.111(13) / 720.303(7)
- *What the code does today:* The audit-tier check (lines 229-269) has three branches: (1) if haveTier exists and is below required → 'overdue' mismatch signal; (2) else if required==='audited' → 'info' reminder signal; (3) otherwise nothing. When no filing record exists at all (haveTier=undefined) and the required tier is 'compiled' or 'reviewed', neither branch fires and the community sees zero signals about its outstanding statutory obligation to obtain CPA-prepared statements. By contrast, a community that requires audited statements does receive an 'info' signal (branch 2). The inconsistency leaves mid-revenue communities ($150k-$500k condo) without any compliance nudge until they enter a filing row.
- *What the audit suspects:* Add an else branch (or extend the else-if) to fire an 'info' signal when haveTier is undefined and required is 'compiled' or 'reviewed': else if (!haveTier && (required === 'compiled' || required === 'reviewed')) { out.push(signal({ id: 'financial:audit-tier-no-filing', severity: 'info', title: `No ${AUDIT_TIER_LABEL[required]} on file`, detail: `At ~${revenue} revenue, ${AUDIT_TIER_LABEL[required]} are required. Record the completed filing to clear this reminder.`, ... })) }
- *Counsel:*  ☐ Correct as-is   ☐ Amend → ________________________   ☐ Out of scope / remove

### Structural / SIRS  ·  FS 553.899 / 718.112(2)(g)

**4. [MEDIUM] SIRS component list omits 'Windows and exterior doors' added by SB 154 (2023)**
- *Where:* `lib/compliance/structural.ts:124-137`  ·  *Citation (our reading):* FS 718.112(2)(g)
- *What the code does today:* SIRS_COMPONENTS contains 8 items. FS 718.112(2)(g)1 as amended by SB 154 (2023) adds 'Windows and exterior doors' to the mandatory list, making the controlling enumeration 9 items. The code itself notes this uncertainty at lines 122-123 ('some versions add windows / exterior doors. Confirm the controlling list with counsel'), but the component-completeness check at line 558 compares `comps.length < SIRS_COMPONENTS.value.length` (i.e., < 8). If counsel confirms the 9-item list, this check will silently pass for any SIRS that includes 8 components when it should require 9, and any existing seeded component rows will be one item short.
- *What the audit suspects:* After counsel confirms, add 'Windows and exterior doors' as the 9th entry in SIRS_COMPONENTS.value. The seed button in AssessmentCard will automatically include it for new SIRS assessments. Existing seeded component sets will need a one-time backfill or a re-seed prompt in the UI.
- *Counsel:*  ☐ Correct as-is   ☐ Amend → ________________________   ☐ Out of scope / remove

**5. [LOW] SIRS initial deadline value 2025-12-31 vs original SB 4-D deadline of 2024-12-31**
- *Where:* `lib/compliance/structural.ts:61-63`  ·  *Citation (our reading):* FS 553.899 / 718.112(2)(g)
- *What the code does today:* The SIRS_INITIAL_DEADLINE is set to 2025-12-31 with a note 'initial SIRS deadline'. SB 4-D (2022) originally set the SIRS completion deadline as 2024-12-31 (December 31, 2024). SB 154 (2023) extended this to 2025-12-31 for associations that had not yet completed their SIRS. The code is therefore correct for the extended deadline under SB 154. However, the comment says '2025-12-31 (initial deadline)' without noting the prior 2024-12-31 backstop for buildings that should have been under the original SB 4-D timeline. This is advisory only but could mislead if a court applies the original deadline to associations that existed before the SB 154 extension. Today (2026-06-24) both deadlines have passed, so signals correctly read 'overdue'.
- *What the audit suspects:* Clarify the note to reflect the legislative history: `{ note: 'SB 154 (2023) extended the original SB 4-D deadline from 2024-12-31 to 2025-12-31 — confirm controlling date with counsel' }`. No functional change is needed; the value is already the correct SB 154 deadline.
- *Counsel:*  ☐ Correct as-is   ☐ Amend → ________________________   ☐ Out of scope / remove

### Meetings & notice  ·  FS 718.112(2)(c)(d) / 720.303(2) / 720.306

**6. [HIGH] Special member-meeting type falls through to 48-hour board-meeting notice instead of required 14-day mailed notice**
- *Where:* `lib/compliance/meetings.ts:111-125`  ·  *Citation (our reading):* FS 718.112(2)(d) / 720.306(1)
- *What the code does today:* requiredNotice() checks is_budget_meeting, affects_assessments, affects_use_rules, and type==='annual', but has no branch for type==='special'. A special meeting of the members (as opposed to a board-called special board meeting) requires 14-day mailed + posted notice under FS 718.112(2)(d) / 720.306(1). Without any of the three boolean flags set, a 'special' typed meeting gets the 48-hour board-meeting default. This means the compliance signal would fire for the wrong threshold, the notice document would state '48 hours posted' instead of '14 days mailed + posted', and the affidavit of mailing would omit the mailed-notice rows.
- *What the audit suspects:* Add a branch for type==='special' before the board-meeting fallthrough: `if (m.type === 'special') { return { days: ANNUAL_MEETING_NOTICE_DAYS.value, mailed: true, citation: 'FS 718.112(2)(d) / 720.306(1)', reason: 'special members meeting' } }`. Confirm with counsel whether a special board-only meeting (no member vote) takes the 48-hour rule instead.
- *Counsel:*  ☐ Correct as-is   ☐ Amend → ________________________   ☐ Out of scope / remove

### Elections & recall  ·  FS 718.112(2)(d) / 720.306(9)

**7. [LOW] second_notice_at column declared in SQL and ElectionRow but never written or read**
- *Where:* `supabase/elections.sql:32, lib/compliance/elections.ts:105`  ·  *Citation (our reading):* FS 718.112(2)(d) / 720.306(9)
- *What the code does today:* The ev_elections table declares a separate second_notice_at date column (SQL line 33) and ElectionRow includes the field (line 105), but neither the admin page nor any signal logic ever writes to it or reads from it. The code exclusively uses ballots_sent_at for the second-notice milestone. The column appears to be a vestigial duplicate that creates potential confusion about which field records when the second notice was sent.
- *What the audit suspects:* Either remove second_notice_at from the SQL schema and ElectionRow type (and add an ALTER TABLE DROP COLUMN migration), or unify the two fields — e.g. map ballots_sent_at to second_notice_at and use a single column throughout to avoid confusion.
- *Counsel:*  ☐ Correct as-is   ☐ Amend → ________________________   ☐ Out of scope / remove

**8. [LOW] HOA second-notice / ballot deadline not distinguished from condo — no advisory that the window is governing-document-driven for HOAs**
- *Where:* `lib/compliance/elections.ts:241-259`  ·  *Citation (our reading):* FS 718.112(2)(d)
- *What the code does today:* The 14–34-day second-notice window (SECOND_NOTICE_MIN_DAYS / SECOND_NOTICE_MAX_DAYS) is statutory for condos under FS 718.112(2)(d)4. For HOAs, FS 720.306(9) requires mailing at least 14 days before but the upper bound is governing-document-driven, not a fixed 34 days. The ballot-due and ballot-late signals (lines 244-258) fire identically for both regimes without any note that the 34-day upper bound may not apply to HOAs. The statutory constants' notes already flag this ('condo: first notice…') for ELECTION_FIRST_NOTICE_DAYS but the signal detail strings for the ballot window make no such distinction. This is a completeness gap under the statute citation included in the signal (SECOND_NOTICE_MIN_DAYS.citation = 'FS 718.112(2)(d)4').
- *What the audit suspects:* (see detail)
- *Counsel:*  ☐ Correct as-is   ☐ Amend → ________________________   ☐ Out of scope / remove

### Directors & management  ·  FS 718.112(2)(d) / 718.3027 / 720.3033

**9. [MEDIUM] 14-day conflict-disclosure lead-time not monitored (CONFLICT_DISCLOSURE_LEAD_DAYS unused)**
- *Where:* `lib/compliance/governance.ts:71 (constant), :394-408 (conflict signal)`  ·  *Citation (our reading):* FS 718.3027
- *What the code does today:* FS 718.3027 and 720.3033(2) require that a conflict of interest be disclosed at least 14 days before the vote. The constant CONFLICT_DISCLOSURE_LEAD_DAYS = 14 is exported but never referenced in any signal. The existing conflict signal only checks whether a director-owned vendor lacks any disclosure at all — it does not check whether a disclosure was recorded within the required lead time relative to an upcoming vote. The ev_conflict_disclosures table has a vote_at column (governance.sql line 173) that is never read by the producer.
- *What the audit suspects:* Add a signal loop over disclosures where vote_at is set: if vote_at is within 14 days from now and the disclosure was not yet filed (disclosed_at is null), push a 'soon' signal citing CONFLICT_DISCLOSURE_LEAD_DAYS. This gives the board the statutory pre-vote warning.
- *Counsel:*  ☐ Correct as-is   ☐ Amend → ________________________   ☐ Out of scope / remove

**10. [LOW] pageDek says '4-hour certification' — wrong description of the initial-cert obligation**
- *Where:* `lib/i18n/en.ts:2730`  ·  *Citation (our reading):* FS 720.3033(1)
- *What the code does today:* The governance page subtitle reads 'Track director eligibility, the 4-hour certification + continuing education'. The 4-hour figure is the HOA continuing-education requirement for small associations (FS 720.3033(1)), not the initial certification. The initial-certification obligation is a 90-day window with no hour requirement. This misdescription could confuse board members about what is being tracked.
- *What the audit suspects:* Change to 'the 90-day director certification + continuing education' to correctly identify the initial-certification deadline clock.
- *Counsel:*  ☐ Correct as-is   ☐ Amend → ________________________   ☐ Out of scope / remove

### Violations, fines & hearings  ·  FS 718.303 / 720.305

**11. [MEDIUM] votingSuspensionCandidates applies the condo $1,000 floor to use-rights suspension, but FS 718.303(4) has no floor**
- *Where:* `lib/compliance/enforcement.ts:625-637`  ·  *Citation (our reading):* FS 718.303(4)
- *What the code does today:* FS 718.303(5) requires the debt to exceed $1,000 AND be >90 days delinquent for a condo to suspend VOTING rights. But FS 718.303(4) — the use-rights (common-area access) suspension — has no monetary floor; it applies to any monetary delinquency >90 days. The function votingSuspensionCandidates applies `if (condo && balance <= VOTING_SUSPENSION_MONETARY_FLOOR.value) continue` to every condo candidate regardless of which right is being considered. When the board wants to suspend only common-area use rights (rights='use_common') for a condo owner with a $500 balance >90 days delinquent, the candidate will not surface. The constant and its note correctly limit it to voting rights only, but the filter in candidates() is applied globally.
- *What the audit suspects:* Either (a) split candidates into two groups (voting vs use-rights) and only apply the $1,000 floor to the voting group, or (b) add a regime/rights parameter to the function and let the caller pass which right is under consideration. The simplest fix: remove the monetary floor from candidates() entirely (it concerns only use-rights vs voting precision) and enforce the $1,000 distinction inside votingSuspensionSignals(), clearly noting the two separate thresholds.
- *Counsel:*  ☐ Correct as-is   ☐ Amend → ________________________   ☐ Out of scope / remove

### Insurance  ·  FS 718.111(11) / 720.3033(5)

**12. [MEDIUM] Bond floor estimate omits operating account — structurally understates the statutory floor**
- *Where:* `lib/compliance/insurance.ts:141-148`  ·  *Citation (our reading):* FS 718.111(11)(h) / 720.3033(5)
- *What the code does today:* FS 718.111(11)(h) / 720.3033(5) require the fidelity bond to cover 'the maximum funds that will be in the custody of the association OR its management agent at any one time.' This peak-custody amount includes both the operating/checking account and the reserve accounts. The estimatedMaxFunds fallback sums only ev_reserve_components.current_balance (reserve-only). The operating account balance has no data model entry. The code comment on line 138 correctly identifies this limitation ('the true statutory floor is the peak operating+reserve balance') but no signal warns the board that the estimate is reserve-only and may be significantly below the actual peak custody figure, which can include one or two months of collected dues in the operating account.
- *What the audit suspects:* Add an 'insurance:bond-floor-estimate-incomplete' info-level signal when the board has not entered an estimated_max_funds override, explaining that the reserve-only sum excludes operating funds and that the board must confirm the peak custody figure with the manager. Also add an operating_balance field to the communities table (or prompt the board to enter it alongside estimated_max_funds) so the fallback can include it.
- *Counsel:*  ☐ Correct as-is   ☐ Amend → ________________________   ☐ Out of scope / remove

### Advisories & event clocks  ·  Ch. 718/720

**13. [MEDIUM] HOA proxy staleness measured from submitted_at instead of the meeting date (wrong anchor per FS 720.306(8))**
- *Where:* `lib/compliance/advisories.ts:139-146`  ·  *Citation (our reading):* FS 720.306(8)
- *What the code does today:* FS 720.306(8) states a proxy 'automatically expires 90 days after the date of the meeting for which it was originally given.' The staleProxies() function anchors the 90-day clock on p.submitted_at (the submission timestamp), not on the meeting date. A proxy submitted two weeks before a meeting that happened 80 days ago would be flagged as stale (90 - 14 = 76 days since submission plus the 14 lead time = 90), even though the 90-day window from the meeting date hasn't closed. Conversely a proxy submitted the day of a meeting 91 days ago is correctly stale, but only by coincidence. The ProxyRow type and the admin-page query both omit meeting_id and the meeting's scheduled_at, so there is no path to the correct anchor without a schema and query change.
- *What the audit suspects:* Add meeting_date (denormalized) or meeting_id to ProxyRow. In the admin page query change `select('id, status, type, submitted_at')` to `select('id, status, type, submitted_at, meeting_id, ev_meetings(scheduled_at)')`, and pass the meeting's scheduled_at as the clock anchor in staleProxies(). Alternatively add a computed/denormalized meeting_date column to ev_proxies populated by trigger. The note on PROXY_EXPIRY_DAYS already calls this out as approximate — this is the fix.
- *Counsel:*  ☐ Correct as-is   ☐ Amend → ________________________   ☐ Out of scope / remove

**14. [LOW] Condo proxies incorrectly subject to the 90-day staleness check (FS 718.112(2)(b) has no 90-day rule)**
- *Where:* `lib/compliance/advisories.ts:139-147, 260-261`  ·  *Citation (our reading):* FS 718.112(2)(b)
- *What the code does today:* FS 718.112(2)(b) states a condo proxy is 'effective only for the specific meeting for which it was originally given.' There is no 90-day expiry clock for condo proxies — a proxy is simply invalid once the meeting it was given for has passed. The staleProxies() function applies the same 90-day threshold to every proxy regardless of regime, so for a condo community an open proxy submitted 10 days ago for a meeting that concluded 10 days ago will show as 'not stale' for another 80 days. The advisory text (line 261) correctly says 'valid only for the specific meeting,' but the math contradicts it by waiting for 90 days.
- *What the audit suspects:* For condo communities, staleness should be determined by whether the associated meeting has passed (meeting.scheduled_at < now), not a fixed 90-day window from submission. After adding meeting_id/meeting_date to ProxyRow (see ADV-003), apply regime-specific logic: HOA → 90 days after meeting date; condo → meeting date has passed.
- *Counsel:*  ☐ Correct as-is   ☐ Amend → ________________________   ☐ Out of scope / remove

**15. [LOW] HOA turnover checklist has 19 items; FS 720.307(4) enumerates items (a) through (t) = 20 items**
- *Where:* `lib/compliance/advisories.ts:68-92`  ·  *Citation (our reading):* FS 720.307(4)
- *What the code does today:* The TURNOVER_DOC_CHECKLIST array has 19 string entries. FS 720.307(4) lists items (a) through (t), which is 20 items (a=1, t=20). One item from the statute is absent from the checklist. Common candidates for the missing item include pending litigation files or a copy of all bids received in the prior two years. The document page renders this list directly for HOA turnover verification. The note on the rule already says 'confirm the controlling enumeration with counsel' but the count discrepancy is a concrete gap.
- *What the audit suspects:* Audit the 19 items against the current text of FS 720.307(4)(a)-(t) with counsel and add the missing entry. The most commonly omitted item in implementations of this list is 'A copy of all bids obtained by the association within the 2 years before the date of transfer of control' (if such a provision exists in the current text). The validated:false flag already gates this on attorney review.
- *Counsel:*  ☐ Correct as-is   ☐ Amend → ________________________   ☐ Out of scope / remove

**16. [LOW] Condo turnover document page uses HOA 720.307(4) checklist rather than FS 718.301(4) enumeration**
- *Where:* `app/admin/advisories/document/page.tsx:109-124`  ·  *Citation (our reading):* FS 718.301(4)
- *What the code does today:* When rendered for a condo community (isCondo === true), the turnover_checklist document uses TURNOVER_DOC_CHECKLIST, which is explicitly annotated as the HOA FS 720.307(4) list, as 'a practical baseline.' FS 718.301(4) specifies a separate (and different) list of documents the developer must deliver at condo turnover. The document page includes a disclaimer on line 123, but the actual checklist items rendered are the HOA list. The condo-specific statutory obligation is not implemented.
- *What the audit suspects:* Create a separate CONDO_TURNOVER_DOC_CHECKLIST constant populated from FS 718.301(4)(a)-(p) (or whatever the current enumeration is) and render it when isCondo === true in the document page. The HOA list can remain as TURNOVER_DOC_CHECKLIST. Both should carry validated:false and attorney-review notes.
- *Counsel:*  ☐ Correct as-is   ☐ Amend → ________________________   ☐ Out of scope / remove

### Estoppel  ·  FS 718.116(8) / 720.30851

**17. [MEDIUM] Aggregate fee cap for simultaneous same-owner requests (FS 718.116(8)(e)/720.30851) is defined but never evaluated**
- *Where:* `lib/compliance/estoppel.ts:36-44`  ·  *Citation (our reading):* FS 718.116(8)(e)/720.30851
- *What the code does today:* ESTOPPEL_AGGREGATE_CAPS is exported with the correct statutory tiers ($750/25 units, $1000/50 units, $1500/100 units, $2500/101+ units) and the SQL has an aggregate_group_id column for grouping simultaneous requests. However, estoppelSignals() never groups rows by aggregate_group_id or community unit count to check whether the combined fee across a batch of simultaneous same-owner non-delinquent requests exceeds the applicable tier cap. The admin intake form also has no UI to link requests into an aggregate group. The constant and column exist but the enforcement path is entirely absent.
- *What the audit suspects:* In estoppelSignals(), after the per-row loop, group rows by aggregate_group_id (non-null) and sum fee_total per group. Compare against the applicable cap tier using the community's unit count (pass the community row to the producer or a unitCount parameter). Emit a signal when the group total exceeds the cap. In the admin intake form, add an 'Add to group' control that sets aggregate_group_id to match an existing open request for the same owner.
- *Counsel:*  ☐ Correct as-is   ☐ Amend → ________________________   ☐ Out of scope / remove

**18. [LOW] Refund-due signal severity is always 'soon' regardless of how many days remain before the 30-day refund deadline**
- *Where:* `lib/compliance/estoppel.ts:211`  ·  *Citation (our reading):* FS 718.116(8) / 720.30851
- *What the code does today:* The refund-due signal fires as severity 'soon' whenever the 30-day refund window has not yet elapsed (left >= 0) and as 'overdue' when it has elapsed (left < 0). This means a request where the closing was cancelled today fires 'soon' immediately, even though the board has the full 30 days to act. The Severity type supports 'info' for non-urgent advisory notices. A signal that is 30 days away should be 'info', transitioning to 'soon' within a short window (e.g. 5 days), and 'overdue' when elapsed.
- *What the audit suspects:* Change to: severity: left < 0 ? 'overdue' : left <= 5 ? 'soon' : 'info', — this matches the pattern used by the expiry signal (daysLeft <= 5 threshold at line 173) and avoids a constant 'soon' alarm for a fresh cancellation.
- *Counsel:*  ☐ Correct as-is   ☐ Amend → ________________________   ☐ Out of scope / remove

**19. [LOW] SQL column payoff_good_through exists but is never written or read by any code**
- *Where:* `supabase/estoppel.sql:40`  ·  *Citation (our reading):* FS 718.116(8) / 720.30851
- *What the code does today:* The ev_estoppel_requests table defines a payoff_good_through date column intended to record the 'good through' date of the payoff figure on the certificate. No code in lib/compliance/estoppel.ts, app/admin/estoppel/page.tsx, or app/admin/estoppel/[id]/certificate/page.tsx reads or writes this column. The certificate page instead computes a paidThrough date dynamically from payoff.lines at render time (lines 100-110), which is correct but means the stored column is always null and the certificate cannot be re-printed with the original snapshot figure.
- *What the audit suspects:* Either (a) populate payoff_good_through on delivery (set it to the payoff.asOf date when markDelivered fires) so the certificate can reproduce the original snapshot, or (b) drop the column if a live re-computation on every certificate render is the intended design. Option (a) is the safer statutory posture since the association is bound by the figures as of delivery.
- *Counsel:*  ☐ Correct as-is   ☐ Amend → ________________________   ☐ Out of scope / remove

### Collections & liens  ·  FS 718.121/.116 / 720.3085

**20. [LOW] noticeMethodWarning only covers intent_to_lien_45; 30-day and intent_to_foreclose notices have no delivery-method validation**
- *Where:* `lib/compliance/collections.ts:275-279`  ·  *Citation (our reading):* FS 718.121(5)/720.3085(3)(d)
- *What the code does today:* FS 718.121(5)/720.3085(3)(d) require the 30-day notice of late assessment to be delivered by first-class mail. FS 718.116(6)(b)/720.3085(5) require the intent-to-foreclose notice by the same manner as the intent-to-lien (certified+first-class for HOA; conservative practice for condo). The noticeMethodWarning() function only checks kind === 'intent_to_lien_45' and returns null for all other kinds. The StageActions UI defaults late_assessment_30 to 'first_class' but does not prevent the board from saving it as 'electronic' or 'hand' without any advisory warning.
- *What the audit suspects:* Extend noticeMethodWarning() with cases for 'late_assessment_30' (warn if method is not 'first_class' or 'both') and 'intent_to_foreclose_45' (warn if not 'both' for HOA, advisory for condo), mirroring the existing intent_to_lien_45 logic.
- *Counsel:*  ☐ Correct as-is   ☐ Amend → ________________________   ☐ Out of scope / remove

### Official records  ·  FS 718.111(12) / 720.303(4)-(5)

**21. [LOW] HOA certified-mail requirement for penalty presumption not distinguished in intake**
- *Where:* `lib/compliance/official-records.ts:112-115 and 323-329`  ·  *Citation (our reading):* FS 720.303(5)(b)
- *What the code does today:* FS 720.303(5)(b) conditions the $50/day rebuttable-presumption on the request being sent by certified mail with return receipt requested. The code correctly documents this nuance in the constant note (line 114) and in the acknowledgement letter text (records-print page line 174), but the overdue signal detail (line 329) does not mention the certified-mail requirement. The board may see the penalty warning without knowing it only attaches to certified-mail requests. There is also no field on the records-inspection request row to capture whether the request arrived by certified mail.
- *What the audit suspects:* For HOA regime, append '(if the request was sent by certified mail, return receipt requested — FS 720.303(5)(b))' to the penaltyTail string. Optionally add a boolean field `sent_by_certified_mail` to the RecordsRequestRow type and a checkbox in the admin UI so the board can track whether the prerequisite for the penalty presumption has been met.
- *Counsel:*  ☐ Correct as-is   ☐ Amend → ________________________   ☐ Out of scope / remove

### Architectural review  ·  FS 720.3035 / 718.113

**22. [MEDIUM] Owner self-submit never sets submitted_at or response_due_at on the row**
- *Where:* `app/app/arc/page.tsx:119-126`  ·  *Citation (our reading):* FS 720.3035 / 718.113
- *What the code does today:* The owner-facing form inserts a row with no submitted_at and no response_due_at. The DB default for submitted_at is current_date (correct), but response_due_at is left null. The admin-side intake (app/admin/arc/page.tsx) explicitly computes the deadline via arcResponseDeadline() and stores it in response_due_at. For owner-submitted requests, arcResponseDeadline() will fall back to computing from submitted_at (via addCalendarDays) since response_due_at is null — the compliance signal still fires, but the deadline is never persisted on the row. If the board later changes arc_response_days on the community, the deadline shown on owner-submitted requests will silently shift, because there is no frozen deadline on the row. Also, the admin worklist shows the deadline chip from the computed deadline, which will change if community settings change.
- *What the audit suspects:* Add submitted_at: new Date().toISOString().slice(0, 10) and compute response_due_at using arcResponseDeadline() (or addCalendarDays(today, arcResponseDays(community))) in the owner submit handler, mirroring what the admin logRequest() function does at app/admin/arc/page.tsx:224-234.
- *Counsel:*  ☐ Correct as-is   ☐ Amend → ________________________   ☐ Out of scope / remove

**23. [LOW] Owner self-submit form has no is_material_alteration flag — condo 75%-vote obligation may be missed**
- *Where:* `app/app/arc/page.tsx:119-126`  ·  *Citation (our reading):* FS 718.113(2)
- *What the code does today:* The owner-facing ARC form omits the is_material_alteration checkbox. For condominiums, FS 718.113(2) requires 75% membership approval for a material alteration or substantial addition to the common elements. An owner who submits an alteration that is in fact material will have is_material_alteration=false (the SQL default) on their row, so the compliance signal (arc:material:*) will never fire. The board would need to notice the material character from the description alone and then either create a separate admin-side request or manually update the flag. The admin intake form does include this checkbox.
- *What the audit suspects:* Either (a) add an is_material_alteration toggle to the owner form (with explanatory copy pointing to the declaration) so owners can self-identify likely material alterations for board review, or (b) add board-side tooling that lets the admin page flag an existing owner-submitted request as material alteration without requiring them to re-enter it. Option (b) is minimal; option (a) is the more complete statutory coverage.
- *Counsel:*  ☐ Correct as-is   ☐ Amend → ________________________   ☐ Out of scope / remove

### Cross-cutting completeness  ·  (per item)

**24. [LOW] No signal fires when a condo voting-rights suspension should be lifted after the debt falls below $1,000**
- *Where:* `lib/compliance/enforcement.ts:550-582`  ·  *Citation (our reading):* FS 718.303(5)
- *What the code does today:* suspensionSignals() correctly flags a rule-violation use-rights suspension that lacks its required committee hearing. However, for a condo voting-rights suspension triggered by >$1,000 AND >90 days delinquent (FS 718.303(5)), there is no signal that fires if the resident makes a partial payment that reduces the balance below $1,000. The statute requires the suspension to lift once the debt is 'paid in full' but the condo voting-suspension requires the balance exceed $1,000 as a continuing condition. The VOTING_SUSPENSION_MONETARY_FLOOR constant is only checked at the candidate-detection stage (votingSuspensionCandidates), not to trigger a 'lift this suspension' advisory on active suspension rows.
- *What the audit suspects:* In suspensionSignals(), for an active condo suspension with rights='voting' or rights='both', if amount_owed is present and amount_owed <= VOTING_SUSPENSION_MONETARY_FLOOR.value, emit a 'soon' advisory: 'The balance has dropped below $1,000 — the condo voting-rights suspension basis may no longer be met; confirm with counsel and consider lifting the suspension.'
- *Counsel:*  ☐ Correct as-is   ☐ Amend → ________________________   ☐ Out of scope / remove

**25. [LOW] Term-limit gap count algorithm uses a fixed 2.5-year gap heuristic rather than explicit term-end dates, risking false positives or misses for directors with unusual gaps**
- *Where:* `lib/compliance/governance.ts:152-173`  ·  *Citation (our reading):* FS 718.112(2)(d)
- *What the code does today:* consecutiveServiceYears() determines unbroken service by walking backward through sorted term_start dates and treating any gap <= 2.5 years as 'continuous'. This covers annual and 2-year terms but can over-count if a director had a 2-year gap followed by a return, or under-count if term_end is not stored and a term was genuinely short. The BoardTermRow has term_end but consecutiveServiceYears() ignores it entirely, using only term_start. FS 718.112(2)(d)2 specifies 'consecutive years of service', which is more accurately computed as the total span of overlapping or abutting [term_start, term_end] intervals.
- *What the audit suspects:* Accept termStarts AND termEnds (parallel arrays). Build intervals [term_start, term_end ?? now]. Sort by start. Merge overlapping/abutting intervals (treat abutting as within 30 days to accommodate re-election timing). Sum the merged interval durations, clamping to TERM_LIMIT_COUNT_SINCE. This directly computes 'years of consecutive board service' with no magic constant.
- *Counsel:*  ☐ Correct as-is   ☐ Amend → ________________________   ☐ Out of scope / remove

**26. [LOW] SIRS waiver-prohibited check uses calendarDaysUntil() <= 0 which fires on the prohibition date itself, one day too early**
- *Where:* `lib/compliance/financials.ts:358`  ·  *Citation (our reading):* (per item)
- *What the code does today:* The statute text is 'budgets adopted on/after 2024-12-31'. The code uses calendarDaysUntil(SIRS_WAIVER_PROHIBITED_SINCE.value, now) <= 0, where calendarDaysUntil returns 0 when now equals the prohibition date. This means the signal fires on 2024-12-31 itself, which is correct. However, when used with 'on/after', the boundary condition is inclusive, and <= 0 is semantically 'on or after the date' — this is actually correct behavior. The same pattern appears in waiverProhibited. No bug, but the comment 'on/after the date' in the code is accurate.
- *What the audit suspects:* No change needed — the logic is correct. Add a brief inline comment confirming '<= 0 includes the prohibition date itself (on/after semantics)' for future clarity.
- *Counsel:*  ☐ Correct as-is   ☐ Amend → ________________________   ☐ Out of scope / remove

### Capability gaps — confirm the obligation *exists* before we build

Duties the suite does **not** yet implement. Before we build each, confirm Florida imposes it and with what parameters:

| # | Gap | Question for counsel |
|---|---|---|
| B1 | Continuing-education hour constants defined but produce no compliance signal | Does FL impose this, with what parameters / thresholds / deadlines? |
| B2 | Insurance domain omits windstorm/flood coverage obligation and named-storm deductible disclosure (FS 718.111(11)(a)) | Does FL impose this, with what parameters / thresholds / deadlines? |
| B3 | phase_1_completed_at has no UI input — Phase 1 clock signal is permanently un-clearable | Does FL impose this, with what parameters / thresholds / deadlines? |
| B4 | FS 718.112(2)(d)4 'no election required when candidates <= seats' obligation never evaluated | Does FL impose this, with what parameters / thresholds / deadlines? |
| B5 | Condo voting-suspension 30-day proof-of-obligation and 90-day pre-election notice are advisory text only — no timed signals | Does FL impose this, with what parameters / thresholds / deadlines? |
| B6 | Procurement domain does not implement FS 720.309 HOA manager-contract fairness and cancellation-on-sale duties | Does FL impose this, with what parameters / thresholds / deadlines? |
| B7 | co_owner_conflict eligibility flag stored and displayed but never triggers a signal | Does FL impose this, with what parameters / thresholds / deadlines? |
| B8 | Bid tracking is boolean only — no bid count or bidder list; completeness of competitive-bid record not verifiable | Does FL impose this, with what parameters / thresholds / deadlines? |
| B9 | HOA management-contract cancellation right (FS 720.3055(2)(a)2) acknowledged but not tracked | Does FL impose this, with what parameters / thresholds / deadlines? |


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
