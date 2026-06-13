'use client'

// Roles & permissions were merged into the Board page (Easy Voice → Board):
// each board member gets a role there, alongside the role builder. This stub
// redirects any old link or bookmark to the combined page.

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useT } from '@/lib/i18n'

export default function RolesMoved() {
  const t = useT()
  const router = useRouter()
  useEffect(() => { router.replace('/admin/board') }, [router])
  return (
    <div className="admin-page cset">
      <div className="admin-kicker">{t('admin.roles.kicker')}</div>
      <h1 className="admin-h1">{t('admin.roles.heading')}</h1>
      <p className="admin-dek">
        {t('admin.roles.description')}
      </p>
      <p style={{ marginTop: 12 }}>
        <Link className="admin-primary-btn" href="/admin/board">{t('admin.roles.goToBoard')}</Link>
      </p>
    </div>
  )
}
