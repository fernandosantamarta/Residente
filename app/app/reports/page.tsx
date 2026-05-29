import { redirect } from 'next/navigation'

// Reports merged into the Easy Track hub. Keep this route as a redirect so
// existing links and bookmarks land on the Reports section of /app/track.
export default function ReportsRedirect() {
  redirect('/app/track#reports')
}
