# Residente

HOA resident cockpit. React + Supabase + Vercel.

Design: locked in `~/.gstack/projects/Fernando/designs/residente-desktop-20260424/approved.json` (round 2, 2026-04-24).

## Local dev

```bash
npm install
npm start
```

Runs at http://localhost:3000. App boots without Supabase (no auth gate) until you add env vars.

## Connect Supabase

1. Create a new Supabase project at https://app.supabase.com
2. Copy `.env.example` to `.env.local`
3. Paste your URL and anon key from Supabase dashboard → Settings → API
4. Run the migrations (see `supabase/migrations/` once you add them)
5. Restart `npm start`

## Deploy to Vercel

1. `git init && git add -A && git commit -m "initial"`
2. Create a new GitHub repo, push
3. Import to Vercel: https://vercel.com/new
4. Add env vars: `REACT_APP_SUPABASE_URL`, `REACT_APP_SUPABASE_ANON_KEY`
5. Build settings:
   - Build command: `CI=false node node_modules/react-scripts/bin/react-scripts.js build`
   - Install command: `npm install --legacy-peer-deps`
   - Output: `build`

## Routes

| Path | Page | Status |
|---|---|---|
| `/` | Home — cockpit dashboard | Designed (variant-A) |
| `/pay` | Payments | Stub |
| `/board` | Board activity | Stub |
| `/rules` | Community rules | Stub |
| `/documents` | Document library | Stub |
| `/contact` | Contact board | Stub |
| `/community` | Community editorial | Stub (port community.html next) |
