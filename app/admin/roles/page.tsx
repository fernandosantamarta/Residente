'use client'

// Roles & permissions were merged into the Board page (Easy Voice → Board):
// each board member gets a role there, alongside the role builder. This stub
// redirects any old link or bookmark to the combined page.

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function RolesMoved() {
  const router = useRouter()
  useEffect(() => { router.replace('/admin/board') }, [router])
  return (
    <div className="admin-page cset">
      <div className="admin-kicker">Easy Voice</div>
      <h1 className="admin-h1">Roles moved</h1>
      <p className="admin-dek">
        Roles &amp; permissions now live on the Board page, next to the board members
        who hold them. Taking you there…
      </p>
      <p style={{ marginTop: 12 }}>
        <Link className="admin-primary-btn" href="/admin/board">Go to Board</Link>
      </p>
    </div>
  )
}
