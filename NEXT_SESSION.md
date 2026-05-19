# Next session — Residente

Last touched: 2026-05-19 (afternoon)

## Shipped 2026-05-19 (today)

- **Mobile responsive cockpit** (commit `c6c0c30`) — Home reflows for phone (<768px) and tablet (768-1199px) viewports. Variant-B aesthetic: gradient hero, centered rings + money shot, 2-col category grid on phone, board feed stacked below content. Hamburger drawer with backdrop overlay; auto-closes on route change. Desktop ≥1200px keeps original variant-A cockpit.
- **Desktop full-width** (same commit) — removed `body { min-width: 1440px }` and changed `.cockpit { width: 1440px }` → `width: 100%`. Cockpit now stretches with the viewport. Conflicts with `approved.json` "1440px fixed-width" rule — Fernando explicitly overrode the design contract.
- **Logout button** (same commit) — in the rail footer below the user-block. Calls `signOut()`; App.jsx's onAuthStateChange listener handles redirect to `/login`. Also surfaces inside the mobile nav drawer.
- **Community page port** (commit `6e92107`) — editorial magazine layout for `/community`. Feature well (Fraunces 112px gradient headline + rings + money shot), 4-col category grid with mini-rings, 2-col article grid (feature article spans both), masthead footer. All styles namespaced under `.community-page` and `comm-*` class prefix. Mobile responsive.
- **Editorial stub screens** (commit `3537ffc`) — Pay/Board/Rules/Documents/Contact upgraded from bare gradient h1 to a styled editorial layout (pink kicker → Fraunces italic gradient headline → italic-serif dek → "Coming next" bullet list). Each page has unique copy that sets expectations.
- **Real user identity in rail footer** (this session) — Layout reads Supabase profile via useAuth(), shows real initials from `full_name` and `Unit {unit_number}`. Falls back to placeholders during profile load.

## Shipped 2026-05-18 evening

- **iPhone login blank** — root cause was `body { min-width: 1440px }` (cockpit grid requirement) being inherited by the login page, pushing the centered card ~525px off-screen on mobile. Fix shipped as commit `86bd55c`: `body:has(.login-screen) { min-width: 0 }`. Verified live on iPhone-emulated viewport. Login now renders correctly on phone. See `~/.claude/.../memory/residente-body-minwidth-gotcha.md` for the pattern — any future pre-auth page (signup, password reset, invite claim) must extend the `:has()` selector or this regresses.

## NEW TOP ITEM: Wire Home placeholder data to Supabase

The cockpit Home page renders pixel-faithful Sunset Lakes data — but every number is hardcoded. With auth + profile already wired (the rail footer now reads from `profile.full_name` and `profile.unit_number`), the natural next step is to back the dashboard with real DB queries.

**Scope estimate: 1-2 sessions.**

**What needs a Supabase table:**
- Budget categories (Landscape / Security / Amenities / Reserves) with `percentage`, `amount`, `warn` flag
- Burn chart 12-month data (cumulative spend per month, current month flag)
- Board feed (vendor, amount, status, date) — already shown in right rail + Community page
- Household block (unit, current balance, next assessment date + amount)

**Approach:**
1. Schema design — `budget_categories`, `monthly_spend`, `board_decisions`, `assessments` tables, all keyed by `community_id`
2. RLS: members of a community read all rows where `community_id = my profile's community_id`; only board members write
3. Loader hook (`useCommunityData()`) fans out queries, returns `{ categories, monthlySpend, feed, household }`
4. Home + Community pages consume the hook; if loading, show a skeleton variant of the existing components



## Live state

- **Production**: https://residente.io (apex canonical, www 307 → apex)
- **Vercel**: residente-nine.vercel.app + custom domain wired, auto-deploy from main
- **GitHub**: github.com/fernandosantamarta/Residente
- **Supabase**: project `nozzfcxijdnllkiydhfi`, region East US (N. Virginia)
- **Auth**: email/password working, first user created, RLS enforces own-profile reads/updates

## What's working

- 7-route cockpit shell (Home / Pay / Board / Rules / Documents / Contact / Community)
- Home page renders variant-A pixel-faithful (rings, money shot, burn chart, category cards, board feed, household block) — all placeholder Sunset Lakes data
- Login screen at `/login` with dark aesthetic + pink gradient — same fonts/colors as the rest
- Auth bootstrap with 10s `withTimeout` + Retry UI ported from Genie hardening
- Supabase client is env-guarded: app runs locally without `.env.local` (renders cockpit, no auth gate)
- `profiles` table + RLS policies + auto-create trigger on `auth.users` insert

## Onboarding a whole community (big question from end of session)

**Recommended pattern: magic link blast**

Board has 50-500 residents from a property-manager roster. Best UX = no passwords, no signup forms.

Flow:
1. Board uploads CSV (full_name, email, unit_number) via an admin page (TBD)
2. Backend (Supabase edge function or a one-shot Node script) loops:
   - `supabase.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name, unit_number } })`
   - `handle_new_user` trigger creates the profile row automatically
3. Then for each: `supabase.auth.admin.generateLink({ type: 'magiclink', email })` → get the URL
4. Send branded email: "You've been added to Sunset Lakes' Residente portal — click to enter"
5. Resident clicks → lands signed in → first time, prompt to add phone (optional)

Why magic link: HOA demographics skew older. "Click this link" >> "remember a password."

