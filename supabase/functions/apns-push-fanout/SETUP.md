# Native iOS push setup (APNs)

One-time wiring to make iOS push live in the native app. The code (client
`lib/nativePush.ts` + `components/NativePushBootstrap.tsx`, table
`supabase/device-tokens.sql`, this function) is already in the repo. This is the
native twin of web push (`notice-push-fanout`); it reuses the SAME notice
webhook so one board notice fans out to browsers and iOS devices together.

Prereq: the iOS app target has the **Push Notifications** capability and
**Background Modes → Remote notifications** enabled in Xcode (done), and the
app is signed by the paid Apple Developer team.

## 1. Run the table SQL

In the Supabase SQL editor, run `supabase/device-tokens.sql` (creates
`device_tokens`). Safe to re-run.

## 2. Create an APNs auth key (.p8)

Apple Developer portal → **Certificates, Identifiers & Profiles → Keys → +**:

- Name: `Residente APNs`
- Enable **Apple Push Notifications service (APNs)** → Continue → Register
- **Download the `.p8`** (one-time download — store it safely)
- Note the **Key ID** (10 chars, on the key page) and your **Team ID**
  (10 chars, top-right of the portal)

A single APNs key works for both sandbox (Xcode debug) and production
(TestFlight / App Store), so you only need one.

## 3. Set the secrets (Supabase)

```bash
supabase secrets set APNS_KEY_ID="<10-char Key ID>"
supabase secrets set APNS_TEAM_ID="<10-char Team ID>"
supabase secrets set APNS_BUNDLE_ID="com.residente.app"
# paste the FULL .p8 file contents, including the BEGIN/END lines:
supabase secrets set APNS_PRIVATE_KEY="$(cat ~/Documents/AuthKey_XXXXXXXXXX.p8)"
# reuse the same secret the other fanouts use:
supabase secrets set NOTICE_WEBHOOK_SECRET="<same value as notice-email-fanout>"
supabase secrets set APP_URL="https://residente.io"
```

No Vercel env is needed — unlike web push (which needs the public VAPID key in
the browser bundle), APNs registration uses the native iOS APNs token, so the
client side needs no key.

## 4. Deploy the function

```bash
supabase functions deploy apns-push-fanout --no-verify-jwt
```

## 5. Add the database webhook

Supabase Dashboard → Database → Webhooks → **Create a new hook**:

- Table: `public.ev_notices`
- Events: **Insert**
- Type: Supabase Edge Function → `apns-push-fanout`
- HTTP header: `X-Webhook-Secret: <NOTICE_WEBHOOK_SECRET>`

This is a THIRD webhook alongside the email + web-push ones — all fire on the
same insert. The function only reads the already-materialised `in_app`
recipient rows, so it covers every notice kind automatically.

## 6. Test

1. Run the app on a real iPhone (APNs does not deliver to the Simulator) or a
   TestFlight build, signed by the paid team.
2. Sign in as a resident → accept the notification permission prompt. The
   device token is upserted into `device_tokens` automatically on login.
3. Trigger any notice (board adds a rule, or submit a resident request).
4. The iOS notification should appear; tapping it deep-links to the right page.

Tail logs while testing:

```bash
supabase functions logs apns-push-fanout
```

## Notes

- **Simulator can't receive APNs** — test on a physical device or TestFlight.
- The function sends to the **production** APNs host first and falls back to
  **sandbox** on `BadDeviceToken`, so the same deploy serves debug builds
  (sandbox tokens) and App Store / TestFlight builds (production tokens).
- Dead tokens (`410 Unregistered` / `400 BadDeviceToken`) are auto-pruned from
  `device_tokens` on the next send.
- `push_pref` (Settings) gates delivery identically to email/web push: `none` =
  never, `important` = only dues/votes/broadcasts, `all` = every notice.
- The provider JWT is generated once per fan-out and reused across all tokens
  (Apple rate-limits provider-token regeneration).
