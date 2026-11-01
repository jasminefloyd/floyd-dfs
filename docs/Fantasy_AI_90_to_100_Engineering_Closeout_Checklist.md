# Fantasy AI — Engineering Closeout Checklist: 90 → 100

**Target:** NBA + DraftKings V1 Multi-Agent Sports Intelligence System  
**Baseline:** November 1 static alignment review, provisional **90/100**  
**Audience:** Junior engineers, technical lead, QA, data/model reviewer  
**Status:** Implementation handoff — tasks are **not** represented as completed  
**Source package:** `Archive(20261101-004959).zip`; earlier supplemental `tests.zip`  
**Scope:** Preserve existing app, providers, Supabase schema, numerical engines, and safe fallbacks. `/docs` is optional for product behavior but release evidence/runbooks are required somewhere versioned.

## Execution status (verified 2026-10-31)

This checklist is **not accepted as 100/100**. Local code and test work is recorded below; external acceptance evidence remains open where it requires staging, historical results, a monitored alert channel, or reviewer sign-off. The local CI report is `test-results/ci-results.json`; `npm run test:all` refreshes its commit SHA, dirty-tree state, tool versions, and suite results. A local run does not supply a hosted CI URL.

| PR | Verified status | Acceptance still open |
|---|---|---|
| PR-01 | Reproducibility workflow and test-report changes are present; local lint, type-check, build, negative fixture, and 16/16 test suites pass. | Hosted CI run/URL and fresh-checkout proof. |
| PR-02 | Runtime selection uses a typed `READY`/`NOT_READY` scenario gate. `CALIBRATED` requires a SHA-256 dataset and report, versioned evaluation, minimum independent contests, completed holdout window, post-holdout review time, and reviewer identity; optimizer validation still checks scenario identity, cutoff, rules, candidates, and scores. | The production optimizer has no calibrated scenario producer or reviewed evidence artifact; financial routing remains off and EV unknown. No full application run can exercise the financial route with real evidence. |
| PR-03 | Operations route is derived from tenant-scoped run lineage and flags; the UI separately shows observed/configured route, last successful House run, staleness, fallback, kill switch, and candidate evaluation. Local coverage exercises modes and tenant separation. | Live House run/Operations evidence. |
| PR-04 | Scheduler and refresh implementation/tests are present. | Staging was explicitly declined; no staging cron traces. Account-specific provider daily budget remains unverified. |
| PR-05 | Point-in-time lineage/replay implementation and deterministic tests are present. | Real database integration replay and tenant-isolation evidence are not established in this run. |
| PR-06 | House policy, driver, fallback and synthetic fixture tests are present. | No real eligible House candidate-to-lineup staging trace; candidate remains gated pending NBA validation. |
| PR-07 | Deterministic simulation evaluation and HOLD/eligibility reporting are present. | Current evaluation reports zero holdout player rows, slates, games, team rows, and lineup rows; historical holdout acceptance is open. |
| PR-08 | Independent lineup validation, contest terms/payout readiness, tied payout handling, and unknown-EV fallback have local tests. Field readiness also rejects incomplete report/hash/holdout/reviewer evidence. | No independently calibrated field model/held-out contest-field evidence; no full financial acceptance. |
| PR-09 | Learning dataset eligibility, diagnostics/proposal governance, and idempotency code/tests are present. | No verified settled entered-contest case with pinned pre-lock archive and actual settlement evidence. |
| PR-10 | Relevant application views expose current readiness and failure details. | Browser E2E framework and walkthrough evidence are absent; no Classic/Showdown screenshot walkthrough was run. |
| PR-11 | Operations health and a versioned runbook are present. | No configured monitored delivery channel, acknowledged alert, staging recovery trace, or rollback drill. |
| PR-12 | Not complete. | Acceptance packet, migration/environment evidence, and tech lead/QA/model reviewer sign-offs remain outstanding. |

Previously accepted constraints remain in force: do not create staging; do not invent historical data or a provider quota; keep learning shadow-only until NBA validation passes. These constraints leave the corresponding acceptance gates open rather than waiving their evidence requirements.

