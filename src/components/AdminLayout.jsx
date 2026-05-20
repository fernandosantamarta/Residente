import { NavLink, Outlet, Link } from 'react-router-dom'

// Board-only admin section. Gated in App.jsx — only role board_member/admin
// (or local dev without Supabase) reaches here. Lean by design: 3 pages in v1.
const ADMIN_NAV = [
  { to: '/admin/residents', label: 'Residents' },
  { to: '/admin/community', label: 'Community' },
  { to: '/admin/board',     label: 'Board' },
]

export default function AdminLayout() {
  return (
    <div className="admin">
      <header className="admin-top">
        <div className="admin-brand">
          <span className="brand-dot" />
          <span className="admin-brand-word">Residente</span>
          <span className="admin-tag">Admin</span>
        </div>
        <Link to="/" className="admin-back">&larr; Back to app</Link>
      </header>

      <nav className="admin-nav">
        {ADMIN_NAV.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `admin-nav-item${isActive ? ' active' : ''}`}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  )
}
