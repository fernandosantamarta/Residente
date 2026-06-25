'use client'

// Structured minutes capture — draft + publish the official minutes of a meeting
// from a section template (FS 718.111(12) / 720.303(4): minutes are official
// records owners may inspect). Loads the meeting, its template (or the per-type
// default from lib/compliance/minutes-templates.ts), and the attendance count,
// then renders the sections dynamically. "Save draft" upserts meeting_minutes
// (status='draft') and marks ev_meetings.minutes_status='draft'; "Publish" sets
// status='published', stamps minutes_published_at, and logs an audit event.
//
// Aid only — the default sections + secretary certification are starting points;
// confirm against the governing documents and Florida counsel before adopting.

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams } from 'next/navigation'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { logAudit } from '@/lib/audit'
import { useT } from '@/lib/i18n'
import { Dropdown } from '@/components/Dropdown'
import { extractMinutesFromFile, type ExtractedMinutes } from '@/lib/signupImport'
import {
  defaultTemplate,
  seedSectionsData,
  emptyRow,
  visibleSections,
  type MinutesTemplate,
  type SectionSchema,
  type FieldSchema,
} from '@/lib/compliance/minutes-templates'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

export default function MinutesCapturePage() {
  const t = useT()
  const params = useParams()
  const meetingId = params?.id as string
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id

  const [meeting, setMeeting] = useState<any>(null)
  const [attendanceCount, setAttendanceCount] = useState(0)
  const [template, setTemplate] = useState<MinutesTemplate>([])
  const [minutesRow, setMinutesRow] = useState<any>(null)
  const [data, setData] = useState<Record<string, any>>({})
  const [status, setStatus] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)

  useEffect(() => {
    if (!msg) return
    const tm = setTimeout(() => setMsg(''), 4000)
    return () => clearTimeout(tm)
  }, [msg])

  const load = useCallback(async () => {
    if (!hasSupabase || !meetingId) { setStatus('none'); return }
    setStatus('loading'); setError('')
    try {
      const { data: m, error: mErr } = (await withTimeout(
        supabase.from('ev_meetings').select('*').eq('id', meetingId).single(),
      )) as any
      if (mErr) throw mErr
      if (!m) { setStatus('none'); return }

      // Attendance count, the captured minutes (if any), and a community template
      // override (if any) are independent reads — fire them in one parallel batch.
      const [attRes, minRes, tplRes] = await Promise.all([
        withTimeout(
          supabase.from('ev_attendance').select('id', { count: 'exact', head: true }).eq('meeting_id', meetingId),
        ),
        withTimeout(
          supabase.from('meeting_minutes').select('*').eq('meeting_id', meetingId).maybeSingle(),
        ),
        m.minutes_template_id
          ? withTimeout(supabase.from('minutes_templates').select('*').eq('id', m.minutes_template_id).maybeSingle())
          : withTimeout(
              supabase.from('minutes_templates').select('*')
                .eq('community_id', m.community_id).eq('meeting_type', String(m.type ?? 'board')).eq('name', 'Default')
                .maybeSingle(),
            ),
      ])

      const count = ((attRes as any)?.count) ?? 0
      const existing = (minRes as any)?.data ?? null
      const tplOverride = (tplRes as any)?.data ?? null

      const tpl: MinutesTemplate =
        tplOverride && Array.isArray(tplOverride.sections) && tplOverride.sections.length
          ? (tplOverride.sections as MinutesTemplate)
          : defaultTemplate(m.type)

      setMeeting(m)
      setAttendanceCount(count)
      setTemplate(tpl)
      setMinutesRow(existing)
      setData(
        existing && existing.sections_data && Object.keys(existing.sections_data).length
          ? existing.sections_data
          : seedSectionsData(tpl, m, count),
      )
      setStatus('ready')
    } catch (err: any) {
      setError(err?.message || t('admin.minutes.errorLoad')); setStatus('error')
    }
  }, [meetingId])

  useEffect(() => { load() }, [load])

  const sections = useMemo(
    () => visibleSections(template, meeting || {}),
    [template, meeting],
  )

  // ---- value mutators ----
  const setFixed = (sectionId: string, fieldId: string, val: any) =>
    setData(d => ({ ...d, [sectionId]: { ...(d[sectionId] || {}), [fieldId]: val } }))

  const setRowField = (sectionId: string, idx: number, fieldId: string, val: any) =>
    setData(d => {
      const rows: any[] = Array.isArray(d[sectionId]) ? [...d[sectionId]] : []
      rows[idx] = { ...(rows[idx] || {}), [fieldId]: val }
      return { ...d, [sectionId]: rows }
    })

  const addRow = (section: SectionSchema) =>
    setData(d => {
      const rows: any[] = Array.isArray(d[section.id]) ? [...d[section.id]] : []
      rows.push(emptyRow(section))
      return { ...d, [section.id]: rows }
    })

  const removeRow = (sectionId: string, idx: number) =>
    setData(d => {
      const rows: any[] = Array.isArray(d[sectionId]) ? [...d[sectionId]] : []
      rows.splice(idx, 1)
      return { ...d, [sectionId]: rows }
    })

  // ---- AI: read a minutes PDF/photo → suggested motions + action items ----
  // Display-only until the board clicks "Add to minutes"; nothing auto-saves.
  const [minBusy, setMinBusy] = useState(false)
  const [minExtract, setMinExtract] = useState<ExtractedMinutes | null>(null)
  const [minErr, setMinErr] = useState('')
  const minFileRef = useRef<HTMLInputElement>(null)

  const onPickMinutes = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setMinBusy(true); setMinErr(''); setMinExtract(null)
    try {
      const ex = await extractMinutesFromFile(file)
      if (ex && (ex.motions.length || ex.action_items.length)) setMinExtract(ex)
      else setMinErr(t('admin.minutes.aiUnavailable'))
    } catch {
      setMinErr(t('admin.minutes.aiUnavailable'))
    } finally {
      setMinBusy(false)
    }
  }

  // Append the reviewed motions + action items into the repeating sections, using
  // the page's own sections_data shape (emptyRow + field ids). Skips fields whose
  // value is undefined or whose id isn't on the section schema.
  const addExtractedToMinutes = () => {
    if (!minExtract) return
    const motionsSec = template.find(s => s.id === 'motions')
    const actionsSec = template.find(s => s.id === 'action_items')
    const has = (sec: SectionSchema | undefined, id: string) => !!sec?.fields.some(f => f.id === id)

    setData(d => {
      const next = { ...d }
      if (motionsSec && minExtract.motions.length) {
        const rows: any[] = Array.isArray(next.motions) ? [...next.motions] : []
        for (const m of minExtract.motions) {
          const row = emptyRow(motionsSec)
          if (m.motion !== undefined && has(motionsSec, 'motion')) row.motion = m.motion
          if (m.moved_by !== undefined && has(motionsSec, 'moved_by')) row.moved_by = m.moved_by
          if (m.seconded_by !== undefined && has(motionsSec, 'seconded_by')) row.seconded_by = m.seconded_by
          if (m.votes_for !== undefined && has(motionsSec, 'votes_for')) row.votes_for = m.votes_for
          if (m.votes_against !== undefined && has(motionsSec, 'votes_against')) row.votes_against = m.votes_against
          if (m.votes_abstain !== undefined && has(motionsSec, 'votes_abstain')) row.votes_abstain = m.votes_abstain
          if (m.outcome !== undefined && has(motionsSec, 'outcome')) row.outcome = m.outcome
          rows.push(row)
        }
        next.motions = rows
      }
      if (actionsSec && minExtract.action_items.length) {
        const rows: any[] = Array.isArray(next.action_items) ? [...next.action_items] : []
        for (const a of minExtract.action_items) {
          const row = emptyRow(actionsSec)
          if (a.action !== undefined && has(actionsSec, 'action')) row.action = a.action
          if (a.owner !== undefined && has(actionsSec, 'owner')) row.owner = a.owner
          if (a.due !== undefined && has(actionsSec, 'due')) row.due = a.due
          rows.push(row)
        }
        next.action_items = rows
      }
      return next
    })

    setMsg(t('admin.minutes.aiAdded', { motions: minExtract.motions.length, actions: minExtract.action_items.length }))
    setMinExtract(null)
  }

  // ---- persistence ----
  const upsertMinutes = async (nextStatus: 'draft' | 'published') => {
    const now = new Date().toISOString()
    const row: Record<string, any> = {
      meeting_id: meetingId,
      community_id: meeting.community_id,
      template_id: minutesRow?.template_id ?? meeting?.minutes_template_id ?? null,
      sections_data: data,
      status: nextStatus,
      updated_at: now,
    }
    if (nextStatus === 'draft') row.draft_at = now
    if (!minutesRow) row.created_by = profile?.id ?? null
    const { data: saved, error: upErr } = (await withTimeout(
      supabase.from('meeting_minutes').upsert(row, { onConflict: 'meeting_id' }).select().single(),
    )) as any
    if (upErr) throw upErr
    return saved
  }

  const saveDraft = async () => {
    setSaving(true); setError('')
    try {
      const saved = await upsertMinutes('draft')
      await withTimeout(supabase.from('ev_meetings').update({ minutes_status: 'draft' }).eq('id', meetingId))
      setMinutesRow(saved)
      setMsg(t('admin.minutes.draftSaved'))
    } catch (err: any) {
      setError(err?.message || t('admin.minutes.errorSave'))
    } finally { setSaving(false) }
  }

  const publish = async () => {
    setPublishing(true); setError('')
    try {
      const saved = await upsertMinutes('published')
      const now = new Date().toISOString()
      await withTimeout(
        supabase.from('ev_meetings').update({ minutes_status: 'published', minutes_published_at: now }).eq('id', meetingId),
      )
      setMinutesRow(saved)
      if (communityId) {
        logAudit({
          community_id: communityId,
          event_type: 'meeting.minutes_published',
          target_type: 'meeting',
          target_id: meetingId,
          metadata: { structured: true },
        })
      }
      setMeeting((m: any) => ({ ...m, minutes_status: 'published', minutes_published_at: now }))
      setMsg(t('admin.minutes.published'))
    } catch (err: any) {
      setError(err?.message || t('admin.minutes.errorPublish'))
    } finally { setPublishing(false) }
  }

  const isPublished = String(meeting?.minutes_status ?? '') === 'published' || String(minutesRow?.status ?? '') === 'published'

  return (
    <div className="admin-page cset">
      <a href="/admin/meetings" className="admin-btn-ghost" style={{ alignSelf: 'flex-start' }}>← {t('admin.minutes.backToMeetings')}</a>
      <div className="admin-kicker">{t('admin.minutes.kicker')}</div>
      <h1 className="admin-h1">{t('admin.minutes.pageTitle')}</h1>
      <p className="admin-dek">{t('admin.minutes.pageDescription')}</p>

      {msg && <div className="admin-success" role="status"><span className="admin-success-check" aria-hidden>✓</span>{msg}</div>}
      {status === 'none' && <div className="admin-note admin-note-warn">{t('admin.minutes.meetingNotFound')}</div>}
      {status === 'error' && <div className="admin-note admin-note-err">{error}<button type="button" className="admin-btn-ghost" onClick={load}>{t('admin.minutes.retry')}</button></div>}
      {status === 'loading' && <div className="admin-note">{t('admin.minutes.loading')}</div>}

      {status === 'ready' && meeting && (
        <>
          <div className="admin-note">
            {meeting.title || t('admin.minutes.untitledMeeting')}
            {' · '}{t('admin.minutes.attendees', { count: attendanceCount })}
            {isPublished && <> · <strong>{t('admin.minutes.statusPublished')}</strong></>}
          </div>

          <div className="card">
            <div className="card-head"><div><h2>{t('admin.minutes.aiHeading')}</h2></div></div>
            <p className="admin-note" style={{ marginTop: 0 }}>{t('admin.minutes.aiSub')}</p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" className="admin-secondary-btn" disabled={minBusy} onClick={() => minFileRef.current?.click()}>
                {minBusy ? t('admin.minutes.aiReading') : t('admin.minutes.aiBtn')}
              </button>
              <input
                ref={minFileRef}
                type="file"
                accept=".pdf,application/pdf,image/png,image/jpeg,image/webp"
                onChange={onPickMinutes}
                style={{ display: 'none' }}
              />
              {minErr && <span style={{ color: '#B42318', fontSize: 12.5 }}>{minErr}</span>}
            </div>

            {minExtract && (
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="admin-note" style={{ marginTop: 0 }}>
                  {t('admin.minutes.aiFound', { motions: minExtract.motions.length, actions: minExtract.action_items.length })}
                </div>

                {minExtract.motions.length > 0 && (
                  <div>
                    <h3 style={{ margin: '0 0 6px', fontSize: 13.5 }}>{t('admin.minutes.aiMotionsHeading')}</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {minExtract.motions.map((m, i) => (
                        <div key={i} style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10, padding: '10px 12px', background: '#fff' }}>
                          <div style={{ fontSize: 13.5 }}>{m.motion}</div>
                          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                            {t('admin.minutes.aiMoved')} {m.moved_by || '—'}
                            {' · '}{t('admin.minutes.aiSeconded')} {m.seconded_by || '—'}
                            {' · '}{m.votes_for ?? 0}–{m.votes_against ?? 0}–{m.votes_abstain ?? 0}
                            {m.outcome ? ` · ${m.outcome}` : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {minExtract.action_items.length > 0 && (
                  <div>
                    <h3 style={{ margin: '0 0 6px', fontSize: 13.5 }}>{t('admin.minutes.aiActionsHeading')}</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {minExtract.action_items.map((a, i) => (
                        <div key={i} style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10, padding: '10px 12px', background: '#fff' }}>
                          <div style={{ fontSize: 13.5 }}>{a.action}</div>
                          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                            {t('admin.minutes.aiOwner')} {a.owner || '—'}
                            {' · '}{t('admin.minutes.aiDue')} {a.due || '—'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="admin-primary-btn" onClick={addExtractedToMinutes}>{t('admin.minutes.aiAdd')}</button>
                  <button type="button" className="admin-btn-ghost" onClick={() => setMinExtract(null)}>{t('admin.minutes.aiDiscard')}</button>
                </div>
              </div>
            )}
          </div>

          {sections.map(section => (
            <div className="card" key={section.id}>
              <div className="card-head"><div><h2>{section.title}</h2></div></div>
              {section.help && <p className="admin-note" style={{ marginTop: 0 }}>{section.help}</p>}

              {section.repeating ? (
                <RepeatingSection
                  section={section}
                  rows={Array.isArray(data[section.id]) ? data[section.id] : []}
                  onRowChange={(idx, fid, v) => setRowField(section.id, idx, fid, v)}
                  onAdd={() => addRow(section)}
                  onRemove={idx => removeRow(section.id, idx)}
                  t={t}
                />
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                  {section.fields.map(f => (
                    <FieldInput
                      key={f.id}
                      field={f}
                      value={data[section.id]?.[f.id]}
                      onChange={v => setFixed(section.id, f.id, v)}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}

          <div className="card-cta" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {error && <span className="admin-err-inline">{error}</span>}
            <button type="button" className="admin-btn-ghost" onClick={saveDraft} disabled={saving || publishing}>
              {saving ? t('admin.minutes.saving') : t('admin.minutes.saveDraft')}
            </button>
            <button type="button" className="admin-primary-btn" onClick={publish} disabled={saving || publishing}>
              {publishing ? t('admin.minutes.publishing') : t('admin.minutes.publish')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------
// Repeating section (add / remove rows)
// ----------------------------------------------------------------------------
function RepeatingSection({
  section, rows, onRowChange, onAdd, onRemove, t,
}: {
  section: SectionSchema
  rows: any[]
  onRowChange: (idx: number, fieldId: string, val: any) => void
  onAdd: () => void
  onRemove: (idx: number) => void
  t: (k: string, v?: any) => string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {rows.length === 0 && <div className="admin-note" style={{ marginTop: 0 }}>{t('admin.minutes.noRows')}</div>}
      {rows.map((row, idx) => (
        <div key={idx} style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10, padding: '12px 14px', background: '#fff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, opacity: 0.7 }}>{t('admin.minutes.rowLabel', { n: idx + 1 })}</span>
            <button type="button" className="admin-btn-ghost" onClick={() => onRemove(idx)}>{t('admin.minutes.removeRow')}</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            {section.fields.map(f => (
              <FieldInput
                key={f.id}
                field={f}
                value={row?.[f.id]}
                onChange={v => onRowChange(idx, f.id, v)}
              />
            ))}
          </div>
        </div>
      ))}
      <div>
        <button type="button" className="admin-btn-ghost" onClick={onAdd}>+ {t('admin.minutes.addRow')}</button>
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------------
// Single field input (text / textarea / number / boolean / time / date / enum)
// ----------------------------------------------------------------------------
function FieldInput({
  field, value, onChange,
}: {
  field: FieldSchema
  value: any
  onChange: (val: any) => void
}) {
  if (field.type === 'boolean') {
    return (
      <label className="admin-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} />
        <span className="admin-field-label" style={{ margin: 0 }}>{field.label}</span>
      </label>
    )
  }

  if (field.type === 'enum') {
    return (
      <div className="admin-field">
        <span className="admin-field-label">{field.label}</span>
        <Dropdown<string>
          value={String(value ?? '')}
          onChange={v => onChange(v)}
          ariaLabel={field.label}
          options={(field.options || []).map(o => ({ value: o.value, label: o.label }))}
        />
      </div>
    )
  }

  if (field.type === 'textarea') {
    return (
      <label className="admin-field" style={{ gridColumn: '1 / -1' }}>
        <span className="admin-field-label">{field.label}</span>
        <textarea
          className="admin-input"
          rows={3}
          value={value ?? ''}
          placeholder={field.placeholder}
          onChange={e => onChange(e.target.value)}
        />
      </label>
    )
  }

  const inputType =
    field.type === 'number' ? 'number'
    : field.type === 'time' ? 'time'
    : field.type === 'date' ? 'date'
    : 'text'

  return (
    <label className="admin-field">
      <span className="admin-field-label">{field.label}</span>
      <input
        className="admin-input"
        type={inputType}
        value={value ?? ''}
        placeholder={field.placeholder}
        onChange={e => onChange(field.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
      />
    </label>
  )
}