> **Scoring contract:** 90/100 is a *provisional static-implementation estimate*, not a certified 90 checklist points. This closeout checklist defines the remaining work and objective proof required for a 100/100 **NBA V1 architectural acceptance**. Completing tasks without passing tests and demonstrations does **not** earn full acceptance. Profitability, statistical superiority, and guaranteed winnings are **not** promised. An unvalidated model remaining in HOLD is acceptable; silently treating it as validated is not.

## 0. Required engineering workflow

For **every PR**: (1) branch from current main; (2) preserve current behavior behind a flag where relevant; (3) write failing test first; (4) implement; (5) run focused tests; (6) run full CI; (7) attach before/after outputs and run IDs; (8) obtain tech-lead review. Never silently alter the existing scoring, lineup legality, provider fallback, or as-of replay semantics.

**PR completion template:** `Owner / Branch / Dependencies / Files touched / Acceptance test IDs / Command + exit code / Evidence link / Rollback / Reviewer sign-off`. All changes must preserve tenant isolation, point-in-time replay, and idempotent retries.

**Dependency order:** PR-01 → PR-02/03/04 → PR-05 → PR-06/07 → PR-08/09 → PR-10/11 → PR-12 → final acceptance. PR-03 and PR-04 may run concurrently with PR-02 after PR-01.

---

## PR-01 [P0] Make the repository reproducible and enforce full CI

**Observed gap:** The latest ZIP lacks `.github/workflows/ci.yml`, `.nvmrc`, and `tests/g8-operations.test.ts`. Earlier `tests.zip` includes G0–G6 tests but not G8. `scripts/test-g0-safety.mjs` expects the workflow; `scripts/test-g8-operations.mjs` references the missing test. Previous local TypeScript invocation used a mismatched compiler; this is **not** evidence of an application compiler defect.

**Modify/create:** `.nvmrc`, `.github/workflows/ci.yml`, `package.json`, `package-lock.json`, `scripts/run-ci-tests.mjs`, `scripts/test-g0-safety.mjs`, `scripts/test-g8-operations.mjs`, `tests/g8-operations.test.ts`; include all earlier `tests/` and fixtures in source control.

**Implementation checklist**
- [ ] Pin a supported exact Node 22 patch version in `.nvmrc`; use `actions/setup-node` with `node-version-file: .nvmrc`, npm cache and `npm ci`.
- [ ] Ensure CI runs **in this order**: `npm ci`, `npm run lint`, `npm run check:server`, `npm run build`, `npm run test:all`. Verify actual script names against `package.json`; do not substitute no-op commands.
- [ ] Commit all G0–G8 test sources and fixtures; do not require a separate ZIP to run tests.
- [ ] `scripts/run-ci-tests.mjs` must use `spawn`/`execFile` with exit-status propagation; fail immediately or report aggregated failures with a nonzero exit code.
- [ ] Add a negative CI test: introduce a deliberately failing fixture in a throwaway branch; prove CI goes red; remove it and prove CI goes green.
- [ ] Publish the commit SHA, installed `node --version`, `npm --version`, TypeScript version, CI run URL, and full logs.

**Acceptance:** A fresh checkout reproduces every test; no missing-file errors; failed checks block merge. **Do not claim a passing build unless CI logs show it.**

## PR-02 [P0] Connect calibrated joint-field scenarios to the real lineup runtime

**Observed defect:** `server/lineupAgent/portfolioOptimizer.ts` accepts `jointFieldScenarios`, but `server/runtime.ts` calls `optimizePortfolio` without that property (currently around line 876). Thus normal runs cannot activate `MAX_EXPECTED_NET_RETURN`.

**Modify:** `server/runtime.ts`, `server/lineupAgent/portfolioOptimizer.ts`, `server/lineupAgent/fieldModel.ts`, `server/lineupAgent/expectedValue.ts`, `server/lineupAgent/contest.ts`, `tests/g5-contest-portfolio.test.ts`. **Create only if missing:** `server/lineupAgent/jointScenarioBuilder.ts`, `tests/integration/financial-routing.test.ts`.

