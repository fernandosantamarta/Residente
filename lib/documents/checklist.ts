import type { DocCategory } from '@/lib/compliance/official-records'
import type { PropertyType } from '@/lib/signup'

// The community document checklist — the canonical "what every HOA should have on
// file" list. It powers two places: the /signup document-collection wizard (where
// a board first gathers docs) and the /admin overview "Upload documents" popup
// (where they finish the job later). Keeping it here means both stay in lockstep.
//
// Each section maps to a canonical DocCategory so attached files land in the right
// shelf of the community's vault (see lib/compliance/official-records.ts for the
// category set and app/admin/documents for where they surface). The category is
// per-section; the item label becomes each document's title.
export type DocItem = { name: string; desc: string; key?: 'ccrs' | 'budget' | 'roster' }
export type DocSection = { emoji: string; label: string; category: DocCategory; items: DocItem[] }

export const DOC_SECTIONS: DocSection[] = [
  { emoji: '📄', label: 'Governing documents', category: 'Governing Documents', items: [
    { name: 'CC&Rs (Covenants, Conditions & Restrictions)', key: 'ccrs', desc: 'The recorded legal rulebook that runs with the land and binds every owner — sets property restrictions, the power to charge assessments, and who maintains what.' },
    { name: 'HOA Bylaws', desc: "The association's operating manual: how the board is elected, how meetings and votes work, and officer duties and terms." },
    { name: 'Articles of Incorporation', desc: 'The short charter filed with the state that legally creates the association as a corporation.' },
    { name: 'Rules & regulations', desc: 'Day-to-day rules the board adopts under the CC&Rs (pool hours, parking, noise) — easier to change than the CC&Rs themselves.' },
    { name: 'Architectural standards', desc: 'Design rules for exterior changes — paint, fences, additions — and how owners get approval before building.' },
    { name: 'Rental / leasing restrictions', desc: 'Limits on renting out units — minimum lease terms, caps on rentals, and tenant approval or registration.' },
    { name: 'Pet policy', desc: 'What pets are allowed, any size or breed limits, leash and waste rules, and registration requirements.' },
  ] },
  { emoji: '💰', label: 'Financial records', category: 'Financial Documents', items: [
    { name: 'Current annual budget', key: 'budget', desc: "The board-approved plan of income and expenses for the year — the basis for each owner's dues." },
    { name: 'Reserve fund study', desc: 'A professional forecast of major future repairs (roof, paving) and how much to set aside each year for them.' },
    { name: 'Reserve fund balance statement', desc: 'How much is actually saved today in the reserve account for big-ticket repairs.' },
    { name: 'Delinquency report', desc: 'Owners behind on dues or assessments and how much each one owes.' },
    { name: 'Income & expense statement', desc: 'What the association earned and spent over a period — its profit-and-loss.' },
    { name: 'Insurance declarations', desc: "The summary pages of each policy showing what's covered, the limits, and deductibles." },
    { name: 'Bank statements (last 3 months)', desc: 'Recent statements for the operating and reserve accounts.' },
    { name: 'Most recent audit', desc: "An independent accountant's review confirming the financial statements are accurate." },
    { name: 'Tax returns (last 2 years)', desc: "The association's filed federal (and state) income tax returns." },
  ] },
  { emoji: '👥', label: 'Ownership & membership', category: 'Other', items: [
    { name: 'Homeowner roster with contact info', key: 'roster', desc: 'Master list of every owner with mailing address, email, and phone for official notices.' },
    { name: 'Board member roster', desc: 'Names, roles, and terms of the current board of directors.' },
    { name: 'Committee member list', desc: 'Members serving on committees (architectural, social, finance) and what each covers.' },
    { name: 'Tenant directory', desc: 'List of renters and their units — where the community tracks non-owner occupants.' },
    { name: 'Delinquency list', desc: 'Current list of accounts past due, used for collections and lien decisions.' },
  ] },
  { emoji: '📅', label: 'Meetings & governance', category: 'Reports & Meeting Minutes', items: [
    { name: 'Board meeting minutes (last 12 mo.)', desc: 'Official written record of what the board discussed and decided at each meeting.' },
    { name: 'Annual meeting minutes (last 2 yr.)', desc: 'Record of the yearly membership meeting — elections, budget ratification, and owner business.' },
    { name: 'Election procedures', desc: 'The rules for nominating candidates, voting, and counting ballots for board elections.' },
    { name: 'Board resolution log', desc: 'A running list of formal board decisions and policies adopted by vote.' },
    { name: 'Proxy / ballot forms', desc: 'The forms owners use to vote, or to assign their vote to someone else.' },
  ] },
  { emoji: '🏠', label: 'Property & maintenance', category: 'Vendor & Contracts', items: [
    { name: 'Maintenance schedule', desc: 'The plan and calendar for routine upkeep of common areas and equipment.' },
    { name: 'Inspection reports', desc: 'Results of structural, elevator, fire, or pest inspections of the property.' },
    { name: 'Capital improvement list', desc: 'Planned major upgrades or replacements beyond routine maintenance.' },
    { name: 'Landscape contract', desc: 'The agreement with the lawn / landscaping vendor — scope, schedule, and cost.' },
    { name: 'Pool / amenity contracts', desc: 'Service agreements for the pool, gym, gate, or other shared amenities.' },
    { name: 'Open work orders', desc: 'Repairs and service requests currently in progress or waiting.' },
  ] },
  { emoji: '📋', label: 'Contracts & vendors', category: 'Vendor & Contracts', items: [
    { name: 'Property management agreement', desc: 'The contract with your management company — services, fees, and term.' },
    { name: 'Active vendor contracts', desc: 'All current service agreements (security, trash, elevator, and so on).' },
    { name: 'Vendor insurance certificates', desc: "Proof that each vendor carries liability and workers' comp insurance." },
    { name: 'Utility account info', desc: 'Account numbers and providers for shared electric, water, gas, and internet.' },
    { name: 'Waste removal contract', desc: 'The trash and recycling pickup agreement — schedule and cost.' },
  ] },
  { emoji: '⚖️', label: 'Compliance & legal', category: 'Other', items: [
    { name: 'State HOA registration', desc: 'Your filing or registration with the state agency that oversees associations.' },
    { name: 'Pending litigation', desc: 'Any active lawsuits the association is involved in, as plaintiff or defendant.' },
    { name: 'Open violations log', desc: 'Owners currently cited for rule violations and the status of each case.' },
    { name: 'Prior violation notices', desc: 'Past warning and fine letters sent to owners for rule breaches.' },
    { name: 'Fair housing records', desc: 'Documentation showing the association follows fair-housing and accommodation laws.' },
  ] },
  { emoji: '🔧', label: 'Operations', category: 'Other', items: [
    { name: 'Emergency contact list', desc: 'Who to call for after-hours emergencies — vendors, board, utilities.' },
    { name: 'Gate / access codes', desc: 'Current codes and credentials for gates, doors, and shared spaces.' },
    { name: 'Key / fob inventory log', desc: 'Record of who holds keys, fobs, and access cards to common areas.' },
    { name: 'Move-in / move-out policy', desc: 'Rules and fees for residents moving in or out — scheduling, deposits, elevator use.' },
    { name: 'Welcome packet', desc: 'The intro materials given to new owners and residents.' },
  ] },
]

