'use client'

import { useState } from 'react'
import { PaySection } from './_sections/PaySection'
import { VendorSection } from './_sections/VendorSection'
import { ReportsSection } from './_sections/ReportsSection'
import { SegTabs, SegTab } from '@/components/SegTabs'

// Easy Track — the resident hub that merges the former Pay, Vendor, and
// Reports tabs. The segmented control switches between them; only the active
// section renders. /app/pay, /app/vendor, and /app/reports redirect here
// (with #pay / #vendor / #reports) for backward compatibility.
const TABS: SegTab[] = [
  { id: 'pay',     label: 'Pay' },
  { id: 'vendor',  label: 'Vendors' },
  { id: 'reports', label: 'Reports' },
]

export default function EasyTrack() {
  const [tab, setTab] = useState('pay')

  return (
    <div className="ev-wrap">
      <div className="voice-page-head ev-hub-head">
        <h1 className="voice-page-title">Easy Track</h1>
        <p className="voice-page-sub">
          Your balance and payments, trusted vendors, and community reports — all in one place.
        </p>
      </div>

      <SegTabs tabs={TABS} active={tab} onChange={setTab} ariaLabel="Easy Track sections" />

      {tab === 'pay' && <PaySection />}
      {tab === 'vendor' && <VendorSection />}
      {tab === 'reports' && <ReportsSection />}
    </div>
  )
}
