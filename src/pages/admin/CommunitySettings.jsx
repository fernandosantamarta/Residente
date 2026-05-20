// Admin → Community. Holds the community profile + the budget data that
// drives the Home dashboard (annual budget, category allocations, monthly
// spend). This is where "no real data" gets fixed without touching Supabase.
export default function CommunitySettings() {
  return (
    <div className="admin-page">
      <div className="admin-kicker">Community</div>
      <h1 className="admin-h1">Community settings</h1>
      <p className="admin-dek">
        Name, location, unit count, fiscal year — plus the annual budget and
        category allocations that drive the Home dashboard.
      </p>
      <div className="admin-soon">
        <div className="admin-soon-label">Coming next</div>
        <ul className="admin-soon-list">
          <li>Community profile — name, location, homes, fiscal year</li>
          <li>Annual budget + category allocations (Landscape / Security / Amenities / Reserves)</li>
          <li>Monthly spend entry — feeds the year-to-date burn chart</li>
        </ul>
      </div>
    </div>
  )
}
