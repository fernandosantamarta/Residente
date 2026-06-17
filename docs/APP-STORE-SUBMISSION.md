# Residente — App Store Connect submission copy

Paste-ready text for the App Store listing + App Review info. Fill the
`<PLACEHOLDERS>` before submitting. See SETUP-IOS.md §8–9 for the surrounding steps.

---

## App Review Information → Notes (the make-or-break section)

> Residente is a **private portal for homeowner / condo associations (HOAs)** —
> the entire app is behind a login, with no public browsing. Please use the demo
> account below to review all functionality.
>
> **Demo account (seeded demo community):**
> - Email: `cyberneticsintelligence+demo@gmail.com`
> - Password: `Residente123`
>
> This is a **board/admin account** for a fully populated demo community
> ("Sunset Lakes"), so you can see the full app: the **management tools**
> (Admin — notices, votes, documents, payments, compliance) AND the **resident
> experience** (use "Back to app" / the resident dashboard). You'll see real
> content throughout: dues & payment history, board announcements and votes,
> community documents and rules, the amenity / event calendar, and notifications.
>
> **How to navigate:**
> - **Home** — community overview, dues status, and a "where your dues go" breakdown.
> - **Easy Track** — view dues, payment history, and make a payment.
> - **Easy Voice** — board announcements, meetings, votes, and contacting the board.
> - **Easy Documents** — governing documents, rules, and violation notices.
> - **Easy Schedule** — community calendar and amenity bookings.
> - **Bell (top right)** — notifications. On first launch the app requests
>   notification permission and registers for native push.
>
> **Payments (Guideline 3.1.3 / 3.1.5):** Payments in this app are real-world
> community-association **dues and fines**, collected via Stripe. They pay for a
> physical-world service tied to a specific real-world community — not digital
> content or app functionality — so per Guideline 3.1.3(e) they are handled
> outside Apple's in-app purchase system. No digital goods are sold in the app.
>
> **Sign in with Apple:** Not applicable — the app uses email/password accounts
> only, with no third-party/social login, so Sign in with Apple is not required.

**Sign-In Required:** toggle ON and enter the same `cyberneticsintelligence+demo@gmail.com` / `Residente123`
in the dedicated username/password fields (App Review Information → Sign-In Required).

> ⚠️ Use a **seeded, polished demo community**, NOT the throwaway test community.
> Confirm the login works in a fresh install before submitting — a broken demo
> login is the #1 cause of a 2.1 rejection.

---

## Listing fields

**Name** (30 chars): `Residente`

**Subtitle** (30 chars max): `Your HOA dues, votes & docs`

**Promotional text** (170 chars, editable without resubmit):
> Pay dues, vote on community decisions, read board notices, and find every HOA
> document — all in one place. Your community, in your pocket.

**Keywords** (100 chars, comma-separated, no spaces after commas):
```
HOA,homeowners association,condo,community,dues,assessments,board,property,residents,neighborhood
```

**Support URL:** `https://residente.io/support`  ✅ (public FAQ + hello@residente.io)
**Marketing URL:** `https://residente.io`
**Privacy Policy URL:** `https://residente.io/privacy`  ✅ (live, 200)
**Terms (EULA):** `https://residente.io/terms`  ✅ (live, 200)

---

## Description (≤ 4000 chars)

> **Residente is the resident portal for your homeowners or condo association —
> everything your community needs, in one app.**
>
> No more digging through emails, paper notices, or three different websites.
> Residente brings your dues, your board, your documents, and your community
> calendar together in a single, simple place.
>
> **Pay and track your dues**
> See exactly what you owe, view your full payment history, and pay your
> assessments securely. Always know your balance and when your next payment is due.
>
> **Have a voice in your community**
> Read board announcements, follow meetings, and cast your vote on community
> decisions right from your phone. Reach the board directly with questions,
> maintenance issues, or requests — and get notified the moment they reply.
>
> **Every document, one tap away**
> Governing documents, rules and regulations, meeting minutes, and notices —
> all organized and searchable, so you're never guessing about the rules.
>
> **Never miss what matters**
> Get push notifications for new announcements, open votes, dues reminders, and
> board replies. Tune exactly what you're notified about in Settings.
>
> **Built for the whole community**
> Available in English, Spanish, and Portuguese. Board members and managers get
> the tools to run the association; residents get a clear window into where their
> dues go and how their community is doing.
>
> Residente is offered through your community association. Sign in with the
> account your association provides.
>
> Questions or feedback? Reach us at hello@residente.io.

---

## Privacy "nutrition labels" (App Privacy section)

Declare data collected and linked to the user:
- **Contact info** — name, email, phone (account + community profile)
- **Financial info** — payment/transaction history (dues & fines; processed by Stripe)
- **User content** — messages to the board, requests
- **Identifiers** — user/account ID

Purpose: app functionality, account management. Not used for tracking/advertising.
NOTE (verified 2026-06-17): the app ships **no analytics/tracking SDK** (no
PostHog/Mixpanel/Amplitude/Segment/Sentry/GA in package.json) → do **NOT** declare
"Usage Data" or "Diagnostics" / data collection for tracking. "Data Used to Track You": None.

---

## Category (App Information → Category)
- **Primary: Lifestyle** — best fit for a community/HOA resident portal; what comparable
  HOA/community apps list under.
- **Secondary: Utilities** — covers the practical dues/documents/management side.
- (Alternative if you'd rather lead practical: Primary **Utilities**, Secondary **Lifestyle**.
  Lifestyle-primary is the recommendation.)

## Age rating (questionnaire → expected 4+)
Run the App Store Connect age-rating questionnaire. Residente has no objectionable
content, so answer **None / No** to every content question:
- Cartoon, Fantasy, or Realistic Violence — **None**
- Sexual Content or Nudity — **None**
- Profanity or Crude Humor — **None**
- Alcohol, Tobacco, or Drug Use or References — **None**
- Simulated Gambling / Contests — **None / No**
- Horror / Fear Themes — **None**
- Mature / Suggestive Themes — **None**
- Medical / Treatment Information — **None**
- Made for Kids — **No** (the app is for adult residents/board members)
- Unrestricted Web Access — **No** (it loads only residente.io behind login, no open browser)
- Gambling (real) — **No**
- AI-generated / generative content shown to users — **No**

→ Result: **4+**. (Note: a 4+ rating does **not** conflict with the login-gated,
adults-using app — it just means no age-restricted content.)

## Screenshots
**6.9" iPhone (1320×2868) is the required size** in App Store Connect today (the old
6.7"/6.5" tiers are no longer separately required — 6.9" covers them). iPhone-only app.

✅ DONE 2026-06-17 — 7 shots captured at 1320×2868 from the seeded "Sunset Lakes" demo
(logged in as Maria), in `~/Desktop/residente-screenshots/`:
01-home (Home/dues overview) · 02-pay (Easy Track) · 03-requests (Easy Voice) ·
04-documents (Easy Documents) · 05-schedule (Easy Schedule) · 06-admin-compliance ·
07-admin-budget. Upload 3–10; the 5 resident shots first, the 2 admin shots optional.