// Condos (FL Ch. 718) need a few documents HOAs (Ch. 720) don't, and call the
// primary governing doc a "Declaration of Condominium" rather than CC&Rs. Build
// the section list for the chosen property type from the HOA base above.
export function docSectionsFor(type: PropertyType | null): DocSection[] {
  if (type !== 'condo') return DOC_SECTIONS
  return DOC_SECTIONS.map((sec) => {
    if (sec.label === 'Governing documents') {
      const items = sec.items.map((it) =>
        it.key === 'ccrs'
          ? { ...it, name: 'Declaration of Condominium', desc: 'The recorded document that creates the condominium and binds every unit owner — unit boundaries, common elements, the assessment power, and use restrictions.' }
          : it,
      )
      const at = items.findIndex((it) => it.name === 'Articles of Incorporation')
      items.splice(at >= 0 ? at + 1 : items.length, 0, {
        name: 'Q&A sheet (FS 718.504)',
        desc: 'The condo’s required frequently-asked-questions sheet, kept current for prospective buyers.',
      })
      return { ...sec, items }
    }
    if (sec.label === 'Financial records') {
      const items = [...sec.items]
      const at = items.findIndex((it) => it.name === 'Reserve fund study')
      items.splice(at >= 0 ? at + 1 : items.length, 0, {
        name: 'Structural Integrity Reserve Study (SIRS)',
        desc: 'The condo’s mandatory reserve study for structural components — roof, load-bearing walls, foundation, fireproofing, plumbing (FS 718.112).',
      })
      return { ...sec, items }
    }
    if (sec.label === 'Property & maintenance') {
      return {
        ...sec,
        items: [
          { name: 'Milestone inspection report', desc: 'Structural milestone inspection required for buildings three stories or higher (FS 553.899).' },
          ...sec.items,
        ],
      }
    }
    return sec
  })
}
