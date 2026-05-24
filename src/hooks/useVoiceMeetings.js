import { useState, useEffect, useCallback } from 'react'
import { supabase, hasSupabase } from '../lib/supabase'
import { useAuth } from '../App'

const withTimeout = (p, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

export function useVoiceMeetings() {
  const { profile } = useAuth()
  const [meetings, setMeetings] = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)

  const load = useCallback(async () => {
    if (!hasSupabase || !profile?.community_id) { setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      const { data, error } = await withTimeout(
        supabase
          .from('ev_meetings')
          .select('*, ev_votes(id, title, type, status, ballot_type, yes_count, no_count, abstain_count)')
          .eq('community_id', profile.community_id)
          .order('scheduled_at', { ascending: false })
      )
      if (error) throw error
      setMeetings(data ?? [])
    } catch (err) {
      setError(err?.message ?? 'Failed to load meetings')
    } finally {
      setLoading(false)
    }
  }, [profile?.community_id])

  useEffect(() => { load() }, [load])

  return { meetings, loading, error, reload: load }
}

export function useVoiceMeeting(meetingId) {
  const { profile } = useAuth()
  const [meeting, setMeeting] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  const load = useCallback(async () => {
    if (!hasSupabase || !meetingId) { setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      const { data, error } = await withTimeout(
        supabase
          .from('ev_meetings')
          .select('*, ev_votes(*), ev_meeting_docs(*)')
          .eq('id', meetingId)
          .single()
      )
      if (error) throw error
      setMeeting(data)
    } catch (err) {
      setError(err?.message ?? 'Failed to load meeting')
    } finally {
      setLoading(false)
    }
  }, [meetingId])

  useEffect(() => { load() }, [load])

  return { meeting, loading, error, reload: load }
}
