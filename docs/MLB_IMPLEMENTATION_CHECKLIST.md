# MLB Implementation Checklist

This checklist tracks the remaining MLB improvement work. Items are not considered complete until the implementation exists, local validation passes, and live or walk-forward results support the behavior.

## Completed foundation

- [x] Phase 0 forensic scorecard and per-contest report storage.
- [x] MLB public-data collection on large slates.
- [x] Expanded MLB enrichment coverage.
- [x] Confirmed-lineup and probable-pitcher tournament gates.
- [x] Native pitcher-versus-opposing-hitter solver exclusions.
- [x] Multi-objective MLB candidate generation.
- [x] MLB proxy player distributions.
- [x] Modeled proxy field construction for chalk, random, and leverage builds.
- [x] Required Supabase migrations applied and verified.
- [x] Current application committed and deployed to Vercel production.

## Phase 2 — Component-level hitter projections

- [ ] Add verified batter handedness and opposing-pitcher handedness inputs.
- [ ] Add season and multi-season component baselines with shrinkage.
- [ ] Add handedness-specific wOBA/xwOBA, ISO, strikeout, and walk rates.
- [ ] Add barrel, hard-hit, pull, fly-ball, and sprint-speed features.
- [ ] Add expected plate appearances by batting-order slot.
- [ ] Add pinch-hit and substitution-risk indicators.
- [ ] Convert component estimates into DraftKings fantasy-point distributions.
- [ ] Preserve source, timestamp, freshness, and fallback status for every component.
- [ ] Add unit tests for missing, partial, and conflicting component inputs.

## Phase 3 — Dedicated pitcher model

- [ ] Add confirmed start probability.
- [ ] Add pitch-count and expected-innings projections.
- [ ] Add batters-faced projection.
- [ ] Add strikeout, walk, hit, home-run, and earned-run components.
- [ ] Add win probability and relevant pitcher bonus-event probabilities.
- [ ] Add recent velocity, pitch-mix, rest, and workload-trend features.
- [ ] Add opposing-lineup handedness, strikeout, walk, and power matchup features.
- [ ] Add bullpen support and manager-hook features.
- [ ] Generate ceiling, normal, early-exit, blow-up, weather-delay, and workload-limited scenarios.
- [ ] Add pitcher-specific calibration metrics to the feedback loop.

## Phase 4 — Team run and stack modeling

- [ ] Build team run buckets: 0–2, 3–4, 5–6, 7–9, and 10+ runs.
- [ ] Model team home-run distributions.
- [ ] Model plate-appearance distributions by batting-order slot.
- [ ] Simulate correlated walks, hits, runs, and RBIs.
- [ ] Model batting-order adjacency and wraparound stacks.
- [ ] Model opposing-pitcher outcomes and bullpen transitions.
- [ ] Replace the generic MLB team pulse with event-driven team outcomes.
- [ ] Add stack-quality calibration and optimal-stack recall metrics.

## Phase 5 — MLB construction archetypes

- [ ] Generate 5–3 builds.
- [ ] Generate 5–2–1 builds.
- [ ] Generate 4–4 builds.
- [ ] Generate 4–3–1 builds.
- [ ] Generate 4–2–2 builds.
- [ ] Generate 3–3–2 builds when contest rules support them.
- [ ] Add double-ace, ace/value, and double-value pitcher archetypes.
- [ ] Add chalk-primary/contrarian-secondary and reverse constructions.
- [ ] Add low-owned full-stack and bottom-order wraparound constructions.
- [ ] Add salary-left uniqueness constructions.
- [ ] Rank candidates by median, P90, P95, P99, stack-best probability, joint-stack probability, leverage, and duplication-adjusted payout.
- [ ] Record the exact construction archetype and rejection reason for every candidate.

## Phase 6 — Native solver constraints

- [ ] Require confirmed pitchers during candidate construction.
- [ ] Require confirmed hitters and batting slots for tournament candidates.
- [ ] Enforce primary and secondary stack shapes directly in the solver.
- [ ] Enforce archetype-specific batting-order constraints.
- [ ] Enforce max hitters per team during construction.
- [ ] Support explicitly modeled exceptions for large-field strategies.
- [ ] Persist candidate rejection diagnostics by constraint type.

