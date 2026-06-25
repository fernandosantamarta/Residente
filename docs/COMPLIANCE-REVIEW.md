# Compliance feature — deep review findings

_Generated 2026-06-24 from a 31-agent adversarially-verified review (14 domains + 3 cross-cutting). Each finding survived a second-pass verifier; 1 was refuted and dropped._

**Totals:** 101 findings — 🔴 1 critical · 🟠 9 high · 🟡 40 medium · ⚪ 51 low.

**By action tier:** ✅ 5 fixed this pass · 🔧 61 safe code-fixes · ⚖️ 26 confirm-with-counsel · 🏗️ 9 new capability.

> **Tier key.** ✅ already fixed & typechecked. 🔧 verifiable code/wiring/UX bug, safe to fix without statutory judgment. ⚖️ changes a statutory value/interpretation — **do not auto-change; route to counsel** (the whole feature is `validated:false` by design). 🏗️ a new capability the suite does not yet implement.

---

## Core engine / foundation / setup

### 🟠 HIGH · 🔧 code-fix · _connected_ — delinquencySignals never called in either cron — delinquent-without-case board digests require auto-open
- **Where:** `/Users/fernandosantamarta/Residente/app/api/cron/collections-deadlines/route.ts:98-101`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** In the admin dashboard, gatherSignals calls delinquencySignals(candidates) where candidates come from delinquentOwnersWithoutCase(). In collections-deadlines/route.ts the same delinquentOwnersWithoutCase() is called only when c.collections_auto_open is truthy (line 61) — and even then it is used to auto-insert cases, not to emit delinquency signals. delinquencySignals itself is never imported or called in either cron. For communities where auto-open is disabled, boards with delinquent owners who have no collection case will never receive a cron digest about them.
- **Suggested fix:** Import delinquencySignals from '@/lib/compliance/collections' in collections-deadlines/route.ts. Load residents and payments unconditionally (not just inside the auto-open block), call delinquentOwnersWithoutCase() to get candidates, then spread ...delinquencySignals(candidates) into the signals array alongside collectionsSignals and paymentPlanSignals.

### 🟡 MEDIUM · ✅ FIXED · _works_ — Late-fee cap check ignores lateFeePct — percentage-based over-cap silently missed
- **Where:** `/Users/fernandosantamarta/Residente/lib/compliance/signals.ts:51-53`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** foundationSignals checks only cfg.lateFeeFlat against the statutory cap (max($25, 5% of installment)). If a community sets late_fee_pct > 5 and keeps late_fee_flat = 0, the over-cap signal never fires. The adminLateFees() function in dues.ts uses Math.max(flat, (m * pct)/100), so pct > 5 also violates the cap. The guard `flat > 0` on line 53 means any configuration using only a percentage fee is invisible to compliance.
- **Suggested fix:** Compute the effective per-installment fee the same way adminLateFees does — const pct = Number(cfg.lateFeePct) || 0; const effective = Math.max(flat, (monthlyDues * pct) / 100); — then check if (effective > 0 && monthlyDues > 0 && effective > feeCap + 0.005). Update the signal title to show the effective fee, not just the flat amount.

### 🟡 MEDIUM · 🔧 code-fix · _connected_ — records:website-* signal href (/admin/community) matches no workspace card — Official records workspace always shows On Track
- **Where:** `/Users/fernandosantamarta/Residente/lib/compliance/signals.ts:111`
- **Verifier:** adjusted (reviewer confidence high)
- **Detail:** foundationSignals emits the records-website signal with href: '/admin/community'. The wsCounts logic in the dashboard strips hashes (wsBase) and tallies signals per workspace base path. The Official records workspace card uses href '/admin/documents#documents' (base '/admin/documents'). Because '/admin/community' != '/admin/documents', the records-website overdue signal never increments the Official records workspace badge, so that card reads 'On track' even when this statutory deadline (condo 2026-01-01 / HOA 2025-01-01) is past. In production today (2026-06-24) every in-scope community that has not enabled posting sees this as overdue, yet the workspace card masks it.
- **Suggested fix:** Change the href in foundationSignals for records:website-condo and records:website-hoa to '/admin/documents#documents' to align with the Official records workspace. The /admin/community page is still the right place to toggle website_posting_enabled, so alternatively add a dedicated community-settings workspace card, but the simpler fix is to point the signal to the workspace that owns the records obligation.

### 🟡 MEDIUM · 🔧 code-fix · _connected_ — Weekly compliance-scan cron omits all collections/delinquency signals — boards never get weekly digest for collection cases
- **Where:** `/Users/fernandosantamarta/Residente/app/api/cron/compliance-scan/route.ts:119-137`
- **Verifier:** verifier-caught (reviewer confidence med)
- **Detail:** The weekly digest cron (compliance-scan) does not import or call `collectionsSignals`, `paymentPlanSignals`, or `delinquencySignals`. It loads `ev_collection_cases` only to feed `votingSuspensionCandidates` (line 107-129), not to generate collection deadline signals. The rationale appears to be that collections has its own daily cron, but the weekly digest is the board's broader statutory overview — overdue collection case deadlines (e.g. lien enforcement windows closing) are absent from it. If a board member reads only the weekly digest, they will never see collection-deadline warnings there.

---

## Estoppel

### 🟠 HIGH · ✅ FIXED · _works_ — Certificate 'Owner of record' row renders unit_label (combined 'Name · Unit' string) instead of the owner's name
- **Where:** `app/admin/estoppel/[id]/certificate/page.tsx:153`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** Both the 'Unit / parcel' row (line 152) and the 'Owner of record' row (line 153) render req.unit_label, which is the combined denormalized string such as 'Jane Doe · Unit 4B'. On the printed statutory certificate the two fields should be distinct: Unit/parcel shows the unit identifier and Owner of record shows the owner's name. The resident object is already fetched and stored in state (line 28, set at line 72), so the data is available but never used to split the fields.
- **Suggested fix:** Replace line 153 with: <Row label="Owner of record" value={resident?.full_name ?? req.unit_label} /> — this uses the resident's name when the request is linked to a resident, and falls back to unit_label (which includes the name component) for unlinked requests. Additionally consider splitting unit_label display to show only the unit portion on the 'Unit / parcel' row.

### 🟡 MEDIUM · 🔧 code-fix · _connected_ — Owner-facing /app/estoppel page is not reachable from the resident navigation rail or bottom tab bar
- **Where:** `app/app/estoppel/page.tsx:99-100`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** The page exists and is correctly rendered at /app/estoppel with proper RLS (owner reads own estoppel via profile_id = auth.uid()), but it is absent from the NAV array in app/app/layout.tsx (lines 39-43) and from the bottom-nav (lines 329-355). The page itself documents this gap: '// ── Wire-up when ready ── Left rail or Easy Track tab: { href: '/app/estoppel', … }. // Reachable directly at /app/estoppel until then.' An owner receiving the in-app notification (fired by ev_estoppel_notify_trg) has no navigable path to this page through the product UI.
- **Suggested fix:** Add { href: '/app/estoppel', label: 'Estoppel', icon: <...> } to the NAV array in app/app/layout.tsx, or surface it as a conditional entry under Easy Track (visible only to owners who have an open/recent estoppel request). The page is already functional — it only needs the nav entry.

### 🟡 MEDIUM · ⚖️ counsel · _complete_ — Aggregate fee cap for simultaneous same-owner requests (FS 718.116(8)(e)/720.30851) is defined but never evaluated
- **Where:** `lib/compliance/estoppel.ts:36-44`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** ESTOPPEL_AGGREGATE_CAPS is exported with the correct statutory tiers ($750/25 units, $1000/50 units, $1500/100 units, $2500/101+ units) and the SQL has an aggregate_group_id column for grouping simultaneous requests. However, estoppelSignals() never groups rows by aggregate_group_id or community unit count to check whether the combined fee across a batch of simultaneous same-owner non-delinquent requests exceeds the applicable tier cap. The admin intake form also has no UI to link requests into an aggregate group. The constant and column exist but the enforcement path is entirely absent.
- **Suggested fix:** In estoppelSignals(), after the per-row loop, group rows by aggregate_group_id (non-null) and sum fee_total per group. Compare against the applicable cap tier using the community's unit count (pass the community row to the producer or a unitCount parameter). Emit a signal when the group total exceeds the cap. In the admin intake form, add an 'Add to group' control that sets aggregate_group_id to match an existing open request for the same owner.

### ⚪ LOW · ✅ FIXED · _works_ — Over-fee signal detail string is missing the dollar sign before the charged amount
- **Where:** `lib/compliance/estoppel.ts:163`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** The overfee signal detail reads 'Charged ${r.fee_total}; cap for this request is $${maxFee}.' — the first amount has no $ prefix while the cap does, producing output like 'Charged 350; cap for this request is $299.' The inconsistency is purely cosmetic/display but misleading on a compliance dashboard.
- **Suggested fix:** Change to: detail: `Charged $${r.fee_total}; cap for this request is $${maxFee}.`,

### ⚪ LOW · ⚖️ counsel · _complete_ — Refund-due signal severity is always 'soon' regardless of how many days remain before the 30-day refund deadline
- **Where:** `lib/compliance/estoppel.ts:211`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** The refund-due signal fires as severity 'soon' whenever the 30-day refund window has not yet elapsed (left >= 0) and as 'overdue' when it has elapsed (left < 0). This means a request where the closing was cancelled today fires 'soon' immediately, even though the board has the full 30 days to act. The Severity type supports 'info' for non-urgent advisory notices. A signal that is 30 days away should be 'info', transitioning to 'soon' within a short window (e.g. 5 days), and 'overdue' when elapsed.
- **Suggested fix:** Change to: severity: left < 0 ? 'overdue' : left <= 5 ? 'soon' : 'info', — this matches the pattern used by the expiry signal (daysLeft <= 5 threshold at line 173) and avoids a constant 'soon' alarm for a fresh cancellation.

### ⚪ LOW · ⚖️ counsel · _complete_ — SQL column payoff_good_through exists but is never written or read by any code
- **Where:** `supabase/estoppel.sql:40`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** The ev_estoppel_requests table defines a payoff_good_through date column intended to record the 'good through' date of the payoff figure on the certificate. No code in lib/compliance/estoppel.ts, app/admin/estoppel/page.tsx, or app/admin/estoppel/[id]/certificate/page.tsx reads or writes this column. The certificate page instead computes a paidThrough date dynamically from payoff.lines at render time (lines 100-110), which is correct but means the stored column is always null and the certificate cannot be re-printed with the original snapshot figure.
- **Suggested fix:** Either (a) populate payoff_good_through on delivery (set it to the payoff.asOf date when markDelivered fires) so the certificate can reproduce the original snapshot, or (b) drop the column if a live re-computation on every certificate render is the intended design. Option (a) is the safer statutory posture since the association is bound by the figures as of delivery.

### ⚪ LOW · 🔧 code-fix · _connected_ — SQL column certificate_document_id is defined but never written or read
- **Where:** `supabase/estoppel.sql:39`
- **Verifier:** verifier-caught (reviewer confidence med)
- **Detail:** The ev_estoppel_requests table defines `certificate_document_id uuid references public.documents(id) on delete set null` at line 39, presumably to store a reference to the generated PDF. Neither `markDelivered` in app/admin/estoppel/page.tsx nor the certificate page at app/admin/estoppel/[id]/certificate/page.tsx ever writes or reads this column — the certificate is rendered on-the-fly via browser print, and no document record is created. Like payoff_good_through, this column is always null. Lower severity than EST-6 because there is no statutory requirement to store the document reference; it is a tracking convenience. But it indicates the PDF-archive step planned in the SQL was never built.

---

## Collections & liens

### 🟡 MEDIUM · 🔧 code-fix · _works_ — 30-day notice document uses rendering date, not sent_at, for the statutory deadline
- **Where:** `/Users/fernandosantamarta/Residente/app/admin/collections/[id]/document/page.tsx:89,176`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** The notice_30 document body computes the owner's pay-by date as addCalendarDays(today, 30) where today = ymd(new Date()) — the moment the page renders. If the board generates the document before or after the date the notice was actually mailed (the notice_30_sent_at on the case), the letter will state an incorrect statutory deadline. For example, if the notice was mailed 2 days before the document is printed, the letter says the owner has until 32 days from mailing — giving more time than the statute allows and potentially invalidating the notice.
- **Suggested fix:** Pass c.notice_30_sent_at (already on the case row) as the base date: const noticeBase = c.notice_30_sent_at || today; then render ymd(addCalendarDays(noticeBase, 30)) in the letter body, and show the date header as noticeBase, not today.

### 🟡 MEDIUM · 🔧 code-fix · _works_ — Lien-enforcement-window signal suppressed for cases past lien_recorded stage
- **Where:** `/Users/fernandosantamarta/Residente/lib/compliance/collections.ts:495`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** The condo 1-year lien-expiry and HOA 5-year SOL signals only fire when stage === 'lien_recorded'. Once a case advances to intent_to_foreclose or foreclosure, lien_recorded_at is still set on the row but the enforcement-window check is skipped. A case where the board sent the intent-to-foreclose but then stalled — and the condo 1-year window is about to expire — will emit no warning. The board could miss the hard deadline to file the foreclosure action.
- **Suggested fix:** Widen the guard to include intent_to_foreclose and foreclosure stages: replace `stage === 'lien_recorded'` with `(stage === 'lien_recorded' || stage === 'intent_to_foreclose' || stage === 'foreclosure')` so the enforcement-window countdown remains visible throughout those stages.

