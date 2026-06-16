// Native push — iOS (APNs) via Capacitor. The web app is loaded remotely inside
// the Capacitor shell (see capacitor.config.ts server.url), so this same bundle
// runs both in a normal browser AND in the native WebView. Everything here is a
// no-op unless Capacitor.isNativePlatform() is true, so importing it on the web
// is harmless.
//
// Flow (mirrors lib/webPush.ts enablePush, but for APNs):
//   request permission → PushNotifications.register() → iOS hands back an APNs
//   device token → upsert it into public.device_tokens keyed to the profile.
//   apns-push-fanout then delivers to it. The push_pref radio in Settings still
//   controls WHAT gets pushed; this controls WHETHER this device is registered.
//
// The @capacitor/push-notifications calls route through the native bridge when
// running in the shell; in a browser the dynamic import resolves but the guard
// returns first, so no web code path touches it.

import { supabase, hasSupabase } from '@/lib/supabase'

// Set once we've wired the listeners, so a re-render / re-login doesn't stack
// duplicate handlers (Capacitor listeners are additive).
let listenersBound = false
let lastToken: string | null = null
let pending: { profileId: string; communityId: string | null } | null = null

// True only inside the Capacitor native shell. Dynamic so SSR / web builds
// never hard-depend on the native runtime being present.
export async function isNativeApp(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  try {
    const { Capacitor } = await import('@capacitor/core')
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

// Persist a freshly-issued APNs token. Idempotent: upsert on the unique token,
// so re-registering the same device just re-stamps updated_at + re-links the
// current profile (handles a device that switches resident accounts).
async function saveToken(token: string, profileId: string, communityId: string | null) {
  if (!hasSupabase || !supabase || !profileId || !token) return
  lastToken = token
  const appVersion =
    (typeof navigator !== 'undefined' && navigator.userAgent.slice(0, 120)) || null
  const { error } = await supabase
    .from('device_tokens')
    .upsert(
      {
        profile_id: profileId,
        community_id: communityId,
        token,
        platform: 'ios',
        app_version: appVersion,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'token' }
    )
  if (error) console.warn('[nativePush] token upsert failed:', error.message)
}

// Register this device for APNs and start persisting its token. Call once the
// resident is signed in (we need their profile id to key the token). Safe to
// call repeatedly — listeners bind once, and registration is cheap/idempotent.
export async function registerNativePush(
  profileId: string,
  communityId: string | null
): Promise<void> {
  if (!(await isNativeApp())) return
  // Remember the latest identity so the 'registration' listener (which may fire
  // asynchronously, or again on token rotation) always writes the current user.
  pending = { profileId, communityId }

  const { PushNotifications } = await import('@capacitor/push-notifications')

  if (!listenersBound) {
    listenersBound = true

    // iOS delivered an APNs token (on first register and on rotation).
    await PushNotifications.addListener('registration', (t) => {
      if (pending) void saveToken(t.value, pending.profileId, pending.communityId)
    })

    await PushNotifications.addListener('registrationError', (err) => {
      console.warn('[nativePush] APNs registration error:', JSON.stringify(err))
    })

    // Resident tapped a notification — deep-link to the notice. The fan-out
    // sends an absolute url in the payload's data; in the shell we're already
    // on the same origin, so a location assign navigates the WebView.
    await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const url = (action.notification?.data as Record<string, unknown> | undefined)?.url
      if (typeof url === 'string' && url) {
        try {
          const path = new URL(url, window.location.origin).pathname + new URL(url, window.location.origin).hash
          window.location.assign(path)
        } catch {
          window.location.assign(url)
        }
      }
    })
  }

  // Ask for permission (no-op prompt if already decided), then register with
  // APNs. permReceive === 'granted' is required before register() will yield a
  // token; if the resident declined we simply don't register this device.
  const perm = await PushNotifications.checkPermissions()
  let receive = perm.receive
  if (receive === 'prompt' || receive === 'prompt-with-rationale') {
    receive = (await PushNotifications.requestPermissions()).receive
  }
  if (receive !== 'granted') return

  await PushNotifications.register()
}

// Drop this device's token (e.g. on sign-out so a shared device stops getting
// the previous resident's pushes). Best-effort.
export async function unregisterNativePush(): Promise<void> {
  if (!(await isNativeApp())) return
  pending = null
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications')
    await PushNotifications.removeAllListeners()
    listenersBound = false
    if (lastToken && hasSupabase && supabase) {
      await supabase.from('device_tokens').delete().eq('token', lastToken)
    }
    lastToken = null
  } catch {
    /* best-effort: a stale row is pruned by the fan-out on APNs 410 */
  }
}
