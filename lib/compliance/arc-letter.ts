// Architectural Review (ARC) decision letter — single source of the letter's
// CONTENT. Both the print-ready document page (app/admin/arc/[id]/document) and
// the arc-decision-letter edge function (which renders the PDF the board sends
// to the owner) build their copy from these helpers, so the on-screen letter,
// the saved-as-PDF letter, and the delivered PDF can never drift apart.
//
// This module is intentionally PURE and import-free (no React, no `@/` aliases,
// no sibling imports). That is what lets the Deno edge function import it by
// relative path and bundle it cleanly alongside the Next.js build.
//
// ⚠ The legal language below is a DRAFT aid — it must be reviewed and approved
//   by the association's attorney before use (FS 720.3035 / FS 718.113(2)).

// ----------------------------------------------------------------------------
// Input — already-resolved, display-ready values (the caller owns label lookup
// so this module needs no dependency on arc.ts).
// ----------------------------------------------------------------------------
export interface ArcLetterInput {
  associationName: string
  isCondo: boolean
  unitLabel: string
  typeLabel: string
  status: string            // 'approved' | 'approved_with_conditions' | 'denied' | …
  statusLabel: string
  description: string
  attachmentName: string
  submittedAt: string
  decidedAt: string
  decisionReason: string
  isMaterialAlteration: boolean
  materialPct: number
}

// A block of letter body. `**double-asterisk**` runs mark emphasis (rendered as
// <strong> on screen and bold font in the PDF) — see splitEmphasis().
export interface LetterBlock {
  kind: 'p' | 'box'
  text: string
  tone?: 'normal' | 'fine' | 'warn'  // normal body / small print / amber warning
  bold?: boolean                     // whole-block bold (used for the denial reason box)
}

const cite = (isCondo: boolean, condo: string, hoa: string) => (isCondo ? condo : hoa)

/** Opening sentence. */
export function arcLetterIntro(i: ArcLetterInput): string {
  return `This letter constitutes the written decision of ${i.associationName || 'the association'} `
    + `on your Architectural Review Committee (ARC) application described below.`
}

/** The fact table rows (label, value) summarizing the request + decision. */
export function arcLetterFactRows(i: ArcLetterInput): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ['Owner / unit', i.unitLabel || 'owner name / unit'],
    ['Request type', i.typeLabel],
    ['Description', i.description || 'no description provided'],
  ]
  if (i.attachmentName) rows.push(['Attachment', `${i.attachmentName} (on file)`])
  rows.push(['Submitted', i.submittedAt || 'unknown'])
  rows.push(['Decision date', i.decidedAt || 'unknown'])
  rows.push(['Decision', i.statusLabel])
  return rows
}

/**
 * The decision-specific body: the approve / approve-with-conditions / deny
 * language, plus the condo material-alteration note. Empty for a request that
 * has not been decided yet (the screen page shows its own "no decision" notice).
 */
export function arcLetterDecisionBlocks(i: ArcLetterInput): LetterBlock[] {
  const out: LetterBlock[] = []
  const st = i.status

  if (st === 'approved') {
    out.push({
      kind: 'p',
      text: `After review, the association **approves** the above request. The owner may proceed `
        + `with the proposed work in accordance with the association's governing documents, applicable `
        + `rules, and ${cite(i.isCondo, 'Florida Statutes § 718.113', 'Florida Statutes § 720.3035')}.`,
    })
    out.push({
      kind: 'p', tone: 'fine',
      text: `This approval does not waive or limit any requirement of applicable local building codes, `
        + `permits, or other governmental approvals that may be required.`,
    })
  } else if (st === 'approved_with_conditions') {
    out.push({
      kind: 'p',
      text: `After review, the association **approves** the above request, subject to the following conditions:`,
    })
    out.push({ kind: 'box', text: i.decisionReason || 'state the conditions of approval' })
    out.push({
      kind: 'p',
      text: `The owner must comply with the above conditions in all aspects of the work. This approval `
        + `does not waive or limit any requirement of applicable local building codes, permits, or other `
        + `governmental approvals that may be required.`,
    })
  } else if (st === 'denied') {
    out.push({
      kind: 'p',
      text: `After review, the association **denies** the above request for the following specific reason(s):`,
    })
    out.push({
      kind: 'box', bold: true,
      text: i.decisionReason
        || `state the specific reason(s) for the denial — a denial must include written reasons `
           + `(${cite(i.isCondo, 'FS 718.113', 'FS 720.3035(3)')})`,
    })
    out.push({
      kind: 'p',
      text: `The association is required to apply its architectural standards consistently and in conformity `
        + `with its governing documents and ${cite(i.isCondo, 'Florida Statutes § 718.113(2)', 'Florida Statutes § 720.3035')}. `
        + `You may have the right to appeal this decision under the association's governing documents. Please `
        + `review your Declaration and Bylaws for the applicable appeal procedures, or consult with legal counsel.`,
    })
  }

  if (i.isCondo && i.isMaterialAlteration) {
    out.push({
      kind: 'p', tone: 'warn',
      text: `Note — Material Alteration: The proposed work has been identified as a material alteration or `
        + `substantial addition to the common elements of the condominium. Under Florida Statutes § 718.113(2), `
        + `a material alteration or substantial addition requires approval of ${i.materialPct}% of the total `
        + `voting interests of the association, unless the Declaration provides otherwise. Board approval alone `
        + `may not be sufficient to authorize this work. Confirm with legal counsel and the membership vote `
        + `requirement before proceeding.`,
    })
  }

  return out
}

/** Closing / attorney-review paragraph. */
export function arcLetterClosing(i: ArcLetterInput): string {
  return `This decision is made under ${cite(i.isCondo, 'Florida Statutes § 718.113(2)', 'Florida Statutes § 720.3035')} `
    + `and the association's governing documents. This letter is a draft prepared by Residente as an administrative `
    + `aid and must be reviewed and approved by the association's attorney before use.`
}

/** A human-readable file name for the delivered PDF. */
export function arcLetterFilename(i: Pick<ArcLetterInput, 'unitLabel' | 'decidedAt'>): string {
  const who = (i.unitLabel || 'owner').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'owner'
  const when = (i.decidedAt || '').replace(/[^0-9]/g, '').slice(0, 8)
  return `ARC-decision-letter-${who}${when ? `-${when}` : ''}.pdf`
}

/**
 * Split a body string into runs, marking `**…**`-wrapped spans as bold. Both
 * renderers (React <strong> and pdf-lib bold font) walk this so emphasis stays
 * consistent and defined in exactly one place.
 */
export function splitEmphasis(text: string): Array<{ text: string; bold: boolean }> {
  const out: Array<{ text: string; bold: boolean }> = []
  const parts = text.split('**')
  for (let n = 0; n < parts.length; n++) {
    if (parts[n] === '') continue
    out.push({ text: parts[n], bold: n % 2 === 1 })
  }
  return out.length ? out : [{ text, bold: false }]
}
