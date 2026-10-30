# P11 NBA Historical Data Backfill — 2026-10-30

## Status

NBA historical evaluation is **blocked on an entitled, verified actuals source**. No NBA actuals or evaluation-eligible contest outcomes were written during this audit. NBA House remains shadow-only; model behavior and release status are unchanged.

## Verified production state

Read-only checks against the linked production database on 2026-10-30 found:

| Evidence | Count/state |
|---|---:|
| NBA projection runs | 3 |
| NBA verified player actuals | 0 |
| NBA evaluation-eligible official contest results | 0 |
| NBA model evaluations | 0 |
| NBA Street Team collection runs / snapshots | 0 / 0 |
| NBA House reports | 0 |
| NBA models in CANARY or ACTIVE | 0 |
| Local and production migrations aligned | Yes, through `20261030060000` |

The three saved NBA runs contain archived player pools and pre-lock projections. Their contest locks were October 23, October 27, and October 30 UTC. The first two are complete/partial projection runs respectively; the October 30 run is complete. Those three slates are not enough to satisfy the specification's chronological promotion and calibration gates, even after actuals are available.

## Source and identity controls

- Production has `SPORTS_DATA_IO_KEY`, but does not have `SPORTS_DATA_IO_DATA_TIER`; the local `.env.local` also has no data-tier attestation. The existing backfill therefore must not call the NBA provider or import its data.
- SportsDataIO documents the NBA `PlayerGameStatsByDateFinal/{date}` feed as subscription-required and its free trial as limited to UEFA Champions League data. The NBA data dictionary says NBA feed dates and times use US Eastern Time and documents `DraftKingsPlayerID` as the cross-reference field in player records. See [SportsDataIO NBA API documentation](https://sportsdata.io/developers/api-documentation/nba) and [NBA data dictionary](https://sportsdata.io/developers/data-dictionary/nba).
- NBA.com states that its statistics are for viewing and are not available for download for personal use. The automated backfill no longer uses the NBA Stats endpoint; see [NBA Stats FAQ](https://www.nba.com/stats/help/faq).
- The production actuals importer now requires the explicit `SPORTS_DATA_IO_DATA_TIER=PRODUCTION_VERIFIED` marker for NBA and CFB. For NBA, it derives the game date in US Eastern Time and accepts only a unique SportsDataIO `DraftKingsPlayerID` → `PlayerID` mapping with an archived-team match or a unique exact name/team match. Ambiguous and missing identities are excluded.
- NBA Street Team collection now uses the same tier gate. Without `SPORTS_DATA_IO_DATA_TIER=PRODUCTION_VERIFIED`, it records a failed collection with an explicit diagnostic and makes no provider request. The provider documentation says the API free trial only provides UEFA Champions League data, so a key alone is not evidence of NBA access.
- The importer supports `--sport NBA --dry-run`; dry-run does not write actuals, revisions, or result reconciliation. External requests use a bounded timeout and report sanitized feed failures.

## Dry-run result

Command:

```bash
npm run backfill:player-actuals -- --sport NBA --dry-run
```

Result: 3 eligible projection runs, 3 blocked by the missing provider-tier attestation, 0 source requests, 0 prepared actual rows, 0 database writes. The NBA Stats endpoint was not called. This confirms the safety gate and the existence of candidate pre-lock inputs; it does not validate projection accuracy.

## Production deployment verification

The fail-closed Street Team gate and NBA backfill safeguards were deployed to Vercel Production on 2026-10-30 at 05:10 UTC. The production alias `floyd-dfs.vercel.app` points to READY deployment `dpl_5PzHija77mubYM3d2uM7yNj6MhQK`; Vercel inspection confirmed `api/street-team/collect` is included. The production environment-name listing showed `SPORTS_DATA_IO_KEY` but no `SPORTS_DATA_IO_DATA_TIER`; secret values were not accessed. Consequently, scheduled collection is expected to record a blocked/failed run without making provider requests until the production tier marker is configured. A successful daily collection has not yet been observed.

## Remaining acceptance evidence

1. Verify that the SportsDataIO account has a production NBA stats entitlement and storage rights; then set the non-secret tier attestation in the environments where the backfill will run.
2. Re-run the NBA-only dry-run. Review its matched, unmatched, quarantined, and source diagnostics before importing.
3. Import only verified final actuals, reconcile official player and full-field DraftKings results, and retain corrected revisions.
4. Accumulate enough chronological NBA slates for the predeclared projection, interval coverage, simulation, field-calibration, and paired-portfolio gates.

Until those conditions pass, quantitative P4 validation, P6 model evaluation, and P7 rollout gates remain incomplete. `PORTFOLIO_EV_V1` and `LEARNING_V2` remain disabled, and NBA House remains report-only/shadow-only.

## Local validation

Validated on 2026-10-30 with Node 20.20.2:

- `npm run build` — passed (Vite reports the existing main bundle exceeds 500 kB).
- `npm run check:server` — passed.
- `npm run lint` — passed.
- `npm run test:parity`, `npm run test:fixtures`, `npm run test:contracts`, `npm run test:auth`, `npm run test:actual-sources`, `npm run test:p1-contracts`, and `npm run test:p2-street-team` — passed.
- `node --check scripts/backfill-player-actuals.mjs` and `git diff --check` — passed.

The NBA source checks also reject a provider-ID match when the archived team differs, reject slates with a missing game start, and preserve a date-only event date without shifting it across the Eastern-time boundary. The Street Team service test verifies that an unverified data tier records a failed run and makes zero provider requests.
