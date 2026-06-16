'use client'

import { useEffect } from 'react'
import { useAuth } from '@/app/providers'
import { registerNativePush } from '@/lib/nativePush'

// Mounted inside the authed cockpit (app/app/layout.tsx). When the app is
// running as the native iOS shell AND a resident is signed in, register the
// device for APNs push and persist its token (lib/nativePush is a no-op on the
// web, so this renders nothing and does nothing in a normal browser).
//
// Keyed on profile.id so a re-login as a different resident re-points the
// device token at the new account.
export default function NativePushBootstrap() {
  const { profile } = useAuth()

  useEffect(() => {
    if (!profile?.id) return
    void registerNativePush(profile.id, profile.community_id ?? null)
  }, [profile?.id, profile?.community_id])

  return null
}
