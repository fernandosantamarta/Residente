'use client'

// Public estoppel front-door success page. The fee is paid; the stripe-webhook
// has created (or will shortly create) the request in the board's worklist.
// Standalone + unauthenticated, like the request form.

const wrap: React.CSSProperties = { maxWidth: 560, margin: '0 auto', padding: '64px 20px', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', color: '#1F2233', textAlign: 'center' }

export default function EstoppelRequestSuccess() {
  return (
    <div style={wrap}>
      <div style={{ width: 56, height: 56, borderRadius: 999, background: '#ECFDF3', color: '#067647', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 800, margin: '0 auto 18px' }}>✓</div>
      <h1 style={{ fontSize: 24, margin: '0 0 8px' }}>Request received</h1>
      <p style={{ color: '#667085', fontSize: 15, lineHeight: 1.6, maxWidth: 440, margin: '0 auto' }}>
        Your estoppel fee has been paid and your request is now with the association. The certificate will be delivered to the email you provided within the statutory window. A receipt has been emailed by Stripe.
      </p>
      <p style={{ color: '#98A2B3', fontSize: 12.5, marginTop: 24 }}>You can close this window.</p>
    </div>
  )
}
