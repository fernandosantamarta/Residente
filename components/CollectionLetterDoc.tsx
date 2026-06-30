'use client'

// Collections documents — print-ready HTML (Save as PDF). One parameterised page
// (?type=) renders each statutory artifact for a collection case: the 30-day
// notice of late assessment, the 45-day notice of intent to record a lien, a
// claim-of-lien draft, the 45-day notice of intent to foreclose, a sworn
// statement of account (affidavit + itemised ledger), a demand for rent from a
// tenant, and a payment-plan agreement. Every artifact is a DRAFT/aid, not an
// official filing, and the language requires attorney review before use.

import { Suspense, useState, useEffect } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { useT } from '@/lib/i18n'
import { supabase, hasSupabase } from '@/lib/supabase'
import { fmtMoney, casePayoff, type PayoffResult } from '@/lib/dues'
import { ymd, addCalendarDays } from '@/lib/compliance/rules-core'
import { resolveNoticeAddresses, ownerNoticeAddresses, dualAddressRule } from '@/lib/compliance/collections'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

type DocType = 'notice_30' | 'intent_to_lien' | 'claim_of_lien' | 'intent_to_foreclose' | 'ledger' | 'tenant_demand' | 'payment_plan'

const TITLES: Record<DocType, string> = {
  notice_30:           'Notice of Late Assessment',
  intent_to_lien:      'Notice of Intent to Record a Claim of Lien',
  claim_of_lien:       'Claim of Lien',
  intent_to_foreclose: 'Notice of Intent to Foreclose',
  ledger:              'Sworn Statement of Account',
  tenant_demand:       'Demand for Rent',
  payment_plan:        'Payment Plan Agreement',
}

// Shared by the admin document route (full — with "Mail certified") and the
// resident document route (readOnly: no mail button, no admin draft framing —
// the owner is just viewing the notice on their account). Data loads via RLS so
// the owner can read their own case.
export function CollectionLetterDoc({ readOnly = false }: { readOnly?: boolean }) {
  const t = useT()
  return (
    <Suspense fallback={<div style={{ padding: 40 }}>{t('admin.collectionsDetailDocument.loading')}</div>}>
      <DocInner readOnly={readOnly} />
    </Suspense>
  )
}