## Phase 7 — Modeled contest field

- [ ] Define proxy ownership by player, team stack, pitcher pair, and construction archetype.
- [ ] Model single-entry, three-max, twenty-max, and 150-max behavior.
- [ ] Model small-field and large-field behavior separately.
- [ ] Model flat, top-heavy, double-up, and winner-take-all payout shapes.
- [ ] Model salary-left and roster-construction distributions.
- [ ] Model whole-lineup duplication rather than multiplying marginal ownership values.
- [ ] Add an ingestion path for authorized DraftKings contest CSVs when available.
- [ ] Compare proxy-field outputs against observed contest CSVs when available.

## Phase 8 — Tail-aware simulation

- [ ] Add deterministic random seeds.
- [ ] Add common random numbers for candidate comparison.
- [ ] Increase simulation resolution for offline evaluation.
- [ ] Add importance sampling for high-run and high-strikeout tails.
- [ ] Add conditional team-explosion scenarios.
- [ ] Add analytical or extreme-value tail estimates.
- [ ] Calculate top-20 probability.
- [ ] Calculate top-1% probability.
- [ ] Calculate first-place probability.
- [ ] Calculate cash probability.
- [ ] Calculate expected payout and duplication-adjusted expected payout.
- [ ] Calculate downside and bankroll-risk measures.
- [ ] Add confidence intervals and suppress rankings when differences fall within simulation noise.

## Phase 9 — Joint portfolio optimization

- [ ] Optimize the probability that at least one lineup reaches the top 20.
- [ ] Optimize the probability that at least one lineup reaches the top 1%.
- [ ] Optimize first-place coverage.
- [ ] Control exposure by pitcher and pitcher pairing.
- [ ] Control exposure by primary and secondary stack.
- [ ] Control exposure by game, weather risk, ownership tier, and explosion scenario.
- [ ] Cover distinct pitcher outcomes.
- [ ] Cover distinct primary and secondary stack outcomes.
- [ ] Cover distinct value-one-off and salary-allocation paths.
- [ ] Add portfolio-level confidence and concentration diagnostics.

## Phase 10 — Feedback and validation

- [ ] Add player MAE, RMSE, bias, rank correlation, and quantile coverage.
- [ ] Break player error down by source, position, salary, handedness, and batting slot.
- [ ] Add pitcher pitch-count, innings, strikeout, and earned-run error metrics.
- [ ] Add pitcher ceiling recall.
- [ ] Add team run-distribution calibration.
- [ ] Add stack ownership error and primary/secondary stack success.
- [ ] Add lineup finish percentile, top-20, top-1%, cash, ROI, duplication, and optimal-lineup regret.
- [ ] Separate candidate-generation regret from ranking regret.
- [ ] Add walk-forward evaluation so a slate cannot influence its own projection or tuning.
- [ ] Require adequate sample sizes and confidence intervals before promoting new weights.
- [ ] Add automated calibration rollback when out-of-sample performance deteriorates.

## Production and validation requirements

- [ ] Add production monitoring for source availability and freshness.
- [ ] Add alerts for missing confirmed lineups, probable pitchers, weather, or ownership inputs.
- [ ] Add integration tests for MLB scan, generation, ingestion, and forensic-report persistence.
- [ ] Run live validation on representative MLB slates.
- [ ] Compare modeled proxy-field metrics against authorized contest CSVs when available.
- [ ] Deploy updated edge functions after validation.
- [ ] Record deployment commit, migration state, and validation results for each release.

## Explicit data limitation

Public MLB, Statcast, schedule, weather, and box-score data can support the player, pitcher, matchup, stack, and outcome portions of this plan. Actual DraftKings contest ownership, full-field lineups, duplication, and contest-specific behavior require authorized contest CSVs or another licensed source. Until observed field data is available, those values must remain labeled as modeled proxies.
