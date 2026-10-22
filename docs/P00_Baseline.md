# P00 baseline record

Recorded October 21, 2026 for the Fantasy AI engineering checklist. This file separates workspace evidence from items that require historical contest inputs or a staging database.

## Source and workspace provenance

- Baseline commit: `0dc9e525a5f1c953557316975e63294376677146` (`Improve lineup evidence and outcome validation`, October 3, 2026).
- Implementation branch: `codex/fantasy-ai-p00-baseline`, created from that commit.
- Dependency lock: `package-lock.json` (lockfile v3). `package.json` already had user changes before this P00 work; this work adds the supported Node engine and test commands.
- The pre-existing working-tree changes were preserved. They include API result/entry routes, `server/runtime.ts`, actuals backfill, several UI/client files, and a new checklist, official actual-source code/tests, and migration.
- Per user direction, the referenced archives are out of scope and should not be retained. No `fds.zip` or `server.zip` was found under the Vibes workspace, so there was nothing to delete. Provenance is recorded from the checked-out commit instead.

## Runtime and reproducible checks

The shell's default Node is `20.13.1` and npm `10.5.2`, below the installed Vite/Rolldown/Oxlint minimum. This verification selected installed Node `22.22.2`; `.nvmrc`, `package.json`, and `.github/workflows/ci.yml` set Node `22.12.0` as the project CI baseline.

Project configuration is stored in environment files. The Vercel Preview file points to a Supabase project distinct from Production. The local `.env.local` service-role key points to the Production project and was not used for staging inspection. The Preview environment has browser-side Supabase configuration but no database password or server service-role key. A read-only Supabase project-metadata request using the configured access token could not connect from this restricted environment; no secret values were printed or used in a database query.

On the original host, `npm ci` completed with engine warnings but did not leave the platform-specific native bindings for Oxlint/Rolldown available. Consequently the first lint and build attempts failed at native-module loading. After installing the matching optional bindings locally, the recorded baseline was:

| Command | Result | Notes |
|---|---|---|
| `npm ci` | Passed with warnings | Host Node 20.13.1 is unsupported by several locked packages; native optional bindings were missing after install. |
| `npm run build` | Passed after optional bindings were available | Vite warned that local Node 20.13.1 is below its supported minimum. |
| `npm run check:server` | Passed | Type-checks API, server, and engine source. |
| `npm run lint` | Passed after optional bindings were available | Oxlint native binding required. |
| `npm run test:actual-sources` | Passed | Deterministic source/scoring tests. |
| `npm run test:engine` | Passed | Alias for the TypeScript-compiled engine parity suite; no network credentials required. |
| `npm run test:fixtures` | Passed | Checks committed sanitized replay fixture integrity and expected lineup legality. |

The workflow uses a supported Node release and performs a clean `npm ci` on Linux. Its first hosted run remains the confirmation that fresh CI installs the platform binding correctly. No test in the deterministic workflow is intended to call a live provider or require paid credentials.

### P00–P02 local verification update (October 22, 2026)

After the implementation work, a clean `npm ci` completed under installed Node `22.22.2`, which satisfies the declared Node engine range. The following commands passed on that clean install: `npm run build`, `npm run check:server`, `npm run lint`, `npm run test:parity`, `npm run test:actual-sources`, `npm run test:fixtures`, `npm run test:contracts`, and `npm run test:auth`. Vite reports one existing large-chunk warning. Later P11 work performed the requested tenant-scoped production actual backfill; see `docs/P11_Historical_Data_Backfill_2026-10-22.md`. The hosted CI run pinned to Node `22.12.0` remains pending.

## Runtime and data-path inventory

- Browser: Vite + React under `src/`; same-origin `/api` routes in production.
- API: Vercel handlers under `api/`; development API hosting is `vercel dev` (`npm run dev:full`).
- Active orchestration: `server/runtime.ts` calls deterministic `optimizeLineups()` and `selectLineups()`. `src/lib/engine/openAiSelection.ts` exists but is not the active selector in this path.
- Provider adapters: DraftKings, ESPN, SportsDataIO, odds, RSS/web research, and configured structured sources live under `src/lib/engine/`; API handlers call server-side services.
- Jobs: `api/runs/[runId]/process.ts` processes engine runs; weekly learning report is an API handler. Vercel schedules are in `vercel.json`.
- Database/deployment: Supabase client and SQL migrations under `supabase/migrations/`; Vercel config in `vercel.json`. This repository currently has 18 incremental SQL migrations and no checked-in complete baseline schema. Production migration history also contains unrelated local/remote drift; use only reviewed targeted migration files.
- Test coverage: one large deterministic parity suite in `tests/engine-parity.test.ts`, an official-actual-source script, and P00 replay-fixture checks. API handlers are currently type-checked, not covered by a dedicated HTTP integration suite; that suite belongs with P01 authorization work.

## Fixtures and historical evidence

`tests/fixtures/replay-cases.mjs` adds synthetic, sanitized NBA multi-game Classic, NBA Showdown, WNBA, MLB, NFL, CFB, Golf Classic, and Golf Showdown cases. It includes IDs, game and lock times, salary rows, reduced test rules, projections and timestamps, availability, news observation timestamps, and an expected legal lineup. Fixtures are intentionally not authoritative DraftKings contest profiles; P03 must add verified rules fixtures before they are used as production legality evidence.

No poor-performing contest/run IDs or pre-lock snapshots were provided in the workspace. The checklist review findings therefore remain general engineering defects, not verified causes of a particular contest result. The synthetic fixtures cannot be used to claim improved historical performance.

## Staging schema status and P00 gate

The Preview project identity can be read from the environment file, but there is no database password/server credential in that Preview file and the remote metadata request could not connect. The tracked SQL files are incremental migrations, not proof of a complete clean-database schema. No staging schema query was run, and no database was modified. The P00 exit gate remains open until a read-only route from the Preview environment can retrieve the full schema (or a schema dump is provided), and the baseline schema is inventoried alongside the migrations.

The parity entry point and TypeScript test file were already present in the checked-out tree, despite the checklist describing the test file as missing. They were executed successfully; P00 made the test command discoverable as `npm run test:engine`, added the fixture command, and added deterministic CI. Dedicated API/integration tests and a review-reproduction-to-test crosswalk remain required before the corresponding checklist items can be closed.
