import { ReactNode } from 'react'
import Link from 'next/link'
import { SiteFooter } from './SiteFooter'

// Shared shell for the public legal pages (/privacy, /terms). Minimal top
// bar back to the marketing site, a readable prose column, and the real
// SiteFooter at the bottom so the legal pages match the rest of the site.
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string
  updated: string
  children: ReactNode
}) {
  return (
    <div className="legal-screen">
      <header className="legal-top">
        <Link href="/" className="legal-brand">
          <img src="/residente-logo.png" alt="" className="legal-logo" />
          <span>Residente</span>
        </Link>
        <Link href="/" className="legal-back">&larr; Back to home</Link>
      </header>

      <main className="legal-main">
        <h1 className="legal-title">{title}</h1>
        <p className="legal-updated">Last updated: {updated}</p>
        <div className="legal-prose">{children}</div>
      </main>

      <SiteFooter />
    </div>
  )
}
