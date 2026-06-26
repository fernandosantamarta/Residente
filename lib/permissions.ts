// Permission taxonomy for community custom roles. Mirrors supabase/custom-roles.sql.
// The app gates UI on these keys; RLS enforces them at the DB via has_permission().
// An admin/legacy-full user carries the wildcard '*'.

export type Permission =
  | 'community.manage'
  | 'residents.view' | 'residents.manage'
  | 'financials.view' | 'financials.manage'
  | 'payments.view' | 'payments.manage'
  | 'disbursements.initiate' | 'disbursements.approve'
  | 'documents.manage'
  | 'violations.manage'
  | 'compliance.manage'
  | 'voice.manage'
  | 'schedule.manage'
  | 'roles.manage'

// Grouped for the role-builder UI checkboxes. Ordered most-options-first so the
// checkbox columns fill evenly (the densest group anchors the first column).
export const PERMISSION_GROUPS: { label: string; perms: { key: Permission; label: string }[] }[] = [
  { label: 'Operations', perms: [
    { key: 'documents.manage', label: 'Documents & rules' },
    { key: 'violations.manage', label: 'Violations' },
    { key: 'compliance.manage', label: 'Compliance: estoppel, governance, elections, enforcement, collections' },
    { key: 'voice.manage', label: 'Meetings & voting' },
    { key: 'schedule.manage', label: 'Calendar & amenities' },
  ] },
  { label: 'Money', perms: [
    { key: 'financials.view', label: 'View budgets & financials' },
    { key: 'financials.manage', label: 'Edit budgets & expenses' },
    { key: 'payments.view', label: 'View dues & collections' },
    { key: 'payments.manage', label: 'Manage dues & collections' },
    { key: 'disbursements.initiate', label: 'Initiate vendor payments' },
    { key: 'disbursements.approve', label: 'Approve vendor payments (2nd signature)' },
  ] },
  { label: 'Roster', perms: [
    { key: 'residents.view', label: 'View residents' },
    { key: 'residents.manage', label: 'Add & edit residents' },
  ] },
  { label: 'Community', perms: [
    { key: 'community.manage', label: 'Manage community settings' },
  ] },
  { label: 'Administration', perms: [
    { key: 'roles.manage', label: 'Manage roles & permissions' },
  ] },
]

export const ALL_PERMISSIONS: Permission[] = PERMISSION_GROUPS.flatMap(g => g.perms.map(p => p.key))

export const PERMISSION_LABEL: Record<string, string> =
  Object.fromEntries(PERMISSION_GROUPS.flatMap(g => g.perms).map(p => [p.key, p.label]))

// True when a permission set grants `perm` ('*' = full access).
export function canDo(perms: string[] | null | undefined, perm: Permission): boolean {
  if (!perms) return false
  return perms.includes('*') || perms.includes(perm)
}

// True if the set grants ANY of the given permissions (used to show hub nav items).
export function canDoAny(perms: string[] | null | undefined, wanted: Permission[]): boolean {
  if (!perms) return false
  if (perms.includes('*')) return true
  return wanted.some(p => perms.includes(p))
}
