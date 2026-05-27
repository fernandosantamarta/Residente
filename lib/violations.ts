// Shared violations log. Mirrors lib/rules.ts and lib/schedule.ts so the
// resident /app/rules Violations & Enforcement strip and the board
// /admin/violations page stay in sync without needing Supabase wired up.
//
// Source-of-truth model: Stripe runs the money. The board issues a
// violation (warning or fine); if it's a fine, an invoice is created
// on Stripe and the webhook closes the violation as `stripe-paid`
// once the resident pays. The board never marks a fine "paid" by
// hand on the happy path. Manual override exists for cash / check /
// waive, but it is intentionally not the primary action.
//
// When Supabase + Stripe are actually wired:
//   - addStoredViolation → POST /api/violations (creates row + Stripe invoice)
//   - markStripePaid     → Stripe webhook handler
//   - markManualPaid / waive / dismiss / appeal / reopen → /api/violations/:id/...
//   - useViolationsData  → React Query against /api/violations
// Consumers don't change.

import { useEffect, useState } from 'react'

export type ViolationKind = 'warning' | 'fine'

// What's happening with the violation right now.
//   open      — issued, not yet closed. Fines = awaiting Stripe payment.
//   appealed  — board reviewing; Stripe collection paused.
//   closed    — done. See `resolution` for how.
export type ViolationStatus = 'open' | 'appealed' | 'closed'

// How a violation was closed. Set only when status === 'closed'.
//   stripe-paid  — webhook fired, money in (the default path for fines)
//   manual-paid  — board recorded payment outside Stripe (cash, check)
//   waived       — board decided not to collect (good will, hardship)
//   dismissed    — warning closed without action (verbal correction worked)
export type ViolationResolution = 'stripe-paid' | 'manual-paid' | 'waived' | 'dismissed'

export type Violation = {
  id: string
  kind: ViolationKind
  rule_id: string | null      // FK into lib/rules — null = general / no specific rule
  rule_title: string | null   // denormalized title at time of issuance
  resident: string            // free-text name for the demo path; resident_id later
  amount: number | null       // dollars, only meaningful for kind=fine
  status: ViolationStatus
  resolution: ViolationResolution | null
  stripe_invoice_id: string | null
  notes: string | null
  opened_at: string           // ISO date when the violation was logged
  closed_at: string | null    // ISO date when status moved to closed
}

