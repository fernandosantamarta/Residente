'use client'

// The owner roster + magic-link invites were consolidated into
// Easy Track → Residents (one source of truth for who lives here, their unit,
// account/invite state, and voting eligibility). This stub redirects any old
// link or bookmark to the new home.

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useT } from '@/lib/i18n'

export default function VoiceRosterMoved() {
  const t = useT()
  const router = useRouter()
  useEffect(() => { router.replace('/admin/residents') }, [router])
  return (
    <div className="admin-page cset">
      <div className="admin-kicker">Easy Voice</div>
      <h1 className="admin-h1">{t('admin.voiceRoster.heading')}</h1>
      <p className="admin-dek">
        {t('admin.voiceRoster.body')}
      </p>
      <p style={{ marginTop: 12 }}>
        <Link className="admin-primary-btn" href="/admin/residents">{t('admin.voiceRoster.goToResidents')}</Link>
      </p>
    </div>
  )
}
