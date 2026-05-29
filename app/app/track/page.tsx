'use client'

import { PaySection } from './_sections/PaySection'
import { VendorSection } from './_sections/VendorSection'
import { ReportsSection } from './_sections/ReportsSection'

// Easy Track — the resident hub that merges the former Pay, Vendor, and
// Reports tabs into one single-scroll surface. The quick-jump strip
// anchors to each section; /app/pay, /app/vendor, and /app/reports
// redirect here for backward compatibility.
export default function EasyTrack() {
  return (
    <div className="ev-wrap">
      <div className="voice-page-head ev-hub-head">
        <h1 className="voice-page-title">Easy Track</h1>
        <p className="voice-page-sub">
          Your balance and payments, trusted vendors, and community reports — all in one place.
        </p>
      </div>

      <div className="voice-tabs ev-jump">
        <a className="voice-tab" href="#pay">Pay</a>
        <a className="voice-tab" href="#vendor">Vendors</a>
        <a className="voice-tab" href="#reports">Reports</a>
      </div>

      <PaySection />
      <VendorSection />
      <ReportsSection />
    </div>
  )
}
