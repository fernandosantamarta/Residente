'use client'

import { useState } from 'react'
import { PaySection } from './_sections/PaySection'
import { VendorSection } from './_sections/VendorSection'
import { ReportsSection } from './_sections/ReportsSection'
// Phone (<=767px) variants — today's simplified layouts (Pay rows, slim Vendors /
// Reports). Desktop keeps the full sections above; CSS .rsv-web/.rsv-mob picks one.
import { PaySection as PaySectionMobile } from './_sections/PaySection.mobile'
import { VendorSection as VendorSectionMobile } from './_sections/VendorSection.mobile'
import { ReportsSection as ReportsSectionMobile } from './_sections/ReportsSection.mobile'
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

      {tab === 'pay' && (<>
        <div className="rsv-web"><PaySection /></div>
        <div className="rsv-mob"><PaySectionMobile /></div>
      </>)}
      {tab === 'vendor' && (<>
        <div className="rsv-web"><VendorSection /></div>
        <div className="rsv-mob"><VendorSectionMobile /></div>
      </>)}
      {tab === 'reports' && (<>
        <div className="rsv-web"><ReportsSection /></div>
        <div className="rsv-mob"><ReportsSectionMobile /></div>
      </>)}
    </div>
  )
}
