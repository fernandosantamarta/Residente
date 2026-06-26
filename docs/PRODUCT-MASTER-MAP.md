# Residente — Product Master Map

*The single source of truth for what the product does, who uses each part, what manual work it kills, and how to pitch it. Built to be studied front-to-back so you know the product cold — and reused as the feature list for the site, deck, and demo.*

*Generated 2026-06-24 from the live codebase (`app/app/*`, `app/admin/*`) + `STRATEGY.md` + `gtm/scripts.md`. Pitch lines stay general and UPL-safe: "educational, not legal advice — consult your association's attorney." Updated 2026-06-25: added the **AI assist layer** (spine #6 + its own section + a demo beat) — the upload-and-review AI now spanning the whole board cockpit, metered and $5/community-capped.*

---

## 0. The product in one breath

> **Residente is the owner-verifiable HOA/condo platform — built for residents, run on the law.** Self-managing a Florida community used to be a second job. Residente does ~95% of the administrative work, so a volunteer board runs everything in a couple hours a month. Every resident sees **exactly where every dollar of their dues goes, line by line — and votes in an election no one can rig.** Residents are always free; the board pays from $29/mo.

**Three levers (memorize the order, reorder by who you're talking to):**
1. **Self-management made easy** — the spine. "All the work, 95% less time." *The reason to buy and stay.*
2. **Compliance (fear → calm authority)** — the 2026 Florida laws. *The subject line, not the product.*
3. **Transparency (money-first)** — "see where every dollar goes" + the un-riggable vote. *The resident hook that warms outbound.*

**The AI assist layer (new — spans the whole cockpit):** on almost any board screen you upload a document or photo — a roster, opening balances, a budget, an insurance dec page, the CC&Rs, meeting minutes, a violation photo, an ARC submission, an event flyer, an amenities list — and AI reads it, fills in the structured data (or drafts the reply/decision), and the board reviews before saving. It turns the product's most time-consuming data entry into an *upload*. **Board-assist by design: AI suggests, the board decides — nothing auto-sends or auto-decides.** Metered and **capped at $5/community/mo** (with an owner-only kill switch + usage breakdown in the Platform Console). *Pitch: "Upload your existing paperwork — AI sets you up and keeps you moving."*

---

## 1. The two surfaces + the spine

The product has **two front doors** and a set of **cross-cutting systems** that span both. Understand these six spine systems and the rest of the map clicks into place.

| Surface | Who | Root route | What it is |
|---|---|---|---|
| **Resident cockpit** | Homeowners / tenants | `app/app/` | The money view + pay + vote + docs. Free, always. |
| **Board / manager cockpit** | Board members, CAM | `app/admin/` | The whole back office: compliance, money, governance, property. The paid product. |

**The 6 spine systems (the differentiators — these are what you actually sell):**

1. **The compliance signal engine** (`app/admin/compliance`) — every other module emits statutory "signals" (deadlines, gaps) that aggregate into one prioritized **Needs Attention** list, grouped into three domains: **Money · Governance · Property**. This is the "every FL 718/720 deadline tied to its statute, on one screen" demo moment.
2. **The money rails** — money-IN via **Stripe Connect** (dues, fines, estoppel fees; zero markup to residents) + **Plaid** bank feed reading actual spend into the **budget/GL**. "Link, don't hold." Powers the resident money view *and* the board's reconciliation.
3. **The three "Easy" hubs** — the resident IA is consolidated into three tabbed hubs (many old routes are now redirects into them):
   - **Easy Track** (`app/app/track`) = Pay + Vendor + Reports
   - **Easy Voice** (`app/app/voice`) = Board decisions + Voting + ARC + Contact
   - **Easy Documents** (`app/app/documents`) = Rules + Governing docs + My Violations
4. **Operator-blind voting** (`app/app/voice` → vote, public verify at `app/verify/[voteId]`) — secret-ballot voting + elections the platform mathematically can't read, with per-voter tracking codes. **"The vote they can't rig. No competitor ships this."**
5. **Roles & permissions** (`app/admin/board` / `app/admin/roles`) — custom roles with granular scopes so a board can delegate without handing over the keys.
6. **AI document reading (board-assist)** — one metered engine (`supabase/functions/extract-doc`, Claude vision) behind an "upload → AI fills it in → board reviews → save" flow on almost every board screen. Reads a PDF *or* photo (any layout). **$5/community/mo cap enforced in code** + an owner-only **AI Insights** tab in the Platform Console (spend by community, by document type, with a per-community kill switch). See "The AI assist layer" section below for the full surface list. **"Upload your existing paperwork — AI does the typing."**

---

## 2. RESIDENT modules (`app/app/`) — what every owner sees

> Resident pitch hooks (money-first): *"See exactly where every dollar of your dues goes."* · *"Your $300 a month — finally, line by line."* · *"A board vote nobody can rig."*

### The 4 that matter (lead the resident story here)

**🏠 Home / cockpit — `app/app/` (root)**
- **What:** the resident dashboard — unit balance, community budget pace + reserves, dues broken down by category/vendor, open votes, and quick actions (pay, request, contact board, calendar).
- **Replaces:** the resident having no idea where dues go; calling/emailing the board for basic info.
- **Statute:** FS 720.3085(8) (tenant rent demand); general 718/720 financial transparency.
- **Pitch:** *"The first thing every owner sees: where the money goes, and what needs their vote."*

**💳 Easy Track / Pay — `app/app/track`** *(old `pay`, `vendor`, `reports` redirect here)*
- **What:** balance due + pay by card or ACH (Stripe), saved methods, payment history; plus active vendor contracts and board-published financial reports.
- **Replaces:** the board chasing checks; a lockbox; "where's my receipt" emails.
- **Statute:** —
- **Pitch:** *"Residents pay dues in 30 seconds — zero markup — and you stop being a collections agency."*

**🗳️ Easy Voice / Vote — `app/app/voice`** *(old `board`, `contact` redirect here)*
- **What:** board-decision feed, cast votes on open motions (live tally + close date), submit ARC requests, and message the board (requests, rule proposals, Q&A) with reply tracking.
- **Replaces:** paper ballots, proxy spreadsheets, "did my vote count?", lost group-text requests.
- **Statute:** FS 720.3035 / 718.113(2) (ARC); FS 718.111(12)(c) / 720.303(5) (records).
- **Pitch:** *"A vote nobody can rig — and a direct line to the board that doesn't get lost."*

**📄 Easy Documents — `app/app/documents`** *(old `rules` redirects here)*
- **What:** three tabs — searchable Rules & Policies, the Governing Documents library (bylaws, budgets, insurance, minutes, ARC forms), and **My Violations** (open/closed fines with pay/appeal).
- **Replaces:** "can I get a copy of the bylaws?" emails; printed rule books; opaque fines.
- **Statute:** FS 718.111(12)(c) / 720.303(5) (records inspection right).
- **Pitch:** *"Every rule and record at their fingertips — and they can pay or appeal a fine in one place."*

### The supporting resident modules

| Module | What it does | Replaces | Pitch |
|---|---|---|---|
| **Home Vault** `app/app/home` | Personal store for property docs (deed, insurance, warranties, permits), with "conveys at sale" marking | A shoebox of papers; scrambling at closing | *"Your home's paperwork, organized — and it hands off to the buyer at sale."* |
| **Settings** `app/app/settings` | Profile, notification prefs + quiet hours, language (EN/ES/PT), vehicles/pets, emergency contacts, tenant requests, **home transfer** | Calling the board to update info | *"Owners manage their own info, tenants, and even the sale handoff."* |
| **Schedule** `app/app/schedule` | Community calendar (month/week/day, filterable) + iCal/Google export + amenity reservations | A bulletin board; clubhouse booking by text | *"The whole community calendar — and book the pool without the spreadsheet."* |
| **Meetings** `app/app/meetings` | Read-only meeting + election timeline (notice/agenda status, candidate deadlines, ballot window, recall status) | "When's the annual meeting?" emails | *"Every meeting and election date, with notices and minutes."* |
| **Enforcement** `app/app/enforcement` | Read-only view of the owner's violations, fines, hearings, and voting/use suspensions | Confusion about a fine's status | *"Total clarity on any violation — what, why, and what's next."* |
| **Collections** `app/app/collections` | Read-only view of the owner's collection case stage + amounts owed (principal/interest/fees) + payment plan | A scary attorney letter with no context | *"If an owner falls behind, they see exactly where they stand — and the path back."* |
| **Estoppel** `app/app/estoppel` | Read-only list of estoppel requests on the unit (date, fee, due date, delivery) | Title agents and owners in the dark at sale | *"Sale paperwork status, visible to the owner in real time."* |
| **Notifications** `app/app/notifications` | Searchable inbox of all board notices (meeting, payment, violation, policy), filterable, marks read | Missed emails, "I never got notice" | *"Every official notice in one searchable inbox — no more 'I never saw it.'"* |
| **Community** `app/app/community` | Editorial "magazine" view of community financial + governance highlights | A dry PDF nobody reads | *"The community's money story, made readable."* |

> **Note on IA:** `board`, `contact`, `pay`, `vendor`, `reports`, `rules` are now **thin redirect routes** into the three Easy hubs. If you see them in the URL bar, they're legacy entry points — the real screens are Track / Voice / Documents.

---

## 3. ADMIN modules (`app/admin/`) — the board's back office

Organized by the **three compliance domains** the dashboard itself uses (Money · Governance · Property), plus Money rails, Operations, and Setup. This is the order to learn them in.

### 🧭 The hub
| Module | What it does | Replaces | Statute | Pitch |
|---|---|---|---|---|
| **Dashboard** `app/admin` (root) | Onboarding progress ring, live stats, roster paste, doc upload, printable lobby QR poster | Manual setup checklists | — | *"Day one to live in an afternoon."* |
| **Compliance** `app/admin/compliance` | Aggregates statutory signals from every module into one prioritized **Needs Attention** list; readiness % + community health grade | A compliance calendar nobody maintains | inherited | **★ "Every FL 718/720 deadline, tied to its statute, on one screen."** |
| **Reports** `app/admin/reports` | Analytics: collection rate, delinquency aging, budget variance, violations, compliance status | Manual report-building in spreadsheets | — | *"Run the community by the numbers."* |

### 💰 Money domain
| Module | What it does | Replaces | Statute | Pitch |
|---|---|---|---|---|
| **Community** `app/admin/community` | Core settings: name/type/units, monthly dues, statutory interest APR (capped) + late-fee structure; live collection metrics | A settings spreadsheet, manual APR tables | FS 718.116(3), 720.3085(3) | *"Set dues and legal fees once — the math stays inside the statutory caps."* |
| **Collections** `app/admin/collections` | Walks the statutory ladder (30-day notice → intent-to-lien → lien → intent-to-foreclose → foreclosure); auto-surfaces delinquents | Attorney referral letters, lien paperwork tracking | FS 718.116/.121, 720.3085/.305 | *"Delinquencies handled by the book — every notice on the legal clock."* |
| **Billing** `app/admin/billing` | The board's own Residente subscription: home count → tier, add-ons, Stripe payment method in-app | Emailing support to change plans | — | *"Self-serve plan management — no support ticket."* |
| **Accounting** `app/admin/accounting` *(paid add-on)* | Bank reconciliation home: unmatched-txn count, Plaid status, GL + CPA exports | Manual bank-feed imports, ledger entry | — | *"Bank-grade books without a bookkeeper."* |
| **Budget** `app/admin/budget` | Annual budget + categories (shown on resident cards), Plaid actual-vs-budget tracking, manual expenses | Spreadsheet budgeting, statement reconciliation | — | *"Budget vs. actual, fed straight from the bank."* |
| **Financials** `app/admin/financials` | Required **audit tier** (cash/compiled/reviewed/audited) by revenue; reserve components + funding; annual filings (AFR, reserve study); Stripe Connect link | Accountant coordination, filing reminders | FS 718.111(13)/.112(2)(f), 720.303(6)–(7) | *"It tells you which financial report the law requires — before you're late."* |
| **Contracts** `app/admin/contracts` | Vendor-contract registry + competitive-bid threshold tracking + condo management required-terms attestation | Bid-threshold math, contract spreadsheets | FS 718.3026/.3025, 720.3055 | *"Procurement that proves you got the bids the law wants."* |

### 🏛️ Governance domain
| Module | What it does | Replaces | Statute | Pitch |
|---|---|---|---|---|
| **Voice (board)** `app/admin/voice` | Board-side of Easy Voice: create meetings, post agenda/minutes, run votes, send notices (in-app/email) with delivery stats | Email blasts, ballot/proxy spreadsheets | FS 718.112(2)(d), 720.306 | *"Run a meeting and a vote end-to-end — with proof of notice."* |
| **Meetings** `app/admin/meetings` | Calendar + notice clock (48-hr regular / 14-day annual) + agenda/minutes archive | Notice email chains, manual archiving | FS 718.112, 720.306 | *"Never blow a notice window again."* |
| **Elections** `app/admin/elections` | Election timeline (60/40/14–34-day milestones), ballot counts, quorum, **recall** intake + 5-business-day certify/arbitrate clock | Election-timeline spreadsheets, recall checklists | FS 718.112(2)(d), 720.306(9)–(10) | *"Elections and recalls on the statutory rails, with the notices generated."* |
| **Governance** `app/admin/governance` | Director term limits + eligibility flags, certifications (auto-expiry), **CAM licensing + disclosure posting**, conflict-of-interest register | Tracking cert expirations and conflicts by hand | FS 718.112(2)(d)/.1265/.3027, 720.3033, Ch.468 | *"Keeps directors certified, eligible, and conflict-clean."* |
| **Board** `app/admin/board` | Board roster + positions, **custom role builder** (permission matrix), committees, board-decision log | Roster spreadsheets, email committee threads | — | *"Who's on the board, who can do what, and every decision logged."* |
| **Roles** `app/admin/roles` | Custom non-admin roles with fine-grained permission scopes + holder caps *(merged into Board)* | Access-control spreadsheets | — | *"Delegate without handing over the keys."* |
| **Enforcement** `app/admin/enforcement` | Propose fines (capped/per-diem), stand up an **independent fining committee** (min 3), 14-day hearing notice, hold hearing, record outcome, suspensions, contested disputes | Fine letters, committee rosters, hearing notices | FS 718.303, 720.305/.3085 | *"Fines that survive a challenge — committee, notice, and hearing by the book."* |
| **Violations** `app/admin/violations` | Log warnings/fines, track appeals, resolve (paid/manual/waived/dismissed) | Violation spreadsheets | FS 718.303, 720.305 | *"Every warning and fine tracked to resolution."* |
| **ARC** `app/admin/arc` | Architectural review worklist + **statutory response-deadline tracking** (deemed-approval risk), decision letters, hurricane-spec adoption | ARC sheets, paper decision letters | FS 720.3035, 718.113(2)/(5) | *"Approve or deny on time — or the law approves it for you."* |
| **Documents** `app/admin/documents` | Editable rule book + official-records archive with **FL-required checklist** + posting status, plus records-inspection intake with 5/10-day clock | Printed rule books, records-request logs | FS 718.111(12)(g), 720.303(4)(b)/.306(1)(b) | **★ "Your records website — the 2026 mandate, handled."** |
| **Advisories** `app/admin/advisories` | Statutory event clock (turnover, receivership, invoice-method changes) + standing-rights reference + template generators | Manual deadline calendars, reference sheets | FS 718.1124, 720.3053/.3075 | *"The rare statutory events, tracked so you don't miss them."* |
| **Requests** `app/admin/requests` | Unified resident-request inbox (maintenance, records, disputes) with triage, assignment, templated replies, work orders | Email/ticket spreadsheets | — | *"Every resident ask in one mailbox — triaged and answered."* |
| **Support** `app/admin/support` | Board ↔ Residente support tickets, threaded with attachments | Email support | — | *"Help, in-product."* |

### 🏗️ Property domain
| Module | What it does | Replaces | Statute | Pitch |
|---|---|---|---|---|
| **Structural** `app/admin/structural` | Condo **SIRS / milestone** inspections, building records, reserve-component funding, DBPR division settings + filings | SIRS deadline tracking, inspection files | FS 718.112(2)(g), 718.2008 | *"The structural-safety deadlines that make headlines — tracked."* |
| **Insurance** `app/admin/insurance` | Property replacement-cost appraisal cycle (36-mo condo) + fidelity-bond coverage tracking | Insurance renewal spreadsheets | FS 718.112(2)(f), 720.303(5) | *"Appraisals and bonds, never expired by surprise."* |
| **Vendor** `app/admin/vendor` | Vendor registry (category, contact, cost, schedule) + featured-on-resident-Track + Vendor Guidelines PDF | Vendor master spreadsheet | — | *"Your trusted vendor list, surfaced to residents."* |
| **Schedule** `app/admin/schedule` | Event management (single + bulk CSV) + amenity definitions/refund policy + booking approvals | Manual calendar blocking, booking-approval emails | — | *"Run the calendar and amenities without the back-and-forth."* |
| **Advisories/Estoppel/Residents** | *(see below — cross-domain)* | | | |

### 📈 Sale / transfer + onboarding
| Module | What it does | Replaces | Statute | Pitch |
|---|---|---|---|---|
| **Estoppel** `app/admin/estoppel` | Log estoppel requests, track the statutory **business-day delivery clock** (standard/expedited), auto-waive fees if late, record delivery/refund | Manual estoppel files, fee math, $250 attorney/manager hours | FS 718.116(8), 720.30851 | **★ "Sell-side estoppel in minutes — and fees auto-waive if you're late, so you're never exposed."** |
| **Residents** `app/admin/residents` | Roster paste/CSV import, board positions, magic-link invites, **ownership transfer**, signup/tenant approvals | Manual list entry, email collection | — | *"Paste a spreadsheet, the whole community is live."* |
| **Setup** `app/admin/setup` | Guided onboarding wizard (board → residents → dues → docs → done) with saved progress | Unguided configuration | — | *"From signup to live in one guided pass."* |

> **★ = the demo-critical modules.** Compliance dashboard, the records website (admin/documents), and estoppel are the three that make boards lean forward.

---

## ✦ The AI assist layer — upload, review, save (cross-cutting)

One engine (`supabase/functions/extract-doc`, Claude vision), one pattern everywhere: **upload a document or photo → AI extracts the data or drafts the response → the board reviews → save.** Every surface is **board-assist** (AI suggests, the board decides — nothing auto-sends or auto-decides), trilingual (EN/ES/PT), and metered against the **$5/community/mo** cap.

| Surface | Board uploads… | AI produces (for review) |
|---|---|---|
| **Residents** (roster import) | a roster CSV / PDF / photo | owners + units + opening balances → editable review table |
| **Reports** (balances) | a balances CSV / PDF / photo | matched opening balances |
| **Budget** | a budget doc / photo | operating-budget categories |
| **Insurance** | a declaration page / certificate | carrier, policy #, coverage, dates, RCV → form prefill |
| **Documents → Rules** | the CC&Rs / bylaws PDF | individual rules + fees → review list |
| **Documents → Archive** | any governing doc | the right FL official-records category (auto-suggested on upload) |
| **Meetings → Minutes** | a signed-minutes PDF / photo | motions (movers, vote tally, outcome) + action items |
| **Enforcement** | a violation photo | matched rule + drafted notice — *and the photo is stored as case evidence* |
| **ARC** | the owner's submitted photo / plan | what's proposed, the relevant rule, a suggested decision + drafted response |
| **Requests inbox** | the resident's attached photo | the issue, the relevant rule, a drafted reply |
| **Schedule → Calendar** | an event flyer / newsletter / photo | community events → review → bulk add |
| **Schedule → Amenities** | an amenities list / rules / photo | bookable amenities → review → bulk add |

**Cost & control (Platform Console → AI Insights, owner-only):** per-community spend + an editable monthly cap, a one-click **Off** kill switch (cap → $0), a **"Where AI is used"** breakdown by document type, and an expandable **per-community drill-down** (what each community spent AI on, in cents + %). Realistic cost: pennies–$1/community/mo on Claude Haiku; a community **physically cannot exceed $5/mo** (the meter blocks further calls). Global off = unset the API key. *(Activates once `ANTHROPIC_API_KEY` is set in Supabase; until then every flow falls back to manual entry / CSV.)*

**Demo line:** *"Whatever paperwork the prior manager left you — a roster, a budget, the CC&Rs, even a photo of a violation — you upload it, AI does the typing, you just check it. That's the difference between a weekend of data entry and an afternoon."*

---

## 4. The 15-minute demo path (how the map becomes a pitch)

This is the demo script from `gtm/scripts.md`, now mapped to the exact screens to open:

1. **(2m) The money view** — resident `app/app/` cockpit + `app/app/track`. *"This is what every owner sees: spending vs. budget, reserves, where each dollar goes."* **Lead here — universal hook.**
2. **(2m) The board cockpit** — `app/admin` dashboard → `app/admin/collections` → `app/admin/documents` (the 2026 records website) → `app/admin/meetings`.
3. **(2m) AI does the setup** — `app/admin/residents` (upload a roster) → `app/admin/budget` → `app/admin/documents` (drop the CC&Rs). *"Upload whatever the prior manager left you — a roster, a budget, the bylaws, even a photo — AI fills it in and you just check it. The migration wall is gone."* **The "wow" that closes self-managed boards.**
4. **(3m) The deadline dashboard** — `app/admin/compliance`. *"Every FL 718/720 deadline tied to its statute, on one screen."*
5. **(2m) The vote they can't rig** — `app/app/voice` cast a vote → `app/verify/[voteId]`. *"We can't read it. No competitor ships this."*
6. **(2m) The 95/5** — be honest about the 5% (vendor coordination, physical inspections, specific legal interpretation).
7. **(3m) The close** — pricing (residents free, board $29/mo), free white-glove setup, founding-member lock.

---

## 4A. The demo, word for word (read this verbatim)

> **Setup:** share your screen, logged into a demo community with sample data. Target = a self-managed board officer (treasurer/president). ~15 min. Pause for questions — the script is a spine, not a cage. Don't read the stage directions *(in italics)* aloud.

**Open (30 sec) — frame the pain before the product.**
> "Before I show you anything — how are you running [Community] today? Spreadsheets, a binder, a property manager?" *(let them answer)* "Got it. The two things I hear most: it eats your nights and weekends, and you're never quite sure you're compliant with the new Florida laws. I'll show you how Residente takes about 95% of that off your plate. Residents use it free — the board's the only one who pays, from $29 a month. Let me start with what your owners see, because that part sells itself."

**Beat 1 — The money view (2 min). Lead here; it's the universal hook.**
> *Screens: resident cockpit `/app` → Easy Track `/app/track`.*
> "This is what every owner sees on their phone: their balance, pay in 30 seconds by card or bank — and the part nobody else does — *exactly* where their dues go. Spending vs. budget, reserves, line by line. When owners can see the money, the angry emails stop. On a volunteer board, transparency is your best friend."

**Beat 2 — The board cockpit (2 min).**
> *Screens: `/admin` dashboard → Collections → Documents → Meetings.*
> "Now your side — the back office a management company charges thousands a month for. Collections walks the legal ladder for you: 30-day notice, intent-to-lien, all of it on the statutory clock. Your records website — the thing the 2026 law now *requires* — it's just here. Meeting notices and minutes, tracked."

**Beat 3 — AI does the setup (2 min). ★ The moment that closes self-managed boards — slow down here.**
> *Screens: Residents (upload a roster) → Budget (upload a budget) → Documents (drop the CC&Rs).*
> "Here's the question everyone asks: 'this looks great, but moving all our stuff in sounds like a nightmare.' Watch. *(upload the roster)* This is the owner list the last manager handed us — a spreadsheet, a PDF, even a photo. AI reads it, pulls every owner, unit, and balance; I just check it and confirm. *(upload the budget)* Same with the budget. *(drop in the CC&Rs)* And my favorite — I drop in our CC&Rs and it pulls the rules right out into the rule book. The thing that scares boards off switching — the data entry — is gone. You upload what you already have; the AI does the typing."
> *(If they lean in, that's the buying signal. Let it land before you move on.)*

**Beat 4 — The deadline dashboard (3 min).**
> *Screen: `/admin/compliance`.*
> "This is the one that lets you sleep. Every Florida 718 and 720 deadline — reserves, inspections, elections, insurance — tied to its statute, in one prioritized list, telling you what's due *before* you're late. You're not hoping you're compliant. You can see it."

**Beat 5 — The vote they can't rig (2 min).**
> *Screens: `/app/voice` cast a vote → `/verify/[voteId]`.*
> "Elections are where communities tear themselves apart over trust. Owners vote here, secret ballot — and here's what no competitor has: the platform *mathematically cannot read the votes*, and every voter gets a code to verify their own vote counted, publicly. Nobody can rig it, and nobody can claim it was rigged."

**Beat 6 — The honest 5% (2 min).**
> "I won't tell you it does everything. The 5% it doesn't: physically coordinating a vendor on-site, walking the property for an inspection, and the judgment calls your attorney should make. Everything *administrative*, it does. So you keep your lawyer for the hard legal questions and drop the rest of the overhead."

**Beat 7 — The close (2 min).**
> "Pricing: residents are always free; the board pays from $29 a month — less than one hour of a management company. We do the white-glove setup with you, free, using exactly the AI upload you just saw. Founding communities lock their rate. Want me to set up [Community] right now, with your real data, so you can see it for yourself?"

**If they hesitate — the three lines that re-close:**
> - *Cost* → "It's a fraction of one management invoice, and residents never pay a cent."
> - *"We'll think about it"* → "Totally fair — let's just load your roster in two minutes so you're looking at your real community, not a demo."
> - *Compliance fear* → "That's exactly what the deadline dashboard is for — let's pull up your community and see what's actually due."

---

## 5. How to study this (get product-fluent in ~1 week)

You learn a product three ways, in this order. This doc is step 1.

1. **Read this map twice.** First pass: just the §0–§1 spine + the ★ modules. Second pass: every row. Goal — be able to name all ~50 modules and say one sentence about each.
2. **Walk the running app screen-by-screen** with this map open beside you (I can drive a guided screenshot tour). Seeing each screen turns the list into memory.
3. **Dogfood both personas.** Be a resident (pay a fee, cast + verify a vote, file an ARC). Then be the board (run compliance, generate an estoppel, send a meeting notice). You can't pitch what you haven't done.
4. **Teach it back.** Pitch each module out loud against this doc — I'll quiz you and correct against the real code. When you can do the §4 demo path cold, you know the product.

**Self-test checklist (you know it cold when you can answer these without looking):**
- [ ] What are the three resident "Easy" hubs, and which old routes fold into each?
- [ ] What are the three compliance domains, and name 3 modules in each?
- [ ] Which two systems make the vote un-riggable, and how do you prove it to a skeptic?
- [ ] How does money flow IN (Stripe Connect) vs. how spend is read (Plaid) — and where does each show up for the resident?
- [ ] Name the three ★ demo-critical modules and the one-line pitch for each.
- [ ] What's the honest 5% Residente does NOT do?
- [ ] Which modules satisfy the 2026 records-website mandate and SIRS deadlines?

---

*Keep this current: after shipping a module, add its row here (and run `graphify update .`). This file is both your study guide and the canonical feature list for the website, deck, and demo.*
