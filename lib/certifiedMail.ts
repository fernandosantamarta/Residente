// Certified-mail rail (client side) for statutory collection notices.
//
// The board presses "Generate & mail (certified)" on a collection case; this
// composes the statutory letter (title, citation footer, body paragraphs) from
// the SAME payoff math + citations the printable /document page uses, then hands
// it to the collection-notice-mail edge function, which renders it to PDF and
// mails it through Lob (certified, return-receipt for the intent-to-lien notice).
//
// The legal text lives HERE (one source of truth shared with the print page's
// wording); the edge function only does Lob layout + transport + ledger logging.
// Everything is DARK until LOB_API_KEY is set — mailCollectionNotice() reports
// `notConfigured` so the caller falls back to print-and-mail-by-hand.

import { hasSupabase, supabase } from './supabase'
import type { CollectionNoticeKind } from './compliance/collections'

export interface NoticeLetterCtx {
  communityName: string
  isCondo: boolean
  /** formatted payoff string (e.g. "$1,240.00") or null when no ledger is linked */
  amount: string | null
  /** today, YYYY-MM-DD */
  today: string
  /** statutory pay-by date, YYYY-MM-DD (date of notice + 30 or + 45) */
  payByDate: string
  /** the notice goes to both the record and unit/parcel addresses */
  ownerDual: boolean
  /** the second copy is statutorily mandated (vs. advised) */
  dualStatutory: boolean
  /** unit / parcel label for the RE: line */
  unitLabel?: string
}

export interface NoticeLetter {
  title: string
  citation: string
  paragraphs: string[]
  footer: string
}

const ATTY = 'This is an association collection notice prepared by Residente as an aid; it requires review by the association’s attorney before reliance.'

/**
 * Compose the mailed letter for one of the three statutory collection notices.
 * Mirrors the wording + citations of app/admin/collections/[id]/document/page.tsx
 * so the certified piece matches the printable preview. Pure.
 */
export function noticeLetterContent(kind: CollectionNoticeKind, ctx: NoticeLetterCtx): NoticeLetter {
  const name = ctx.communityName || 'the association'
  const prop = ctx.isCondo ? 'unit' : 'parcel'
  const amt = ctx.amount || 'the amount shown on the enclosed account ledger'
  const cite = (condo: string, hoa: string) => (ctx.isCondo ? condo : hoa)
  const reLine = ctx.unitLabel ? `RE: ${ctx.isCondo ? 'Unit' : 'Parcel'} ${ctx.unitLabel} — past-due assessments` : ''

  const dualSentence = ctx.ownerDual
    ? ` This notice is being sent to your address of record and, because that address is not the ${prop} address, also by first-class U.S. mail to the ${prop} address. Notice is deemed delivered upon mailing.`
    : ''

  if (kind === 'late_assessment_30') {
    const citation = cite('Florida Statutes § 718.121(5)', 'Florida Statutes § 720.3085(3)(d)')
    return {
      title: 'Notice of Late Assessment',
      citation,
      paragraphs: [
        reLine,
        `The following amount is currently due on your account to ${name} and must be paid within thirty (30) days after the date of this notice (on or before ${ctx.payByDate}). This letter serves as the association’s notice of its intent to proceed with further collection action against the above ${prop} no sooner than 30 days after the date of this notice, unless the amount due is paid in full.`,
        `Total amount due as of ${ctx.today}: ${amt}.`,
        `If the total amount due is not paid within 30 days, the association may charge late fees, interest, and the costs of collection — including reasonable attorney’s fees — and may proceed to record a claim of lien against the ${prop} and pursue all available remedies. The association may not require you to pay attorney’s fees related to this past-due assessment without first delivering this notice and giving you the opportunity to pay the amount owed without the assessment of attorney’s fees.${dualSentence}`,
      ].filter(Boolean),
      footer: `This Notice of Late Assessment is provided under ${citation}. ${ATTY}`,
    }
  }

  if (kind === 'intent_to_lien_45') {
    const citation = cite('Florida Statutes § 718.121(6)', 'Florida Statutes § 720.3085(4)(b)')
    return {
      title: 'Notice of Intent to Record a Claim of Lien',
      citation,
      paragraphs: [
        reLine,
        `You are hereby notified of the association’s intent to record a Claim of Lien against the above ${prop} for unpaid assessments, interest, late fees, and costs. As of ${ctx.today}, the amount owed is ${amt}.`,
        `If the total amount is not paid within forty-five (45) days of this notice, on or before ${ctx.payByDate}, the association may record a claim of lien and, thereafter, foreclose that lien and recover its costs and reasonable attorney’s fees.`,
      ].filter(Boolean),
      footer: `This notice is given under ${citation} and is being sent by certified or registered mail (return receipt requested) and by first-class U.S. mail to your address of record${ctx.ownerDual ? `, and also by first-class U.S. mail to the ${prop} address because that address differs from your address of record` : ''}. ${ATTY}`,
    }
  }

  // intent_to_foreclose_45
  const citation = cite('Florida Statutes § 718.116(6)(b)', 'Florida Statutes § 720.3085(5)')
  return {
    title: 'Notice of Intent to Foreclose',
    citation,
    paragraphs: [
      reLine,
      `A Claim of Lien was recorded against the above ${prop}. The amount secured by the lien remains unpaid. As of ${ctx.today}, the amount owed is ${amt}.`,
      `You are hereby notified of the association’s intent to foreclose the lien. If the total amount is not paid within forty-five (45) days of this notice, on or before ${ctx.payByDate}, the association may file an action to foreclose its lien and recover its costs and reasonable attorney’s fees.${dualSentence}`,
    ].filter(Boolean),
    footer: `This notice is given under ${citation}. ${ATTY}`,
  }
}

