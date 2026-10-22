# P02 — Shared contracts and schema map

Status: schema/API approved and production schema migration applied October 22, 2026. A tenant-only backup was created, migration `20261021040000` was applied to the verified linked production project, postflight passed, and only this version was recorded in remote history. No staging project is configured, and no NBA application insert, cross-tenant request, or stale-revision concurrency test was run. Database operations remain pinned to the single `floyd-dfs` tenant. No shared mutable provider metadata is introduced.

## Ownership

- `src/lib/engine/contracts.ts` owns domain types and version identifiers.
- `src/lib/engine/boundaryContracts.ts` owns untrusted JSON validation, version checks, legacy-event adaptation, and JSON serialization.
- `server/schemaManifest.ts` owns table/column/key mappings for server persistence. Service-role queries still require explicit `tenant_id` filters.
- `server/evidenceLedger.ts` owns domain-to-evidence-row mapping. Evidence stays in the existing ledger; no parallel evidence store is created.
- `supabase/migrations/20261021040000_fds_p02_contract_schema.sql` is forward-only and contains P02 schema changes. Do not edit applied migration files.

`ENGINE_CONTRACT_VERSION` is `2026-10-21.1`; transport serialization is `fds.transport.v1`. Provider identifiers are strings, including numeric-looking IDs. A canonical ID identifies an entity inside this tenant and sport scope; a provider ID is only meaningful together with provider and sport.

| Entity | Canonical identity | Provider mapping |
| --- | --- | --- |
| Tenant | `tenants.id` resolved only from configured slug `floyd-dfs` | No caller-selected tenant |
| Sport / league | Uppercase `Sport` enum; league is the sport competition namespace | Provider league name/code retained in source metadata |
| Season | Provider-defined string with sport and season type context | Preserve season IDs as strings |
| Event / game | `games[].gameId`, unique within tenant and slate | `providerIds[provider]`, all strings |
| Team | Provider-independent team code/name in `teamIds` | Source-specific team IDs remain in observations/provider payload references |
| Player | `playerId`, stable within tenant and sport | `provider + provider_player_id` in `floyd_dfs_player_provider_mappings` |
| Contest | DraftKings contest ID string scoped by tenant and provider | Draft group is a separate DraftKings string ID |
| Draft group | DraftKings draft-group ID string | Stored as a provider ID; never coerced to a number |
| Game type | `CLASSIC` or `SHOWDOWN` paired with sport | DraftKings profile/metadata version accompanies rules |
| Lineup | `lineupId` scoped by tenant | Entry association is a separate external entry ID |
| Entry | External entry ID scoped by tenant and contest | DraftKings remains the external system of record |
| Generation run | UUID plus tenant; every query also filters tenant | References `generation_runs.id` |
| Revision | Positive monotonic integer per tenant and lineup | `parent_revision` must equal the prior current revision |

## Compatibility and data semantics

Legacy `event` is adapted to a single `games[]` item at the engine boundary when `games` is absent. During this compatibility period, its `eventId` becomes the compatibility game ID and event participants become team IDs. Current DraftKings and screenshot inputs remain legacy event payloads until the provider work resolves actual per-game identities; the adapter does not claim the whole multi-game draft group is one sporting game. A player with a `gameId` must reference an item in `games[]`.

Photo URLs are nullable and may only be HTTPS. Unknown photos stay `null`; team logos are never used as a player-photo fallback. JSON transport preserves `null`, zero, and omission independently. Source observation game/unit/publication/duplicate metadata is persisted in additional nullable columns so historical rows remain readable. Resolved facts record canonical keys plus accepted/supporting/rejected evidence IDs. Existing adjustment records remain the source of numeric effects; P02 adds the operation, amount, final value, game, cap, outcome, and reason columns without duplicating the ledger.

The new mapping, game, photo, lineup revision, swap, provider health, and runtime incident tables are all tenant-owned, have tenant-scoped uniqueness, and deny direct browser access. Provider health routes must be sanitized before persistence; details must never include secrets or raw provider payloads. Incident JSON must be redacted before insert.

Lineup revisions are insert-only. A transaction advisory lock serializes a tenant/lineup pair and the trigger rejects an insert unless the submitted revision is exactly current+1 and its parent is exactly current (or null for the first revision), returning SQLSTATE `40001` for stale writers. `EXPORTED` does not imply DraftKings submission; only `USER_CONFIRMED_ENTERED` may have `submission_confirmed_at`.

## Migration and rollback

Before deployment, the seven existing sport-scoped constraints were inspected read-only and the affected tenant rows were backed up. Their names were `floyd_dfs_source_observations_sport_check`, `floyd_dfs_quantitative_adjustments_sport_check`, `floyd_dfs_player_projection_components_sport_check`, `floyd_dfs_model_evaluations_sport_check`, `floyd_dfs_sport_release_gates_sport_check`, `floyd_dfs_historical_player_actuals_sport_check`, and `floyd_dfs_player_actual_revisions_sport_check`; each previously omitted NBA. The applied migration discovers constraints by catalog definition rather than hardcoding those names, replaces only sport checks with the supported six-sport list, and did not update existing rows. It was applied alone after owner approval. Do not run `supabase db push` across the known divergent local/remote migration history.

Rollback should first stop writers using the new tables/columns, export/retain any inserted revisions and evidence, then drop only the P02-created tables, indexes, trigger/function, and added columns. Restore the prior sport checks from the captured pre-deployment definitions. Do not delete P00/P01 data or rewrite prior migration history. Dropping these columns/tables is destructive and must wait until the project owner approves rollback after a backup.

## Remaining P02 gates

- NBA application-level inserts across all seven sport-scoped tables remain for live data-path testing. Production schema postflight passed; no insert test was run.
- Application-level tenant cross-read/write denial and stale-revision concurrency checks remain for live testing. Local contract serialization fixture passes.
- Retention policy is now selected for the single Floyd DFS tenant; scheduled deletion/expiry enforcement is still an implementation gate (see below).
- Integrate the new failure categories at the engine failure sites, resolve actual DraftKings per-game IDs, and persist explanations/health reports when their consuming work packages are implemented.

## Tenant data retention decision (October 22, 2026)

**Decision:** keep tenant-owned forecasts, saved lineups/revisions, linked official actuals, and evaluation artifacts while the Floyd DFS tenant is active so the product can preserve immutable history and perform chronological evaluation. These records are private to this tenant and must never be pooled into another tenant's dataset or used to train a cross-tenant model. On explicit tenant closure/deletion, remove tenant-owned product records and let encrypted tenant-only backups expire within 30 days. A stricter applicable provider license or legal requirement overrides these defaults.

- Do not persist complete raw provider responses. Retain only normalized observations needed to explain a saved decision and the minimum source/provenance fields allowed by the source license; delete those observations with their parent forecast/tenant.
- Retain sanitized provider health and operational incident records for 90 days; never include credentials, account data, or raw provider payloads.
- Revalidate player-photo metadata at most every 7 days and evict expired or identity-mismatched cache records.
- Expire swap plans at their existing `expires_at` deadline; they are recommendations, not durable user history.
- Keep tenant backup exports access-restricted, separately scoped to Floyd DFS, and delete them no later than 30 days after tenant deletion/closure.

**Enforcement status:** this is the approved product policy, not proof of automated deletion. A follow-up migration/job must enforce operational-record expiry, photo-cache expiry, and tenant deletion/backup expiry before claiming full retention compliance. Immutable forecasts and entry history must not be purged by routine TTL cleanup while the tenant remains active. Provider-license-specific limits must be checked before enabling retention of any licensed observations.
