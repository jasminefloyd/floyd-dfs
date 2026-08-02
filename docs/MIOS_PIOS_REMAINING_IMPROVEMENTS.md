# MIOS / PIOS Remaining Improvements Checklist

Last reviewed: 2026-08-02

This checklist describes the remaining work required to move the platform from a functioning MIOS-to-PIOS prototype toward a dependable, evidence-driven DFS decision system.

## Completed in the current change

- [x] PIOS converts raw MIOS game logs into DraftKings fantasy points using the canonical sport-specific scoring module.
- [x] PIOS preserves last-3, last-5, recency-weighted form, trend, sample size, and synthetic-data status.
- [x] Actual-result ingestion calls the PIOS relationship evaluation RPC after player results are stored.
- [x] Relationship evaluation uses paired historical actuals and requires at least 20 paired observations before treating a relationship as validated.
- [x] Relationship strength and scenario confidence are included before lineup ranking, not only after ranking.
- [x] Relationship and scenario contributions are included in the lineup-intelligence score.
- [x] ScanPage preserves scenario, relationship, evidence, home/away, and news-evidence fields for display.

## Activation and verification requirements

These items are code-complete or migration-complete locally but cannot be considered active until verified in the target environment.

- [ ] Apply `20260802130000_pios_intelligence_contract.sql` to the Supabase database.
- [ ] Confirm the `tenant_fantasy_ai` schema contains the PIOS relationship, news-evidence, and evaluation tables.
- [ ] Confirm the following RPCs exist and are executable by `service_role`:
  - [ ] `fantasy_ai_get_pios_relationships`
  - [ ] `fantasy_ai_upsert_pios_relationships`
  - [ ] `fantasy_ai_insert_pios_news_evidence`
  - [ ] `fantasy_ai_evaluate_pios_relationships_for_date`
- [ ] Run Deno tests for the Supabase functions.
- [ ] Run one live scan manually after migration and function deployment.
- [ ] Confirm a completed-result ingestion reports `pios_relationships_evaluated`.
- [ ] Confirm the database contains at least 20 paired observations for a relationship before it is marked validated.
- [ ] Confirm a lineup response visibly includes scenario and relationship evidence.

## P0: Data correctness and identity

- [ ] Add a canonical player identity table shared by DraftKings, ESPN, SportsDataIO, Rotowire, and any odds provider.
- [ ] Store provider-specific IDs and aliases for every player instead of relying on name/team matching.
- [ ] Add canonical team and game IDs to every historical game log.
- [ ] Add contest/slate/game identity to every raw actual-result record.
- [ ] Validate that MLB pitcher and hitter identities cannot collide with the same display name.
- [ ] Add explicit timezone-normalized event timestamps.
- [ ] Add data-quality tests for duplicate players, duplicate contests, missing player IDs, and stale game logs.
- [ ] Prevent a provider fallback from silently replacing a verified provider record without provenance.

## P0: Historical-form pipeline

- [ ] Store the full raw game log and the calculated DraftKings fantasy score for each game.
- [ ] Store the scoring version used for each historical fantasy score.
- [ ] Add last-3, last-5, last-10, season-to-date, and role-filtered averages.
- [ ] Add recency decay based on actual game dates rather than array order alone.
- [ ] Add minutes, snap share, route participation, usage, plate appearances, and opportunity trends where supported.
- [ ] Separate performance trend from opportunity trend.
- [ ] Add minimum-sample handling for players with fewer than three games.
- [ ] Add explicit “not enough data” states instead of labeling fallback aggregates as recent form.
- [ ] Backfill historical game logs and compare PIOS-calculated scores against stored provider fantasy scores.

## P0: Outcome feedback loop

- [ ] Make the actual-results job record player-level PIOS inputs and outputs for every generated lineup.
- [ ] Evaluate player MAE, mean error, rank correlation, and calibration by sport.
- [ ] Evaluate lineup MAE, ROI, hit rate, duplication rate, and top-1% rate by contest type.
- [ ] Evaluate each scenario type separately.
- [ ] Evaluate each relationship type separately.
- [ ] Evaluate confidence buckets to determine whether high-confidence output is actually more accurate.
- [ ] Add walk-forward evaluation so future actuals never influence historical projections.
- [ ] Add a minimum sample threshold before changing production weights.
- [ ] Version every calibration update and retain the prior version for rollback.

## P1: Relationship intelligence

- [ ] Replace purely derived relationships with empirical relationship estimates when sufficient data exists.
- [ ] Track positive, negative, and neutral relationships separately.
- [ ] Add shrinkage toward zero based on sample size and source quality.
- [ ] Add sport-specific relationship definitions:
  - [ ] NFL quarterback-to-pass-catcher target/TD relationships.
  - [ ] NFL quarterback-to-opposing-defense negative relationships.
  - [ ] NBA/WNBA usage cannibalization and shared-pace relationships.
  - [ ] MLB batter sequencing and same-team run-production relationships.
  - [ ] MLB pitcher-versus-opposing-hitter relationships.
- [ ] Add relationship stability across seasons and roster changes.
- [ ] Expire or reduce relationships after trades, depth-chart changes, coaching changes, or major role changes.
- [ ] Add confidence intervals around pair correlations.
- [ ] Do not expose a relationship as “validated” until its sample threshold is met.