**Implementation checklist**
- [ ] Trace how `OptimizerPackage.candidates[*].simulatedScoreSamples` are produced and verify trial indices refer to the same underlying game scenario across players/candidates. Never independently shuffle player samples.
- [ ] Implement a `buildJointFieldScenarios` adapter returning the existing `JointFieldScenarios` shape: `{fieldModelVersion, datasetSha256, opponentScoresByTrial, candidateScoresById}`. Use the *same trial index* for user candidates and opponent lineups. Record seed, simulation version, field-model version, slate ID, contest ID, as-of cutoff and dataset SHA-256 in persisted run lineage.
- [ ] Build opponent-field lineups using contest-specific legal roster rules and calibrated ownership/field parameters. **Do not fabricate a calibrated field model**. If calibration evidence is missing, return a typed `NOT_READY` result with reasons.
- [ ] Validate trial count, exact candidate IDs, finite scores, field size, number of user entries, contest payout tiers, fee, roster legality, model version and dataset hash. Reject mismatches before optimizing.
- [ ] Pass `jointFieldScenarios` to `optimizePortfolio` **only when** the field model is independently certified `CALIBRATED` and all invariants pass. Otherwise pass no scenarios and retain `SAFE_SCORE_UPSIDE` with `expectedNetReturn: null`.
- [ ] Ensure `MAX_EXPECTED_NET_RETURN` uses the whole selected portfolio's *net* payout distribution (subtract fees for every entry), correct rank ties, and any overlapping user entries in the simulated contest. Validate payout tiers against the actual contest rules.
- [ ] Preserve search-budget warnings, deterministic replay, constraints, and `globalOptimalityClaimed: false` for bounded search. Never label bounded search globally optimal.
- [ ] Persist objective, readiness reason, scenario hash, seed, expected net return, standard error, cash/loss probability and optimization status; expose them in API/UI with uncalibrated values shown as **unknown**, not `$0`.

**Tests:** `tests/g5-contest-portfolio.test.ts` plus runtime integration fixture. Test a calibrated 2-entry contest where financial optimization picks a different portfolio than score/upside; uncalibrated field fallback; missing payout tier; invalid trial shape; stale model hash; tied rankings; fee subtraction; reproducible seed; search budget exhaustion; Classic and Showdown legality.

**Acceptance:** A full application run (not a direct helper call) produces `MAX_EXPECTED_NET_RETURN` when and only when certified scenario inputs exist; replay reproduces the same decision. Unready cases remain safely nonfinancial.

## PR-03 [P0] Fix truthful Operations runtime status

**Observed defect:** `server/operationsSnapshot.ts` hardcodes `runtimeRoute: 'LEGACY; candidate runtime adapter is not connected'`, despite the NBA House adapter being invoked in `server/runtime.ts`.

**Modify:** `server/operationsSnapshot.ts`, `api/operations/health.ts`, `src/pages/OperationsPage.tsx`; **create** `tests/g8-operations.test.ts`.

**Implementation checklist**
- [ ] Remove the hardcoded string. Derive `runtimeRoute` from observed recent run assignments, registry/flag state, and the actual runtime selection metadata; do not infer that a candidate was selected merely because a flag is on.
- [ ] Return a structured status such as `{mode: 'LEGACY'|'SHADOW'|'CANARY'|'ACTIVE'|'UNKNOWN', source, observedAt, sampleCount, reason}`. If evidence is absent, return `UNKNOWN` with an explicit reason.
- [ ] Distinguish configured route from observed route, and display timestamp and last successful House run.
- [ ] Surface fallback reason, kill-switch state, last candidate evaluation and whether monitoring data is stale.
- [ ] Protect health endpoint details with existing auth and tenant boundaries; avoid exposing secrets or player personal data.

**Tests:** Legacy-only, shadow, canary with observed candidate, active, kill switch, no recent runs, conflicting flags, stale telemetry, tenant isolation.

**Acceptance:** The Operations UI never claims the adapter is disconnected when lineage shows it ran, and never claims House active when all observed runs used legacy.

## PR-04 [P0] Prove autonomous NBA scouting before user activity

**Existing code:** `server/streetTeam/nbaScheduleRepository.ts`, `server/streetTeam/scheduler.ts`, `api/street-team/scheduler.ts`, `server/streetTeam/slateGate.ts`, `supabase/migrations/20261031060000_g1_g2_nba_schedule_and_lineage.sql`, existing 10-minute Supabase Cron migration.

