# Historical Validation and Trust Improvements: Execution Status

**Updated:** October 3, 2026
**Scope:** MLB, WNBA, NFL, College Football, and Golf. The app also supports NBA; it is outside this five-sport workstream.

## Results at a glance

The October 3 follow-up below supersedes earlier row counts and reconciliation statuses in this document.

The work is materially advanced, but it is not complete enough to claim validated scoring or winning probability.

- The linked database contains 228 saved projection packages. The historical audit joins packages to their generation run, slate lock, sport, model version, and projection timestamp. A package qualifies only when `projection_package.generatedAt < validatedSlate.contest.lockTime`.
- A new historical player-actuals table and idempotent importer are in place. The importer used SportsDataIO final MLB stats and saved slate data to import 2,433 MLB player actuals across 72 projection runs and 12 event dates.
- The importer also imported 70 WNBA player actuals across five projection runs for one event date. It matched exact normalized player/team identity and used the repository's explicit WNBA DraftKings scoring profile because SportsDataIO's box scores omit a DraftKings fantasy-points field. All 70 have a saved baseline FPPG.
- A rerun confirms MLB has 2,427 paired baseline rows (the rest lack a saved baseline), across 72 runs and 12 dates. Re-imports are idempotent.
- Five contest result rows were reviewed. Two MLB lineups had complete player actuals and were recomputed against saved roster/scoring multipliers. The computed scores differ from the recorded values, so the stored values were preserved and an audit reconciliation was attached. Three records could not be reconciled because matching player actuals were unavailable.
- All five existing contest records lack a DraftKings contest ID, field size, and payout. Cash-line metadata is also absent on three records. No historical payout or cash-line outcome is inferred.
- Win-probability output is disabled. The ownership-weighted contest simulator is diagnostic only and no longer drives lineup selection. Calibration counts distinct contests, not repeated lineups, and remains blocked until a reviewed chronological baseline holdout passes.

## Phase 1: Saved-run backfill and audit

### Implemented

- Added a `PRE_LOCK_PROJECTION_PACKAGE` audit in `GET /api/learning/calibration`. It links each projection package to its generation request and reports linked, missing-lock, missing-timestamp, and at-or-after-lock counts by sport.
- Added `floyd_dfs_historical_player_actuals` to persist per-player projection/actual pairs with model version, event date, lineup role, baseline FPPG, source, and identity-match method. Both additive migrations (`20261002010000` and `20261002020000`) are applied and recorded in the linked migration ledger.
- Added `npm run backfill:player-actuals`. It reads the archived `SLATE` stage when available, merges its provider identity crosswalk with the original DraftKings slate, rejects post-lock or undated forecasts, imports final MLB and WNBA feeds, and safely upserts on `(tenant_id, projection_run_id, player_id)`.
- The script reconciles existing result scores when every lineup player has a matched actual. It records the computed score and difference in `result_payload.reconciliation`; it never overwrites a manually recorded score. It also has exact normalized-name fallback for package-to-slate projection joins and reports players for whom no saved projection exists.

### Current evidence and limitation

The actuals backfill imported MLB and WNBA rows. MLB has 2,433 actuals, including 2,427 paired baseline observations. WNBA has 70 actuals and 70 paired baseline observations. The WNBA feed succeeded; coverage is limited to one saved event date, so it is not enough for model validation. Golf provider tournament scoring is available, but the saved Golf projection packages have empty `players` arrays, so there are no historical predictions to pair with those actuals. NFL schedule rows did not identify the exact teams in the saved archived slates, and the importer correctly refused a cross-event join. CFB final player stats are available, but the feed does not expose the two-point-conversion scoring component required by the saved DraftKings rules; these rows remain excluded. Current importer run totals: 2,503 imported player actuals; 6 Golf showdown projection runs excluded (golf feed scoring is tournament-wide, not round-specific); 11 CFB runs excluded for incomplete scoring; NFL and Golf classic have no usable saved projection-to-actual pairs. No fuzzy name match is used.

## Phase 2: Event-specific inputs

### MLB

