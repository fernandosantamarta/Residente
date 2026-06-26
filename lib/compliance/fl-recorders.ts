// Florida county recorder links. A claim of lien is recorded with the Clerk of
// the Circuit Court in the county where the property sits. We keep a small set of
// VERIFIED direct official-records / e-recording portals for the high-volume
// counties, and fall back to a county-scoped search for everything else so the
// board always lands on the right clerk without us shipping a stale deep link
// for a legal filing. Verify a county's portal before relying on it.

const DIRECT: Record<string, string> = {
  'miami-dade': 'https://onlineservices.miamidadeclerk.gov/officialrecords/StandardSearch.aspx',
  'broward': 'https://officialrecords.broward.org/AcclaimWeb/',
  'palm beach': 'https://erec.mypalmbeachclerk.com/',
  'hillsborough': 'https://pubrec.hillsclerk.com/Public-Records/Official-Records',
  'orange': 'https://or.occompt.com/recorder/eagleweb/docSearch.jsp',
  'pinellas': 'https://officialrecords.mypinellasclerk.gov/',
  'duval': 'https://or.duvalclerk.com/',
  'lee': 'https://or.leeclerk.org/',
}

const norm = (county?: string | null): string =>
  String(county ?? '').toLowerCase().replace(/\s+county$/, '').replace(/\s+/g, ' ').trim()

/** A county-scoped search that reliably surfaces the right clerk's recording
 *  portal as the top result — used when we have no verified direct link. */
function searchUrl(county?: string | null): string {
  const c = String(county ?? '').trim()
  const q = c
    ? `${c} County Florida Clerk of Court official records recording`
    : 'Florida Clerk of Court official records recording by county'
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`
}

/** Best link for recording a lien in the given county: a verified direct portal
 *  when we have one, otherwise a county-scoped search. Never returns empty. */
export function countyRecorderUrl(county?: string | null): string {
  return DIRECT[norm(county)] || searchUrl(county)
}

/** True when we have a verified direct portal (vs. the search fallback). */
export function hasDirectRecorder(county?: string | null): boolean {
  return !!DIRECT[norm(county)]
}
