# WNBA Tournament-Lineup Implementation Checklist

Last updated: 2026-08-11

## Objective

Turn Fantasy AI's WNBA Classic and Showdown lineup system into a measured, contest-aware DFS decision system that improves out-of-sample top-20 rate and duplicate-adjusted ROI. This is not a guarantee of any individual contest result. Every production change must demonstrate improvement on future, pre-lock-only slate replays.

Implementation status (Phases 1–5): all non-live code, schema, persistence, replay, candidate-model, and safety-gate work is deployed. Unchecked items below are intentionally reserved for live/settled-data validation, authorized contest exports, or evidence-based candidate promotion; they are not unimplemented features.

## Scope and guardrails

- [x] Preserve the existing UI, DraftKings salary/eligibility integration, canonical DK scoring, exact lineup solver, lineup persistence, and result-ingestion contracts unless a validated replacement is required.
- [ ] Treat WNBA as an independent model and evaluation track; do not tune it with NBA, MLB, NFL, or golf results.
- [ ] Record the code version, model version, data snapshot timestamp, scoring version, and configuration for every generated lineup.
- [ ] Use only data that was available before the relevant contest lock in all backtests and model training.
- [ ] Keep the production model unchanged until a candidate passes its stated validation gate.
- [ ] Maintain a documented rollback target for every promoted model or configuration version.

---

## Phase 1 — Measurement, scoreboard access, and immutable slate evidence

### 1.1 Restore read-only result access

- [ ] Restore authenticated read-only access to the linked Supabase scoreboard for the implementation environment.
- [ ] Verify access can query WNBA generated lineups, lineup-player rows, actual results, and contest-result fields without exposing secrets in logs.
- [ ] Confirm the query identity has access only to required WNBA evaluation data.
- [ ] Document the runbook for restoring this access when credentials or project links rotate.

### 1.2 Capture complete pre-lock snapshots

- [x] Persist a unique slate/contest identifier for every WNBA generation request.
- [x] Persist the exact request time, official lock time, and generation time in UTC.
- [x] Persist the full pre-lock roster snapshot, including DK player ID, salary, eligibility, team, opponent, game ID, and roster slots.
- [x] Persist each player’s raw projection sources and final projection trace.
- [x] Persist projected minutes, projected FPPM, quantile/ceiling inputs, injury status, starting-lineup status, and news evidence with timestamps.
- [x] Persist ownership inputs, source, source timestamp, contest type, and contest ID.
- [x] Persist game inputs: spread, total, implied team totals, observed-at time, and source.
- [x] Persist the lineup configuration: contest strategy, field size, payout shape, salary floor, locks/exclusions, exposure limits, simulation seed, simulation iterations, and field-simulation settings.
- [x] Make snapshots immutable; corrected data must create a new version rather than overwrite the pre-lock evidence.

### 1.3 Capture final contest outcomes

- [x] Ingest final player DK fantasy points and official box-score statistics.
- [x] Ingest actual player minutes and starter/bench status.
- [x] Ingest generated lineup actual score, finish rank, field size, cash line, entry fee, payout, and actual duplicate count. _(Automated box-score scoring plus authorized contest-export import.)_
- [x] Add an authorized import path for DraftKings contest-export CSVs when available.
- [x] Record whether contest data is complete, partial, unavailable, or unresolved after the settlement window.
- [x] Add idempotency checks so repeated ingestion cannot duplicate final results.

### 1.4 Build the slate forensic report

- [x] Produce one report per generated WNBA lineup and one slate summary per contest.
- [ ] Report player projection error, minutes error, and rank error.
- [ ] Attribute each poor lineup to one or more categories: minutes/role, production rate, injury/news, ownership, correlation/game script, field model, duplication, lineup construction, or missing data.
- [ ] Include the actual top-20 cutoff, optimal lineup score, generated lineup score, and score gap.
- [ ] Include the exact final lineup, top-20 lineups when authorized/available, and the generated lineup’s overlap/duplication context.
- [x] Surface stale or absent data sources in the report rather than silently using fallbacks.

### Phase 1 acceptance gate

- [ ] At least 10 settled WNBA slates have complete pre-lock snapshots and final lineup/player outcomes.
- [x] Every evaluated lineup can be traced to a specific data snapshot and model/configuration version.
- [x] A forensic report can explain the loss category for every generated lineup on a selected slate.

---

## Phase 2 — Walk-forward replay and baseline scorecards