- Verified SportsDataIO `stats/PlayerGameStatsByDate/{date}`, `stats/PlayerGameStatsBySeason/{season}/{playerId}/{count}`, and `scores/GamesByDate/{date}` access for this account. The tested date returned player actuals, and a valid player ID returned ten game logs.
- The runtime now blends season innings with the last five pre-lock verified starts when the player has a confirmed starter role and log dates precede lock.
- The game schedule forecast fields for temperature, wind speed/direction, and conditions are attached to the player context. No unvalidated numeric weather multiplier is applied. Weather is therefore visible to the evidence package but is not yet a calibrated run-environment adjustment.
- The innings blend remains a provisional 50/50 policy. Opener plans, pitch limits, bullpen availability, and recent pitches are not fully modeled.
- These event-specific paths are implemented, but their projection adjustments are not yet validated against a chronological historical holdout.

### WNBA

- Verified the final box-score route is `scores/BoxScores/{date}`. `BoxScoresByDate` and `PlayerGameStatsByDate` returned 404 for this account/route; those routes are not used.
- The runtime reads up to 28 prior calendar days of final box scores, strictly before event date, and attaches P10/P50/P90 recent minutes when it can match players. Its provider call concurrency is capped at four.
- Season minutes and recent minutes are blended provisionally. The current history does not include a reliable DidNotPlay denominator, so DNP probability and rotation uncertainty are not solved by this change.
- The minutes distribution is not yet validated against enough independent WNBA slates.

### Coverage not yet established

Exact endpoints returned successful responses during entitlement checks: NFL final player stats (`PlayerGameStatsByWeekFinal`), CFB schedule and final player stats (`GamesByDate`, `PlayerGameStatsByWeekFinal`), and Golf tournament catalog, DraftKings fantasy scores, leaderboard, and player catalog (`golf/v2`). A successful endpoint response establishes feed access, not usable historical coverage. NFL dates/team identities did not join the archived slates. CFB scoring omits two-point conversion data. Golf supports tournament-total DraftKings scoring, but the archived packages have no projection players; Golf Showdown also requires round-level scoring that this feed does not provide.

## Phase 3: Complete contest outcomes

### Implemented

- `floyd_dfs_contest_results` now has contest identity, sport/format, field size, entry fee, paid positions, external entry ID, and outcome-source columns.
- Manual History entry now requires actual points, contest ID or name, field size, entry fee, cash line, finish position, and payout (enter zero when no payout). The API validates ranges and derives finish percentile when rank and field size are present. Paid positions and external entry ID are also captured when available.
- Added `POST /api/results/import` and a History CSV upload control. Import requires `lineup_id`, `actual_dk_points`, `finish_position`, `cash_line`, `field_size`, `entry_fee`, `payout`, and either `contest_id` or `contest_name`; optional headers include `sport`, `contest_format`, `paid_positions`, `finish_percentile`, and `external_entry_id`. Rows that do not identify an entered lineup in this tenant are rejected. The CSV must include the app's lineup ID to make the association unambiguous.

### Remaining data gap

The five existing records cannot be upgraded with official rank, field size, cash line, contest identity, or payout from current stored data. Import a DraftKings standings export with lineup IDs to add those labels. DraftKings contest detail access is not assumed.

## Phase 4: Paired baseline and chronological validation

### Implemented

- Player projections now retain `baselineFppg` when the original slate includes it, and historical backfill preserves the same-slate value.
- Added a paired baseline evaluator that excludes any projection generated at or after lock, compares model and baseline errors on the same player/slate, reports MAE/RMSE/bias and P20/P50/P90 coverage by sport and sport-role, and counts unique slates separately from player rows. The Learning page surfaces the chronological holdout comparison and preregistered threshold state.
- The pre-registered holdout cutoff is **September 8, 2026**. Promotion criteria are at least 30 independent slates per sport, at least 100 player rows in the holdout, and at least 3% lower MAE than baseline. A probability release also requires separately reviewed contest outcomes and explicit approval.
- Historical evidence currently has paired observations for MLB and one WNBA event date. MLB actual dates run August 25 through September 11, 2026, so only a few event dates fall on/after the September 8 cutoff; neither sport approaches the 30 independent holdout slates required. NFL, CFB, and Golf have no usable saved forecast/actual pairs. The existing forecasts therefore cannot establish improvement.

