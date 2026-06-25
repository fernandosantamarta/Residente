'use client'

// Public, no-login page behind the vendor's secure quote link
// (/wo-quote/[token]). The vendor sees the job and submits their price; it all
// goes through the work-order-quote edge function (the token is the credential).
// Standalone — no auth, no app shell, no community context.

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase, hasSupabase } from '@/lib/supabase'

type Ctx = {
  title: string | null
  description: string | null
  priority: string | null
  sla_due_at: string | null
  location: string | null
  community: string
  vendor: string
  quote_status: string
  quoted_cost: number | null
  quote_note: string | null
}

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : ''

export default function VendorQuotePage() {
  const params = useParams<{ token: string }>()
  const token = params?.token as string
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'done'>('loading')
  const [err, setErr] = useState('')
  const [ctx, setCtx] = useState<Ctx | null>(null)
  const [cost, setCost] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!hasSupabase || !supabase || !token) { setStatus('error'); setErr('This link is not available.'); return }
    let cancelled = false
    ;(async () => {
      try {
        const { data, error } = await supabase!.functions.invoke('work-order-quote', { body: { token, action: 'get' } })
        if (cancelled) return
        if (error || (data as any)?.error) { setErr((data as any)?.error || 'This quote link is invalid or has expired.'); setStatus('error'); return }
        const c = (data as any).context as Ctx
        setCtx(c)
        if (c.quoted_cost != null) setCost(String(c.quoted_cost))
        if (c.quote_note) setNote(c.quote_note)
        setStatus('ready')
      } catch {
        if (!cancelled) { setErr('Could not load this quote.'); setStatus('error') }
      }
    })()
    return () => { cancelled = true }
  }, [token])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const amount = Number(cost)
    if (!isFinite(amount) || amount < 0) { setErr('Enter a valid amount.'); return }
    setSaving(true); setErr('')
    try {
      const { data, error } = await supabase!.functions.invoke('work-order-quote', {
        body: { token, action: 'submit', cost: amount, note },
      })
      if (error || (data as any)?.error) { setErr((data as any)?.error || 'Could not send your quote.'); setSaving(false); return }
      setStatus('done')
    } catch {
      setErr('Could not send your quote.'); setSaving(false)
    }
  }

  const wrap: React.CSSProperties = { minHeight: '100vh', background: '#F6F5F1', fontFamily: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif', color: '#1F2233', padding: '32px 18px', display: 'flex', justifyContent: 'center' }
  const card: React.CSSProperties = { width: '100%', maxWidth: 480, background: 'white', borderRadius: 16, padding: '26px 24px', boxShadow: '0 8px 40px rgba(10,36,64,0.08)' }
  const label: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 700, color: '#6b6f7d', marginBottom: 5, marginTop: 16 }
  const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '11px 12px', fontSize: 15, border: '1px solid rgba(10,36,64,0.16)', borderRadius: 9, outline: 'none', fontFamily: 'inherit' }
  const badge: React.CSSProperties = { display: 'inline-block', padding: '4px 10px', background: '#E14909', color: 'white', borderRadius: 999, fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 14 }

  if (status === 'loading') return <div style={wrap}><div style={card}>Loading…</div></div>
  if (status === 'error') return <div style={wrap}><div style={card}><div style={badge}>Quote</div><h1 style={{ fontSize: 19, margin: '0 0 8px' }}>Hmm.</h1><p style={{ color: '#6b6f7d', fontSize: 14 }}>{err}</p></div></div>
  if (status === 'done') return (
    <div style={wrap}><div style={card}>
      <div style={badge}>Quote sent</div>
      <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>Thank you!</h1>
      <p style={{ color: '#444', fontSize: 14, lineHeight: 1.55 }}>Your quote for <strong>{ctx?.title}</strong> was sent to {ctx?.community}. They'll review it and get back to you. You can close this page.</p>
    </div></div>
  )

  const alreadyApproved = ctx?.quote_status === 'approved'
  return (
    <div style={wrap}>
      <div style={card}>
        <div style={badge}>Work order</div>
        <p style={{ margin: '0 0 4px', fontSize: 13, color: '#6b6f7d' }}>{ctx?.community} · for {ctx?.vendor || 'you'}</p>
        <h1 style={{ fontSize: 21, margin: '0 0 14px' }}>{ctx?.title}</h1>
        <div style={{ background: '#F6F7F9', borderRadius: 11, padding: '14px 16px', marginBottom: 8, fontSize: 13.5, lineHeight: 1.55 }}>
          {ctx?.description && <div style={{ marginBottom: 10 }}>{ctx.description}</div>}
          {ctx?.location && <div><strong>Location:</strong> {ctx.location}</div>}
          {ctx?.priority && <div><strong>Priority:</strong> {ctx.priority.charAt(0).toUpperCase() + ctx.priority.slice(1)}</div>}
          {ctx?.sla_due_at && <div><strong>Target date:</strong> {fmtDate(ctx.sla_due_at)}</div>}
        </div>

        {alreadyApproved ? (
          <p style={{ color: '#067647', fontSize: 14, fontWeight: 600, marginTop: 16 }}>✓ Your quote of ${Number(ctx?.quoted_cost).toLocaleString('en-US', { minimumFractionDigits: 2 })} was approved. Thanks!</p>
        ) : (
          <form onSubmit={submit}>
            {ctx?.quote_status === 'submitted' && (
              <p style={{ fontSize: 12.5, color: '#6b6f7d', marginTop: 14 }}>You already submitted a quote — you can update it below.</p>
            )}
            <label style={label}>Your price for this job (USD)</label>
            <input style={input} type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={cost} onChange={e => setCost(e.target.value)} required />
            <label style={label}>Note (optional)</label>
            <textarea style={{ ...input, minHeight: 80, resize: 'vertical' }} placeholder="Anything the board should know…" value={note} onChange={e => setNote(e.target.value)} />
            {err && <p style={{ color: '#C0392B', fontSize: 13, marginTop: 12 }}>{err}</p>}
            <button type="submit" disabled={saving} style={{ marginTop: 18, width: '100%', padding: '13px', background: '#E14909', color: 'white', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Sending…' : 'Send quote'}
            </button>
          </form>
        )}
        <p style={{ fontSize: 11.5, color: '#9aa', marginTop: 22, textAlign: 'center' }}>Powered by Residente</p>
      </div>
    </div>
  )
}
