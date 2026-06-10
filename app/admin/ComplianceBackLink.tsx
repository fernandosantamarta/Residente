'use client'

// Back link to the Compliance dashboard, placed above the page kicker on every
// compliance sub-page so a board member can step out of a section (estoppel,
// collections, financials, …) back to the hub without the browser back button.

import Link from 'next/link'

export function ComplianceBackLink() {
  return (
    <Link href="/admin/compliance" className="admin-backlink"><span aria-hidden>&larr;</span> Compliance</Link>
  )
}
