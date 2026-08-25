# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Fantasy AI is a DraftKings-only DFS (daily fantasy sports) lineup engine: a mobile-first Vite/React client backed by Vercel serverless handlers under `api/`, with Supabase (Postgres) as the persistence layer. Browser clients call same-origin `/api/*` routes in production — there is no separate backend deployment.

The backend engine was previously a separate `floyd-dfs` project and is being migrated into this repo while preserving its Supabase schema and contracts — see `MIGRATION.md`. `docs/draftkings-sports-agent-engineering-architecture.md` is a large aspirational design spec (Next.js, Edge Functions, full multi-tenant RLS schema, 7-stage engine with a dedicated Learning Loop module). **Treat it as a design reference, not a description of current code** — see "Design doc vs. reality" below before relying on anything in it.

## Commands

```bash
npm install
npm run dev          # Vite only, http://127.0.0.1:5177 — /api calls will 404/fail without dev:full
npm run dev:full      # vercel dev — runs Vite + local API handlers together (use this for full-stack work)
npm run build         # tsc -b && vite build
npm run check:server   # type-checks api/, server/, and src/lib/engine together (tsconfig.server.json)
npm run lint          # oxlint
npm run test:parity    # runs tests/engine-parity.test.ts (see Testing below)
npm run preview
```

There's no dev server auto-start needed for API work in isolation: `npm run dev:full` starts both.

## Architecture

### Three-part TypeScript surface

- `src/` — the React/Vite frontend (`tsconfig.app.json`), routed with `react-router-dom` v7. Pages: `ScanPage` (`/`), `HistoryPage`, `RunPage`, `ResearchPage`, `LearningPage`, plus an admin route.
- `api/` — Vercel serverless route handlers (thin; most are single-expression bodies). They import shared logic from `server/runtime.ts`.
- `server/` — shared backend logic used only by `api/` handlers: Supabase client/tenant context, CORS/method guards, `createRun`/`saveStage`/`recordEvent`, provider wiring, and `processRun()` — the actual pipeline orchestrator.

