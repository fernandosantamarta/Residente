import { useEffect, useState } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'

// Real data for the Easy Voice → Board section:
//   - members    → residents flagged is_board (board_position is their title)
//   - upcoming   → next ev_meetings that hasn't happened yet
//   - minutes    → past ev_meetings whose minutes are published/approved
//   - committees → the committees table (managed at /admin/board)
// Board updates come from useBoardDecisions.

export type BoardMember = { id: string; name: string; role: string; initials: string; email?: string }
export type BoardMeeting = {
  id: string; title: string; type: string; scheduled_at: string
  location: string | null; virtual_link: string | null
  status: string; minutes_status: string
}
export type Committee = {
  id: string; name: string; chair: string | null; member_count: number
  icon: 'finance' | 'leaf' | 'home' | 'shield' | 'megaphone'
}

const initials = (name: string) =>
  name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '—'

export function useBoardData() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [members, setMembers] = useState<BoardMember[]>([])
  const [upcoming, setUpcoming] = useState<BoardMeeting | null>(null)
  const [minutes, setMinutes] = useState<BoardMeeting[]>([])
  const [committees, setCommittees] = useState<Committee[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!hasSupabase || !supabase || !communityId) { setLoading(false); return }
    let cancelled = false

    const run = async () => {
      try {
        const [{ data: mem }, { data: mtgs }, { data: coms }] = await Promise.all([
          supabase.from('residents')
            .select('id, full_name, email, board_position, is_board')
            .eq('community_id', communityId)
            .eq('is_board', true),
          supabase.from('ev_meetings')
            .select('id, title, type, scheduled_at, location, virtual_link, status, minutes_status')
            .eq('community_id', communityId)
            .order('scheduled_at', { ascending: false }),
          supabase.from('committees')
            .select('id, name, chair, member_count, icon')
            .eq('community_id', communityId)
            .order('sort_order', { ascending: true }),
        ])
        if (cancelled) return

        setMembers((mem ?? []).map((m: any) => {
          const name = m.full_name || 'Board Member'
          return { id: m.id, name, role: m.board_position || 'Board Member', initials: initials(name), email: m.email || undefined }
        }))

        const list = (mtgs ?? []) as BoardMeeting[]
        const now = Date.now()
        const up = list
          .filter(m => new Date(m.scheduled_at).getTime() >= now && m.status !== 'completed')
          .sort((a, b) => +new Date(a.scheduled_at) - +new Date(b.scheduled_at))[0] || null
        setUpcoming(up)
        setMinutes(list.filter(m => m.minutes_status === 'published' || m.minutes_status === 'approved').slice(0, 5))
        setCommittees((coms ?? []) as Committee[])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [communityId])

  return { members, upcoming, minutes, committees, loading }
}