Things to think through:
- **Email sender**: Supabase default sends from `noreply@mail.app.supabase.io` — looks like spam. Set up a custom SMTP (Resend or Postmark, ~$10/mo) sending from `welcome@residente.io`.
- **Rate limits**: Supabase free tier limits email throughput. Bulk send may need to space out, or use Resend/Postmark for the email send and only use Supabase for the magic link URL generation.
- **No-email residents**: Need fallback. Board manually creates account, hands resident a temp password in person, resident changes on first login.
- **CSV → community linkage**: Each resident's `community_id` needs to come from the upload context (board admin user's `community_id`).
- **Reusing accounts**: If a resident already has an account at another property (Residente could serve multiple HOAs eventually), don't duplicate — link existing account to new community.

Scope: ~1/2 to 1 day of build. Two pieces: admin upload page + bulk-invite backend.

## Admin section (`/admin`) — board-only management UI

Gate: only `role IN ('board_member', 'admin')` can access. Regular residents redirect to `/`.

Pages in v1 priority order:

1. **Residents** — list, add single, **bulk CSV upload → magic-link blast** (this is where the onboarding flow lives), edit unit/role, deactivate
2. **Community Settings** — name, address, unit count, fiscal year start
3. **Board** — promote/demote residents to `board_member`
4. **Budget Setup** — categories + monthly amounts + percentages (feeds Home page rings)
5. **Vendors** — vendor list, contracts, payment schedule (feeds right-rail board feed)
6. **Announcements** — write + send (email + in-app)
7. **Activity log** — audit trail of admin actions

Implementation pattern: mirror Genie's `AdminLayout` + nested routes under `/admin`, but keep it lean. Genie has 19 admin pages — way too many. Residente starts with just 1-3 (Residents, Community Settings, Board) and grows from real need.

Build order: bulk-invite (page 1) is the most valuable single feature — it unlocks real HOA adoption. Do that first, then community settings, then budget, then everything else.

Scope: ~2-3 days for v1 (pages 1-3).

## Punch list — pick up here

In rough priority order:

0. **Admin section v1** — `/admin` with Residents + Community Settings + Board (above) — gates first real HOA adoption
0a. **Bulk-invite flow** (under Admin → Residents) — depends on admin section existing
1. **Port `community.html` → `/community` page** (~30 min)
   - Source: `~/.gstack/projects/Fernando/designs/residente-desktop-20260424/community.html` (1113 lines, editorial magazine layout)
   - Reuses Layout's left rail + topbar — just need the center content
   - Currently stubbed at `src/pages/Community.jsx`

2. **Wire Home's placeholder data to Supabase** (~1-2 hrs)
   - Budget categories with `percentage`, `amount`, `warn` flag → DB table
   - Burn chart 12-month data → DB
   - Board feed (vendor / amount / status / date) → DB
   - Household block (unit / balance / next assessment) → DB
   - Demo data should populate from `community_id` lookup

3. **Build out Pay** (~half day)
   - Dues, assessments, fines model (port simplified version from Genie)
   - Stripe integration optional v1

4. **Signup / onboarding flow**
   - Currently: board manually creates auth users in Supabase dashboard
   - Better: invite flow where board sends email → resident signs up → claims their unit
   - Even better: collect `unit_number` during signup (right now trigger only saves `full_name` + `email`)

5. **Board page** — board member voting, motions, decisions

6. **Rules page** — covenants and fine schedule, searchable

7. **Documents page** — Supabase Storage backed

8. **Contact page** — direct message thread per resident

## Design constraints (LOCKED — do not drift)

From `~/.gstack/projects/Fernando/designs/residente-desktop-20260424/approved.json`:

- **bg**: `#0A0A12` (near-black, NOT Genie navy)
- **bg-elev**: `#14141F`, **bg-card**: `#16162A`
- **grad**: `linear-gradient(135deg, #FF3B5F 0%, #B83377 50%, #4F2B8C 100%)` (pink → magenta → violet)
- **grad-warn**: `linear-gradient(135deg, #FF3B5F 0%, #FF8BA8 100%)`
- **body font**: Space Grotesk (NOT Inter — Inter is fallback only)
- **display font**: Fraunces (editorial pages only, e.g. `/community`)
- **demo**: Sunset Lakes, 166 homes, Miramar FL, $47,200/$62,000 Q2 2026
- **layout**: 1440px fixed-width 3-col cockpit (240px nav / 1fr center / 340px right rail)
- **right rail** only renders on `/` (Home) — hidden on other pages, Layout collapses to 2-col

CSS tokens live in `src/index.css`. NavLink active state uses `--grad` for the pill.

## Critical rules

- **NEVER use `.catch()` on Supabase calls** — always `try/catch async`. Carry over from Genie.
- **Always wrap network promises in `withTimeout()`** before awaiting (10s default). Pattern is in `App.jsx`.
- **Anon key is PUBLIC** — never mark it "Sensitive" in Vercel. RLS does the security.
- **`.env.local` is gitignored** — re-create from `.env.example` if cloning fresh.
- **Vercel env vars** require uncheck "Use existing Build Cache" on redeploy to pick up changes.

## Key file map

```
src/App.jsx                  — auth bootstrap (withTimeout), router, /login gate
src/components/Layout.jsx    — cockpit chrome, 7-item nav, right rail conditional
src/lib/supabase.js          — env-guarded client, signIn, getProfile
src/pages/Home.jsx           — full variant-A, all placeholder Sunset Lakes data
src/pages/Login.jsx          — email/password form, dark aesthetic
src/pages/{Pay,Board,Rules,Documents,Contact,Community}.jsx  — stubs
src/index.css                — all design tokens + component styles (single file)
```

## Local dev

```bash
cd "C:\Users\Fernando\OneDrive\Documents\HOA Project\residente"
npm start
```
