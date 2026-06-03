// Web push — client side. Registers the service worker (public/sw.js), asks
// for notification permission, subscribes through the browser PushManager, and
// stores the subscription in public.push_subscriptions so notice-push-fanout
// can deliver to it. The push_pref radio in Settings controls WHAT gets pushed;
// these helpers control WHETHER this browser/device is subscribed at all.
//
// Requires NEXT_PUBLIC_VAPID_PUBLIC_KEY at build time and supabase/web-push.sql
// run in the database.

import { supabase, hasSupabase } from '@/lib/supabase'

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ''

export function isPushSupported(): boolean {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window
}

export function isPushConfigured(): boolean {
  return Boolean(VAPID_PUBLIC_KEY)
}

// 'unsupported' | 'default' (never asked) | 'granted' | 'denied'
export function pushPermission(): NotificationPermission | 'unsupported' {
  if (!isPushSupported()) return 'unsupported'
  return Notification.permission
}

// Does THIS browser currently hold a push subscription?
export async function isSubscribedHere(): Promise<boolean> {
  if (!isPushSupported()) return false
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    if (!reg) return false
    return Boolean(await reg.pushManager.getSubscription())
  } catch {
    return false
  }
}

// VAPID public key (base64url) → Uint8Array for applicationServerKey.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

// Request permission, subscribe, and persist. Idempotent: a second call on an
// already-subscribed browser just re-upserts the same endpoint row.
export async function enablePush(
  profileId: string,
  communityId: string | null
): Promise<{ ok: boolean; error?: string }> {
  if (!isPushSupported()) return { ok: false, error: 'This browser does not support notifications.' }
  if (!VAPID_PUBLIC_KEY)  return { ok: false, error: 'Push is not configured yet.' }
  if (!hasSupabase || !supabase) return { ok: false, error: 'Not connected to the server.' }

  let perm = Notification.permission
  if (perm === 'default') perm = await Notification.requestPermission()
  if (perm !== 'granted') {
    return {
      ok: false,
      error: perm === 'denied'
        ? 'Notifications are blocked. Enable them in your browser site settings, then try again.'
        : 'Permission was not granted.',
    }
  }

  const reg = await navigator.serviceWorker.register('/sw.js')
  await navigator.serviceWorker.ready

  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      // cast: the DOM lib types applicationServerKey as BufferSource; the modern
      // Uint8Array generic doesn't structurally match without the assertion.
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as unknown as BufferSource,
    })
  }

  const j = sub.toJSON()
  const keys = j.keys || {}
  if (!keys.p256dh || !keys.auth) return { ok: false, error: 'Subscription is missing keys.' }

  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        profile_id: profileId,
        community_id: communityId,
        endpoint: sub.endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        user_agent: navigator.userAgent.slice(0, 300),
      },
      { onConflict: 'endpoint' }
    )
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// Unsubscribe this browser and drop its row. Other devices keep their subs.
export async function disablePush(): Promise<void> {
  if (!isPushSupported()) return
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    if (!reg) return
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return
    const endpoint = sub.endpoint
    await sub.unsubscribe()
    if (hasSupabase && supabase) {
      await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
    }
  } catch {
    /* best-effort: a failed unsubscribe just leaves a stale row the fanout prunes on 410 */
  }
}
