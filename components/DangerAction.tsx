'use client'

import { ReactNode, useState } from 'react'

// Reusable "type the word to confirm" destructive-action dialog. Used for
// delete account + delete community. onConfirm runs the action and returns
// { error } to display; on success it should navigate away (sign out + redirect),
// so the dialog doesn't need a success state.
export function DangerAction({
  trigger, title, body, confirmWord, confirmLabel, onConfirm,
}: {
  trigger: (open: () => void) => ReactNode
  title: string
  body: ReactNode
  confirmWord: string
  confirmLabel: string
  onConfirm: () => Promise<{ ok?: boolean; error?: string }>
}) {
  const [open, setOpen] = useState(false)
  const [val, setVal] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const ready = val.trim() === confirmWord
  const run = async () => {
    if (!ready) return
    setBusy(true); setErr(null)
    const r = await onConfirm()
    if (r?.error) { setErr(r.error); setBusy(false); return }
    // success → onConfirm navigated away; leave the dialog up under the redirect.
  }

  return (
    <>
      {trigger(() => { setOpen(true); setVal(''); setErr(null) })}
      {open && (
        <div onClick={() => !busy && setOpen(false)} style={{
          position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(20,10,4,0.5)',
          display: 'grid', placeItems: 'center', padding: 20,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: '100%', maxWidth: 440, background: '#fff', borderRadius: 16,
            padding: '22px 24px', boxShadow: '0 24px 60px rgba(40,15,0,0.32)',
          }}>
            <h2 style={{ margin: '0 0 10px', fontSize: 18, fontWeight: 800, color: '#1a0d07' }}>{title}</h2>
            <div style={{ fontSize: 13.5, color: '#4a3a2c', lineHeight: 1.55 }}>{body}</div>
            <label style={{ display: 'block', marginTop: 14, fontSize: 12.5, color: '#6b5544' }}>
              Type <strong>{confirmWord}</strong> to confirm
              <input value={val} onChange={(e) => setVal(e.target.value)} autoFocus
                style={{ display: 'block', width: '100%', marginTop: 6, padding: '10px 12px', borderRadius: 9, border: '1px solid #d8cfc4', fontSize: 14 }} />
            </label>
            {err && <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, background: '#fdecec', color: '#a32020', fontSize: 13 }}>{err}</div>}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button onClick={() => setOpen(false)} disabled={busy}
                style={{ flex: 1, padding: '11px', borderRadius: 999, border: '1px solid #d8cfc4', background: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', color: '#3a2a1c' }}>
                Keep it
              </button>
              <button onClick={run} disabled={busy || !ready}
                style={{ flex: 1, padding: '11px', borderRadius: 999, border: 'none', background: ready ? '#c5341a' : '#e7b9ad', color: '#fff', fontWeight: 800, fontSize: 14, cursor: busy ? 'default' : 'pointer' }}>
                {busy ? 'Working…' : confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
