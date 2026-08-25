# Floyd DFS backend migration

## Verified current architecture

`fantasy-ai` is a Vite/React application with same-project server handlers under `api/`. Its browser clients call same-origin `/api` routes in production.

The backend implementation is in the sibling `floyd-dfs` project. It is a server-side TypeScript workspace with these verified stages:

1. `SLATE` — DraftKings contest/player discovery and availability reconciliation.
2. `RESEARCH` — RSS, SportsDataIO, and optional OpenAI synthesis.
3. `SPORT_ADJUSTMENT` — sport-specific adjustments.
4. `PROJECTION` — deterministic projection package.
5. `OPTIMIZE` — roster, salary, uniqueness, and team constraints.
6. `SELECTION` — lineup selection and rationale.

The backend persists runs, stage artifacts, research, projections, optimizer output, selections, lineups, and learning data through Supabase. The service-role key and provider credentials must remain server-side.

## Target architecture

The backend runtime is now inside the `fantasy-ai` deployment boundary while preserving the existing contracts and persisted Supabase schema. The React application calls same-project server handlers, with no external backend dependency.

Production configuration status:

- Verified in Vercel Production: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, and `SPORTS_DATA_IO_BASE_URL`.
- Still required for SportsDataIO availability refresh: `SPORTS_DATA_IO_KEY`.
- `OPENAI_MODEL` is optional and defaults to `gpt-5` in the server runtime.

The migration must preserve:

- DraftKings IDs, salaries, utility/captain salary handling, and contest metadata.
- The six-stage orchestration order and stage lineage.
- Explicit availability provenance and confirmed/unconfirmed behavior.
- Supabase run and stage persistence.
- Research blocking/partial behavior.
- Optimizer legality rules, including salary cap, roster slots, unique players, and minimum teams.
- Existing run, lineup, research, history, and learning response shapes.

## Implementation order

1. Migrate contracts and pure domain packages without provider or database access.
2. Migrate provider clients and server-only environment loading.
3. Migrate the Supabase repositories and orchestration runner.
4. Add same-project server handlers for slate discovery and generation runs.
5. Switch the React client to the same-project handlers.
6. Compare representative runs against the current backend before removing the external URL.

## Current unverified items

- The final server runtime shape for the Vite deployment has not yet been selected.
- A complete parity comparison has not yet been run.
- Provider credentials and Supabase production configuration for the new deployment have not yet been verified.
- The external backend must remain available until migration parity is demonstrated.
