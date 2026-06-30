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

// Major FL cities → their county, so a board that enters a CITY (e.g.
// "Tallahassee") still resolves to the right Clerk of the Circuit Court (the
// recorder is always county-level — Tallahassee records in Leon County).
const CITY_TO_COUNTY: Record<string, string> = {
  'miami': 'miami-dade', 'miami beach': 'miami-dade', 'hialeah': 'miami-dade', 'doral': 'miami-dade',
  'fort lauderdale': 'broward', 'hollywood': 'broward', 'pembroke pines': 'broward', 'coral springs': 'broward',
  'west palm beach': 'palm beach', 'boca raton': 'palm beach', 'palm beach gardens': 'palm beach', 'delray beach': 'palm beach',
  'tampa': 'hillsborough', 'brandon': 'hillsborough',
  'orlando': 'orange', 'winter park': 'orange',
  'st. petersburg': 'pinellas', 'st petersburg': 'pinellas', 'clearwater': 'pinellas',
  'jacksonville': 'duval',
  'fort myers': 'lee', 'cape coral': 'lee',
  'tallahassee': 'leon',
  'naples': 'collier',
  'sarasota': 'sarasota',
  'bradenton': 'manatee',
  'gainesville': 'alachua',
  'pensacola': 'escambia',
  'lakeland': 'polk',
  'kissimmee': 'osceola',
  'port st. lucie': 'st. lucie', 'port st lucie': 'st. lucie',
  'melbourne': 'brevard', 'palm bay': 'brevard',
  'daytona beach': 'volusia',
  'ocala': 'marion',
}

const norm = (county?: string | null): string =>
  String(county ?? '').toLowerCase().replace(/\s+county$/, '').replace(/\s+/g, ' ').trim()

// Resolve an entered location (a county OR a major city) to its county key.
const resolveCounty = (input?: string | null): string => {
  const n = norm(input)
  return CITY_TO_COUNTY[n] || n
}

/** Display-friendly county name for the resolved location (title-cased,
 *  hyphen-aware so "miami-dade" → "Miami-Dade"). Empty when nothing on file. */
export function recorderCountyLabel(input?: string | null): string {
  const key = resolveCounty(input)
  if (!key) return ''
  return key.split(' ').map(w => w.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('-')).join(' ')
}

/** A county-scoped search that reliably surfaces the right clerk's recording
 *  portal as the top result — used when we have no verified direct link. */
function searchUrl(county?: string | null): string {
  const c = String(county ?? '').trim()
  const q = c
    ? `${c} County Florida Clerk of Court official records recording`
    : 'Florida Clerk of Court official records recording by county'
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`
}

/** Best link for recording a lien in the given location (county OR major city):
 *  a verified direct portal when we have one, otherwise a county-scoped search.
 *  Never returns empty. */
export function countyRecorderUrl(input?: string | null): string {
  return DIRECT[resolveCounty(input)] || searchUrl(recorderCountyLabel(input) || input)
}

/** True when we have a verified direct portal (vs. the search fallback). */
export function hasDirectRecorder(input?: string | null): boolean {
  return !!DIRECT[resolveCounty(input)]
}
