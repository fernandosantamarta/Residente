# Easy Voice — Master Plan

---

## Vision

Easy Voice is the transparency layer for community association governance. It replaces fragmented email chains, paper notices, mailed ballots, and disconnected Zoom calls with a single, legally compliant, resident-first platform for every meeting, document, and vote.

**Core principles:**
- Residents first: the experience is designed for owners, not administrators
- Legal by default: Florida compliance is baked in, not bolted on
- Minimal friction: every admin workflow should be faster than their current process
- Transparent: every resident can see exactly what their association is doing

---

## 1. User Roles & Permissions

### Role Hierarchy

| Role | Who They Are | What They Can Do |
|------|-------------|-----------------|
| **Owner** | Unit owner (resident or absentee) | View meetings, view documents, vote, receive notices, manage proxy |
| **Board Member** | Elected director, also an owner | Owner permissions + create meetings, upload documents (self-managed only) |
| **Admin** | Management company staff or self-managed board admin | Full admin: manage roster, create meetings, post documents, manage votes, send notices |
| **Platform Admin** | Resident (the company) staff | System-wide access, association onboarding |

### Key Permission Rules
- A person can hold multiple roles (e.g., board member who is also an owner — they act in both capacities)
- One account spans multiple associations (one login, workspace switcher between communities)
- One vote per unit regardless of how many co-owners share the account
- Renters: no account needed — owners receive all notices
- Delinquent owners: flagged as voting-ineligible (fed from Easy Pay — Phase 3)
- **Association owns their Resident account, not the management company.** When an association switches management companies, old company's admin access is revoked; new company is added. No data migration needed.

---

## 2. Architecture Overview

### Multi-Tenant Model
- Each association is a fully isolated tenant
- All data is scoped to an association — no cross-association data leakage possible (enforced at the database layer via Row Level Security)
- An owner who belongs to multiple associations sees a workspace switcher on login (like Slack)
- Management company staff are added as admins individually to each association they manage (Phase 1)
- Unified management company dashboard across all their associations: Phase 2

### Association Types Supported
- Condominium associations (governed by FL Statute 718)
- Homeowners associations (governed by FL Statute 720)
- The distinction is tracked per association and drives which compliance rules apply

---

## 3. Data Model

### Core Entities

**Association**
- id, name, type (`condo` | `hoa`), state, county, unit_count
- electronic_voting_resolution_adopted (bool) — required before electronic voting is active
- quorum_board_pct, quorum_member_pct (from bylaws; admin-configured)
- subscription_status

**Unit**
- id, association_id, unit_number, building (optional)

**Owner**
- id, unit_id, association_id, first_name, last_name, email, phone
- is_board_member (bool), board_role (`president` | `vp` | `treasurer` | `secretary` | `director`)
- is_admin (bool)
- electronic_voting_consent (bool), consent_date, consent_ip
- voting_eligible (bool) — overridable by delinquency flag from Easy Pay

**Meeting**
- id, association_id, type (`board` | `annual` | `special` | `committee`)
- title, scheduled_at, location, virtual_link
- status (`draft` | `notice_sent` | `in_progress` | `completed`)
- quorum_required_pct, quorum_confirmed (bool), quorum_confirmed_by, quorum_confirmed_at
- minutes_status (`pending` | `draft` | `published` | `approved`)

**Document**
- id, meeting_id, association_id
- type (`agenda` | `minutes` | `supporting` | `notice_record`)
- title, file_url, uploaded_by, uploaded_at
- status (`draft` | `published` | `approved`)

**Vote**
- id, meeting_id (nullable — written ballots may not be tied to a meeting), association_id
- title, description
- type (`resolution` | `election` | `budget_ratification` | `bylaw_amendment` | `special_assessment` | `other`)
- ballot_type (`open` | `secret`) — elections always `secret`, enforced
- mode (`in_meeting` | `written_ballot`)
- status (`draft` | `open` | `closed` | `tallied` | `published`)
- opens_at, closes_at
- result (`pass` | `fail` | `null`)

