# Multi-Sport DFS Reasoning Upgrade

Engineering handoff checklist for upgrading Fantasy AI from projection-first lineup generation to research-backed, scenario-driven, salary-aware portfolio construction across WNBA, MLB, NBA, NFL, and Golf.

Status: Phase 0–8 and Phase 3A–3C implemented; live testing pending user validation

Progress note: Phase 0, Phase 1, Phase 2, Phase 3, Phase 3A, Phase 3B, Phase 3C, Phase 4, Phase 5, Phase 6, Phase 7, and Phase 8 engineering work is complete in the local workspace. Live endpoint testing and production validation have intentionally not been performed.

Scope: WNBA, MLB, NBA, NFL, and Golf DraftKings classic and Showdown contests where supported

Primary outcome: produce lineups with the same reasoning qualities demonstrated in the reference ChatGPT workflow while preserving auditable evidence, legal salary construction, outcome measurement, and learning-loop compatibility.

## 1. Product definition

### 1.1 Decision model

The system must move from:

> Select the highest-scoring legal lineups.

To:

> Build a research-backed slate thesis, model plausible game scripts, optimize legal lineups within each script, and select a diversified portfolio based on projection, ceiling, leverage, duplication, and contest payout structure.

### 1.2 Non-negotiable behavior

- [x] Never fabricate salaries, ownership, injuries, lineups, projections, or news.
- [x] Block or downgrade tournament recommendations when required inputs are missing or stale.
- [x] Preserve the exact evidence and assumptions used for every generated lineup.
- [x] Distinguish median projection, ceiling, leverage, expected payout, and probability of optimal outcome.
- [x] Return multiple materially different game scripts when multiple entries are requested.
- [x] Explain why each lineup exists in plain language.
- [x] Treat social/community content as context and discovery, never as a standalone projection source.
- [ ] Re-run final news, lineup, weather, market, and ownership checks before lock. *(Live/pre-lock validation remains user-owned.)*
- [x] Feed settled outcomes back into calibration and strategy evaluation only after sufficient sample size.

## 2. Current system baseline

Existing capabilities to preserve and extend:

- [x] DraftKings slate and salary ingestion
- [x] Confirmed-lineup ingestion
- [x] Ownership projections
- [x] News/event ledger and source reliability
- [x] Immutable MIOS scan snapshots
- [x] Generated-lineup persistence and snapshot linkage
- [x] Monte Carlo lineup simulation
- [x] Ceiling, leverage, duplication, and expected-payout fields
- [x] WNBA role/minutes and joint-simulation modules
- [x] MLB stacking and batting-order inputs
- [x] Actual-results ingestion
- [x] Learning diagnostics and weekly report pipeline

Known remaining gap: final live/pre-lock decision passes and production validation remain outstanding.

Architecture rule: use one shared decision architecture with sport-specific adapters. Do not copy MLB features into NBA or force a single projection formula across sports.

## 3. Phase 0 — contracts, ownership, and observability

### 3.1 Define shared domain contracts

- [x] Create `SlateResearchDossier` contract with all listed identity, freshness, environment, hierarchy, script, evidence, gap, and confidence fields.
- [x] Create `GameScript` contract with stable keys, thesis, conditions, exposure targets, player rules, probability, evidence, confidence, and uncertainty.
- [x] Create `PlayerDecisionProfile` contract with distributions, probabilities, salary efficiency, eligibility, opportunity, edges, ownership/leverage, evidence, and freshness.
- [x] Create `PortfolioDecision` contract with lineup selection, script assignment, exposure, similarity, rationale, and rejected alternatives.

### 3.2 Add stage-level observability

- [x] Add request IDs and stage timings to dossier generation.
- [x] Log counts for each source and every fallback.
- [x] Log candidate-pool size before and after each constraint.
- [x] Log the number of legal lineups enumerated.
- [x] Log the number of candidates per game script.
- [x] Log why candidates were rejected.
- [x] Log final portfolio overlap, salary usage, projected ownership, and duplication.
- [x] Persist all stage metadata inside the immutable scan snapshot.

### 3.3 Acceptance criteria

