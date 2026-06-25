import { redirect } from 'next/navigation'

// Account standing was removed as a standalone page — an open collection case,
// the amount owed, and any payment plan already surface in Easy Track → Pay
// (PaymentPlanCard), and the "Account in collections" notice deep-links there.
// Keep this route as a redirect so old links/bookmarks land on that section.
export default function CollectionsRedirect() {
  redirect('/app/track#pay')
}