### ⚪ LOW · 🔧 code-fix · _connected_ — Owner-facing /app/collections page is not linked from the resident nav rail
- **Where:** `/Users/fernandosantamarta/Residente/app/app/collections/page.tsx:132-133`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** The file itself documents the gap: 'Not yet wired into the rail / Easy Track tabs — reachable directly at /app/collections until then.' The NAV array in app/app/layout.tsx (lines 38-44) contains five entries (Home, Easy Track, Easy Voice, Easy Documents, Easy Schedule) and has no entry for /app/collections. An owner who receives a collections_update in-app notice (fired by the ev_collection_notice_notify trigger on every statutory notice logged) sees the notification bell but has no navigation path to view their account standing. They would have to know the URL.
- **Suggested fix:** Add the route to the resident rail either as a standalone nav item or as a sub-tab inside /app/track. At minimum, wire noticeHref in lib/voice.ts to return /app/collections for kind='collections_update' so the in-app notification bell links directly to the page.

### ⚪ LOW · 🔧 code-fix · _connected_ — delinquencySignals() not called in the daily collections-deadlines cron
- **Where:** `/Users/fernandosantamarta/Residente/app/api/cron/collections-deadlines/route.ts:98-103`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** The cron composes its signals with [...collectionsSignals(cases, c.association_type), ...paymentPlanSignals(plans)] but never calls delinquencySignals(candidates). When collections_auto_open is false (the default), delinquent owners with no open case are detected by delinquentOwnersWithoutCase() but the resulting aggregate signal is never included in the cron's actionable count or digest notification. The board only sees this nudge on the live compliance dashboard. The cron will not alert the board asynchronously when new owners become delinquent and have no case.
- **Suggested fix:** After computing candidates (the delinquentOwnersWithoutCase call at line 66 is already inside the auto-open block), compute candidates unconditionally and add delinquencySignals(candidates) to the signals array. Guard it with candidates.length > 0 to avoid unnecessary array operations.

### ⚪ LOW · ⚖️ counsel · _complete_ — noticeMethodWarning only covers intent_to_lien_45; 30-day and intent_to_foreclose notices have no delivery-method validation
- **Where:** `/Users/fernandosantamarta/Residente/lib/compliance/collections.ts:275-279`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** FS 718.121(5)/720.3085(3)(d) require the 30-day notice of late assessment to be delivered by first-class mail. FS 718.116(6)(b)/720.3085(5) require the intent-to-foreclose notice by the same manner as the intent-to-lien (certified+first-class for HOA; conservative practice for condo). The noticeMethodWarning() function only checks kind === 'intent_to_lien_45' and returns null for all other kinds. The StageActions UI defaults late_assessment_30 to 'first_class' but does not prevent the board from saving it as 'electronic' or 'hand' without any advisory warning.
- **Suggested fix:** Extend noticeMethodWarning() with cases for 'late_assessment_30' (warn if method is not 'first_class' or 'both') and 'intent_to_foreclose_45' (warn if not 'both' for HOA, advisory for condo), mirroring the existing intent_to_lien_45 logic.

### ⚪ LOW · 🔧 code-fix · _works_ — daysOver variable in 'X days ago' detail text is always non-positive, so the elapsed-days annotation never renders
- **Where:** `/Users/fernandosantamarta/Residente/lib/compliance/collections.ts:469,476`
- **Verifier:** verifier-caught (reviewer confidence med)
- **Detail:** At line 469, `daysOver = calendarDaysUntil(now, esc.readyAt)`. The function signature is `calendarDaysUntil(target, now)` returning `(target - now) / 86400000`. When `esc.readyAt <= nowMs` (the overdue branch at line 470), this value is ≤ 0. Line 476 then uses `daysOver > 0` to gate the '(X days ago)' annotation — a condition that can never be true in the overdue branch. The same bug appears in `paymentPlanSignals` at line 659: `calendarDaysUntil(now, due)` is also inverted, so the payment-plan 'X days ago' text never renders either. The fix is to swap arguments: `calendarDaysUntil(esc.readyAt, now)` (line 469) and `calendarDaysUntil(due, now)` (line 659).

---

## Structural (SIRS/milestone)

### 🟡 MEDIUM · 🏗️ build · _connected_ — phase_1_completed_at has no UI input — Phase 1 clock signal is permanently un-clearable
- **Where:** `app/admin/structural/page.tsx:533-549`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** The Phase 1 180-day overdue signal in structural.ts (line 452) fires when `!a.phase_1_completed_at && daysLeft < 0`. The AssessmentCard milestone lifecycle quick-fields section exposes date inputs for report_received_at, owner_notice_sent_at, phase_2_due, and repair_commence_due, but has NO DateField for phase_1_completed_at. A board member who has completed Phase 1 cannot record the completion date through the UI, so the `structural:phase1-overdue` signal will continue to fire indefinitely after Phase 1 is actually done.
- **Suggested fix:** Add a DateField for phase_1_completed_at in the milestone lifecycle quick-fields block: `<DateField label={t('admin.structural.phase1CompletedAt')} value={a.phase_1_completed_at} onSet={v => onUpdate(a.id, { phase_1_completed_at: v })} />`. The column already exists in ev_structural_assessments (structural.sql line 78).

### 🟡 MEDIUM · ⚖️ counsel · _complete_ — SIRS component list omits 'Windows and exterior doors' added by SB 154 (2023)
- **Where:** `lib/compliance/structural.ts:124-137`
- **Verifier:** confirmed (reviewer confidence medium)
- **Detail:** SIRS_COMPONENTS contains 8 items. FS 718.112(2)(g)1 as amended by SB 154 (2023) adds 'Windows and exterior doors' to the mandatory list, making the controlling enumeration 9 items. The code itself notes this uncertainty at lines 122-123 ('some versions add windows / exterior doors. Confirm the controlling list with counsel'), but the component-completeness check at line 558 compares `comps.length < SIRS_COMPONENTS.value.length` (i.e., < 8). If counsel confirms the 9-item list, this check will silently pass for any SIRS that includes 8 components when it should require 9, and any existing seeded component rows will be one item short.
- **Suggested fix:** After counsel confirms, add 'Windows and exterior doors' as the 9th entry in SIRS_COMPONENTS.value. The seed button in AssessmentCard will automatically include it for new SIRS assessments. Existing seeded component sets will need a one-time backfill or a re-seed prompt in the UI.

### ⚪ LOW · ⚖️ counsel · _works_ — SIRS initial deadline value 2025-12-31 vs original SB 4-D deadline of 2024-12-31
- **Where:** `lib/compliance/structural.ts:61-63`
- **Verifier:** adjusted (reviewer confidence medium)
- **Detail:** The SIRS_INITIAL_DEADLINE is set to 2025-12-31 with a note 'initial SIRS deadline'. SB 4-D (2022) originally set the SIRS completion deadline as 2024-12-31 (December 31, 2024). SB 154 (2023) extended this to 2025-12-31 for associations that had not yet completed their SIRS. The code is therefore correct for the extended deadline under SB 154. However, the comment says '2025-12-31 (initial deadline)' without noting the prior 2024-12-31 backstop for buildings that should have been under the original SB 4-D timeline. This is advisory only but could mislead if a court applies the original deadline to associations that existed before the SB 154 extension. Today (2026-06-24) both deadlines have passed, so signals correctly read 'overdue'.
- **Suggested fix:** Clarify the note to reflect the legislative history: `{ note: 'SB 154 (2023) extended the original SB 4-D deadline from 2024-12-31 to 2025-12-31 — confirm controlling date with counsel' }`. No functional change is needed; the value is already the correct SB 154 deadline.

### ⚪ LOW · 🔧 code-fix · _works_ — Owner-notice 45-day signal fires for cancelled milestone assessments
- **Where:** `lib/compliance/structural.ts:519`
- **Verifier:** verifier-caught (reviewer confidence med)
- **Detail:** The owner-notice / local-enforcement reporting clock at line 519 guards only on 'a.kind === milestone && a.report_received_at && !a.owner_notice_sent_at'. It does NOT exclude terminal-status assessments. By contrast, the Phase 1 clock (line 450) guards with '!TERMINAL.has(String(a.status))' and the Phase 2 clock (line 479) also guards with '!TERMINAL.has(String(a.status))'. A cancelled milestone assessment whose report_received_at was set before cancellation will emit a spurious 'structural:owner-notice' signal — severity could be 'overdue' — on every compliance dashboard load. Fix: add '&& !TERMINAL.has(String(a.status))' to the guard at line 519.

---

## Official records

### 🟡 MEDIUM · 🔧 code-fix · _works_ — FL_REQUIRED_CATEGORIES emits regime-specific obligations for wrong association type
- **Where:** `/Users/fernandosantamarta/Residente/lib/compliance/official-records.ts:54-64 and 249-261`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** FL_REQUIRED_CATEGORIES includes 'Insurance' with only a HOA statute (720.303(4)(b)1) and 'Inspection Reports' with only a condo statute (718.111(12)(g)2). The records:category-gaps signal (line 251) iterates all entries without checking whether each entry applies to the community's regime. A condo community will be flagged as missing Insurance (not a condo-posting obligation) and an HOA will be flagged as missing Inspection Reports (not an HOA posting obligation under 720.303(4)(b)). The same unfiltered list is displayed as the 'Florida compliance' checklist on the admin documents page (line 884).
- **Suggested fix:** Add an optional `regimes?: AssociationType[]` field to each FL_REQUIRED_CATEGORIES entry (or a separate CONDO_REQUIRED / HOA_REQUIRED split). In officialRecordsSignals(), pass the community's regime to the filter: `FL_REQUIRED_CATEGORIES.filter(c => !c.regimes || c.regimes.includes(regime)).filter(c => !present.has(...))`. Mark Insurance as `regimes: ['hoa']` and Inspection Reports as `regimes: ['condo']`. Apply the same filter on the admin documents page checklist.

### ⚪ LOW · 🔧 code-fix · _connected_ — PDF rule-book import button is a confirmed stub — does no real work
- **Where:** `/Users/fernandosantamarta/Residente/app/admin/documents/page.tsx:196-199`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** The 'Import' button on the rule-book PDF setup card calls importPdf(), which sets a status message reading 'PDF parsing isn't wired yet, but the file is ready.' No rules are extracted, no DB rows are created, and no edge function is called. The UI presents this as an active 'Sets itself up' feature with a prominent badge.
- **Suggested fix:** Either wire the PDF parsing (call the extract-setup edge function mentioned in the adjacent comment at line 363) or change the card label from 'Sets itself up' to 'Coming soon' and disable the Import button until the feature is built. The stub should not be presented to live boards as functional.

### ⚪ LOW · ⚖️ counsel · _complete_ — HOA certified-mail requirement for penalty presumption not distinguished in intake
- **Where:** `/Users/fernandosantamarta/Residente/lib/compliance/official-records.ts:112-115 and 323-329`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** FS 720.303(5)(b) conditions the $50/day rebuttable-presumption on the request being sent by certified mail with return receipt requested. The code correctly documents this nuance in the constant note (line 114) and in the acknowledgement letter text (records-print page line 174), but the overdue signal detail (line 329) does not mention the certified-mail requirement. The board may see the penalty warning without knowing it only attaches to certified-mail requests. There is also no field on the records-inspection request row to capture whether the request arrived by certified mail.
- **Suggested fix:** For HOA regime, append '(if the request was sent by certified mail, return receipt requested — FS 720.303(5)(b))' to the penaltyTail string. Optionally add a boolean field `sent_by_certified_mail` to the RecordsRequestRow type and a checkbox in the admin UI so the board can track whether the prerequisite for the penalty presumption has been met.

### ⚪ LOW · 🔧 code-fix · _works_ — Records-inspection checklist on print page includes wrong-regime categories
- **Where:** `/Users/fernandosantamarta/Residente/app/admin/documents/records-print/page.tsx:128`
- **Verifier:** verifier-caught (reviewer confidence med)
- **Detail:** The records-inspection checklist artifact (type=checklist) iterates FL_REQUIRED_CATEGORIES unfiltered — the same regime-unaware list as OR-01. A condo association printing this checklist will see 'Insurance' (HOA-only obligation, FS 720.303(4)(b)1) and an HOA will see 'Inspection Reports' (condo-only, FS 718.111(12)(g)2). The isHoa variable is already available on line 79 and is used to select the correct statute citation on line 135 — it was simply not applied to the row loop. This is a print-artifact manifestation of OR-01's unfiltered FL_REQUIRED_CATEGORIES; the reviewer cited the signal and the admin-page checklist but missed this third surface.

---

## Financials & reserves

### 🔴 CRITICAL · ⚖️ counsel · _works_ — HOA audit tier thresholds wrong: $150k-$300k returns 'compiled', $300k-$500k returns 'reviewed' — both incorrect per FS 720.303(7)
- **Where:** `lib/compliance/financials.ts:34-38, 141-153`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** requiredAuditTier() uses AUDIT_TIER_CUTOFFS (compiledMin=$150k, reviewedMin=$300k) for both condo and HOA. FS 720.303(7) defines a completely different structure for HOA: (a) below $300k → cash-basis report of receipts/disbursements (no CPA required); (b) $300k-$500k → compiled financial statements; (c) $500k or more → audited. The condo thresholds (FS 718.111(13)) are $150k/$300k/$500k with a reviewed tier at $300k-$500k. Sharing the condo thresholds for HOA produces two wrong results: an HOA at $150k-$300k is told it needs 'compiled' statements (it needs cash), and an HOA at $300k-$500k is told it needs 'reviewed' statements (it needs 'compiled'). The code comment on line 33 ('Shared across regimes; only the audited cutoff differs') documents the incorrect assumption. The false-positive for $150k-$300k HOA produces an 'overdue' severity signal when the association's cash-basis report is fully compliant.
- **Suggested fix:** Split AUDIT_TIER_CUTOFFS into regime-specific objects. For HOA: compiledMin=$300k, no reviewedMin. Update requiredAuditTier() to branch on regime before applying thresholds: if regime==='hoa' { if (rev >= auditedCutoff) return 'audited'; if (rev >= 300_000) return 'compiled'; return 'cash'; }. Update the AUDIT_TIER_CUTOFFS rule note to distinguish the regimes. The 'reviewed' tier label remains valid for condo only.

