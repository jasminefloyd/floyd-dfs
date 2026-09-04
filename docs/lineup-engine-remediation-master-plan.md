# Lineup Generation Engine — Remediation Master Plan

**Status:** Engineering remediation backlog  
**Source basis:** Consolidated from `sports-agent-code-audit.md` and `lineup-engine-code-review.md`  
**Scope:** Slate → Research → Sport Adjustment → Projection → Optimize → Selection → Learning  
**Primary objective:** Make generated DraftKings lineups technically correct, statistically defensible, sport-aware, and testably more trustworthy before further UI/selection sophistication.

---

# 1. Executive decision

The lineup engine should currently be treated as **NOT TRUSTED for real-money lineup selection**.

The failure is not one optimizer bug. It is a chain of integrity failures:

1. Research evidence can be attributed to the wrong player.
2. Availability logic can remove valid players from the pool.
3. Sport Adjustment can apply the same evidence to too many dimensions and amplify the intended effect nonlinearly.
4. Some sports have incomplete or mismatched DraftKings scoring mappings.
5. Player distributions are generic uncertainty bands rather than sport-specific outcome distributions.
6. Lineup floor/median/ceiling are derived incorrectly from independent player percentiles.
7. Candidate generation can stop before strong lineups are ever evaluated.
8. Ownership, duplication, optimal-lineup frequency, and top-1% frequency are currently heuristic or mislabeled rather than genuine contest-model outputs.
9. Selection can therefore confidently rank lineups using metrics that are not measuring what their names imply.

The remediation strategy is therefore:

> **Correctness first → sport projection integrity second → contest simulation third → selection/learning last.**

Do not tune optimizer weights until Gate 1 passes.

---

# 2. Severity model

## P0 — Trust blocker
A defect that can make a legal lineup materially wrong even when all upstream data is available. Any open P0 means the generated lineup is not decision-grade.

## P1 — Competitive-quality blocker
The engine can produce technically valid lineups, but tournament ranking/portfolio construction is not sufficiently modeled to justify claims such as "best tournament EV," "optimal frequency," or "top 1%."

## P2 — Reliability / observability / calibration
Improves explainability, monitoring, operational confidence, and long-term learning after core quantitative correctness exists.

---

# 3. Operating Rules for Engineering

These rules govern **all remediation work and all future lineup-engine development**. They are intended to prevent the team from fixing isolated bugs while recreating the same trust failures elsewhere in the pipeline.

The operating principle is:

> **The goal is not to generate sophisticated-looking lineups. The goal is to build a system whose numbers can be proven correct at every stage.**

A ticket is not complete because the code compiles, a lineup is legal, or a contest result happened to be good. It is complete only when the affected behavior is observable, reproducible, testable, and cannot silently regress.

---

## 3.1 Correctness before optimization

**Rule:** Do not tune optimizer weights, add portfolio heuristics, or introduce new contest-ranking logic while Gate 1 defects remain open.

Engineering must resolve in this order:

1. player eligibility
2. exact DraftKings scoring
3. research-to-player attribution
4. adjustment semantics
5. projection inputs and derived scoring
6. lineup-level distribution math
7. optimizer search correctness
8. contest-field sophistication

A more sophisticated optimizer cannot compensate for incorrect player scores, bad player pools, or distorted projections. Any work that changes selection weights before upstream correctness is demonstrated should be treated as non-remediation work and deferred.

---

## 3.2 Every stage must have an explicit, inspectable contract

For every player and every generated lineup, engineering must be able to reconstruct the complete decision path:

```text
Raw provider/source data
  ↓
Normalized slate/player record
  ↓
Availability/identity state
  ↓
Research evidence
  ↓
Resolved sport adjustments
  ↓
Projection inputs
  ↓
Projected stat components
  ↓
DraftKings fantasy-point distribution
  ↓
Optimizer candidate metrics
  ↓
Selection decision
```

Each stage must declare:

- required inputs
- optional inputs
- output schema
- provenance/source
- freshness timestamp
- confidence/quality state
- fallback behavior
- hard validation failures

**No stage may depend on an undocumented field or silently reinterpret the meaning of an upstream field.**

If engineering cannot explain where a number came from, that number is not decision-grade.

---

## 3.3 Raw source data is immutable

Provider data, DraftKings data, and extracted research facts must be stored as immutable source observations for the run.

Do not mutate raw fields to represent adjusted projections.

Prefer explicit derived structures such as:

```text
raw.expectedMinutes = 31.4
adjustment.MINUTES = +3.6
projected.expectedMinutes = 35.0
```

rather than:

```text
player.expectedMinutes *= 1.1146
```

This requirement exists so that:

- adjustment compounding can be detected
- pre/post values can be compared
- source errors can be separated from model errors
- historical runs can be reproduced exactly
- Learning can diagnose which stage caused a miss

---

## 3.4 Adjustments must be typed, dimension-specific, and quantity-aware

There must be no generic concept of "Player +8%" inside the quantitative engine.

Every resolved adjustment must specify at minimum:

- `playerId`
- `evidenceId`
- `sport`
- `dimension`
- `beforeValue`
- `adjustment`
- `afterValue`
- `rationale`
- `confidence`
- `sourceTimestamp`

Examples of valid dimensions:

### NBA/WNBA
- minutes
- usage
- assist opportunity
- rebound opportunity
- starting role
- closing role

### NFL
- snaps
- routes
- target share
- carry share
- red-zone opportunity
- pass/rush efficiency

### MLB
- batting order
- expected plate appearances
- handedness/platoon effect
- strikeout rate
- power rate
- pitcher innings expectation

### Golf
- course-fit component
- weather/wave effect
- scoring-rate component
- cut/finish probability

A `MINUTES` adjustment must not also increase points-per-minute. A `TARGET_SHARE` change must not automatically increase catch rate and yards per target. A batting-order move must change expected PA through the PA model rather than multiplying all hitter skills.

---

## 3.5 Evidence may be interpreted once per player × evidence × dimension

The same news item must not be counted twice because both deterministic and AI interpreters saw it.

