# Floyd DFS

DraftKings-only DFS lineup decision engine.

The architecture and engineering requirements are documented in [`docs/draftkings-sports-agent-engineering-architecture.md`](docs/draftkings-sports-agent-engineering-architecture.md).

## Workspace layout

- `apps/web` — Next.js / React product UI
- `packages/contracts` — shared stage contracts
- `packages/orchestrator` — workflow state, stage routing, validation, and lineage
- `packages/draftkings` — DraftKings provider boundary
- `packages/research` — research planning and normalization boundary
- `packages/sport-adjustment` — sport specialist boundaries
- `packages/projection` — quantitative projection boundaries
- `packages/optimizer` — deterministic optimization boundaries
- `packages/selection` — selection boundary
- `packages/learning` — monitoring, measurement, and diagnosis boundaries
- `packages/database` — database client/types boundary; database setup is intentionally not included yet

This scaffold contains no database migrations, credentials, provider integrations, or lineup-generation logic.

## Initial implementation scope

- Sports: NBA, WNBA, NFL, MLB, and GOLF
- Contest styles: Showdown and Classic
- DraftKings ingestion: API/RSS boundary only
- Screenshot ingestion: deferred
- Missing contest size or maximum-entry metadata: `WARNING`, not `BLOCKED`

Environment templates are in `.env.example` and `.env.local`. Integration-specific variables remain unset until the provider and database decisions are approved.