### 🟠 HIGH · ⚖️ counsel · _complete_ — HOA AFR delivery deadline uses 21 days (condo clock) instead of the FS 720.303(7)(d) HOA window
- **Where:** `lib/compliance/financials.ts:59, 300-311`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** AFR_DELIVER_DAYS is set to 21 and cited as 'FS 718.111(13) / 720.303(7)' with note 'days after completion / request to deliver to members'. The 21-day-after-completion clock is from FS 718.111(13)(b) for condo associations. FS 720.303(7)(d) for HOA specifies a different delivery requirement: the financial report must be provided to parcel owners no later than 60 days after the close of the fiscal year (not 21 days from completion). The code applies the condo delivery clock to both regimes: addCalendarDays(afr.completed_at ?? fyEnd, 21). For HOA, both the duration (21 vs 60 days) and the start date (completion vs FY-end) are wrong. The effect is that HOA boards receive a delivery signal that fires 39+ days sooner than statutorily required, and the signal references the wrong anchor date.
- **Suggested fix:** Add a regime-specific delivery constant: HOA_AFR_DELIVER_DAYS = rule(60, 'FS 720.303(7)(d)', { note: 'days after FY-end to provide financial report to parcel owners' }). In financialSignals(), branch the delivery deadline calculation: for condo use addCalendarDays(afr.completed_at ?? fyEnd, 21) (current behavior); for HOA use addCalendarDays(fyEnd, 60) anchored to FY-end. Validate the exact HOA window with counsel since 720.303(7) wording has varied across recent legislative amendments.

### 🟡 MEDIUM · ⚖️ counsel · _complete_ — No signal fires when required audit tier is 'compiled' or 'reviewed' and community has zero filings on record
- **Where:** `lib/compliance/financials.ts:227-269`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** The audit-tier check (lines 229-269) has three branches: (1) if haveTier exists and is below required → 'overdue' mismatch signal; (2) else if required==='audited' → 'info' reminder signal; (3) otherwise nothing. When no filing record exists at all (haveTier=undefined) and the required tier is 'compiled' or 'reviewed', neither branch fires and the community sees zero signals about its outstanding statutory obligation to obtain CPA-prepared statements. By contrast, a community that requires audited statements does receive an 'info' signal (branch 2). The inconsistency leaves mid-revenue communities ($150k-$500k condo) without any compliance nudge until they enter a filing row.
- **Suggested fix:** Add an else branch (or extend the else-if) to fire an 'info' signal when haveTier is undefined and required is 'compiled' or 'reviewed': else if (!haveTier && (required === 'compiled' || required === 'reviewed')) { out.push(signal({ id: 'financial:audit-tier-no-filing', severity: 'info', title: `No ${AUDIT_TIER_LABEL[required]} on file`, detail: `At ~$${revenue} revenue, ${AUDIT_TIER_LABEL[required]} are required. Record the completed filing to clear this reminder.`, ... })) }

### 🟡 MEDIUM · 🔧 code-fix · _works_ — Budget package document incorrectly states HOA reserve waiver requires 'majority of ALL voting interests'
- **Where:** `app/admin/financials/document/page.tsx:591`
- **Verifier:** verifier-caught (reviewer confidence med)
- **Detail:** The printed budget package footer reads: 'A reserve waiver, if any, requires a majority of ALL voting interests and is prohibited for SIRS structural components.' This statement is printed without regime conditioning. For HOA, RESERVE_WAIVER_VOTE_BASIS.value.hoa (defined in lib/compliance/financials.ts:76) is 'a majority of the voting interests PRESENT at a meeting at which a quorum is present' — a materially lower bar than 'all voting interests'. An HOA board printing this document would see a legally incorrect description of their waiver standard. Additionally, the claim that SIRS reserves 'may not be waived' is condo-only (FS 718.112(2)(g)2); the signal guard at financials.ts:365 correctly limits this to `regime === 'condo'`, but the printed document text applies the restriction to all regimes including HOA.

