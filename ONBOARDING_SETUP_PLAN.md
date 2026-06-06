# Onboarding: upload-or-type setup

Goal: at signup (and re-runnable from /admin), a board can **drop their documents
and have Residente pre-fill the whole community** — settings, fines, dues, budget,
rules, residents — or **type it in manually**. This is the feature the Overview
mock already promises: *"Upload your docs — we pre-fill rules, fines & reserves."*

Guiding principle (locked earlier): **code does the maximum it can deterministically;
AI only finishes the fuzzy remainder; nothing goes live until the board confirms.**

---

## 1. The fork (UX)

A "Getting started" choice at the **entry to the document step** of the board /
management signup branch (flow today: community → plan → **documents** → details →
account). The same fork is also reachable from the admin Overview ("Upload your docs").

```
How do you want to set up <Community>?

┌─────────────────────────────┐   ┌─────────────────────────────┐
│  Upload your documents       │   │  I'll set it up myself      │
│  Drop your CC&Rs, budget,    │   │  Go step by step and type    │
│  and owner roster. We read   │   │  it in. (the current wizard) │
│  them and fill in your        │   │                              │
│  settings, fines, budget &    │   │                              │
│  residents — you just confirm.│   │                              │
└─────────────────────────────┘   └─────────────────────────────┘
```

- **Upload path** → the existing 8-category doc wizard, but each upload now feeds
  the extraction pipeline; ends on a **Review & confirm** screen of everything found.
- **Manual path** → the wizard exactly as it is today (confirm / upload / skip),
  settings typed later in /admin. No behavior change.

Both paths still write files to the `documents` vault (already built).

---

## 2. What each uploaded doc pre-fills

| Document | Fills (table / setting) | Lands on |
|---|---|---|
| Homeowner roster (CSV/Excel) | `residents` (+ invites) | Easy Track / cockpits |
| Annual budget | `budget_categories` + amounts; derive monthly dues | Community → Budget, Dues |
| Reserve study | reserve targets/components | Compliance → reserves |
| CC&Rs / Declaration / Bylaws | late-fee flat/%, interest APR, lien **address + officer**; rules | Community → Billing & compliance; Rules |
| Architectural / Pet / Rental policy | rules rows | Rules |
| Insurance declarations | policy info | Compliance → Insurance |
| Board roster | board members | Easy Voice → Board |

This is why **Billing & compliance stays on Community** (settings) — the upload just
pre-fills those same fields the board would otherwise type.

---

## 3. The pipeline (code-first, AI-last-mile)

```
upload → classify (what is this doc?)        CODE: filename/keywords · AI: fallback
       → extract text                         CSV: parse · PDF: text layer · scan: OCR
       → CODE extracts the deterministic bits  roster CSV → residents; budget CSV → categories
       → AI finishes the fuzzy bits            CC&Rs prose → fine %/interest/address/officer/rules
       → land in a STAGING / review state      nothing touches live tables yet
       → board REVIEW & CONFIRM                "found: $285 dues · 18% interest · $25 late fee
                                                · 142 residents · 38 rules — approve / edit"
       → commit to live tables                 communities settings · budget_categories ·
                                                residents (+invites) · rules
```

Properties:
- **Deterministic wins.** A clean roster/budget CSV imports with **no AI call** (free, reliable).
- **AI is the fallback**, and its output is always flagged for review (hallucination guard —
  this is a compliance product).
- **Graceful degrade.** If AI is down, cleanly-structured files still import; messy ones
  fall back to manual.

---

## 4. Build phases (honest sequencing)

- **Phase 0 — UI + deterministic (no AI infra needed).**
  The fork + upload/manual paths. CSV roster → `residents` + invites. CSV/clean budget →
  `budget_categories`. Review-and-confirm screen. Ships before any AI work.
- **Phase 1 — AI extraction.** Wire an Anthropic key into Supabase secrets + an
  `extract-setup` edge function. PDF text → Claude → settings / rules / budget / reserves.
  Feeds the same review screen.
- **Phase 2 — OCR + breadth.** Scanned PDFs (OCR first), more doc types, board roster.

Prereqs that don't exist yet (flagged earlier): **no AI infra in the repo** (no Anthropic
key, no LLM edge fn), and **no PDF/scan text extraction**. Phase 0 needs neither.

---

## 5. Vendors (related cleanup, separate task)

Vendors are a shared entity (Easy Track list + Compliance contracts + payments). The
Expense ledger's `vendor` field is free text today, so it duplicates. Fix: every vendor
**reference** (expense ledger, contracts, payments) becomes a **picker of the one
vendors list** (free-text fallback for one-offs). Vendor **management** stays in Easy
Track — it does NOT move to Community.

---

## 6. Open decisions for Fernando

1. Fork placement: confirm it's the entry to the **documents** step (vs a brand-new
   step 0 before community basics).
2. v1 extraction scope: suggest **budget + roster (deterministic) first**, then
   **CC&Rs → fines/rules (AI)**.
3. Review-before-commit: confirmed yes (compliance product).
4. Notes already persist to `community_setup_notes` (built) — the AI step can also read
   those, not just the docs.