Each resolved effect must have a stable deduplication identity such as:

```text
(playerId, evidenceId, adjustmentDimension)
```

AI may:

- classify
- refine
- override
- reject

an existing interpretation.

AI may **not** append a second effect for the same evidence and same dimension unless there is an explicit, reviewable reason.

The final resolved adjustment set must be inspectable before Projection runs.

---

## 3.6 Never silently fall back

Fallbacks are allowed only when they are explicit in the run output and have defined confidence consequences.

Examples:

- provider FPPG used instead of a sport-specific model
- identity mapping unresolved
- live DraftKings scoring unavailable and fallback scoring used
- research feed unavailable
- confirmed lineup unavailable
- ownership model unavailable

Every fallback must record:

- fallback type
- affected player(s)/slate
- reason
- timestamp
- confidence downgrade
- whether lineup generation is still permitted

A fallback must **never** be indistinguishable from a successful primary-model path.

If a sport is materially running on fallback inputs—as Golf currently does—the UI and Selection layer must reflect that fact.

---

## 3.7 Missing information is uncertainty, not upside

Model confidence and performance variance are separate concepts.

A player with poor information must not receive a larger tournament ceiling merely because the system knows less about them.

Engineering must model separately:

### Aleatoric / performance uncertainty
The player's real-world variance if the projection inputs are correct.

Examples:
- three-point shooting variance
- touchdown variance
- home-run variance
- golf scoring variance

### Epistemic / model uncertainty
How uncertain the engine is about the projection itself.

Examples:
- unclear minutes
- unresolved injury status
- missing provider input
- questionable player identity match

Low model confidence should result in:

- wider confidence around the projection estimate
- lower trust state
- possible lineup exclusion only when explicitly required

It must not mechanically improve P90 or tournament desirability.

---

## 3.8 No metric name may imply rigor the engine has not computed

Metric names are part of the quantitative contract.

Do not use names such as:

- `optimalLineupFrequency`
- `topOnePercentFrequency`
- `expectedROI`
- `BEST_TOURNAMENT_EV`
- `expectedDuplicates`

unless those values are actually calculated from the relevant simulation/model.

Temporary heuristic fields must be named as heuristics, e.g.:

```text
heuristicTournamentScore
salaryBasedOwnershipProxy
constructionDuplicationRisk
```

Selection and the UI may not upgrade a heuristic into a stronger claim through copy.

---

## 3.9 Player identity resolution is critical infrastructure

Cross-provider player matching must be treated as a first-class system, not string-cleanup glue.

Identity records should prefer stable IDs where available and otherwise use normalized matching with explicit confidence.

Normalization must account for common provider differences including:

- punctuation
- diacritics
- suffixes (`Jr.`, `Sr.`, `II`, `III`, etc.)
- abbreviated first names
- team changes
- position differences

Every match must have a state such as:

```text
EXACT_ID
HIGH_CONFIDENCE_MATCH
LOW_CONFIDENCE_MATCH
UNMAPPED
CONFLICT
```

`LOW_CONFIDENCE_MATCH` or `UNMAPPED` must not silently mean `OUT`.

If a player is removed from eligibility, the reason must be explicit and auditable.

---

## 3.10 Research evidence must be entity- and claim-aware

Do not attach an article to the first player name found in the text.

Research normalization must distinguish:

- all players/entities mentioned
- which sentence or claim refers to which player
- the type of claim
- whether the claim changes availability, role, opportunity, matchup, or another projection dimension

Example:

```text
"Player A is questionable. Player B is expected to start if A sits."
```

must produce at least:

```text
Player A → AVAILABILITY → QUESTIONABLE
Player B → ROLE/MINUTES → CONDITIONAL_UPSIDE_IF_A_OUT
```

The system should retain the source sentence/context with each normalized finding so engineering can inspect attribution errors.

---

## 3.11 Real-world quantities must reconcile to sport constraints

Where a sport has conserved or bounded quantities, the model must enforce or explicitly reconcile them.

### NBA/WNBA
- team minutes ≈240
- individual minutes within plausible bounds
- usage/opportunity redistribution should reconcile after absences

### NFL
- team targets reconcile with pass attempts
- carries reconcile with rushing attempts
- route/snap opportunity must be plausible relative to team volume
- TD events belong to coherent simulated game outcomes

### MLB
- batting order drives plausible PA totals
- pitcher innings and bullpen innings reconcile at the team/game level
- run production should come from coherent game environments

### Golf
- hole/round totals reconcile with remaining rounds and tournament format

These invariants should be encoded as automated assertions or validation warnings, not left to manual review.

---

## 3.12 Every exclusion and pruning decision must be observable

The engine must log why a player or lineup was not considered.

Examples:

### Player exclusion reasons
- confirmed OUT
- confirmed inactive
- not in contest player pool
- invalid/missing salary
- identity conflict
- unsupported position

### Candidate rejection reasons
- salary cap
- minimum-team rule
- roster-position conflict
- duplicate player
- exposure limit
- stack rule
- solver pruning
- candidate-budget cutoff

Silent exclusion is prohibited.

For optimizer debugging, engineering should be able to answer:

> "Why was Player X not in the selected lineup?"

with both:

1. whether lineups containing Player X were generated, and
2. why those lineups lost or were never considered.

---

## 3.13 Reproducibility is required for every generated lineup

Every production run must persist enough information to reproduce the result later.

At minimum store:

- run ID
- sport
- contest/slate ID
- contest type
- DraftKings roster/scoring rules snapshot
- player pool + salaries snapshot
- provider data snapshot/version/timestamps
- research findings + timestamps
- identity mappings
- resolved adjustments
- projection outputs
- projection/model version
- optimizer configuration
- solver version/configuration
- random seed(s)
- candidate count
- selected lineup(s)
- fallback states
- code/build version

A bad lineup that cannot be recreated is a debugging dead end.

Two runs with identical inputs, configuration, model version, and random seed must produce identical outputs.

---

## 3.14 Golden fixtures are mandatory before algorithm changes

Before modifying core scoring, adjustment, projection, or optimization logic, create small hand-verifiable fixtures that encode the expected behavior.

