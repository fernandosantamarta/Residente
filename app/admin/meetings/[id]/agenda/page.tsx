'use client'

// Agenda builder — the board curates the real agenda for a meeting, which the
// statutory notice then prints (instead of "[Insert agenda items]") and the
// board packet assembles. "Auto agenda" without a new tracker: seed a standard
// agenda template, and carry forward the UNFINISHED action items from the most
// recent prior meeting's minutes (real data). Saves to ev_meetings.agenda_data.
//
// ⚠ The board owns the agenda's accuracy — business not on the noticed agenda
// generally can't be acted on. Educational, not legal advice.

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { supabase, hasSupabase } from '@/lib/supabase'
import { useT } from '@/lib/i18n'

const STANDARD_AGENDA = [
  "Treasurer's report",
  'Committee reports',
  'Old business',
  'New business',
]

export default function AgendaBuilderPage() {
  const t = useT()
  const params = useParams()
  const id = params?.id as string
  const [meeting, setMeeting] = useState<any>(null)
  const [items, setItems] = useState<string[]>([])
  const [carryForward, setCarryForward] = useState<string[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!hasSupabase || !id) { setStatus('error'); setError('No meeting'); return }
      try {
        const { data: m, error: mErr } = await supabase.from('ev_meetings').select('*').eq('id', id).single()
        if (mErr) throw mErr
        if (cancelled) return
        setMeeting(m)
        setItems(Array.isArray(m.agenda_data) ? m.agenda_data.filter((x: any) => typeof x === 'string') : [])

        // Carry-forward: the most recent PRIOR meeting's unfinished action items.
        try {
          const { data: priors } = await supabase.from('ev_meetings')
            .select('id, scheduled_at')
            .eq('community_id', m.community_id)
            .lt('scheduled_at', m.scheduled_at)
            .order('scheduled_at', { ascending: false })
            .limit(5)
          const priorIds = (priors || []).map((p: any) => p.id)
          if (priorIds.length) {
            const { data: mins } = await supabase.from('meeting_minutes')
              .select('meeting_id, sections_data').in('meeting_id', priorIds)
            // Walk priors newest-first; take the first with action items.
            for (const p of (priors || [])) {
              const row = (mins || []).find((x: any) => x.meeting_id === p.id)
              const actions = row?.sections_data?.action_items
              if (Array.isArray(actions) && actions.length) {
                setCarryForward(actions.map((a: any) => String(a?.action || '').trim()).filter(Boolean))
                break
              }
            }
          }
        } catch { /* minutes optional */ }
        setStatus('ready')
      } catch (err: any) {
        if (!cancelled) { setError(err?.message || 'Could not load'); setStatus('error') }
      }
    })()
    return () => { cancelled = true }
  }, [id])

  const setItem = (i: number, v: string) => setItems(arr => arr.map((x, j) => j === i ? v : x))
  const addItem = (v = '') => setItems(arr => [...arr, v])
  const removeItem = (i: number) => setItems(arr => arr.filter((_, j) => j !== i))
  const move = (i: number, dir: -1 | 1) => setItems(arr => {
    const j = i + dir
    if (j < 0 || j >= arr.length) return arr
    const next = [...arr]; [next[i], next[j]] = [next[j], next[i]]; return next
  })
  const seedStandard = () => setItems(arr => {
    const have = new Set(arr.map(s => s.toLowerCase().trim()))
    return [...arr, ...STANDARD_AGENDA.filter(s => !have.has(s.toLowerCase()))]
  })
  const addCarryForward = () => setItems(arr => {
    const have = new Set(arr.map(s => s.toLowerCase().trim()))
    const fresh = carryForward.filter(s => !have.has(s.toLowerCase().trim())).map(s => `Follow-up: ${s}`)
    return [...arr, ...fresh]
  })

  const save = async () => {
    setSaving(true); setError(''); setSaved(false)
    try {
      const clean = items.map(s => s.trim()).filter(Boolean)
      const { error } = await supabase.from('ev_meetings').update({ agenda_data: clean }).eq('id', id)
      if (error) throw error
      setItems(clean)
      setSaved(true); setTimeout(() => setSaved(false), 2500)
    } catch (err: any) { setError(err?.message || t('admin.agenda.errSave')) }
    finally { setSaving(false) }
  }

  if (status === 'loading') return <div className="admin-page cset"><div className="admin-note">{t('admin.agenda.loading')}</div></div>
  if (status === 'error') return <div className="admin-page cset"><div className="admin-note admin-note-err">{error}</div></div>

  return (
    <div className="admin-page cset">
      <Link href="/admin/meetings" className="admin-btn-ghost" style={{ display: 'inline-block', marginBottom: 12 }}>← {t('admin.agenda.backToMeetings')}</Link>
      <div className="admin-kicker">{t('admin.agenda.kicker')}</div>
      <h1 className="admin-h1">{t('admin.agenda.pageTitle')}</h1>
      <p className="admin-dek">{meeting?.title} — {t('admin.agenda.dek')}</p>

      {saved && <div className="admin-success" role="status"><span className="admin-success-check" aria-hidden>✓</span>{t('admin.agenda.saved')}</div>}
      {error && <div className="admin-note admin-note-err">{error}</div>}

      <div className="card">
        <div className="card-head"><div><h2>{t('admin.agenda.itemsTitle')}</h2><div className="sub">{t('admin.agenda.itemsSub')}</div></div></div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.length === 0 && <div className="admin-note" style={{ margin: 0 }}>{t('admin.agenda.empty')}</div>}
          {items.map((item, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ width: 22, textAlign: 'right', opacity: 0.5, fontSize: 13 }}>{i + 1}.</span>
              <input className="admin-input" value={item} onChange={e => setItem(i, e.target.value)} style={{ flex: 1 }} placeholder={t('admin.agenda.itemPlaceholder')} />
              <button type="button" className="admin-btn-ghost" style={{ padding: '4px 8px' }} onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
              <button type="button" className="admin-btn-ghost" style={{ padding: '4px 8px' }} onClick={() => move(i, 1)} disabled={i === items.length - 1}>↓</button>
              <button type="button" onClick={() => removeItem(i)} style={{ background: 'none', border: 'none', color: '#B42318', cursor: 'pointer', fontSize: 18, padding: '0 6px' }}>×</button>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button type="button" className="admin-btn-ghost" onClick={() => addItem('')}>{t('admin.agenda.addItem')}</button>
          <button type="button" className="admin-btn-ghost" onClick={seedStandard}>{t('admin.agenda.seedStandard')}</button>
          {carryForward.length > 0 && (
            <button type="button" className="admin-btn-ghost" onClick={addCarryForward}>{t('admin.agenda.carryForward', { count: carryForward.length })}</button>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className="admin-primary-btn" onClick={save} disabled={saving}>{saving ? t('admin.agenda.saving') : t('admin.agenda.saveBtn')}</button>
          <a className="admin-btn-ghost" href={`/admin/meetings/${id}/document?type=agenda`} target="_blank" rel="noopener noreferrer">{t('admin.agenda.previewNotice')}</a>
          <a className="admin-btn-ghost" href={`/admin/meetings/${id}/packet`} target="_blank" rel="noopener noreferrer">{t('admin.agenda.openPacket')}</a>
        </div>

        {meeting?.is_budget_meeting || meeting?.affects_assessments || meeting?.affects_use_rules ? (
          <p style={{ fontSize: 12, opacity: 0.7, marginTop: 12 }}>{t('admin.agenda.autoItemsNote')}</p>
        ) : null}
      </div>
    </div>
  )
}