**Ballot** (one per eligible unit per vote)
- id, vote_id, unit_id, cast_by_owner_id (or proxy_id)
- answer (`yes` | `no` | `abstain`) — encrypted at rest for secret ballots; key released only after vote closes
- cast_at

**Proxy**
- id, grantor_owner_id, holder_name, holder_email
- type (`limited` | `general`)
- meeting_id
- specific_items (array of vote_ids — for limited proxy)
- specific_instructions (per vote_id: `yes` | `no` | `abstain` | `holder_discretion`)
- status (`submitted` | `verified` | `used` | `revoked`)
- submitted_at, revoked_at

**Notice** (record of every notice sent)
- id, meeting_id, association_id, sent_at, channels_used
- sent_by, delivery_report (per-owner delivery status)

**ElectronicVotingConsent** (immutable record)
- id, owner_id, association_id, consented_at, ip_address, user_agent

**AuditLog** (append-only, never modified)
- id, association_id, event_type, actor_id, target_type, target_id, metadata, created_at
- For votes: records WHO voted and WHEN — never HOW (secret ballot integrity)

---

## 4. Feature Modules

### 4.1 Association Setup & Owner Management

**Association Onboarding**
1. Resident (platform) staff creates the association record
2. First admin account created (management company rep or board president for self-managed)
3. Admin completes association profile: name, type, county, unit count, quorum percentages
4. Admin confirms whether board has adopted an electronic voting resolution (required by 718.128 / 720.317 before any electronic vote is valid)

**Roster Import**
- Admin uploads CSV/Excel: unit number, owner first name, last name, email, phone (optional)
- System validates: duplicate units, missing required fields, invalid emails
- System creates unit + owner records
- Invitation emails sent to each owner automatically

**Owner Onboarding Flow**
1. Owner clicks invitation link from email
2. Sets password
3. Reviews and accepts terms of service
4. **Electronic voting consent screen** — a distinct, prominent step (not buried in terms). Plain-English explanation of what consenting means. Owner clicks an affirmative "I consent to electronic voting" button. Timestamp + IP logged permanently.
5. Account active: owner can view meetings, documents, receive notices, and vote

**Ongoing Roster Management**
- Admin adds/edits/deactivates owners individually
- **Ownership transfer:** admin marks unit "sold," deactivates old owner (their login is revoked), creates new owner record. New owner receives invitation and goes through onboarding fresh — including new electronic voting consent.
- **Co-owners:** admin can add multiple owners to one unit. Each gets their own account for document access and notices. Vote is limited to one per unit: first ballot cast for a unit wins. If two co-owners both attempt to vote, second attempt is blocked with message: "A vote has already been cast for your unit."

---

### 4.2 Meeting Management

**Meeting Types**
- Board Meeting
- Annual Member Meeting
- Special Member Meeting
- Committee Meeting

**Meeting Lifecycle**
```
Draft → Notice Sent → In Progress → Completed
                                         ↓
                               Minutes Pending → Draft Minutes Published → Minutes Approved
```

**Creating a Meeting**
Admin fills out:
- Meeting type, date, time, timezone
- Physical location and/or virtual link (Zoom URL or other)
- App auto-displays: required notice period for this meeting type under Florida law

**Notice Management**
- Admin clicks "Publish & Send Notice" to move from Draft → Notice Sent
- If publishing with less than the legally required notice period: **warning banner** appears with the specific statute and deadline. Admin acknowledges and can proceed (they may have sent physical notice separately) or reschedule.
- Notices sent automatically across all enabled channels (email + SMS + in-app)
- Notice content: meeting type, date/time, location, virtual link, link to view documents
- System stores a permanent notice record: sent_at, channels, per-owner delivery status

**Document Attachment**
- Admin uploads documents at any time before or after meeting; immediately visible to all owners
- Minutes workflow: admin uploads draft → visible to owners as "Draft Minutes" → at the next meeting, admin clicks "Approve Minutes" → status updates to "Approved" → owners notified

