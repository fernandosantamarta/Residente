'use client'

// The owner roster + magic-link invites were consolidated into
// Easy Track → Residents (one source of truth for who lives here, their unit,
// account/invite state, and voting eligibility). This stub redirects any old
// link or bookmark to the new home.

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function VoiceRosterMoved() {
  const router = useRouter()
  useEffect(() => { router.replace('/admin/residents') }, [router])
  return (
    <div className="admin-page cset">
      <div className="admin-kicker">Easy Voice</div>
      <h1 className="admin-h1">Roster moved</h1>
      <p className="admin-dek">
        The owner roster and magic-link invites now live in Easy Track → Residents.
        Taking you there…
      </p>
      <p style={{ marginTop: 12 }}>
        <Link className="admin-primary-btn" href="/admin/residents">Go to Residents</Link>
      </p>
    </div>
  )
}
