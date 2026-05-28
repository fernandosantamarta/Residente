import { redirect } from 'next/navigation'

// Contact merged into the Easy Voice hub. Keep this route as a redirect so
// existing links and bookmarks land on the Contact section of /app/voice.
export default function ContactRedirect() {
  redirect('/app/voice#contact')
}
