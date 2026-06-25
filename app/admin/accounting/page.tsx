import { redirect } from 'next/navigation'

// The Accounting & bank-reconciliation workspace moved into the Budget page
// (it now lives beside the expense ledger — see app/admin/budget/AccountingSection).
// This route is kept as a redirect so old links, bookmarks, and the nav-active
// match on /admin/budget keep working.
export default function AccountingMoved() {
  redirect('/admin/budget')
}
