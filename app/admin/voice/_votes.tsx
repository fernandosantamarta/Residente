'use client'

// Vote components extracted from app/admin/voice/page.tsx so the page file
// exports only its default route component (Next forbids extra named exports
// from page.tsx). Imported by the meetings page and the standalone votes page.

import { useState } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import {
  VOTE_TYPES, VOTE_CATEGORIES, VOTE_STATUS_LABELS,
} from '@/lib/voice'
import { useVoiceMeetings } from '@/hooks/useVoiceMeetings'
import { logAudit } from '@/lib/audit'
import {
  generateVoteKeypair, wrapSecretKey, unwrapSecretKey,
  decryptAnswer, exportKeyCard, bytesToBase64,
} from '@/lib/ballotCrypto'
import { Dropdown } from '@/components/Dropdown'
import { useT } from '@/lib/i18n'

const withTimeout = (p, ms = 10000) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

const EMPTY_VOTE = {
  title: '', description: '', type: 'resolution', ballot_type: 'open', mode: 'in_meeting', closes_at: '', meeting_id: '', category: 'rules',
}

const toLocalDtInput = (iso?: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

export function VoteRow({ vote: v, meetingStatus, onChanged, onEdit }: any) {
  const t = useT()
  const typeLabel = VOTE_TYPES.find(t => t.value === v.type)?.label ?? v.type
  const [acting, setActing] = useState(false)

  const openVote = async () => {
    setActing(true)
    try {
      const { error } = await withTimeout(
        supabase.from('ev_votes').update({ status: 'open', opens_at: new Date().toISOString() }).eq('id', v.id)
      )
      if (error) throw error
      logAudit({
        community_id: v.community_id,
        event_type:   'vote.opened',
        target_type:  'vote',
        target_id:    v.id,
        metadata:     { title: v.title, ballot_type: v.ballot_type, type: v.type },
      })
      onChanged()
    } catch { /* keep */ } finally { setActing(false) }
  }

  const [closeErr, setCloseErr] = useState<string | null>(null)
  const [closing, setClosing]   = useState(false)
  const [pwdPrompt, setPwdPrompt] = useState(false)
  // For E2E-verifiable votes: the unwrapped secret key (base64) is held in
  // memory between tally and publish so it can be revealed publicly at publish.
  const [revealKeyB64, setRevealKeyB64] = useState<string | null>(null)
  const [publishPrompt, setPublishPrompt] = useState(false)

  // Open vote: flip status to 'closed' first (no more ballots accepted),
  // then either tally (open ballot) or decrypt+tally (secret ballot).
  const closeVote = async () => {
    setActing(true); setCloseErr(null)
    try {
      if (v.ballot_type === 'secret') {
        // Need the admin's tally password before we can decrypt. Move the vote
        // to 'closed' first so no more ballots come in, then surface the prompt.
        // For E2E-verifiable votes, ev_seal_vote does the close AND freezes the
        // ballot set: it shuffles, builds the hash chain, and commits the head
        // hash BEFORE any decryption (the ordering that makes it defensible).
        if (v.verifiable) {
          const { error: sealErr } = await withTimeout(supabase.rpc('ev_seal_vote', { p_vote_id: v.id }))
          if (sealErr) throw sealErr
          logAudit({
            community_id: v.community_id, event_type: 'vote.closed', target_type: 'vote', target_id: v.id,
            metadata: { sealed: true, verifiable: true },
          })
        } else {
          const { error: closeStatusErr } = await withTimeout(
            supabase.from('ev_votes').update({
              status: 'closed',
              closes_at: new Date().toISOString(),
            }).eq('id', v.id)
          )
          if (closeStatusErr) throw closeStatusErr
        }
        setPwdPrompt(true)
        onChanged()
        return
      }
      // Open ballot — counts are already live in v.{yes,no,abstain}_count.
      const total = (v.yes_count ?? 0) + (v.no_count ?? 0)
      const result = total === 0 ? null : v.yes_count >= v.no_count ? 'pass' : 'fail'
      const { error } = await withTimeout(
        supabase.from('ev_votes').update({
          status: 'tallied',
          closes_at: new Date().toISOString(),
          result,
        }).eq('id', v.id)
      )
      if (error) throw error
      logAudit({
        community_id: v.community_id,
        event_type:   'vote.closed',
        target_type:  'vote',
        target_id:    v.id,
        metadata:     { yes: v.yes_count ?? 0, no: v.no_count ?? 0, abstain: v.abstain_count ?? 0, result },
      })
      onChanged()
    } catch (e: any) {
      setCloseErr(e?.message ?? t('admin.voice.errCouldNotCloseVote'))
    } finally {
      setActing(false)
    }
  }

  // Secret-vote tally: unwrap secret key with the admin's password,
  // decrypt every ballot client-side, write back plaintext answers.
  // The DB tally trigger picks up the UPDATE and updates the counts.
  const decryptAndTally = async (password: string) => {
    if (!v.wrapped_secret_key) {
      setCloseErr(t('admin.voice.errMissingSecretKey'))
      return
    }
    setClosing(true); setCloseErr(null)
    try {
      const secretKey = await unwrapSecretKey(v.wrapped_secret_key, password)
      // E2E-verifiable votes decrypt the ANONYMOUS box; legacy votes the ballots.
      const table = v.verifiable ? 'ev_ballot_box' : 'ev_ballots'
      const { data: ballots, error: bErr } = await withTimeout(
        supabase.from(table)
          .select('id, encrypted_answer')
          .eq('vote_id', v.id)
          .is('answer', null)
      )
      if (bErr) throw bErr
      let updated = 0, failed = 0
      for (const b of (ballots || [])) {
        if (!b.encrypted_answer) { failed++; continue }
        try {
          const ans = decryptAnswer(b.encrypted_answer, secretKey)
          const { error: uErr } = await supabase.from(table)
            .update({ answer: ans }).eq('id', b.id)
          if (uErr) { failed++; continue }
          updated++
        } catch { failed++ }
      }

      // Re-read counts (tally trigger fired during the loop) so we can
      // record a definitive pass/fail without trusting stale local state.
      const { data: tallied, error: tErr } = await supabase
        .from('ev_votes')
        .select('yes_count, no_count, abstain_count')
        .eq('id', v.id)
        .single()
      if (tErr) throw tErr
      const yes = tallied?.yes_count ?? 0
      const no  = tallied?.no_count ?? 0
      const abstain = tallied?.abstain_count ?? 0
      const total = yes + no
      const result = total === 0 ? null : yes >= no ? 'pass' : 'fail'

      const { error: rErr } = await supabase.from('ev_votes').update({
        status: 'tallied',
        result,
      }).eq('id', v.id)
      if (rErr) throw rErr

      // Verifiable votes: record the tally on the public commitment and keep the
      // key in memory so it can be revealed at publish (re-prompt if lost).
      if (v.verifiable) {
        await supabase.from('ev_vote_commitments')
          .update({ tally_yes: yes, tally_no: no, tally_abstain: abstain, result })
          .eq('vote_id', v.id)
        setRevealKeyB64(bytesToBase64(secretKey))
      }

      logAudit({
        community_id: v.community_id,
        event_type:   'vote.closed',
        target_type:  'vote',
        target_id:    v.id,
        metadata: {
          yes, no, abstain,
          result, decrypted: updated, failed_decrypts: failed,
        },
      })
      setPwdPrompt(false)
      onChanged()
    } catch (e: any) {
      setCloseErr(e?.message ?? t('admin.voice.errCouldNotTallyVote'))
    } finally {
      setClosing(false)
    }
  }

  // Reveal the vote secret key publicly (verifiable votes) and flip to published.
  // Revealing the key is what enables universal re-tally — safe ONLY because the
  // ballots are anonymised (no stored identity↔ballot link).
  const doPublish = async (keyB64: string | null) => {
    if (v.verifiable) {
      if (!keyB64) { setPublishPrompt(true); return }
      const { error: cErr } = await withTimeout(
        supabase.from('ev_vote_commitments')
          .update({ revealed_secret_key: keyB64, revealed_at: new Date().toISOString(), result: v.result })
          .eq('vote_id', v.id)
      )
      if (cErr) throw cErr
    }
    const { error } = await withTimeout(
      supabase.from('ev_votes').update({ status: 'published' }).eq('id', v.id)
    )
    if (error) throw error
    logAudit({
      community_id: v.community_id,
      event_type:   'vote.published',
      target_type:  'vote',
      target_id:    v.id,
      metadata:     { result: v.result, verifiable: !!v.verifiable },
    })
    setPublishPrompt(false)
    onChanged()
  }

  const publishResult = async () => {
    setActing(true)
    try { await doPublish(revealKeyB64) }
    catch (e: any) { setCloseErr(e?.message ?? t('admin.voice.errCouldNotPublish')) }
    finally { setActing(false) }
  }

  // If the in-memory key was lost (e.g. page reload between tally and publish),
  // re-derive it from the tally password to reveal it.
  const revealAndPublish = async (password: string) => {
    setActing(true); setCloseErr(null)
    try {
      const secretKey = await unwrapSecretKey(v.wrapped_secret_key, password)
      const b64 = bytesToBase64(secretKey)
      setRevealKeyB64(b64)
      await doPublish(b64)
    } catch (e: any) {
      setCloseErr(e?.message ?? t('admin.voice.errWrongTallyPassword'))
    } finally { setActing(false) }
  }

  return (
    <div className="voice-vote-row-wrap">
      <div className="voice-vote-row">
        <div className="voice-vote-left">
          <div className="voice-vote-title">{v.title}</div>
          <div className="voice-vote-meta">
            {typeLabel}
            {' · '}{v.ballot_type === 'secret' ? t('admin.voice.secretBallot') : t('admin.voice.openBallot')}
          </div>
          {(v.status === 'tallied' || v.status === 'published') && (
            <div className="voice-tally">
              <span className="voice-tally-yes">✓ {v.yes_count ?? 0} {t('admin.voice.tallyYes')}</span>
              <span className="voice-tally-no">✗ {v.no_count ?? 0} {t('admin.voice.tallyNo')}</span>
              <span className="voice-tally-abs">{v.abstain_count ?? 0} {t('admin.voice.tallyAbstain')}</span>
              {v.result && (
                <span className={`voice-result voice-result-${v.result}`}>
                  {v.result === 'pass' ? t('admin.voice.resultPassed') : t('admin.voice.resultFailed')}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="voice-vote-right">
          <span className={`voice-status voice-status-${v.status}`}>
            {VOTE_STATUS_LABELS[v.status] ?? v.status}
          </span>
          {v.status === 'draft' && (meetingStatus === 'in_progress' || !meetingStatus) && (
            <button className="admin-btn-sm" onClick={openVote} disabled={acting}>{t('admin.voice.openVote')}</button>
          )}
          {v.status === 'open' && (
            <button className="admin-btn-sm admin-btn-warn" onClick={closeVote} disabled={acting}>
              {v.ballot_type === 'secret' ? t('admin.voice.closeVote') : t('admin.voice.closeAndTally')}
            </button>
          )}
          {v.status === 'closed' && v.ballot_type === 'secret' && (
            <button className="admin-btn-sm" onClick={() => setPwdPrompt(true)} disabled={acting}>
              {t('admin.voice.decryptAndTally')}
            </button>
          )}
          {v.status === 'tallied' && (
            <button className="admin-btn-sm" onClick={publishResult} disabled={acting}>{t('admin.voice.publishResult')}</button>
          )}
          {onEdit && (
            <button className="admin-btn-sm admin-btn-ghost" onClick={() => onEdit(v)} disabled={acting}>{t('admin.voice.edit')}</button>
          )}
        </div>
      </div>
      {closeErr && <div className="admin-err" style={{ marginTop: 6 }}>{closeErr}</div>}
      {pwdPrompt && (
        <TallyPasswordPrompt
          onCancel={() => { setPwdPrompt(false); setCloseErr(null) }}
          onSubmit={decryptAndTally}
          busy={closing}
        />
      )}
      {publishPrompt && (
        <TallyPasswordPrompt
          onCancel={() => { setPublishPrompt(false); setCloseErr(null) }}
          onSubmit={revealAndPublish}
          busy={acting}
        />
      )}
    </div>
  )
}

function TallyPasswordPrompt({
  onCancel, onSubmit, busy,
}: {
  onCancel: () => void
  onSubmit: (password: string) => Promise<void> | void
  busy: boolean
}) {
  const t = useT()
  const [pwd, setPwd] = useState('')
  return (
    <form
      className="voice-tally-prompt"
      onSubmit={(e) => { e.preventDefault(); onSubmit(pwd) }}
    >
      <div>
        <strong>{t('admin.voice.tallyPromptTitle')}</strong>
        <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 4 }}>
          {t('admin.voice.tallyPromptBody')}
        </div>
      </div>
      <input
        type="password"
        autoComplete="current-password"
        placeholder={t('admin.voice.tallyPasswordPlaceholder')}
        value={pwd}
        onChange={e => setPwd(e.target.value)}
        autoFocus
        disabled={busy}
      />
      <div className="voice-form-actions">
        <button type="submit" className="admin-btn" disabled={busy || !pwd}>
          {busy ? t('admin.voice.decrypting') : t('admin.voice.decryptAndTally')}
        </button>
        <button type="button" className="admin-btn-ghost" onClick={onCancel} disabled={busy}>
          {t('admin.voice.cancel')}
        </button>
      </div>
    </form>
  )
}

export function VoteForm({ meetingId = null, communityId, onSaved, onCancel, existing = null }) {
  const t = useT()
  const { profile } = useAuth() || {}
  const isEditing = !!existing?.id
  const [form, setForm] = useState(
    existing
      ? { ...EMPTY_VOTE, ...existing, description: existing.description ?? '', closes_at: toLocalDtInput(existing.closes_at), meeting_id: existing.meeting_id ?? '', category: existing.category ?? 'other' }
      : { ...EMPTY_VOTE, meeting_id: meetingId ?? '' },
  )
  // Meetings the vote can optionally be tagged to (shows up in that meeting's detail).
  const { meetings: tagMeetings } = useVoiceMeetings()
  // Secret-vote tally password — required for ballot_type='secret'. We
  // generate the keypair at submit time and wrap the secret with this
  // password before writing it to the DB.
  const [tallyPwd, setTallyPwd]       = useState('')
  const [tallyPwd2, setTallyPwd2]     = useState('')
  const [savedCard, setSavedCard]     = useState(false)
  const [keyCard, setKeyCard]         = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  const isSecret = form.ballot_type === 'secret'

  const set = (k, v) => setForm(f => {
    const next = { ...f, [k]: v }
    if (k === 'type' && v === 'election') next.ballot_type = 'secret'
    return next
  })

  const save = async (e) => {
    e.preventDefault()
    if (!form.title.trim()) { setErr(t('admin.voice.errVoteTitleRequired')); return }

    // Editing an existing vote — update the safe metadata fields only, allowed
    // at any status (incl. published). Ballot type and the secret key are never
    // touched on edit, so existing ballots/tallies stay valid.
    if (isEditing) {
      setSaving(true); setErr(null)
      try {
        const { error } = await withTimeout(
          supabase.from('ev_votes').update({
            title:       form.title.trim(),
            description: form.description.trim() || null,
            type:        form.type,
            mode:        form.mode,
            closes_at:   form.closes_at || null,
            meeting_id:  form.meeting_id || null,
            category:    form.category || null,
          }).eq('id', existing.id)
        )
        if (error) throw error
        onSaved()
      } catch (e: any) {
        setErr(e?.message ?? t('admin.voice.errFailedUpdateVote'))
      } finally {
        setSaving(false)
      }
      return
    }

    let public_key: string | null = null
    let wrapped_secret_key: string | null = null
    let cardText: string | null = null

    if (isSecret) {
      if (tallyPwd.length < 6) {
        setErr(t('admin.voice.errTallyPwdMinLength')); return
      }
      if (tallyPwd !== tallyPwd2) {
        setErr(t('admin.voice.errTallyPwdMismatch')); return
      }
      if (!savedCard) {
        setErr(t('admin.voice.errSaveCardFirst')); return
      }
    }

    setSaving(true); setErr(null)
    try {
      if (isSecret) {
        const kp = generateVoteKeypair()
        public_key        = bytesToBase64(kp.publicKey)
        wrapped_secret_key = await wrapSecretKey(kp.secretKey, tallyPwd)
        cardText          = exportKeyCard(kp.secretKey)
      }

      const { error } = await withTimeout(
        supabase.from('ev_votes').insert({
          meeting_id:         form.meeting_id || meetingId || null,
          community_id:       communityId,
          title:              form.title.trim(),
          description:        form.description.trim() || null,
          type:               form.type,
          ballot_type:        form.ballot_type,
          mode:               form.mode,
          closes_at:          form.closes_at || null,
          category:           form.category || null,
          created_by:         profile?.id,
          public_key,
          wrapped_secret_key,
          key_created_by:     isSecret ? profile?.id : null,
          // New secret votes are end-to-end verifiable (anonymous box + hash
          // chain + tracking codes). Open votes stay non-verifiable (public by
          // design). Existing votes are untouched (no retroactive anonymisation).
          verifiable:         isSecret,
        })
      )
      if (error) throw error
      if (isSecret && cardText) {
        // Offer the key card as a downloadable text file so the admin
        // can keep a paper backup. Saving the card is the only recovery
        // path if they forget the tally password.
        downloadKeyCard(cardText, form.title.trim())
        setKeyCard(cardText)
      } else {
        onSaved()
      }
    } catch (e) {
      setErr(e?.message ?? t('admin.voice.errFailedSaveVote'))
    } finally {
      setSaving(false)
    }
  }

  if (keyCard) {
    return (
      <div className="voice-vote-form">
        <div className="voice-keycard-banner">{t('admin.voice.keycardBanner')}</div>
        <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 12 }}>
          {t('admin.voice.keycardBody')}
        </p>
        <pre className="voice-keycard-block">{keyCard}</pre>
        <div className="voice-form-actions">
          <button type="button" className="admin-btn" onClick={onSaved}>{t('admin.voice.keycardContinue')}</button>
        </div>
      </div>
    )
  }

  return (
    <form className="voice-vote-form" onSubmit={save}>
      <div className="voice-form-row">
        <label>{t('admin.voice.fieldVoteTitle')}</label>
        <input name="vote-title" type="text" value={form.title} onChange={e => set('title', e.target.value)}
          placeholder={t('admin.voice.placeholderVoteTitle')} required />
      </div>
      <div className="voice-form-row">
        <label>{t('admin.voice.fieldVoteDescription')} <span className="voice-opt">{t('admin.voice.optional')}</span></label>
        <textarea name="vote-description" value={form.description} onChange={e => set('description', e.target.value)}
          rows={2} placeholder={t('admin.voice.placeholderVoteDescription')} />
      </div>
      <div className="voice-form-row">
        <label>{t('admin.voice.fieldDueDate')} <span className="voice-opt">{t('admin.voice.optionalDueDate')}</span></label>
        <input name="vote-closes" type="datetime-local" value={form.closes_at}
          onChange={e => set('closes_at', e.target.value)} />
      </div>
      <div className="voice-form-inline">
        <div className="voice-form-row">
          <label>{t('admin.voice.fieldVoteType')}</label>
          <Dropdown<string>
            value={form.type}
            onChange={v => set('type', v)}
            ariaLabel={t('admin.voice.fieldVoteType')}
            options={VOTE_TYPES}
          />
        </div>
        <div className="voice-form-row">
          <label>{t('admin.voice.fieldBallotType')}</label>
          {form.type === 'election' ? (
            <>
              <div className="voice-channels-readonly">{t('admin.voice.secretBallotLabel')}</div>
              <div className="voice-hard-block">{t('admin.voice.electionsMustUseSecret')}</div>
            </>
          ) : isEditing ? (
            <div className="voice-channels-readonly">{form.ballot_type === 'secret' ? t('admin.voice.secretBallotLabel') : t('admin.voice.openBallotLabel')}</div>
          ) : (
            <Dropdown<string>
              value={form.ballot_type}
              onChange={v => set('ballot_type', v)}
              ariaLabel={t('admin.voice.fieldBallotType')}
              options={[
                { value: 'open', label: t('admin.voice.openBallotLabel') },
                { value: 'secret', label: t('admin.voice.secretBallotLabel') },
              ]}
            />
          )}
        </div>
      </div>
      <div className="voice-form-row">
        <label>{t('admin.voice.fieldCategory')} <span className="voice-opt">{t('admin.voice.optionalCategory')}</span></label>
        <Dropdown<string>
          value={form.category}
          onChange={v => set('category', v)}
          ariaLabel={t('admin.voice.fieldCategoryAria')}
          options={VOTE_CATEGORIES}
        />
      </div>
      <div className="voice-form-row">
        <label>{t('admin.voice.fieldMeeting')} <span className="voice-opt">{t('admin.voice.optionalMeeting')}</span></label>
        <Dropdown<string>
          value={form.meeting_id}
          onChange={v => set('meeting_id', v)}
          ariaLabel={t('admin.voice.fieldMeeting')}
          options={[{ value: '', label: t('admin.voice.noMeetingOption') }, ...tagMeetings.map((m: any) => ({ value: m.id, label: m.title }))]}
        />
      </div>
      {isSecret && !isEditing && (
        <div className="voice-secret-config">
          <div className="voice-secret-config-title">{t('admin.voice.tallyPwdSectionTitle')}</div>
          <p className="voice-secret-config-body">
            {t('admin.voice.tallyPwdSectionBody')}
          </p>
          <div className="voice-form-inline">
            <div className="voice-form-row">
              <label>{t('admin.voice.fieldTallyPassword')}</label>
              <input type="password" autoComplete="new-password" minLength={6}
                value={tallyPwd} onChange={e => setTallyPwd(e.target.value)} />
            </div>
            <div className="voice-form-row">
              <label>{t('admin.voice.fieldConfirmPassword')}</label>
              <input type="password" autoComplete="new-password" minLength={6}
                value={tallyPwd2} onChange={e => setTallyPwd2(e.target.value)} />
            </div>
          </div>
          <label className="voice-secret-confirm">
            <input type="checkbox" checked={savedCard}
              onChange={e => setSavedCard(e.target.checked)} />
            <span>{t('admin.voice.savedCardConfirm')}</span>
          </label>
        </div>
      )}
      {err && <div className="admin-err">{err}</div>}
      <div className="card-cta voice-form-actions">
        <button type="submit" className="admin-primary-btn" disabled={saving}>
          {saving ? t('admin.voice.saving') : isEditing ? t('admin.voice.saveChanges') : t('admin.voice.addVoteItem')}
        </button>
        <button type="button" className="admin-btn-ghost" onClick={onCancel}>{t('admin.voice.cancel')}</button>
      </div>
    </form>
  )
}

function downloadKeyCard(card: string, title: string) {
  const safe = title.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase().slice(0, 40)
  const body =
    'Easy Voice — Tally key card\n' +
    'Vote: ' + title + '\n' +
    'Created: ' + new Date().toISOString() + '\n\n' +
    'Keep this card offline. If you forget the tally password, this card\n' +
    'is the only recovery path. Lose both and the ballots are permanently\n' +
    'unrecoverable.\n\n' +
    'Key (hex, dashes for readability):\n' +
    card + '\n'
  const blob = new Blob([body], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `easy-voice-tally-key-${safe || 'vote'}.txt`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

