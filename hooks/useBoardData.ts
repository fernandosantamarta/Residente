import { useEffect, useState } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'

// Real data for the Easy Voice → Board section, derived from tables that
// already exist (no new migration):
//   - members  → profiles with a board/admin role in the community
//   - upcoming → next ev_meetings that hasn't happened yet
//   - minutes  → past ev_meetings whose minutes are published/approved
// Board updates come from useBoardDecisions; committees have no data model
// yet so that block is hidden until there's a table for it.

export type BoardMember = { id: string; name: string; role: string; initials: string; email?: string }
export type BoardMeeting = {
  id: string; title: string; type: string; scheduled_at: string
  location: string | null; virtual_link: string | null
  status: string; minutes_status: string
}

const initials = (name: string) =>
  name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '—'

const roleLabel = (role: string) =>
  role === 'admin' ? 'Administrator' : role === 'board_member' ? 'Board Member' : role

export function useBoardData() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [members, setMembers] = useState<BoardMember[]>([])
  const [upcoming, setUpcoming] = useState<BoardMeeting | null>(null)
  const [minutes, setMinutes] = useState<BoardMeeting[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!hasSupabase || !supabase || !communityId) { setLoading(false); return }
    let cancelled = false

    const run = async () => {
      try {
        const [{ data: mem }, { data: mtgs }] = await Promise.all([
          supabase.from('profiles')
            .select('id, full_name, email, role')
            .eq('community_id', communityId)
            .in('role', ['board_member', 'admin']),
          supabase.from('ev_meetings')
            .select('id, title, type, scheduled_at, location, virtual_link, status, minutes_status')
            .eq('community_id', communityId)
            .order('scheduled_at', { ascending: false }),
        ])
        if (cancelled) return

        setMembers((mem ?? []).map((m: any) => {
          const name = m.full_name || 'Board Member'
          return { id: m.id, name, role: roleLabel(m.role), initials: initials(name), email: m.email || undefined }
        }))

        const list = (mtgs ?? []) as BoardMeeting[]
        const now = Date.now()
        const up = list
          .filter(m => new Date(m.scheduled_at).getTime() >= now && m.status !== 'completed')
          .sort((a, b) => +new Date(a.scheduled_at) - +new Date(b.scheduled_at))[0] || null
        setUpcoming(up)
        setMinutes(list.filter(m => m.minutes_status === 'published' || m.minutes_status === 'approved').slice(0, 5))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [communityId])

  return { members, upcoming, minutes, loading }
}