**Implementation checklist**
- [ ] Apply and verify schedule/lineage migrations in staging; confirm Supabase Cron, Vault secret, HTTP auth and service permissions.
- [ ] Seed a known upcoming NBA game with **zero generation runs**. Trigger schedule discovery; assert game identity, tip-off/lock metadata and provider provenance persist.
- [ ] Observe two consecutive real cron dispatches, with timestamps, refresh outcomes, quota/budget decisions, retries and errors logged.
- [ ] Verify near-lock cadence prioritizes official availability, roster and injury checks, including a late scratch and a conflicting source.
- [ ] Confirm slate gate blocks stale/contradictory eligibility and records source IDs and as-of cutoff; make retries idempotent.
- [ ] Simulate provider timeout, 429, duplicate dispatch, and missing schedule; verify bounded retry/backoff, no runaway spending and a visible degraded state.

**Tests:** Extend `tests/g1-street-team.test.ts` and `tests/g2-lineage.test.ts` with no-user-run, lease contention, near-lock, stale injury, schedule change and cross-tenant cases.

**Acceptance:** A future game is scouted before any user contest is created; near-lock changes are captured or transparently marked unavailable. Attach timestamped staging trace.

## PR-05 [P0] Prove historical intelligence is point-in-time correct

**Modify:** `server/streetTeam/asOfRepository.ts`, `server/runLineage.ts`, relevant `supabase/migrations/*.sql`, `tests/g2-lineage.test.ts`.

**Implementation checklist**
- [ ] Define event-time and knowledge-time cutoffs separately. Verify observations with `effective_at` after the event cutoff or `ingested_at` after the knowledge cutoff cannot leak into historical replay.
- [ ] Require historical roster/team anchors, not current roster lookups, for past team identity.
- [ ] Store observation source, confidence, version, supersession and effective/ingested timestamps; preserve previous versions.
- [ ] Add real database integration tests for same-player team change, corrected injury report, late-arriving news, and tenant isolation.
- [ ] Pin the exact intelligence snapshot ID and model version on every House/run artifact.

**Acceptance:** A replay for a historical contest produces only facts known by that contest's cutoff; a later correction does not rewrite the original decision.

## PR-06 [P0] Demonstrate NBA House candidate → simulation → lineup with safe rollback

**Modify:** `server/houses/nba/driverPolicy.ts`, `adjustments.ts`, `modelResolver.ts`, `runtimeAdapter.ts`, `server/runtime.ts`, `tests/g3-nba-house.test.ts`.

**Implementation checklist**
- [ ] Create a fixture with an officially sourced explicit minutes cap, linked observation IDs and valid as-of timestamp.
- [ ] Confirm baseline minutes, capped minutes, fantasy projection and explanation reconcile arithmetically; no hidden LLM numeric adjustment.
- [ ] Demonstrate an approved model candidate selected by the existing registry and canary assignment; ensure the selected projection reaches simulation and final lineup optimization.
- [ ] Verify unapproved, stale, conflicting or behavioral-only observations cause abstention/report-only handling.
- [ ] Persist baseline/adjusted projection, applied driver IDs, registry approval, assignment, simulation version and final selection lineage.
- [ ] Test kill switch, registry disable, timeout, invalid candidate and retry: each must return safely to pinned legacy behavior without mixing model versions mid-run.
- [ ] Do **not** require teammate-out or revenge narratives to receive nonzero adjustments absent independently validated effects.

**Acceptance:** One redacted staging trace shows an eligible driver affecting a lineup decision, and one shows abstention/fallback. Both replay deterministically.

## PR-07 [P1] Publish simulation validation and release gating

**Modify:** `server/houses/nba/simulationEvaluation.ts`, `server/houses/nba/simulationService.ts`, `scripts/evaluate-nba-simulations.mjs`, `tests/g4-simulation.test.ts`.

**Implementation checklist**
- [ ] Freeze an independent historical holdout period and document selection before running evaluation. Exclude games used to fit candidate parameters.
- [ ] Compare legacy baseline vs House on fantasy-point error, minutes error, team totals, P10/P50/P90 coverage, tail events, within-game correlations and Monte Carlo stability.
- [ ] Run with fixed seeds; record model versions, data hashes, cohort counts, missing-actual exclusions and uncertainty intervals.
- [ ] Add thresholded `PASS` / `HOLD` / `FAIL` gate; disallow promotion if required metrics fail or sample is insufficient.
- [ ] Publish reproducible report and exact command. A model held back for weak evidence is **correct governance**, not an architectural failure.