`api`, `server`, and `src/lib/engine` are type-checked together as one logical backend unit via `tsconfig.server.json` / `npm run check:server`, even though `src/lib/engine` also ships in the frontend bundle (it's imported directly by some handlers and by the client for shared contracts/scoring logic).

There are no path aliases configured anywhere — all imports are relative, and server-side TS files use `.js` extensions on imports (NodeNext-style resolution) even though the source files are `.ts`.

### The engine (`src/lib/engine/`)

This is where the real 6-stage pipeline lives. `server/runtime.ts`'s `processRun()` executes stages in order, persisting each stage's output to Supabase (`floyd_dfs_*` tables) before moving to the next:

1. **Slate** — `draftKings.ts`, `draftKingsSlate.ts`. Normalizes/validates the DraftKings contest (contest rules, roster/scoring rules, player pool). No player analysis.
2. **Research** — `researchAgent.ts`, `researchPlan.ts`, `researchEvidence.ts`, plus provider files (`rssProvider.ts`, `sportsDataIoProvider.ts`, `espnProjectionProvider.ts`, `oddsProvider.ts`, `structuredSportsProvider.ts`, `webResearchProvider.ts`, `configuredResearchProvider.ts`, `openAiSynthesizer.ts`). Gathers evidence; does not project or rank.
3. **Sport Adjustment** — `adjustment.ts`, `openAiAdjustment.ts`. Translates research evidence into opportunity deltas per sport.
4. **Projection** — `projection.ts`. Converts adjusted opportunity into floor/median/ceiling fantasy point ranges under the slate's actual DK scoring rules.
5. **Optimize** — `optimizer.ts`. Deterministic lineup generation/ranking against salary cap, roster, and contest-objective constraints.
6. **Selection** — `selection.ts`, `openAiSelection.ts`. Picks and explains the final lineup(s) from the optimizer's candidates.

Shared: `contracts.ts` (largest file — the TS types for every stage's input/output package), `validation.ts` (contract assertions), `availability.ts` (player availability reconciliation), `cashLineCalibration.ts` (cash-line probability modeling, the most complete Learning Loop piece).

The **Learning Loop** (stage 7 in the design doc) is not inside `src/lib/engine/` — it's implemented directly as standalone endpoints in `api/learning/*` (`measure.ts`, `diagnose.ts`, `calibration.ts`, `pre-lock.ts`, `weekly-report.ts`).

Boundary rule carried through every stage (see the design doc if you need the full rationale): each stage only does its own job — Research doesn't project, Projection doesn't build lineups, Optimize doesn't choose the final entry, Selection doesn't invent new lineups. When touching one stage, don't leak responsibilities into it from an adjacent one.

### `api/` handler map

Most handlers are thin wrappers around `server/runtime.ts` functions or `src/lib/engine` calls:

- `generation-runs.ts` (+ `generate.ts` alias) — POST: builds a `ValidatedSlate`, creates a `generation_runs` row and a queued `engine_jobs` row.
- `runs/[runId]/process.ts` — POST: claims an `engine_jobs` row and calls `processRun()`. **This is where the pipeline actually executes.**
- `generation-runs/[runId].ts` (+ `runs/[runId].ts` alias) — GET run + stage runs + latest lineups.
- `lineups.ts` / `history.ts` — GET all lineups for tenant (currently duplicate queries).
- `lineups/[lineupId]/entered.ts` — POST: marks a lineup `ENTERED`, snapshots stage outputs into an immutable `floyd_dfs_lock_snapshots` row. Entered lineups must never be silently mutated.
- `lineups/[lineupId]/result.ts` — POST: records actual outcome, computes cash-line probability.
- `slates.ts` / `slates/screenshot.ts` — slate discovery; screenshot is the fallback ingestion path (OpenAI Responses API with a strict JSON schema) when structured DK data isn't available.
- `learning/*` — the Learning Loop endpoints described above.
- `research/[runId].ts`, `results/[lineupId].ts`, `contests/[contestId].ts`, `sports.ts`, `settings.ts`, `news.ts` — read/lookup endpoints.

### Design doc vs. reality

`docs/draftkings-sports-agent-engineering-architecture.md` describes a system well beyond current code. Before citing it as ground truth, know what's actually built vs. aspirational:

**Real and wired end-to-end:** the 6-stage synchronous pipeline (`src/lib/engine/*` + `processRun()`), the contracts/validation layer, and the `api/learning/*` slice of the Learning Loop.

**Aspirational / not implemented:**
- All ~22 `supabase/functions/*` directories (the doc's §19 Edge Functions) exist but are **empty** — no source files.
- The DB schema described in the doc (§15–18) isn't tracked in this repo's migrations — `supabase/migrations/` has exactly one file (`20260825000000_cash_line_calibration.sql`). The bulk of the referenced tables (`generation_runs`, `floyd_dfs_research_runs`, etc.) exist in Supabase but their schema isn't version-controlled here.
- Multi-tenant RLS policies described in the doc aren't present as migrations either.
- The doc's full Testing Strategy (§34) doesn't exist — see Testing below.
- `npm run import:dk`, `import:mlb-actuals`, `import:results` reference `scripts/import-*.mjs` files that **don't exist** in `scripts/` (only `run-engine-parity.mjs` does). These npm scripts will fail if run.

If you're asked to implement something "per the design doc," confirm first whether it's meant to close one of these gaps or whether the doc section in question has already been superseded by what's in `src/lib/engine`.

## Testing

There's no test framework (no vitest/jest/mocha). `tests/engine-parity.test.ts` is a single hand-rolled script using Node's `assert/strict`, calling engine functions directly and running a sequence of `test*()` calls top-to-bottom. `npm run test:parity` runs `scripts/run-engine-parity.mjs`, which compiles that file on the fly with a raw `tsc` invocation and executes it with `node`.

There's no built-in way to run a single test case — to isolate one, comment out the other `test*()` invocations at the bottom of `tests/engine-parity.test.ts`.

## Environment variables

`.env.example` is the authoritative list (more complete than README.md's, which omits several server-only keys). Frontend (`VITE_`-prefixed) config is public; everything else is server-only and must never be exposed to the browser bundle or given the `VITE_` prefix. `VITE_FLOYD_DFS_API_URL` should stay unset in production — the app calls same-origin `/api`. `VITE_FLOYD_DFS_DEV_URL` (default `http://127.0.0.1:3000`) is what Vite's dev proxy forwards `/api/*` to locally, i.e. `vercel dev`.

## Linting

`oxlint`, not eslint — config is `.oxlintrc.json`. Enforces `react/rules-of-hooks` and warns on `react/only-export-components`.