## Phase 5: Probability release gate

- `resolveCashLineProbability` now returns `UNAVAILABLE` unless a calibration is approved. The UI no longer reads raw or old persisted probabilities as validated values.
- The calibration builder requires a contest ID and counts at most one observation per independent contest. Old rows without contest identity do not count.
- Calibration remains `PENDING_DATA` or `UNCALIBRATED`; the release gate is explicitly `DISABLED_PENDING_OUT_OF_SAMPLE_VALIDATION`.
- Unvalidated joint field simulations remain visible as diagnostics in their stored package but no longer rank or select lineups.

## Database and runbook

The additive SQL is in [`20261002010000_contest_outcome_completeness.sql`](../supabase/migrations/20261002010000_contest_outcome_completeness.sql) and [`20261002020000_allow_exact_name_only_actual_match.sql`](../supabase/migrations/20261002020000_allow_exact_name_only_actual_match.sql). Both were applied to the linked database and are recorded in its migration ledger. Earlier local/remote migration drift remains; review the migration list before any future `supabase db push` rather than applying the pending local chain blindly.

To rerun the idempotent supported-sport backfill after code and schema are deployed:

```sh
npm run backfill:player-actuals
```

The importer needs `SUPABASE_URL` (or `VITE_SUPABASE_URL`), `SUPABASE_SERVICE_ROLE_KEY`, and `SPORTS_DATA_IO_KEY` in `.env.local`. It prints counts only, not keys or player names.

## Required next steps before trusting model claims

1. Save non-empty pre-lock projection packages with verified projection-to-DraftKings player IDs for each sport. Golf historical scoring can be imported only for tournament formats compatible with tournament-total scores; Golf Showdown needs a round-specific actual feed and round-accurate event mapping.
2. Fix historical NFL event identity for archived runs before importing any player actuals. For CFB, acquire the two-point conversion component or a verified official DK score feed; do not coerce missing points or use generic non-DK FantasyPoints.
3. Add reliable WNBA DidNotPlay and role evidence, then accumulate more independent slates. The current 70 rows represent only one event date and cannot validate minutes projections.
4. Import DraftKings standings for existing results (or manually add full contest labels). The linked database still has five results, zero contest IDs, zero field sizes, zero payouts, two cash lines, and four finish positions. Investigate the two MLB score mismatches before accepting their score labels.
5. Run the paired holdout after enough independent event slates accumulate. Report MAE, bias, quantile coverage, and role errors separately by sport; hold back probabilities until acceptance criteria pass.
6. Build a validated MLB weather/run-environment model, WNBA DNP/minutes-role model, and explicit MLB opener/limit/bullpen workload scenarios before claiming those factors are quantitatively modeled.

## October 3 implementation follow-up

### Completed in code and linked database

