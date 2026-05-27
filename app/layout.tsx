import type { Metadata, Viewport } from 'next'
import { AuthProvider } from './providers'
import './globals.css'
import './landing.css'
import './admin.css'

export const metadata: Metadata = {
  title: 'Residente',
  description: 'The HOA cockpit your community has been quietly hoping for.',
}

export const viewport: Viewport = {
  themeColor: '#F4EFE8',
  width: 'device-width',
  initialScale: 1,
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
        {/* Global SVG defs — referenced by [data-theme="sketch"] CSS via
            filter: url(#sketch-wobble) to give cards/icons a hand-drawn
            wobble. Lives at the root so every page can use it. */}
        <svg width="0" height="0" style={{ position: 'absolute', pointerEvents: 'none' }} aria-hidden="true">
          <defs>
            <filter id="sketch-wobble" x="-5%" y="-5%" width="110%" height="110%">
              <feTurbulence type="fractalNoise" baseFrequency="0.025" numOctaves={2} seed={4} result="noise" />
              <feDisplacementMap in="SourceGraphic" in2="noise" scale={2.6} xChannelSelector="R" yChannelSelector="G" />
            </filter>
            <filter id="sketch-wobble-strong" x="-5%" y="-5%" width="110%" height="110%">
              <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves={2} seed={7} result="noise" />
              <feDisplacementMap in="SourceGraphic" in2="noise" scale={3.5} xChannelSelector="R" yChannelSelector="G" />
            </filter>
          </defs>
        </svg>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  )
}