Required fixture categories:

### Scoring fixtures
Known stat line → exact DraftKings fantasy score.

### Availability fixtures
Known player status → exact eligibility result.

### Adjustment fixtures
Known evidence → exact resolved dimension change.

### Projection fixtures
Known projection inputs → exact or tolerance-bounded component outputs.

### Optimizer fixtures
Small player pool → brute-force known best lineup.

A fix is not accepted unless the new fixture would have failed on the old implementation.

---

## 3.15 Every remediation ticket requires a regression test

Definition of fixed:

> **The original failure can no longer occur without an automated test failing.**

Every PR tied to REM-001 through REM-028 must include:

1. a test demonstrating the previous failure
2. the implementation change
3. a test demonstrating the expected corrected behavior
4. any required fixture/data changes
5. a note describing whether historical outputs will change

Manual testing is supplementary, not sufficient.

---

## 3.16 Optimizer correctness must be proven on small slates

For synthetic/reference slates small enough to enumerate exhaustively:

1. generate **every legal lineup** independently
2. calculate the objective independently
3. identify the true optimum
4. run the production optimizer
5. assert that the returned optimum matches brute-force truth

This must be done for:

- Showdown
- Classic
- each materially different roster schema
- representative correlation/stack constraints

Do not infer optimizer correctness from a few plausible-looking production lineups.

For large slates where exhaustive truth is impossible, document the solver's optimality guarantee, optimality gap, timeout behavior, and fallback behavior.

---

## 3.17 Joint simulation must operate on coherent slate worlds

Once Gate 3 work begins, simulation must not consist of unrelated player dice rolls followed by lineup addition.

Each simulation iteration represents one possible version of the slate.

Shared events must drive related player outcomes:

- basketball pace/game script/team usage
- football game script/play volume/TD events
- baseball game environment/runs/stack outcomes
- golf weather/wave/course conditions

Lineup outcomes must then be calculated from those same iteration-level player outcomes.

Do not calculate lineup P90 by summing player P90s.

---

## 3.18 Selection may explain validated math; it may not repair it

Selection is downstream of Projection and Optimize.

Selection may:

- choose among validated candidates
- enforce portfolio preferences
- describe tradeoffs
- explain why one lineup was chosen over another

Selection may not:

- invent a replacement projection
- override broken scoring
- add unsupported upside because a lineup "looks good"
- reinterpret heuristic metrics as tournament EV
- compensate for a candidate-generation failure

If Projection or Optimize is degraded, Selection must surface the degraded state rather than hiding it with confident language.

---

## 3.19 Confidence labels must be evidence-based

`HIGH`, `MEDIUM`, and `LOW` confidence must have documented criteria.

Confidence should consider:

- provider completeness
- data freshness
- player identity certainty
- availability certainty
- sport-model coverage
- fallback usage
- projection calibration performance
- unresolved critical research findings

Confidence must not be based simply on whether the engine produced a lineup.

Run-level confidence should be aggregated from relevant player/stage risk, not automatically degraded by irrelevant deep-bench uncertainty.

---

## 3.20 Benchmark against simple baselines continuously

Complexity only earns its place if it improves results out of sample.

Every sport should continuously compare the production engine against simple reference approaches:

1. highest provider-FPPG legal lineup
2. highest unadjusted median projection lineup
3. salary/value optimizer
4. random legal lineup distribution

For projection modeling also compare new models against the model they replace.

If a more sophisticated model does not beat the simpler baseline on agreed holdout metrics, do not assume the sophistication is valuable. Investigate or revert.

---

## 3.21 Judge model progress with calibration and backtests, not anecdotal contest outcomes

DFS results are noisy. One winning lineup does not validate the engine, and one losing lineup does not invalidate an otherwise calibrated model.

During remediation, engineering should judge progress by the gate being worked:

### Gate 1
Judge:
- exact scoring
- correct eligibility
- deterministic transforms
- solver correctness

### Gate 2
Judge:
- projection MAE/RMSE/bias
- role/minutes/targets/PA error
- P20/P50/P90 calibration
- rank correlation

### Gate 3
Judge:
- ownership calibration
- covariance/correlation behavior
- field-simulation calibration
- duplicate prediction
- top-percentile/win-rate calibration
- out-of-sample contest EV/ROI where historical contest data supports it

Do not tune the model from isolated contest anecdotes.

---

## 3.22 Historical replay must prevent future-data leakage

Backtests must recreate what the engine could have known **before lineup lock**.

Do not include:

- post-lock injury confirmations
- final ownership published after lock
- results-aware projections
- corrected lineups that were unknown at decision time
- weather information that was not yet available

Every historical input should retain its source timestamp.

A backtest contaminated by post-lock information is invalid and must not be used to claim model improvement.

---

## 3.23 Changes must be evaluated sport-by-sport

A generic engine change can have different effects by sport.

Any change to:

- adjustment magnitude
- projection variance
- optimizer objective
- ownership logic
- candidate enumeration
- confidence handling

must be evaluated against each supported sport before being treated as globally safe.

Do not assume a change that improves NBA also improves MLB, NFL, or Golf.

Sport-specific tests and historical replay results should be attached to the change when applicable.

---

## 3.24 Do not introduce unbounded magic numbers

Heuristic constants must be:

- named
- documented
- unit-aware
- bounded
- covered by sensitivity tests where material

Examples include:

- adjustment magnitude weights
- correlation coefficients
- ownership penalties
- duplicate penalties
- candidate limits
- exposure limits

Avoid unexplained constants embedded in formulas.

For material optimizer/model coefficients, engineering should be able to answer:

> What happens if this value moves ±25%?

If the lineup rankings change dramatically, that parameter requires calibration and stronger documentation.

---

## 3.25 Do not silently catch quantitative failures and continue with plausible numbers

Error handling must distinguish between:

### Recoverable degradation
Example: one optional research feed unavailable.

### Quantitative integrity failure
Example:
- unknown DK scoring component
- impossible negative minutes
- projection NaN
- invalid salary
- duplicate roster assignment
- broken scoring-rule payload