- Added source-integrity and finality fields for historical player actuals, plus append-only actual revisions and official field-entry records. Source-stat integrity is checked before an actual can enter calibration; calibration now requires verified final/corrected actuals.
- Added sport-specific valid DK point increments (MLB/WNBA 0.25, NFL/CFB 0.1, Golf 0.5), MLB component-integrity checks, and WNBA integer-stat checks. Revision correction detection compares source score/components, so a change in validation policy does not falsely label unchanged stats as corrected.
- Reconciled all five saved contest results after the source audit. The two MLB rows are `SOURCE_INVALID`, `model_evaluation_eligible=false`; imported SportsDataIO batter/pitcher components include impossible fractional counting stats (for example fractional at-bats and strikeouts). The source feed cannot prove which recorded contest total is correct, so neither saved score was changed. The other three results are `UNAVAILABLE` because exact event-matched player actuals were not available. All five remain excluded from model evaluation.
- Latest backfill imported 2,645 matched actual rows: 94 MLB rows pass integrity checks; 2,481 MLB and all 70 WNBA rows are quarantined as `INVALID_SOURCE`. NFL, CFB, and Golf still have no usable matched player actual rows from the archived packages. The importer reports the unsupported CFB scoring and Golf format gaps instead of inventing values.
- New runs now persist a content-addressed `COMPLETE_RUN_EVIDENCE` record with lock-time classification, slate/player pool, DraftKings contest identity and rules, research, adjustments, projections, optimizer/selection results, model versions, and source timestamps. The database rejects updates/deletes to run snapshots, actual revisions, and imported field rows.
- Backfilled run evidence from retained data: 204 of 299 generation runs had a saved validated slate and received an immutable complete or explicitly partial legacy snapshot. The other 95 have no validated slate in the saved generation request, so the missing input cannot be reconstructed.
- Added WNBA recent low-minute risk as a lower-tail event in fantasy-point simulation, with sample count and retrieval time. Historical player actuals now retain box-score minutes separately from scoring components for opportunity diagnosis. The UI/run evidence warns when structured availability is missing or older than 12 hours. This is a limited-minutes risk proxy; SportsDataIO box scores do not supply a reliable DNP denominator, and WNBA lineup/rotation uncertainty must remain visible.
- Added MLB schedule probable-pitcher IDs and opener flags, per-game weather matching, recent starter/reliever innings and pitch-count summaries, recent 72-hour pitches when logs provide them, and explicit workload warnings. Team bullpen availability and manager-imposed pitch limits remain unknown unless a direct source confirms them; no guessed numerical penalty is applied.
- Added a pre-lock recheck that refreshes structured availability/news and compares MLB weather, records affected lineups, and offers a new DraftKings-backed replacement run before lock. Existing/entered lineups remain immutable.
- Added a standings CSV import for full field entries and a contest diagnostic comparing archived pre-lock ownership to actual field ownership. The simulator remains `DIAGNOSTIC_ONLY`; one contest cannot activate probability claims.
- Official DraftKings CSV results are distinguished from manual labels, but a lineup becomes eligible for model evaluation only after all player actuals pass source validation and the player-score sum matches the recorded score. Validated official results can create post-slate diagnoses for scoring integrity, playing-time deviations, late availability/role changes, weather changes, research gaps, projection misses, and ordinary variance. Learning observations are deduplicated by contest identity so multiple entries do not count as independent repeat evidence.
- Lineup decision traces now preserve source links, retrieval/publication/expiry timestamps, confidence, mapped projection effects, and unresolved stale evidence.

### Validation and live state

- `npm run check:server`, `npm run test:parity`, `npm run lint`, `npm run build`, and `git diff --check` pass. Vite prints a non-blocking warning because the workspace Node runtime is 20.13.1 and Vite recommends 20.19+; the production build still completes.
- Migration `20261003010000_actual_integrity_and_contest_field_validation.sql` was applied to the linked database and marked applied in Supabase migration history.
- The imported player actuals are not broadly trustworthy yet: most MLB rows and all WNBA rows currently fail component integrity, while archived NFL/CFB/Golf joins remain incomplete. Keep performance claims and all win probabilities disabled. Re-import or reconcile against a corrected provider source or official DraftKings scoring export before using those rows.

### Remaining external evidence dependencies

1. Resolve the two MLB recorded totals using official DraftKings standings or corrected event-matched player actuals plus the saved contest's exact scoring/roster rules. Do not mark either as matched until the source components validate and the score sum agrees.
2. Identify a reliable WNBA source that records inactive/DNP players and pregame role changes; an appearance-only box-score sample cannot estimate DNP frequency.
3. Verify MLB pitch limits and team bullpen usage from an event-specific source, then evaluate those features on a frozen holdout before allowing them to change projected innings.
4. Backfill complete outcome labels and exact player actuals for NFL/CFB/Golf, repair empty Golf projection packages, and supply round-level Golf Showdown outcomes.
5. Import multi-contest standings and evaluate field ownership/payout simulation chronologically. Until enough independent contests pass the preregistered calibration review, keep simulator metrics diagnostic and win probability unavailable.
