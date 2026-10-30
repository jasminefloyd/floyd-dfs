# Phase 0 — Baseline and Regression

**Status:** Complete as a baseline capture. Known test failures and data-coverage limits are recorded below; this does not certify model quality or NBA readiness.

## Frozen source baseline

- Commit: `0a6d80f7ca44a554b0cdaff738608470792b29ce` (`chore: capture refactoring baseline`)
- Local tag: `p00-baseline-2026-10-29`
- Branch: `codex/fantasy-ai-p00-baseline`
- The existing `v0-baseline` tag was left unchanged; it points to an earlier commit.

The source tree was clean before Phase 0. No application behavior or source code was changed during the checks below. This report and the catalog snapshot are the only new project artifacts from Phase 0; dependency installation populated the ignored `node_modules/` directory.

## Environment

- Node.js `v20.20.2` and npm `10.8.2` were used for the authoritative run. This satisfies the package's declared Node engine range.
- `npm ci` completed successfully under this environment (698 packages installed). npm reported deprecation notices for `stream-to-promise` and `tar`.
- An initial `npm ci` also ran under Node.js `v20.13.1`, which is below the declared engine range and emitted `EBADENGINE` warnings. It was repeated under the supported version before the final lint run.

## Baseline checks

| Check | Result | Verified output |
|---|---|---|
| `npm run build` | FAIL | TypeScript errors in `MIOS_FantasyScanner.tsx` (`simulationMode` contract mismatch) and `gameSimulation.ts` (missing `average`, inferred literal type mismatch). |
| `npm run check:server` | FAIL | Four TypeScript errors in `gameSimulation.ts`: two unresolved `average` references and two `1` versus `0` type mismatches. |
| `npm run lint` | PASS | Passed after a clean `npm ci` under Node.js `v20.20.2`. |
| `npm run test:parity` | FAIL | `testMlbUnconfirmedStarterExclusion` expected `COMPLETE`, received `BLOCKED`. |
| `npm run test:fixtures` | PASS | Sanitized replay fixture checks passed for 8 fixtures. |
| `npm run test:contracts` | PASS | Contract fixture preserved versions, string IDs, null, zero, and omission. |
| `npm run test:auth` | PASS | Request authorization policy checks passed. |
| `npm run test:actual-sources` | PASS | Official actual source scoring tests passed. |

The build, server typecheck, lint, and parity checks were run again with Node.js `v20.20.2`; the results above are from that supported runtime. The first lint attempt under Node.js `v20.13.1` could not load the platform binding; it passed following the supported-version reinstall.

## Fixtures and command inventory

The passing replay check exercised 8 sanitized fixtures. The repository also contains DraftKings provider fixtures and a versioned FDS transport contract fixture under `tests/fixtures/`.

Package scripts refer to these absent files, as checked against the repository file list:

- `scripts/import-draftkings-slate.mjs` (`import:dk`)
- `scripts/import-mlb-actual-results.mjs` (`import:mlb-actuals`)
- `scripts/import-projection-results.mjs` (`import:results`)

These import commands were not run; they are not part of the baseline validation commands and their referenced files are absent.

## Database snapshot

A read-only query against the linked Supabase database succeeded. The local expected project reference, linked project reference, and configured project URL matched. Docker Desktop is required by the CLI's `pg_dump`-based `supabase db dump` command, but not by `supabase db query --linked`.

The catalog snapshot is in [P00_Schema_Snapshot.json](P00_Schema_Snapshot.json). It records the capture time and server version, public tables/views, columns and defaults, constraints, indexes, RLS flags and policies, view definitions, non-internal triggers, and public enum values. It contains schema metadata only; no application table rows were queried. The snapshot covers 251 public relations and one public enum type on PostgreSQL 17.6.

This is a catalog metadata snapshot rather than a complete SQL/DDL dump. A complete `pg_dump` artifact remains unavailable until a supported `pg_dump` execution path is provided. No database writes were made.

## Model and optimizer metrics

