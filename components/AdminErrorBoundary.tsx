'use client'

import { Component, ReactNode } from 'react'

// React error boundary that turns a render-time crash into a visible
// message instead of a frozen page. Scoped to the admin section so
// errors on /admin/violations or /admin/documents surface immediately
// without taking down the whole site.
//
// When a fix is shipped we can pull this back to a plain children
// pass-through; the boundary lives in this file so the change is one
// commit.
export class AdminErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    // Surface to the browser console so live debugging shows a real
    // stack trace alongside the visible card.
    // eslint-disable-next-line no-console
    console.error('[admin error boundary]', error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="admin-page" style={{ padding: 32 }}>
        <div
          style={{
            background: '#FFFFFF',
            border: '1px solid rgba(200, 46, 46, 0.45)',
            borderRadius: 18,
            padding: 24,
            color: '#0A2440',
            fontFamily: "'DM Sans', system-ui, sans-serif",
            maxWidth: 720,
          }}
        >
          <div
            style={{
              fontFamily: "'Fraunces', Georgia, serif",
              fontSize: 22,
              fontWeight: 600,
              color: '#C82E2E',
              marginBottom: 8,
            }}
          >
            Something went wrong on this page
          </div>
          <p style={{ fontSize: 13.5, lineHeight: 1.5, margin: '0 0 14px' }}>
            React caught a render error and froze rendering before the page
            could lock the UI. Send the message and stack below to support so
            we can patch it.
          </p>
          <pre
            style={{
              background: '#FBF7F1',
              border: '1px solid rgba(15, 28, 46, 0.10)',
              borderRadius: 12,
              padding: 14,
              fontSize: 12,
              lineHeight: 1.4,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              margin: 0,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}
          >
            {this.state.error.message}
            {this.state.error.stack ? '\n\n' + this.state.error.stack : ''}
          </pre>
          <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
            <button
              type="button"
              onClick={() => {
                if (typeof window !== 'undefined') window.location.reload()
              }}
              style={{
                padding: '9px 18px',
                background: '#E14909',
                color: '#FFFFFF',
                border: '1px solid #E14909',
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Reload page
            </button>
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              style={{
                padding: '9px 18px',
                background: 'transparent',
                color: '#C45F2A',
                border: '1.5px solid rgba(199, 111, 69, 0.40)',
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    )
  }
}