**Resident-Facing Meeting View**
- Calendar view of all upcoming meetings
- Meeting detail: date/time/location, virtual link button, all documents listed with download, active votes
- Archive of all past meetings, fully searchable

---

### 4.3 Document Management

**Document Types**
- Agenda
- Minutes (with status: Draft | Approved)
- Supporting Document (financial reports, proposed rule changes, contracts under consideration, etc.)
- Notice Record (auto-generated permanent record of notices sent)

**Access**
- All documents visible to all authenticated owners of that association
- No restricted documents on the platform

**Storage & Retention**
- Files stored in cloud storage with auth-enforced access (no public URLs)
- Florida requires 7-year retention for minutes (718.111 / 720.303); platform retains indefinitely with no auto-deletion

---

### 4.4 Notification System

**Channels**
- Email (always on)
- SMS (owner opts in during onboarding or profile settings)
- In-app notification (always on)

**Automated Notices**

| Trigger | Recipients | Content |
|---------|-----------|---------|
| Meeting published | All owners | Date/time/location, link |
| Meeting reminder | All owners | 24 hours before |
| Document uploaded | All owners | Document title, link |
| Vote opened | Eligible voters | Vote title, deadline, link |
| Vote closes in 24h | Owners who haven't voted | Reminder + link |
| Vote results published | All owners | Results summary |
| Minutes published | All owners | Link to view |
| Proxy submitted | Grantor + Holder | Confirmation |

**Admin Tools**
- Preview notice content before sending
- Send custom broadcast message to all owners for a specific meeting
- View delivery report: sent, delivered, bounced, failed — per owner

---

### 4.5 Attendance & Quorum

**Quorum Calculation**
- Quorum threshold = configured quorum % × count of voting-eligible owners
- Eligible = voting_eligible is true (delinquency integration: Phase 3)
- Proxies count toward quorum for the units they represent

**Attendance Tracking**

*In-person:*
- Admin uses a search-and-tap interface on their device to mark owners present (designed for speed — full name search, one tap to mark present)
- Optional QR code: admin displays a QR code on screen at the door; tech-savvy owners self-check-in by scanning from their phone app. Non-tech-savvy owners are marked by admin. Both methods feed the same attendance count.
- Proxy holders: when a proxy holder checks in (as themselves or via proxy check-in link), all units they hold proxies for are automatically counted as present

*Virtual:*
- Admin provides Zoom link in the meeting record
- Phase 1: admin manually marks virtual attendees present using the same list
- Phase 3: Zoom API integration for automatic attendance import

**Admin Quorum View**
- Live count visible to admin throughout: "34 of 80 units present (42.5% — quorum requires 30%)"
- Admin clicks **"Confirm Quorum"** — this is a logged, timestamped action (who confirmed, when)

