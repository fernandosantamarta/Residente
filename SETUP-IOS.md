# Residente → Apple App Store (iOS via Capacitor)

Residente is a server-rendered Next.js app (Supabase + API routes), so it can't
be statically exported. The App Store path is a **Capacitor native shell that
loads the deployed web app** (residente.io today, residente.com later) and adds
**native push notifications** so it passes Apple's "minimum functionality" rule.

Do everything below on the **MacBook** (Xcode is macOS-only).

---

## 0. One-time accounts
- **Apple Developer Program** — $99/yr: https://developer.apple.com/programs/
- **Xcode** — install from the Mac App Store, then run it once to accept the license.
- Bundle ID (permanent, already decided): **`com.residente.app`**

---

## 1. Add Capacitor to the repo
From the project root on the Mac:

```bash
npm install @capacitor/core @capacitor/cli @capacitor/ios
npm install @capacitor/push-notifications @capacitor/app @capacitor/haptics
```

## 2. Initialize Capacitor
```bash
npx cap init "Residente" com.residente.app --web-dir public
```
This generates `capacitor.config.ts`.

## 3. Point the shell at the deployed app
Edit `capacitor.config.ts` so the native app loads your live site (this is the
remote-URL approach — instant content updates, no resubmit for web changes):

```ts
import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.residente.app',
  appName: 'Residente',
  webDir: 'public',
  server: {
    // Switch to https://residente.com when you cut over the domain.
    url: 'https://residente.io',
    cleartext: false,
  },
}

export default config
```

> Note: `capacitor.config.ts` imports a Capacitor type. Add it to the Next
> `tsconfig.json` `exclude` array (alongside `supabase/functions`) so it doesn't
> enter the web typecheck: `"exclude": [..., "capacitor.config.ts"]`.

## 4. Add the iOS project
```bash
npx cap add ios
npx cap sync ios
npx cap open ios   # opens Xcode
```

---

## 5. Native push notifications (this is what clears Guideline 4.2)
A shell that *only* loads the website gets rejected as a thin wrapper. Native
push is the value-add that makes it a real app, and you already have an
in-app notification system to feed it.

1. In Xcode → target **Signing & Capabilities** → **+ Capability** → **Push Notifications**, and add **Background Modes → Remote notifications**.
2. In the Apple Developer portal, create an **APNs key** (Keys → +, enable Apple Push Notifications service). Download the `.p8`.
3. Wire `@capacitor/push-notifications` in a small client bootstrap: request permission, register, and POST the device token to a Supabase table (e.g. `device_tokens`) keyed to the profile.
4. Send pushes from an edge function via APNs (reuse the notice-fanout pattern you already have for board notices).

---

## 6. Signing
- Xcode → Signing & Capabilities → check **Automatically manage signing**, pick your **Team** (your Apple Developer account).
- Set the **Bundle Identifier** to `com.residente.app`.
- Set a **Version** (1.0.0) and **Build** (1).

## 7. App icon + launch screen
- App icon: a single **1024×1024 PNG** (no transparency, no rounded corners — Apple rounds it). Drop it into the Xcode asset catalog (`AppIcon`).
- Use your orange mark on an opaque background (same as the apple-touch-icon you just fixed).

---

## 8. App Store Connect — create the listing
At https://appstoreconnect.apple.com → **Apps → +**:
- **Name:** Residente · **Bundle ID:** com.residente.app · **SKU:** residente-ios
- **Subtitle, description, keywords, support URL, marketing URL**
- **Privacy Policy URL:** your `/privacy` page
- **Screenshots** for required device sizes (6.7" iPhone is mandatory; iPad if you support it)
- **Privacy "nutrition labels":** declare account info + financial info (collected via Stripe), usage data, etc.
- **Age rating** questionnaire

### ⚠️ Two make-or-break review items
1. **Demo account (Guideline 2.1).** Residente is login-gated, so reviewers MUST get a working account. In **App Review Information → Sign-In Required**, give a **username + password for a seeded, polished demo community**, plus notes on how to navigate (do NOT reuse the throwaway test community).
2. **Payments (Guideline 3.1.3/3.1.5).** HOA dues and fines are *real-world services*, so they're **exempt from Apple's in-app purchase** — you keep **Stripe**. Do NOT add Apple IAP. In the review notes, state plainly: "Payments are for real-world community-association dues and fines, collected via Stripe; this is a physical-world service, not digital content."

### Not applicable to you
- **Sign in with Apple** is only required if you offer third-party social logins (Google/Facebook). Residente uses email/password via Supabase, so you can skip it — unless you add social login later.

---

## 9. Build, upload, submit
```bash
npx cap sync ios
```
Then in Xcode: select **Any iOS Device (arm64)** → **Product → Archive** →
**Distribute App → App Store Connect → Upload**. Back in App Store Connect,
attach the build to the version and **Submit for Review**.

First review is usually 1–3 days. If rejected, it's almost always 4.2 (add more
native value) or 2.1 (demo account didn't work) — both covered above.

---

## After the domain cutover (residente.io → residente.com)
- Change `server.url` in `capacitor.config.ts` to `https://residente.com`, then
  `npx cap sync ios`, bump the build number, archive, and submit an update.
- The **bundle ID stays `com.residente.app`** — never change it.
