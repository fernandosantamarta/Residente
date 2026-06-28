// One-off admin utility: set a resident's login password by email.
// Run from the project root WITH your Supabase service-role key in the env:
//   PowerShell:
//     $env:SUPABASE_SERVICE_ROLE_KEY="<service_role key>"
//     node scripts/set-resident-password.mjs david.chen@example.com "David1234!"
// (Grab the key from Supabase → Project Settings → API → service_role / secret.)
import { createClient } from '@supabase/supabase-js'

const email = process.argv[2]
const password = process.argv[3]
if (!email || !password) {
  console.error('Usage: node scripts/set-resident-password.mjs <email> <password>')
  process.exit(1)
}
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://nozzfcxijdnllkiydhfi.supabase.co'
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!key) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY in the environment first.')
  process.exit(1)
}
const admin = createClient(url, key, { auth: { persistSession: false } })

let user = null
for (let page = 1; page <= 25 && !user; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
  if (error) { console.error(error.message); process.exit(1) }
  user = data.users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase())
  if (data.users.length < 200) break
}
if (!user) { console.error('No auth user found for', email); process.exit(1) }

const { error } = await admin.auth.admin.updateUserById(user.id, { password, email_confirm: true })
console.log(error ? 'Error: ' + error.message : `OK — password set for ${email}. Log in with that password.`)
