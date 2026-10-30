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

Initial result before the provider-tier attestation was added: 3 eligible projection runs, 3 blocked, 0 source requests, 0 prepared actual rows, and 0 database writes.

After the user confirmed NBA production access and storage rights, an NBA-only dry-run used the verified tier marker and read the SportsDataIO feeds. It found 3 eligible runs, 312 provider rows, 94 matched projected players, and 94 prepared rows. Of those, 21 passed structural source validation and 73 were quarantined: 63 fantasy totals were not on the saved scoring rules' 0.25-point increment, 6 rows had fractional points, and 4 rows had fractional rebounds. Ten slate players had no matching projection. The run made no database writes and skipped reconciliation. **No rows were imported.**

This result does not establish why the 73 rows failed validation or prove that the 21 structurally valid rows match official outcomes. Those actuals remain unimported pending investigation and contest-result reconciliation. The NBA data dictionary marks several game-stat fields as trial-scrambled; that is relevant context, but is not proof that this production response was scrambled. See the [SportsDataIO NBA data dictionary](https://sportsdata.io/developers/data-dictionary/nba).

## Production deployment verification

The fail-closed Street Team gate and NBA backfill safeguards were deployed to Vercel Production on 2026-10-30 at 05:10 UTC. The production alias `floyd-dfs.vercel.app` points to READY deployment `dpl_5PzHija77mubYM3d2uM7yNj6MhQK`; Vercel inspection confirmed `api/street-team/collect` is included. At that time, the production environment-name listing showed `SPORTS_DATA_IO_KEY` but no `SPORTS_DATA_IO_DATA_TIER`; secret values were not accessed. After the user confirmed NBA access and storage rights, `SPORTS_DATA_IO_DATA_TIER=PRODUCTION_VERIFIED` was added as a non-sensitive Vercel Production variable. Vercel environment changes apply to new deployments; the production alias still needs a new deployment to receive this variable. A successful daily collection has not yet been observed.

## Remaining acceptance evidence

1. Redeploy Vercel Production after adding the data-tier marker, then verify the production alias and first daily Street Team run.
2. Investigate the 73 structurally quarantined actuals and validate the 21 passing rows against official outcomes. The dry-run alone is not sufficient evidence to import.
3. Obtain official DraftKings contest outcome/field data; it is not currently available for the three archived projection runs.
4. Import only verified final actuals, reconcile player and full-field DraftKings results, and retain corrected revisions.
5. Accumulate enough chronological NBA slates for the predeclared projection, interval coverage, simulation, field-calibration, and paired-portfolio gates.

Until those conditions pass, quantitative P4 validation, P6 model evaluation, and P7 rollout gates remain incomplete. `PORTFOLIO_EV_V1` and `LEARNING_V2` remain disabled, and NBA House remains report-only/shadow-only.

## Local validation

Validated on 2026-10-30 with Node 20.20.2:

- `npm run build` — passed (Vite reports the existing main bundle exceeds 500 kB).
- `npm run check:server` — passed.
- `npm run lint` — passed.
- `npm run test:parity`, `npm run test:fixtures`, `npm run test:contracts`, `npm run test:auth`, `npm run test:actual-sources`, `npm run test:p1-contracts`, and `npm run test:p2-street-team` — passed.
- `node --check scripts/backfill-player-actuals.mjs` and `git diff --check` — passed.

The NBA source checks also reject a provider-ID match when the archived team differs, reject slates with a missing game start, and preserve a date-only event date without shifting it across the Eastern-time boundary. The Street Team service test verifies that an unverified data tier records a failed run and makes zero provider requests.
