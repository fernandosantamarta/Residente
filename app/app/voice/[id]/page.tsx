'use client'

import { use } from 'react'
import Link from 'next/link'
import { useVoiceMeeting } from '@/hooks/useVoiceMeetings'
import { MeetingDetailBody } from '../_sections/MeetingDetail'

// Standalone meeting page — kept so shared/deep links to /app/voice/[id] still
// resolve. The body (votes, docs, ballots) is the shared MeetingDetailBody,
// which the in-list MeetingDetailDialog popup also uses.
export default function MeetingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { meeting, loading, error, reload } = useVoiceMeeting(id)

  if (loading) return <div className="voice-wrap"><div className="voice-placeholder">Loading…</div></div>
  if (error)   return <div className="voice-wrap"><div className="voice-err">{error}</div></div>
  if (!meeting) return null

  return (
    <div className="voice-wrap">
      <Link href="/app/voice" className="voice-back-btn">← All meetings</Link>
      <MeetingDetailBody meeting={meeting} reload={reload} />
    </div>
  )
}
