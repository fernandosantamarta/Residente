# ============================================================================
#  Residente — Stripe TEST -> LIVE cutover
#  RUN IN A FRESH TERMINAL (Win+R -> pwsh). NOT a terminal spawned from the
#  IDE / Claude session — those inherit a stale SUPABASE_ACCESS_TOKEN (401).
#
#  DO THIS IN THE STRIPE DASHBOARD FIRST (LIVE mode, Test-mode toggle OFF):
#    1. Developers -> API keys -> copy the LIVE secret key (sk_live_...)
#    2. Developers -> Webhooks -> Add endpoint:
#         URL:    https://nozzfcxijdnllkiydhfi.supabase.co/functions/v1/stripe-webhook
#         Events: checkout.session.completed   (match your test webhook's events)
#       -> copy the LIVE signing secret (whsec_...)
#  Then run this script and paste those two values when prompted.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location 'C:\Users\Fernando\dev\residente-cloud'
$ref = 'nozzfcxijdnllkiydhfi'

# 1) Drop the stale inherited token so the CLI uses your real login session.
Remove-Item Env:\SUPABASE_ACCESS_TOKEN -ErrorAction SilentlyContinue

# 2) Auth check. If this 401s, run `npx supabase login` (opens browser) then re-run.
Write-Host "`n--- verifying CLI auth ---" -ForegroundColor Cyan
npx supabase secrets list --project-ref $ref

# 3) Collect live values (kept only in process memory — never written to disk).
Write-Host "`n--- paste your LIVE Stripe values ---" -ForegroundColor Cyan
$sk    = Read-Host 'LIVE secret key (sk_live_...)'
$whsec = Read-Host 'LIVE webhook signing secret (whsec_...)'

if ($sk -notmatch '^sk_live_')   { throw "That is not a live secret key (expected sk_live_). Aborting — no test key in prod." }
if ($whsec -notmatch '^whsec_')  { throw "That is not a webhook signing secret (expected whsec_). Aborting." }

# 4) Flip the two secrets to live + pin redirects to prod.
Write-Host "`n--- setting live secrets ---" -ForegroundColor Cyan
npx supabase secrets set "STRIPE_SECRET_KEY=$sk"         --project-ref $ref
npx supabase secrets set "STRIPE_WEBHOOK_SECRET=$whsec"  --project-ref $ref
npx supabase secrets set "APP_URL=https://residente.io"  --project-ref $ref

# 5) Re-deploy the webhook (JWT off — Stripe calls it without a Supabase token).
Write-Host "`n--- redeploying stripe-webhook ---" -ForegroundColor Cyan
npx supabase functions deploy stripe-webhook --no-verify-jwt --project-ref $ref

# 6) Confirm (names + digests only, never values).
Write-Host "`n--- final secret list (names only) ---" -ForegroundColor Cyan
npx supabase secrets list --project-ref $ref

Write-Host "`nLIVE. Smoke test now:" -ForegroundColor Green
Write-Host "  1. On residente.io, make one small REAL dues/amenity payment."
Write-Host "  2. Confirm a new row lands in the 'payments' table (Supabase Table editor)."
Write-Host "  3. Refund that charge in the Stripe dashboard."
Write-Host "`nThen delete this script: Remove-Item .\stripe-go-live.ps1"