- [x] A scan can be replayed from its snapshot without current external data.
- [x] Every output claim has at least one source or is explicitly labeled modeled.
- [x] A missing required source produces a visible readiness warning, not silent fallback.
- [x] The generated lineup record identifies the dossier version, script key, and model version.

## 4. Phase 1 — research dossier and source hierarchy

### 4.1 Source policy

- [x] Classify sources as official, league, media, market, aggregator, community, or internal.
- [x] Assign source reliability priors by data type, not just source globally.
- [x] Track source freshness and last successful fetch.
- [x] Track contradiction between sources.
- [x] Require corroboration for high-impact injury, role, transaction, or lineup changes when possible; unresolved corroboration is surfaced as a dossier data gap.
- [x] Preserve source URL, publication time, observation time, raw payload, and normalized fact.

### 4.2 Dossier assembly

- [x] Fetch current slate/salary data.
- [x] Fetch confirmed lineup/availability data.
- [x] Fetch relevant intelligence events from the Understand ledger.
- [x] Fetch market data: spread, total, implied team totals, and meaningful movement.
- [x] Fetch ownership projections and timestamp them.
- [x] Fetch sport-specific environment data.
- [x] Normalize player/team identities before joining sources.
- [x] Assign each fact a confidence and freshness score; materiality remains a follow-up field.
- [x] Generate a short “what changed” summary compared with the previous snapshot.
- [x] Generate explicit data gaps and stale-source warnings.

### 4.3 Research output

- [x] Produce a player hierarchy: A+, A, A-, leverage, value, avoid/watch.
- [x] Produce top matchup edges with evidence.
- [x] Produce slate risks and fragile assumptions.
- [x] Produce at least three candidate game scripts when the slate supports them.
- [x] Produce a final live/pre-lock checklist with unresolved items. *(Execution of the live refresh remains user-owned.)*

## 5. Phase 2 — MLB reasoning upgrade

### 5.1 Pitcher model

- [x] Add handedness-specific pitcher splits, with explicit `unknown`/null values when upstream handedness is unavailable.
- [x] Add K%, BB%, HR/9, xFIP/SIERA, wOBA allowed, ISO allowed, and barrel rate allowed. *(xFIP/SIERA remain explicitly null when unavailable.)*
- [x] Add pitch-count and innings distribution.
- [x] Add projected strikeout distribution.
- [x] Add times-through-the-order and early-exit risk.
- [x] Add opposing lineup strikeout and contact profile fields, with source gaps surfaced when unavailable.
- [x] Separate season baseline, recent form, and injury-adjusted form.
- [x] Penalize unsupported small samples through shrinkage.

### 5.2 Hitter model

- [x] Add hitter splits by pitcher handedness, with explicit `unknown`/null values when upstream handedness is unavailable.
- [x] Add wOBA, ISO, K%, BB%, xwOBA, xSLG, barrel rate, hard-hit rate, exit velocity, and launch angle.
- [x] Blend season and recent windows with explicit weights.
- [x] Add pitch-type performance versus the opposing pitcher’s primary arsenal fields, with empty evidence rather than fabricated values when unavailable.
- [x] Add projected plate appearances by batting order and team run environment.
- [x] Model home-run, hit, double, RBI, run, walk, and stolen-base probabilities.
- [x] Include batter/pitcher interaction evidence without overfitting historical matchups; small samples are shrunk and unsupported interactions remain null.

### 5.3 Game environment

- [x] Add park factors by handedness and batted-ball type, with explicit fallback/gap metadata when only baseline park data is available.
- [x] Add temperature, wind direction/speed, precipitation, and roof status.
- [x] Add implied team totals and total movement.
- [x] Add bullpen availability, recent workload, injured relievers, and expected late-inning quality. *(Available workload context is sourced from MLB Stats API; injured-reliever quality remains limited.)*
- [x] Model starter-to-bullpen transition explicitly.
- [x] Add weather and bullpen freshness to game-script probabilities.

### 5.4 MLB scripts

- [x] Pitcher duel / low-scoring game
- [x] Favorite offense dominates
- [x] Underdog starter failure
- [x] Both offenses produce
- [x] Starter exits early and bullpen is attacked
- [x] One-sided game with concentrated scoring

Each script must define:

