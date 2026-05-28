import { redirect } from 'next/navigation'

// Board merged into the Easy Voice hub. Keep this route as a redirect so
// existing links and bookmarks land on the Board section of /app/voice.
export default function BoardRedirect() {
  redirect('/app/voice#board')
}
