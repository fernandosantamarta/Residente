// Admin → Board. Promote/demote board members and curate the decisions feed
// that shows in the Home right rail ("This Week on the Board").
export default function Board() {
  return (
    <div className="admin-page">
      <div className="admin-kicker">Board</div>
      <h1 className="admin-h1">Board &amp; decisions</h1>
      <p className="admin-dek">
        Promote residents onto the board, and record the decisions that surface
        in the Home feed — vendor, amount, vote status.
      </p>
      <div className="admin-soon">
        <div className="admin-soon-label">Coming next</div>
        <ul className="admin-soon-list">
          <li>Promote / demote board members</li>
          <li>Board decisions feed — vendor, amount, vote status, date</li>
        </ul>
      </div>
    </div>
  )
}