function DocInner({ readOnly = false }: { readOnly?: boolean }) {
  const t = useT()
  const params = useParams()
  const search = useSearchParams()
  const id = params?.id as string
  const type = (search?.get('type') || 'notice_30') as DocType

  const [c, setC] = useState<any>(null)
  const [community, setCommunity] = useState<any>(null)
  const [resident, setResident] = useState<any>(null)
  const [plan, setPlan] = useState<any>(null)
  const [payoff, setPayoff] = useState<PayoffResult | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [mailing, setMailing] = useState(false)
  const [mailMsg, setMailMsg] = useState('')

  // Letter types Lob can mail (the statutory notices). Drafts like the ledger /
  // claim-of-lien aren't mailed to the owner.
  const MAILABLE = ['notice_30', 'intent_to_lien', 'intent_to_foreclose', 'tenant_demand']
  const mailCertified = async () => {
    setMailing(true); setMailMsg('')
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('mail-letter', {
        body: { caseId: id, docType: type, certified: true },
      })
      let d = data as any
      // On a non-2xx, supabase-js puts the JSON body on the error's Response
      // (error.context), not on `data` — read it so the real reason shows.
      if (fnErr && (fnErr as any).context?.json) {
        try { d = await (fnErr as any).context.json() } catch { /* keep generic */ }
      }
      if (fnErr || d?.error) setMailMsg(d?.error || (fnErr as any)?.message || 'Could not mail the letter.')
      else setMailMsg(`Mailed via certified mail${d?.cost ? ` — $${d.cost} billed to the owner` : ''}.`)
    } catch (e: any) { setMailMsg(e?.message || 'Could not mail the letter.') }
    finally { setMailing(false) }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!hasSupabase || !id) { setStatus('error'); setError('No case'); return }
      try {
        const { data: cs, error: cErr } = (await withTimeout(supabase.from('ev_collection_cases').select('*').eq('id', id).single())) as any
        if (cErr) throw cErr
        const { data: comm } = (await withTimeout(supabase.from('communities').select('*').eq('id', cs.community_id).single())) as any
        let res: any = null, pays: any[] = []
        if (cs.resident_id) {
          const { data: r } = (await withTimeout(supabase.from('residents').select('*').eq('id', cs.resident_id).single())) as any
          res = r || null
          const { data: p } = (await withTimeout(supabase.from('payments').select('amount, created_at').eq('resident_id', cs.resident_id))) as any
          pays = p || []
        }
        const { data: pl } = (await withTimeout(supabase.from('ev_payment_plans').select('*').eq('case_id', id).order('created_at', { ascending: false }).limit(1))) as any
        if (cancelled) return
        setC(cs); setCommunity(comm || null); setResident(res); setPlan((pl && pl[0]) || null)
        if (res) {
          const iFroz = cs.freeze_interest == null ? !!cs.on_payment_plan : !!cs.freeze_interest
          const lFroz = cs.freeze_late_fees == null ? !!cs.on_payment_plan : !!cs.freeze_late_fees
          try { setPayoff(casePayoff(res, comm, pays, { extraCosts: (Number(cs.cost_balance) || 0) + (Number(cs.mailing_cost_balance) || 0), freezeInterest: iFroz, freezeLateFees: lFroz })) } catch { setPayoff(null) }
        }
        setStatus('ready')
      } catch (err: any) {
        if (!cancelled) { setError(err?.message || 'Could not load'); setStatus('error') }
      }
    })()
    return () => { cancelled = true }
  }, [id, type])

  if (status === 'loading') return <div style={{ padding: 40 }}>{t('admin.collectionsDetailDocument.loading')}</div>
  if (status === 'error') return <div style={{ padding: 40, color: '#B42318' }}>{error}</div>

  const isCondo = community?.association_type !== 'hoa'
  const today = ymd(new Date())
  // For the 30-day notice the statutory pay-by date must be anchored to the date
  // the notice was actually sent (notice_30_sent_at), not the rendering date.
  // If the case has no sent_at recorded yet (notice not yet mailed), fall back
  // to today so the draft still renders a usable date.
  const noticeBase = c.notice_30_sent_at || today
  // The 45-day windows likewise anchor to the date each notice was actually sent
  // (the stored stamp), not the rendering date, so a reprint never drifts the
  // statutory deadline. Fall back to today when the notice hasn't been logged yet.
  const lienNoticeBase = c.intent_to_lien_sent_at || today
  const foreNoticeBase = c.intent_to_foreclose_sent_at || today
  const amount = payoff ? fmtMoney(payoff.payoff) : null
  const ownerName = resident?.full_name || c.unit_label || 'Owner of record'

  // Two-address model: the owner's mailing address of record (last_known_address,
  // defaulting to the unit/parcel address) and the physical unit/parcel address
  // (the roster `address`). The statutory collection notices go to BOTH when they
  // differ — FS 718.121(5)/(6) condo, FS 720.3085(3)(d)/(4)(b) HOA.
  const addr = resolveNoticeAddresses(ownerNoticeAddresses(resident))
  const recordAddr = addr.recordAddress           // mailing address of record
  const unitAddr = resident?.address || null        // physical unit/parcel address
  const unit = resident?.unit_number || c.unit_label || ''
  const creditApplied = payoff
    ? payoff.gross.principal + payoff.gross.interest + payoff.gross.lateFee + payoff.gross.cost - payoff.payoff
    : 0
  // Map the doc type to its notice kind to resolve the dual-address rule + citation.
  const DOC_TO_KIND: Record<string, string> = {
    notice_30: 'late_assessment_30', intent_to_lien: 'intent_to_lien_45', intent_to_foreclose: 'intent_to_foreclose_45',
  }
  const aRule = DOC_TO_KIND[type] ? dualAddressRule(DOC_TO_KIND[type], isCondo ? 'condo' : 'hoa') : null
  const ownerDual = addr.dualRequired && !!aRule?.applies   // mail to both addresses
  const dualStatutory = !!aRule?.statutory                  // the second copy is mandated (vs. advised)

  const cite = (condo: string, hoa: string) => (isCondo ? condo : hoa)
  const Em = ({ children }: { children: any }) => <em style={{ color: '#B54708' }}>{children}</em>

  return (
    <div className="cl-page" style={{ padding: '24px 16px', boxSizing: 'border-box' }}>
      <div className="cl-sheet" style={{ maxWidth: 760, margin: '0 auto', padding: readOnly ? 32 : 0, fontFamily: 'Georgia, serif', color: '#111', lineHeight: 1.55, boxSizing: 'border-box',
        // Resident gets a white "paper" box (lifts the letter off the app hero);
        // admin stays borderless on its own light background.
        ...(readOnly ? { background: '#fff', border: '1px solid #e7e4dd', borderRadius: 14, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' } : {}) }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { margin: 0 }
          .cl-page { background: #fff !important; padding: 0 !important; min-height: 0 !important; }
          .cl-sheet { box-shadow: none !important; border: none !important; border-radius: 0 !important; max-width: none !important; padding: 0 !important; }
        }
        @media (max-width: 640px) {
          .rp-toolbar { flex-direction: column; align-items: stretch !important; }
          .rp-actions { margin-left: 0 !important; }
          .rp-actions button { flex: 1 1 0; }
        }
      `}</style>

      {/* Top banner: admins see the DRAFT/attorney-review warning; the owner sees
          a plain "copy of the notice on your account" note. */}
      <div className="no-print" style={{ fontSize: 12, background: readOnly ? '#EFF4FF' : '#FEF3F2', color: readOnly ? '#175CD3' : '#B42318', padding: '14px 18px', borderRadius: 8, lineHeight: 1.5, marginBottom: 36, fontFamily: 'system-ui, sans-serif' }}>
        {readOnly ? 'This is a copy of the notice on file for your account. Contact the association with any questions.' : t('admin.collectionsDetailDocument.draftWarning')}
      </div>
      {/* Toolbar: Back hard-left; Mail certified (admin only) + Print on the right. */}
      <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 56, fontFamily: 'system-ui, sans-serif' }}>
        <button onClick={() => { if (readOnly && typeof window !== 'undefined') { window.location.href = '/app/track#pay' } else { history.back() } }} style={{ background: '#fff', color: '#111', border: '1px solid #d4d4d4', borderRadius: 8, padding: '9px 16px', fontWeight: 600, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>{t('admin.overview.back')}</button>
        <div className="rp-actions" style={{ display: 'flex', gap: 8, marginLeft: 'auto', alignItems: 'center' }}>
          {!readOnly && MAILABLE.includes(type) && (
            <button onClick={mailCertified} disabled={mailing} style={{ background: '#fff', color: '#111', border: '1px solid #d4d4d4', borderRadius: 8, padding: '9px 16px', fontWeight: 600, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap', opacity: mailing ? 0.6 : 1 }}>{mailing ? t('admin.collectionsDetailDocument.mailing') : t('admin.collectionsDetailDocument.mailCertified')}</button>
          )}
          <button onClick={() => window.print()} style={{ background: '#111', color: '#fff', border: 0, borderRadius: 8, padding: '9px 18px', fontWeight: 700, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>{t('admin.collectionsDetailDocument.printButton')}</button>
        </div>
      </div>
      {!readOnly && mailMsg && <div className="no-print" style={{ fontFamily: 'system-ui, sans-serif', fontSize: 13, color: mailMsg.startsWith('Mailed') ? '#067647' : '#B42318', marginBottom: 12 }}>{mailMsg}</div>}

      {/* Letterhead */}
      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{community?.name || 'Association'}</div>
        <div style={{ fontSize: 12.5, color: '#555' }}>{community?.association_address || <Em>set the association address in Community settings</Em>}</div>
      </div>
      <div style={{ fontSize: 12.5, color: '#555', marginBottom: 4 }}>{today}</div>

      <h1 style={{ fontSize: 19, marginBottom: 4 }}>{TITLES[type]}</h1>

      {/* Recipient block (skip for ledger which has its own caption) */}
      {type !== 'ledger' && (
        <div style={{ fontSize: 13.5, marginBottom: 14 }}>
          {type === 'tenant_demand' ? (
            <>
              <div>{resident?.tenant_name || <Em>tenant name</Em>}</div>
              <div>{unitAddr || <Em>unit address</Em>}</div>
            </>
          ) : (
            <>
              <div>{ownerName}</div>
              <div>{recordAddr || <Em>last known address</Em>}</div>
              {ownerDual && (
                <div style={{ marginTop: 6 }}>
                  <div style={{ fontSize: 11.5, color: '#B54708' }}>
                    {dualStatutory
                      ? 'and a copy by first-class U.S. mail to the unit/parcel address (statute requires both):'
                      : 'and, as a precaution, a copy by first-class U.S. mail to the unit/parcel address:'}
                  </div>
                  <div>{unitAddr}</div>
                </div>
              )}
            </>
          )}
          {unit && <div>Re: Unit / parcel {unit}</div>}
        </div>
      )}

      {/* Body per type */}
      {type === 'notice_30' && (
        <Body>
          <p>The following amounts are currently due on your account to {community?.name || 'the association'}, and <strong>must be paid within thirty (30) days after the date of this notice</strong> (on or before <strong>{ymd(addCalendarDays(noticeBase, 30))}</strong>). This letter shall serve as the association&apos;s notice of its intent to proceed with further collection action against the above {isCondo ? 'unit' : 'parcel'} no sooner than 30 days after the date of this notice, unless you pay in full the amounts set forth below:</p>
          <table style={tbl}><tbody>
            <Trow label={isCondo ? 'Maintenance / assessments due' : 'Assessments due'} value={payoff ? fmtMoney(payoff.gross.principal) : <Em>confirm from ledger</Em>} />
            <Trow label="Late fee, if applicable" value={payoff ? fmtMoney(payoff.gross.lateFee) : <Em>—</Em>} />
            <Trow label={`Interest through ${payoff?.asOf || today}`} value={payoff ? fmtMoney(payoff.gross.interest) : <Em>—</Em>} />
            {payoff && payoff.gross.cost > 0 && <Trow label="Other costs" value={fmtMoney(payoff.gross.cost)} />}
            {creditApplied > 0.005 && <Trow label="Less: payments applied" value={'– ' + fmtMoney(creditApplied)} />}
            <tr><td style={{ ...td, fontWeight: 800, borderTop: '2px solid #111' }}>Total outstanding</td><td style={{ ...td, fontWeight: 800, borderTop: '2px solid #111' }}>{amount || <Em>confirm from ledger</Em>}</td></tr>
          </tbody></table>
          <p>If the total amount due is not paid within 30 days, the association may charge late fees, interest, and the costs of collection — including reasonable attorney&apos;s fees — and may proceed to record a claim of lien against the {isCondo ? 'unit' : 'parcel'} and pursue all available remedies. <strong>The association may not require you to pay attorney&apos;s fees related to this past-due assessment without first delivering this notice and giving you the opportunity to pay the amount owed without the assessment of attorney&apos;s fees.</strong></p>
          {ownerDual && (
            <p style={{ fontSize: 12, color: '#B54708' }}>This notice is being sent by first-class U.S. mail to your address of record and, because that address is not the {isCondo ? 'unit' : 'parcel'} address, also by first-class U.S. mail to the {isCondo ? 'unit' : 'parcel'} address. Notice is deemed delivered upon mailing.</p>
          )}
          <p style={{ fontSize: 12, color: '#555' }}>This Notice of Late Assessment is provided under {cite('Florida Statutes § 718.121(5)', 'Florida Statutes § 720.3085(3)(d)')}.</p>
        </Body>
      )}

      {type === 'intent_to_lien' && (
        <Body>
          <p>You are hereby notified of the association&apos;s intent to record a <strong>Claim of Lien</strong> against the above unit/parcel for unpaid assessments, interest, late fees, and costs. As of {today}, the amount owed is <strong>{amount || <Em>confirm from ledger</Em>}</strong>.</p>
          <p>If the total amount is not paid within <strong>forty-five (45) days</strong> of this notice, on or before <strong>{ymd(addCalendarDays(lienNoticeBase, 45))}</strong>, the association may record a claim of lien and, thereafter, foreclose that lien and recover its costs and reasonable attorney&apos;s fees.</p>
          <p style={{ fontSize: 12, color: '#555' }}>This notice is given under {cite('Florida Statutes § 718.121(6)', 'Florida Statutes § 720.3085(4)(b)')} and is being sent by certified or registered mail (return receipt requested) and by first-class U.S. mail to your address of record{ownerDual ? ', and also by first-class U.S. mail to the unit/parcel address because that address differs from your address of record' : ''}.</p>
        </Body>
      )}

      {type === 'claim_of_lien' && (
        <Body>
          <p style={{ fontSize: 12, color: '#555' }}>Prepared by / return to: {community?.association_officer_name || <Em>officer/agent</Em>}, {community?.association_address || <Em>association address</Em>}.</p>
          <p>{community?.name || 'The association'} claims a lien against the following property for unpaid assessments and all related interest, late fees, costs, and reasonable attorney&apos;s fees:</p>
          <table style={tbl}><tbody>
            <Trow label="Owner of record" value={ownerName} />
            <Trow label="Unit / parcel" value={unit || <Em>legal description</Em>} />
            <Trow label="Legal description" value={<Em>insert legal description</Em>} />
            <Trow label="Amount claimed (as of date)" value={amount || <Em>confirm from ledger</Em>} />
            <Trow label="Due dates of unpaid assessments" value={payoff?.lines?.length ? `${payoff.lines[0].dueDate} – ${payoff.lines[payoff.lines.length - 1].dueDate}` : <Em>confirm</Em>} />
          </tbody></table>
          <p style={{ fontSize: 12, color: '#555' }}>Recorded under {cite('Florida Statutes § 718.116(5)', 'Florida Statutes § 720.3085(1)')}. This draft must be reviewed, the legal description inserted, and the instrument executed and acknowledged before a notary prior to recording with the county clerk.</p>
        </Body>
      )}

      {type === 'intent_to_foreclose' && (
        <Body>
          <p>A Claim of Lien was recorded against the above unit/parcel{c.lien_recorded_at ? ` on ${c.lien_recorded_at}` : ''}. The amount secured by the lien remains unpaid. As of {today}, the amount owed is <strong>{amount || <Em>confirm from ledger</Em>}</strong>.</p>
          <p>You are hereby notified of the association&apos;s intent to <strong>foreclose</strong> the lien. If the total amount is not paid within <strong>forty-five (45) days</strong> of this notice, on or before <strong>{ymd(addCalendarDays(foreNoticeBase, 45))}</strong>, the association may file an action to foreclose its lien and recover its costs and reasonable attorney&apos;s fees.</p>
          <p style={{ fontSize: 12, color: '#555' }}>This notice is given under {cite('Florida Statutes § 718.116(6)(b)', 'Florida Statutes § 720.3085(5)')}{ownerDual ? (dualStatutory ? ', and is being sent to your address of record and the parcel address' : ', and is being sent to your address of record (with a precautionary copy to the unit address)') : ''}.</p>
        </Body>
      )}

      {type === 'ledger' && (
        <Body>
          <p style={{ marginBottom: 6 }}>Statement of account for <strong>{ownerName}</strong>{unit ? `, Unit/parcel ${unit}` : ''}, as of {payoff?.asOf || today}.</p>
          {payoff ? (
            <>
              <table style={tbl}><thead><tr>
                <th style={th}>Installment due</th><th style={thR}>Principal</th><th style={thR}>Interest</th><th style={thR}>Late fee</th>
              </tr></thead><tbody>
                {payoff.lines.map((l, i) => (
                  <tr key={i}><td style={td}>{l.dueDate}</td><td style={tdR}>{fmtMoney(l.principal)}</td><td style={tdR}>{fmtMoney(l.interest)}</td><td style={tdR}>{fmtMoney(l.lateFee)}</td></tr>
                ))}
                <tr><td style={{ ...td, fontWeight: 700 }}>Subtotals</td><td style={{ ...tdR, fontWeight: 700 }}>{fmtMoney(payoff.gross.principal)}</td><td style={{ ...tdR, fontWeight: 700 }}>{fmtMoney(payoff.gross.interest)}</td><td style={{ ...tdR, fontWeight: 700 }}>{fmtMoney(payoff.gross.lateFee)}</td></tr>
              </tbody></table>
              <table style={{ ...tbl, marginTop: 10 }}><tbody>
                <Trow label="Collection / attorney costs" value={fmtMoney(payoff.gross.cost)} />
                <Trow label="Less payments (applied interest → fees → costs → principal)" value={'– ' + fmtMoney(payoff.gross.principal + payoff.gross.interest + payoff.gross.lateFee + payoff.gross.cost - payoff.payoff)} />
                <tr><td style={{ ...td, fontWeight: 800, borderTop: '2px solid #111' }}>Total due as of {payoff.asOf}</td><td style={{ ...tdR, fontWeight: 800, borderTop: '2px solid #111' }}>{fmtMoney(payoff.payoff)}</td></tr>
              </tbody></table>
            </>
          ) : <p><Em>Link a roster owner to compute the itemised ledger.</Em></p>}
          <p style={{ fontSize: 12, color: '#555', marginTop: 14 }}>STATE OF FLORIDA, COUNTY OF ______________. The undersigned officer/agent of the association, being duly sworn, states that the foregoing account is true and correct to the best of their knowledge. Sworn to and subscribed before me this ____ day of ____________, 20____.</p>
        </Body>
      )}

      {type === 'tenant_demand' && (
        <Body>
          <p>The owner of the unit/parcel you occupy is delinquent in the payment of assessments to {community?.name || 'the association'}. Under {cite('Florida Statutes § 718.116(11)', 'Florida Statutes § 720.3085(8)')}, the association is entitled to collect rent from the tenant of a delinquent unit until the unpaid amount is paid in full.</p>
          <p>You are hereby directed to pay all subsequent rent due under your lease to the association, at the address above, beginning with the next rental payment, until further written notice. Payment to the association as directed will satisfy your rent obligation to the owner for the amounts paid.</p>
          <p style={{ fontSize: 12, color: '#555' }}>Amount of the owner&apos;s delinquency as of {today}: <strong>{amount || <Em>confirm from ledger</Em>}</strong>.</p>
          <p style={{ fontSize: 12, color: '#555' }}>A separate written notice of this demand is also being provided to the owner of record, as required by {cite('Florida Statutes § 718.116(11)', 'Florida Statutes § 720.3085(8)')}.</p>
        </Body>
      )}

      {type === 'payment_plan' && (
        <Body>
          <p>{community?.name || 'The association'} and {ownerName} agree to the following plan to cure the delinquency on the above unit/parcel. This agreement does not waive the association&apos;s lien rights or its right to resume collection if a payment is missed.</p>
          {plan ? (
            <table style={tbl}><tbody>
              <Trow label="Total amount to be paid" value={amount || <Em>confirm from ledger</Em>} />
              <Trow label="Installment amount" value={fmtMoney(plan.installment_amount)} />
              <Trow label="Number of installments" value={plan.installment_count ?? <Em>confirm</Em>} />
              <Trow label="Frequency" value={`every ${plan.frequency_days || 30} days`} />
              <Trow label="First payment due" value={plan.next_due_at || plan.start_date} />
            </tbody></table>
          ) : <p><Em>Create a payment plan on the case detail page to populate the terms.</Em></p>}
          <SignatureBlock left="Owner" right={community?.association_officer_name || 'Association officer / agent'} />
        </Body>
      )}

      {/* Signature for the letters (not ledger / plan, which have their own) */}
      {(type === 'notice_30' || type === 'intent_to_lien' || type === 'intent_to_foreclose' || type === 'tenant_demand' || type === 'claim_of_lien' || type === 'ledger') && (
        <div style={{ marginTop: 36, fontSize: 14 }}>
          <div style={{ borderTop: '1px solid #111', width: 300, paddingTop: 6 }}>
            {community?.association_officer_name || 'Authorized officer / agent'}
          </div>
          <div style={{ fontSize: 12, color: '#555' }}>{community?.name || 'Association'}</div>
        </div>
      )}
      </div>
    </div>
  )
}

function Body({ children }: { children: any }) {
  return <div style={{ fontSize: 14 }}>{children}</div>
}

function SignatureBlock({ left, right }: { left: string; right: string }) {
  return (
    <div style={{ display: 'flex', gap: 40, marginTop: 40, fontSize: 13 }}>
      <div style={{ flex: 1 }}><div style={{ borderTop: '1px solid #111', paddingTop: 6 }}>{left}</div><div style={{ color: '#555', fontSize: 12 }}>Date: __________</div></div>
      <div style={{ flex: 1 }}><div style={{ borderTop: '1px solid #111', paddingTop: 6 }}>{right}</div><div style={{ color: '#555', fontSize: 12 }}>Date: __________</div></div>
    </div>
  )
}

function Trow({ label, value }: { label: string; value: any }) {
  return <tr><td style={{ ...td, fontWeight: 600, width: '46%' }}>{label}</td><td style={td}>{value ?? '—'}</td></tr>
}

const tbl: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13.5, marginTop: 8 }
const td: React.CSSProperties = { padding: '6px 10px', borderBottom: '1px solid #eee', verticalAlign: 'top' }
const tdR: React.CSSProperties = { ...td, textAlign: 'right' }
const th: React.CSSProperties = { padding: '6px 10px', borderBottom: '2px solid #ccc', textAlign: 'left', fontSize: 12.5 }
const thR: React.CSSProperties = { ...th, textAlign: 'right' }
