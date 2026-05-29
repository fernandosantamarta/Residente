'use client'

import { useEffect, useState } from 'react'

export type EasyDocsTab = 'rules' | 'documents'

const TABS: { key: EasyDocsTab; label: string; sectionId: string }[] = [
  { key: 'rules',     label: 'Rules',     sectionId: 'easydocs-rules' },
  { key: 'documents', label: 'Documents', sectionId: 'easydocs-documents' },
]

export function EasyDocsTabs() {
  const [active, setActive] = useState<EasyDocsTab>('rules')

  useEffect(() => {
    const update = () => {
      const docsEl = document.getElementById('easydocs-documents')
      if (!docsEl) return
      setActive(docsEl.getBoundingClientRect().top <= 80 ? 'documents' : 'rules')
    }
    window.addEventListener('scroll', update, { passive: true })
    update()
    return () => window.removeEventListener('scroll', update)
  }, [])

  const scrollTo = (key: EasyDocsTab, sectionId: string) => {
    setActive(key)
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="easydocs-tabs">
      {TABS.map(t => (
        <button
          key={t.key}
          type="button"
          className={`easydocs-tab${active === t.key ? ' active' : ''}`}
          onClick={() => scrollTo(t.key, t.sectionId)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
