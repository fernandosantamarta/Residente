'use client'

// Board packet — one-click, print-ready combined document (Save as PDF) that
// assembles the meeting NOTICE + AGENDA + (published) MINUTES + a list of
// supporting documents into a single booklet. Uses the app's client-print
// convention (no server-side PDF merge). Replaces "three separate print pages."

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase, hasSupabase } from '@/lib/supabase'
import { useT } from '@/lib/i18n'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

const fmtDateTime = (d: any) => { try { return new Date(d).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' }) } catch { return '' } }

export default function MeetingPacketPage() {
  const t = useT()
  const params = useParams()
  const id = params?.id as string
  const [meeting, setMeeting] = useState<any>(null)
  const [community, setCommunity] = useState<any>(null)
  const [minutes, setMinutes] = useState<any>(null)
  const [docs, setDocs] = useState<any[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!hasSupabase || !id) { setStatus('error'); setError('No meeting'); return }
      try {
        const { data: m, error: mErr } = (await withTimeout(supabase.from('ev_meetings').select('*').eq('id', id).single())) as any
        if (mErr) throw mErr
        const [{ data: c }, minRes, docRes] = await Promise.all([
          withTimeout(supabase.from('communities').select('*').eq('id', m.community_id).single()) as any,
          withTimeout(supabase.from('meeting_minutes').select('sections_data').eq('meeting_id', id).maybeSingle()) as any,
          withTimeout(supabase.from('ev_meeting_docs').select('type, title').eq('meeting_id', id)) as any,
        ])
        if (cancelled) return
        setMeeting(m); setCommunity(c || null)
        setMinutes((minRes as any)?.data?.sections_data || null)
        setDocs(((docRes as any)?.data || []))
        setStatus('ready')
      } catch (err: any) {
        if (!cancelled) { setError(err?.message || 'Could not load'); setStatus('error') }
      }
    })()
    return () => { cancelled = true }
  }, [id])

  if (status === 'loading') return <div style={{ padding: 40, fontFamily: 'system-ui' }}>{t('admin.packet.loading')}</div>
  if (status === 'error') return <div style={{ padding: 40, color: '#B42318', fontFamily: 'system-ui' }}>{error}</div>

  const isCondo = community?.association_type !== 'hoa'
  const agenda: string[] = Array.isArray(meeting?.agenda_data) ? meeting.agenda_data.filter((x: any) => typeof x === 'string' && x.trim()) : []
  const motions: any[] = Array.isArray(minutes?.motions) ? minutes.motions : []
  const actions: any[] = Array.isArray(minutes?.action_items) ? minutes.action_items : []
  const supporting = docs.filter(d => d.type === 'supporting')

  return (
    <div className="pk-page">
      <style>{`
        body { margin: 0; background: #f3f2ee; }
        .pk-page { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1d1c1a; }
        .pk-bar { max-width: 760px; margin: 0 auto; padding: 16px 24px; display: flex; justify-content: flex-end; }
        .pk-print { border: 1px solid #1d1c1a; background: #1d1c1a; color: #fff; font: inherit; font-size: 14px; font-weight: 600; padding: 9px 18px; border-radius: 9px; cursor: pointer; }
        .pk-doc { max-width: 760px; margin: 0 auto 48px; background: #fff; border: 1px solid #e7e4dd; border-radius: 12px; padding: 48px 56px; }
        .pk-cover { text-align: center; border-bottom: 2px solid #1d1c1a; padding-bottom: 26px; margin-bottom: 30px; }
        .pk-comm { font-size: 22px; font-weight: 700; }
        .pk-kind { font-size: 12px; letter-spacing: .12em; text-transform: uppercase; color: #6b675f; margin-top: 6px; }
        .pk-mt { font-size: 17px; font-weight: 600; margin-top: 16px; }
        .pk-when { font-size: 14px; color: #475467; margin-top: 4px; }
        .pk-sec { margin-top: 30px; }
        .pk-sec h2 { font-size: 13px; letter-spacing: .08em; text-transform: uppercase; color: #6b675f; border-bottom: 1px solid #e2dfd8; padding-bottom: 7px; margin: 0 0 12px; }
        .pk-sec ol, .pk-sec ul { line-height: 1.9; font-size: 14px; padding-left: 22px; margin: 0; }
        .pk-motion { border: 1px solid #efece5; border-radius: 9px; padding: 10px 13px; margin-bottom: 8px; }
        .pk-motion .m { font-size: 14px; }
        .pk-motion .meta { font-size: 12px; color: #6b675f; margin-top: 3px; }
        .pk-note { font-size: 12px; color: #837f76; line-height: 1.5; }
        .pk-empty { font-size: 13px; color: #98908a; }
        @media print {
          body { background: #fff; }
          .pk-bar { display: none; }
          .pk-doc { border: none; border-radius: 0; margin: 0; max-width: none; padding: 0; }
          .pk-sec { break-inside: avoid; }
        }
      `}</style>

      <div className="pk-bar">
        <button type="button" className="pk-print" onClick={() => window.print()}>{t('admin.packet.printSave')}</button>
      </div>

      <div className="pk-doc">
        <div className="pk-cover">
          <div className="pk-comm">{community?.name || t('admin.packet.community')}</div>
          <div className="pk-kind">{t('admin.packet.boardPacket')}</div>
          <div className="pk-mt">{meeting?.title || t('admin.packet.meeting')}</div>
          <div className="pk-when">{fmtDateTime(meeting?.scheduled_at)}{meeting?.location ? ` · ${meeting.location}` : ''}</div>
        </div>

        {/* Notice */}
        <div className="pk-sec">
          <h2>{t('admin.packet.noticeHeading')}</h2>
          <p style={{ fontSize: 14, lineHeight: 1.6 }}>
            {t('admin.packet.noticeBody', { community: community?.name || 'the association', when: fmtDateTime(meeting?.scheduled_at), cite: isCondo ? 'FS 718.112(2)(c)' : 'FS 720.303(2)' })}
          </p>
        </div>

        {/* Agenda */}
        <div className="pk-sec">
          <h2>{t('admin.packet.agendaHeading')}</h2>
          <ol>
            <li>{t('admin.packet.callToOrder')}</li>
            <li>{t('admin.packet.quorum')}</li>
            <li>{t('admin.packet.priorMinutes')}</li>
            {agenda.length > 0
              ? agenda.map((a, i) => <li key={i}>{a}</li>)
              : <li className="pk-empty">{t('admin.packet.noAgenda')}</li>}
            {meeting?.is_budget_meeting && <li>{t('admin.packet.budgetItem')}</li>}
            {meeting?.affects_assessments && <li>{t('admin.packet.assessmentItem')}</li>}
            {meeting?.affects_use_rules && <li>{t('admin.packet.useRulesItem')}</li>}
            <li>{t('admin.packet.ownerComments')}</li>
            <li>{t('admin.packet.adjournment')}</li>
          </ol>
        </div>

        {/* Supporting documents */}
        {supporting.length > 0 && (
          <div className="pk-sec">
            <h2>{t('admin.packet.supportingHeading')}</h2>
            <ul>{supporting.map((d, i) => <li key={i}>{d.title}</li>)}</ul>
          </div>
        )}

        {/* Minutes */}
        <div className="pk-sec">
          <h2>{t('admin.packet.minutesHeading')}</h2>
          {motions.length === 0 && actions.length === 0 ? (
            <div className="pk-empty">{t('admin.packet.noMinutes')}</div>
          ) : (
            <>
              {motions.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{t('admin.packet.motions')}</div>
                  {motions.map((m, i) => (
                    <div className="pk-motion" key={i}>
                      <div className="m">{m.motion}</div>
                      <div className="meta">
                        {t('admin.packet.movedBy')} {m.moved_by || '—'} · {t('admin.packet.seconded')} {m.seconded_by || '—'} · {(m.votes_for ?? 0)}–{(m.votes_against ?? 0)}–{(m.votes_abstain ?? 0)}{m.outcome ? ` · ${m.outcome}` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {actions.length > 0 && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{t('admin.packet.actionItems')}</div>
                  <ul>{actions.map((a, i) => <li key={i}>{a.action}{a.owner ? ` — ${a.owner}` : ''}{a.due ? ` (${a.due})` : ''}</li>)}</ul>
                </div>
              )}
            </>
          )}
        </div>

        <p className="pk-note" style={{ marginTop: 30, borderTop: '1px solid #efece5', paddingTop: 16 }}>{t('admin.packet.footNote')}</p>
      </div>
    </div>
  )
}