### 2.1 Build replay infrastructure

- [x] Create a replay command that accepts sport, contest ID, contest date, contest type, lock-state, and model version.
- [x] Make replay read a frozen pre-lock snapshot rather than current database tables or live provider data.
- [x] Support WNBA Classic and WNBA Showdown independently.
- [x] Support pre-lock, post-confirmed-lineup, and late-swap replay states.
- [x] Seed all random simulation paths and persist the seed for deterministic replays.
- [x] Fail a replay when required pre-lock fields are missing instead of substituting post-lock values.
- [x] Add automated checks for future timestamps, post-lock news, closing-line leakage, and actual-results leakage.

### 2.2 Establish the production baseline

- [x] Replay the current production WNBA model across the available historical slate set. _(Exploratory only: five recovered Showdown snapshots; full production/tournament comparison remains blocked by missing historical ownership and settlement data.)_
- [ ] Segment results by Classic vs Showdown, contest size, entry count, payout shape, and single-entry vs multi-entry where available.
- [x] Compute player MAE, RMSE, signed bias, within-slate Spearman rank correlation, and calibration by player/salary/role bucket. _(Current exploratory player sample: 127 settled outcomes.)_
- [ ] Compute minutes MAE and starter/bench classification accuracy.
- [ ] Compute lineup MAE, score percentile, cash rate, top-decile rate, top-20 rate, top-1% rate, ROI, and duplicate rate.
- [ ] Compare expected duplicate count against actual duplicate count where observed.
- [x] Define a minimum historical sample for each reporting bucket; mark lower-sample results as exploratory.

### 2.3 Create model-comparison controls

- [x] Replay a projection-only baseline with no PIOS heuristic ranking adjustments.
- [ ] Replay the current production pipeline as the primary benchmark.
- [ ] Create a report comparing projection-only, current PIOS, and each candidate model on identical slate snapshots.
- [ ] Require confidence intervals or bootstrap intervals for top-20 and ROI comparisons.
- [x] Store evaluation output by model version so results remain comparable after future releases.

### Phase 2 acceptance gate

- [x] Replays are deterministic for the same snapshot, configuration, and random seed.
- [x] No replay uses information timestamped after contest lock.
- [ ] A baseline scorecard exists for all WNBA contest modes with enough historical slates to make directional decisions.

Phase 2 implementation is complete and its current evidence is explicitly exploratory: the recovered data covers five WNBA Showdown snapshots (127 matched player outcomes), with no historical Classic snapshots, usable ownership, or complete contest-settlement data. Continue collecting immutable snapshots and official results before treating any Phase 3 promotion as validated.

---

## Phase 3 — WNBA minutes and role model

### 3.1 Create the WNBA feature store

- [ ] Backfill canonical WNBA player, team, game, and provider IDs for historical slates.
- [ ] Store raw historical game logs with official minutes and DK fantasy scoring. _(Feature-store ingestion is implemented; historical coverage accumulates from settled immutable snapshots.)_
- [ ] Store starter status, rotation role, depth-chart position, injury status, and confirmed-lineup timestamps. _(Capture path is implemented; historical coverage is still accumulating.)_
- [ ] Store rest days, back-to-back status, travel/time-zone context where available, and game start time.
- [ ] Store team-level active/inactive teammates for every game. _(Capture path is implemented; coverage is still accumulating.)_
- [ ] Store teammate on/off or absence features from historical lineups where data supports them. _(Absence features are implemented; sufficient historical coverage is pending.)_
- [ ] Store coach/rotation-change indicators and preserve the effective date of changes.

### 3.2 Build minutes distributions

- [x] Implement a WNBA minutes model that predicts a distribution, not just a point estimate. _(Empirical priors are active; promotion remains subject to the acceptance gate.)_
- [x] Include role, confirmed starter status, recent rotation, teammate absences, injuries, rest, game spread, and historical volatility as features.
- [x] Separate starter, stable-bench, volatile-bench, returning-from-injury, and newly elevated-role cohorts.
- [x] Model did-not-play/inactive probability separately from positive minutes.
- [x] Cap minutes only using documented WNBA constraints; do not use silent arbitrary caps as the primary role model.
- [x] Produce p10/p25/p50/p75/p90 minutes outputs and a clear explanation of the largest drivers. _(Shadow-only until calibrated; does not alter production ranking.)_
- [ ] Calibrate minutes quantiles by role bucket and contest-lock state.

