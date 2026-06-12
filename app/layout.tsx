import type { Metadata, Viewport } from 'next'
import { AuthProvider } from './providers'
import './globals.css'
import './landing.css'
import './admin.css'
import './contact.css'

export const metadata: Metadata = {
  title: 'Residente',
  description: 'The HOA cockpit your community has been quietly hoping for.',
  // Wires the existing brand mark as the favicon so browsers stop
  // 404'ing for /favicon.ico. Next emits the right <link rel="icon">
  // and apple-touch-icon tags from this block.
  // apple-touch-icon must be the dedicated OPAQUE file: iOS paints any
  // transparency black on the home screen, so the transparent logo PNG
  // turned the icon black. This one is white with the orange mark centered.
  icons: {
    icon: '/residente-logo.png',
    shortcut: '/residente-logo.png',
    apple: '/apple-touch-icon.png',
  },
}

export const viewport: Viewport = {
  themeColor: '#F4EFE8',
  width: 'device-width',
  initialScale: 1,
  // Cap the scale so iOS Safari doesn't auto-zoom into small-font inputs/selects
  // on focus (e.g. when switching tabs) and leave the page zoomed in.
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
}

// Pre-paint theme script — sets data-theme + html bg colour BEFORE React
// hydrates so users with a saved theme don't see a flash of the wrong one.
// Mirrors the inline script the CRA build had in public/index.html.
// Sketch is the only theme now. Still ship the pre-paint script so the
// cream background paints before React hydrates (no flash of white).
const PREPAINT_THEME = `
(function(){
  document.documentElement.setAttribute('data-theme', 'sketch');
  document.documentElement.style.backgroundColor = '#F4EFE8';
})();
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning is needed because the pre-paint inline script
    // mutates <html> (data-theme + inline background-color) BEFORE React
    // hydrates, so the server-rendered HTML won't match what's in the DOM
    // by the time React looks at it. The mismatch is intentional — it's
    // how we avoid a flash of the wrong theme on first paint.
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;0,9..144,900;1,9..144,400;1,9..144,500&family=Inter:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,500;0,600;0,700;0,800;0,900;1,500;1,600;1,700&family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500;1,600&display=swap" rel="stylesheet" />
        <script dangerouslySetInnerHTML={{ __html: PREPAINT_THEME }} />
      </head>
      <body style={{ margin: 0 }}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  )
}
