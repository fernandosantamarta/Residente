'use client'

// Records-request room — the board's response workspace for one records-
// inspection request (FS 718.111(12) / 720.303(5)). Attach the documents that
// answer the request (from the archive or a fresh upload), flag each for PII
// review (redaction_status), then "Post & answer" — which routes through the
// respond_to_records_request RPC so a document still flagged 'pending' is
// BLOCKED from auto-posting to the owner until the board clears it.
//
// Additive + collapsible: rendered under each open request row in
// /admin/documents. The existing "Mark answered" button stays for the simple
// in-person-inspection case (no documents produced).

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useT } from '@/lib/i18n'

type AttachedDoc = {
  linkId: string
  documentId: string
  title: string
  redaction_status: string | null
  posted_to_portal: boolean
}

const REDACTION_OPTS = ['pending', 'redacted', 'not_required'] as const

export function RecordsRequestRoom({
  request, communityId, archiveDocs, onResponded,
}: {
  request: any
  communityId: string
  archiveDocs: any[]
  onResponded: (requestId: string, posted: number) => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [docs, setDocs] = useState<AttachedDoc[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [pickId, setPickId] = useState('')
  const [uploading, setUploading] = useState(false)
  const answered = !!request.responded_at

  const load = async () => {
    setLoading(true); setErr('')
    try {
      const { data, error } = await supabase
        .from('ev_records_request_docs')
        .select('id, document_id, documents(id,title,redaction_status,posted_to_portal)')
        .eq('request_id', request.id)
      if (error) throw error
      setDocs((data || []).map((r: any) => ({
        linkId: r.id,
        documentId: r.document_id,
        title: r.documents?.title || t('admin.documents.rr.untitledDoc'),
        redaction_status: r.documents?.redaction_status ?? null,
        posted_to_portal: !!r.documents?.posted_to_portal,
      })))
    } catch (e: any) {
      setErr(e?.message || t('admin.documents.rr.loadErr'))
    } finally { setLoading(false) }
  }
  useEffect(() => { if (open) load() }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const attachedIds = new Set(docs.map(d => d.documentId))
  const pickable = (archiveDocs || []).filter(d => !attachedIds.has(d.id))

  const attachExisting = async () => {
    if (!pickId) return
    setBusy(true); setErr('')
    try {
      const { error } = await supabase.from('ev_records_request_docs')
        .insert({ community_id: communityId, request_id: request.id, document_id: pickId })
      if (error) throw error
      setPickId(''); await load()
    } catch (e: any) { setErr(e?.message || t('admin.documents.rr.attachErr')) }
    finally { setBusy(false) }
  }

  const uploadAndAttach = async (file: File) => {
    setUploading(true); setErr('')
    try {
      const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : 'bin'
      const path = `${communityId}/${crypto.randomUUID()}.${ext}`
      const up = await supabase.storage.from('documents').upload(path, file)
      if (up.error) throw up.error
      // New response docs default to redaction_status 'pending' — the board must
      // clear PII before they can be posted to the owner.
      const { data: doc, error } = await supabase.from('documents').insert({
        community_id: communityId,
        title: file.name.replace(/\.[^.]+$/, ''),
        category: 'Other',
        storage_path: path,
        file_size: file.size,
        redaction_status: 'pending',
      }).select('id').single()
      if (error) { supabase.storage.from('documents').remove([path]); throw error }
      await supabase.from('ev_records_request_docs')
        .insert({ community_id: communityId, request_id: request.id, document_id: (doc as any).id })
      await load()
    } catch (e: any) { setErr(e?.message || t('admin.documents.rr.uploadErr')) }
    finally { setUploading(false) }
  }

  const setRedaction = async (documentId: string, status: string) => {
    setDocs(ds => ds.map(d => d.documentId === documentId ? { ...d, redaction_status: status } : d))
    try {
      const { error } = await supabase.from('documents').update({ redaction_status: status }).eq('id', documentId)
      if (error) throw error
    } catch { load() }
  }

  const detach = async (linkId: string) => {
    setBusy(true); setErr('')
    try {
      const { error } = await supabase.from('ev_records_request_docs').delete().eq('id', linkId)
      if (error) throw error
      await load()
    } catch (e: any) { setErr(e?.message || t('admin.documents.rr.detachErr')) }
    finally { setBusy(false) }
  }

  const pending = docs.filter(d => d.redaction_status === 'pending').length
  const canRespond = docs.length > 0 && pending === 0 && !answered

  const respond = async () => {
    setBusy(true); setErr('')
    try {
      const { data, error } = await supabase.rpc('respond_to_records_request', { p_request_id: request.id })
      if (error) throw error
      onResponded(request.id, Number(data) || 0)
    } catch (e: any) {
      const msg = String(e?.message || '')
      setErr(msg.includes('pending_redaction')
        ? t('admin.documents.rr.pendingBlocked')
        : (msg || t('admin.documents.rr.respondErr')))
    } finally { setBusy(false) }
  }

  const badge = (status: string | null) => {
    const map: Record<string, { label: string; color: string; bg: string }> = {
      pending: { label: t('admin.documents.rr.piiPending'), color: '#B42318', bg: '#FEF3F2' },
      redacted: { label: t('admin.documents.rr.piiRedacted'), color: '#067647', bg: '#ECFDF3' },
      not_required: { label: t('admin.documents.rr.piiNone'), color: '#475467', bg: '#F2F4F7' },
    }
    const s = map[status || ''] || { label: t('admin.documents.rr.piiUnset'), color: '#B42318', bg: '#FEF3F2' }
    return <span style={{ fontSize: 11, fontWeight: 700, color: s.color, background: s.bg, borderRadius: 999, padding: '2px 8px' }}>{s.label}</span>
  }

  return (
    <div style={{ margin: '2px 0 10px', paddingLeft: 4 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="doc-card-link"
        style={{ fontSize: 12, fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', color: '#175CD3', padding: 0 }}
      >
        {open ? '▾ ' : '▸ '}
        {answered
          ? t('admin.documents.rr.viewProvided', { count: docs.length })
          : t('admin.documents.rr.manageDocs', { count: docs.length })}
        {!answered && pending > 0 ? ` · ${t('admin.documents.rr.pendingCount', { count: pending })}` : ''}
      </button>

      {open && (
        <div style={{ marginTop: 8, border: '1px solid #EAECF0', borderRadius: 10, padding: 14, background: '#FCFCFD' }}>
          {loading ? (
            <div style={{ fontSize: 13, opacity: 0.7 }}>{t('admin.documents.rr.loading')}</div>
          ) : (
            <>
              {docs.length === 0 ? (
                <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 10 }}>{t('admin.documents.rr.noneAttached')}</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                  {docs.map(d => (
                    <div key={d.linkId} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13, fontWeight: 600, flex: '1 1 180px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</span>
                      {badge(d.redaction_status)}
                      {d.posted_to_portal && <span style={{ fontSize: 11, fontWeight: 600, color: '#067647' }}>{t('admin.documents.rr.posted')}</span>}
                      {!answered && (
                        <>
                          <select
                            value={d.redaction_status || 'pending'}
                            onChange={e => setRedaction(d.documentId, e.target.value)}
                            style={{ fontSize: 12, padding: '3px 6px', borderRadius: 6, border: '1px solid #D0D5DD' }}
                          >
                            {REDACTION_OPTS.map(o => <option key={o} value={o}>{t(`admin.documents.rr.opt.${o}`)}</option>)}
                          </select>
                          <button type="button" onClick={() => detach(d.linkId)} disabled={busy}
                            style={{ fontSize: 12, color: '#B42318', background: 'none', border: 'none', cursor: 'pointer' }}>
                            {t('admin.documents.rr.remove')}
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {!answered && (
                <>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
                    {pickable.length > 0 && (
                      <>
                        <select value={pickId} onChange={e => setPickId(e.target.value)}
                          style={{ fontSize: 13, padding: '6px 8px', borderRadius: 7, border: '1px solid #D0D5DD', maxWidth: 260 }}>
                          <option value="">{t('admin.documents.rr.pickFromArchive')}</option>
                          {pickable.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
                        </select>
                        <button type="button" className="admin-btn-ghost" onClick={attachExisting} disabled={!pickId || busy}>
                          {t('admin.documents.rr.attach')}
                        </button>
                      </>
                    )}
                    <label className="admin-btn-ghost" style={{ cursor: 'pointer' }}>
                      {uploading ? t('admin.documents.rr.uploading') : t('admin.documents.rr.uploadNew')}
                      <input type="file" hidden disabled={uploading}
                        onChange={e => { const f = e.target.files?.[0]; if (f) uploadAndAttach(f); e.currentTarget.value = '' }} />
                    </label>
                  </div>

                  {err && <div style={{ fontSize: 12.5, color: '#B42318', marginBottom: 8 }}>{err}</div>}

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <button type="button" className="admin-primary-btn" onClick={respond} disabled={!canRespond || busy}>
                      {t('admin.documents.rr.postAndAnswer')}
                    </button>
                    {pending > 0 && (
                      <span style={{ fontSize: 12, color: '#B54708' }}>{t('admin.documents.rr.gateHint', { count: pending })}</span>
                    )}
                    {docs.length === 0 && (
                      <span style={{ fontSize: 12, opacity: 0.65 }}>{t('admin.documents.rr.attachFirst')}</span>
                    )}
                  </div>
                </>
              )}

              {answered && err && <div style={{ fontSize: 12.5, color: '#B42318' }}>{err}</div>}
            </>
          )}
        </div>
      )}
    </div>
  )
}
