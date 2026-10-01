# Lineup quality: root cause analysis and engineering execution plan

**Audit date:** September 30, 2026  
**Scope:** DraftKings MLB, NFL, WNBA, college football (CFB), and golf; each actually supported contest format, including Showdown variants.  
**Status:** Execution in progress. See [implementation progress](#9-implementation-progress-and-release-gates) for completed local work and remaining verification gates. Checklist items remain open until their stated acceptance evidence exists.
**Primary product objective:** Select legal lineups with the highest modeled expected DraftKings points by default, with explicit, separately validated objectives for cash probability or tournament returns.

## 1. Executive assessment

The current implementation cannot yet support a claim that its recommendations are the best researched, highest expected scoring legal lineups. The problem spans the complete decision pipeline: contest rules and identity, missing or weak opportunity inputs, incomplete contextual research, provisional simulations, limited candidate search, objective changes during selection, and insufficient historical validation. Adding more news to a prompt will not resolve these defects.

The most urgent changes are:

1. Verify the exact contest rules and distinguish a real athlete from their DraftKings roster-slot entries, especially Captain and Utility.
2. Replace permissive missing-data handling with explicit coverage and freshness gates. Missing information must not silently become zero, a healthy status, or a complete projection.
3. Preserve one numerical objective from the user's request through the solver and final selection. Remove unrestricted language-model authority to replace the numerically selected lineup.
4. Replace early-terminated enumeration with a solver that reports whether it found the optimum or a measurable bound.
5. Model current playing opportunity and coherent sport outcomes, then validate against predictions and outcomes captured at the correct historical cutoff.

### 1.1 What this audit establishes

This is a source-level audit of the local working tree, including existing uncommitted changes. It covers ingestion, availability, research, adjustments, projections, optimization, selection, persistence, pre-lock rechecking, results, learning helpers, and the existing plan/tests. It is not a deployed-environment certification.

The reported WNBA score in the 80s versus a winning score around 120–130 is a user-reported incident. No exact contest ID, generation-run ID, lock-time snapshot, submitted lineup, or final scoring export was supplied for that incident. This audit identifies defects capable of harming lineups; it does **not** establish which defect caused that specific result or how many points each defect cost. Phase 0 specifies how to answer that question reproducibly.

Local checks executed during this audit:

| Check | Result | What it establishes |
| --- | --- | --- |
| `npm run test:parity` | Passed during implementation | Focused regression assertions pass; they do not establish production provider access or forecasting performance. |
| `npm run check:server` | Passed during implementation | Server TypeScript compiles; correctness, production provider access, and lineup quality remain unproven. |
| `npm run build` | Passed during implementation | Production bundle builds; local Node 20.13.0 is below Vite's recommended 20.19+ minimum. |
| `npm run lint` | Passed during implementation | Oxlint reports no issues. |
| Historical incident replay / production parity | Not performed | Requires archived inputs and deployment/run identification. |
| Current sport-specific DraftKings rule verification | Incomplete | Public rules pages did not expose usable full sport rules through the research tool. Do not replace unknown rules with guessed templates. |

Existing work worth retaining includes sport adapters, typed adjustments, availability exclusions, scoring utilities, projection samples, candidate validation, evidence storage, recheck endpoints, metric provenance, and learning helpers. Each needs end-to-end acceptance evidence before being marked complete.

This document extends and resolves conflicting assumptions in [the five-sport plan](five-sport-lineup-confidence-implementation-plan.md) and [the remediation master plan](lineup-engine-remediation-master-plan.md). Those documents are background; neither their status labels nor passing parity tests supersede the gates here. In particular, the default user objective must not be changed to a tournament composite by a selection-stage comment or heuristic.

### 1.2 Define “best” before optimizing

| Objective | Quantity optimized | Required evidence |
| --- | --- | --- |
| `MAX_EXPECTED_POINTS` — default for this request | Expected sum of official slot-adjusted fantasy scores | Valid rules, reliable player means, complete legal search or measured solver bound. Ownership is not required. |
| `MAX_CASH_PROBABILITY` | Probability of reaching the contest's paying ranks | Valid joint outcome model and credible contest-field/cutoff model. A manually supplied score threshold must be labeled a threshold scenario. |
| `MAX_EXPECTED_NET_PAYOUT` | Expected payout minus entry cost | Joint outcomes, independently modeled legal field, ownership/entry behavior, exact payouts, duplicate/tie treatment, fees. |
| `MAX_FIRST_PLACE_PROBABILITY` | Probability of first-place finish under stated tie semantics | Same field requirements, adequate rare-event simulation and uncertainty reporting. |

The mode is an immutable run input. Mean, median, ceiling, probability of winning, and expected profit are different quantities. A weighted median/ceiling score is not expected points. The highest realized lineup is known only after the event; it is useful for diagnosis, not a promise the model can make before lock. Judge improvement over many comparable slates, not a universal 120/130-point target.

## 2. Root cause register

**Evidence labels:** “Confirmed” means visible in the audited implementation; “conditional consequence” means the damaging outcome depends on inputs or execution path; “hypothesis” requires incident/historical evidence. Severity describes remediation urgency, not an attribution of the reported loss.

| ID / priority | Finding and evidence | Consequence / evidence limit | Delivery phases |
| --- | --- | --- | --- |
| R01 / P0 | **Confirmed:** `fallbackRules` in `src/lib/engine/draftKings.ts` supplies static templates: WNBA copies the NBA positional template, CFB copies NFL including TE/DST, and all Showdown formats use CPT + five UTIL. `mapRosterRules` in `draftKingsSlate.ts` also generalizes Showdown. | An exact game-type rule contract is not established. Golf round formats and sport-specific variants cannot safely inherit a generic Captain template. Actual affected contests require authoritative fixtures. | 1, 2, 7 |
| R02 / P0 | **Confirmed:** CSV parsing uses DraftKings row IDs as player identity; `mapDraftables` merges on that identity, marks Showdown rows broadly eligible, and derives Captain/Utility salary fields. | **Conditional:** separate CPT/UTIL IDs can be treated as different athletes, permit duplicate athletes, and misinterpret already multiplied salary/FPPG. Prove against real paired-row fixtures. | 2 |
| R03 / P0 | **Confirmed:** CSV `AvgPointsPerGame` coercion can convert an empty cell to zero; malformed rows are skipped. Fallback source records describe derived rules as verified despite the CSV not supplying them. | A sparse or damaged pool can appear usable, zero-value players can appear modeled, and provenance overstates verification. | 1–3 |
| R04 / P0 | **Confirmed:** `getSlateBundleForDraftGroup` constructs contest metadata using request values. `api/generation-runs.ts` creates `draftKingsClient()` without sport codes before a missing-ID `listContests(sport)` lookup. | Contest/group/sport/format binding and payout facts are not reliably authoritative; the missing-group recovery path can fail independently of a 403. | 2, 3 |
| R05 / P0 | **Confirmed:** `validateLineupCandidate` checks slot count and supplied salary, but not the exact slot multiset, recalculated salary, or equality of `playerIds` and roster assignments. `assertSelection` primarily checks candidate IDs. | Malformed assignments, underreported salaries, and identity errors can survive a nominal validation pass. | 2, 9 |
| R06 / P0 | **Confirmed:** `projectionReadiness`/`projectSlate` accept finite FPPG as fallback; non-golf fallbacks may have no corresponding blocking gap. `projectionInputs.ts` derives season rates and defaults several absent statistics to zero. | Historical average can stand in for current opportunity and matchup. Missing is conflated with observed zero. Exact production frequency must be measured. | 1, 3, 5–7 |
| R07 / P0 | **Confirmed:** `reconcileBasketballMinutes` scales every projected player on a team using the sum of available structured minutes, including fallback players and players excluded later. It rescales scores after sampling. | **Conditional:** incomplete rotations inflate minutes; mixed fallback inputs create nonfinite opportunity fields; unavailable players consume minutes; discrete bonuses are rescaled incorrectly. Particularly relevant to WNBA diagnosis. | 5, 6A |
| R08 / P0 | **Confirmed:** `optimizer.ts` switches from exhaustive enumeration to depth-first search limited to `maxCandidates * 4` accepted lineups, normally 2,000; maximum stored candidates normally 500. | Input ordering and early slot/Captain choices can determine which lineups are never searched. No numeric bound proves proximity to optimum. `evidenceLedger.ts` nevertheless maps BOUNDED to GAP_BOUNDED. | 1, 8 |
| R09 / P0 | **Confirmed:** max-fpts weights median, not mean; `selection.ts:rankForContext` chooses cash/contest/heuristic rankings without preserving an explicit max-points objective. `runtime.ts` may replace deterministic selection using OpenAI/Anthropic. | The final result need not maximize the user's requested quantity even within the searched candidates. AI selection has no numerical non-regression constraint or full portfolio revalidation. | 1, 8, 9 |
| R10 / P1 | **Confirmed:** `webResearchProvider.ts` searches one combined query including only the first eight players, gets a small result set, and Firecrawl processes at most two discovered pages. Research-plan questions are not systematically executed. | News coverage depends on pool ordering and retrieval limits. Important injuries, transactions, weather, or rotations may never be checked. | 3, 4 |
| R11 / P1 | **Confirmed:** evidence resolution in `server/evidenceLedger.ts` is persisted after selection. Editorial fact keys incorporate sentence hashes; coarse adjustment magnitudes and evidence counts influence confidence. | Resolution is an audit side effect rather than the mandatory source of model inputs. Syndication, contradictions, and unsupported specificity can affect adjustments. | 4, 5 |
| R12 / P1 | **Confirmed:** availability uses text regexes; phrases such as “not ruled out” can match OUT rules. Injury redistribution uses positional neighbors. Several declared adjustment categories have no `adjustmentFields` mapping; context application can overwrite adjusted inputs. | Wrong status, arbitrary opportunity redistribution, or a cited adjustment with no numerical effect. A QB absence must not automatically improve receivers. | 4, 5, 6C |
| R13 / P1 | **Confirmed:** projections use 256 provisional samples; FPPG fallback uses a narrow uniform range. Sport samples are not a fully reconciled joint game process; player seeds omit event identity. | Intervals and lineup tails are not empirically calibrated. Summing aligned sample indexes does not itself establish correct correlations. | 5–7 |
| R14 / P1 | **Confirmed:** football readiness/model branches distinguish QB from generic skill players, without complete K/DST opportunity branches. MLB rare scoring events remain incomplete; Golf depends on a supplied finish-position value and lacks a full finish/cut process. | Legal player classes or scoring components may be omitted/misvalued. A blocked Golf path is not a completed Golf model. | 6B–6E, 7 |
| R15 / P1 | **Confirmed:** `contestSimulation.ts` resamples optimizer candidates as the field, caps field entries at 10,000 without correspondingly representing larger actual ranks, and has duplicate/tie payout arithmetic that divides tied prizes again by duplicate count. | Tournament probability and ROI may be systematically wrong when this path is enabled. Missing ownership can make the path unavailable; do not assume it caused a particular incident. | 10 |
| R16 / P1 | **Confirmed:** recheck reruns research against a saved slate rather than the complete fresh ingestion→projection→optimization path. | A correct recheck alert does not ensure the lineup reflects the latest inactives, scratches, salaries, event changes, or roles. | 11 |
| R17 / P1 | **Confirmed:** result entry computes and writes raw cash-line probability using the subsequently recorded actual cash line. Learning loads saved probabilities. | Pre-lock forecast evaluation can be contaminated by post-outcome information. Separate retrospective threshold analysis from archived forecasts. | 12 |
| R18 / P1 | **Confirmed:** `package.json` references import scripts absent from `scripts/`; no verified five-sport as-of replay corpus or release evidence was established. | “Learning” utilities do not prove that production learns accurately or improves. Operational actuals ingestion/replay remains necessary. | 0, 12, 13 |
| R19 / P1 | **Confirmed:** `learningMetrics.ts:quantileCoverage` defines p50 coverage as being within 10% of the median, and p20 as an upper-tail exceedance; these are not a consistent quantile calibration calculation. | Reporting can suggest calibration without measuring the stated quantity. Quantiles need a documented convention and discrete-outcome handling. | 12 |

### 2.1 Incident hypotheses to test, not assert

- WNBA: a missed rotation/minutes change, partial-team minutes scaling, incorrect Captain identity/salary, poor Captain search coverage, or selection-stage objective override.
- MLB: season-average opportunity, missing batting-order confirmation, incorrectly modeled starter workload, park/weather/platoon omissions, or missing legal stacks in the searched candidates.
- NFL: missing current role/usage, incorrect active/depth-chart interpretation, absent K/DST modeling in applicable formats, incoherent QB/receiver outcomes, or truncated search.
- All sports: production may differ from the local working tree; a low actual score may also occur from ordinary outcome variance despite a reasonable pre-lock decision.

## 3. Target decision pipeline and contracts

```text
Verified contest / rules / salaries / canonical identity
  → immutable timestamped source observations
  → resolved facts, uncertainty scenarios, coverage gates
  → sport opportunity and rate models
  → coherent scoring worlds + player expected points
  → legal solver preserving the chosen objective
  → deterministic selection + independently checked export
  → evidence-linked explanation and fresh pre-lock version
  → reconciled outcomes, as-of replay, calibration, controlled promotion
```

Implement runtime schemas at each boundary; TypeScript alone does not validate provider or model output. Version these contracts and persist their hashes:

| Contract | Required fields / semantics |
| --- | --- |
| `ContestSnapshot` | Provider contest ID, draft group, sport, exact gameTypeId/variant, event IDs, timezone-aware locks, late-swap policy, entry constraints, verified rules/scoring hash, optional verified fee/field/payouts, source and retrieval times. |
| `AthleteIdentity` / `SlotOffer` | Canonical athlete/entity ID, provider crosswalks, effective team membership interval; separate DK draftable ID, legal slot, exact slot salary, point multiplier. DST is a team entity. Export IDs remain provider IDs. |
| `Observation` | Source/record/URL, raw payload reference/hash, entity/event/fact key, units/value, published/effective/retrieved/expiry times, confirmed/reported/projected status, identity confidence, correction/supersession links. |
| `ResolvedFact` | Accepted observation IDs, rejected/conflicting IDs with reasons, resolution policy version, effective value or conditional scenarios, freshness and coverage state. |
| `ProjectionInput` | Opportunity, efficiency, uncertainty distributions, units, source fact IDs, baseline→change→final values, model version and missingness. |
| `ProjectionDistribution` | Mean explicitly separate from p20/p50/p90, event/world IDs, scenario weights, score components, finite-value checks, model/data tier and calibration cohort. |
| `OptimizationResult` | Objective/version, constraints, selected assignments, recomputed salary, score, incumbent, best bound/gap if available, time limit, completeness, seed, solver version. |
| `DecisionTrace` | Chosen lineup, alternatives considered, objective differences, player/slot tradeoffs, sources, uncertainty/watch items, model/solver versions, immutable pre-lock forecast. |
| `OutcomeRecord` | Official actual components, corrections/version, exact scoring rules, final DK points, contest ranks/payouts when available, reconciliation status; never overwrite pre-lock inputs. |

### 3.1 Failure and trust policy

Maintain separate **data quality**, **model validation**, **solver completeness**, and **entry freshness** states. A legal lineup is not automatically a high-confidence forecast.

| Condition | Required behavior |
| --- | --- |
| Unknown contest binding, rules, slot salary, identity ambiguity, invalid lock state | Block entry-ready generation/export; expose exact repair action. |
| Missing high-impact player or role coverage | Block trusted recommendation or explicitly produce a research preview; do not silently optimize a reduced pool and call it best. |
| Missing optional contextual feature | Use a documented trained baseline with a missingness indicator, uncertainty, and disclosure. Do not invent a directional boost. |
| Missing payouts/ownership/validated field | Expected-points mode can operate if its requirements pass; tournament probabilities/ROI remain unavailable. |
| Limited search without a bound | Label heuristic/unbounded search; never call it GAP_BOUNDED or optimal. |
| Provider failure / expired source | Enforce fact-specific expiry; do not reset freshness by reading a cache. Preserve last successful observation with its age. |
| Unvalidated model | Show projected points and uncertainty as provisional; hide unsupported confidence percentages and entry-ready assurance. |
| Material pre-lock change | Invalidate affected recommendation, rebuild affected stages, issue a new version and explanation. |

## 4. Engineering execution checklist

**Ownership abbreviations:** BE = backend/data engineer; DS = forecasting/optimization engineer; FE = frontend engineer; QA = test engineer; SRE = deployment/operations engineer. Assign named owners and reviewers before implementation. All checkboxes require code, tests, and the indicated evidence artifact. Unit tests alone do not complete forecasting tasks.

### Phase 0 — Establish incident evidence and reproducible baselines

**Purpose:** Determine what actually happened and prevent tuning against an unrepeatable anecdote.  
**Owners:** BE + DS + QA. **Dependencies:** None. **Exit artifact:** incident dossier and reproducible baseline manifest.

- [ ] **P0.1 — Identify and freeze affected runs.** Locate recent WNBA Showdown, MLB, and NFL runs; request the user's exact contest/run if matching is ambiguous. Export request, slate, every stage, chosen and alternative candidates, timestamps, deployment SHA, configuration/model versions, warnings, rule/source snapshots, and final submitted lineup. Redact secrets and tenant information from engineering reports.
- [ ] **P0.2 — Reconcile the reported score.** Compare generated versus entered assignments, Captain choice, salary IDs, official scoring components and final actuals. Determine whether “80s” refers to a projected or actual score. Validate the 120–130 comparison against the same contest, format and scoring period.
- [ ] **P0.3 — Replay the original decision.** Freeze archived pre-lock inputs and random seeds; run each stage without current web data. If inputs were not retained, mark the incident unreconstructable and start prospective capture. Never substitute today's news into a historical replay.
- [ ] **P0.4 — Attribute decision loss.** Hold inputs fixed and compare old versus corrected rules, projections, full legal search, objective-preserving selection, and final entered roster. Separate search/selection loss under identical projections from forecasting error and realized outcome variance. Record interaction effects; stage deltas need not be additive.
- [ ] **P0.5 — Establish baselines.** Save the current production-equivalent model, a season-average mean baseline, and any entitled provider projection baseline, all optimized with the same correct rules/solver and cutoff. Preserve the current implementation separately for incident reproduction.

**Acceptance:** A second engineer can reproduce the archived decisions and score arithmetic, or the report explicitly enumerates missing artifacts. Historical outcomes are unavailable to the decision code.

### Phase 1 — Contain unsupported recommendations and lock the objective

**Purpose:** Prevent known weak paths from being presented as trusted while the replacement is built.  
**Owners:** BE + FE + DS. **Dependencies:** None; can begin during Phase 0.

- [ ] **P1.1 — Add enforceable capability flags.** Gate by sport, exact format, ingestion path, data tier, and objective. Configure independent switches for CSV fallback, AI numeric adjustment, AI selection, field metrics, and each model version. Record flag values in runs.
- [ ] **P1.2 — Preserve objective end to end.** Introduce `MAX_EXPECTED_POINTS` and explicit probability/return alternatives. Persist requested and executed objective; fail on mismatch. Keep legacy runs readable under their original objective version.
- [ ] **P1.3 — Remove unrestricted AI selection authority.** Keep deterministic numerical selection as authoritative. Language models may explain it; proposed numerical changes must pass typed evidence and model-policy validation. Do not silently switch providers into an unrestricted selector on failure.
- [ ] **P1.4 — Enforce trust gates.** Unknown rules, ambiguous slot identities, nonfinite values, missing critical coverage, or stale locks cannot yield an entry-ready label. Provisional FPPG paths must be visibly degraded and ineligible for calibrated claims.
- [ ] **P1.5 — Correct unsupported reporting.** Stop translating BOUNDED to GAP_BOUNDED. Separate modeled probabilities, empirical calibration, projected points, and readiness. Missing probability is null/unavailable, never zero.

**Acceptance:** Deliberately incomplete/ambiguous fixtures cannot appear trusted. Changing an API key cannot change the selected numeric objective or permit an AI downgrade. Existing valid runs remain viewable with accurate legacy labels.

### Phase 2 — Make DraftKings legality, identity, and scoring exact

**Purpose:** Ensure the optimizer solves the actual contest and exports the intended athletes.  
**Owners:** BE + QA. **Dependencies:** Phase 1 contracts. **Blocks:** trusted release of every sport.

- [ ] **P2.1 — Bind contest to authoritative metadata.** Verify contest ID→draft group→sport→game type→events→lock policy. Correct sport-code configuration on missing-group discovery. Reject cross-sport/group mismatches and client-supplied metadata inconsistent with the verified record.
- [ ] **P2.2 — Create a versioned rules registry.** Ingest authoritative game-type rules or explicitly reviewed, dated official fixtures. Key by provider gameTypeId/variant and effective date, not just CLASSIC/SHOWDOWN. Capture roster slots, eligibility, cap, team/event limits, uniqueness, score/salary multipliers, bonuses, and lock/export semantics. Unsupported variants stay blocked.
- [ ] **P2.3 — Replace generic WNBA, CFB and Golf templates.** Obtain actual contest fixtures for each offered format. Verify position groupings, Superflex where applicable, full-tournament versus round Golf scoring, and all Captain variants. Do not hardcode new slot counts based on analogy or this audit's incomplete web retrieval.
- [ ] **P2.4 — Separate athlete and slot-offer identities.** Build deterministic crosswalks with temporal team memberships and explicit ambiguous-match handling. Preserve DK draftable IDs for export. Prevent one athlete appearing twice through CPT/UTIL row IDs. Do not join solely on normalized name when multiple candidates exist.
- [ ] **P2.5 — Harden CSV ingestion.** Check headers, encoding, content type/body, numeric values, expected row coverage, event identity, duplicate rows and slot semantics. Preserve blank FPPG as missing. Quarantine malformed/ambiguous rows and fail completeness gates instead of silently dropping viable players. Support an authorized user-uploaded DK CSV when remote access fails, bound to a verified contest/rules snapshot.
- [ ] **P2.6 — Normalize multipliers once.** Store base athlete scoring distributions and exact slot salaries separately. Identify whether source FPPG/salary is already slot-scaled. Apply scoring multiplier exactly once during lineup evaluation. Round only as official rules require.
- [ ] **P2.7 — Build an independent final validator.** Recompute exact slot multiset, eligibility, canonical uniqueness, team/event constraints, salary sum, multipliers, availability and lock restrictions. Require roster assignments and player ID lists to agree. Revalidate after selection and before export; never trust candidate totals.
- [ ] **P2.8 — Consolidate the scoring oracle.** Reconcile `dkScoring.ts`, mapped rules, projection scoring, actuals scoring and UI totals. Verify MLB sacrifice-event discrepancies, football bonuses, K/DST tables, basketball bonuses, and Golf round/finish bonuses against official rules.

**Acceptance fixtures:** JSON and CSV versions of the same slate yield the same legal athlete/slot universe and salaries; paired CPT/UTIL IDs cannot duplicate an athlete; blank FPPG remains null; forged salary/slot payloads fail; official scored examples reconcile exactly for all five sports and every enabled variant. Fixtures must be independently reviewed, not generated from the same mapping code being tested.

### Phase 3 — Build a complete, fresh source and event layer

**Purpose:** Give models the correct current inputs without assuming that configured API credentials imply usable coverage.  
**Owners:** BE + SRE. **Dependencies:** Phase 2 identity and event contracts.

- [ ] **P3.1 — Audit existing SportsDataIO entitlements.** With the existing official connection, probe required schedules, rosters, transactions, injuries, depth/lineups, stats, projections, venues and Golf tournament/round fields. Record endpoint, sport, entitlement, field completeness, refresh cadence, status, latency and usage limits without logging credentials. Do not assume a new paid provider is necessary.
- [ ] **P3.2 — Build a capability matrix.** For every required fact, identify primary source, allowed fallback, freshness policy, identity mapping, licensing/retention constraints and failure behavior. ESPN, league/team sources, RSS and existing search tools can fill specific gaps; their presence is not equivalent to complete coverage.
- [ ] **P3.3 — Persist source payloads before normalization.** Store immutable content hashes, retrieval/published/effective times and parser versions, with retention/redaction controls. Record unsuccessful requests and stale cache reuse. Add bounded retries, backoff, circuit breakers and per-provider budgets.
- [ ] **P3.4 — Resolve event and venue identity.** Map home/away/neutral designation, local/UTC start, stadium/course, indoor/outdoor, roof status, altitude and surface. Handle doubleheaders, reschedules, postponed/suspended games, tournament rounds and changed tee times explicitly.
- [ ] **P3.5 — Add event-hour weather observations.** Capture forecast issue time, event-hour wind speed/direction/gusts, precipitation, temperature and applicable humidity/air-density inputs. Treat roof state separately. Golf needs time/tee-wave/course exposure. Weather uncertainty and delay/cancellation probability are distinct from scoring effects.
- [ ] **P3.6 — Define freshness service levels.** Store configurable TTLs by fact and distance to lock. Initial engineering targets: near lock, active/starting status checked within two minutes, rotation/role reports within fifteen minutes, outdoor weather within thirty minutes; use stricter provider/event requirements where necessary. These are operational targets, not proof of factual certainty. Expiry must reflect actual source cadence and publication age.
- [ ] **P3.7 — Add coverage gates over the entire legal pool.** Track missing/matched/excluded players, reasons, salary rank, potential opportunity, and fact coverage. A missing star or plausible value starter must not disappear before research. Distinguish unavailable, unresolved, and legally eligible but unmodeled.
- [ ] **P3.8 — Treat market inputs as optional evidence.** Normalize spread/total/team total, timestamp and bookmaker source where existing entitlements permit. Verify current The Odds API capabilities before relying on it; sportsbook prices are not DK DFS salary/rules/player-pool data. Avoid double-counting market-implied context already embedded in projections.

**Acceptance:** Provider outages, 403s, schema changes, stale payloads, traded players, doubleheaders and neutral venues produce explicit correct states. Required fact coverage can be audited without reading secrets or inferring provider access from configuration.

### Phase 4 — Turn research into resolved, actionable facts

**Purpose:** Make news coverage complete and ensure only supported facts affect projections.  
**Owners:** BE + DS. **Dependencies:** Phase 3.

- [ ] **P4.1 — Execute a research coverage plan.** Generate queries by event/team and material player uncertainty, not the first eight pool rows. Prioritize starters, injury replacements, high projected opportunity, unresolved transactions and late-lock dependencies. Track each question as answered, conflicted, unavailable or expired.
- [ ] **P4.2 — Separate discovery from evidence.** Search/SerpAPI locates sources; Firecrawl extracts documents. Extract typed claims with citations and timestamps; do not turn a headline or successful scrape into a verified player status. Respect provider rate/usage budgets.
- [ ] **P4.3 — Resolve before projecting.** Move fact resolution ahead of adjustment/projection. Stable keys must represent entity/event/predicate/effective interval, not sentence hashes. Retain rejected evidence, corrections, negations, supersession and unresolved conditional cases.
- [ ] **P4.4 — Deduplicate and rank sources.** Detect syndicated stories/shared primary sources. Count independent evidence, not repeated mentions. Prefer structured official active/lineup announcements for eligibility; distinguish projections and beat reports from confirmations.
- [ ] **P4.5 — Replace broad availability regexes.** Use structured statuses first, then validated typed extraction with negation/time context. Include tests for “not ruled out,” “out of a slump,” “without a minutes restriction,” probable return, historical injury references and roster membership versus active status.
- [ ] **P4.6 — Model uncertain facts as scenarios.** For questionable roles, carry conditional opportunities with probabilities justified by history or mark probability unknown. Do not split the difference between contradictory confirmed statuses or label uncertainty as healthy.
- [ ] **P4.7 — Capture playoff and situational context.** Resolve series score, elimination/clinching status, rest, travel, scheduling congestion and expected competitive environment. Translate only supported behavioral effects—rotation compression, pitch limits, pace, substitutions—into model inputs. No generic “must win” percentage boost.

**Acceptance:** Reordering the player pool does not remove required coverage. Contradictory/negated/stale reports yield the intended resolution. Every accepted model-changing claim has a source, effective time and supported numerical mechanism; prompt-injected source text cannot change tools or model policy.

### Phase 5 — Repair shared projection semantics and adjustment accounting

**Purpose:** Make model inputs interpretable, finite, coherent and measurable before tuning individual sports.  
**Owners:** DS + BE. **Dependencies:** Phases 2–4.

- [ ] **P5.1 — Separate missing, zero and unavailable.** Require field-level missingness and units. Remove default-zero statistics unless the source explicitly supplies a true zero. Quarantine ambiguous innings notation and other sport-specific units in adapters.
- [ ] **P5.2 — Add expected means and calibrated distributions.** Persist expected points and component expectations separately from quantiles. Replace narrow FPPG uniform noise with empirically estimated uncertainty conditioned on role/data tier, or retain it only as a clearly unvalidated diagnostic baseline.
- [ ] **P5.3 — Define adjustment execution order.** Resolve opportunity first, reconcile team/game budgets, apply supported efficiency/context effects, then simulate and score. Prevent later context assignment from overwriting prior accepted changes. Unknown adjustment types must fail validation or be explicitly explanation-only.
- [ ] **P5.4 — Replace arbitrary magnitudes.** Estimate/shrink effects from historical data, sport mechanics or documented analyst inputs with provenance. Every change records baseline, feature values, effect, confidence, and final input. Remove evidence-count confidence and unmeasured ±3/8/15/30% boosts.
- [ ] **P5.5 — Enforce opportunity conservation.** Basketball minutes, football plays/targets/carries and MLB plate appearances must satisfy team/game constraints with plausible player bounds. Allocate inactive opportunity through role models. Fallback players and incomplete rosters cannot silently distort budgets.
- [ ] **P5.6 — Preserve score semantics.** Model negative outcomes where rules allow them. Apply discrete bonuses after simulated stats cross thresholds. Do not scale already-scored samples to repair minutes. Reject NaN/Infinity at every input/distribution/lineup boundary.
- [ ] **P5.7 — Quantify context contributions.** Store feature-level changes and rerun a controlled projection without each context block for explanation/ablation. Identify interactions so contributions are not falsely claimed to add linearly. Distinguish confirmed fact, model estimate and analyst override.

**Acceptance:** Mixed structured/FPPG rosters, OUT players, partial teams and extreme opportunity inputs cannot produce impossible budgets/nonfinite values. Changing a supported fact changes the intended component exactly once; unsupported dimensions cannot produce invented explanation effects.

### Phase 6 — Implement the five sport models

**Purpose:** Replace generic season-average forecasts with sport-specific opportunity, efficiency and context.  
**Owners:** DS sport lead + BE + QA. **Dependencies:** Phase 5 contracts; branches can proceed independently once shared semantics are stable. Each branch has its own release gate.

#### 6A. WNBA — prioritize current rotations and Showdown decisions

- [ ] **W1 — Model the active rotation.** Use confirmed availability, starting lineup where available, recent competitive rotations, coach tendencies, minutes restrictions, foul propensity and injury-return workload. Separate expected starters from confirmed starters and roster membership.
- [ ] **W2 — Allocate minutes before sampling.** Enforce 200 regulation player-minutes per team with 0–40 per player in regulation; model overtime separately. Represent the complete rotation, including nonselectable participants where needed, and remove inactive allocation before redistribution. Do not force a partial observed roster to absorb all minutes.
- [ ] **W3 — Estimate role-sensitive production.** Shrink recent/on-off samples toward stable priors; model possessions, shot attempts/types, free throws, assists, rebounds, steals, blocks and turnovers coherently. Handle trades/returns and changing usage without treating season-average FPPG as current role.
- [ ] **W4 — Incorporate measured context.** Opponent defense/rebounding, pace, home/away or neutral site, rest/travel, blowout and overtime scenarios, playoff rotation changes and elimination games. Home advantage is a fitted contextual feature, not an automatic fixed bump.
- [ ] **W5 — Evaluate Captain explicitly.** Use canonical athletes and slot offers; compare every feasible Captain in small Showdowns, preserve utility combinations, and explain opportunity cost of the multiplier. Derive lineup quantiles from joint worlds, not sums of player percentiles.
- [ ] **W6 — Validate the reported failure class.** Build fixtures for star OUT, backup starter, partial minutes restriction, traded player, close playoff rotation, mixed fallback input, CPT/UTIL paired IDs and late scratch. Replay matched historical Showdown slates.

**Acceptance:** Minutes reconcile before scoring; all legal Captain alternatives are represented or bounded; actual scoring matches official fixtures; held-out WNBA Classic and Showdown results are reported separately with role/minutes bias and lineup improvement metrics.

#### 6B. MLB — model batting order, pitcher workload and game environment

- [ ] **M1 — Confirm game participants.** Resolve doubleheader game IDs, probable versus confirmed starters, official batting order, scratches and postponements. An unconfirmed starter is unresolved, not automatically OUT; expose the gate instead of silently removing critical pitchers.
- [ ] **M2 — Model hitter opportunity.** Estimate PA from lineup position, team run environment, home/away batting innings and substitution/platoon/pinch-hit risk. Use batter handedness, opposing pitcher skill/pitch mix and bullpen exposure with sample-size shrinkage.
- [ ] **M3 — Model hitting outcomes coherently.** Generate walks/HBP, singles/doubles/triples/HR and outs from legal probabilities; derive runs/RBI through team plate-appearance sequences or a validated coherent approximation. Model steals with opportunity, catcher/pitcher context and uncertainty.
- [ ] **M4 — Model starter workload and scoring.** Use pitch count, starts versus relief appearances, injury ramp, rest, opener/bulk role, opponent contact/K tendencies and manager usage. Couple innings, strikeouts, hits/walks, earned runs and win probability to game outcomes. Include rare scored events where material; do not use total appearances as starts.
- [ ] **M5 — Add park and weather mechanisms.** Handedness-specific park effects, wind relative to field orientation, temperature/air density, roof, delay and pitcher restart risk. Do not multiply walks, steals and all hitting components by one environmental scalar.
- [ ] **M6 — Model stack dependence and playoff usage.** Positive run/RBI relationships, pitcher–opposing hitter dependence, bullpen availability, postseason hooks and elimination-game usage. Include home/away effects through innings and measured performance context.
- [ ] **M7 — Validate formats and actuals.** Test rain delay, roof change, opener, late batting-order scratch, two games with the same teams, and correct stack/team constraints. Reconcile all scored pitcher/hitter events and compare historical lineups by slate size/format.

**Acceptance:** Expected opportunities and pitcher scoring are coherent; confirmed lineups and scratches propagate through export; weather effects target plausible components; legal-search comparisons and held-out hitter/pitcher errors are available separately.

#### 6C. NFL — model team plays, roles, correlated touchdowns, K and DST

- [ ] **N1 — Separate roster, depth and active status.** Resolve final inactives, injured reserve, suspensions, transactions, elevation/activation and starting QB. Track snap/route restrictions and return-to-play workload; refresh around official announcements.
- [ ] **N2 — Build team play and role models.** Estimate offensive plays, pass/run mix, dropbacks/sacks, routes, targets, carries, red-zone and goal-line shares using recent roles, opponent scheme, personnel and shrinkage. Snaps/routes must affect the downstream scoring inputs rather than remain unused annotations.
- [ ] **N3 — Correct offensive scoring components.** Separate rushing and receiving touchdowns and yardage, passing touchdowns/interceptions, fumbles and threshold bonuses. Enforce QB completions/receiver receptions and passing/receiving yards/TD accounting within each world. Audit analytic means against sampled means.
- [ ] **N4 — Implement K and DST where legal.** Model drive scoring opportunities, field-goal distances/misses, extra points, sacks, turnovers, defensive/special-team scores and points-allowed bins. Do not feed these entities through generic RB/WR/TE readiness or drop them for absent receiving inputs.
- [ ] **N5 — Add event context.** Wind/precipitation/cold/roof, altitude/surface, travel/rest, home/neutral venue, spread/total and game script. Starting-QB changes must update team efficiency and all dependent players; playoff urgency acts through supported deployment/strategy effects.
- [ ] **N6 — Model injury replacements and correlation.** Redistribute routes/carries to actual eligible replacements with capacity limits; generate QB/receiver stacks, opposing bring-backs and DST/opposing offense relationships through shared outcomes.
- [ ] **N7 — Validate Classic/Showdown scenarios.** Include late inactive RB, backup QB, committee split, kicker Captain if eligible, DST, overtime, blowout and severe wind. Report held-out errors by position and role stability.

**Acceptance:** Every enabled legal entity class has an explicit model; opportunity totals reconcile; quarterback changes do not mechanically boost receivers; means, bonuses and joint stat accounting pass independent fixtures.

#### 6D. College football — use college-specific rules, uncertainty and personnel

- [ ] **C1 — Verify exact contest rules and eligibility.** Implement the actual slot groups, any Superflex, scoring/bonus and overtime semantics for each game type. Do not reuse NFL TE/DST roster assumptions.
- [ ] **C2 — Build temporal roster and participation data.** Resolve transfers, redshirts/eligibility, suspensions, opt-outs, depth charts, unsettled QB competitions and late availability. Missing injury reporting must increase uncertainty rather than imply full health.
- [ ] **C3 — Model scheme and team strength.** Tempo, option/rushing-QB offense, pass/run mix, opponent-adjusted efficiency, recruiting/returning-production priors where available, and conference/opponent strength. Use principled low-sample shrinkage rather than fixed season blending alone.
- [ ] **C4 — Model playing-time scenarios.** Blowouts, starter rest, QB sharing, bowl opt-outs, postseason roles, red-zone usage and substitutions. Account for neutral-site/bowl travel, weather and home-field effects with college-specific estimates.
- [ ] **C5 — Generate coherent football outcomes.** Reuse validated shared mechanics, parameterized for college rules and distributions; verify rushing/passing allocation and overtime. Keep CFB calibration separate from NFL.
- [ ] **C6 — Validate uncertainty cases.** Test transferred same-name players, unannounced starter, major mismatch, late opt-out and neutral-site postseason games. Incomplete confirmed data must remain visibly uncertain.

**Acceptance:** No NFL template or calibration is inherited without explicit validation. All enabled CFB variants have rule fixtures, credible player participation coverage, and their own replay report.

#### 6E. Golf — model tournament structure, holes, cuts and finishing outcomes

- [ ] **G1 — Identify tournament and scoring horizon.** Bind tour, field, course(s), rounds, cut/no-cut rules, tee times and exact full-event/round/final-round format. Do not infer Captain slots or finish bonuses from the word Showdown.
- [ ] **G2 — Resolve participation.** Capture withdrawals, alternates, disqualification, injuries and schedule/tee-time changes. Distinguish pre-start withdrawal from in-event risk and preserve relevant timestamps.
- [ ] **G3 — Estimate course-adjusted skill.** Model strokes-gained components where entitled, recent form with shrinkage, course setup, length/surface and sample uncertainty. Avoid overfitting “course history” from a few appearances.
- [ ] **G4 — Simulate holes and weather exposure.** Generate birdies/eagles/pars/bogeys or worse with coherent round totals and shared conditions. Model wind/rain by tee-time wave, course/round and forecast uncertainty; account for delays changing exposure.
- [ ] **G5 — Model cuts and finishes jointly.** Simulate the entire field, cut advancement, rounds played, finish/ties and format-specific fantasy bonuses. A single projected finish-position number is not a finish distribution. Round-only formats must not require an irrelevant full-tournament finish input.
- [ ] **G6 — Treat venue context appropriately.** Use course familiarity/travel only if supported; do not import a team home-court adjustment. Format-specific leaderboard/final-round incentives require measured behavioral support.
- [ ] **G7 — Validate event variants.** Test cut/no-cut, multi-course, withdrawn golfer, weather-wave change and applicable round Showdown variants. Compare cut probabilities, round scores, finish distributions and lineup performance separately.

**Acceptance:** The entitled data path can produce all required inputs or explicitly block unsupported variants. Golf no longer depends on an unavailable scalar finish field as a substitute for a tournament model. Scoring and slot rules are independently verified.

### Phase 7 — Generate coherent joint outcome worlds

**Purpose:** Make lineup uncertainty and correlations physically/statistically meaningful.  
**Owners:** DS + QA. **Dependencies:** Shared projection repairs and the relevant sport branch.

- [ ] **P7.1 — Introduce explicit world IDs.** Seed by sport, event/slate, model version, scenario and run seed. Each world includes shared game conditions and consistent player outcomes; all candidate comparisons use the same worlds.
- [ ] **P7.2 — Enforce sport accounting invariants.** Reconcile team minutes/possessions, football plays and connected stats, baseball event/run relationships and tournament Golf outcomes. Include overtime, blowout, delay and participation scenarios when relevant.
- [ ] **P7.3 — Calibrate uncertainty and dependence.** Estimate residual distributions and correlations from held-out-as-of data, stratified by opportunity and role. Measure sample mean versus analytic mean. Avoid ad hoc independent noise followed by a cosmetic correlation score.
- [ ] **P7.4 — Use adequate simulation precision.** Choose world counts from convergence/standard-error targets and runtime budgets. A rare tournament probability cannot be supported by recycling 256 samples over more iterations. Persist effective independent worlds and Monte Carlo intervals.
- [ ] **P7.5 — Compute lineup distributions from summed world scores.** Apply slot multipliers once; calculate means, variance and quantiles afterward. Verify covariance behavior and preserve negative outcomes.

**Acceptance:** Accounting/property tests pass; deterministic replay is stable; estimates converge as samples grow; uncertainty intervals and correlations meet predefined held-out diagnostics. Simulation count alone is not a quality claim.

### Phase 8 — Replace truncated enumeration with an auditable optimizer

**Purpose:** Find the best modeled legal lineup and quantify any remaining search error.  
**Owners:** DS optimization engineer + BE. **Dependencies:** Phase 2 rules, Phase 5 mean projections; probability objectives additionally require Phases 7/10.

- [ ] **P8.1 — Implement exact assignment constraints.** Use MILP/CP-SAT or a verified equivalent with athlete-slot binary decisions, eligibility, exact slot counts, canonical uniqueness, exact salaries, team/event limits, locked players, exclusions and user constraints. Include an infeasibility explanation.
- [ ] **P8.2 — Optimize the selected objective.** Expected points uses the linear sum of player means times slot multipliers. Do not add ownership, stack, salary-spend, ceiling or diversity preferences unless explicitly part of a separately named objective/constraint.
- [ ] **P8.3 — Expose real solver evidence.** Persist incumbent, best bound, absolute/relative gap, timeout, status and version. For non-additive probability objectives, document the search method and a valid bound if one exists; otherwise label heuristic. Configure latency budgets without mislabeling a timeout as optimal.
- [ ] **P8.4 — Guarantee Showdown coverage.** Exhaustively verify small legal universes and Captain choices; eliminate interchangeable-slot permutations without eliminating valid lineups. Compare solver output to an independent brute-force oracle on small fixtures.
- [ ] **P8.5 — Make optional constraints explicit.** Minimum salary spend can remove the best lineup and should default off. Show objective cost of locked players, stacks or exclusions. Validate feasibility before searching.
- [ ] **P8.6 — Generate portfolios deliberately.** Use no-good cuts/portfolio optimization for distinct entries, player/Captain exposure and overlap limits. Verify exposure feasibility for the requested count and report shortfalls; never silently relax constraints.
- [ ] **P8.7 — Regression-test adversarial ordering.** Permute pool order, put the best Captain late, include low-salary high-opportunity players, and compare exact optima. Store search regret of the old method as an incident diagnostic.

**Acceptance:** Expected-points fixtures match the independent oracle; pool ordering does not change the optimum; production results carry truthful bounds/status; final selection cannot worsen the requested single-lineup objective.

### Phase 9 — Make selection and explanations faithful

**Purpose:** Return the solver's intended lineup with reasoning that can be checked.  
**Owners:** BE + FE + DS. **Dependencies:** Phase 8 and resolved evidence.

- [ ] **P9.1 — Select deterministically.** Use explicit objective and tie-break rules. Revalidate assignments, numerical ranking and portfolio constraints after all transformations. Prevent duplicate selections unless an explicit permitted entry policy requests them.
- [ ] **P9.2 — Explain from the decision trace.** Show why each player/slot was chosen, opportunity and mean projection, relevant verified news/context, uncertainty, source age and the most meaningful alternative. Captain explanation must include salary opportunity cost, not only the multiplier.
- [ ] **P9.3 — Constrain language-model output.** Generate narrative only from structured trace fields. Validate IDs, facts, numerical claims and citations; fallback to deterministic text on failure. A claimed weather/role effect must reference a model input that actually changed.
- [ ] **P9.4 — Present trust clearly.** Display objective, projected mean, labeled quantiles, data freshness, critical unknowns, model validation cohort and solver status. Keep actual versus projected points distinct. No generic “85% confident” label without a defined calibrated event.
- [ ] **P9.5 — Verify export round trips.** Export correct DK slot IDs and order, then parse the export and independently reconstruct the same lineup/salary. Protect against stale UI data and mixed run versions.

**Acceptance:** A reviewer can trace every material recommendation claim to inputs and model effects. AI narrative failures do not change lineups. UI/export totals match the independently validated roster exactly.

### Phase 10 — Support tournament probabilities only with a valid field model

**Purpose:** Make cash/win/ROI estimates defensible while keeping expected-points generation independent of unavailable field data.  
**Owners:** DS + BE + QA. **Dependencies:** Phases 2, 7, 8.

- [ ] **P10.1 — Verify contest economics.** Capture actual entry fee, field size, entry limits, paying ranks and complete payout table, including ranges/ties. Do not infer payout structure from request metadata or contest name.
- [ ] **P10.2 — Implement ownership provenance.** Ingest entitled ownership or train a calibrated historical ownership model with as-of features. Support classic/Captain/Utility semantics, valid normalization and uncertainty. Reconcile PROVIDER versus CALIBRATED_MODEL contract support.
- [ ] **P10.3 — Generate the field independently.** Sample legal lineups from modeled salary usage, stacks, correlations, player/slot ownership and entry behavior. Do not resample only the optimizer's preferred candidates. Validate generated field distributions against observed contest entries where available.
- [ ] **P10.4 — Fix rank and payout arithmetic.** Evaluate the recommendation against the correct number of opponent entries. Include the evaluated entry once; duplicates already belong to the tie group. Split the total occupied-rank prizes once across all tied entries. Report sole win/tied first consistently.
- [ ] **P10.5 — Handle large fields correctly.** Use full fields or a validated approximation preserving rank/paid-position/duplicate semantics. Do not cap at 10,000 while retaining unscaled original paying ranks. Report approximation error.
- [ ] **P10.6 — Gate all published metrics.** Missing paid positions means unavailable cash probability, not zero. Missing economics means unavailable ROI. Distinguish simulated estimates from calibrated probabilities; validate probability objectives separately from expected points.

**Acceptance:** Hand-calculated contests cover sole winner, multiple identical lineups, different lineups tied, tie across the last paid rank, large fields and missing payouts. Total payouts conserve the prize pool under the defined contest. Reliability plots and field-distribution checks support any published probabilities.

### Phase 11 — Rebuild from fresh facts before lock and on late changes

**Purpose:** Ensure the submitted recommendation reflects the latest actionable information.  
**Owners:** BE + SRE + FE. **Dependencies:** Phases 3–9.

- [ ] **P11.1 — Replace research-only recheck.** Refresh the authoritative contest/pool/rules where applicable plus structured availability, lineups, role facts, weather and news. Resolve facts again; compare versioned changes against the selected roster and viable alternatives.
- [ ] **P11.2 — Recompute affected stages.** Material changes invalidate opportunity/projections/worlds/search/selection, not just narrative. Persist parent/new run versions, changed inputs, old/new lineup and objective delta.
- [ ] **P11.3 — Enforce exact locking behavior.** Use verified contest/game lock rules, timezone-safe timestamps and a server clock. Late-swap solves only editable slots while preserving locked assignments/salaries. Do not assume all Showdown or Classic contests share a swap policy.
- [ ] **P11.4 — Automate scheduled/event-triggered checks.** Schedule checks around announcements and approaching lock using configurable freshness policies. Add idempotency, deduplication, race control and deadlines. A stale recheck cannot overwrite a newer completed one.
- [ ] **P11.5 — Surface actionable changes.** Show blocked/stale/rebuilt state, affected athletes, reason and time remaining. Notify through already authorized product channels; generated changes must not silently claim the user has submitted a replacement.

**Acceptance:** Inject a scratch, starting-QB change, rain postponement, Golf withdrawal and WNBA minutes restriction between generation and lock. Each updates the decision or blocks it correctly. Locked slots cannot change; stale versions cannot export as current.

### Phase 12 — Build trustworthy actuals, replay and calibration

**Purpose:** Measure whether the system improves and prevent outcome leakage or misleading confidence.  
**Owners:** DS + BE + QA. **Dependencies:** Start capture in Phase 0; final evaluation requires the relevant model/solver stages.

- [ ] **P12.1 — Deliver the missing ingestion tools.** Implement or correct the import commands referenced by `package.json`; document schemas, retries and idempotency. Ingest official player/team results and authorized DK contest exports, reconcile with scoring rules, and version stat corrections.
- [ ] **P12.2 — Preserve immutable forecasts.** Freeze probabilities, projected cash threshold/field, inputs and model version before lock. Store actual cash line separately. Retrospective probability against the observed line belongs in a diagnostic field and must never replace the forecast used for calibration.
- [ ] **P12.3 — Capture all decision coverage.** Evaluate unselected eligible players, generated lineups and alternatives, not only ENTERED results. Separate real-money performance from shadow evaluations to avoid selection bias. Missing/cancelled events require explicit handling.
- [ ] **P12.4 — Build an as-of replay harness.** Reconstruct source availability at each cutoff including publication lag, roster changes, rules and salaries. Run offline without present-day enrichment. Use rolling chronological training/validation and frozen final holdouts; keep the same event/slate across one split to prevent leakage.
- [ ] **P12.5 — Correct metric definitions.** Quantile calibration uses empirical `P(actual <= q_tau)` compared with tau, with documented handling of ties/discrete scores; p50 closeness is a different accuracy metric. Add MAE, RMSE, bias, pinball loss, interval coverage/width, CRPS where supported, and properly tie-aware rank correlation.
- [ ] **P12.6 — Evaluate lineup decisions.** Measure expected-objective search regret under fixed inputs, paired realized-point differences versus legal baselines, rank/finish distribution, and realized hindsight-optimal regret as a diagnostic upper bound. Evaluate cash/win Brier/log loss, calibration and net ROI only where their data requirements hold.
- [ ] **P12.7 — Run ablations and robustness tests.** Remove news, minutes/roles, weather, market inputs, home/away, playoff context and joint dependence one block at a time; report interactions. Promote features only when they improve relevant held-out metrics or a documented correctness invariant.
- [ ] **P12.8 — Set statistical release criteria before viewing holdouts.** Define primary metric, material improvement margin and regression tolerance by sport/format/objective. Estimate needed independent slates using baseline variance and power analysis. Use paired/slate- or event-clustered confidence intervals; do not count correlated lineup entries as independent evidence.
- [ ] **P12.9 — Gate calibration and learning promotion.** Version training sets, feature/model code, calibration cohorts and reports. No automated lesson promotion from a single losing slate, narrative diagnosis or pooled five-sport confidence threshold. Require review, held-out evidence and rollback capability.

**Acceptance:** Historical runs replay without future information; official scores reconcile; metric unit tests use hand-computed examples; confidence reports state sample sizes and intervals. A sport with insufficient data remains provisional instead of borrowing confidence from another sport.

### Phase 13 — Release by sport and format with operational safeguards

**Purpose:** Ship verified improvements without repeating “implemented” claims unsupported by production evidence.  
**Owners:** SRE + BE + FE + QA + DS. **Dependencies:** Relevant correctness, sport, evaluation and objective gates.

- [ ] **P13.1 — Migrate safely.** Add versioned nullable fields/tables, tenant isolation and indexes; preserve old artifacts. Make jobs/writes idempotent and snapshots immutable. Test schema compatibility, rollback and backfill provenance. Do not fabricate historical facts for missing records.
- [ ] **P13.2 — Prove runtime wiring.** Trace one request from API/UI through actual worker configuration to final export. Verify every enabled adapter, resolver, rule registry, model, solver and recheck is invoked; helper existence or an unused migration is insufficient.
- [ ] **P13.3 — Shadow and compare.** Run old and new pipelines against identical fresh snapshots; reconcile disagreements. Start with WNBA Showdown and the affected MLB/NFL formats, then independently certify remaining variants, CFB and Golf. No sport is complete because a shared smoke test passed.
- [ ] **P13.4 — Monitor actionable indicators.** Dashboard source freshness/coverage, identity conflicts, fallback share, lineup legality, projection bias by role, solver gaps/timeouts, objective mismatches, invalidated exports, recheck latency, calibration drift and actuals reconciliation. Alert by sport/format.
- [ ] **P13.5 — Set release and rollback ownership.** Record deployment SHA/config/model/rules versions; verify provider access from the actual production runtime. Roll back immediately for illegal exports, duplicate canonical athletes, objective overrides, future-data leakage or material freshness failures. Model-performance regression uses predefined cohort thresholds, not one bad result.
- [ ] **P13.6 — Publish engineering sign-off.** Attach test reports, fixture provenance, replay manifest, holdout report, production trace, dashboards, known limitations and rollback drill. Product/engineering/DS sign off separately for each enabled sport/format/objective.

**Acceptance:** Production artifacts demonstrate the same validated path as local tests. Entry-ready status is impossible when a required gate fails. There is a working rollback and a named on-call owner.

## 5. Release matrix and mandatory evidence

Complete this matrix per enabled game-type variant, not merely once per sport. Unsupported variants must be hidden or explicitly blocked.

| Sport | Rules/identity fixtures | Current opportunity/status | Context coverage | Joint outcomes | Solver/export | As-of holdout | Production recheck |
| --- | --- | --- | --- | --- | --- | --- | --- |
| WNBA | Pending P2 | Pending W1–W3 | Pending W4 | Pending W3/P7 | Pending W5/P8–9 | Pending W6/P12 | Pending P11 |
| MLB | Pending P2 | Pending M1–M4 | Pending M5–M6 | Pending M3–M6/P7 | Pending P8–9 | Pending M7/P12 | Pending P11 |
| NFL | Pending P2 | Pending N1–N4 | Pending N5–N6 | Pending N3/N6/P7 | Pending P8–9 | Pending N7/P12 | Pending P11 |
| CFB | Pending P2/C1 | Pending C2–C4 | Pending C3–C4 | Pending C5/P7 | Pending P8–9 | Pending C6/P12 | Pending P11 |
| Golf | Pending P2/G1 | Pending G2–G3 | Pending G4/G6 | Pending G4–G5/P7 | Pending P8–9 | Pending G7/P12 | Pending P11 |

“Pending” means not certified by this audit, even when partial code exists. Tournament probability/ROI additionally requires Phase 10 and separate calibration evidence for every row where offered.

### 5.1 Non-negotiable correctness gates

- Zero illegal lineups across the official fixture corpus, adversarial payload tests, and release shadow sample.
- Zero duplicate canonical athletes, unknown slot offers, or salary/scoring multiplier discrepancies.
- Exact official scoring reconciliation, with documented precision/rounding rules.
- No nonfinite projections, missing-to-zero coercion, or silent objective substitution.
- Critical facts are fresh and complete under policy; invalidated recommendations cannot export as current.
- Solver status and numerical bounds are truthful; expected-points small cases match an independent oracle.
- Forecast and evaluation inputs cannot access future information; actuals do not overwrite forecasts.

### 5.2 Model quality gates

Before running final holdouts, DS and product must specify the minimum material gain and allowable regressions for each sport/format. The default expected-points release should demonstrate a positive paired improvement over the agreed baseline with a predeclared confidence criterion, adequate independent sample size, and no material degradation in critical subgroups. Where data is insufficient, ship only as provisional research output with that limitation.

Report player opportunity error, point bias/MAE, distribution quality and legal-lineup realized performance together. A model can improve player MAE while selecting worse lineups, or improve average lineup points while miscalibrating its tails. Tournament ROI alone is noisy and cannot substitute for these diagnostics. High realized hindsight regret is useful for investigation but is not proof a pre-lock decision was irrational.

## 6. Engineering task-to-code map

| Area | Primary existing locations to change or integrate |
| --- | --- |
| Contest ingestion/rules/CSV | `api/generation-runs.ts`, `src/lib/engine/draftKings.ts`, `src/lib/engine/draftKingsSlate.ts`, `src/lib/floydDfsClient.ts` |
| Contracts and validation | `src/lib/engine/contracts.ts`, `validation.ts`, `src/lib/dkScoring.ts`; new runtime schema/rules registry modules |
| Provider/event/availability | `server/runtime.ts`, `sportsDataIoProvider.ts`, `availability.ts`, ESPN structured/projection providers; new venue/weather adapters |
| Research/resolution | `researchAgent.ts`, `researchEvidence.ts`, `webResearchProvider.ts`, `rssProvider.ts`, `factResolution.ts`, `server/evidenceLedger.ts` |
| Adjustments/projections | `adjustment.ts`, AI adjustment adapters, `projectionInputs.ts`, `projection.ts`; separate sport opportunity/world modules |
| Solver and selection | `optimizer.ts`, `selection.ts`, `openAiSelection.ts`, Anthropic selection adapter, `contestSimulation.ts` |
| UI/trust/export | `src/pages/RunPage.tsx`, `src/components/LineupDisplay.tsx`, client run/export paths |
| Pre-lock | `api/generation-runs/[runId]/recheck.ts`, `server/runtime.ts`, job scheduler/worker and new invalidation logic |
| Outcomes/evaluation | `api/lineups/[lineupId]/result.ts`, `learningMetrics.ts`, `calibration.ts`, `cashLineCalibration.ts`, `lessonPromotion.ts`, `server/learningReport.ts`, `scripts/`, `tests/` |
| Persistence/rollout | `supabase/migrations/`, run/stage/evidence tables, tenant policies, deployment configuration |

Paths without a directory in the table refer to `src/lib/engine/` unless explicitly stated. Inspect all callers during implementation; moving a function without updating the production runtime does not complete a task.

## 7. Execution order and handoff rules

1. Start evidence capture and containment immediately (Phases 0–1).
2. Establish exact legality/identity and reliable sources (2–3). Begin expected-points solver work once those contracts and means are available; do not wait for tournament ownership modeling.
3. Implement resolved research and shared projection repairs (4–5), then the five explicit sport branches (6) and their joint worlds (7).
4. Complete objective-preserving solver, selection and explanations (8–9), then fresh pre-lock rebuilding (11).
5. Add independently validated field objectives (10) when required data exists. Expected-points release does not depend on buying ownership data.
6. Run ongoing actuals/replay work (12) from the start; use final holdouts and production verification to release each sport/format (13).

Every engineering ticket must link its task ID, root causes, dependencies, affected contracts/files, fixtures, acceptance evidence and rollback impact. Use separate correctness and model-performance reviews. Estimates should follow Phase 0/provider capability discovery; do not promise a five-sport completion date before identifying missing inputs and historical data.

### Definition of complete

- [ ] Every R01–R19 finding has a resolved implementation or an explicit gated limitation, with associated evidence.
- [ ] Every enabled variant in all five sports passes the matrix above.
- [ ] The user's exact incident is explained using archived evidence, or missing evidence is stated precisely.
- [ ] Numerical decisions preserve the chosen objective; explanations accurately describe those decisions.
- [ ] Historical validation establishes measured improvement and honest uncertainty; production wiring matches the validated implementation.
- [ ] The engineering handoff includes runbooks, fixture/replay access, data capability documentation, monitoring and rollback ownership.

## 8. Source references and verification boundaries

- Repository evidence is identified by file/function throughout Section 2 and mapped to engineering work in Section 6. This audit includes the current uncommitted tree; attach a commit or content manifest when the engineering baseline is frozen.
- [DraftKings Showdowns overview](https://help.draftkings.com/hc/en-us/articles/24808583978003-Game-Style-Showdowns-Overview-US) describes general single-game Showdown and Captain concepts. It does not certify every sport/game-type variant used by this app; exact contest fixtures remain required.
- [DraftKings lineup editing and global player swap](https://help.draftkings.com/hc/en-us/articles/4405224012819-How-do-I-edit-my-lineup-with-global-player-swap-US) explains lineup editing/locking concepts. Implement the actual contest's lock policy rather than assuming universal late swap.
- [DraftKings rules entry point](https://www.draftkings.com/help/rules/index) is the official starting point for sport/game-type verification. The audit's attempted WNBA, CFB and Golf page retrieval did not provide full readable rule contracts. That limitation is why this plan requires recorded authoritative fixtures instead of asserting replacement roster templates.

## 9. Implementation progress and release gates

This section records concrete work made against the execution plan. A code change or passing unit test does not close a sport release gate; every sport/format still needs authoritative contest fixtures, provider verification, historical evaluation and production trace evidence from the phases above.

### Completed in the local working tree

- [x] **Objective preservation, first slice (P1.2–P1.3).** `MAX_FPTS` now has a mean-only scoring profile; candidate scoring records the simulated mean; selection orders by expected points for that objective; a post-selection language-model choice can no longer replace the numeric selection. The generation API defaults an omitted objective to `max_fpts`, rejects unsupported values, and persists the resolved mode into the run payload. The saved-run results view shows mean and median when both are available.
- [x] **Candidate legality validation, first slice (P2.7).** Reconciles candidate IDs with slot assignments, enforces exact slot counts and eligibility, recomputes salary using captain/utility prices, and checks salary cap and team limits.
- [x] **Fail-closed contest fallback handling (P1.4, P2.2, part of P2.5).** DraftKings CSV fallback remains useful for contest/player discovery, but a slate built without authoritative contest rules is blocked. A provisional scoring profile is also blocked if the authoritative game-type response contains no scoring values. CSV parsing now requires ID/name/salary headers, drops duplicate player IDs, and preserves blank FPPG as missing. The regression test asserts both missing-FPPG semantics and that CSV cannot become entry-ready. This does not complete CSV coverage/content-type/event checks or permit safe lineup generation from CSV.
- [x] **Server-side sport-code configuration.** DraftKings sport codes are now read from `DRAFTKINGS_SPORT_CODE_<SPORT>` configuration instead of relying on an empty default map. Actual values must be verified in each deployment; none are recorded in this document.
- [x] **Availability parsing guardrails (P4.5).** Status parsing no longer uses loose substring matching that classifies negated “not out” statements as OUT; questionable/doubtful remain uncertainty.
- [x] **Partial basketball rotation guardrail (P5.5).** Projection code no longer scales an incomplete player pool up to all 200/240 team minutes. It records undercoverage and only reconciles over-allocation. Full rotation allocation remains open pending the missing-player opportunity model.
- [x] **Retryable entry action state.** A failed server-side entry update stays retryable and displays an inline error; the UI no longer presents a failed request as successfully entered.
- [x] **Portfolio overlap control wiring.** `maxSharedPlayers` is passed from the UI through run processing into optimizer overlap constraints.
- [x] **Reject blocked slates at the engine boundary.** `assertSlate` now rejects any slate whose validation status is `BLOCKED`, even when its fields otherwise pass structural validation. This prevents another caller from bypassing the API-level fallback guard.
- [x] **Keep screenshot extraction out of lineup generation.** Screenshot-derived contest data is explicitly marked unverified, and the screenshot endpoint returns a 422 preview with validation errors instead of creating a generation run. It cannot establish authoritative contest identity, exact roster rules, or scoring rules.
- [x] **Guard narrative availability adjustments against negation.** Explicit phrases such as “not out” and “not ruled out” no longer create a major unavailability adjustment; “out of a slump” is not treated as an injury status. Confirmed “ruled out” and “out for tonight” still trigger the availability adjustment. Structured availability parsing remains the authoritative path.
- [x] **Carry trust into recommendation readiness.** `buildRunTrust` records required-fact gaps, stale evidence, FPPG fallback use, contest-metric provenance, and whether search was exhaustive or heuristic. Since no sport/format has as-of holdout and production certification, every new lineup is labeled `PROVISIONAL` and the manifest is not eligible for entry-ready claims. The Run detail view shows the release reasons while preserving the lineup as a preview for review/live testing.
- [x] **Keep missing cash probability null and provenance-aware.** The saved-run mapper no longer converts a missing cash-line probability to zero or infers calibration from a number without provenance. The UI labels it unavailable unless the record says simulated or calibrated.
- [x] **Bind a contest to its current lobby group.** DraftKings generation now checks that the exact contest exists for the requested sport/format and that its lobby draft group matches the request; the fetched draft group must also agree with its own ID and game type. Client-supplied contest name, lock and field size no longer override lobby facts. When the lobby endpoint is blocked, CSV remains discovery-only and the slate is marked blocked. This still does not provide a versioned official rules registry or dated independent rules fixtures.
- [x] **Block incomplete contest templates and scoring.** Slate mapping now rejects missing/guessed roster templates, invalid slot counts, missing salary caps, incomplete Showdown Captain rules, and any missing scoring key required by the current scorer. A provisional profile may remain on the artifact for diagnostics, but cannot pass validation for generation.
- [x] **Correct quantile coverage semantics.** Learning metrics now report empirical `P(actual <= predicted q_tau)` for p20, p50 and p90; p50 no longer measures an arbitrary ±10% band. This is a metric-definition correction, not a backtest or calibration result.
- [x] **Preserve the pre-lock probability forecast.** Recording a contest result no longer overwrites the generated lineup's saved cash line or raw probability using the actual post-lock cash line. That recomputed value is stored only in the result payload as a retrospective diagnostic with its timing explicitly labeled.
- [x] **Make payout simulation fail closed on incomplete economics.** Contest fields above 10,000 are unavailable instead of silently capped; the evaluated entry is counted once and only total-minus-one opponents are sampled; tied prizes sum all occupied ranks and split across all tied entries once; ROI requires a payout for every paid rank and a valid entry fee; invalid paid-rank counts do not produce cash frequency.
- [x] **Report actual search coverage truthfully when small universes exhaust early.** The optimizer now distinguishes a loose combinatorial upper bound from an actually truncated search: if its enumeration finishes before reaching its budget, `searchCompleteness` is exhaustive. Reaching the accepted-candidate limit still reports bounded search and no optimality gap.
- [x] **Separate live lobby entries from contest field capacity.** DraftKings `entries` is retained as the current filled count; only explicit total-capacity fields populate `contestSize`, while `mec`/maximum-entries-per-user stays in `maxEntriesAllowed`. Unknown lobby abbreviations no longer feed field payout/cash simulations. Regression coverage checks these three independent values.
- [x] **Provide default DraftKings lobby codes for every supported sport.** The API client now defaults WNBA, NBA, MLB, Golf, NFL and CFB lobby query codes to their sport abbreviations; explicit server environment values still override them. Slate discovery and generation therefore share the same fallback behavior. A regression test asserts WNBA contest discovery builds `sport=WNBA` with no deployment override. This resolves the missing-code configuration error; it does not bypass or resolve the separate upstream 403.
- [x] **Complete WNBA scoring when DraftKings omits scoring keys from game-type rules.** A versioned WNBA profile now records the nine official DraftKings fantasy-point weights and source URL in the slate manifest. Missing API keys are filled from that profile; every returned overlapping value must agree or the slate stays blocked. Captain salary/point multipliers still require the authoritative contest roster rules. The source is DraftKings' official WNBA Pick6 Fantasy Points rules page; this documents the scoring values, not general model/contest certification.
- [x] **Respect DraftKings Golf single-round Showdown rules.** Golf `SHOWDOWN` now parses the exact DraftKings slot template instead of being rewritten to a generic CPT+5 UTIL roster. Six explicit golfer slots produce no invented Captain slot or Captain salary. A versioned PGA single-round per-hole scoring profile fills omitted scorer values only when DraftKings' template confirms six slots and contest/event text does not identify match play; conflicting provider values or unsupported variants remain blocked. The manifest records the profile URL/version. Tests cover six-G slot mapping, scoring values, no Captain salary, conflicts, and match-play fail-closed behavior.

### Verification performed

- `npm run test:parity` — passed after adding/updating regression assertions for candidate salary/slot integrity, max-expected-point selection, partial WNBA minutes, narrative availability negation, blocked slate contracts, blank CSV FPPG, and blocked CSV fallback.
- `npm run check:server` — passed after the latest server/API changes.
- `npm run build` — passed. Vite emitted a compatibility warning because local Node is 20.13.0; Vite recommends 20.19+ or 22.12+.
- `npm run lint` — passed.
- Latest after contest binding/rules, trust readiness, quantile metrics, result immutability, payout simulation, lobby field-size semantics and default sport codes: `npm run test:parity`, `npm run check:server`, `npm run lint`, `npm run build`, and `git diff --check` passed. The build retains the local Node/Vite compatibility warning described above.
- Scoring and format omission fixes: regression coverage verifies WNBA and Golf single-round profiles, records each profile version and URL, and blocks conflicting values. Golf tests also verify no-Captain roster mapping and match-play fail-closed behavior. `npm run test:parity`, `npm run check:server`, and `npm run lint` passed; run the production build after the current patch before release.

These checks establish compilation and targeted invariants only. They do not validate forecast quality, probability calibration, production DraftKings access, or mobile behavior.

### Still open before this plan can be called complete

- **Incident RCA:** No exact WNBA/MLB/NFL run IDs, submitted entry, historical lock-time snapshots, contest result export, or deployment SHA were provided, so score reconciliation and loss attribution cannot be completed.
- **DraftKings access and rules:** The documented production 403 still blocks authoritative contest/player/rule verification in the affected deployment. Verify configured sport codes and the endpoint path from the target runtime; obtain dated, independently reviewed rules fixtures for all supported formats. CSV fallback and screenshot extraction are intentionally blocked from lineup generation until authoritative contest identity and rules are available.
- **Model and solver work:** Mean-based selection is not evidence of calibrated expected points. Role/opportunity modeling, coherent joint worlds, exact or bounded solver, field simulations and measured optimality gaps remain unimplemented or unverified by sport. Do not market current output as highest-probability or highest-scoring.
- **End-to-end trust propagation:** Run completion currently means the pipeline finished, not that the recommendation is entry-ready; the persisted trust record and UI now make that distinction and force `PROVISIONAL`. Validate the trust JSON migration in the target database and ensure any future entry/export action checks `entryEligible` before calling a lineup verified. Do not change model certification from `UNVALIDATED` without sport/format holdout and production evidence.
- **Five sport certification:** MLB, NFL, WNBA, CFB and Golf each need sport/format-specific provider coverage, edge-case fixtures, scorer/slot parity, historical replay, chronological holdout metrics, and an operational production trace. Golf finish-position data and incomplete basketball minutes are explicit unresolved dependencies.
- **Persistence and release operations:** The migrations and evidence-ledger work in the current workspace have not been proven applied to the linked database or traced through production. No deployment, monitoring dashboard, rollback drill, or release sign-off was performed.
- **Broader app polish from the separate UI/UX plan:** This implementation covered the entry retry state and saved-run mean/median label only; the separate mobile-first design plan is not complete.

The uncompleted checklist items above remain open. Continue execution from Phase 0 evidence capture and Phase 2 authoritative rules access; do not enable or describe any sport/format as certified until its release matrix evidence is attached.