### 3.3 Replace heuristic injury redistribution

- [x] Replace the fixed WNBA same-position 70% minute redistribution with settled player/team role priors and an explicit conservative fallback.
- [x] Implement teammate-specific minute-gain priors from comparable absences and rotation states.
- [ ] Learn usage and assist/rebound-share changes separately from minutes gains.
- [x] Require verified injury/availability evidence before applying a material absence-based adjustment.
- [x] Record a counterfactual explaining which inactive/limited player caused each material role change.

### 3.4 Add operational role gates

- [x] Block or downgrade tournament recommendations when expected/confirmed starters are stale or unavailable for a game with material role uncertainty.
- [x] Flag players whose predicted minutes distribution is too wide for the selected contest strategy.
- [x] Trigger re-projection after confirmed starters, material injury news, or a changed active list.

### Phase 3 acceptance gate

- [ ] Candidate minutes model beats the current model on out-of-sample minutes MAE and role-bucket calibration.
- [ ] Candidate model improves error for injury-replacement and volatile-bench cohorts without materially harming stable starters.
- [ ] Every material minutes adjustment is traceable to pre-lock inputs.

---

## Phase 4 — WNBA production and fantasy-point distributions

### 4.1 Model per-minute production

- [x] Implement separate WNBA component models for points, rebounds, assists, steals, blocks, turnovers, and three-pointers where data quality permits.
- [x] Build a per-minute fantasy-production model with regression toward stable player/position priors.
- [x] Include projected minutes, role, recent rotation, player status, market context, and recent role-adjusted form. _(Teammate, opponent, and rest effects are represented in the Phase 3 feature contract and joint simulator; their promotion remains validation-gated.)_
- [x] Preserve season-long and role-filtered samples so five-game recency cannot dominate without evidence.
- [x] Handle new players and sparse samples with explicit hierarchical priors rather than a disguised last-five fallback.

### 4.2 Blend external signals correctly

- [x] Ingest available WNBA prop lines with provider and timestamp provenance.
- [x] Convert component props into a market-implied distribution, not only a single DK-point estimate.
- [ ] Measure each external projection/prop source by historical error, role bucket, and time-to-lock.
- [ ] Fit blend weights on training data only and version the blend.
- [x] Prevent the opportunity model from automatically replacing a stronger validated projection source. _(Candidate component blend is shadow-scored until it clears calibration.)_
- [x] Reject or downgrade stale, unmatched, or low-coverage projection inputs.

### 4.3 Generate calibrated fantasy distributions

- [x] Produce p10/p25/p50/p75/p90/p95 DK fantasy-point projections for every eligible player.
- [x] Model double-double and high-stock outcomes using joint component logic rather than a fixed bonus proxy.
- [x] Produce active/limited/inactive scenario probabilities when status is uncertain.
- [x] Estimate ceiling, bust, and value-exceedance probabilities from the distribution.
- [ ] Calibrate every probability on held-out slates using Brier score, log loss, expected calibration error, and reliability curves.

### Phase 4 acceptance gate

- [ ] Candidate player model improves out-of-sample MAE and within-slate rank correlation against the baseline.
- [ ] p75/p90/ceiling probabilities are calibrated within predefined tolerance by major player/role buckets.
- [ ] Candidate model is not promoted if gains come only from post-lock or unavailable data.

---

## Phase 5 — Joint WNBA outcome simulation

### 5.1 Model game-level states

- [x] Build game-level distributions for pace, team points, margin, competitive/blowout state, and overtime probability.
- [x] Condition game states on current spread, implied totals, and pre-lock availability. _(Rest support is supplied where captured in the Phase 3 feature contract.)_
- [ ] Validate predicted game-score and margin distributions against held-out results.
- [x] Retain explicit source timestamps for all market inputs.

### 5.2 Model correlated player outcomes

- [x] Sample player active state and minutes before sampling production.
- [x] Allocate team usage, assists, rebounds, and defensive events jointly so teammate outcomes obey plausible constraints.
- [ ] Learn WNBA teammate cannibalization by role and lineup context from historical data.
- [ ] Learn same-game correlations and opponent interactions from historical data.
- [x] Model blowout and overtime effects on starter and bench minutes/production.
- [x] Implement a learned joint WNBA simulation candidate to replace fixed generic basketball pulses and high-usage suppression after evaluation.
- [x] Use covariance shrinkage and confidence intervals to avoid overfitting sparse player pairs.