### ⚪ LOW · 🔧 code-fix · _works_ — 'financial:audit-tier-required' info signal fires even when the association already has audited statements on file
- **Where:** `lib/compliance/financials.ts:243-253`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** The else-if block at line 243 fires an 'info' signal whenever required==='audited', regardless of whether haveTier is already 'audited'. The condition only blocks on the first if (mismatch), so when haveTier='audited' and required='audited', rank(audited) is NOT less than rank(audited), the first if does not fire, and the else-if fires unconditionally. A compliant high-revenue association that has audited statements on file still sees a permanent 'info' notice saying 'Audited financial statements are required at this revenue'. This is noise rather than a compliance gap, but it reduces signal quality on the dashboard.
- **Suggested fix:** Add !haveTier || AUDIT_TIER_RANK[haveTier] < AUDIT_TIER_RANK['audited'] to the else-if guard: } else if (required === 'audited' && (!haveTier || AUDIT_TIER_RANK[haveTier as AuditTier] < AUDIT_TIER_RANK['audited'])) { — this suppresses the reminder once the association has filed audited statements.

### ⚪ LOW · 🔧 code-fix · _works_ — Reserve worksheet document hard-codes condo-only SIRS no-waiver statement for all regimes
- **Where:** `app/admin/financials/document/page.tsx:598`
- **Verifier:** verifier-caught (reviewer confidence med)
- **Detail:** The reserve_worksheet intro paragraph states 'SIRS structural components must be fully funded for budgets adopted on/after 2026-01-01 and may not be waived.' This text is rendered for HOA communities as well. The SIRS full-funding mandate (FS 718.112(2)(g)2) and the waiver prohibition are condo-specific statutes. An HOA reserve worksheet that claims SIRS components 'may not be waived' is factually incorrect for HOA boards. The compliance signal in financials.ts line 365 already correctly gates this to condo only (`regime === 'condo'`), so the mismatch is between the signal logic and the document copy.

---

## Directors & management

### 🟡 MEDIUM · 🔧 code-fix · _works_ — Delinquency signal silent when delinquent_since is recent (< 90 days)
- **Where:** `lib/compliance/governance.ts:328-339`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** When the board sets elig.delinquent = true but supplies a delinquent_since date that is fewer than 90 days ago, dateDaysAgo returns that smaller number (e.g. 30), delinqDays = 30, the condition delinqDays >= 90 is false, and no signal fires. There is also no 'approaching 90 days' warning tier. The board has positively flagged the director but the compliance dashboard shows nothing until the date crosses 90 days — or never, if delinquent_since is null (in which case the fallback of exactly 90 satisfies the threshold and the signal does fire, which is the only path that works correctly).
- **Suggested fix:** Split into two tiers: if delinqDays >= DIRECTOR_DELINQUENCY_DAYS.value push 'overdue'; else if elig.delinquent push 'soon' (director has been flagged delinquent; the 90-day ineligibility clock is running). This ensures the board sees an advisory as soon as they record the flag regardless of whether a date was supplied.

### 🟡 MEDIUM · ⚖️ counsel · _complete_ — 14-day conflict-disclosure lead-time not monitored (CONFLICT_DISCLOSURE_LEAD_DAYS unused)
- **Where:** `lib/compliance/governance.ts:71 (constant), :394-408 (conflict signal)`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** FS 718.3027 and 720.3033(2) require that a conflict of interest be disclosed at least 14 days before the vote. The constant CONFLICT_DISCLOSURE_LEAD_DAYS = 14 is exported but never referenced in any signal. The existing conflict signal only checks whether a director-owned vendor lacks any disclosure at all — it does not check whether a disclosure was recorded within the required lead time relative to an upcoming vote. The ev_conflict_disclosures table has a vote_at column (governance.sql line 173) that is never read by the producer.
- **Suggested fix:** Add a signal loop over disclosures where vote_at is set: if vote_at is within 14 days from now and the disclosure was not yet filed (disclosed_at is null), push a 'soon' signal citing CONFLICT_DISCLOSURE_LEAD_DAYS. This gives the board the statutory pre-vote warning.

### ⚪ LOW · 🏗️ build · _complete_ — co_owner_conflict eligibility flag stored and displayed but never triggers a signal
- **Where:** `lib/compliance/governance.ts:107 (type), :341-353 (eligibility signal block)`
- **Verifier:** adjusted (reviewer confidence high)
- **Detail:** DirectorEligibilityRow includes co_owner_conflict and the governance.sql table has the column (line 132). FS 718.112(2)(d)2 bars a director from voting on a matter in which a co-owner has a conflict. The eligibility signal block only checks felony_conviction and charged_pending; co_owner_conflict is silently ignored.
- **Suggested fix:** Add co_owner_conflict to the condition (or emit a separate 'info' signal so the board is reminded to identify the specific vote items affected).

### ⚪ LOW · ⚖️ counsel · _works_ — pageDek says '4-hour certification' — wrong description of the initial-cert obligation
- **Where:** `lib/i18n/en.ts:2730`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** The governance page subtitle reads 'Track director eligibility, the 4-hour certification + continuing education'. The 4-hour figure is the HOA continuing-education requirement for small associations (FS 720.3033(1)), not the initial certification. The initial-certification obligation is a 90-day window with no hour requirement. This misdescription could confuse board members about what is being tracked.
- **Suggested fix:** Change to 'the 90-day director certification + continuing education' to correctly identify the initial-certification deadline clock.

### ⚪ LOW · 🔧 code-fix · _connected_ — ConflictDisclosureRow interface missing vote_at, disclosed_at, subject, approval_basis columns
- **Where:** `lib/compliance/governance.ts:155-160`
- **Verifier:** verifier-caught (reviewer confidence med)
- **Detail:** The ConflictDisclosureRow TypeScript interface declares only {id, resident_id, related_vendor_id, approved}. The SQL table ev_conflict_disclosures (governance.sql lines 165-178) has vote_at, disclosed_at, subject, and approval_basis columns that are never typed. The admin page works around this with explicit 'as any' casts ((x as any).subject, (x as any).disclosed_at at app/admin/governance/page.tsx lines 300-301) and the document page does the same. Any signal or UI logic that needs to read these fields has no type-safe path. This is primarily a type-safety gap that also masks the missing vote_at signal described in GOV-02.

### ⚪ LOW · 🔧 code-fix · _connected_ — co_owner_conflict flag has no UI control in DirectorCard — cannot be set or cleared
- **Where:** `app/admin/governance/page.tsx:425-434`
- **Verifier:** verifier-caught (reviewer confidence med)
- **Detail:** The eligibility checkboxes in DirectorCard enumerate [delinquent, felony_conviction, charged_pending, signed_certification] but omit co_owner_conflict. Because the flag is not in this array, a board user has no way to toggle it through the UI. The field exists in SQL (governance.sql line 131) and the TypeScript interface (governance.ts line 123) and the saveEligibility mutation would handle it, but there is no input to invoke the save. This is a separate connected gap from the signal omission noted in GOV-04.

---

## Violations, fines & hearings

### 🟡 MEDIUM · 🔧 code-fix · _connected_ — Owner-facing enforcement page not wired into resident rail nav
- **Where:** `app/app/enforcement/page.tsx:182-183 and app/app/layout.tsx:38-44`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** The resident enforcement page at /app/enforcement is only reachable via a single link on the documents page. The resident left-rail NAV array has no enforcement entry. The page itself documents this as a TODO: 'Left rail (app/app/layout.tsx NAV): { href: /app/enforcement, label: Violations, icon: … } — not yet wired.' A resident who does not happen to open the documents tab will never discover hearing notices or suspension status.
- **Suggested fix:** Add { href: '/app/enforcement', label: 'Violations', match: ['/app/enforcement'], icon: <…> } to the NAV array in app/app/layout.tsx, or add a prominent tab/link entry to the Easy Voice or Easy Documents hub so affected owners can discover hearings and suspension notices without knowing the direct URL.

### 🟡 MEDIUM · 🔧 code-fix · _works_ — fineDisputeSignals only fires on dispute_status='filed', misses 'under_review' contested fines
- **Where:** `lib/compliance/enforcement.ts:519`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** The producer filters with `if (v.dispute_status !== 'filed') continue`. The admin UI's contestedFines memo (page.tsx line 195-197) surfaces both 'filed' and 'under_review' disputes for board action. Once a board member moves a dispute to 'under_review' (e.g. by routing it to the committee), the two compliance signals (dispute-hearing-needed and dispute-hold) both disappear from the dashboard even though the fine has not yet been decided and must not be imposed. This creates a silent window where the board could accidentally levy the fine without a committee ruling.
- **Suggested fix:** Change the filter to `if (v.dispute_status !== 'filed' && v.dispute_status !== 'under_review') continue` so the hold signal persists until the committee rules (dispute_status becomes 'upheld', 'dismissed', or 'reduced'). The dispute-hearing-needed sub-signal can remain filed-only since a hearing is presumably already in motion once the status advances to under_review.

### 🟡 MEDIUM · ⚖️ counsel · _complete_ — votingSuspensionCandidates applies the condo $1,000 floor to use-rights suspension, but FS 718.303(4) has no floor
- **Where:** `lib/compliance/enforcement.ts:625-637`
- **Verifier:** adjusted (reviewer confidence high)
- **Detail:** FS 718.303(5) requires the debt to exceed $1,000 AND be >90 days delinquent for a condo to suspend VOTING rights. But FS 718.303(4) — the use-rights (common-area access) suspension — has no monetary floor; it applies to any monetary delinquency >90 days. The function votingSuspensionCandidates applies `if (condo && balance <= VOTING_SUSPENSION_MONETARY_FLOOR.value) continue` to every condo candidate regardless of which right is being considered. When the board wants to suspend only common-area use rights (rights='use_common') for a condo owner with a $500 balance >90 days delinquent, the candidate will not surface. The constant and its note correctly limit it to voting rights only, but the filter in candidates() is applied globally.
- **Suggested fix:** Either (a) split candidates into two groups (voting vs use-rights) and only apply the $1,000 floor to the voting group, or (b) add a regime/rights parameter to the function and let the caller pass which right is under consideration. The simplest fix: remove the monetary floor from candidates() entirely (it concerns only use-rights vs voting precision) and enforce the $1,000 distinction inside votingSuspensionSignals(), clearly noting the two separate thresholds.

### 🟡 MEDIUM · 🔧 code-fix · _works_ — Delinquency-based 'both' suspension button uses voting-rights $1,000 filter but records rights='both', silently omitting condo use-rights-only candidates
- **Where:** `app/admin/enforcement/page.tsx:444-448 and lib/compliance/enforcement.ts:612-643`
- **Verifier:** verifier-caught (reviewer confidence med)
- **Detail:** The admin enforcement page renders a 'Record Suspension' button (line 446) for every candidate returned by `votingSuspensionCandidates()`, always with `rights: 'both'`. However `votingSuspensionCandidates` filters condo owners with balance <= $1,000 (line 633). Under FS 718.303(4) the board may suspend common-area USE rights for any monetary delinquency >90 days with no monetary floor — only the VOTING-rights suspension (718.303(5)) requires >$1,000. A condo owner with a $400 balance delinquent for 100 days is legally eligible for use-rights (not voting) suspension but will never appear in the candidates list, and the board gets no compliance signal about them. The function's name, JSDoc, and the signal text all correctly say 'voting rights', so the filter is not wrong in isolation — the gap is that no separate use-rights delinquency candidate path exists for condo.

### ⚪ LOW · 🔧 code-fix · _works_ — suspensionSignals delinquency-lifted reminder is missing
- **Where:** `lib/compliance/enforcement.ts:550-582`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** suspensionSignals only checks for covenant-violation suspensions that lack a hearing (the rule_violation branch). The comment block says it will also remind boards when 'an active suspension for a 90-day delinquency must be lifted once the debt is cured', but that second branch is not implemented. The function returns after the needsHearing block without emitting any signal for active delinquency-based suspensions (basis='delinquency_90') where ended_at is null but the associated collection case may have closed. Boards receive no automated prompt to lift a delinquency suspension after payment.
- **Suggested fix:** After the needsHearing block, add a check: if basis is 'delinquency_90', status is 'active', and ended_at is null, emit an info-severity signal reminding the board to verify whether the debt has been paid and, if so, to lift the suspension. Cross-referencing collection cases (cases array is already available in the dashboard's gatherSignals) would make this more precise, but even an unconditional reminder for all active delinquency suspensions older than N days adds value.

### ⚪ LOW · 🔧 code-fix · _works_ — hearingApproved tie-vote logic: tie is correctly rejected but 'present < 3 with majority for' is incorrectly approved
- **Where:** `lib/compliance/enforcement.ts:308-316`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** hearingApproved() returns true when forV > against AND present >= FINING_COMMITTEE_MIN.value (3). However, the function is only called in the suspension hearing check (`!hearingApproved(h)`) not during the main violation flow. In suspensionSignals, if h.decision is 'upheld' the function short-circuits to true. The only dangerous path is if committee_present is recorded as less than 3 but forV > against with decision still 'pending' — the function would return false in that case (due to the `present >= 3` guard), which is correct. However the DecisionForm in the admin page (page.tsx line 741) calculates proposed outcome using the same vote math but allows the board to then click 'Record Upheld' or 'Record Rejected' independently of the computed outcome — meaning a board member can record 'upheld' with 2 members present, bypassing the quorum check in hearingApproved. recordDecision() passes `d.decision` directly from the button pressed, not from the computed outcome.
- **Suggested fix:** Disable the 'Record Upheld' button when the quorum check fails (present < FINING_COMMITTEE_MIN.value) rather than only showing a computed outcome label. Add: `disabled={Number(present) < FINING_COMMITTEE_MIN.value || Number(forV) <= Number(against)}` to the 'Record Upheld' button, and similarly enforce rejection when votes-against >= votes-for.

### ⚪ LOW · 🔧 code-fix · _works_ — fineDisputeSignals accepts a `now` parameter that is never used
- **Where:** `lib/compliance/enforcement.ts:511`
- **Verifier:** verifier-caught (reviewer confidence med)
- **Detail:** The `now: Date = new Date()` parameter on `fineDisputeSignals` is declared but never referenced in the function body. All callers (compliance/page.tsx:160, cron/compliance-scan) omit it. This is a dead parameter — no incorrect behavior results, but it creates confusion about whether any time-based filtering was intended (e.g., a 'dispute filed N days ago' signal). Low severity / cleanup.

---

## Meetings & notice

### 🟠 HIGH · ⚖️ counsel · _complete_ — Special member-meeting type falls through to 48-hour board-meeting notice instead of required 14-day mailed notice
- **Where:** `/Users/fernandosantamarta/Residente/lib/compliance/meetings.ts:111-125`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** requiredNotice() checks is_budget_meeting, affects_assessments, affects_use_rules, and type==='annual', but has no branch for type==='special'. A special meeting of the members (as opposed to a board-called special board meeting) requires 14-day mailed + posted notice under FS 718.112(2)(d) / 720.306(1). Without any of the three boolean flags set, a 'special' typed meeting gets the 48-hour board-meeting default. This means the compliance signal would fire for the wrong threshold, the notice document would state '48 hours posted' instead of '14 days mailed + posted', and the affidavit of mailing would omit the mailed-notice rows.
- **Suggested fix:** Add a branch for type==='special' before the board-meeting fallthrough: `if (m.type === 'special') { return { days: ANNUAL_MEETING_NOTICE_DAYS.value, mailed: true, citation: 'FS 718.112(2)(d) / 720.306(1)', reason: 'special members meeting' } }`. Confirm with counsel whether a special board-only meeting (no member vote) takes the 48-hour rule instead.

### 🟡 MEDIUM · 🔧 code-fix · _works_ — Same-day completed meeting fires spurious notice-overdue signals because 'upcoming' guard uses UTC-midnight equality
- **Where:** `/Users/fernandosantamarta/Residente/lib/compliance/meetings.ts:181,183-231`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** toDate() normalizes every timestamp to UTC midnight. When a meeting with scheduled_at = today is marked status='completed' on the same calendar day, toDate(sched).getTime() === toDate(now).getTime() (both are UTC midnight for today), so `upcoming = true`. The notice block then executes for the completed meeting: if notice_posted_at is missing or notice_given < deadline, it fires a 'notice-overdue' or 'notice-short' signal. The meeting is also caught by the isHeld branch, but the minutes check (ageDays=0 < 30) correctly stays silent. The net result is a false notice-compliance alert for a meeting that has already been held.
- **Suggested fix:** Guard the notice block against held meetings: `if (upcoming && !isHeld(m) && deadline && !m.emergency)`. The comment already says 'a held meeting is handled by the minutes block' but the guard is absent.

### 🟡 MEDIUM · 🔧 code-fix · _works_ — minutes-templates.ts prefills scheduled_time in local time while scheduled_date is UTC, causing a date/time mismatch in minutes for evening meetings
- **Where:** `/Users/fernandosantamarta/Residente/lib/compliance/minutes-templates.ts:263-267`
- **Verifier:** verifier-caught (reviewer confidence med)
- **Detail:** In `prefillValue()`, `scheduled_date` is computed via `ymd(sched)` which normalises to UTC midnight (rules-core.ts line 86), while `scheduled_time` uses `sched.getHours()` and `sched.getMinutes()` which are local-time getters. For a meeting stored as e.g. 2026-06-25T02:00:00Z (= 10 PM EDT June 24), `ymd` returns '2026-06-25' (UTC) but `getHours()` returns 22 on an Eastern client — the prefilled minutes would show date 2026-06-25 and time 22:00, a one-day/time contradiction. On a server-side render in UTC the time would show 02:00 while the date shows 2026-06-25. The inconsistency corrupts the officially-recorded meeting time in the structured minutes and could mislead the secretary certification.

### ⚪ LOW · 🔧 code-fix · _connected_ — Owner-facing /app/meetings page is not in the resident nav rail — only reachable via deep links inside Voice/Proposals
- **Where:** `/Users/fernandosantamarta/Residente/app/app/meetings/page.tsx:219-220`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** The file itself documents the gap: '// Left rail (app/app/layout.tsx NAV): { href: /app/meetings, label: Meetings, icon: … } // or surface as Easy Voice hub tabs. Reachable directly at /app/meetings until then.' A grep of app/app/layout.tsx confirms there is no nav entry for /app/meetings. The page is only linked from two places: app/app/voice/_sections/ProposalsRulesSection.tsx:84 and its mobile sibling. A resident who does not navigate into Proposals/Rules will never discover the upcoming-meetings and minutes-availability view.
- **Suggested fix:** Add a nav entry for /app/meetings in app/app/layout.tsx (or the Easy Voice tab structure) once the Easy Voice front-end work stabilizes. In the interim, consider adding a meetings card/link to the main /app dashboard so residents can discover it without entering Proposals/Rules.

### ⚪ LOW · 🔧 code-fix · _works_ — 48-hour board-meeting notice is tracked as 2 calendar days, losing sub-day accuracy
- **Where:** `/Users/fernandosantamarta/Residente/lib/compliance/meetings.ts:124`
- **Verifier:** confirmed (reviewer confidence medium)
- **Detail:** The statute (FS 718.112(2)(c) / 720.303(2)(c)) requires notice 'continuously posted conspicuously on the property for at least 48 continuous hours.' The code converts this to `Math.ceil(48/24) = 2` calendar days and uses calendar-day subtraction via addCalendarDays. A notice posted at 11:59pm two calendar days before a 9am meeting satisfies the calendar-day check but provides only ~33 hours of posting, violating the 48-hour continuous-posting requirement. noticeSatisfied() compares dates, not timestamps.
- **Suggested fix:** Store notice_posted_at as a full timestamptz (already is) and compute hour difference directly: `(schedTimestamp - postedTimestamp) / 3600000 >= 48`. The calendarDaysUntil path can remain for the dashboard warning; the noticeSatisfied check should switch to ms-precision for the 48-hour rule.

---

## Elections & recall

### 🟠 HIGH · ✅ FIXED · _works_ — Candidate deadline has no overdue signal when missed
- **Where:** `lib/compliance/elections.ts:229-239`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** The candidate-window block fires only when calendarDaysUntil(ms.candidateBy, now) is between 0 and 10 inclusive. When the deadline is past (days < 0) and candidate_deadline_at is not set, no signal fires at all. Every other milestone (first-notice at line 211, ballot at line 244) has an explicit overdue branch. A missed candidate deadline means no timely candidates are registered, which can invalidate or require rescheduling the election.
- **Suggested fix:** Add an overdue branch before the upcoming branch, mirroring the pattern used for first-notice and ballot: if (ms.candidateBy.getTime() < nowMs) { out.push(signal({ id: `elections:candidate-deadline-late:${e.id}`, severity: 'overdue', title: `${label}: the 40-day candidate notice deadline has passed`, ... })) } else if (days <= 10) { /* existing info/soon signal */ }

### 🟡 MEDIUM · ✅ FIXED · _works_ — Candidate-window signal severity is 'info' instead of 'soon'
- **Where:** `lib/compliance/elections.ts:233`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** The candidate deadline is a hard statutory date (40 days before the election, FS 718.112(2)(d)4 / 720.306(9)(b)). The signal that fires within 10 days of this deadline uses severity 'info', while the analogous first-notice warning (line 220) and ballot warning (line 253) both use severity 'soon'. The compliance dashboard's weekly cron only pages the board for 'overdue' and 'soon' signals; an 'info' severity candidate-deadline warning is not included in the digest and does not appear in the due-soon filter.
- **Suggested fix:** Change severity from 'info' to 'soon' for the candidate-window signal to match the treatment of the first-notice and ballot warnings and to ensure it surfaces in the cron digest.

### 🟡 MEDIUM · 🔧 code-fix · _works_ — Failed-quorum signal uses severity 'soon' on a completed past election
- **Where:** `lib/compliance/elections.ts:267`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** When a completed election's ballot-cast count is below the 20% quorum threshold (FS 718.112(2)(d)), the signal emitted has severity 'soon'. The election is already completed — there is no upcoming deadline. 'soon' is semantically for approaching deadlines. The correct severity is 'overdue' (action needed: the board must continue in place until a valid election is held) or at minimum 'info'. This misclassification causes the signal to sort incorrectly in the dashboard and in the cron digest count breakdown.
- **Suggested fix:** Change severity to 'overdue' for the quorum-failed case, since the defect is a fait accompli and the board must schedule a new valid election. Update the detail string to reflect that the prior board continues in place and a new election is required.

### 🟡 MEDIUM · 🏗️ build · _complete_ — FS 718.112(2)(d)4 'no election required when candidates <= seats' obligation never evaluated
- **Where:** `lib/compliance/elections.ts:108, supabase/elections.sql:34-35`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** FS 718.112(2)(d)4 states: 'If the number of candidates is no greater than the number of vacancies, no election is required.' Both candidate_count (SQL line 35, ElectionRow line 108) and seats (SQL line 34, ElectionRow line 107) fields exist in the schema and type, but no signal or helper checks whether candidate_count <= seats to advise the board that a ballot election may be unnecessary. The admin page also provides no field to enter candidate_count after the candidate window closes. This is a required statutory determination that affects whether the secret-ballot process must proceed.
- **Suggested fix:** After candidates_closed status, evaluate if e.candidate_count != null && e.seats != null && e.candidate_count <= e.seats and emit an 'info' signal advising the board that the election may not be required under FS 718.112(2)(d)4. Add a candidate_count input field to ElectionCard (or to the scheduleElection form) so the admin can record how many candidates came forward.

### ⚪ LOW · ⚖️ counsel · _complete_ — second_notice_at column declared in SQL and ElectionRow but never written or read
- **Where:** `supabase/elections.sql:32, lib/compliance/elections.ts:105`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** The ev_elections table declares a separate second_notice_at date column (SQL line 33) and ElectionRow includes the field (line 105), but neither the admin page nor any signal logic ever writes to it or reads from it. The code exclusively uses ballots_sent_at for the second-notice milestone. The column appears to be a vestigial duplicate that creates potential confusion about which field records when the second notice was sent.
- **Suggested fix:** Either remove second_notice_at from the SQL schema and ElectionRow type (and add an ALTER TABLE DROP COLUMN migration), or unify the two fields — e.g. map ballots_sent_at to second_notice_at and use a single column throughout to avoid confusion.

### ⚪ LOW · 🔧 code-fix · _connected_ — Owner-facing meetings/elections page not in persistent left-rail navigation
- **Where:** `app/app/meetings/page.tsx:4-5, app/app/layout.tsx`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** The resident-facing page at /app/meetings (which shows upcoming elections, candidate deadlines, and recalls) is explicitly documented as 'NOT yet wired into the rail / Easy Voice tabs.' The page is reachable only via a Link inside ProposalsRulesSection (both desktop and mobile voice tab sub-section), which is itself one level inside the Easy Voice tab. It is not listed in the left-rail nav in app/app/layout.tsx. Owners who do not navigate into the voice tab's proposals section will not discover it.
- **Suggested fix:** Add an entry to the resident app left-rail navigation in app/app/layout.tsx pointing to /app/meetings, or surface it as a tab within the Easy Voice hub. The comment at the bottom of the file (lines 219-220) already provides the exact nav entry to add.

### ⚪ LOW · 🔧 code-fix · _works_ — electionQuorumMet returns false (not null) when eligible_count is set but ballots_cast is absent
- **Where:** `lib/compliance/elections.ts:155-160`
- **Verifier:** verifier-caught (reviewer confidence med)
- **Detail:** electionQuorumMet() coerces null/undefined ballots_cast via `Number(e.ballots_cast) || 0`, yielding 0. When eligible_count is non-zero and ballots_cast is absent (e.g. a row inserted directly in SQL with status='completed' but no ballots_cast value), the quorum check evaluates (0 / eligible) * 100 >= 20 = false and emits a spurious 'quorum failed' signal. The UI guards against this by requiring a non-empty ballots_cast input before enabling the Confirm button (page.tsx line 449), but there is no DB-level NOT NULL constraint on ballots_cast in elections.sql, so a direct INSERT or a future code path could produce a false signal.

### ⚪ LOW · ⚖️ counsel · _complete_ — HOA second-notice / ballot deadline not distinguished from condo — no advisory that the window is governing-document-driven for HOAs
- **Where:** `lib/compliance/elections.ts:241-259`
- **Verifier:** verifier-caught (reviewer confidence med)
- **Detail:** The 14–34-day second-notice window (SECOND_NOTICE_MIN_DAYS / SECOND_NOTICE_MAX_DAYS) is statutory for condos under FS 718.112(2)(d)4. For HOAs, FS 720.306(9) requires mailing at least 14 days before but the upper bound is governing-document-driven, not a fixed 34 days. The ballot-due and ballot-late signals (lines 244-258) fire identically for both regimes without any note that the 34-day upper bound may not apply to HOAs. The statutory constants' notes already flag this ('condo: first notice…') for ELECTION_FIRST_NOTICE_DAYS but the signal detail strings for the ballot window make no such distinction. This is a completeness gap under the statute citation included in the signal (SECOND_NOTICE_MIN_DAYS.citation = 'FS 718.112(2)(d)4').

---

## Architectural review

### 🟡 MEDIUM · 🔧 code-fix · _works_ — Denial-missing-reason signal fires as 'soon' instead of 'overdue'
- **Where:** `/Users/fernandosantamarta/Residente/lib/compliance/arc.ts:193`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** When a request is already in status 'denied' but has no decision_reason, the signal is raised with severity:'soon'. This is incorrect: the denial has already happened without the required written reason (FS 720.3035(3)), so the violation is present-tense — it should be severity:'overdue', not 'soon'. The 'soon' severity implies the deadline is approaching in the future, which is misleading to a board user.
- **Suggested fix:** Change severity: 'soon' to severity: 'overdue' for the arc:denial-reasons signal. The denial is already recorded; the missing written reason is an existing deficiency, not an upcoming one.

### 🟡 MEDIUM · ⚖️ counsel · _complete_ — Owner self-submit never sets submitted_at or response_due_at on the row
- **Where:** `/Users/fernandosantamarta/Residente/app/app/arc/page.tsx:119-126`
- **Verifier:** adjusted (reviewer confidence high)
- **Detail:** The owner-facing form inserts a row with no submitted_at and no response_due_at. The DB default for submitted_at is current_date (correct), but response_due_at is left null. The admin-side intake (app/admin/arc/page.tsx) explicitly computes the deadline via arcResponseDeadline() and stores it in response_due_at. For owner-submitted requests, arcResponseDeadline() will fall back to computing from submitted_at (via addCalendarDays) since response_due_at is null — the compliance signal still fires, but the deadline is never persisted on the row. If the board later changes arc_response_days on the community, the deadline shown on owner-submitted requests will silently shift, because there is no frozen deadline on the row. Also, the admin worklist shows the deadline chip from the computed deadline, which will change if community settings change.
- **Suggested fix:** Add submitted_at: new Date().toISOString().slice(0, 10) and compute response_due_at using arcResponseDeadline() (or addCalendarDays(today, arcResponseDays(community))) in the owner submit handler, mirroring what the admin logRequest() function does at app/admin/arc/page.tsx:224-234.

### ⚪ LOW · ⚖️ counsel · _complete_ — Owner self-submit form has no is_material_alteration flag — condo 75%-vote obligation may be missed
- **Where:** `/Users/fernandosantamarta/Residente/app/app/arc/page.tsx:119-126`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** The owner-facing ARC form omits the is_material_alteration checkbox. For condominiums, FS 718.113(2) requires 75% membership approval for a material alteration or substantial addition to the common elements. An owner who submits an alteration that is in fact material will have is_material_alteration=false (the SQL default) on their row, so the compliance signal (arc:material:*) will never fire. The board would need to notice the material character from the description alone and then either create a separate admin-side request or manually update the flag. The admin intake form does include this checkbox.
- **Suggested fix:** Either (a) add an is_material_alteration toggle to the owner form (with explanatory copy pointing to the declaration) so owners can self-identify likely material alterations for board review, or (b) add board-side tooling that lets the admin page flag an existing owner-submitted request as material alteration without requiring them to re-enter it. Option (b) is minimal; option (a) is the more complete statutory coverage.

### ⚪ LOW · 🔧 code-fix · _connected_ — Owner-submitted requests never set resident_id — asymmetry with admin-submitted requests
- **Where:** `/Users/fernandosantamarta/Residente/app/app/arc/page.tsx:119-126`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** When the board logs a request via the admin intake form, both resident_id (the residents table FK) and profile_id are set. When an owner self-submits, only profile_id is set; resident_id is left null. This asymmetry means any code path that queries ev_arc_requests by resident_id (for example, a future residents page cross-referencing outstanding ARC requests) will miss owner-submitted rows. The RLS policies and the compliance signal producer key off profile_id (not resident_id), so there is no current runtime break — but the data model is inconsistent.
- **Suggested fix:** In the owner submit handler, after inserting the row, look up the residents row matching profile.id (profiles.id links to residents.profile_id) and backfill resident_id. Alternatively, add a DB trigger or a generated column that maintains the residents FK from profile_id to keep data consistent without client-side logic.

### ⚪ LOW · 🔧 code-fix · _works_ — arcResponseDeadline uses millisecond addition — UTC midnight boundary can shift deadline by ±1 day
- **Where:** `/Users/fernandosantamarta/Residente/lib/compliance/rules-core.ts:168-172`
- **Verifier:** verifier-caught (reviewer confidence med)
- **Detail:** addCalendarDays() adds n * 86400000 ms to the input Date. When the input date string (e.g. '2026-06-01') is parsed by toDate(), it is parsed as a local-timezone Date (new Date('2026-06-01') is midnight UTC, which may be prior day in UTC-5). Adding 86400000 ms per day is correct only in UTC; in a DST-observing timezone, adding 30 days across a DST boundary can land on the wrong calendar date (by one hour / ~3600000 ms), which can make the deadline appear a calendar day off when rendered via toLocaleDateString. The arcResponseDeadline display in the owner page uses fmtDate() which applies toLocaleDateString — the mismatch between the UTC ms-based computation and local rendering can cause a 1-day display error near DST transitions.

### ⚪ LOW · 🔧 code-fix · _connected_ — ev_arc_notify trigger fires on 'withdrawn' status but the trigger definition only allows 'approved'/'approved_with_conditions'/'denied'
- **Where:** `/Users/fernandosantamarta/Residente/supabase/arc.sql:100-101`
- **Verifier:** verifier-caught (reviewer confidence med)
- **Detail:** The admin withdraw() action at app/admin/arc/page.tsx:195-206 calls patchRequest(r.id, { status: 'withdrawn' }). The ev_arc_notify trigger fires AFTER UPDATE OF status and checks `if new.status not in ('approved','approved_with_conditions','denied') then return new; end if;` — so the trigger correctly does NOT send a notice for 'withdrawn'. The admin code issues a logAudit for 'arc.decided' with status:'withdrawn' which is fine. No notice is sent to the owner when a request is withdrawn, which may be the intended behaviour but could leave an owner unaware their request was closed. This is a completeness gap, not a crash — flagged at low severity.

---

## Insurance

### 🟡 MEDIUM · 🔧 code-fix · _works_ — Zero-dollar bond record silences all sufficiency signals
- **Where:** `/Users/fernandosantamarta/Residente/lib/compliance/insurance.ts:297-317`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** When a board records a fidelity bond entry with amount = 0 (explicit zero or blank-then-coerced), latestPolicy() returns a non-null row so the 'bond-missing' signal is suppressed. The underinsurance check on line 297 requires `amount > 0`, so it does not fire. The 'bond-maxfunds-unknown' branch on line 307 requires `maxFunds === 0 && amount > 0`, also does not fire. Result: a bond with a recorded amount of $0 and a known maxFunds of, say, $500,000 produces zero signals — the statutory shortfall is silently ignored.
- **Suggested fix:** Change the underinsurance condition to `amount < maxFunds` (drop the `amount > 0` guard) and add an explicit branch for `amount === 0 && maxFunds > 0` that fires 'insurance:bond-zero-amount' at 'soon' severity, e.g.: `if (maxFunds > 0 && amount <= 0) { /* fire bond-amount-missing */ } else if (maxFunds > 0 && amount < maxFunds) { /* fire bond-underinsured */ }`

### 🟡 MEDIUM · ⚖️ counsel · _complete_ — Bond floor estimate omits operating account — structurally understates the statutory floor
- **Where:** `/Users/fernandosantamarta/Residente/lib/compliance/insurance.ts:141-148`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** FS 718.111(11)(h) / 720.3033(5) require the fidelity bond to cover 'the maximum funds that will be in the custody of the association OR its management agent at any one time.' This peak-custody amount includes both the operating/checking account and the reserve accounts. The estimatedMaxFunds fallback sums only ev_reserve_components.current_balance (reserve-only). The operating account balance has no data model entry. The code comment on line 138 correctly identifies this limitation ('the true statutory floor is the peak operating+reserve balance') but no signal warns the board that the estimate is reserve-only and may be significantly below the actual peak custody figure, which can include one or two months of collected dues in the operating account.
- **Suggested fix:** Add an 'insurance:bond-floor-estimate-incomplete' info-level signal when the board has not entered an estimated_max_funds override, explaining that the reserve-only sum excludes operating funds and that the board must confirm the peak custody figure with the manager. Also add an operating_balance field to the communities table (or prompt the board to enter it alongside estimated_max_funds) so the fallback can include it.

### 🟡 MEDIUM · 🔧 code-fix · _works_ — Expired HOA fidelity-bond waiver fires 'soon' instead of 'overdue'
- **Where:** `/Users/fernandosantamarta/Residente/lib/compliance/insurance.ts:269-279`
- **Verifier:** verifier-caught (reviewer confidence med)
- **Detail:** When an HOA had a fidelity-bond waiver in a prior fiscal year (`waiverFy > 0 && waiverFy < fy`) and no bond is now on file, the association is currently in violation — the waiver has lapsed and no replacement bond exists. The signal fires at `severity: 'soon'` (line 274). This is inconsistent with the appraisal expiry logic (line 216-225, where a past-due date fires `overdue`) and understates urgency. Unlike the unrecorded-bond case (INS-03, where a board may have a bond but not yet entered it), the expired-waiver case involves a board that affirmatively waived the bond and has now let the waiver lapse without renewing or obtaining coverage — a clear current non-compliance. The code `waiverFy < fy` is precisely the condition that means the waiver is in the past, not upcoming. Severity should be `overdue`.

### ⚪ LOW · 🔧 code-fix · _works_ — Missing fidelity bond on a condo fires 'soon' instead of 'overdue'
- **Where:** `/Users/fernandosantamarta/Residente/lib/compliance/insurance.ts:282-291`
- **Verifier:** adjusted (reviewer confidence medium)
- **Detail:** FS 718.111(11)(h) is a continuous mandatory obligation for condominiums with no grace period and no member-waiver right. When no bond is on file and no waiver applies (including the condo regime where a waiver is legally impossible), the signal fires at severity 'soon' instead of 'overdue'. This understates the urgency: 'soon' means 'act within 90 days'; 'overdue' means 'already in violation.' A condo that has never obtained a fidelity bond is immediately non-compliant, not 'upcoming.'
- **Suggested fix:** For the condo regime (where no waiver is possible), change severity to 'overdue'. For the HOA regime where the bond might not yet have been waived but is simply un-entered, 'soon' is defensible as an advisory posture. Apply `severity: regime === 'condo' ? 'overdue' : 'soon'`.

### ⚪ LOW · 🔧 code-fix · _connected_ — document_id column exists in SQL but is never written or read by the admin page
- **Where:** `/Users/fernandosantamarta/Residente/supabase/insurance.sql:35 vs /Users/fernandosantamarta/Residente/app/admin/insurance/page.tsx:111-133`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** The ev_insurance_policies table schema has a document_id column referencing public.documents(id) (labeled 'evidence (Insurance category)'). The addPolicy function in the admin page constructs the insert record but never includes document_id; updatePolicy similarly never patches it. The column is also not read back and displayed. The insurance.ts InsurancePolicyRow type does declare document_id as optional (line 108), so TypeScript is consistent — but no UI path ever populates it, making the document-linkage feature dead wiring.
- **Suggested fix:** Either add a document picker field to the PolicySection form (a select from the 'Insurance' category documents) and include document_id in the insert/update payload, or remove the column from the schema if the linkage is deferred. If deferred, add a TODO comment so it is not forgotten.

---

## Procurement & contracts

### 🟡 MEDIUM · 🔧 code-fix · _works_ — Bid-missing and writing-missing signals fire as 'soon' even when contract is already executed with no bids
- **Where:** `lib/compliance/contracts.ts:226-248`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** The contractsSignals producer always assigns severity 'soon' to both the bid-needed (line 229) and writing-needed (line 243) signals. However, if a contract has executed_on in the past, the statutory violation has already occurred — there is no future deadline to 'soon' warn about. The now parameter passed to the function is voided (line 191) and never used for severity tiering. An already-executed contract missing bids or a written form is an 'overdue' state, not merely 'soon'.
- **Suggested fix:** Add executed_on: string | null to ContractRow (it is already in the SQL and in the existing interface at line 113). In the bid-needed and writing-needed signal blocks, check if the contract is already executed: `const isExecuted = !!c.executed_on && new Date(c.executed_on) <= now`. If isExecuted, use severity 'overdue'; otherwise keep 'soon'. This makes the dashboard correctly distinguish a pre-existing violation from a pending one.

### 🟡 MEDIUM · 🔧 code-fix · _works_ — Writing-needed signal fires false positives for contracts with a professional-service or employee exception
- **Where:** `lib/compliance/contracts.ts:238-249`
- **Verifier:** verifier-caught (reviewer confidence med)
- **Detail:** The hasExceptionBasis() guard is applied to the bid-needed signal (line 225) but NOT to the writing-needed signal (lines 238-249). The module's own constant at lines 60-68 explicitly states that the listed exceptions apply to both the bidding section AND the writing section: 'The professional services / persons a contract with whom is NOT subject to the bidding (and writing) section.' Consequently, a services-type contract entered with exception_basis = 'professional_service', 'employee', or any other recognized exception will still emit a contract:writing-needed signal, even though FS 718.3026(2)(a) / 720.3055(2)(a)1 exempts those contracts from the writing requirement entirely. The signal fires as a false positive, polluting the dashboard. Fix: add `&& !hasExceptionBasis(c)` to the needsWriting guard at line 239, matching the pattern already used for the bid-needed signal.

### ⚪ LOW · 🔧 code-fix · _connected_ — document_id FK column in SQL is absent from ContractRow interface and admin UI
- **Where:** `supabase/contracts.sql:40 vs lib/compliance/contracts.ts:104-118 and app/admin/contracts/page.tsx:97-110`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** The ev_contracts table defines document_id uuid references public.documents(id) on delete set null, intended for attaching the signed contract file. The ContractRow TypeScript interface (lib/compliance/contracts.ts lines 104-118) does not include this field, the admin page intake form never populates it, and the update toggles never set it. The column exists in the DB but is permanently NULL for every row written by the application.
- **Suggested fix:** Either add document_id?: string | null to ContractRow and expose a document picker in the ContractCard inline controls (allowing a board member to attach the PDF of the signed contract via the existing documents table), or drop the column from the SQL if document attachment is deferred. The former is preferable — it closes the loop between written_contract: true attestation and the actual signed file.

### ⚪ LOW · 🏗️ build · _complete_ — Bid tracking is boolean only — no bid count or bidder list; completeness of competitive-bid record not verifiable
- **Where:** `supabase/contracts.sql:33 and lib/compliance/contracts.ts:225`
- **Verifier:** adjusted (reviewer confidence medium)
- **Detail:** Both FS 718.3026 and FS 720.3055 require 'competitive bids' (plural). The schema records a single boolean bids_obtained with no count or structured bidder list. The compliance signal at line 225 fires only when bids_obtained is false — once it is set to true the signal clears regardless of whether one bid or three were obtained. The bid-log document template (document/page.tsx lines 168-173) manually hard-codes three blank rows but that template is a print aid, not connected to the DB. A future audit or legal challenge cannot verify that true competitive bidding occurred from the stored data alone.
- **Suggested fix:** Add a bid_count int nullable column to ev_contracts (alter table ev_contracts add column if not exists bid_count int). Optionally add a bid_vendor_names text[] column. Update the signal to also fire (or downgrade to 'info') when bid_count IS NOT NULL AND bid_count < 2, noting that the statute implies at least two bids to be 'competitive'. Surface bid_count in the admin UI intake form and ContractCard. This is a low-effort schema + UI change that gives auditable evidence of competitive bidding.

### ⚪ LOW · 🏗️ build · _complete_ — HOA management-contract cancellation right (FS 720.3055(2)(a)2) acknowledged but not tracked
- **Where:** `lib/compliance/contracts.ts:14 and 93-95`
- **Verifier:** confirmed (reviewer confidence medium)
- **Detail:** FS 720.3055(2)(a)2 provides that an HOA management contract made by competitive bid may be for up to three years, and separately FS 720.309 provides management-contract fairness and cancellation standards for HOAs. The code notes the three-year max (HOA_MANAGER_BID_TERM_MAX_YEARS at line 95) as an informational constant and includes a comment at line 14 that cancellation rights live in 720.309 / Ch. 468. No signal fires if an HOA management contract term_months > 36, and there is no tracking field for whether the contract contains the statutory cancellation clause.
- **Suggested fix:** Add an 'overdue'-severity signal that fires when regime === 'hoa' && c.contract_kind === 'management' && (Number(c.term_months) || 0) > HOA_MANAGER_BID_TERM_MAX_YEARS.value * 12, citing FS 720.3055(2)(a)2. The HOA_MANAGER_BID_TERM_MAX_YEARS constant is already defined but never referenced in any signal logic. This is a one-signal addition.

---

## Advisories & event clocks

### 🟡 MEDIUM · 🔧 code-fix · _works_ — Receivership cure-window signal fires unconditionally — no time-window guard
- **Where:** `/Users/fernandosantamarta/Residente/lib/compliance/advisories.ts:201-215`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** Every other event-clock signal (turnover: d < 0 || d <= 30; tiered-report: d < 0 || d <= 14) is suppressed when the deadline is far away. The receivership block has no such guard: it calls out.push() unconditionally for every unresolved receivership_notice event. A notice logged months ago that was informally resolved but never marked resolved in the DB will permanently display as 'soon' (with a positive d) forever, injecting permanent noise into the board worklist and cron digest. It also cannot be silenced by the 'all clear' filter path.
- **Suggested fix:** Add the same guard used by other clocks, e.g.: `if (d < 0 || d <= RECEIVERSHIP_CURE_DAYS.value) { out.push(...) }` — or at minimum `if (d < 0 || d <= 30)`. This mirrors the turnover pattern and suppresses stale unresolved events that are already well past the window.

### 🟡 MEDIUM · 🔧 code-fix · _works_ — Invoice delivery-method change signal hardcoded 'info' severity even when the notice period is overdue
- **Where:** `/Users/fernandosantamarta/Residente/lib/compliance/advisories.ts:224`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** The signal for kind === 'invoice_delivery_change' always sets severity: 'info' regardless of whether d < 0 (the 30-day notice period has already elapsed and the board is using the new delivery method without proper owner acknowledgment). The title string correctly distinguishes overdue vs in-progress, but the severity never escalates to 'overdue'. The cron digest only pages board members for 'overdue' and 'soon' signals; an overdue invoice-delivery change is silently demoted to 'info' and excluded from actionable counts.
- **Suggested fix:** Replace hardcoded `severity: 'info'` with `severity: d < 0 ? 'overdue' : 'soon'` to match the pattern used by all other event-clock signals. If the intent is that this obligation is never urgent enough to page the board, at minimum use `severity: d < 0 ? 'soon' : 'info'` to surface the elapsed state.

### 🟡 MEDIUM · ⚖️ counsel · _works_ — HOA proxy staleness measured from submitted_at instead of the meeting date (wrong anchor per FS 720.306(8))
- **Where:** `/Users/fernandosantamarta/Residente/lib/compliance/advisories.ts:139-146`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** FS 720.306(8) states a proxy 'automatically expires 90 days after the date of the meeting for which it was originally given.' The staleProxies() function anchors the 90-day clock on p.submitted_at (the submission timestamp), not on the meeting date. A proxy submitted two weeks before a meeting that happened 80 days ago would be flagged as stale (90 - 14 = 76 days since submission plus the 14 lead time = 90), even though the 90-day window from the meeting date hasn't closed. Conversely a proxy submitted the day of a meeting 91 days ago is correctly stale, but only by coincidence. The ProxyRow type and the admin-page query both omit meeting_id and the meeting's scheduled_at, so there is no path to the correct anchor without a schema and query change.
- **Suggested fix:** Add meeting_date (denormalized) or meeting_id to ProxyRow. In the admin page query change `select('id, status, type, submitted_at')` to `select('id, status, type, submitted_at, meeting_id, ev_meetings(scheduled_at)')`, and pass the meeting's scheduled_at as the clock anchor in staleProxies(). Alternatively add a computed/denormalized meeting_date column to ev_proxies populated by trigger. The note on PROXY_EXPIRY_DAYS already calls this out as approximate — this is the fix.

### ⚪ LOW · ⚖️ counsel · _works_ — Condo proxies incorrectly subject to the 90-day staleness check (FS 718.112(2)(b) has no 90-day rule)
- **Where:** `/Users/fernandosantamarta/Residente/lib/compliance/advisories.ts:139-147, 260-261`
- **Verifier:** confirmed (reviewer confidence high)
- **Detail:** FS 718.112(2)(b) states a condo proxy is 'effective only for the specific meeting for which it was originally given.' There is no 90-day expiry clock for condo proxies — a proxy is simply invalid once the meeting it was given for has passed. The staleProxies() function applies the same 90-day threshold to every proxy regardless of regime, so for a condo community an open proxy submitted 10 days ago for a meeting that concluded 10 days ago will show as 'not stale' for another 80 days. The advisory text (line 261) correctly says 'valid only for the specific meeting,' but the math contradicts it by waiting for 90 days.
- **Suggested fix:** For condo communities, staleness should be determined by whether the associated meeting has passed (meeting.scheduled_at < now), not a fixed 90-day window from submission. After adding meeting_id/meeting_date to ProxyRow (see ADV-003), apply regime-specific logic: HOA → 90 days after meeting date; condo → meeting date has passed.

### ⚪ LOW · ⚖️ counsel · _complete_ — HOA turnover checklist has 19 items; FS 720.307(4) enumerates items (a) through (t) = 20 items
- **Where:** `/Users/fernandosantamarta/Residente/lib/compliance/advisories.ts:68-92`
- **Verifier:** adjusted (reviewer confidence medium)
- **Detail:** The TURNOVER_DOC_CHECKLIST array has 19 string entries. FS 720.307(4) lists items (a) through (t), which is 20 items (a=1, t=20). One item from the statute is absent from the checklist. Common candidates for the missing item include pending litigation files or a copy of all bids received in the prior two years. The document page renders this list directly for HOA turnover verification. The note on the rule already says 'confirm the controlling enumeration with counsel' but the count discrepancy is a concrete gap.
- **Suggested fix:** Audit the 19 items against the current text of FS 720.307(4)(a)-(t) with counsel and add the missing entry. The most commonly omitted item in implementations of this list is 'A copy of all bids obtained by the association within the 2 years before the date of transfer of control' (if such a provision exists in the current text). The validated:false flag already gates this on attorney review.

### ⚪ LOW · ⚖️ counsel · _complete_ — Condo turnover document page uses HOA 720.307(4) checklist rather than FS 718.301(4) enumeration
- **Where:** `/Users/fernandosantamarta/Residente/app/admin/advisories/document/page.tsx:109-124`
- **Verifier:** confirmed (reviewer confidence medium)
- **Detail:** When rendered for a condo community (isCondo === true), the turnover_checklist document uses TURNOVER_DOC_CHECKLIST, which is explicitly annotated as the HOA FS 720.307(4) list, as 'a practical baseline.' FS 718.301(4) specifies a separate (and different) list of documents the developer must deliver at condo turnover. The document page includes a disclaimer on line 123, but the actual checklist items rendered are the HOA list. The condo-specific statutory obligation is not implemented.
- **Suggested fix:** Create a separate CONDO_TURNOVER_DOC_CHECKLIST constant populated from FS 718.301(4)(a)-(p) (or whatever the current enumeration is) and render it when isCondo === true in the document page. The HOA list can remain as TURNOVER_DOC_CHECKLIST. Both should carry validated:false and attorney-review notes.

### ⚪ LOW · 🔧 code-fix · _works_ — invoice_delivery_change silently skipped for HOA communities if the event kind is ever logged
- **Where:** `/Users/fernandosantamarta/Residente/lib/compliance/advisories.ts:219`
- **Verifier:** verifier-caught (reviewer confidence med)
- **Detail:** The producer at line 219 gates on `kind === 'invoice_delivery_change' && regime === 'condo'`. The DB check constraint (advisories.sql line 28) allows this kind for any community. The admin form correctly filters it out for HOA users (KIND_META.regime = 'condo'). However if an HOA community somehow has a row with kind='invoice_delivery_change' (e.g. inserted directly via SQL or migrated from a miscategorized entry), the signal is silently swallowed — no error, no signal. This is low severity because the UI gate prevents normal creation, but defensive code would surface an unexpected event rather than suppressing it.

### ⚪ LOW · 🔧 code-fix · _works_ — calendarDaysUntil normalizes 'now' to UTC midnight, producing off-by-one for same-day deadline events
- **Where:** `/Users/fernandosantamarta/Residente/lib/compliance/rules-core.ts:210-214`
- **Verifier:** verifier-caught (reviewer confidence med)
- **Detail:** calendarDaysUntil calls toDate(now) which normalizes to UTC midnight (line 86: `new Date(Date.UTC(...))`). When the dashboard or cron runs at, say, 18:00 UTC and a deadline is set to today's UTC date, toDate(now) yields midnight, making the difference 0 (not overdue) when the board might consider the day already past. This is a pervasive property of all event-clock signals. Since the clocks here measure 30- and 90-day windows the off-by-one is not material, but it means a signal that should read 'overdue' on the exact deadline day will read d=0 and be evaluated as 'soon' (d < 0 is false when d === 0). The severity is low because one-day differences in long windows are advisory-only.

---

## ✗ Cross-cutting: wiring/parity/i18n

### 🟠 HIGH · 🔧 code-fix · _connected_ — Owner-facing /app/estoppel and /app/collections pages are orphaned — no inbound link from any nav or app page
- **Where:** `app/app/estoppel/page.tsx:4,99-100 and app/app/collections/page.tsx:4,132-133`
- **Detail:** The owner-facing estoppel certificate status page (/app/estoppel) and the owner-facing collections/payment-plan view (/app/collections) have no inbound links anywhere in the resident app. The resident nav (app/app/layout.tsx NAV array) has five items (Home, Easy Track, Easy Voice, Easy Documents, Easy Schedule) — neither estoppel nor collections appears. Neither is linked from the track page, the home page, or anywhere else in app/app/. Both pages carry explicit stale comments acknowledging this: 'not yet wired into the rail / Easy Track tabs'. This means a resident can only reach these pages by typing the URL directly, effectively making them invisible to all but technically sophisticated users who know to look.
- **Suggested fix:** Wire /app/estoppel into the Easy Track tab (or resident nav) so owners can check their estoppel certificate status and track the fee clock. Wire /app/collections (or its relevant sub-sections) similarly, potentially as a tab on the Easy Track page or a card on the Home page showing 'Account standing'. The pages are complete and functional — only the nav entry point is missing.

### 🟡 MEDIUM · 🔧 code-fix · _connected_ — delinquencySignals producer is dashboard-only — neither cron sends a board notification
- **Where:** `app/admin/compliance/page.tsx:154, app/api/cron/collections-deadlines/route.ts:98-101, app/api/cron/compliance-scan/route.ts:119-137`
- **Detail:** The dashboard's gatherSignals() calls delinquencySignals(candidates) which surfaces delinquent owners who have no open collection case. The daily collections-deadlines cron (the natural home for this) imports delinquentOwnersWithoutCase but only uses it to auto-open cases when collections_auto_open=true; it never calls delinquencySignals() in the signals[] it digests. The weekly compliance-scan cron also omits this producer. So when collections_auto_open is OFF, delinquent-no-case owners appear on the compliance dashboard but board members who rely on automated digests receive no notification.
- **Suggested fix:** Add delinquencySignals to the collections-deadlines cron's signal array (it already has the delinquentOwnersWithoutCase candidates logic in scope when auto_open is true; extract that block to always run for signal generation even when auto_open is false). Or explicitly document in the cron comment that delinquency-without-case alerts are dashboard-only and boards must check the dashboard directly.

### 🟡 MEDIUM · 🔧 code-fix · _connected_ — /admin/arc nav tab activates 'Easy Voice', not 'Compliance', when reached from the compliance dashboard workspace card
- **Where:** `app/admin/layout.tsx:37,44 and app/admin/compliance/page.tsx:83`
- **Detail:** The compliance dashboard WORKSPACES array links to '/admin/arc' (page.tsx line 83, label 'Architectural review'). The admin nav compliance item's match array (layout.tsx line 37) lists ['/admin/estoppel', '/admin/collections', '/admin/structural', '/admin/financials', '/admin/governance', '/admin/enforcement', '/admin/meetings', '/admin/elections', '/admin/insurance', '/admin/contracts', '/admin/advisories'] — '/admin/arc' is absent. The Easy Voice nav item's match array (layout.tsx line 44) includes '/admin/arc'. Result: clicking 'Architectural review' from the compliance workspace highlights 'Easy Voice' in the nav, not 'Compliance'. Additionally, /admin/arc has no ComplianceBackLink (every other compliance workspace — estoppel, collections, financials, governance, enforcement, meetings, elections, structural, insurance, contracts, advisories — imports and renders ComplianceBackLink; arc/page.tsx does not).
- **Suggested fix:** Add '/admin/arc' to the compliance nav match array in layout.tsx line 37, and remove it from the easyVoice match array (or keep it in both to allow dual-activation, since arc genuinely belongs to both). Add `import { ComplianceBackLink } from '../ComplianceBackLink'` and render `<ComplianceBackLink />` in the admin arc page, consistent with all other compliance workspace pages.

### ⚪ LOW · 🔧 code-fix · _connected_ — Six admin i18n keys exist in en.ts but are absent from both es.ts and pt.ts
- **Where:** `lib/i18n/en.ts:2024-2026,2036,3083,3126 vs lib/i18n/es.ts and lib/i18n/pt.ts`
- **Detail:** The following six admin-namespace keys are defined in en.ts but missing from both es.ts and pt.ts: admin.documents.bulkUploadHint (documents/page.tsx line 859), admin.documents.cancelBtn (documents/page.tsx lines 747,867 and violations/page.tsx line 379), admin.documents.ruleSaveBtn (documents/page.tsx line 670), admin.documents.ruleSavingBtn (documents/page.tsx line 670), admin.requests.backToList (requests/page.tsx line 681), admin.residents.scrollMore (residents/page.tsx line 640). The i18n system's fallback chain (dict[key] ?? en[key] ?? key, index.tsx line 40) means these render as English in Spanish and Portuguese locales rather than crashing or showing raw keys. No compliance domain keys are affected — the gap is in shared admin UI widgets (documents, requests, residents).
- **Suggested fix:** Add the six missing keys to both lib/i18n/es.ts and lib/i18n/pt.ts with appropriate translations. The English values are: bulkUploadHint = 'Adding several?\nUpload them all at once.', cancelBtn = 'Cancel', ruleSaveBtn = 'Save changes', ruleSavingBtn = 'Saving…', backToList = 'Messages', scrollMore = 'More →'.

### ⚪ LOW · 🔧 code-fix · _connected_ — Stale comment in /app/arc/page.tsx says it is 'NOT yet wired into the Easy Voice hub tabs' when it actually is
- **Where:** `app/app/arc/page.tsx:4-5 and app/app/voice/page.tsx:10,100`
- **Detail:** The owner ARC page (app/app/arc/page.tsx line 4) carries the comment 'route (NOT yet wired into the Easy Voice hub tabs / left rail — see the one-line wire-up note at the bottom of this file)'. However app/app/voice/page.tsx line 10 imports it as `import ArcView from '../arc/page'` and line 100 renders it as `{tab === 'architectural' && !isTenant && <ArcView />}` inside the 'architectural' tab. The page is fully wired and reachable via the 'Architectural' tab on /app/voice — the comment is stale. This is purely documentary noise, not a functional bug.
- **Suggested fix:** Update the comment in app/app/arc/page.tsx header to reflect that the page is now embedded as the 'architectural' tab in /app/voice. Remove the 'Wire-up when ready' note at the bottom of the arc page (line 313-317).

### ⚪ LOW · 🔧 code-fix · _connected_ — Weekly compliance-scan cron queries ev_collection_cases serially per community, making it significantly slower than the parallel-batch dashboard
- **Where:** `app/api/cron/compliance-scan/route.ts:86-118`
- **Detail:** The compliance-scan cron fetches ~22 tables per community using sequential `const x = await safe(...)` calls inside a `for (const c of comms)` loop. On a platform with many communities, this is O(communities × tables) serial round-trips. The dashboard (page.tsx lines 229-249) uses a single Promise.all() with ~32 concurrent selects, waiting only for the slowest one. For a single community this is a minor performance difference; across many communities the cron accumulates significant latency per run. This is not a correctness bug but is worth noting as the cron may time out under load.
- **Suggested fix:** Refactor the per-community fetch block in compliance-scan to use Promise.all() analogously to the dashboard, grouping all safe() calls for a community into a single concurrent batch before passing them to the signal producers.

---

## ✗ Cross-cutting: statutory completeness

### 🟠 HIGH · 🏗️ build · _complete_ — Continuing-education hour constants defined but produce no compliance signal
- **Where:** `/Users/fernandosantamarta/Residente/lib/compliance/governance.ts:56-62`
- **Detail:** CONDO_CE_HOURS_PER_YEAR (1 hr/yr, FS 718.112(2)(d)4) and HOA_CE_HOURS (4/8 hr, FS 720.3033(1)) and HOA_CE_LARGE_PARCELS (2,500) are exported constants that appear nowhere else in the codebase — they are never read by governanceSignals() or any other producer. The DirectorCertRow has a `hours` field, but no code path checks whether accumulated CE hours meet the required total. The 7-year condo / 4-year HOA recertification clock fires correctly, but there is no check that the director has logged the required ongoing CE hours during that window.
- **Suggested fix:** In governanceSignals(), for each director with cert rows of kind='continuing', sum the `hours` field over the current certification window. For condo compare to CONDO_CE_HOURS_PER_YEAR.value × years_in_window; for HOA compare to HOA_CE_HOURS.value[parcelCount > HOA_CE_LARGE_PARCELS.value ? 'large' : 'small']. Emit a 'soon'/'overdue' signal when the director is within 12 months of the cert-renewal date but hours are short.

### 🟠 HIGH · 🏗️ build · _complete_ — Insurance domain omits windstorm/flood coverage obligation and named-storm deductible disclosure (FS 718.111(11)(a))
- **Where:** `/Users/fernandosantamarta/Residente/lib/compliance/insurance.ts:1-361`
- **Detail:** FS 718.111(11)(a) requires a condo to maintain adequate property insurance, including windstorm/hurricane coverage where applicable, and FS 718.111(11)(c) (as amended by HB 913) requires the association to disclose the named-storm deductible to unit owners annually. The current InsurancePolicyRow shape and insuranceSignals() producer handle only two policy kinds — 'property' and 'fidelity_bond'. There is no kind='windstorm' or kind='flood', no field for named-storm deductible amount, and no signal that fires when the annual deductible disclosure has not been sent. The 36-month replacement-cost appraisal clock only fires for the generic 'property' policy, so a community that enters a separate windstorm policy without a property policy would never see the appraisal clock.
- **Suggested fix:** Add InsuranceKind values 'windstorm' and 'flood'. Add named_storm_deductible?: number | null and annual_deductible_notice_sent_at?: string | null to InsurancePolicyRow. In insuranceSignals() for condo: (1) flag if no windstorm policy is on file (severity 'soon', FS 718.111(11)(a)); (2) if a windstorm policy with a named-storm deductible is on file and annual_deductible_notice_sent_at is null or > 12 months ago, emit a 'soon' signal for the annual deductible disclosure to owners.

### 🟡 MEDIUM · 🏗️ build · _complete_ — Condo voting-suspension 30-day proof-of-obligation and 90-day pre-election notice are advisory text only — no timed signals
- **Where:** `/Users/fernandosantamarta/Residente/lib/compliance/enforcement.ts:88-93 and 660-668`
- **Detail:** FS 718.303(5) imposes two condo-specific procedural duties before a voting suspension: (a) proof of the obligation must reach the owner at least 30 days before the suspension takes effect, and (b) at least 90 days before an election the association must notify all owners that nonpayment may suspend voting rights. VOTING_SUSPENSION_PROOF_DAYS and VOTING_SUSPENSION_ELECTION_NOTICE_DAYS are correctly defined as rules. However, they are referenced only inside the detail string of the aggregate votingSuspensionSignals() info signal — not as independent deadline clocks. The 30-day proof notice is never tracked against an actual suspension row's start date, and the 90-day pre-election election notice is never correlated with an ElectionRow.
- **Suggested fix:** In suspensionSignals(), for each active condo voting-rights suspension, check suspension.started_at: if started_at is set and no 'proof notice sent' flag exists on the row, emit a 'soon'/'overdue' signal 30 days before started_at. Separately, in electionsSignals() or votingSuspensionSignals(), cross-reference upcoming ElectionRows: if an election is within 90 days and no pre-election delinquency-notice has been recorded for the community, emit an advisory signal citing FS 718.303(5).

### 🟡 MEDIUM · 🏗️ build · _complete_ — Procurement domain does not implement FS 720.309 HOA manager-contract fairness and cancellation-on-sale duties
- **Where:** `/Users/fernandosantamarta/Residente/lib/compliance/contracts.ts:1-267`
- **Detail:** The contracts.ts module header explicitly acknowledges FS 720.309 as a 'HOA contract duty' in the attorney-review doc but does not implement it. FS 720.309 requires that an HOA management contract (and contracts generally) must not contain provisions that are unfair or deceptive, and certain contracts must allow cancellation by unit purchasers (on transfer of ownership). The HOA_MANAGER_BID_TERM_MAX_YEARS constant (up to 3 years for competitively-bid HOA manager contracts, FS 720.3055(2)(a)2) is defined but is never checked against ContractRow.term_months — a contract with term_months > 36 does not trigger a signal.
- **Suggested fix:** In contractsSignals(), for HOA regime and contract_kind==='management': if Number(c.term_months) > HOA_MANAGER_BID_TERM_MAX_YEARS.value * 12 and c.bids_obtained, emit an 'info' signal noting the 3-year term cap for bid-awarded manager contracts. Separately, add a note in the doc row about FS 720.309 cancellation rights and emit an advisory 'info' signal for management contracts that do not have a cancellation-clause attestation recorded.

### 🟡 MEDIUM · 🔧 code-fix · _connected_ — Weekly cron digest omits collections, payment-plan, delinquency, and setup signals present in the admin dashboard
- **Where:** `/Users/fernandosantamarta/Residente/app/api/cron/compliance-scan/route.ts:119-137`
- **Detail:** The admin dashboard's gatherSignals() includes setupSignals, collectionsSignals, paymentPlanSignals, delinquencySignals, and delinquentOwnersWithoutCase. The weekly cron does not import or call any of these. A community with multiple overdue collection ladders or outstanding payment-plan defaults would see those signals on the dashboard but they would never appear in the weekly board digest email. This is a silent mismatch — the cron comment says it 'recomputes the same Monitor signals the /admin/compliance dashboard shows', which is not accurate.
- **Suggested fix:** Import collectionsSignals, paymentPlanSignals, delinquencySignals, delinquentOwnersWithoutCase, and setupSignals into the cron. Fetch ev_payment_plans, residents, and payments per community (already fetched in the dashboard). Add them to the sortSignals([...]) call. Update the cron comment to stop claiming equivalence until the sets match.

### ⚪ LOW · ⚖️ counsel · _complete_ — No signal fires when a condo voting-rights suspension should be lifted after the debt falls below $1,000
- **Where:** `/Users/fernandosantamarta/Residente/lib/compliance/enforcement.ts:550-582`
- **Detail:** suspensionSignals() correctly flags a rule-violation use-rights suspension that lacks its required committee hearing. However, for a condo voting-rights suspension triggered by >$1,000 AND >90 days delinquent (FS 718.303(5)), there is no signal that fires if the resident makes a partial payment that reduces the balance below $1,000. The statute requires the suspension to lift once the debt is 'paid in full' but the condo voting-suspension requires the balance exceed $1,000 as a continuing condition. The VOTING_SUSPENSION_MONETARY_FLOOR constant is only checked at the candidate-detection stage (votingSuspensionCandidates), not to trigger a 'lift this suspension' advisory on active suspension rows.
- **Suggested fix:** In suspensionSignals(), for an active condo suspension with rights='voting' or rights='both', if amount_owed is present and amount_owed <= VOTING_SUSPENSION_MONETARY_FLOOR.value, emit a 'soon' advisory: 'The balance has dropped below $1,000 — the condo voting-rights suspension basis may no longer be met; confirm with counsel and consider lifting the suspension.'

### ⚪ LOW · ⚖️ counsel · _complete_ — Term-limit gap count algorithm uses a fixed 2.5-year gap heuristic rather than explicit term-end dates, risking false positives or misses for directors with unusual gaps
- **Where:** `/Users/fernandosantamarta/Residente/lib/compliance/governance.ts:152-173`
- **Detail:** consecutiveServiceYears() determines unbroken service by walking backward through sorted term_start dates and treating any gap <= 2.5 years as 'continuous'. This covers annual and 2-year terms but can over-count if a director had a 2-year gap followed by a return, or under-count if term_end is not stored and a term was genuinely short. The BoardTermRow has term_end but consecutiveServiceYears() ignores it entirely, using only term_start. FS 718.112(2)(d)2 specifies 'consecutive years of service', which is more accurately computed as the total span of overlapping or abutting [term_start, term_end] intervals.
- **Suggested fix:** Accept termStarts AND termEnds (parallel arrays). Build intervals [term_start, term_end ?? now]. Sort by start. Merge overlapping/abutting intervals (treat abutting as within 30 days to accommodate re-election timing). Sum the merged interval durations, clamping to TERM_LIMIT_COUNT_SINCE. This directly computes 'years of consecutive board service' with no magic constant.

### ⚪ LOW · ⚖️ counsel · _works_ — SIRS waiver-prohibited check uses calendarDaysUntil() <= 0 which fires on the prohibition date itself, one day too early
- **Where:** `/Users/fernandosantamarta/Residente/lib/compliance/financials.ts:358`
- **Detail:** The statute text is 'budgets adopted on/after 2024-12-31'. The code uses calendarDaysUntil(SIRS_WAIVER_PROHIBITED_SINCE.value, now) <= 0, where calendarDaysUntil returns 0 when now equals the prohibition date. This means the signal fires on 2024-12-31 itself, which is correct. However, when used with 'on/after', the boundary condition is inclusive, and <= 0 is semantically 'on or after the date' — this is actually correct behavior. The same pattern appears in waiverProhibited. No bug, but the comment 'on/after the date' in the code is accurate.
- **Suggested fix:** No change needed — the logic is correct. Add a brief inline comment confirming '<= 0 includes the prohibition date itself (on/after semantics)' for future clarity.

---

## ✗ Cross-cutting: security/RLS/permissions

### 🟠 HIGH · 🔧 code-fix · _works_ — Enforcement admin workspace writes zero audit events despite 7 defined enforcement event types
- **Where:** `/Users/fernandosantamarta/Residente/app/admin/enforcement/page.tsx:1-864`
- **Detail:** The enforcement page is the board's tool for proposing fines, sending 14-day hearing notices, recording committee decisions, levying fines, and recording or lifting voting/use-rights suspensions. The lib/audit.ts AuditEventType union defines 7 enforcement events: enforcement.fine_proposed, enforcement.hearing_noticed, enforcement.hearing_decided, enforcement.fine_levied, enforcement.committee_updated, enforcement.suspension_recorded, enforcement.suspension_lifted. The page imports no logAudit and never calls it. Every mutating action — committee member add/remove, hearing notice, hearing decision, suspension activate/lift — goes unlogged. The audit trail is the board's statutory paper trail for the fine and suspension process; this gap means there is no application-level record of who took which enforcement action and when.
- **Suggested fix:** Import logAudit from '@/lib/audit' in enforcement/page.tsx and add a call after every successful Supabase write: logAudit({ community_id, event_type: 'enforcement.committee_updated', target_type: 'fining_committee_member', target_id }) after committee changes; enforcement.hearing_noticed / enforcement.hearing_decided after hearing upserts; enforcement.fine_proposed / enforcement.fine_levied after violation stage changes; enforcement.suspension_recorded / enforcement.suspension_lifted after suspension status changes. Mirror the pattern used by every other compliance workspace page.

### 🟡 MEDIUM · 🔧 code-fix · _works_ — Admin compliance pages have no server-side auth guard — role gate is client-side only
- **Where:** `/Users/fernandosantamarta/Residente/app/admin/layout.tsx:211-220`
- **Detail:** The only protection for every /admin/* compliance page is a useEffect in the 'use client' layout that calls router.replace('/app') after hydration when the user lacks permissions. The page JavaScript, component tree, and initial data fetches all execute before this redirect fires. There is no Next.js middleware.ts or server component wrapping /admin that would block unauthenticated or under-privileged requests at the HTTP layer. A user who obtains a valid session token (any community member, including residents) can call the Supabase queries that safeSelect() fires from the compliance dashboard before the redirect redirects them away. RLS on ev_* tables limits what data those queries actually return, so no cross-community data leaks, but a resident can observe their own community's compliance signals client-side before being bounced.
- **Suggested fix:** Add a Next.js middleware.ts at the project root that checks for a valid Supabase session cookie and redirects unauthenticated requests to /login for all /admin/* paths. For role enforcement a server component wrapper page.tsx at app/admin/_guard/page.tsx (or a route group with a server layout) can read the Supabase server-side session and return a 403 before any client hydration. This is a defence-in-depth measure; the current RLS posture already prevents data exfiltration.

### 🟡 MEDIUM · 🔧 code-fix · _works_ — Three audit event types used in residents/page.tsx are not members of AuditEventType union
- **Where:** `/Users/fernandosantamarta/Residente/app/admin/residents/page.tsx:194,204,224,286`
- **Detail:** The residents admin page calls logAudit with event_type values 'tenant.approved', 'tenant.rejected', 'tenant.removed', and 'home.transferred'. None of these strings appear in the AuditEventType union in lib/audit.ts. TypeScript should flag these as type errors, but if the build passes (perhaps due to a type assertion or the union being widened elsewhere), the rows either insert with an unrecognised event_type string into ev_audit_log — bypassing any DB-level CHECK constraint on that column — or are silently rejected. Either outcome means the audit log is unreliable for these resident-management actions.
- **Suggested fix:** Add 'tenant.approved' | 'tenant.rejected' | 'tenant.removed' | 'home.transferred' to the AuditEventType union in lib/audit.ts (these are logically distinct from the resident self-signup flow). Then run tsc --noEmit to surface any remaining type mismatches. Alternatively, map tenant approval/rejection to the existing 'resident.approved' / 'resident.rejected' event types with a metadata flag { tenant: true } and drop the unregistered strings.

### ⚪ LOW · 🔧 code-fix · _connected_ — Owner-facing compliance pages (/app/estoppel, /app/collections, /app/enforcement, /app/arc, /app/meetings) are not reachable from the resident rail nav
- **Where:** `/Users/fernandosantamarta/Residente/app/app/layout.tsx:38-44`
- **Detail:** All five resident-facing compliance pages carry a comment like '── Wire-up when ready ── Left rail or Easy Track tab: { href: '/app/estoppel', … }. Reachable directly at /app/estoppel until then.' They are accessible by direct URL but not discoverable from the nav rail, Easy Track tabs, or any other in-app link. Owners who receive a personal notice for an estoppel update, a collection case, or a hearing notice are pointed back to 'the Contact tab' but have no obvious path to the dedicated pages. This is a discoverability gap, not a data-isolation bug.
- **Suggested fix:** Add nav entries for these five pages to the NAV array in app/app/layout.tsx (or surface them as Easy Track / Easy Voice hub sub-tabs as noted in each file). At minimum, update the personal-notice body text for estoppel_update, collections_update, and hearing notices to include the direct URL so owners can navigate without guessing.

### ⚪ LOW · 🔧 code-fix · _works_ — collections-deadlines cron auto-opens collection cases without logging collection.case_opened audit events
- **Where:** `/Users/fernandosantamarta/Residente/app/api/cron/collections-deadlines/route.ts:80-93`
- **Detail:** When collections_auto_open is enabled, the cron inserts rows directly into ev_collection_cases without calling logAudit. The AuditEventType union defines 'collection.case_opened' for exactly this action. Since the cron runs server-side with the service role it cannot call the client-side logAudit helper, but there is no server-side equivalent audit write. Cases opened automatically have no audit trail entry to distinguish them from manually opened cases (the notes field carries a human-readable string but that is not audit-structured).
- **Suggested fix:** After each successful auto-open insert, write an ev_audit_log row directly via the service-role client: await admin.from('ev_audit_log').insert({ community_id: c.id, event_type: 'collection.case_opened', target_type: 'collection_case', target_id: ins.id, metadata: { auto: true, months_late: cand.months_late } }). Mirror the pattern to the collections list page when the board manually opens a case (app/admin/collections/page.tsx line 108/180 also has no logAudit call for the case-open insert).

### ⚪ LOW · 🔧 code-fix · _works_ — Admin layout role gate does not handle the permLoading race: page content may flash before redirect
- **Where:** `/Users/fernandosantamarta/Residente/app/admin/layout.tsx:211-222`
- **Detail:** The gate useEffect returns early while permLoading is true (line 214), so a user with no permissions sees the full admin layout — nav, header, child page content — until usePermissions resolves. On slow connections or cold starts this can be several hundred milliseconds. The 'if (hasSupabase && !session) return null' guard (line 222) suppresses a flash for unauthenticated users, but there is no equivalent null/spinner return for 'permLoading || !hasAccess'. The compliance dashboard content (stat tiles, signal rows, workspace cards) starts loading in the background during this window.
- **Suggested fix:** Add an early return after the session null-check: if (permLoading) return <LoadingSpinner /> — this prevents the child page from mounting and initiating its Supabase queries while perms are still resolving. Similarly add if (!isPlatformAdmin && perms !== null && perms.length === 0) return null (or a redirect-in-progress spinner) so the compliance page content never renders for a user who will be redirected.

---

