'use client'

// Reports & exports were moved onto the Community page, below the Operating
// budget link. This stub redirects any old link or bookmark to that section.

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function ReportsMoved() {
  const router = useRouter()
  useEffect(() => { router.replace('/admin/community#reports') }, [router])
  return (
    <div className="admin-page cset">
      <div className="admin-kicker">Reporting</div>
      <h1 className="admin-h1">Reports moved</h1>
      <p className="admin-dek">
        Reports &amp; exports now live on the Community page, below the operating budget.
        Taking you there…
      </p>
      <p style={{ marginTop: 12 }}>
        <Link className="admin-primary-btn" href="/admin/community#reports">Go to Community → Reports</Link>
      </p>
    </div>
  )
}