Integrity failures must fail the affected stage/run loudly or quarantine the affected player, depending on the defined contract.

Returning a plausible-looking zero or fallback value is not acceptable when the engine cannot establish what the number means.

---

## 3.26 Observability must support stage-level diagnosis

Production telemetry should expose, at minimum:

### Per run
- stage durations
- stage status
- provider freshness
- fallback counts
- unmapped-player counts
- excluded-player counts by reason
- projection gap counts
- candidate count
- solver status / optimality gap
- selected lineup metric provenance

### Per player
- raw projection baseline
- resolved adjustments
- P20/P50/P90
- confidence
- eligibility status
- ownership source/state

### Post-slate
- projected vs actual score
- component-level miss
- role/opportunity miss
- lineup regret
- selection rank among generated candidates

The Learning Loop must be able to distinguish a **research miss**, **projection miss**, **solver miss**, and **selection miss**.

---

## 3.27 Code review expectations for remediation PRs

Every core-engine remediation PR should answer the following in its description:

1. **What trust failure does this fix?**
2. **What was the old behavior?**
3. **What is the new behavior?**
4. **Which sports/formats are affected?**
5. **What invariant or acceptance test proves correctness?**
6. **Does this change historical lineup output? Why?**
7. **Does this add/change a fallback?**
8. **Can the run still be reproduced?**
9. **What metrics should be watched after release?**

Reviewer approval should focus on quantitative behavior and contract integrity, not only code style.

---

## 3.28 Release discipline

Do not release major projection/optimizer changes directly to all sports at once.

Preferred rollout:

1. golden/unit tests
2. historical replay
3. shadow generation against current production
4. compare output + metrics
5. sport-specific limited release
6. post-release monitoring
7. expand only after acceptance thresholds hold

During shadow mode, store both old and new outputs so differences can be traced player-by-player and lineup-by-lineup.

If a new model cannot explain a large ranking change relative to the previous model, investigate before broad release.

---

## 3.29 Required artifacts for every engine run

For debugging and auditability, a completed engine run should be able to emit or reconstruct these artifacts:

1. **Slate Snapshot** — contest, roster, scoring rules, salaries, player pool.
2. **Availability Report** — player status, mapping confidence, exclusions and reasons.
3. **Research Packet** — normalized evidence by player/claim/source/timestamp.
4. **Adjustment Ledger** — every resolved dimension change with before/after values.
5. **Projection Table** — inputs, components, P20/P50/P90, confidence, model path/fallback.
6. **Candidate Report** — candidate count, rejection reasons, solver status, objective inputs.
7. **Selection Report** — selected lineup(s), rank, metric provenance, alternatives considered.
8. **Post-Slate Evaluation** — actual outcomes and stage-level error decomposition when results become available.

These can be machine-readable and need not all be user-facing, but engineering must be able to inspect them for any run.

---

## 3.30 Team Definition of Fixed

For this remediation program, a bug or modeling defect is **Fixed** only when all applicable items below are true:

- root cause is identified, not merely symptom-patched
- old failure is captured in an automated regression test
- new behavior passes the documented acceptance test
- stage contract is updated if semantics changed
- telemetry exposes the new behavior/failure state
- fallbacks are explicit
- historical replay impact is understood for material model changes
- sport-specific side effects have been checked
- run reproducibility is preserved
- user-facing metric/copy claims remain consistent with what is actually computed

If any of these are missing, the ticket should remain open or be explicitly split into follow-up work.

---

# 4. Master remediation backlog

