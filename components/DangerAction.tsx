'use client'

import { ReactNode, useState } from 'react'

// Reusable "type the word to confirm" destructive-action dialog. Used for
// delete account + delete community. onConfirm runs the action and returns
// { error } to display; on success it should navigate away (sign out + redirect),
// so the dialog doesn't need a success state.
export function DangerAction({
  trigger, title, body, confirmWord, confirmLabel, onConfirm, dark = false,
}: {
  trigger: (open: () => void) => ReactNode
  title: string
  body: ReactNode
  confirmWord: string
  confirmLabel: string
  onConfirm: () => Promise<{ ok?: boolean; error?: string }>
  dark?: boolean
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
    // Success: close. (Self-delete flows navigate away first; for in-place
    // deletes like the Platform Console, closing returns to the refreshed list.)
    setBusy(false); setOpen(false)
  }

  // Palette: light (resident/admin) vs the Platform Console dark + orange theme.
  const t = dark
    ? { panel: '#16191f', borderC: '#272c36', title: '#eceef2', body: '#c2c7d0', label: '#8b929e',
        inputBg: '#0b0d12', inputBorder: '#272c36', inputText: '#eceef2',
        keepBg: 'transparent', keepBorder: '#272c36', keepText: '#eceef2',
        overlay: 'rgba(4,6,10,0.66)', errBg: 'rgba(229,99,99,0.13)', errText: '#E97070',
        goReady: '#E0492B', goIdle: '#3a2a26' }
    : { panel: '#fff', borderC: 'transparent', title: '#1a0d07', body: '#4a3a2c', label: '#6b5544',
        inputBg: '#fff', inputBorder: '#d8cfc4', inputText: '#1a0d07',
        keepBg: '#fff', keepBorder: '#d8cfc4', keepText: '#3a2a1c',
        overlay: 'rgba(20,10,4,0.5)', errBg: '#fdecec', errText: '#a32020',
        goReady: '#c5341a', goIdle: '#e7b9ad' }

  return (
    <>
      {trigger(() => { setOpen(true); setVal(''); setErr(null) })}
      {open && (
        <div onClick={() => !busy && setOpen(false)} style={{
          position: 'fixed', inset: 0, zIndex: 200, background: t.overlay,
          display: 'grid', placeItems: 'center', padding: 20,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: '100%', maxWidth: 440, background: t.panel, border: `1px solid ${t.borderC}`, borderRadius: 16,
            padding: '22px 24px', boxShadow: '0 24px 60px rgba(0,0,0,0.4)',
          }}>
            <h2 style={{ margin: '0 0 10px', fontSize: 18, fontWeight: 800, color: t.title }}>{title}</h2>
            <div style={{ fontSize: 13.5, color: t.body, lineHeight: 1.55 }}>{body}</div>
            <label style={{ display: 'block', marginTop: 14, fontSize: 12.5, color: t.label }}>
              Type <strong>{confirmWord}</strong> to confirm
              <input value={val} onChange={(e) => setVal(e.target.value)} autoFocus
                style={{ display: 'block', width: '100%', marginTop: 6, padding: '10px 12px', borderRadius: 9, border: `1px solid ${t.inputBorder}`, background: t.inputBg, color: t.inputText, fontSize: 14 }} />
            </label>
            {err && <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, background: t.errBg, color: t.errText, fontSize: 13 }}>{err}</div>}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button onClick={() => setOpen(false)} disabled={busy}
                style={{ flex: 1, padding: '11px', borderRadius: 999, border: `1px solid ${t.keepBorder}`, background: t.keepBg, fontWeight: 700, fontSize: 14, cursor: 'pointer', color: t.keepText }}>
                Keep it
              </button>
              <button onClick={run} disabled={busy || !ready}
                style={{ flex: 1, padding: '11px', borderRadius: 999, border: 'none', background: ready ? t.goReady : t.goIdle, color: '#fff', fontWeight: 800, fontSize: 14, cursor: busy ? 'default' : 'pointer' }}>
                {busy ? 'Working…' : confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