- [x] Expected score range
- [x] Team run distribution
- [x] Starter innings/K assumptions
- [x] Preferred stacks
- [x] Bring-backs
- [x] Captain candidates for Showdown
- [x] Players to fade and why
- [x] Ownership/leverage expectation

### 5.5 MLB acceptance criteria

- [x] Same-salary pitchers are ranked by forward-looking evidence, not FPPG alone.
- [x] A low-priced player can become Captain only when salary-adjusted ceiling and lineup unlock value justify it.
- [x] The system can explain a stack through batting order, matchup, correlation, and game script.
- [x] MLB projections expose median and ceiling distributions, not one opaque number.
- [x] A late bullpen or weather update can materially change the dossier and portfolio.

## 6. Phase 3 — WNBA reasoning upgrade

### 6.1 Role and minutes

- [x] Confirm starting lineup and availability before generating tournament lineups.
- [x] Model minutes as a distribution with starter, bench, foul, blowout, and injury scenarios.
- [x] Add rotation depth and replacement-player identity.
- [x] Reallocate usage, assist, rebound, and defensive opportunity after an absence. *(Implemented through replacement features and joint simulation.)*
- [x] Include coach rotation tendencies and recent role changes when available; missing signals remain explicit uncertainty.
- [x] Separate healthy-role baseline from injury-contingent projection.

### 6.2 Player production

- [x] Add per-minute production and usage by role.
- [x] Add team pace, opponent pace, possession projection, and matchup position when available.
- [x] Add rebound and assist opportunity context.
- [x] Add blowout probability and fourth-quarter minutes risk.
- [x] Add back-to-back, rest, travel, and schedule context when available.
- [x] Model correlated player outcomes for teammates and opponents.

### 6.3 WNBA scripts

- [x] Competitive high-total game
- [x] Favorite controls game with concentrated stars
- [x] Underdog stays competitive through primary creators
- [x] Injury replacement value dominates pricing
- [x] Blowout reduces starter minutes
- [x] Overtime/extended-minute ceiling scenario

Each script must define:

- [x] Expected pace and score range
- [x] Minutes assumptions
- [x] Usage redistribution
- [x] Primary correlations
- [x] Captain candidates
- [x] Bench/replacement value
- [x] Blowout and late-swap risks

### 6.4 WNBA acceptance criteria

- [x] A questionable player cannot be treated as active without an explicit scenario.
- [x] A replacement player’s projection explains the role and opportunity change.
- [x] Captain selection reflects ceiling and minutes certainty, not raw FPPG alone.
- [x] The system can produce materially different competitive-game and blowout-game portfolios.
- [x] Late lineup news changes exposure and lineup legality before lock. *(Live execution/validation remains pending.)*

## 7. Phase 3A — NBA reasoning upgrade

### 7.1 Availability and role

- [x] Confirm starters, inactive players, probable/questionable status, and minutes restrictions.
- [x] Track source timestamp and confidence for every availability change.
- [x] Build rotation depth charts by team and position.
- [x] Identify replacement players and redistribute minutes, usage, assists, rebounds, and defensive events.
- [x] Model coach-specific rotation patterns and closing-lineup tendencies.
- [x] Separate healthy-role, restricted-role, bench-role, and blowout-role projections.

### 7.2 NBA player model

- [x] Add per-minute fantasy production by role.
- [x] Add usage, touch, time-of-possession, assist, rebound, and stocks opportunity.
- [x] Add projected possessions from team pace and opponent pace.
- [x] Add opponent positional matchup and defensive scheme context.
- [x] Add rest, travel, back-to-back, altitude, and schedule density.
- [x] Model minutes, usage, and fantasy outcomes as distributions rather than point estimates.
- [x] Add foul-risk and blowout-minute uncertainty.
- [x] Add teammate on/off impacts for high-usage absences.

### 7.3 NBA game scripts

- [x] Competitive high-total game
- [x] Favorite wins comfortably but stars retain normal minutes
- [x] Blowout with bench value
- [x] Underdog primary creator exceeds role expectation
- [x] Injury-replacement slate
- [x] Overtime / extended-minutes ceiling scenario

Each script must define pace, score range, minutes assumptions, usage redistribution, player correlations, Captain candidates, and failure conditions.