| ID | Priority | Stage | Sports | Problem | Root cause | Required fix | Acceptance test |
|---|---|---|---|---|---|---|---|
| REM-001 | **P0** | Projection / Scoring | MLB | Hitter/pitcher projection components do not consistently map to DraftKings scoring-rule keys, causing valid projected stats to score as zero. | Projection component naming and DK scoring schema are not contract-validated. | Introduce a canonical DK scoring component schema. Map every projection output into exact DK categories before scoring. Remove silent `?? 0` behavior for unknown projection keys. | Golden stat-line tests for hitters/pitchers produce exact DK points. Any unknown scoring component fails the test/build rather than silently scoring zero. |
| REM-002 | **P0** | Projection / Scoring | NFL | Projection component names do not consistently match DK scoring categories (e.g. receptions/touchdowns variants), dropping fantasy production. | Same schema-contract problem as MLB. | Canonicalize NFL stat components and explicit TD categories. | Golden WR/RB/QB/TE stat-line fixtures exactly match DK points including receptions, passing/rushing/receiving TDs and fumbles. |
| REM-003 | **P0** | Slate / Scoring Rules | NFL | Fallback scoring rules conflict with the verified DK scoring table and omit yardage bonuses. | Duplicate hand-maintained scoring definitions drifted apart. | Derive fallback rules from one authoritative `DK_SCORING.nfl` source. | Live-rule path and fallback path return identical scores for a fixture suite including 300+ pass, 100+ rush, 100+ receiving bonuses and lost fumbles. |
| REM-004 | **P0** | Sport Adjustment → Projection | All | One adjustment factor multiplies every numeric projection input, compounding volume × rate dimensions. | `Object.entries(values).map(... value * factor)` applies indiscriminately. | Replace scalar adjustment with typed dimensions (`MINUTES`, `USAGE`, `PA`, `TARGET_SHARE`, etc.). Apply each finding only to the relevant field(s). | +8% MINUTES changes only expected minutes by +8%; derived fantasy points move according to the model, not ~+16.6%. Unit tests cover two-factor and three-factor formulas. |
| REM-005 | **P0** | Availability | All | OUT/inactive status can be treated as a large downgrade rather than a hard eligibility exclusion in some paths. | Availability and projection adjustment responsibilities are mixed. | Make confirmed OUT/INACTIVE a slate eligibility rule, not merely a projection nudge. | Confirmed OUT players are impossible to select in generated lineups. UNKNOWN players remain eligible with low certainty unless sport-specific rules explicitly require confirmation. |
| REM-006 | **P0** | Availability | MLB | Once confirmed lineups exist, UNKNOWN/UNMAPPED players can be silently removed despite not being confirmed out. | Allow-list filtering (`CONFIRMED_STARTER`/`ACTIVE`) plus incomplete provider/name mapping. | Keep UNKNOWN/UNMAPPED eligible with LOW role certainty. Remove only confirmed non-participants. Normalize suffixes/identity matching. | Fixture with DK `Player Jr.` and provider `Player` still maps correctly. Unmapped but not-out player remains in player pool with a visible warning. |
| REM-007 | **P0** | Research | All | A research article is attributed to the first matching player name; multi-player news can assign evidence to the wrong subject and omit the actual beneficiary. | First-substring-match normalization. | Extract all player entities; scope evidence to player-specific sentence/context; create separate findings per subject. | Article "A questionable; B starts if A sits" creates an availability finding for A and a role/opportunity finding for B. |
| REM-008 | **P0** | Adjustment | All | Injury/opportunity redistribution applies an identical small bump to every teammate. | Generic team-wide `REDISTRIBUTION` rule ignores role and vacated opportunity. | Redistribute by sport-specific role proximity and quantity of vacated opportunity. | Removing a high-minute PG or high-target WR materially increases likely direct beneficiaries and leaves irrelevant bench/role players near baseline. |
| REM-009 | **P0** | Adjustment / Projection | NBA/WNBA | Adjusted team minutes are not conserved around 240. | Every player's minutes are independently derived/adjusted. | Add a rotation reconciliation step after availability/adjustment: total expected team minutes ≈240, with explicit redistribution. | For every NBA/WNBA team, projected active-player minutes fall within an agreed tolerance around 240 and no player exceeds plausible limits without a flagged override. |
| REM-010 | **P0** | Projection | Golf | Golf's quantitative component model is effectively unused; required inputs are not populated and projection falls back to provider FPPG. | No Golf branch/provider populates birdie/eagle/bogey/round/finish inputs. | Build a real Golf projection input pipeline or explicitly disable claims of model parity until implemented. | At least 95% of playable golfers use the Golf component model rather than generic FPPG fallback; finish-position value is modeled where format requires it. |
| REM-011 | **P0** | Projection / Simulation | All | Generic random noise is used as a proxy for upside; lower certainty creates wider distributions and can make uncertainty look like ceiling. | Confidence controls noise width rather than representing epistemic uncertainty separately from performance variance. | Separate **performance variance** from **model confidence**. Build sport-shaped outcome distributions. Confidence should affect trust/range reporting, not mechanically improve tournament ceiling. | Two players with identical expected performance but different data confidence do not receive a higher P90 solely because one has worse information. |
| REM-012 | **P0** | Optimize | All | Lineup P20/P50/P90 are computed by summing player percentiles instead of percentiles of simulated lineup totals. | Independent player quantiles are aggregated directly. | Generate sample-level player outcomes per simulation, sum lineup outcome each simulation, then compute lineup quantiles. | Synthetic fixture with known distributions matches analytic/Monte Carlo lineup P20/P50/P90 within tolerance. Sum-of-player-P90 implementation is removed. |
| REM-013 | **P0** | Optimize | All | Candidate generation stops after `maxCandidates * 4` legal builds and can omit the real optimum. | Truncated value-sorted DFS traversal. | Showdown: exhaustive enumeration where feasible. Classic: MILP/CP-SAT/branch-and-bound or a provably ordered search, plus strategy-specific candidate pools. | On small slates, engine optimum exactly matches brute force. On production-size regression slates, candidate coverage and objective optimum meet agreed solver tolerances. |
| REM-014 | **P0** | Optimize | All | Correlation is a tiny additive heuristic and is not represented in actual lineup score distributions. | Pair-correlation bonus is mixed with raw FP objective on incompatible scales. | Move correlation into joint outcome simulation. Use explicit strategic constraints/templates where appropriate. | QB-pass catcher, opposing run-back, MLB stack, and negative-correlation combinations exhibit expected covariance in simulated lineup outcomes. |
| REM-015 | **P1** | Optimize | All | `optimalLineupFrequency` and `topOnePercentFrequency` are assigned the deterministic objective score. | Placeholder fields are presented as simulated metrics. | Immediately rename/hide. Later compute from repeated joint slate + field simulations. | Frequency fields are bounded 0–1, differ from each other, and equal observed frequencies from simulations. |
| REM-016 | **P1** | Optimize | All | Ownership/leverage is a salary/value proxy, not field ownership. | No real ownership model/provider. | Build or ingest projected ownership by player and roster slot; calibrate by contest type. | Historical ownership backtest meets sport/format MAE target; CPT ownership separately validated for Showdown. |
| REM-017 | **P1** | Optimize | All | `duplicationPenalty` is configured but not applied; `estimatedDuplicates` is not contest-size aware. | Incomplete objective implementation. | Build lineup duplication model based on player ownership, roster-slot ownership, salary left, construction tendencies, and contest field size. | On historical contests, predicted duplication buckets correlate with actual duplicated lineup counts; objective changes when duplication penalty changes. |
| REM-018 | **P1** | Optimize | All | Objective mixes raw fantasy points with 0–1 heuristic features, making leverage/correlation nearly irrelevant. | Incompatible feature scales. | Normalize objective terms or optimize directly for simulated expected payout/ROI. | Sensitivity test shows each configured term moves rank by the intended magnitude; payout-EV mode can prefer a lower-median lineup when it has better simulated contest value. |
| REM-019 | **P1** | Sport Adjustment | All | Deterministic + AI adjustment can double-count the same evidence. | AI appends signed adjustments instead of refining/replacing baseline interpretation. | Deduplicate by `(player, evidence, dimension)` and make AI an override/refinement layer. | Same evidence cannot increase net magnitude twice. Audit log shows one resolved interpretation per player/evidence/dimension. |
| REM-020 | **P1** | Selection | All | Selection labels/ranks candidates using pseudo tournament metrics and can express false confidence. | Selection trusts optimizer field names instead of validated metric provenance. | Add metric provenance/quality gates. Do not expose `BEST_TOURNAMENT_EV` until contest EV exists. | Selection refuses/renames tournament claims when field simulation is unavailable; user-facing rationale cites actual metric types. |
| REM-021 | **P1** | NBA/WNBA Projection | NBA/WNBA | Baseline is largely season-average minutes/rates rather than slate-specific rotation and role. | Projection input derivation lacks enough current rotation/context modeling. | Build rotation/minutes model, starter status, usage redistribution, on/off role, closing role and matchup adjustments. | Historical pre-lock backtests show improved minutes MAE and fantasy-point calibration vs season-average baseline. |
| REM-022 | **P1** | MLB Projection | MLB | Model lacks adequate batting order, handedness, pitcher matchup, park/weather, bullpen and stack/game-environment modeling. | Season-based inputs dominate; contextual components incomplete. | Build PA model and run-environment model; integrate order, platoon, opposing pitcher/bullpen, park/weather. | Historical hitter/pitcher projection MAE/calibration improves vs baseline; stack outcomes are jointly simulated. |
| REM-023 | **P1** | NFL Projection | NFL | Model lacks sufficient game-script, opportunity and TD distribution detail. | Generic expected-value formulas do not jointly allocate team play volume/targets/carries/TDs. | Simulate plays/game script, pass/rush split, targets/carries, catch/yards distributions, TD events. | Team targets/carries/TDs reconcile within simulated games and player outcome correlations match expected football structure. |
| REM-024 | **P1** | Golf Projection | Golf | No strokes-gained / course / wave model. | Data-source and modeling gap. | Integrate SG:T2G/APP/OTT/PUTT or equivalent skill inputs, course-fit, weather-wave, finish/cut distribution. | Backtest ranks and score distributions outperform provider-FPPG baseline over historical events. |
| REM-025 | **P2** | Research / Status | All | Research status cascades to PARTIAL too easily, potentially making healthy slates look degraded. | Any missing availability finding can become critical. | Separate player-level uncertainty from run-level trust status; severity-weight by player relevance. | A deep bench unknown does not mark the whole run equivalent to a star with unresolved availability. |
| REM-026 | **P2** | Optimize | Classic | Early pruning contains hard-coded assumptions for six-slot Showdown. | Optimization helpers are not roster-format generalized. | Parameterize pruning by roster schema. | Same pruning invariants work across supported Classic/Showdown roster sizes; candidate coverage does not degrade due to Showdown-specific assumptions. |
| REM-027 | **P2** | Learning | All | Learning loop mainly calibrates cash-line probability and does not diagnose player projection or lineup-selection error. | Outcome feedback is not decomposed by stage. | Store prediction vs actual at player, component, lineup and contest level; calibrate sport models and selection separately. | Post-slate report identifies whether miss came from minutes/usage, scoring, ownership, correlation, candidate search or selection and feeds model recalibration. |
| REM-028 | **P2** | Runtime / Orchestration | All | `server/runtime.ts` and parity tests were missing from the reviewed archive, leaving production ordering/provider freshness/retry behavior unverified. | Audit scope gap. | Audit runtime when source is available; add explicit engine parity/integration tests. | One integration test exercises Slate → Research → Adjustment → Projection → Optimize → Selection using production orchestration and asserts stage contracts. |

