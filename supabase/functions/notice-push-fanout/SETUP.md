# Web push setup

One-time wiring to make browser push live. The code (client `lib/webPush.ts`,
service worker `public/sw.js`, table `supabase/web-push.sql`, this function) is
already in the repo. Until these steps are done, the Settings → Browser
Notifications dialog shows “Push isn’t configured on the server yet” and nothing
sends — everything else (the in-app bell) keeps working.

## 1. Run the table SQL

In the Supabase SQL editor, run `supabase/web-push.sql` (creates
`push_subscriptions`). Safe to re-run.

## 2. Generate a VAPID key pair

```bash
npx web-push generate-vapid-keys
```

It prints a **Public Key** and a **Private Key**. Keep the private key secret.

## 3. Set the secrets (Supabase) + env (Vercel)

Supabase function secrets:

```bash
supabase secrets set VAPID_PUBLIC_KEY="<public key>"
supabase secrets set VAPID_PRIVATE_KEY="<private key>"
supabase secrets set VAPID_SUBJECT="mailto:hello@residente.io"
# reuse the same secret the email fanout uses:
supabase secrets set NOTICE_WEBHOOK_SECRET="<same value as notice-email-fanout>"
supabase secrets set APP_URL="https://residente.io"
```

Vercel env (Production) — the **public** key only, exposed to the browser:

```
NEXT_PUBLIC_VAPID_PUBLIC_KEY = <public key>
```

Redeploy the Vercel app so the client picks up the public key.

## 4. Deploy the function

```bash
supabase functions deploy notice-push-fanout --no-verify-jwt
```

## 5. Add the database webhook

Supabase Dashboard → Database → Webhooks → **Create a new hook**:

- Table: `public.ev_notices`
- Events: **Insert**
- Type: Supabase Edge Function → `notice-push-fanout`
- HTTP header: `X-Webhook-Secret: <NOTICE_WEBHOOK_SECRET>`

This is a SECOND webhook alongside the email one — both fire on the same insert.
The push function only reads the already-materialised `in_app` recipient rows,
so it covers every notice kind automatically.

## 6. Test

1. Open the app (https://residente.io) as a resident in Chrome/Edge/Android.
2. Settings → Browser Notifications → **Enable on this device** → allow the prompt.
3. Trigger any notice (e.g. board adds a rule, or submit a resident request).
4. The OS notification should appear; clicking it opens the right page.

Tail logs while testing:

```bash
supabase functions logs notice-push-fanout
```

## Notes

- **iOS**: web push needs the site added to the Home Screen (installed PWA) and
  iOS 16.4+. Desktop Chrome/Edge/Firefox and Android Chrome work without install.
- Dead subscriptions (404/410 from the push service) are auto-pruned from
  `push_subscriptions` on the next send.
- `push_pref` (Settings) gates delivery: `none` = never, `important` = only
  dues/votes/emergency broadcasts, `all` = every notice. Mirror of the email gate.
