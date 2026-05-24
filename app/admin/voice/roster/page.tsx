'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { logAudit } from '@/lib/audit'
import {
  parseRosterCsv, validateRoster, isImportable,
  type RosterRow,
} from '@/lib/voiceRoster'

const withTimeout = <T,>(p: PromiseLike<T>, ms = 10000): Promise<T> =>
  Promise.race([
    p as Promise<T>,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

type OwnerListRow = {
  id: string
  full_name: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  invited_at: string | null
  activated_at: string | null
  unit_id: string | null
  unit_number: string | null
}

export default function VoiceRosterPage() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id || null

  const [owners, setOwners]     = useState<OwnerListRow[]>([])
  const [units, setUnits]       = useState<Array<{ id: string; unit_number: string }>>([])
  const [status, setStatus]     = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const [error, setError]       = useState<string>('')

  const [preview, setPreview]   = useState<RosterRow[] | null>(null)
  const [fatal, setFatal]       = useState<string[]>([])
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<string>('')
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    if (!hasSupabase || !communityId) { setStatus('none'); return }
    setStatus('loading'); setError('')
    try {
      const [resR, unitsR] = await Promise.all([
        withTimeout(supabase!
          .from('residents')
          .select('id, full_name, first_name, last_name, email, phone, invited_at, activated_at, unit_id, ev_units:unit_id(unit_number)')
          .eq('community_id', communityId)
          .order('full_name', { ascending: true })
        ),
        withTimeout(supabase!
          .from('ev_units')
          .select('id, unit_number')
          .eq('community_id', communityId)
        ),
      ])
      if (resR.error) throw resR.error
      if (unitsR.error) throw unitsR.error
      setOwners((resR.data || []).map((r: any) => ({
        id: r.id, full_name: r.full_name,
        first_name: r.first_name, last_name: r.last_name,
        email: r.email, phone: r.phone,
        invited_at: r.invited_at, activated_at: r.activated_at,
        unit_id: r.unit_id,
        unit_number: r.ev_units?.unit_number || null,
      })))
      setUnits(unitsR.data || [])
      setStatus('ready')
    } catch (err: any) {
      setError(err?.message || 'Could not load roster')
      setStatus('error')
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files && e.target.files[0]
    if (e.target) e.target.value = ''
    if (!file) return
    setError(''); setImportMsg('')
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result || '')
      const { rows, fatal: fatalMsgs } = parseRosterCsv(text)
      if (fatalMsgs.length) { setFatal(fatalMsgs); setPreview(null); return }
      const existing = {
        units:  new Set(units.map(u => u.unit_number)),
        emails: new Set(owners.filter(o => o.email).map(o => String(o.email).toLowerCase())),
      }
      validateRoster(rows, existing)
      setPreview(rows)
      setFatal([])
    }
    reader.onerror = () => setError('Could not read that file')
    reader.readAsText(file)
  }

  const importable = useMemo(() => (preview || []).filter(isImportable), [preview])

  const confirmImport = async () => {
    if (!preview || !communityId || !importable.length) return
    setImporting(true); setError(''); setImportMsg('')
    try {
      // 1) Upsert units (idempotent on community_id+unit_number)
      const distinctUnits = [...new Set(importable.map(r => r.unit_number))]
      const { data: unitRows, error: unitErr } = await withTimeout(
        supabase!
          .from('ev_units')
          .upsert(distinctUnits.map(u => ({ community_id: communityId, unit_number: u })),
                  { onConflict: 'community_id,unit_number' })
          .select('id, unit_number')
      )
      if (unitErr) throw unitErr
      const unitIdByNumber = new Map((unitRows || []).map((u: any) => [u.unit_number, u.id]))

      // 2) Build the inserts/updates by case-insensitive email match against
      //    current owner list (which we already loaded for validation).
      const existingByEmail = new Map(
        owners.filter(o => o.email)
              .map(o => [String(o.email).toLowerCase(), o.id])
      )
      const inserts: any[] = []
      const updates: Array<{ id: string; patch: any }> = []
      for (const r of importable) {
        const patch = {
          first_name: r.first_name,
          last_name:  r.last_name,
          full_name:  `${r.first_name} ${r.last_name}`.trim(),
          email:      r.email,
          phone:      r.phone || null,
          unit_id:    unitIdByNumber.get(r.unit_number) || null,
          voting_eligible: true,
        }
        const existingId = existingByEmail.get(r.email)
        if (existingId) updates.push({ id: existingId, patch })
        else inserts.push({ community_id: communityId, ...patch })
      }

      // 3) Apply inserts in one shot, updates one-by-one (small N).
      if (inserts.length) {
        const { error: iErr } = await withTimeout(supabase!.from('residents').insert(inserts))
        if (iErr) throw iErr
      }
      for (const u of updates) {
        const { error: uErr } = await withTimeout(
          supabase!.from('residents').update(u.patch).eq('id', u.id)
        )
        if (uErr) throw uErr
      }

      await logAudit({
        community_id: communityId,
        event_type:   'roster.imported',
        target_type:  'roster',
        metadata: {
          total:    importable.length,
          inserted: inserts.length,
          updated:  updates.length,
          skipped:  preview.length - importable.length,
        },
      })

      setImportMsg(
        `Imported ${importable.length} owner${importable.length === 1 ? '' : 's'} ` +
        `(${inserts.length} new, ${updates.length} updated).`
      )
      setPreview(null)
      await load()
    } catch (err: any) {
      setError(err?.message || 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="admin-section">
      <VoiceTabs active="roster" />

      <div className="admin-section-head" style={{ marginTop: 18 }}>
        <div>
          <div className="admin-section-title">Voice Roster</div>
          <div className="admin-section-sub">
            Owners eligible to attend meetings and cast electronic ballots.
            Drop a CSV to import — existing owners (matched by email) are updated, not duplicated.
          </div>
        </div>
        <button className="admin-btn" onClick={() => fileRef.current?.click()}>
          Import CSV
        </button>
        <input
          ref={fileRef} type="file" accept=".csv,text/csv"
          onChange={onPickFile} style={{ display: 'none' }}
        />
      </div>

      <div className="admin-note" style={{ marginTop: 16 }}>
        CSV header row required. Columns: <code>unit_number</code>, <code>first_name</code>,
        {' '}<code>last_name</code>, <code>email</code>, <code>phone</code> (optional).
      </div>

      {status === 'none' && (
        <div className="admin-note admin-note-warn" style={{ marginTop: 12 }}>
          No community is linked to your account. Set one in Admin → Community first.
        </div>
      )}
      {status === 'error' && (
        <div className="admin-err" style={{ marginTop: 12 }}>{error}</div>
      )}

      {fatal.length > 0 && (
        <div className="admin-note admin-note-err" style={{ marginTop: 12 }}>
          {fatal.map((m, i) => <div key={i}>{m}</div>)}
        </div>
      )}

      {importMsg && (
        <div className="admin-note" style={{ marginTop: 12, borderLeft: '3px solid #6ee7a7' }}>
          {importMsg}
        </div>
      )}

      {preview && (
        <RosterPreview
          rows={preview}
          importable={importable}
          onConfirm={confirmImport}
          onCancel={() => { setPreview(null); setError(''); setFatal([]) }}
          importing={importing}
          error={error}
        />
      )}

      <OwnerList owners={owners} status={status} />
    </div>
  )
}

function RosterPreview({
  rows, importable, onConfirm, onCancel, importing, error,
}: {
  rows: RosterRow[]
  importable: RosterRow[]
  onConfirm: () => void
  onCancel: () => void
  importing: boolean
  error: string
}) {
  const blockingCount = rows.length - importable.length
  return (
    <div className="voice-roster-preview">
      <div className="voice-roster-preview-head">
        <div>
          <strong>{rows.length}</strong> row{rows.length === 1 ? '' : 's'} parsed.
          {' '}<span style={{ color: 'var(--text-dim)' }}>
            {importable.length} importable
            {blockingCount > 0 ? `, ${blockingCount} blocked` : ''}.
          </span>
        </div>
        <div className="voice-roster-preview-actions">
          <button className="admin-btn-ghost" onClick={onCancel} disabled={importing}>
            Cancel
          </button>
          <button
            className="admin-btn"
            onClick={onConfirm}
            disabled={importing || importable.length === 0}
          >
            {importing ? 'Importing…' : `Import ${importable.length} owner${importable.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
      {error && <div className="admin-err">{error}</div>}
      <div className="voice-roster-table-wrap">
        <table className="voice-roster-table">
          <thead>
            <tr>
              <th>Line</th>
              <th>Unit</th>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const blocking = !isImportable(r)
              return (
                <tr key={r.line} className={blocking ? 'voice-roster-row-bad' : ''}>
                  <td>{r.line}</td>
                  <td>{r.unit_number || <span className="voice-roster-missing">—</span>}</td>
                  <td>{`${r.first_name} ${r.last_name}`.trim() || <span className="voice-roster-missing">—</span>}</td>
                  <td>{r.email || <span className="voice-roster-missing">—</span>}</td>
                  <td>{r.phone || <span style={{ color: 'var(--text-dim)' }}>—</span>}</td>
                  <td>
                    {r.errors.length === 0
                      ? <span className="voice-roster-ok">OK</span>
                      : r.errors.map((e, i) => (
                          <span key={i} className={`voice-roster-badge ${blocking ? 'bad' : 'warn'}`}>
                            {e}
                          </span>
                        ))}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function OwnerList({ owners, status }: { owners: OwnerListRow[]; status: string }) {
  if (status === 'loading') return <div className="admin-placeholder">Loading owners…</div>
  if (status !== 'ready') return null

  if (!owners.length) {
    return (
      <div className="admin-placeholder" style={{ marginTop: 24 }}>
        No owners yet — import a CSV above to get started.
      </div>
    )
  }

  return (
    <div className="voice-roster-list" style={{ marginTop: 24 }}>
      <div className="voice-roster-list-head">
        {owners.length} owner{owners.length === 1 ? '' : 's'} in roster
      </div>
      <div className="voice-roster-table-wrap">
        <table className="voice-roster-table">
          <thead>
            <tr>
              <th>Unit</th>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Invite state</th>
            </tr>
          </thead>
          <tbody>
            {owners.map(o => (
              <tr key={o.id}>
                <td>{o.unit_number || <span style={{ color: 'var(--text-dim)' }}>—</span>}</td>
                <td>{o.full_name || `${o.first_name || ''} ${o.last_name || ''}`.trim() || '—'}</td>
                <td>{o.email || <span style={{ color: 'var(--text-dim)' }}>—</span>}</td>
                <td>{o.phone || <span style={{ color: 'var(--text-dim)' }}>—</span>}</td>
                <td>{inviteStateLabel(o)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function inviteStateLabel(o: OwnerListRow): React.ReactNode {
  if (o.activated_at) return <span className="voice-roster-badge ok">Activated</span>
  if (o.invited_at)   return <span className="voice-roster-badge warn">Invited</span>
  return <span className="voice-roster-badge">Not invited</span>
}

// Local sub-nav so Meetings and Roster are one tap apart. Duplicated in
// the parent admin/voice page; small enough that DRY isn't worth a shared
// component for two callsites.
function VoiceTabs({ active }: { active: 'meetings' | 'roster' }) {
  return (
    <div className="voice-tabs">
      <Link href="/admin/voice"
            className={`voice-tab${active === 'meetings' ? ' active' : ''}`}>
        Meetings
      </Link>
      <Link href="/admin/voice/roster"
            className={`voice-tab${active === 'roster' ? ' active' : ''}`}>
        Roster
      </Link>
    </div>
  )
}
