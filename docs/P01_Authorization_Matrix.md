# P01 API authorization matrix

All browser API calls use a Supabase Auth session access token. `server/runtime.ts` verifies each token with Supabase Auth, derives the caller ID from the verified identity, then checks membership in the single deployment tenant configured by `FDS_TENANT_SLUG` (`floyd-dfs`). A caller-supplied `X-Tenant-ID`, when present, must equal that configured ID. No account membership in another tenant can switch this project to another tenant. Run and lineup reads/mutations additionally verify ownership through the generation run. Service-role queries retain explicit tenant filters.

| Route | Authorization mode | Scope |
| --- | --- | --- |
| `GET /api/contests/:contestId` | User bearer | Authenticated tenant member |
| `GET /api/sports` | User bearer | Authenticated tenant member |
| `GET /api/slates` | User bearer | Authenticated tenant member |
| `GET /api/news` | User bearer | Authenticated tenant member |
| `POST /api/generation-runs` (`/api/generate` alias) | User bearer | Creates run under verified user and selected tenant; bounded entry count |
| `GET /api/generation-runs/:runId` | User bearer | Run owner |
| `GET /api/generation-runs/:runId/lineups` | User bearer | Run owner |
| `GET /api/generation-runs/:runId/recheck` | User bearer | Run owner |
| `POST /api/generation-runs/:runId/refresh` | User bearer | Run owner; creates a new caller-owned run |
| `GET /api/history`, `GET /api/lineups` | User bearer | Caller-owned generation runs only |
| `GET /api/lineups/:lineupId` | User bearer | Lineup owner through selection and generation run |
| `POST /api/lineups/:lineupId/entered` | User bearer | Lineup owner |
| `POST /api/lineups/:lineupId/result` | User bearer | Lineup owner |
| `GET /api/lineups/:lineupId/status` | User bearer | Lineup owner |
| `GET /api/results/:lineupId` | User bearer | Lineup owner |
| `POST /api/results/import` | User bearer | Each target lineup must belong to caller |
| `POST /api/results/import-field` | User bearer + operator allowlist | Tenant-wide contest field import |
| `GET|POST /api/learning/calibration` | User bearer + operator allowlist | Tenant-wide learning data and calibration updates |
| `GET /api/learning/contest-field-validation` | User bearer | Selected tenant |
| `GET /api/learning/lessons` | User bearer | Selected tenant |
| `POST /api/learning/pre-lock` | User bearer | Every referenced run/lineup must belong to caller; bounded event arrays |
| `GET /api/research/:runId` | User bearer | Run owner |
| `GET /api/settings` | User bearer | Returns the caller's role without secrets |
| `POST /api/slates/screenshot` | User bearer | Upload path derives tenant and user from verified context; private-bucket migration is pending a database-owner connection |
| `POST /api/runs/:runId/process` | User bearer or worker bearer | User must own run; worker must match `FDS_TENANT_SLUG` (`floyd-dfs`); atomic job claim and processable-state check |
| `GET /api/learning/weekly-report` | Scheduler bearer | Fixed `FDS_TENANT_SLUG` (`floyd-dfs`); weekly idempotency key |

Scheduler and worker secrets are independent server-only values. Missing secrets fail closed. Operator access is granted only to user IDs listed in `FDS_OPERATOR_USER_IDS`; membership data does not currently expose a verified role column. Every code path and authenticated direct-table policy is pinned to the one configured tenant. The `floyd_dfs_historical_player_actuals` RLS exposure is closed; all FDS and engine tables now have restrictive single-tenant policies. Screenshot storage remains blocked until its private-bucket migration can run with a table-owner role. Do not configure these values with a `VITE_` prefix.

## Verification

`npm run test:auth` covers missing/wrong bearer schemes, single-tenant header match and cross-tenant header rejection, constant-time service-secret comparison, and the operator allowlist. `npm run check:server`, `npm run build`, `npm run lint`, and `git diff --check` pass locally. Live Supabase token-expiry, cross-account resource, and deployment-secret checks remain rollout verification because they require configured test accounts and deployed environment values.