**Acceptance:** Another engineer can rerun the evaluation from pinned data and obtain the same decision; production cannot use an unapproved candidate.

## PR-08 [P1] Validate DraftKings legality, opponent model and financial outputs

**Modify:** `server/lineupAgent/entryValidator.ts`, `contest.ts`, `fieldModel.ts`, `expectedValue.ts`, `portfolioOptimizer.ts`, entry/export APIs, `tests/g5-contest-portfolio.test.ts`.

**Implementation checklist**
- [ ] Independently validate every final lineup at export/entry confirmation, not only candidate generation: salaries, eligibility, roster count, Showdown Captain/Flex multipliers, Classic slots, duplicates, locks, entry limits.
- [ ] Reject incomplete or contradictory payout terms; show exact missing requirements in UI.
- [ ] Evaluate field-model calibration against held-out contest fields and document calibration scope/expiration.
- [ ] Reconcile synthetic contest fixtures including ties, multi-entry fees, partial cash, and zero payout against hand-calculated net returns.
- [ ] Confirm EV uncertainty is shown and EV is null if calibration or payouts are not ready. Compare bounded portfolio selection against prior selector on identical historical scenarios.

**Acceptance:** Every submitted/exported lineup passes independent legality; financial claims are limited to calibrated, fully specified contests.

## PR-09 [P1] Demonstrate the full learning cycle on a settled contest

**Modify:** `server/learning/portfolioOutcomes.ts`, `evaluationDataset.ts`, `diagnostics.ts`, `promotion.ts`, `api/learning/proposals.ts`, `tests/g6-learning.test.ts`.

**Implementation checklist**
- [ ] Select one redacted, truly entered historical contest with confirmed lineup IDs, entry fees, actual player scores, rank, payout and settlement source.
- [ ] Preserve the pre-lock intelligence/model snapshot and show prediction vs actual errors without post-lock leakage.
- [ ] Calculate net return = verified payout − all verified entry fees; exclude suggested-but-unentered and pending/void entries from realized ROI.
- [ ] Generate diagnostics, a sourced proposal and independent holdout decision. Approval of a proposal must not silently change runtime.
- [ ] Demonstrate explicit HOLD or registry-controlled canary activation; if activated, show monitoring and rollback.
- [ ] Ensure duplicate settlement ingestion is idempotent and corrected official results produce audited revisions, not destructive overwrites.

**Acceptance:** End-to-end lineage can be reconstructed from entered lineup to settlement to reviewed model decision.

## PR-10 [P1] Finish user-visible workflows and failure states

**Modify:** `src/pages/RunPage.tsx`, `StreetTeamPage.tsx`, `NbaHousePage.tsx`, `LearningPage.tsx`, `OperationsPage.tsx`, `src/components/PortfolioResults.tsx`, relevant API clients. **Add:** browser E2E tests under the repository's chosen test framework.

**Implementation checklist**
- [ ] Street Team: show latest observation, timestamp, source, confidence, conflicting evidence and historical versions.
- [ ] NBA House: show baseline, applied drivers, report-only context, selected route, model version, uncertainty and fallback reason.
- [ ] Lineup Lab: show contest details, missing inputs, legality, portfolio objective, optimization completeness, calibrated EV or unknown, entry confirmation and settlement status.
- [ ] Learning: show actuals, realized net results, diagnostics, proposal state and reviewed promotion decision.
- [ ] Operations: show scheduler freshness, failures, quotas, House route, evaluation gate, alerts and kill switch.
- [ ] Cover stale, conflict, provider outage, no contest payout, partial search, no approved House candidate and pending settlement states without raw JSON or misleading success labels.

**Acceptance:** QA completes a Showdown and Classic walkthrough from UI with screenshots, accessible error messages and no manual database edits.

## PR-11 [P1] Prove operational alerts, recovery and rollback

**Modify:** `api/operations/health.ts`, `server/operationsSnapshot.ts`, scheduler/monitoring configuration, G8 tests; update existing operations runbook (location may be outside `/docs`).

