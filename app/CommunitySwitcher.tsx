'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from './providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { useMyMemberships } from '@/hooks/useMyMemberships'

// Brand-area dropdown that lets a multi-community profile switch active
// communities. Active community lives on profiles.community_id — the
// single source of truth for every ev_* RLS policy — so the switcher's
// job is essentially "UPDATE profiles SET community_id = $1 WHERE id =
// auth.uid()" with a UI on top. If the profile only belongs to one
// community, the component renders nothing.
export function CommunitySwitcher() {
  const { profile, setProfile } = useAuth() || {}
  const router = useRouter()
  const { memberships, loading } = useMyMemberships()
  const [open, setOpen]       = useState(false)
  const [busy, setBusy]       = useState(false)
  const [err, setErr]         = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (!ref.current?.contains(t)) setOpen(false)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [open])

  if (loading || memberships.length <= 1) return null

  const active = memberships.find(m => m.community_id === profile?.community_id)
  const label  = active?.community_name || 'Pick a community'

  const switchTo = async (community_id: string) => {
    if (!hasSupabase || !supabase || !profile) return
    if (community_id === profile.community_id) { setOpen(false); return }
    setBusy(true); setErr(null)
    try {
      // Goes through the set_active_community SECURITY DEFINER fn (see
      // supabase/community-switch.sql): a direct PATCH of profiles.community_id
      // 403s (authenticated can't write that column) and would be an IDOR if it
      // could. The function checks ev_membership first, then switches and bumps
      // last_active_at in one call.
      const { error } = await supabase.rpc('set_active_community', {
        p_community_id: community_id,
      })
      if (error) throw error

      if (setProfile) setProfile({ ...profile, community_id })
      setOpen(false)
      // Force every server component down the tree to re-fetch with the
      // new community context.
      router.refresh()
    } catch (e: any) {
      setErr(e?.message || 'Could not switch community')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="comm-switcher" ref={ref}>
      <button
        className="comm-switcher-btn"
        onClick={() => setOpen(v => !v)}
        disabled={busy}
        aria-expanded={open}
      >
        <span className="comm-switcher-label">{label}</span>
        <svg className="comm-switcher-chev" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      {open && (
        <div className="comm-switcher-menu" role="menu">
          {memberships.map(m => {
            const isActive = m.community_id === profile?.community_id
            return (
              <button
                key={m.community_id}
                className={`comm-switcher-item${isActive ? ' active' : ''}`}
                onClick={() => switchTo(m.community_id)}
                disabled={busy}
              >
                <span>{m.community_name}</span>
                {isActive && <span className="comm-switcher-tick">✓</span>}
              </button>
            )
          })}
        </div>
      )}
      {err && <div className="comm-switcher-err">{err}</div>}
    </div>
  )
}
