'use client'

import { useState } from 'react'
import { PaySection } from './_sections/PaySection'
import { VendorSection } from './_sections/VendorSection'
import { ReportsSection } from './_sections/ReportsSection'
import { SegTabs, SegTab } from '@/components/SegTabs'
import { useT } from '@/lib/i18n'

// Easy Track — the resident hub that merges the former Pay, Vendor, and
// Reports tabs. The segmented control switches between them; only the active
// section renders. /app/pay, /app/vendor, and /app/reports redirect here
// (with #pay / #vendor / #reports) for backward compatibility.

export default function EasyTrack() {
  const t = useT()
  const [tab, setTab] = useState('pay')

  const TABS: SegTab[] = [
    { id: 'pay',     label: t('pay.tabPay') },
    { id: 'vendor',  label: t('pay.tabVendors') },
    { id: 'reports', label: t('pay.tabReports') },
  ]

  return (
    <div className="ev-wrap">
      <div className="voice-page-head ev-hub-head">
        <h1 className="voice-page-title">Easy Track</h1>
        <p className="voice-page-sub">
          {t('pay.hubSub')}
        </p>
      </div>

      <SegTabs tabs={TABS} active={tab} onChange={setTab} ariaLabel={t('pay.hubSectionsAria')} />

      {tab === 'pay' && <PaySection />}
      {tab === 'vendor' && <VendorSection />}
      {tab === 'reports' && <ReportsSection />}
    </div>
  )
}