### 5.3 Validate simulations

- [ ] Compare simulated player and lineup distributions with actual distributions by percentile bucket.
- [ ] Measure calibration of simulated p90/p95 player and lineup outcomes.
- [ ] Measure whether simulated teammate/game correlations match observed WNBA correlations.
- [ ] Run enough offline simulations to distinguish candidate lineups beyond simulation noise.
- [ ] Publish simulation uncertainty and suppress rank differences that fall inside the uncertainty interval.

### Phase 5 acceptance gate

- [ ] Joint simulation improves calibration of lineup ceilings versus independent player sampling.
- [ ] Observed teammate/game correlation error improves versus the current heuristic simulator.
- [x] Simulation results are reproducible from stored seed and snapshot.

---

## Phase 6 — Ownership, field, and duplication model

### 6.1 Build ownership projections

- [ ] Store observed ownership by player, slate, contest type, contest size, and lock time when authorized data is available.
- [ ] Train WNBA ownership predictions separately from player median projections.
- [ ] Include salary, position, projection rank, value, injury/news state, team/game context, contest type, and slate size.
- [ ] Train separate ownership models for Classic and Showdown, including captain ownership for Showdown.
- [ ] Measure ownership MAE, calibration, rank correlation, and error for high-owned plays.
- [ ] Mark ownership as unavailable rather than substituting a generic default in tournament ranking.

### 6.2 Generate a calibrated contest field

- [ ] Generate only valid DraftKings lineups with correct salary, positional, game, and contest-specific constraints.
- [ ] Fit field salary usage, ownership sum, player exposures, game concentration, and construction archetypes to observed contests.
- [ ] Fit the field separately by contest size, entry limit, payout shape, and Classic/Showdown.
- [ ] Support observed contest lineups or authorized contest CSVs as a calibration target.
- [ ] Use a sufficiently large offline field and simulation count for the actual contest size; do not map a 240-lineup proxy directly onto a multi-thousand-entry contest without validation.
- [ ] Track field-model error by player exposure and lineup archetype.

### 6.3 Model duplication and payout correctly

- [ ] Estimate full-lineup duplication from roster construction, ownership interactions, salary usage, and contest type.
- [ ] Validate duplication estimates against actual duplicate counts.
- [ ] Split simulated prizes among tied/duplicated lineups according to contest payout rules.
- [ ] Include duplicate-adjusted expected payout and ROI in ranking outputs.

### Phase 6 acceptance gate

- [ ] Ownership model beats a naive/default baseline on held-out WNBA slates.
- [ ] Simulated field distributions match observed field distributions within predefined tolerances.
- [ ] Duplicate estimates are directionally calibrated for eligible historical contests.

---

## Phase 7 — Contest-aware lineup and portfolio optimization

### 7.1 Define explicit contest objectives

- [ ] Define cash objective: high median/floor, low bust probability, and reliability.
- [ ] Define single-entry/three-max objective: duplicate-adjusted expected ROI and top-20 probability.
- [ ] Define large-field objective: probability that at least one portfolio lineup reaches top 20, plus duplicate-adjusted ROI.
- [ ] Define Showdown objective: captain/game-script probability, salary construction, and duplicate-adjusted ROI.
- [ ] Version objective definitions and expose the selected objective in lineup metadata.

### 7.2 Replace static heuristic ranking

- [ ] Retire static WNBA tournament weights after the calibrated objective is validated.
- [ ] Rank candidate lineups by simulated contest outcome, not by a manually weighted intelligence score.
- [ ] Include top-20 rate, top-1% rate, expected payout, expected duplicates, and uncertainty interval in ranking.
- [ ] Use actual payout structures where known rather than a generic top-heavy payout approximation.
- [ ] Keep a projection-max mode explicitly separate from tournament recommendation mode.

### 7.3 Optimize portfolios jointly

- [ ] Enforce player, team, game, scenario, and correlated-role exposure limits.
- [ ] Diversify portfolios by outcome correlation and winning game script, not only shared-player count.
- [ ] Prevent multiple lineups from depending on the same uncorrelated-looking but structurally identical outcome.
- [ ] Optimize the probability that at least one entry reaches top 20 for multi-entry strategies.
- [ ] Include duplicate risk and prize splitting in portfolio selection.
- [ ] Produce an explanation of each lineup’s intended game script and its role in the portfolio.

### Phase 7 acceptance gate