### 7.4 NBA acceptance criteria

- [x] A late scratch updates affected players and teammates before lineup generation.
- [x] Blowout risk changes minutes distributions and lineup exposure.
- [x] The system distinguishes a healthy starter from a starter with a minutes cap.
- [x] A Showdown Captain is selected using minutes certainty, ceiling, ownership, and salary-unlock value.
- [x] NBA portfolios contain distinct competitive, blowout, and injury-replacement scenarios when supported by evidence.

## 8. Phase 3B — NFL reasoning upgrade

### 8.1 NFL data and availability

- [x] Confirm quarterback, skill-position, offensive-line, and defensive starters.
- [x] Track snap count, route participation, carry share, target share, and red-zone usage.
- [x] Track practice participation and injury designation changes.
- [x] Track offensive-line continuity and defensive pressure matchups.
- [x] Track weather, wind, precipitation, temperature, and field conditions.
- [x] Track betting spread, total, implied team totals, and line movement.
- [x] Record source timestamp and confidence for all late news.

### 8.2 NFL player model

- [x] Model expected plays and pass/run rate.
- [x] Add quarterback efficiency, pressure, sacks, scramble, and interception distributions.
- [x] Add receiver route participation, target share, air yards, red-zone targets, and matchup.
- [x] Add running-back carry share, route share, goal-line role, and receiving work.
- [x] Add tight-end alignment and defensive coverage context.
- [x] Add touchdown probability and multi-touchdown probability.
- [x] Add defense/special-teams sack, turnover, pressure, and touchdown probabilities.
- [x] Model correlated outcomes instead of treating player projections as independent.

### 8.3 NFL game scripts and stacks

- [x] Shootout: QB + primary receiver + opposing bring-back
- [x] Favorite controls game through lead running back
- [x] Underdog comeback: pass-heavy QB and concentrated targets
- [x] Low-scoring defensive game
- [x] Weather-driven rushing script
- [x] Injury-driven target or carry redistribution

Each script must define expected play volume, scoring distribution, stack rules, bring-back rules, defensive compatibility, and negatively correlated combinations.

### 8.4 NFL acceptance criteria

- [x] A lineup explains its stack and bring-back logic.
- [x] The optimizer does not select negatively correlated combinations without an explicit reason.
- [x] Weather and spread movement can change the preferred script.
- [x] Players with unstable snaps or routes receive uncertainty penalties.
- [x] Showdown Captain selection reflects touchdown concentration and game-script probability.
- [x] Large-field portfolios include distinct shootout, control, comeback, and defensive scripts.

## 9. Phase 3C — Golf reasoning upgrade

### 9.1 Golf data and course context

- [x] Ingest tournament, course, field, tee-time, and DraftKings salary data.
- [x] Add course-fit features: driving distance/accuracy, approach by distance, around-the-green, putting, and par-3/4/5 performance.
- [x] Add strokes-gained metrics with season, recent, and course-history windows.
- [x] Add field strength and player skill baseline.
- [x] Add tee-time weather wave, wind direction/speed, precipitation, and temperature.
- [x] Add cut-line and made-cut probability.
- [x] Add birdie, eagle, bogey, and finish-position distributions.
- [x] Add injury, withdrawal, and tee-time change monitoring.
- [x] Shrink course-history and small-sample data toward the player’s skill baseline.

### 9.2 Golf player model

- [x] Produce median, p75, p90, and p95 DraftKings outcomes.
- [x] Produce made-cut, top-10, top-20, and win probabilities.
- [x] Model scoring volatility by course difficulty and player style.
- [x] Model birdie/eagle upside separately from placement equity.
- [x] Adjust for weather-wave advantage without double-counting weather.
- [x] Add salary efficiency and ownership-adjusted tournament value.
- [x] Track withdrawal and late-start risk as explicit downside scenarios.

### 9.3 Golf tournament scripts

- [x] Calm scoring event
- [x] Difficult course with cut volatility
- [x] Windy-wave advantage
- [x] Ball-striking and approach dominance
- [x] Birdie-heavy event requiring ceiling
- [x] Placement-heavy event rewarding made-cut stability

