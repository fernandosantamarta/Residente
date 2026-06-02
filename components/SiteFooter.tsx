import Link from 'next/link'

// Real company footer. Two flavours share one stylesheet (.site-foot* in
// globals.css):
//   <SiteFooter />     — full marketing footer (landing + auth/legal pages)
//   <SiteFooterSlim /> — one-line legal strip for inside the app + admin
// Contact is hello@residente.io (free forwarding alias on the residente.io
// Namecheap domain). Product links point at the landing anchors with a
// leading slash so they work from any page, not just the landing.

const PRODUCT = [
  { href: '/#what',      label: 'Overview' },
  { href: '/#boards',    label: 'For boards' },
  { href: '/#residents', label: 'For residents' },
]
const COMPANY = [
  { href: '/login',  label: 'Sign in' },
  { href: '/signup', label: 'Get started' },
]
const LEGAL = [
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms',   label: 'Terms' },
]
const CONTACT_EMAIL = 'hello@residente.io'

function FootCol({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div className="site-foot-col">
      <div className="site-foot-col-title">{title}</div>
      <ul className="site-foot-col-list">
        {links.map(l => (
          <li key={l.href}><Link href={l.href} className="site-foot-link">{l.label}</Link></li>
        ))}
      </ul>
    </div>
  )
}

export function SiteFooter() {
  const year = new Date().getFullYear()
  return (
    <footer className="site-foot">
      <div className="site-foot-inner">
        <div className="site-foot-brand">
          <Link href="/" className="site-foot-brand-mark">
            <img src="/residente-logo.png" alt="" className="site-foot-logo" />
            <span className="site-foot-word">Residente</span>
          </Link>
          <p className="site-foot-tagline">
            The community portal that shows where your dues go, what the board is up
            to, and how to pay — all in one place.
          </p>
        </div>

        <nav className="site-foot-cols" aria-label="Footer">
          <FootCol title="Product" links={PRODUCT} />
          <FootCol title="Company" links={COMPANY} />
          <FootCol title="Legal" links={LEGAL} />
          <div className="site-foot-col">
            <div className="site-foot-col-title">Contact</div>
            <ul className="site-foot-col-list">
              <li>
                <a href={`mailto:${CONTACT_EMAIL}`} className="site-foot-link">{CONTACT_EMAIL}</a>
              </li>
              <li><Link href="/app/contact" className="site-foot-link">Contact your board</Link></li>
            </ul>
          </div>
        </nav>
      </div>

      <div className="site-foot-bar">
        <span>© {year} Residente</span>
        <span className="site-foot-bar-note">Built for residents.</span>
      </div>
    </footer>
  )
}

// Slim one-line strip for authenticated surfaces. Inherits the page's text
// colour (muted via CSS) so it sits quietly under the resident app + admin.
export function SiteFooterSlim() {
  const year = new Date().getFullYear()
  return (
    <footer className="site-foot-slim">
      <span>© {year} Residente</span>
      <span className="site-foot-slim-sep" aria-hidden="true">·</span>
      <Link href="/privacy" className="site-foot-slim-link">Privacy</Link>
      <span className="site-foot-slim-sep" aria-hidden="true">·</span>
      <Link href="/terms" className="site-foot-slim-link">Terms</Link>
      <span className="site-foot-slim-sep" aria-hidden="true">·</span>
      <a href={`mailto:${CONTACT_EMAIL}`} className="site-foot-slim-link">Contact</a>
    </footer>
  )
}