Read-only aggregate queries established a historical evaluation path in the database. The model metrics below join by tenant, projection run, and player ID, and include only records marked `VERIFIED`, `FINAL`, sourced from `OFFICIAL_LEAGUE_STATS`, carrying a scoring-rules fingerprint, with the saved projection time before lock. Metrics are descriptive retrospective measurements, not a chronological holdout or promotion evaluation. Bias is **prediction minus actual**; positive values indicate overprediction.

### Player projection baseline

The model column uses the saved p50 projection. The simple comparison baseline uses the same record's `baseline_fppg` (the backfill code sets this from the saved baseline FPPG or provider FPPG). Comparisons use exactly the rows where both values are present.

| Sport / model version | Rows | Slates | Model MAE | Model RMSE | Model bias | Provider FPPG MAE | Provider FPPG RMSE | Provider FPPG bias | P20 / P50 / P90 coverage |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| MLB `projection.deterministic.v1` | 976 | 2 | 2.681 | 4.810 | -0.375 | 2.681 | 4.810 | -0.375 | 73.36% / 74.69% / 75.72% |
| MLB `projection.deterministic.v2` | 2,593 | 29 | 5.488 | 7.761 | 0.712 | 5.658 | 7.672 | 1.970 | 63.25% / 64.44% / 66.18% |
| MLB `projection.deterministic.v3` | 863 | 12 | 5.848 | 7.743 | 2.848 | 6.326 | 8.117 | 3.758 | 64.77% / 76.48% / 92.47% |
| WNBA `projection.deterministic.v2` | 95 | 3 | 5.589 | 8.068 | 2.651 | 6.169 | 9.581 | 3.005 | 38.95% / 46.32% / 56.84% |

Across versions, this is 4,440 matched MLB player outcomes from 43 slates and 95 WNBA outcomes from 3 slates. MLB events span 2026-08-25 through 2026-10-05; WNBA events span 2026-08-26 through 2026-08-28. The v1 results equal the FPPG baseline on the two slates in that sample. Version rows cover different slates and are not a controlled version-to-version comparison. The WNBA sample is small. The database contains no matching NBA historical actuals, so NBA projection accuracy is not measurable from the current records.

### Optimizer candidate replay

Official actuals and scoring fingerprints can fully score 15,846 saved MLB lineup candidates across 43 optimizer runs. On this complete-candidate subset, saved lineup median versus realized score has MAE **27.511**, RMSE **35.403**, and mean bias **-13.938**. These candidates are highly overlapping, so 15,846 is not an independent sample count.

As a candidate-pool diagnostic, selecting the highest saved median among the fully scoreable candidates in each run averaged **17.260 points** below the best realized candidate in that same observed subset (relative difference **23.47%**) across 43 runs. This is not the recorded selected lineup's regret, is limited to fully scoreable candidates rather than the entire search pool, and does not establish that the optimizer's objective is defective or effective.

The database has 27 lineups marked entered, but none can be fully scored by joining verified actuals to that lineup's generation run. The 5 contest-result records are `MISMATCH` or `UNAVAILABLE`, none is official and evaluation-eligible, and there are no imported field-entry rows. Therefore cash rate, payout, ROI, and actual portfolio-selection quality cannot be established from current contest outcomes. These are recorded as unavailable, not zero.

## Reusable-code inventory

The companion engineering specification contains the repository-wide static file audit and identifies the existing projection, adjustment, simulation, optimizer, contest-simulation, evidence, resolution, authentication, and learning modules to retain or adapt. Its stated evidence boundary is a static audit, not an executed integration audit. The baseline checks above confirm the listed files are exercised only to the extent shown in their check results; they do not validate live provider behavior or production database state.

## Phase 0 outcome and limits

Phase 0 deliverables are captured: source commit/tag, public-schema catalog snapshot, test and fixture results, code inventory reference, and available historical model/optimizer candidate metrics. Existing typecheck and parity failures remain recorded baseline failures; resolving them is outside Phase 0 and requires a separately scoped change.

The data does not support NBA model validation or financial/field-based optimizer metrics yet. This is a documented coverage limit, not a passing result. Revisit those metrics when verified NBA player outcomes and evaluation-eligible contest/field results are available.
