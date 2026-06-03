// Tiny client-side CSV export — no dependencies. Build the string in memory
// and trigger a Blob download. Used by the admin Reports workspace to export
// payments, expenses, and the roster (plus QuickBooks-friendly variants).
//
// Kept deliberately small: a column spec (label + how to read each cell),
// RFC-4180 escaping, and a download helper that prepends a UTF-8 BOM so Excel
// reads accents (José, peña, ñ) correctly.

export type CsvColumn<T> = {
  label: string
  // How to read this cell from a row. Return anything; it's stringified.
  value: (row: T) => string | number | null | undefined
}

function escapeCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  // Quote when the value contains a comma, quote, or newline; double the quotes.
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map(c => escapeCell(c.label)).join(',')
  const lines = rows.map(row => columns.map(c => escapeCell(c.value(row))).join(','))
  return [header, ...lines].join('\r\n')
}

// Build the CSV and hand the browser a download. No-op during SSR.
export function downloadCsv<T>(filename: string, rows: T[], columns: CsvColumn<T>[]): void {
  if (typeof window === 'undefined') return
  const csv = toCsv(rows, columns)
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// Stamp a filename with an ISO date so repeated exports don't collide:
//   exportFilename('residente-payments') -> 'residente-payments-2026-06-03.csv'
export function exportFilename(base: string, isoDate: string): string {
  return `${base}-${isoDate}.csv`
}