Golf scripts must describe course conditions, scoring environment, preferred player archetypes, weather-wave exposure, and concentration risk.

### 9.4 Golf acceptance criteria

- [x] The system does not use batting-order, pitcher, or NBA minutes logic for golf.
- [x] A player recommendation explains course fit, scoring path, and weather-wave context.
- [x] Made-cut probability is separated from ceiling probability.
- [x] The optimizer can trade small median value for birdie/eagle ceiling in tournaments.
- [x] A field-wide weather change can trigger a re-run and exposure review.
- [x] Golf lineups are evaluated for wave and course-condition concentration.

## 10. Phase 4 — salary-aware optimization and Captain logic

### 7.1 Salary truth

- [x] Validate DraftKings contest type and roster size from the imported slate.
- [x] Reject stale or mismatched salary tables.
- [x] Store the exact salary snapshot used for generation.
- [x] For Showdown, validate Captain salary and UTIL salary independently.
- [x] Verify Captain salary multiplier from the slate, not a hardcoded assumption.
- [x] Verify salary cap and required team/roster constraints.

### 7.2 Candidate enumeration

- [x] Enumerate legal Captain/UTIL combinations for Showdown.
- [x] Enumerate legal classic lineups within the configured resource budget.
- [x] Track number of candidates considered and pruned.
- [x] Keep top candidates by median, ceiling, leverage, and expected payout.
- [x] Preserve near-optimal alternatives for portfolio construction.

### 7.3 Captain selection

- [x] Calculate Captain-adjusted median.
- [x] Calculate Captain-adjusted ceiling.
- [x] Calculate Captain optimal-lineup frequency.
- [x] Calculate Captain ownership and leverage.
- [x] Calculate salary-unlock value from the Captain choice.
- [x] Penalize Captains whose outcome depends on unsupported assumptions.
- [x] Explain why the selected Captain beats higher raw-projection alternatives.

## 11. Phase 5 — scenario-first portfolio construction

- [x] Generate a candidate pool per game script.
- [x] Assign each candidate a script confidence and script exposure.
- [x] Select the best single-entry lineup separately from the best large-field lineup.
- [x] Select at least one lineup per materially different high-confidence script when entry count permits.
- [x] Penalize excessive player, team, Captain, and script overlap.
- [x] Estimate lineup duplication using ownership, salary usage, Captain popularity, and common construction.
- [x] Allow intentional salary left unused when the projected loss is small and duplication benefit is meaningful.
- [x] Produce a portfolio-level exposure summary.
- [x] Explain what happens if the primary thesis fails.

### 8.1 Portfolio acceptance criteria

- [x] Three requested lineups are not merely small variations of one script.
- [x] Every lineup has a named game script.
- [x] Every lineup has a stated “why this wins” thesis.
- [x] The portfolio displays overlap and concentration risks.
- [x] The system identifies the one-entry recommendation separately.

## 12. Phase 6 — final pre-lock intelligence pass

- [x] Schedule a final pass 10–15 minutes before lock (scheduler-ready callable pass; production scheduling remains live validation).
- [x] Re-fetch confirmed lineups and scratches.
- [x] Re-fetch weather and market movement.
- [x] Re-fetch ownership when available.
- [x] Re-check pitcher/rotation status and late news.
- [x] Compare new facts with the prior dossier.
- [x] Rebuild only affected players, scripts, and lineups where possible.
- [x] Mark stale lineups as superseded.
- [x] Surface what changed between the initial and final recommendation.

## 13. Phase 7 — reasoning presentation

For every recommendation, expose:

- [x] Slate thesis
- [x] Player hierarchy
- [x] Key evidence
- [x] Game script
- [x] Median/ceiling/floor
- [x] Salary and remaining salary
- [x] Ownership and leverage
- [x] Captain rationale
- [x] Stack/correlation rationale
- [x] Risk and failure conditions
- [x] Data freshness
- [x] Confidence limitations

Avoid:

- [x] Unqualified “lock” language
- [x] Exact-looking projections without uncertainty
- [x] News summaries without source and timestamp
- [x] Three identical lineups presented as diversification
- [x] Recommending a player solely because of a recent hot streak

## 14. Phase 8 — learning-loop integration

