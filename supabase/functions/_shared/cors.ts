// Shared CORS headers for edge functions invoked from the browser.
// stripe-webhook does not need these (Stripe calls it server-to-server).
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
