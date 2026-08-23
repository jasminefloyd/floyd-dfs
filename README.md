# Fantasy AI

Fantasy AI builds DraftKings-focused DFS lineups from a MIOS scan manifest and a PIOS lineup generator. The supported sports are NBA, WNBA, MLB, and NFL, with both Showdown and Classic contest styles.

## Local Setup

```bash
npm install
npm run dev
```

The Vite app runs locally at the URL printed by Vite, usually `http://127.0.0.1:5173/`.

## Environment

Frontend and API clients expect:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Optional data providers:

```bash
ODDS_API_KEY=
ODDS_API_BASE_URL=
ODDS_API_MONTHLY_BUDGET=
FIRECRAWL_API_KEY=
```

## Useful Commands

```bash
npm run build
npm run lint
npm run import:dk
npm run import:results
npm run import:mlb-actuals
node scripts/sync-dk-scoring.mjs
```

Deno is required for Supabase function tests:

```bash
deno test supabase/functions
```

## Supabase Functions

Core functions:

- `fantasy-mios-scan`: collects slate data, salaries, projections, news, ownership, and context.
- `fantasy-pios-lineups`: builds and simulates lineups from a MIOS manifest.
- `scrape-ownership`: stores ownership projections.
- `scrape-confirmed-lineups`: stores confirmed or expected lineups.
- `ingest-actual-results`: ingests completed contest/player results for scorecards.

Apply migrations before using live persistence. The app uses the `tenant_fantasy_ai` schema and RLS policies in the migration files.

## Deployment

The Vercel cron in `vercel.json` calls `/api/cron/ingest-actual-results` daily at 11:00 UTC and again at 15:00 UTC for late stat/result settling.

Before deploying:

```bash
npm run build
npm run lint
```

Verify the Supabase function environment has the service-role key before enabling persistence or cron ingestion.
