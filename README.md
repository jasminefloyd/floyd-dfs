# Fantasy AI client

This repository contains the Fantasy AI mobile-first DFS interface and its server runtime. The browser and server handlers use same-origin `/api` routes in production.

## Local Setup

Use Node.js `22.12.0` or a supported Node 20 release (`20.19.0` or newer). The checked-in `.nvmrc` selects `22.12.0`.

```bash
npm install
npm run dev
```

The Vite app runs locally at `http://127.0.0.1:5177/`.

## Environment

Frontend configuration:

```bash
VITE_FLOYD_DFS_API_URL=
VITE_FLOYD_DFS_DEV_URL=http://127.0.0.1:3000
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

`VITE_FLOYD_DFS_API_URL` should remain unset in production. The Vite `/api` proxy forwards to the local Vercel runtime during development.

Server-only production configuration:

```bash
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
SPORTS_DATA_IO_KEY=...
SPORTS_DATA_IO_BASE_URL=https://api.sportsdata.io/v3
OPENAI_API_KEY=...
OPENAI_MODEL=...
```

The service-role key, SportsDataIO key, and OpenAI key must be configured as Vercel server environment variables and must not use the `VITE_` prefix. See the [environment inventory](docs/FDS_Environment_Variables.md) for server/client boundaries and safety gates.

## Verification commands

```bash
npm run build
npm run lint
npm run check:server
npm run test:engine
npm run test:actual-sources
npm run test:fixtures
npm run test:contracts
npm run test:auth
git diff --check
```

The deterministic CI workflow runs the build, typecheck, lint, engine parity, source, replay-fixture, contract, and auth checks after `npm ci`. These are offline checks; they do not prove production account isolation, provider entitlements, UI accessibility, or live DraftKings compatibility. Synthetic replay fixture scope and limitations are documented in `tests/fixtures/README.md` and `docs/P00_Baseline.md`.

## Data and DraftKings files

`npm run backfill:player-actuals` fetches final official league statistics only for eligible saved Floyd DFS pre-lock projection runs and writes tenant-scoped actual/revision records. It is idempotent but performs production database writes when configured with production credentials. SportsDataIO-backed sports remain blocked unless a separately verified production data tier is configured. Read [the P11 backfill report](docs/P11_Historical_Data_Backfill_2026-10-22.md) before using these data for evaluation.

DraftKings' official lineup-upload CSV is downloaded from the authenticated site for the exact sport, contest format, and start time. Do not treat the app's local details CSV as an upload template. Official account history and contest standings are downloaded by the account owner from DraftKings and imported through the History page. See [DraftKings source and history limits](docs/DraftKings_Eligibility_and_History_Sources.md).

There are 18 incremental SQL migrations in `supabase/migrations/`; the repository does not contain a complete baseline schema. Production migration history has unrelated local/remote drift, so apply reviewed migration files individually and do not use a broad `supabase db push`.

## Operations and release

The monthly provider audit is registered for `0 14 1 * *` UTC in Vercel Production. Independent missed-run alerting still needs configuration; do not use `vercel crons run` as a health check because it triggers a real audit. Read [P13 acceptance/release notes](docs/P13_Acceptance_and_Release.md) before changing release gates or operating production.

Run the Vite app and local API handlers together:

```bash
npm run dev:full
```
