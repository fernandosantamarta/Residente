// English source strings — the canonical keys. Spanish (es) and Portuguese (pt)
// mirror these; any key missing there falls back to the English value here.
// Keys are namespaced by surface: nav.*, rail.*, bell.*, then per-screen.
export const en: Record<string, string> = {
  // Left rail / nav. "Easy {X}" are product feature names — kept as-is across
  // languages on purpose (brand), only the chrome around them translates.
  'nav.admin': 'Admin',

  // Left-rail footer
  'rail.signedInAs': 'Signed in as',
  'rail.signOut': 'Sign out',

  // Right rail — Up next + Your residence
  'rail.upNext': 'Up next',
  'rail.viewAll': 'View all',
  'rail.yourResidence': 'Your residence',
  'rail.unit': 'Unit',
  'rail.whatYouOwe': 'What you owe',
  'rail.due': 'Due',
  'rail.for': 'For',
  'rail.duesStatus': 'Dues status',
  'rail.makePayment': 'Make a payment',

  // Notification bell
  'bell.notifications': 'Notifications',
  'bell.loading': 'Loading…',
  'bell.caughtUp': "You're all caught up.",
  'bell.seeAll': 'See all notifications →',
}