---

# 5. Execution gates

## Gate 0 — Freeze misleading claims immediately

This can happen before major engineering work.

**Required:**
- Rename/hide `optimalLineupFrequency` and `topOnePercentFrequency`.
- Remove or relabel `BEST_TOURNAMENT_EV`.
- Stop presenting heuristic ownership/duplication as measured field behavior.
- Add a visible engine state such as `MODEL_VALIDATION_REQUIRED` for sports that have not passed Gate 1.
- Golf should be explicitly marked fallback-only until its quantitative model is populated.

**Exit criterion:** UI no longer claims simulation rigor that the engine has not computed.

---

## Gate 1 — Mechanical correctness

**Goal:** Given known inputs, the engine must produce the correct eligible player pool and exact DraftKings fantasy scoring.

### Must close
- REM-001 MLB scoring contract
- REM-002 NFL scoring contract
- REM-003 NFL fallback rules
- REM-004 typed adjustment application
- REM-005 hard OUT/inactive eligibility
- REM-006 MLB unknown/unmapped eligibility
- REM-007 research subject attribution
- REM-008 role-specific redistribution
- REM-009 NBA/WNBA 240-minute reconciliation
- REM-010 Golf fallback transparency/model path
- REM-012 lineup percentile construction
- REM-013 candidate search correctness on reference slates

### Required test suite

#### A. DraftKings scoring golden tests
For each supported sport, maintain 20–50 known stat-line fixtures with exact expected DK scores.

Test:
- normal stat lines
- bonuses
- negative scoring
- showdown CPT scaling where applicable
- fallback scoring rules
- unknown stat component fails loudly

**Pass requirement: 100%.**

#### B. Availability golden tests
Cases:
- ACTIVE
- CONFIRMED_STARTER
- OUT
- INACTIVE
- UNKNOWN
- UNMAPPED
- suffix/name variations

**Pass requirement:** no confirmed OUT player can be generated; no unknown player is silently deleted unless format rules require confirmation.

#### C. Adjustment unit tests
Examples:
- +8% MINUTES affects minutes only.
- +8% TARGET_SHARE does not also increase catch rate and yards/target.
- One evidence item can produce one resolved effect per dimension.

#### D. Optimizer exactness tests
Small synthetic slates are brute-forced independently.

**Pass requirement:** generated #1 objective lineup exactly matches brute-force optimum for every reference slate.

### Gate 1 exit criterion
**No open scoring, eligibility, compounding, or search-correctness defect.**

Only after this gate should we judge lineup quality competitively.

---

# 6. Gate 2 — Sport projection integrity

**Goal:** P50 and distribution shape must represent the sport rather than generic season averages + noise.

## NBA / WNBA

### Required model contract

`Availability → Rotation → Minutes → Usage/Role → Per-minute production → Correlated game outcomes`