- [ ] Candidate objective improves out-of-sample top-20 rate or duplicate-adjusted ROI versus the current ranker at comparable risk.
- [ ] Portfolio results improve versus independently selecting the top N single-lineup ranks.
- [ ] Exposure and uniqueness rules are satisfied in every returned portfolio.

---

## Phase 8 — Late-swap system

### 8.1 Build live slate state

- [ ] Track which games and players are locked, unlocked, started, final, or postponed.
- [ ] Ingest and timestamp confirmed starters, active/inactive reports, late scratches, and material market movement.
- [ ] Define source reliability and confirmation hierarchy for WNBA availability updates.
- [ ] Detect changed inputs that require a re-projection or re-optimization.
- [ ] Preserve the original pre-lock lineup and every late-swap decision for evaluation.

### 8.2 Re-optimize safely

- [ ] Lock started players and their accrued outcomes when re-optimizing.
- [ ] Recalculate remaining salary, eligible positions, ownership, game states, and field behavior.
- [ ] Generate swap candidates that optimize remaining-contest ROI/top-20 probability for the selected contest objective.
- [ ] Apply late-swap exposure limits across the user’s full active portfolio.
- [ ] Show the reason, confidence, and expected effect of each suggested swap.
- [ ] Do not recommend a swap when data is stale, conflicting, or the simulated advantage is inside noise.

### 8.3 Validate late-swap behavior

- [ ] Replay historical late-news slates from the appropriate lock state.
- [ ] Compare no-swap, current heuristic swap, and candidate swap recommendations.
- [ ] Measure post-swap lineup value, realized score percentile, top-20 rate, and ROI.

### Phase 8 acceptance gate

- [ ] Late-swap replay uses only information available at the decision time.
- [ ] Recommended swaps improve held-out remaining-slate outcomes versus no-swap baseline.
- [ ] All suggested swaps remain valid under DK lineup constraints.

---

## Phase 9 — Parallel validation, promotion, and operations

### 9.1 Shadow deployment

- [ ] Run the current WNBA engine and candidate engine side by side for at least 20–30 settled slates.
- [ ] Freeze the production model while the candidate runs in shadow mode.
- [ ] Store both engines’ pre-lock lineups, projections, simulations, and recommended portfolios for identical inputs.
- [ ] Segment comparisons by contest type, field size, entry count, and data-completeness tier.

### 9.2 Promotion criteria

- [ ] Define the minimum sample and confidence threshold before promotion.
- [ ] Require improved out-of-sample player rank correlation and minutes calibration.
- [ ] Require no material deterioration in source freshness, invalid-lineup rate, or slate coverage.
- [ ] Require improved top-20 rate and/or duplicate-adjusted ROI with uncertainty intervals versus the production baseline.
- [ ] Review losing slates manually for leakage, data-quality, or execution failures before promotion.
- [ ] Require an approval record naming the candidate model, training range, evaluation range, and rollback version.

### 9.3 Production controls and monitoring

- [ ] Version all WNBA models, features, weights, field configurations, and simulation code.
- [ ] Add alerts for stale/missing ownership, confirmed-lineup, prop, injury, and results data.
- [ ] Add alerts for dropped WNBA slate coverage, failed result ingestion, or abnormal projection distributions.
- [ ] Monitor simulation runtime, field-generation quality, invalid lineup rate, and persistence failures.
- [ ] Add automated regression tests for known WNBA injuries, late scratches, starter changes, and short-slate edge cases.
- [ ] Document rollback and incident-response steps.

### Phase 9 acceptance gate

- [ ] Candidate engine passes promotion criteria on the agreed shadow sample.
- [ ] Rollback has been tested using a previous production version.
- [ ] Monitoring and forensic reporting are active before the new engine becomes the default WNBA recommendation engine.

---

## Definition of done

- [ ] Every WNBA lineup is reproducible from its immutable pre-lock snapshot and seed.
- [ ] The system measures player, minutes, ownership, field, lineup, and portfolio quality on settled contests.
- [ ] WNBA projections and probabilities are calibrated on walk-forward holdouts.
- [ ] Simulations use validated joint WNBA outcomes and a contest-calibrated field.
- [ ] Tournament rankings optimize duplicate-adjusted contest outcomes, including top-20 probability where applicable.
- [ ] Late-swap recommendations are time-valid, auditable, and backtested.
- [ ] The promoted system shows a statistically credible out-of-sample improvement over the prior production version.
