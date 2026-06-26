'use client'

// Public estoppel front door — a title/closing company (no Residente login)
// requests an estoppel certificate and pays the statutory fee. Driven entirely
// by the create-estoppel-checkout edge function (validated by the per-community
// token); on payment the stripe-webhook creates the request in the board's
// worklist. Standalone, unauthenticated — mirrors app/verify/[voteId].

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type Info = { community_name: string; association_type: string; base_fee: number; expedited_fee: number }

const wrap: React.CSSProperties = { maxWidth: 560, margin: '0 auto', padding: '40px 20px 80px', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', color: '#1F2233' }
const card: React.CSSProperties = { border: '1px solid #E4E7EC', borderRadius: 16, padding: '28px 28px', background: '#fff', boxShadow: '0 1px 3px rgba(16,24,40,.05)' }
const label: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, marginTop: 16 }
const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: 14, border: '1px solid #D0D5DD', borderRadius: 9, background: '#fff', color: '#1F2233' }
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

export default function EstoppelRequestPage() {
  const params = useParams()
  const token = String(params?.token ?? '')
  const [info, setInfo] = useState<Info | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'invalid' | 'disabled'>('loading')
  const [form, setForm] = useState({ requestor_name: '', requestor_email: '', requestor_type: 'mortgagee', unit_label: '', expedited: false })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data, error } = await supabase.functions.invoke('create-estoppel-checkout', { body: { token, action: 'info' } })
        if (cancelled) return
        if (error || !data?.ok) {
          const code = (data as any)?.code
          setPhase(code === 'disabled' ? 'disabled' : 'invalid')
          return
        }
        setInfo(data as Info)
        setPhase('ready')
      } catch {
        if (!cancelled) setPhase('invalid')
      }
    })()
    return () => { cancelled = true }
  }, [token])

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }))
  const isCondo = (info?.association_type || 'condo') !== 'hoa'
  const cite = isCondo ? 'FS 718.116(8)' : 'FS 720.30851'
  const feeTotal = info ? info.base_fee + (form.expedited ? info.expedited_fee : 0) : 0

  const submit = async (e: any) => {
    e.preventDefault()
    setError(''); setSubmitting(true)
    try {
      const { data, error } = await supabase.functions.invoke('create-estoppel-checkout', {
        body: { token, ...form },
      })
      if (error) throw new Error((error as any).message || 'Could not start checkout.')
      const url = (data as any)?.error ? null : (data as any)?.url
      if ((data as any)?.error) throw new Error((data as any).error)
      if (!url) throw new Error('Could not start checkout.')
      window.location.href = url
    } catch (err: any) {
      setError(err?.message || 'Could not start checkout.')
      setSubmitting(false)
    }
  }

  if (phase === 'loading') return <div style={wrap}>Loading…</div>
  if (phase === 'invalid') return (
    <div style={wrap}><div style={card}><h1 style={{ fontSize: 20, margin: 0 }}>Link not found</h1>
      <p style={{ color: '#667085', fontSize: 14 }}>This estoppel request link isn't valid. Please contact the association for a current link.</p></div></div>
  )
  if (phase === 'disabled') return (
    <div style={wrap}><div style={card}><h1 style={{ fontSize: 20, margin: 0 }}>Online requests are closed</h1>
      <p style={{ color: '#667085', fontSize: 14 }}>{info?.community_name || 'This community'} isn't accepting estoppel requests online right now. Please contact the association directly.</p></div></div>
  )

  return (
    <div style={wrap}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#E14909', marginBottom: 8 }}>Estoppel Certificate Request</div>
      <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>{info?.community_name}</h1>
      <p style={{ color: '#667085', fontSize: 14, marginTop: 0 }}>
        Request an estoppel certificate for a closing or refinance. The statutory fee ({cite}) is collected securely below; the association delivers the certificate within the statutory window ({form.expedited ? '3' : '10'} business days).
      </p>

      <form style={card} onSubmit={submit}>
        <label style={label}>Requesting party / company<input style={input} value={form.requestor_name} onChange={e => set('requestor_name', e.target.value)} placeholder="Acme Title Company" /></label>
        <label style={label}>Email (for delivery)<input style={input} type="email" value={form.requestor_email} onChange={e => set('requestor_email', e.target.value)} placeholder="closing@acmetitle.com" /></label>
        <label style={label}>Unit / parcel<input style={input} value={form.unit_label} onChange={e => set('unit_label', e.target.value)} placeholder="Unit 214 / 123 Main St" /></label>
        <label style={label}>Requesting as
          <select style={input} value={form.requestor_type} onChange={e => set('requestor_type', e.target.value)}>
            <option value="mortgagee">Lender / mortgagee</option>
            <option value="mortgagee_designee">Title / closing agent (for lender)</option>
            <option value="owner_designee">Title / closing agent (for owner)</option>
            <option value="owner">Owner</option>
          </select>
        </label>

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 18, fontSize: 14, cursor: 'pointer' }}>
          <input type="checkbox" checked={form.expedited} onChange={e => set('expedited', e.target.checked)} style={{ marginTop: 3 }} />
          <span>Expedited delivery (3 business days){info ? ` — +${money(info.expedited_fee)}` : ''}</span>
        </label>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 22, paddingTop: 18, borderTop: '1px solid #EAECF0' }}>
          <div><div style={{ fontSize: 12, color: '#667085' }}>Total fee</div><div style={{ fontSize: 22, fontWeight: 700 }}>{money(feeTotal)}</div></div>
          <button type="submit" disabled={submitting}
            style={{ background: '#E14909', color: '#fff', border: 'none', padding: '12px 22px', borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: submitting ? 'default' : 'pointer', opacity: submitting ? 0.7 : 1 }}>
            {submitting ? 'Starting…' : 'Continue to payment'}
          </button>
        </div>
        {error && <div style={{ color: '#B42318', fontSize: 13, marginTop: 12 }}>{error}</div>}
        <p style={{ fontSize: 11.5, color: '#98A2B3', marginTop: 16, lineHeight: 1.5 }}>
          Secure payment by Stripe. By the statute, if the certificate is not delivered within the required window, the fee is waived/refunded. This is not legal advice.
        </p>
      </form>
    </div>
  )
}