**Implementation checklist**
- [ ] Define thresholds and owners for stale official injury feed, cron dispatch failures, provider quota, model evaluation HOLD/FAIL, candidate fallback, settlement backlog and lineage mismatch.
- [ ] Send a test alert to a real monitored channel; record receipt/acknowledgment and resolution.
- [ ] Simulate provider 429/timeout, expired secret, failed cron, failed candidate, and invalid payout; demonstrate bounded recovery and no silent financial claim.
- [ ] Exercise model kill switch and return to legacy in staging; preserve run IDs and pinned versions.
- [ ] Document on-call commands, expected status, rollback procedure and incident evidence.

**Acceptance:** Two dispatches, one injected failure/recovery and one rollback drill are observable in Operations and in an archived trace.

## PR-12 [P0 final gate] Produce the NBA V1 acceptance packet

**Owner:** Tech lead + QA + model reviewer. **No new architecture changes in this PR unless a failed gate requires a fix.**

**Required artifacts**
- [ ] Exact git commit and complete source package, including `.github`, `.nvmrc`, `tests/`, lockfile and migrations.
- [ ] Passing CI URL, commands, versions and negative failure-propagation proof.
- [ ] Applied migration IDs and tenant-isolation results.
- [ ] Autonomous scouting/no-user-run trace and near-lock observation.
- [ ] Historical as-of replay proof.
- [ ] House approved candidate/canary/fallback trace with simulation and lineup linkage.
- [ ] Independent simulation holdout report with PASS/HOLD decision.
- [ ] Calibrated financial scenario path and uncalibrated fallback, both through `server/runtime.ts`.
- [ ] DraftKings legality and payout reconciliation cases.
- [ ] Entered lineup → settled results → diagnostics → reviewed proposal → HOLD/canary trace.
- [ ] Browser E2E screenshots/videos and operations alert/rollback evidence.
- [ ] Final signed exception log: every unresolved item marked blocking or explicitly out of NBA V1 scope, with reviewer approval.

**Acceptance:** All required gates G0–G8 have verified evidence; zero unresolved P0 blockers; tech lead, QA and model reviewer sign off. If a test fails, record the actual result and **do not assign 100/100**.

---

## Acceptance scorecard (use the original 100-point rubric; do not inflate points)

| Gate | Max | Required sign-off evidence | Result |
|---|---:|---|---|
| G0 Reproducible build/CI | 10 | PR-01 green CI, negative check | ☐ |
| G1 Continuous Street Team | 15 | PR-04 schedule + near-lock traces | ☐ |
| G2 Temporal intelligence | 10 | PR-05 replay + isolation tests | ☐ |
| G3 NBA House | 20 | PR-06 driver/canary/fallback proof | ☐ |
| G4 Connected simulations | 10 | PR-07 holdout and release gate | ☐ |
| G5 DK Lineup Agent | 15 | PR-02/08 financial path + legal exports | ☐ |
| G6 Learning governance | 10 | PR-09 settled case + reviewed decision | ☐ |
| G7 User experience | 5 | PR-10 browser E2E evidence | ☐ |
| G8 Operations/E2E | 5 | PR-03/11/12 health + drills + sign-off | ☐ |
| **Total** | **100** | **All gates evidenced** | **__/100** |

### Non-negotiable engineering invariants

1. LLMs gather, classify and explain; deterministic statistical engines perform simulations; optimization engine chooses legal portfolios.
2. Unsupported behavioral/revenge narratives remain **report-only**; no arbitrary numerical uplift.
3. As-of historical evaluation must never access post-lock facts.
4. Missing or uncalibrated contest-field evidence means **unknown EV**, not an invented expected return.
5. Every model promotion is reviewed, versioned, reversible and auditable.
6. Realized ROI uses only confirmed entries and verified settlement amounts.
7. Multi-tenant data access and provider credentials remain isolated.
8. NBA + DraftKings V1 is the release scope; NFL/MLB Houses and podcast are future phases, not blockers.

### Suggested handoff order

**Sprint A:** PR-01, PR-03, PR-04.  
**Sprint B:** PR-02, PR-05, PR-06.  
**Sprint C:** PR-07, PR-08, PR-09.  
**Sprint D:** PR-10, PR-11, PR-12.  

This is an ordering recommendation, not a time estimate. Parallelize only where test data and contracts are stable. A complete acceptance packet—not code volume—is the criterion for moving from provisional 90/100 to verified 100/100.
