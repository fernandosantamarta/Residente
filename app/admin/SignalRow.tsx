// Shared clean advisory-signal row for the compliance pages. Renders a domain
// ComplianceSignal as a white card with a severity PILL (matching the Compliance
// hub's "Needs attention" rows) instead of the old colored left-accent stripe.

import type { ComplianceSignal, Severity } from '@/lib/compliance/rules-core'

const SEV: Record<Severity, { label: string; color: string; bg: string }> = {
  overdue: { label: 'Overdue', color: '#B42318', bg: 'rgba(180,35,24,0.08)' },
  soon:    { label: 'Due soon', color: '#B54708', bg: 'rgba(181,71,8,0.08)' },
  info:    { label: 'To do', color: '#175CD3', bg: 'rgba(23,92,211,0.07)' },
}

export function SignalRow({ signal: s }: { signal: ComplianceSignal }) {
  const m = SEV[s.severity] || SEV.info
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: '0 1px 2px rgba(42, 18, 6, 0.05)', padding: '12px 14px' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', color: m.color, background: m.bg, padding: '3px 10px', borderRadius: 999, whiteSpace: 'nowrap', marginTop: 1 }}>{m.label}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{s.title}</div>
          {s.detail && <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginTop: 2 }}>{s.detail}</div>}
        </div>
      </div>
    </div>
  )
}