**If Quorum Is Not Confirmed**
- Admin can open a vote without confirming quorum (system warns but does not hard-block — admin may have information the system doesn't)
- Any meeting or vote where quorum was not confirmed is permanently flagged: "Quorum Not Confirmed"
- Results are recorded but the flag is visible to all owners in the record
- Association decides how to proceed — the platform records, does not advise

---

### 4.6 Voting System

**Vote Types**

| Vote | Ballot Type | Mode |
|------|-------------|------|
| Resolution (yes/no) | Open | In-meeting |
| Budget ratification | Open | In-meeting or Written Ballot |
| Bylaw/rule amendment | Open | In-meeting or Written Ballot |
| Special assessment | Open | In-meeting or Written Ballot |
| Board election | Secret (enforced, cannot be changed) | In-meeting or Written Ballot |

**In-Meeting Vote Flow**
1. Admin pre-creates vote items on the meeting before the meeting day
2. During meeting: admin clicks "Open Vote" on a specific item
3. Eligible owners receive push notification + email: "A vote is now open — [Title]"
4. Owner opens app → sees active vote → casts ballot (one tap for yes/no/abstain)
5. Admin sees live participation count (for secret ballots: participation only, not how votes are trending)
6. Admin closes vote manually or it closes at a preset time
7. Results calculated and published

**Written Ballot (Asynchronous) Flow**
1. Admin creates a standalone vote with an open and close date/time (e.g., 10-day ballot window)
2. All eligible owners notified immediately with a link to their ballot
3. Owners vote anytime during the window from any device
4. System tracks response rate in real time (admin can see participation %)
5. At closes_at: vote automatically seals — no more ballots accepted
6. Results tallied and published; all owners notified

**Secret Ballot Implementation**
- Each ballot answer is encrypted at submission using a key held in escrow until the vote closes
- After closing: system decrypts all ballots, tallies
- Audit log records who voted and when — it does NOT record how any individual voted
- This satisfies the Florida secret ballot requirement: the association cannot determine how any specific owner voted, but every owner voted at most once
- Encrypted ballots retained for 1 year (FL election requirement)

---

### 4.7 Proxy Management

**Two Proxy Types**

*Limited Proxy:*
- Owner designates: who holds the proxy (name + email — need not be an owner)
- Owner selects which specific agenda items the proxy covers
- For each covered item, owner selects: vote YES | vote NO | vote ABSTAIN | holder uses discretion
- Use case: "I'll be traveling. Vote YES on the budget. Use your judgment on the landscaping contract."

*General Proxy:*
- Owner designates a person to vote on all matters with full discretion
- System automatically blocks general proxy from being applied to any election vote — this is a hard enforcement (Florida law prohibits general proxy for elections)
- For elections, only a limited proxy that specifically names the election and a candidate is valid

**Proxy Submission Flow**
1. Owner logs in before the meeting
2. Meeting page → "Submit Proxy"
3. Selects proxy type, enters holder name + email
4. For limited: picks agenda items from the list, sets instructions per item
5. Submits — confirmation sent to both grantor and holder
6. Holder receives: "You have been designated proxy holder for Unit [X] — [Owner Name] — at [Meeting]"

**Proxy Holder Experience on Meeting Day**
- Holder checks in (owners: through their own account; non-owner holders: through a proxy check-in link emailed to them)
- System shows holder: all units they hold proxies for
- For limited proxy with fixed instructions: system casts those votes automatically when the vote opens; holder is notified
- For limited proxy with holder-discretion items or general proxy: holder manually casts the vote on behalf of each proxied unit
- Holder sees: their own ballot + one ballot per unit they hold proxy for

**Proxy and Quorum**
- Units with submitted proxies count toward quorum only if the proxy holder actually checks in
- Proxy holder who never checks in = unit is not present for quorum purposes

**Proxy Revocation**
- Grantor can revoke any proxy at any time before the meeting moves to "In Progress"
- Once the meeting is In Progress and quorum is confirmed: revocation is locked

---

### 4.8 Board Elections

**Full Florida-Compliant Election Workflow**

*Statutory timeline (condos — 718.112(2)(d)):*
- Day 0: Admin opens nominations (ideally 60+ days out)
- Day ~20: Nomination deadline (system enforces: minimum 40 days before election)
- Day ~46: Ballots distributed (system sends: minimum 14 days before election)
- Election day: ballots close, results tallied
- Results announced at annual meeting or posted immediately

*Step 1 — Admin Creates Election*
- Links election to the annual meeting
- Sets number of open seats
- Sets nomination deadline (system warns if < 40 days before election date)
- Sets ballot open and close dates (system warns if ballot sent < 14 days before election)

*Step 2 — Nomination Period*
- System sends notice to all owners: "Board elections are open. Nominations accepted until [date]."
- Owners submit candidacy through the app: name, brief bio, optional photo
- Admin can also manually add candidates
- Once nomination deadline passes: candidate list is locked and published to all owners

*Step 3 — Uncontested Election Check*
- If number of candidates ≤ number of open seats: system flags "Uncontested — no election required under Florida law."
- Admin confirms; those candidates are automatically recorded as elected. System records the decision. No ballot is sent.

*Step 4 — Ballot Distribution*
- System generates ballot listing all candidates
- Sent to all eligible, consenting owners via email + in-app link
- Ballot is secret: answers encrypted at submission

*Step 5 — Voting Period*
- Owners vote anytime within the window (select up to N candidates for N open seats)
- Non-voters receive a reminder 24 hours before close
- Proxy: only limited proxies that specifically name the election and a candidate are honored. General proxies are blocked. System enforces this automatically.

*Step 6 — Tallying*
- At close: ballots automatically sealed
- System decrypts, tallies, ranks candidates by vote count
- Top N win

*Step 7 — Tiebreaker*
- If a tie affects who wins a seat: system flags "Tiebreaker required" and notifies admin
- Admin records the tiebreaker resolution per their bylaws
- Platform records the decision; does not advise on how to resolve it

*Step 8 — Results*
- Published to all owners: candidate names + vote totals
- Winning candidates' board member status updated in the system
- Full vote count shown (secret ballot means totals are public, not individual votes)
- Encrypted ballot records retained for 1 year

---

## 5. Florida Compliance Layer

A cross-cutting enforcement layer applied throughout the app. Two enforcement levels:

**Hard blocks** — cannot be overridden by anyone:
- Elections must use secret ballot (enforced at vote creation)
- General proxy cannot be applied to election votes
- Electronic voting requires board resolution to be confirmed in association settings before any vote can open

**Soft warnings** — admin sees a clear, specific warning and can acknowledge and proceed:
- Notice period violations (admin may have sent physical notice separately)
- Nomination timeline violations
- Ballot distribution timeline violations
- Opening a vote without confirmed quorum

| Requirement | Statute | Enforcement |
|-------------|---------|-------------|
| 48-hour board meeting notice | 718.112(2)(c) / 720.303(2) | Soft warning |
| 14-day annual/special meeting notice | 718.112(2)(d) / 720.306(4) | Soft warning |
| Secret ballot for elections | 718.112(2)(d)(3) / 720.306(9) | Hard block |
| Electronic voting consent per owner | 718.128 / 720.317 | Hard block (non-consenting owners cannot cast electronic ballots) |
| Board resolution required for e-voting | 718.128 / 720.317 | Hard block (e-voting disabled until admin confirms) |
| Candidate nomination deadline (40 days for condos) | 718.112(2)(d)(3) | Soft warning |
| Ballot distribution (14 days before election) | 718.112(2)(d)(3) | Soft warning |
| General proxy prohibited for elections | 718.112(2)(d)(3) | Hard block |
| Ballot retention 1 year (elections) | 718.112(2)(d)(3) | Platform retains; no auto-delete |
| Minutes retention 7 years | 718.111(12) / 720.303(4) | Platform retains; no auto-delete |
| Minutes available to owners | 718.111(12) / 720.303(4) | Enforced by access model — all owners see all published minutes |

**Multi-state expansion note:** All notice periods, quorum defaults, and election rules are stored as configurable association-level settings, not hardcoded. Adding a new state means adding a new ruleset, not rewriting application logic.

---

## 6. Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Frontend | Next.js 15 (App Router) + TypeScript | SSR for document/meeting pages, type safety throughout |
| Styling | Tailwind CSS + shadcn/ui | Fast, accessible, consistent components |
| Backend | Next.js Server Actions + API routes | Collocated with frontend; no separate service at this scale |
| Database | PostgreSQL via Supabase | Relational model for complex permission logic; Row Level Security enforces multi-tenancy at the DB layer |
| Auth | Supabase Auth | Email magic link + password; JWT scoped per association |
| File Storage | Supabase Storage | Auth-enforced access on document files (no public URLs) |
| Real-time | Supabase Realtime | Live vote participation counts, live quorum tracking during meetings |
| Email | Resend | Reliable deliverability, clean API, great template support |
| SMS | Twilio | Industry standard |
| Deployment | Vercel | Zero-config Next.js, edge functions, global CDN |
| Ballot encryption | tweetnacl-js (libsodium port) | Well-audited, simple API for secret ballot encryption |

**Why Supabase as the infrastructure core:**
Row Level Security enforces multi-tenancy at the database layer — even a bug in application code cannot leak one association's data to another. It also gives auth, file storage, and real-time out of the box, eliminating three separate infrastructure choices.

---

## 7. Build Milestones

### Milestone 1 — Foundation
*Goal: A fully working, legally compliant platform for Florida associations to manage meetings, documents, and voting.*

- [ ] Multi-tenant association setup + configuration
- [ ] Owner roster CSV import
- [ ] Owner onboarding + electronic voting consent collection
- [ ] Meeting creation (all types) with FL notice deadline warnings
- [ ] Notice sending via email with delivery tracking
- [ ] Document upload, display, and status management (draft/approved minutes)
- [ ] In-meeting open ballot voting (yes/no resolutions)
- [ ] In-meeting secret ballot voting (elections)
- [ ] Manual attendance tracking + quorum confirmation
- [ ] Multi-association login (one account, workspace switcher)
- [ ] Florida compliance hard blocks and soft warnings
- [ ] In-app + email notifications for all events
- [ ] Owner-facing meeting archive

### Milestone 2 — Full Feature Parity
*Goal: Complete election workflow, both proxy types, written ballots, SMS, QR check-in.*

- [ ] Full board election workflow (nominations → ballots → tiebreaker → results)
- [ ] Uncontested election detection
- [ ] Limited proxy: submission, holder experience, auto-cast for fixed instructions
- [ ] General proxy: submission with election hard block
- [ ] Written ballot (asynchronous) voting
- [ ] SMS notifications (Twilio)
- [ ] QR code check-in for in-person meetings
- [ ] Admin delivery report (per-owner notice status)
- [ ] Management company cross-association dashboard

### Milestone 3 — Integration & Expansion
*Goal: Platform integrations, national expansion infrastructure, Easy Pay handshake.*

- [ ] Easy Pay delinquency → voting eligibility integration
- [ ] Zoom API integration (auto-import virtual attendees for quorum)
- [ ] AppFolio / Buildium / CINC roster import integrations
- [ ] Multi-state compliance layer (configurable rules per state)
- [ ] Compliance exports (certified vote tallies, notice delivery records)
- [ ] Encrypted ballot export/audit report

---

## 8. Open Items & Decisions Needed Before Build Starts

| # | Item | Notes |
|---|------|-------|
| 1 | **Co-owner primary voter** | Two co-owners both want to vote: first-cast wins (current plan) OR admin pre-designates a primary voter per unit? First-cast is simpler; pre-designation is cleaner but adds roster complexity. |
| 2 | **Renter accounts** | Currently: no renter accounts. Revisit if any target associations have bylaws granting renters participation rights. |
| 3 | **Asynchronous vote quorum** | For written ballots outside a meeting: quorum = X% of eligible owners return ballots by deadline. Confirm this interpretation is correct under FL law before building. |
| 4 | **Electronic voting resolution workflow** | When admin checks "board has adopted electronic voting resolution" — should the platform require them to upload the actual resolution document as proof, or is a self-attestation sufficient for Phase 1? |
| 5 | **Proxy holder identity verification** | Proxy holders who are non-owners check in via email link. Is that sufficient trust, or do we need additional verification (e.g., a PIN sent separately)? |
| 6 | **Easy Voice ↔ Easy Pay overlap** | Delinquent owners may lose voting rights under FL law. The data model already has a `voting_eligible` flag. Easy Pay integration (Phase 3) will write to this flag. Flag it now in the data model so it's not a retrofit. |
