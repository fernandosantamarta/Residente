// Shared slug used by admin search (to build `route#slug` hrefs) and by
// SectionScroll (to match a section heading's rendered text to the URL hash).
// Both sides MUST use this exact function so the authored hash and the runtime
// heading match. Operates on decoded text, e.g. "Billing & compliance" and
// "Who’s behind on payments" → "billing-compliance" / "who-s-behind-on-payments".
export const sectionSlug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
