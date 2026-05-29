import { redirect } from 'next/navigation'

// Vendor merged into the Easy Track hub. Keep this route as a redirect so
// existing links and bookmarks land on the Vendor section of /app/track.
export default function VendorRedirect() {
  redirect('/app/track#vendor')
}