// Seeded demo violations — covers the 4-stat headline so the strip
// reads as lived-in immediately. Mix of warnings, fines paid via Stripe,
// one paid manually, one waived, one open invoice, one under appeal.
export const DEMO_VIOLATIONS: Violation[] = [
  { id: 'v-1',  kind: 'warning', rule_id: 'r-n1',  rule_title: 'Quiet hours: 10 PM to 7 AM',         resident: 'Unit 14B', amount: null, status: 'closed',   resolution: 'dismissed',   stripe_invoice_id: null,           notes: 'Quieted down within an hour, no follow-up needed.',                                        opened_at: '2026-04-08', closed_at: '2026-04-09' },
  { id: 'v-2',  kind: 'warning', rule_id: 'r-p2',  rule_title: 'Clean up after your pet',            resident: 'Unit 22A', amount: null, status: 'closed',   resolution: 'dismissed',   stripe_invoice_id: null,           notes: 'First touch — owner apologized and cleaned the spot.',                                     opened_at: '2026-04-12', closed_at: '2026-04-12' },
  { id: 'v-3',  kind: 'fine',    rule_id: 'r-pk2', rule_title: 'Guest parking max 72 hours',         resident: 'Unit 07C', amount: 75,   status: 'closed',   resolution: 'stripe-paid', stripe_invoice_id: 'in_demo_07c',  notes: 'Guest vehicle tagged on day 4 — invoice paid via Stripe.',                                 opened_at: '2026-04-15', closed_at: '2026-04-22' },
  { id: 'v-4',  kind: 'fine',    rule_id: 'r-n1',  rule_title: 'Quiet hours: 10 PM to 7 AM',         resident: 'Unit 03E', amount: 50,   status: 'closed',   resolution: 'stripe-paid', stripe_invoice_id: 'in_demo_03e',  notes: 'Second offense within 60 days — escalated to fine. Auto-collected.',                       opened_at: '2026-04-18', closed_at: '2026-04-25' },
  { id: 'v-5',  kind: 'fine',    rule_id: 'r-a1',  rule_title: 'Exterior paint approval required',   resident: 'Unit 11A', amount: 250,  status: 'appealed', resolution: null,          stripe_invoice_id: 'in_demo_11a',  notes: 'Owner painted shutters without submitting color samples. Appealing at next meeting.',      opened_at: '2026-04-22', closed_at: null },
  { id: 'v-6',  kind: 'warning', rule_id: 'r-t1',  rule_title: 'Bins stored out of street view',     resident: 'Unit 19D', amount: null, status: 'open',     resolution: null,          stripe_invoice_id: null,           notes: null,                                                                                       opened_at: '2026-05-02', closed_at: null },
  { id: 'v-7',  kind: 'fine',    rule_id: 'r-pk3', rule_title: 'No commercial vehicles overnight',   resident: 'Unit 05B', amount: 100,  status: 'open',     resolution: null,          stripe_invoice_id: 'in_demo_05b',  notes: 'Work van parked overnight 3 nights running. Stripe invoice sent 2026-05-04.',              opened_at: '2026-05-04', closed_at: null },
  { id: 'v-8',  kind: 'warning', rule_id: 'r-po2', rule_title: 'No glass on the pool deck',          resident: 'Unit 16C', amount: null, status: 'closed',   resolution: 'dismissed',   stripe_invoice_id: null,           notes: 'Glass swept up — verbal reminder accepted.',                                               opened_at: '2026-05-06', closed_at: '2026-05-06' },
  { id: 'v-9',  kind: 'fine',    rule_id: 'r-s1',  rule_title: 'Share gate codes with guests only',  resident: 'Unit 21A', amount: 200,  status: 'appealed', resolution: null,          stripe_invoice_id: 'in_demo_21a',  notes: 'Owner says delivery driver shared the code, not them.',                                    opened_at: '2026-05-10', closed_at: null },
  { id: 'v-10', kind: 'fine',    rule_id: 'r-p1',  rule_title: 'Leashes required outside the unit',  resident: 'Unit 09B', amount: 50,   status: 'closed',   resolution: 'manual-paid', stripe_invoice_id: null,           notes: 'Resident paid by check at the office; logged manually.',                                   opened_at: '2026-05-12', closed_at: '2026-05-18' },
  { id: 'v-11', kind: 'warning', rule_id: 'r-g1',  rule_title: 'Be a good neighbor',                 resident: 'Unit 13E', amount: null, status: 'open',     resolution: null,          stripe_invoice_id: null,           notes: 'Loud confrontation in lobby — board to follow up.',                                        opened_at: '2026-05-20', closed_at: null },
  { id: 'v-12', kind: 'fine',    rule_id: 'r-po1', rule_title: 'Pool hours: 6 AM to 10 PM',          resident: 'Unit 18A', amount: 50,   status: 'closed',   resolution: 'waived',      stripe_invoice_id: 'in_demo_18a',  notes: 'First offense, board waived after the resident apologized in writing.',                    opened_at: '2026-05-23', closed_at: '2026-05-24' },
]

const STORAGE_KEY = 'residente-violations'
const HIDE_DEMO_KEY = 'residente-violations-hide-demo'

export function getHideDemo(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(HIDE_DEMO_KEY) === 'true'
}

export function setHideDemo(hidden: boolean) {
  if (typeof window === 'undefined') return
  if (hidden) window.localStorage.setItem(HIDE_DEMO_KEY, 'true')
  else window.localStorage.removeItem(HIDE_DEMO_KEY)
  emit()
}

export function deleteAllViolations() {
  setStoredViolations([])
  setHideDemo(true)
}

export function restoreDemoViolations() {
  setHideDemo(false)
}

export function getStoredViolations(): Violation[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function setStoredViolations(list: Violation[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  emit()
}

function emit() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('residente-violations-change'))
}