Must include:
- active rotation
- starters
- expected minutes distribution
- 240-minute team conservation
- usage redistribution
- ball-handling/assist redistribution
- rebound opportunity changes
- blowout/close-game minutes scenarios
- teammate covariance

### Core acceptance metrics
- minutes MAE
- fantasy-point MAE
- P20/P50/P90 calibration
- coverage: actual result below P20 ≈20%, below P50 ≈50%, below P90 ≈90% over a sufficiently large holdout

---

## MLB

### Required model contract

`Confirmed lineup → Batting order → PA → Batter/Pitcher matchup → Park/weather/run environment → Bullpen → Correlated team outcomes`

Must include:
- order-based plate appearances
- handedness/platoon
- opposing starter quality
- bullpen expectation
- park factor
- weather where relevant
- strikeout/walk/power rates
- pitcher innings/strikeout/win/ER distribution
- hitter stack covariance

### Core acceptance metrics
- hitter/pitcher FP MAE
- PA error
- K projection error
- HR/run distribution calibration
- stack outcome covariance

---

## NFL

### Required model contract

`Game script → Plays → Pass/rush split → Snaps/routes/carries/targets → Efficiency → TD events → Correlated player outcomes`

Must include:
- team play volume
- pass/rush split
- player target/carry shares
- catch/yards distributions
- touchdown probabilities/events
- QB/pass-catcher covariance
- opposing bring-back/game-total covariance
- bonus thresholds

### Core acceptance metrics
- target/carry MAE
- QB/WR/RB/TE FP MAE
- TD calibration
- correlation sanity checks
- bonus hit-rate calibration

---

## Golf

### Required model contract

`Player skill → Course fit → Weather/wave → Hole/round scoring → Cut/finish distribution → DK scoring`

Must include:
- strokes-gained or equivalent player skill
- birdie/eagle/bogey probabilities
- course characteristics
- weather/wave
- cut probability for Classic formats
- finishing position distribution/bonus where applicable

### Core acceptance metrics
- DK scoring MAE
- top-10/top-20/finish calibration
- cut probability Brier/log loss
- showdown round-score calibration

---

# 7. Gate 3 — Real tournament optimization

**Goal:** Optimize for contest outcomes, not a deterministic weighted projection score with heuristic labels.

## 7.1 Joint slate simulation

Each simulation iteration must produce a coherent slate world:

```text
Simulation 1
  Game A script/outcomes
  Game B script/outcomes
  ...
  Player scores
  Candidate lineup scores

Simulation 2
  ...
```

Then compute per-lineup:
- P20/P50/P90 from lineup totals
- variance
- win frequency
- top-1% frequency
- cash frequency

## 7.2 Field model

Build simulated field lineups using:
- projected player ownership
- roster-slot ownership
- salary usage tendencies
- stack/construction tendencies
- contest type
- entry count

## 7.3 Duplication model

Estimate expected duplicate count based on lineup construction and field size.

Do not use `ownershipEstimate * 100`.

## 7.4 Payout / tournament EV

For each candidate:

```text
EV = mean(simulated payout after ties / duplication) - entry fee
ROI = EV / entry fee
```

Then Selection can legitimately choose between:
- highest median
- highest win probability
- highest top-1% probability
- highest expected ROI
- lower-duplication alternate

## 7.5 Portfolio optimization

For multi-entry contests, optimize the portfolio jointly:
- exposure limits
- lineup covariance
- game-script diversity
- uniqueness
- aggregate expected payout

Avoid selecting N individually good but strategically redundant lineups.

---

# 8. Required validation harness before trusting output

## 8.1 Historical replay dataset

For each sport, collect historical slates containing only information that was available **before lock**:
- DK salaries/roster rules
- active/availability state
- news/research timestamped pre-lock
- projection-provider data available at the time
- contest field/ownership if available
- actual player outcomes
- actual contest results if available

Never backtest with post-lock information leaking into projections.

## 8.2 Player projection evaluation

For each player:

| Metric | Why |
|---|---|
| MAE / RMSE | Basic projection accuracy |
| Bias | Detect systematic over/under projection |
| P20/P50/P90 coverage | Validate distribution calibration |
| Role/minutes/targets/PA error | Diagnose why fantasy projection missed |
| Rank correlation | Tests whether relative player ordering is useful for DFS |

## 8.3 Lineup evaluation

For every historical slate generate lineups exactly as production would have generated them.

Track:
- generated lineup actual score
- percentile rank in legal/generated universe when calculable
- cash rate
- top 10% / top 1% rate
- difference from actual optimal lineup
- regret: `optimal actual score - generated actual score`
- salary used
- ownership/duplication where known

## 8.4 Baseline comparisons

The engine should beat simple baselines before being called useful:

1. highest provider-FPPG legal lineup
2. highest season-average projection lineup
3. random salary-valid lineup
4. simple value optimizer

If the full engine cannot beat these consistently out-of-sample, advanced layers should not be trusted.

---

# 9. Sport trust scorecard

Use a binary gate plus measured score, not subjective confidence.

| Dimension | NBA/WNBA | MLB | NFL | Golf |
|---|---:|---:|---:|---:|
| Exact DK scoring validated | ☐ | ☐ | ☐ | ☐ |
| Eligibility validated | ☐ | ☐ | ☐ | ☐ |
| Sport adjustment typed | ☐ | ☐ | ☐ | ☐ |
| Sport-specific projection | ☐ | ☐ | ☐ | ☐ |
| Distribution calibrated | ☐ | ☐ | ☐ | ☐ |
| Joint correlation validated | ☐ | ☐ | ☐ | ☐ |
| Optimizer exactness/reference tests | ☐ | ☐ | ☐ | ☐ |
| Ownership calibrated | ☐ | ☐ | ☐ | ☐ |
| Field/duplication simulation | ☐ | ☐ | ☐ | ☐ |
| Historical lineup backtest beats baseline | ☐ | ☐ | ☐ | ☐ |

### Proposed trust labels