- [x] Store dossier ID and version on every generated lineup.
- [x] Store script key and player decision profiles in lineup configuration.
- [x] Store rejected-candidate reasons for auditability.
- [x] Compare each script’s projected and realized outcome.
- [x] Compare player-level projections by role, matchup, salary tier, and sport.
- [x] Compare Captain projections against actual Captain optimal frequency.
- [x] Compare ownership/leverage assumptions against actual ownership and payout.
- [x] Compare portfolios, not just individual lineups.
- [x] Generate rules only after minimum sample thresholds.
- [x] Keep candidate rules separate from active rules.
- [x] Require shadow evaluation before activating material strategy changes.
- [x] Include the reasoning changes in the weekly learning report.

## 15. Data quality and readiness gates

- [x] Define required inputs by sport and contest type.
- [x] Define maximum acceptable age for each input.
- [x] Define minimum source coverage for tournament recommendations.
- [x] Define behavior when ownership is missing.
- [x] Define behavior when confirmed lineups are missing.
- [x] Define behavior when salaries are mismatched.
- [x] Define behavior when weather or market data are unavailable.
- [x] Add a visible `ready`, `caution`, or `blocked` state to the user result.
- [x] Prevent modeled fallback values from being presented as verified facts.

## 16. Test plan

### 13.1 Unit tests

- [x] Showdown Captain salary conversion
- [x] Roster-size and salary-cap validation
- [x] Lineup legality
- [x] Batting-order opportunity weighting
- [x] Pitcher/hitter handedness joins
- [x] Pitch-type matchup joins
- [x] Statcast window blending
- [x] WNBA minutes redistribution
- [x] WNBA injury replacement logic
- [x] Game-script constraint application
- [x] Portfolio overlap limits
- [x] Duplication scoring
- [x] Missing/stale source readiness states

### 13.2 Replay tests

- [x] Replay historical WNBA slates from frozen snapshots.
- [x] Replay historical MLB Showdown slates from frozen salary tables.
- [x] Compare old engine vs. upgraded engine on identical inputs.
- [x] Compare median error, ceiling hit rate, optimal percentage, cash rate, payout, and duplication.
- [x] Compare script diversity and portfolio overlap.

### 13.3 Production safeguards

- [x] Shadow-run the upgraded reasoning model before promotion.
- [x] Keep the current model as a baseline.
- [x] Require minimum sample size before switching defaults.
- [x] Add rollback by model version.
- [x] Alert on missing data or sudden projection drift.
- [x] Do not activate rules based on a single slate.

## 17. Delivery order

- [x] Phase 0: contracts, observability, and readiness gates
- [x] Phase 1: research dossier and source hierarchy
- [x] Phase 2: MLB-specific model inputs and scripts
- [x] Phase 3: WNBA-specific model inputs and scripts
- [x] Phase 3A: NBA-specific model inputs and scripts
- [x] Phase 3B: NFL-specific model inputs and scripts
- [x] Phase 3C: Golf-specific model inputs and scripts
- [x] Phase 4: salary-aware Captain and roster enumeration
- [x] Phase 5: scenario-first portfolio construction
- [x] Phase 6: final pre-lock pass
- [x] Phase 7: reasoning presentation
- [x] Phase 8: cross-sport learning-loop integration and shadow promotion
- [ ] Production live-scan validation

## 18. Definition of done

- [x] A WNBA or MLB scan produces a frozen, source-backed research dossier.
- [x] An NBA, NFL, or Golf scan uses the same dossier contract with a sport-specific adapter.
- [x] The dossier contains explicit player tiers and game scripts.
- [x] Every lineup is legal and tied to a salary snapshot.
- [x] Showdown Captain selection is salary-aware and probabilistic.
- [x] Multiple lineups represent meaningfully different scripts.
- [x] The UI explains the thesis, evidence, risks, and assumptions.
- [x] The final pre-lock pass can supersede stale recommendations.
- [x] Results are measured by player, lineup, Captain, script, and portfolio.
- [x] Results are compared across sports without conflating sport-specific metrics.
- [x] Weekly learning reports show which reasoning changes improved results.
- [x] Shadow evaluation supports safe promotion and rollback.
- [ ] Live production scan testing passes for WNBA and MLB.
