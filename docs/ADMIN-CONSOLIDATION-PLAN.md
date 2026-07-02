# Admin consolidation — dissolve Compliance into the everyday tabs

**Goal (Fernando, 2026-07-02):** the Compliance tab is a 13-workspace bucket that
duplicates work the everyday tabs already do. Fold every compliance feature into
Community / Budget / Easy Track / Easy Voice / Easy Documents / Easy Schedule so
the nav is just the basics, and statutory deadlines surface where the work
actually happens. Keep every existing URL alive (letters, bell notices, and
deep links point at them).

## What the audit found (2026-07-02)

The compliance dashboard (`/admin/compliance`, 516 lines) is read-only — stat
tiles + a deadline-sorted "needs attention" list computed from ~30 tables. It
links 13 workspaces (~12,000 lines total incl. detail/print routes). Overlaps
that make the section feel repetitive:

| Shared data | Compliance page | Everyday page | Nature |
|---|---|---|---|
| `ev_violations` | enforcement (1,003 ln) | violations log | SAME table; only enforcement can run hearings |
| `ev_collection_cases` | collections (556 + 1,435 ln) | violations (fine escalation), reports (Collect →) | same case rows |
| `ev_meetings` | meetings (439 ln) | voice (creates the meetings) | compliance page is a clock view over voice's rows |
| `budget_categories` | financials (474 ln), contracts (365 ln) | budget, reports | financials = reserves/filings; budget owns the lines |
| `ev_schedule_events` | structural (604 ln) writes them | schedule owns the calendar | inspection dates already flow into Easy Schedule |
| `documents` + `resident_requests` | "Official records" card | documents | the card IS `/admin/documents` — pure duplicate |
| `request-attachments`, `board_read_receipts` | arc (835 ln) | requests | ARC is already nav-matched under Easy Voice |

Self-contained (no everyday twin): estoppel (325), governance (495),
elections (566), advisories (297), insurance (422).

## Target nav

**AMENDED 2026-07-02 (Fernando):** the Compliance tab STAYS in the nav (next
to Budget) as the deadline dashboard. The consolidation is about wiring the
workspaces into the everyday tabs (WorkspaceLinks entry cards — shipped in
phase 1) and de-duplicating the flows (phases 2+), not deleting the tab.

## Where every workspace lands

| Workspace | New home | Merge depth |
|---|---|---|
| Dashboard stats + "needs attention" + AttorneyNote | **Overview** — a "Compliance health" card; each signal deep-links to the feature's new home | move |
| Enforcement (fines/hearings/suspensions) | **Easy Track → Violations** — violations log stays the single intake; per-fine "Start hearing process →" sets `enforcement_stage='proposed'`; committee/hearings/suspensions render as sections there; enforcement's duplicate "Propose a fine" form deleted | TRUE MERGE |
| Collections (+ case ladder) | **Easy Track** — tab next to Reports (which already links into it) | re-home |
| Estoppel | **Easy Track** — money/closing paperwork next to Collections | re-home |
| Contracts / procurement | **Easy Track → Vendors** — a "Contracts & bids" section on the vendor page | merge-lite |
| Meetings notice/minutes clocks | **Easy Voice → Meetings** — status chips + notice/minutes links on each meeting row (same `ev_meetings`); separate page retired | TRUE MERGE |
| Elections & recall | **Easy Voice** — tab beside Votes (timeline tracking complements ballots) | re-home |
| Governance (terms/certs/eligibility/managers/conflicts) | **Easy Voice → Board** — "Directors & records" section | re-home |
| ARC + hurricane specs | **Easy Voice** — already nav-matched there; just gets a visible tab | done-ish |
| Financials (reserves, filings, audit tier) | **Budget** — "Reserves & filings" sections under the budget editor | merge-lite |
| Structural / SIRS (condo-only) | **Community** — property section (buildings/inspections); events keep flowing to Easy Schedule | re-home |
| Insurance (appraisal + fidelity bond) | **Community** — association records section | re-home |
| Advisories (niche event clocks) | **Overview** — "Log a compliance event" popup inside the Compliance-health card | merge-lite |
| "Official records" card | delete — it already points at Easy Documents | delete |

## Phases (each shippable alone)

1. **Re-home the nav (zero-risk).** Move the 12 routes' `match` entries under
   their new tabs in `ADMIN_NAV`; add entry cards/tabs on each destination
   page; Overview gains the Compliance-health card (stats + needs-attention +
   advisories popup); Compliance tab removed, `/admin/compliance` redirects to
   `/admin#compliance`. No page internals change.
2. **Enforcement ↔ Violations unification** (the bug Fernando hit: log-created
   fines can't reach hearings). Bridge action + inline sections + delete the
   duplicate form.
3. **Meetings clocks into Easy Voice** (same-table merge) and **Financials
   into Budget**.
4. **Contracts into Vendors; Structural + Insurance into Community; Estoppel +
   Collections styled as Easy Track tabs; Elections + Governance as Easy Voice
   tabs.** Pages become sections/sub-tabs; URLs stay as deep links.
5. **Cleanup:** AdminSearch index, permission arrays (`anyPerm`) follow the
   content, i18n labels, retire dead nav keys.

## Cautions

- **Co-founders built several compliance slices and push to main** — sync with
  Andres/Dominic before phases 2–4 move their surfaces.
- Keep the AttorneyNote + statutory framing wherever content lands.
- Every `/admin/<workspace>` URL stays routable forever (letters + notices
  link there); only the nav highlight and page chrome change.
- Permissions: today one `compliance.manage`-ish gate covers the tab; after
  the split each destination needs the right `anyPerm` so custom roles keep
  working (roles memory: legacy board_member = full access).