- **RED — Not Trusted:** any Gate 1 failure.
- **YELLOW — Projection Validated:** Gate 1 passed + sport projection meets minimum backtest standards, but contest/field simulation incomplete.
- **GREEN — Contest Validated:** Gate 1–3 passed and historical out-of-sample lineups beat agreed baselines.

Current recommendation based on the reviewed implementation:

- **NBA/WNBA: RED** — scoring foundation is comparatively better, but adjustment, redistribution, minutes conservation, percentile construction, search and tournament metrics are not trustworthy.
- **MLB: RED** — scoring mapping + availability/pool + projection-context issues.
- **NFL: RED** — scoring mapping + fallback scoring + projection/simulation issues.
- **Golf: RED** — sport-specific quantitative model is effectively not populated.

---

# 10. Recommended engineering sequence

## Sprint A — Stop wrong math

1. REM-001 MLB scoring
2. REM-002 NFL scoring
3. REM-003 NFL fallback rules
4. REM-004 typed adjustments
5. REM-005 confirmed OUT handling
6. Add scoring + adjustment golden tests

**Do not proceed based on visual inspection. These tickets close only with automated fixtures.**

## Sprint B — Fix player pool and opportunity logic

7. REM-006 MLB unknown/unmapped filtering
8. REM-007 multi-player research attribution
9. REM-008 role-aware redistribution
10. REM-009 NBA/WNBA 240-minute reconciliation
11. REM-019 evidence deduplication

## Sprint C — Fix lineup mathematics/search

12. REM-012 lineup-level distributions
13. REM-013 optimizer search correctness
14. REM-014 correlation inside simulation
15. Remove/rename pseudo frequencies until Gate 3

At the end of Sprint C, rerun historical lineup backtests before adding more optimizer complexity.

## Sprint D — Sport models

Recommended order based on current implementation maturity:

1. **NBA/WNBA** — closest foundation; build real rotation/minutes/usage model first.
2. **NFL** — repair scoring, then game-script/opportunity model.
3. **MLB** — repair scoring/pool, then PA/run-environment/stack model.
4. **Golf** — requires a genuine quantitative data/model build rather than incremental tuning.

## Sprint E — Contest model

16. ownership
17. joint field simulation
18. duplication
19. payout EV
20. portfolio optimization
21. restore validated tournament labels/metrics

## Sprint F — Learning loop

22. decompose post-slate error by engine stage
23. calibrate sport models
24. calibrate ownership/field models
25. selection policy evaluation

---

# 11. Definition of done for a trustworthy lineup engine

A sport is **not ready** because the app generated a legal lineup or because one slate performed well.

A sport becomes trustworthy only when all of the following are true:

1. DraftKings scoring fixtures pass 100%.
2. Confirmed inactive players cannot enter a lineup.
3. Unknown/unmapped status does not silently corrupt the pool.
4. Every research adjustment has a traceable player, evidence source and adjustment dimension.
5. Opportunity totals reconcile to the sport's constraints where applicable.
6. Projection distributions are empirically calibrated on historical holdout slates.
7. Lineup percentiles come from lineup-level simulated outcomes.
8. Small-slate optimizer results match brute-force truth.
9. Large-slate search has documented solver guarantees/tolerances.
10. Correlated outcomes are represented in simulation, not just an additive heuristic.
11. Tournament frequency fields come from actual simulated frequencies.
12. Ownership and duplication are measured/calibrated or clearly marked unavailable.
13. Historical production-style lineup replay beats the agreed simple baseline out of sample.
14. The Selection layer only claims what the underlying metrics actually establish.

---

# 12. Architecture changes implied by the remediation

The high-level engine remains valid:

```text
Slate
  ↓
Research
  ↓
Sport Adjustment
  ↓
Projection
  ↓
Optimize
  ↓
Selection
  ↓
Learning Loop
```

The contracts need to become stricter.

## Research output

```text
EvidenceFinding {
  evidenceId
  subjectPlayerId(s)
  sportDimension
  sourceTimestamp
  sourceReliability
  findingType
  rationale
}
```

## Sport Adjustment output

Replace one signed magnitude with structured opportunity/rate changes:

```text
AdjustedOpportunity {
  minutesDelta
  usageDelta
  targetShareDelta
  carryShareDelta
  plateAppearanceDelta
  battingOrder
  matchupEfficiencyDelta
  roleCertainty
  evidenceIds[]
}
```

Not every field applies to every sport.

## Projection output

```text
PlayerProjection {
  expectedComponents
  simulatedSamples / distribution parameters
  p20
  p50
  p90
  confidence
  modelVersion
  dataTimestamp
}
```

**Confidence and performance variance must be separate concepts.**

## Optimize output

Until Gate 3:

```text
CandidateLineup {
  medianProjection
  lineupP20
  lineupP90
  strategyTags
  objectiveScore
}
```

After Gate 3:

```text
CandidateLineup {
  winFrequency
  topOnePercentFrequency
  cashFrequency
  expectedDuplicates
  expectedPayout
  expectedROI
  ...
}
```

---

# 13. Product/leadership summary

If this needs to be communicated simply:

> **The engine is currently optimizing before it has proven the numbers being optimized are correct.**

The remediation is not "make the AI smarter." It is:

1. **Make scoring and eligibility mechanically correct.**
2. **Make each sport's player projection model reflect how that sport actually produces fantasy points.**
3. **Simulate lineups and contests jointly instead of using heuristic labels.**
4. **Only then let Selection recommend the best lineup.**

The architecture does not need to be abandoned. The implementation inside Research, Sport Adjustment, Projection and Optimize needs to be made quantitatively honest and testable.

---

# 14. Immediate next engineering tickets

If only five tickets are opened first, open these:

1. **Canonical DK scoring contract + MLB/NFL golden tests** — REM-001/002/003.
2. **Replace global Sport Adjustment multiplier with typed field adjustments** — REM-004.
3. **Correct availability/player-pool eligibility semantics** — REM-005/006.
4. **Compute lineup percentiles from lineup simulation totals** — REM-012.
5. **Replace truncated DFS with a correctness-verifiable optimizer path** — REM-013.

These five remove the highest-risk mechanisms by which the engine can confidently select a bad lineup.