## P1: Game and environment modeling

- [ ] Populate venue, rest days, travel distance, time-zone change, altitude, and back-to-back status.
- [ ] Add game-level environment records rather than repeating the same spread/total on every player.
- [ ] Store opening, current, and closing betting lines.
- [ ] Track line movement and timestamp each observation.
- [ ] Add MLB park factor, weather, wind, roof status, umpire, and handedness.
- [ ] Add NFL weather, offensive-line availability, coverage matchup, pressure rate, and red-zone usage.
- [ ] Add NBA/WNBA pace, rotation, minutes restrictions, foul risk, and confirmed starting status.
- [ ] Convert game environment inputs into explicit scenario probabilities rather than only scenario labels.

## P1: News and availability evidence

- [ ] Maintain a source reliability table by provider and report type.
- [ ] Deduplicate articles across providers.
- [ ] Store publication time, event time, source, author/provider, affected entities, and expiration time.
- [ ] Separate official announcements, beat-reporter reports, aggregated reports, rumors, and sentiment.
- [ ] Detect conflicting reports and show the conflict to the user.
- [ ] Add an explicit confirmation hierarchy for starting lineups, injuries, and role changes.
- [ ] Add stale-news expiration rules by sport and report type.
- [ ] Prevent sentiment-only signals from materially changing projections without corroborating evidence.
- [ ] Evaluate news precision, recall, false positives, and projection impact after results settle.

## P1: Ranking and portfolio construction

- [ ] Calibrate the relationship, scenario, form, and evidence weights by sport and contest mode.
- [ ] Separate cash-game ranking from tournament ranking using calibrated objective functions.
- [ ] Add scenario probabilities to expected-value calculations.
- [ ] Optimize portfolios against correlated outcomes rather than only penalizing lineup overlap.
- [ ] Add portfolio-level exposure limits by player, team, game, scenario, and relationship cluster.
- [ ] Add explicit negative-correlation constraints for incompatible constructions.
- [ ] Add late-swap re-optimization using confirmed lineups and live status changes.
- [ ] Track why a lineup was rejected, not just why it was selected.
- [ ] Add deterministic seeds for reproducible simulation and debugging.

## P1: Probability calibration and trust

- [ ] Produce calibrated exceedance probabilities for value, ceiling, top-decile, and top-1% outcomes.
- [ ] Measure Brier score, log loss, reliability curves, and expected calibration error.
- [ ] Display projection reliability separately from win probability.
- [ ] Show whether each signal is verified, modeled, stale, fallback, or speculative.
- [ ] Block tournament recommendations when critical data is stale or missing.
- [ ] Add clear “no edge detected” output when the model cannot support a meaningful recommendation.
- [ ] Record model version, data snapshot, scoring version, and relationship version with every lineup.

## P2: Backtesting and research tooling

- [ ] Build a replay command that runs historical slates through the exact production pipeline.
- [ ] Support pre-lock, post-lineup-confirmation, and late-swap replay states.
- [ ] Compare MIOS-only, PIOS-with-derived-relationships, and PIOS-with-validated-relationships.
- [ ] Produce sport-by-sport and contest-mode scorecards.
- [ ] Add regression tests for known slate edge cases.
- [ ] Add leakage checks for timestamps, closing lines, confirmed lineups, and actual results.
- [ ] Add a model-change approval record before changing weights in production.

## P2: User-facing product improvements

- [ ] Add a “Why this player?” explanation with evidence and confidence.
- [ ] Add a “What would change this lineup?” panel.
- [ ] Show scenario assumptions and the opposing scenario that would hurt the lineup.
- [ ] Show missing-data warnings beside affected players, not only at the top of the scan.
- [ ] Add comparison mode for two lineups.
- [ ] Add a player-pair and stack explorer.
- [ ] Add late-swap alerts for lineup changes, injury news, and odds movement.
- [ ] Add exportable evidence and model-version details for auditability.

## P2: Operations and reliability

- [ ] Add monitoring for provider failures, stale data, function duration, and persistence failures.
- [ ] Alert when the actual-results cron fails or produces unusually low coverage.
- [ ] Alert when relationship evaluation sample sizes stop growing.
- [ ] Add dead-letter storage for unmatched player and team records.
- [ ] Add retry policies with provider-specific rate limits.
- [ ] Verify the Supabase service-role environment is available to every persistence function.
- [ ] Confirm Vercel cron schedules match contest settlement timing for all supported sports.
- [ ] Add deployment smoke checks for function routes and RPC availability.

## Definition of “trusted production system”

The system should not be considered fully trusted until all of the following are true:

- [ ] Historical game logs calculate correctly against canonical DraftKings scoring.
- [ ] Every player, team, game, contest, and provider record has a stable identity.
- [ ] Actual results automatically evaluate both MIOS and PIOS.
- [ ] Relationship and scenario accuracy is measured with sufficient samples.
- [ ] Confidence is calibrated and demonstrably predictive of reliability.
- [ ] Critical lineup/news data is fresh and provenance is visible.
- [ ] Backtests show improvement against the previous production version without data leakage.
- [ ] Live scans, persistence, cron ingestion, and migration state have been verified in production.