// Issue a new violation. For kind=fine, a stripe_invoice_id is
// auto-populated in the demo path to simulate "Stripe invoice
// created on issuance" — the real code path will POST to Stripe.
export function addStoredViolation(
  v: Omit<Violation, 'id' | 'opened_at' | 'status' | 'resolution' | 'closed_at' | 'stripe_invoice_id'>
    & { id?: string; opened_at?: string; stripe_invoice_id?: string | null }
) {
  const id = v.id || `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  const opened_at = v.opened_at || new Date().toISOString().slice(0, 10)
  // Fines auto-create a Stripe invoice on issuance. The demo uses a
  // fake invoice id; production swaps in the real Stripe API call.
  const stripe_invoice_id =
    v.stripe_invoice_id !== undefined
      ? v.stripe_invoice_id
      : v.kind === 'fine'
        ? `in_demo_${id.slice(-6)}`
        : null
  const row: Violation = {
    id,
    kind: v.kind,
    rule_id: v.rule_id,
    rule_title: v.rule_title,
    resident: v.resident,
    amount: v.amount,
    notes: v.notes,
    status: 'open',
    resolution: null,
    stripe_invoice_id,
    opened_at,
    closed_at: null,
  }
  setStoredViolations([...getStoredViolations(), row])
  return id
}

export function removeStoredViolation(id: string) {
  setStoredViolations(getStoredViolations().filter(v => v.id !== id))
  // Also drop any override for this row so a re-seed reads clean.
  const overrides = getOverrides()
  if (overrides[id]) {
    delete overrides[id]
    setOverrides(overrides)
  }
}

// Status / resolution workflow. Seeded rows (v-*) live in code, so
// status changes go through an override map; board-added rows (u-*)
// mutate their own record directly. Either way the hook recomputes
// on the change event.
const OVERRIDE_KEY = 'residente-violations-overrides'

type Override = {
  status: ViolationStatus
  resolution: ViolationResolution | null
  closed_at: string | null
}

function getOverrides(): Record<string, Override> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(OVERRIDE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function setOverrides(map: Record<string, Override>) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(OVERRIDE_KEY, JSON.stringify(map))
  emit()
}

function applyChange(id: string, patch: Override) {
  if (id.startsWith('u-')) {
    const list = getStoredViolations()
    const next = list.map(v => (v.id === id ? { ...v, ...patch } : v))
    setStoredViolations(next)
    return
  }
  const map = getOverrides()
  map[id] = patch
  setOverrides(map)
}

const today = () => new Date().toISOString().slice(0, 10)

// --- Action helpers — one per real-world action. Read like the UI. ---

// Webhook handler. In the demo this is also reachable from a manual
// "Simulate Stripe payment" link so we can demonstrate the happy path.
export function markStripePaid(id: string) {
  applyChange(id, { status: 'closed', resolution: 'stripe-paid', closed_at: today() })
}

// Manual override — board recorded a payment outside Stripe (cash,
// check). Use sparingly; Stripe is the default path.
export function markManualPaid(id: string) {
  applyChange(id, { status: 'closed', resolution: 'manual-paid', closed_at: today() })
}

// Board decided not to collect. Stripe invoice is voided server-side
// in production; demo just flips the resolution.
export function waive(id: string) {
  applyChange(id, { status: 'closed', resolution: 'waived', closed_at: today() })
}

// Warning closed without action.
export function dismiss(id: string) {
  applyChange(id, { status: 'closed', resolution: 'dismissed', closed_at: today() })
}

// Pause Stripe collection while the board reviews the appeal.
export function appeal(id: string) {
  applyChange(id, { status: 'appealed', resolution: null, closed_at: null })
}

// Resume collection / un-close.
export function reopen(id: string) {
  applyChange(id, { status: 'open', resolution: null, closed_at: null })
}

// Derived headline stats for the resident /app/rules strip.
//   warnings:        count where kind=warning
//   fines_collected: $ actually collected (stripe-paid + manual-paid),
//                    waived fines DO NOT count
//   resolved:        count where status=closed (any resolution)
//   appeals:         count where status=appealed
export function computeStats(list: Violation[]) {
  let warnings = 0
  let fines_collected = 0
  let resolved = 0
  let appeals = 0
  for (const v of list) {
    if (v.kind === 'warning') warnings++
    if (v.kind === 'fine'
        && (v.resolution === 'stripe-paid' || v.resolution === 'manual-paid')) {
      fines_collected += Number(v.amount) || 0
    }
    if (v.status === 'closed') resolved++
    if (v.status === 'appealed') appeals++
  }
  // Keep the legacy `fines` field name for the resident page so we don't
  // have to touch its JSX. It represents collected dollars now.
  return { warnings, fines: fines_collected, resolved, appeals }
}

// React hook — combines DEMO_VIOLATIONS + anything in localStorage,
// applies any board status overrides on top of the demo set. SSR
// returns the demo set (with no overrides); client merges on mount
// and listens for sibling tab + sibling component changes.
export function useViolationsData(): Violation[] {
  const [stored, setStored] = useState<Violation[]>([])
  const [overrides, setOverridesState] = useState<Record<string, Override>>({})
  const [hideDemo, setHideDemoState] = useState(false)

  useEffect(() => {
    const refresh = () => {
      setStored(getStoredViolations())
      setOverridesState(getOverrides())
      setHideDemoState(getHideDemo())
    }
    refresh()
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === OVERRIDE_KEY || e.key === HIDE_DEMO_KEY) refresh()
    }
    const onLocal = () => refresh()
    window.addEventListener('storage', onStorage)
    window.addEventListener('residente-violations-change', onLocal)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('residente-violations-change', onLocal)
    }
  }, [])

  const demo = hideDemo
    ? []
    : DEMO_VIOLATIONS.map(v => {
        const o = overrides[v.id]
        return o
          ? { ...v, status: o.status, resolution: o.resolution, closed_at: o.closed_at }
          : v
      })
  return [...demo, ...stored]
}
