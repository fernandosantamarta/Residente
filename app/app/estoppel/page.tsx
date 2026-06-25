import { redirect } from 'next/navigation'

// Estoppel moved into the Easy Documents hub. Keep this route as a redirect so
// existing links and bookmarks — including any shared with a buyer or title /
// closing agent — land on the Estoppel tab of /app/documents.
export default function EstoppelRedirect() {
  redirect('/app/documents#estoppel')
}
