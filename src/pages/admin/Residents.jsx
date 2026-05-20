// Admin → Residents. v1 scaffold: roster + add-single + bulk CSV invite.
// The roster query and edits run on the anon client under RLS (board can
// read/write community profiles). Creating auth users + sending magic links
// needs the service role, so the bulk-invite calls a Supabase edge function.
export default function Residents() {
  return (
    <div className="admin-page">
      <div className="admin-kicker">Residents</div>
      <h1 className="admin-h1">Manage residents</h1>
      <p className="admin-dek">
        Add residents one at a time, or import a whole roster by CSV — each gets a
        magic-link invite to their unit. No passwords for residents to remember.
      </p>
      <div className="admin-soon">
        <div className="admin-soon-label">Coming next</div>
        <ul className="admin-soon-list">
          <li>Resident roster — name, unit, role, status</li>
          <li>Add a single resident</li>
          <li>Bulk CSV import &rarr; magic-link invite blast</li>
          <li>Edit unit, promote to board, or deactivate</li>
        </ul>
      </div>
    </div>
  )
}
