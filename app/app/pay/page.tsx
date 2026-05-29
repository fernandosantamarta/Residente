import { redirect } from 'next/navigation'

// Pay merged into the Easy Track hub. Keep this route as a redirect so
// existing links and bookmarks — including the Stripe checkout return URL —
// land on the Pay section of /app/track.
export default function PayRedirect() {
  redirect('/app/track#pay')
}
