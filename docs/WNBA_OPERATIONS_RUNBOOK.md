# WNBA Operations Runbook

## Monitor

Invoke `wnba-operations-monitor` before lock, after material availability news, and after settlement. It records stale snapshot, missing ownership, and unsettled-lineup signals in `wnba_operational_events`. A critical signal blocks tournament-quality decision making until the affected source is refreshed.

## Late swap

1. Import only timestamped, authorized live state through `import-wnba-live-slate-state`. Accepted source tiers are `official_team`, `official_league`, `draftkings`, `confirmed_lineup_provider`, and `reputable_news`; a request cannot elevate a source above its assigned reliability.
2. Call `optimize-wnba-late-swap` with the original portfolio and current state.
3. Do not act on a `blocked` or `no_action` response. A `recommended` response preserves locked player slots and exceeds the simulation-noise threshold.
4. The original portfolio, state, decision reasons, and expected effect are retained in `wnba_late_swap_decisions`.

## Candidate promotion and rollback

1. Run `run-wnba-shadow-evaluation` against immutable settled snapshots for baseline and candidate versions.
2. Run `record-wnba-model-promotion`; it records `pending_evidence` unless the database scorecard has at least 20 settled paired slates, no rank-correlation deterioration, and top-20 rate or ROI improvement.
3. Before any approved release, record the prior active code/model value as `rollbackVersion`.
4. To roll back, restore the recorded baseline deployment/configuration, create a `rolled_back` promotion row, and retain the triggering operational event and forensic report. Do not delete evidence.

## Incident response

For stale or missing data, block tournament generation, refresh the authoritative source, rescan, and document resolution in the operational event. For invalid output or a performance regression, revert to the recorded rollback version, run a frozen-snapshot replay, and keep the candidate in shadow until the promotion gate passes again.
