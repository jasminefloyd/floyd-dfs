# Fantasy AI client

This repository contains the Fantasy AI mobile-first DFS interface and its server runtime. The browser and server handlers use same-origin `/api` routes in production.

## Local Setup

Use Node.js `22.12.0` or a supported Node 20 release (`20.19.0` or newer). The checked-in `.nvmrc` selects `22.12.0`.

```bash
npm install
npm run dev:full
```

For the Vite client at port `5177` with the local API proxy, start both processes in separate terminals:

```bash
npm run dev
```

Keep `npm run dev:full` running as well; it serves the Vercel API handlers at `http://127.0.0.1:3000/` (the script pins this port to match the Vite proxy). Without it, browser requests to `/api/*` from Vite return `502 Bad Gateway`. The Vite app runs locally at `http://127.0.0.1:5177/`.

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

The service-role key, SportsDataIO key, and OpenAI key must be configured as Vercel server environment variables and must not use the `VITE_` prefix. `STREET_TEAM_V2` and `NBA_HOUSE_V1` are production rollout switches; `PORTFOLIO_EV_V1` and `LEARNING_V2` stay disabled until their release gates pass. NBA Street Team collection and NBA actual imports also require `SPORTS_DATA_IO_DATA_TIER=PRODUCTION_VERIFIED`; without it, collection is blocked before calling the provider.

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

`npm run backfill:player-actuals -- --sport NBA --dry-run` checks eligible archived NBA projections without writing actuals or revisions. NBA production retrieval and import remain blocked unless `SPORTS_DATA_IO_DATA_TIER=PRODUCTION_VERIFIED` is explicitly configured. A non-dry-run command writes tenant-scoped actual/revision records when production credentials are configured. Read the [P11 backfill report](docs/P11_Historical_Data_Backfill_2026-10-30.md) before importing data or using it for evaluation.

DraftKings' official lineup-upload CSV is downloaded from the authenticated site for the exact sport, contest format, and start time. Do not treat the app's local details CSV as an upload template. Official account history and contest standings are downloaded by the account owner from DraftKings and imported through the History page.

The SQL migrations in `supabase/migrations/` are incremental; the repository does not contain a complete baseline schema. As of 2026-10-30, all local migration versions matched production through `20261030060000`. Recheck `npx supabase migration list --linked` before future schema work and apply only reviewed migrations.

## Operations and release

The monthly provider audit is registered for `0 14 1 * *` UTC in Vercel Production. The Street Team collector is registered for `0 8 * * *` UTC. Independent missed-run alerting was not verified in this audit. Review the deployment and cron state before changing release gates or operating production. The engineering baseline and rollback requirements are in [the refactoring specification](docs/Fantasy_AI_Engineering_Refactoring_Specification.md).

`npm run dev:full` starts the local Vercel runtime for API handlers. Start `npm run dev` in another terminal only when you want to use the Vite development origin and its `/api` proxy.
