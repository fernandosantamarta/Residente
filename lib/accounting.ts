// Accounting add-on feature flag. Mirrors `stripeEnabled` in lib/supabase.ts.
//
// The dedicated /admin/accounting workspace (general ledger, bank reconciliation,
// bank-verified statements, CPA handoff) is the paid "Accounting integrations"
// add-on ($49/mo — see ADDONS in supabase/functions/manage-subscription). This
// flag is the ROLLOUT switch: when off, the workspace renders an upsell + a demo
// preview rather than going dark, and the free Phase-1 statements on
// /admin/financials are unaffected.
//
// NOTE: per-community entitlement enforcement (only communities that actually buy
// the add-on get the live workspace) is a follow-up. The add-on lives as a Stripe
// subscription item (metadata.addon='accounting'), read via manage-subscription —
// there is no cached column to gate on cheaply at page load yet. For now this
// global flag gates rollout; layer the per-community check on top when monetizing.
export const accountingEnabled: boolean =
  (process.env.NEXT_PUBLIC_ACCOUNTING_ENABLED || process.env.REACT_APP_ACCOUNTING_ENABLED) === 'true'