export interface MailNoticeArgs {
  caseId: string
  kind: CollectionNoticeKind
  recipientName: string
  recordAddress: string | null
  unitAddress: string | null
  dualRequired: boolean
  dateStr: string
  title: string
  paragraphs: string[]
  footer: string
}

export interface MailNoticeResult {
  ok: boolean
  notConfigured?: boolean
  needsAddress?: 'from' | 'to'
  letters?: number
  trackingNumber?: string | null
  error?: string
}

/**
 * Send a composed statutory notice through the certified-mail rail. Returns
 * `notConfigured` (LOB_API_KEY unset) or `needsAddress` (no parseable mailing
 * address) so the caller can fail soft to manual print + mail. On success the
 * edge function has already logged the notice on the case ledger.
 */
export async function mailCollectionNotice(a: MailNoticeArgs): Promise<MailNoticeResult> {
  if (!hasSupabase || !supabase) return { ok: false, error: 'Offline.' }
  try {
    const { data, error } = await supabase.functions.invoke('collection-notice-mail', {
      body: {
        case_id: a.caseId,
        kind: a.kind,
        recipient_name: a.recipientName,
        record_address: a.recordAddress || '',
        unit_address: a.unitAddress || '',
        dual_required: a.dualRequired,
        date_str: a.dateStr,
        title: a.title,
        paragraphs: a.paragraphs,
        footer: a.footer,
      },
    })
    // supabase-js surfaces a non-2xx as `error` with the Response on .context.
    if (error) {
      let payload: any = null
      try { payload = (error as any)?.context ? await (error as any).context.json() : null } catch { /* ignore */ }
      if (payload?.code === 'not_configured') return { ok: false, notConfigured: true }
      if (payload?.code === 'needs_from_address') return { ok: false, needsAddress: 'from', error: payload?.error }
      if (payload?.code === 'needs_to_address') return { ok: false, needsAddress: 'to', error: payload?.error }
      return { ok: false, error: payload?.error || (error as any)?.message || 'Could not mail the notice.' }
    }
    if (!data?.ok) return { ok: false, error: data?.error || 'Could not mail the notice.' }
    return { ok: true, letters: data.letters, trackingNumber: data.tracking_number ?? null }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not mail the notice.' }
  }
}
