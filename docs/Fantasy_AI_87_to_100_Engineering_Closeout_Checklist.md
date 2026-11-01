# Fantasy AI — Engineering Closeout Checklist: 87 → 100

**Target:** NBA + DraftKings V1 Multi-Agent Sports Intelligence System  
**Audience:** Engineering lead, junior full-stack engineers, data/ML engineer, QA  
**Baseline:** October 30, 2026 updated application ZIP + separately supplied `tests.zip`  
**Status:** Closeout in progress. Implementation notes below distinguish code and local-test evidence from staging, historical-data, production and reviewer acceptance. The worksheet must not be marked accepted without its required evidence.
**Scope:** NBA Street Team, intelligence history, NBA House, game simulations, DraftKings Lineup Agent, learning loop, operational UI and observability. NFL/MLB Houses and podcast are explicitly **out of V1 scope**.

### Current closeout evidence — 2026-10-31

The repository contains code-level work for G0–G8 and deterministic checks for the implemented code paths, but this plan's evidence rules do not permit treating code presence or fixture tests as full acceptance. Local verification on installed Node `v22.22.2` (satisfies the declared `>=22.12.0` engine range): `npm run test:all` passed **16/16** groups, including the G0 failing-fixture negative control; `npm run lint`, `npm run build`, and `npm run check:server` passed. The production build reports a large JavaScript chunk warning (>500 kB). The `.nvmrc` pin is `22.12.0`; that exact binary was not installed, so validation used the available compatible Node 22 patch. A first build under Node `20.13.1` emitted Vite's unsupported-runtime warning and was repeated successfully under Node 22.

| Gate | Verified in this workspace | Still required before acceptance |
|---|---|---|
| G0 | Pinned runtime, fail-fast CI workflow, complete local test runner/report, regression fixtures and negative control; all deterministic test groups pass locally. | Fresh-clone `npm ci`, a hosted CI run URL, repository commit/PR and reviewer approval. Current worktree is not clean. |
| G1 | Independent ESPN schedule repository/sync state, dispatcher and policy tests, refresh gating and telemetry code. | Verified provider daily budget; deployed cadence and two successive dispatch observations; staging pre-lock collection/recovery evidence. Automatic provider collection stays fail-closed without the budget. |
| G2 | Bitemporal repository/API and deterministic lineage tests. | Staging database replay report, immutable seeded correction/conflict cases and direct cross-tenant/RLS evidence. |
| G3 | Synthetic approved-minutes-cap fixture and adapter/fallback governance checks. | Real eligible holdout and signed end-to-end runtime trace. Candidate routing remains shadow-only under the approved rollout constraint. |
| G4 | Reproducible evaluator and HOLD/promotion gates. | Current evaluation reports **HOLD** with 0 holdout player rows, 0 independent slates/games; verified historical pairs are still needed. |
| G5 | Contest provenance gates, bounded joint search, legality and settlement tests. | Independently verified contest terms for tested contests and independent historical slate backtest. The user-provided DraftKings screenshots/URL do not constitute a complete historical performance set. |
| G6 | Point-in-time dataset, diagnostics, evidence-gated proposals and frozen holdout code/tests. | Independent historical holdout and reviewed settlement-to-proposal decision trace. Shadow-only remains in force. |
| G7 | Evidence/status surfaces and operator-guarded Operations route/API. | Browser task-smoke suite, staging user journeys, accessibility audit and screenshot/video evidence. |
| G8 | Tenant-scoped Operations API/dashboard, explicit unavailable telemetry, deterministic tests and runbook. | Staging end-to-end trace, scheduled dispatch evidence, external alert delivery, recovery/rollback rehearsal and reviewer sign-off. Staging was explicitly declined. |

**Decision:** G0–G8 are **not certified 100/100**. The user has accepted the historical-data constraint and plans to perform live testing; that does not supply historical holdout, deployment, staging, accessibility, or independent review evidence. No production deployment or migration was performed in this closeout turn.

The ticket file lists and unchecked boxes below preserve the original plan. They are not a fresh assertion that every listed code task is still missing; use the implementation notes and evidence table above to distinguish completed local work from open integration/acceptance work.

## 0. How to use this document

This is a **gap-closing** plan, not a greenfield rewrite. Preserve working Supabase, Vercel, React, provider integrations, existing engine contracts and current sports support. Apply tasks in order; each ticket is independently reviewable, but cross-service activation must wait for its release gate. Every ticket needs a pull request, automated tests, staging evidence, reviewer sign-off and an explicit rollback path.

### What “100/100” means

The previous **87/100** is a provisional implementation-coverage estimate, not a measured prediction-quality score. Reaching **100/100 architectural alignment** requires passing *all* V1 acceptance gates below, including demonstrated runtime integration and honest uncertainty handling. It **does not** mean profitable DFS results are guaranteed, all scouting stories produce numerical adjustments, or a candidate model must beat the baseline. A model that fails holdout validation must remain in shadow/HOLD while the system earns credit for correctly enforcing that gate.

**Evidence rules:** `IMPLEMENTED` = code exists; `TESTED` = deterministic automated checks pass; `INTEGRATED` = staging trace proves upstream/downstream behavior; `ACCEPTED` = owner reviews artifact and rollback. Never close a ticket at `IMPLEMENTED` alone. Never fabricate an expected value, official injury status, provider confirmation, calibration result, or model improvement.

### Work ownership

- **ENG-PLATFORM:** CI, deployment, scheduling, secrets, monitoring, feature flags.
- **ENG-DATA:** game discovery, collection, provenance, bitemporal replay, migrations.
- **ENG-HOUSE:** NBA projections, driver policy, model registry, simulation calibration.
- **ENG-LINEUP:** contest contracts, optimizer, financial modeling, portfolio outcomes.
- **ENG-FRONTEND:** product UI and QA automation.
- **TECH LEAD:** integration reviews, schema compatibility, rollout approvals.

### Fixed non-negotiable invariants

1. No future observation can affect an earlier as-of projection or backtest.
2. Unknown, conflicting, stale or unverifiable roster/availability evidence cannot silently be treated as confirmed.
3. An LLM cannot directly set fantasy projections, probabilities or contest payouts.
4. Unapproved NBA House drivers have **zero** numeric impact.
5. Every run pins its evidence snapshot, cutoff, model versions, simulation seed, optimizer version and contest terms.
6. Missing field calibration or payout terms means **expected financial return = unknown**, never an invented number.
7. Only actually entered, finally settled lineups count toward realized ROI.
8. No automatic production promotion on the basis of one contest or a single favorable backtest.
9. Every rollout has a legacy fallback and an operator-controlled kill switch.
10. All functionality is tenant-isolated, authenticated and budget-limited.

---

## 1. Delivery gates and scoring

The score is a **release acceptance rubric**, not a sum of speculative performance improvements. Assign points only after required evidence is signed off. A failed mandatory gate blocks certification of 100/100 regardless of nominal sum.

| Gate | Weight | Required proof |
|---|---:|---|
| G0 — Reproducible build and safety | 10 | Clean CI install/build/typecheck/lint + complete G0–G6 + regression tests |
| G1 — Autonomous NBA Street Team | 15 | Independently discovered game schedule, near-lock refresh, health and pre-lock eligibility |
| G2 — Point-in-time intelligence | 10 | Real database replay, source lineage, cross-tenant isolation, no future leakage |
| G3 — NBA House runtime and driver governance | 20 | Approved candidate trace, safe abstention, canary/active/rollback |
| G4 — Connected simulation validation | 10 | Reproducible holdout evaluation, uncertainty and HOLD/promotion gate |
| G5 — DraftKings portfolio decisions | 15 | Legal contests, honest EV readiness, constraints, lineup provenance and settlement |
| G6 — Learning and promotion loop | 10 | Settled-entry diagnosis → proposal → independent review → canary/HOLD |
| G7 — Complete task-oriented UI | 5 | Operator/analyst user journeys and failure states |
| G8 — Operational E2E and release readiness | 5 | Full redacted trace, alerts, budgets, runbook and rollback rehearsal |
| **TOTAL** | **100** | **All gates mandatory** |

**Recommended sequencing:** Sprint 0: G0; Sprint 1: G1/G2; Sprint 2: G3; Sprint 3: G4/G5; Sprint 4: G6/G7/G8. Parallelize only after contract tests are stable. Sprint durations are planning placeholders, not commitments.

---

## 2. G0 — CI, reproducibility and regression safeguards (10 points)

### G0.1 — Restore repository completeness and pin runtime [P0, ENG-PLATFORM]

**Baseline note:** The October 30 handoff archive did not contain `.github/workflows/ci.yml` or `.nvmrc`. The current workspace now contains both; CI pins Node from `.nvmrc`, runs lint/build/server checks and `test:all`, and uploads the machine-readable result report. The current `test:all` inventory includes G8 Operations tests.

**Files:** CREATE `.github/workflows/ci.yml`, `.nvmrc`; MODIFY `package.json` only if needed; KEEP `package-lock.json`; REVIEW `scripts/test-g0-safety.mjs`, `scripts/test-g0-ci-failure-propagation.mjs`, `tests/g0-safety.test.ts`.

- [ ] Select a supported Node version matching `package.json` `engines` (e.g., a specific supported Node 22 release), pin it in `.nvmrc` and CI. Do not use an unbounded `latest` tag.
- [ ] Confirm the complete `tests/` tree and `tests/fixtures/` are committed in the real repository, not merely distributed as a separate ZIP.
- [ ] CI on pull request and main branch: `npm ci`, `npm run lint`, `npm run build`, `npm run check:server`, then all test commands listed below. Fail on **any** nonzero exit; do not use `continue-on-error` for release gates.
- [ ] Add a `test:all` npm script if useful, but retain the individually named scripts for diagnosis. Keep secrets out of PR CI; use fixtures/mocks for external providers.
- [ ] Run `node scripts/test-g0-ci-failure-propagation.mjs` (or its documented equivalent) to prove an intentional failing test blocks merge.
- [ ] Archive machine-readable test results and attach the CI run URL to the release record.

**Commands (fresh clone):**

```bash
node --version
npm ci
npm run lint
npm run build
npm run check:server
npm run test:g0
npm run test:g1-street-team
npm run test:g2-lineage
npm run test:g3-nba-house
npm run test:g4-simulation
npm run test:g5-contest-portfolio
npm run test:g6-learning
npm run test:g8-operations
npm run test:parity
npm run test:fixtures
npm run test:contracts
npm run test:actual-sources
npm run test:auth
npm run test:p1-contracts
npm run test:p2-street-team
npm run test:p5-portfolio
```

**Acceptance:** Fresh checkout builds and all listed scripts pass; intentionally broken contract fails CI. **Evidence:** commit hash, CI URL, test report, Node version. **Rollback:** revert CI configuration without bypassing mandatory checks.

### G0.2 — Protect old sports and established behavior [P0, ENG-PLATFORM + TECH LEAD]

**Files:** `tests/engine-parity.test.ts`, `scripts/run-engine-parity.mjs`, `src/lib/engine/contracts.ts`, `server/runtime.ts`, existing `tests/p1-contracts.test.ts`.

- [ ] Save deterministic golden outputs for representative NBA Showdown, NBA Classic and at least one previously supported non-NBA slate; pin seeds and provider fixture versions.
- [ ] Assert unchanged behavior when `STREET_TEAM_V2` and House candidate flags are off.
- [ ] Add tests for tenant isolation, authentication, provider timeout, stale roster, missing payout, invalid salary, duplicate entry and retry idempotency.
- [ ] Ensure API errors are structured, actionable and do not expose keys, tokens or private source payloads.

**Acceptance:** New code can be disabled and baseline runs remain legal and reproducible. **Evidence:** golden output diff and parity test output.

---

## 3. G1 — Street Team independent, continuous scouting (15 points)

### G1.1 — Discover NBA games without user-created generation runs [P0, ENG-DATA]

**Baseline note:** The October 30 handoff described a scheduler limited to generation-run contest locks. The current workspace adds an ESPN-backed schedule repository and synchronization state used independently of `generation_runs`; the tests cover schedule refresh policy. This code evidence does not prove deployed schedule synchronization or pre-lock collection in staging.

**Files:** MODIFY `api/street-team/scheduler.ts`, `server/streetTeam/scheduler.ts`, `server/streetTeam/slateGate.ts`; CREATE `server/streetTeam/nbaScheduleRepository.ts`; CREATE additive migration `supabase/migrations/<timestamp>_nba_game_schedule.sql`; EXTEND `tests/g1-street-team.test.ts`.

- [ ] Implement a provider-backed NBA schedule fetch using an **already integrated, verified** schedule source. Normalize `gameId`, `season`, `homeTeamId`, `awayTeamId`, `scheduledStartAt`, `status`, `source`, `retrievedAt`, `lastConfirmedAt`. Use UTC in storage.
- [ ] Add a tenant-scoped or shared-with-tenant-policy schedule table with `UNIQUE(provider, provider_game_id)`, provider raw reference, status, last refresh and last error. Design row-level access appropriately; avoid tenant duplication if sharing official schedule rows.
- [ ] Implement `getUpcomingNbaLocks(now, horizonHours)` from this schedule, including same-day games not associated with any `generation_runs`. If DraftKings slate lock differs from game start, store both separately; **never assume they are identical**.
- [ ] Keep generation-run lock times only as a secondary override for known DraftKings contests. Do not overwrite official game start with contest lock.
- [ ] Handle postponement, reschedule, cancellation, overtime, game-in-progress and provider outage; preserve previous schedule version with observed timestamp.
- [ ] Add an idempotent daily schedule synchronization job, plus game-day checks when a provider announces changes.
- [ ] Have the scheduler choose the nearest relevant NBA lock from schedule + known contest locks, and attach `gameId`/`slateId` to refresh requests.

**Tests:** no generation runs + scheduled game still yields refresh; postponed game updates next lock; multiple simultaneous games; daylight-saving boundary; malformed provider response; cross-tenant access. **Acceptance:** staging shows collection and a pre-lock checkpoint for an NBA game before any user opens Lineup Lab.

### G1.2 — Verify scheduler deployment, rate limits and recovery [P0, ENG-PLATFORM]

**Files:** `supabase/migrations/20261030090000_street_team_scheduler.sql`, `api/street-team/scheduler.ts`, `api/street-team/refresh.ts`, `server/streetTeam/refreshPolicy.ts`, `server/streetTeam/health.ts`, `vercel.json`, `tests/g1-street-team.test.ts`.

- [ ] Apply the existing 10-minute Supabase Cron migration in staging and verify the job is enabled; confirm Vault secret, endpoint URL and scheduler authorization are configured. Do not paste secrets into PRs or logs.
- [ ] Distinguish the 10-minute dispatcher from the daily Vercel cron. Verify at least two successive dispatcher invocations and the selected refresh decisions.
- [ ] Preserve 24-hour full/transaction, game-day availability, near-lock lineup and pre-lock verification policy; measure actual cadence rather than assuming deployment from code.
- [ ] Add retry/backoff with provider `Retry-After`, per-feed budgets, idempotency keys and concurrency lock to prevent overlapping provider calls.
- [ ] Emit health counters: `last_success_at`, `last_attempt_at`, `next_due_at`, `quota_remaining`, `stale_game_count`, `failed_collection_count`, `prelock_missed_count`.
- [ ] Alert on missing scheduled execution, stale critical feed near lock, provider authentication failure, and repeated quota rejection. Ensure operator manual refresh is authenticated and audited.

**Acceptance:** 24-hour staging evidence proves schedule discovery and 10-minute dispatch near lock, with an injected provider failure and successful recovery. **Rollback:** disable scheduler flag and fall back to legacy slate-time verification.

### G1.3 — Enforce pre-lock eligibility and source conflict policy [P0, ENG-DATA]

**Files:** `server/streetTeam/slateGate.ts`, `recheck.ts`, `conflictResolver.ts`, `entityResolver.ts`, `changeDetection.ts`, `server/runtime.ts`, `tests/g1-street-team.test.ts`.

- [ ] Resolve player identities against current official roster, team and active DraftKings pool before deeper scouting.
- [ ] Define and document source precedence: official injury/transaction > verified current roster > provider projection > secondary news/social commentary. **Source precedence never converts unknown to confirmed.**
- [ ] Return structured `READY | DEGRADED | BLOCKED` slate eligibility, with per-player reason codes and evidence IDs.
- [ ] At generation time, refresh/check availability according to contest-specific lock rules; re-evaluate when injury/starting-lineup evidence changes.
- [ ] Block illegal/ineligible players; for unresolved cases either exclude or explicitly require operator confirmation based on a documented policy. Never silently include known OUT players.
- [ ] Keep social/behavioral stories labeled as contextual and non-numeric unless separately approved.

**Acceptance:** injected late scratch removes affected player before final lineup; contradictory status blocks or degrades safely; run records the decision and sources.

---

## 4. G2 — Point-in-time intelligence and historical replay (10 points)

### G2.1 — Prove bitemporal replay against a real staging database [P0, ENG-DATA]

**Existing:** `server/streetTeam/asOfRepository.ts` separates `effective_at` (event time) and `ingested_at` (knowledge time); `api/street-team/player-team-as-of.ts` exposes replay.

**Files:** `server/streetTeam/asOfRepository.ts`, `api/street-team/player-team-as-of.ts`, `server/runLineage.ts`, `tests/g2-lineage.test.ts`; CREATE `scripts/verify-intelligence-replay.mjs` and test fixture SQL if needed.

- [ ] Seed staging with: roster trade effective Monday ingested Tuesday; injury news Wednesday; correction Thursday; a contradictory source; same player across two provider IDs; a second tenant.
- [ ] Query Monday-as-known-Monday, Monday-as-known-Thursday, Wednesday-as-known-Wednesday, and present state. Confirm the results differ only when knowledge cutoff allows.
- [ ] Apply both `effective_at <= event_cutoff` **and** `ingested_at <= knowledge_cutoff` in every historical read, including resolved facts and source corrections.
- [ ] Persist immutable source identifiers, retrieved time, original content hash, normalization version, confidence, resolution state and supersession chain.
- [ ] Ensure replay never infers historical team membership from current roster; unknown historical anchors must remain unknown.
- [ ] Verify pagination does not silently truncate evidence. Prefer stable cursor pagination or explicit incompleteness metadata.
- [ ] Check tenant isolation through direct database/API tests; enforce RLS and service-role boundary.

**Acceptance:** a redacted replay report proves no future leakage, immutable history, provenance, conflict resolution and cross-tenant isolation.

### G2.2 — Pin complete run lineage [P0, ENG-DATA]

**Files:** `server/runLineage.ts`, `server/runtime.ts`, existing lineage migrations and `tests/g2-lineage.test.ts`.

- [ ] Record `tenant_id`, `run_id`, `sport`, `contest_id`, `slate_id`, `decision_cutoff`, `knowledge_cutoff`, `snapshot_id`, `snapshot_hash`, `source_manifest_hash`, `baseline_version`, `driver_policy_version`, `house_model_version`, `simulation_version`, `simulation_seed`, `field_model_version`, `optimizer_version`, `contest_terms_hash`, `created_at`.
- [ ] Pin at run creation and never silently re-resolve a newer model or snapshot on retry. Add schema columns only where missing; do not duplicate already existing fields.
- [ ] Add lineage consistency validator: all artifacts refer to same tenant, slate, snapshot cutoff and contest rules.
- [ ] Allow replay of an old run even after provider data changes.

**Acceptance:** two identical pinned runs reproduce the same output; a newer injury update does not alter the historical run; every UI explanation links to original evidence.

---

## 5. G3 — NBA House integrated, safe and explainable (20 points)

### G3.1 — Demonstrate a real approved driver end-to-end [P0, ENG-HOUSE]

**Existing:** `server/houses/nba/baseline.ts`, `adjustments.ts`, `driverPolicy.ts`, `evaluation.ts`, `modelResolver.ts`, `runtimeAdapter.ts`; `server/runtime.ts` can select a House candidate and rerun simulation. Explicit verified minutes caps are the only numeric driver currently supported by policy; other drivers are report-only.

**Files:** all above; `api/model-evaluations.ts`; `tests/g3-nba-house.test.ts`; CREATE `tests/fixtures/nba-house-approved-minutes-cap.json` if needed.

- [ ] Build a **synthetic but realistic** fixture: player baseline 34 minutes; official confirmed minutes cap 26; current source and as-of timestamps; approved `nba-house.driver-policy.v1` policy; model registry candidate with reviewed evaluation.
- [ ] Verify the House returns expected minutes **26**, an auditable `-8` minute change, evidence IDs and policy version. Recompute fantasy distribution through the existing statistical projection engine rather than multiplying fantasy points with an arbitrary constant.
- [ ] Confirm `server/runtime.ts` passes the selected projection into game simulation, optimizer candidate scores and selected lineups. Compare with legacy using identical slate, seed and contest terms.
- [ ] Test shadow (record only), canary (deterministic subset), active (eligible traffic), fallback (missing/stale/conflicting evidence), kill switch, and pinned retry.
- [ ] Confirm unapproved model and unreviewed driver produce **no** numeric change; never enable candidates just to make this test pass.
- [ ] Correct stale report-only comments in `server/houses/nba/index.ts` if they contradict current runtime behavior; do not remove governance gates.

**Acceptance:** signed trace: source observation → resolved fact → approved driver → minutes adjustment → simulation → optimizer → lineup; legacy fallback and rollback demonstrated. **Evidence:** fixture hash, run IDs, staging screenshots/logs, registry approval record.

### G3.2 — Calibrate other contextual drivers only when justified [P1, ENG-HOUSE]

**Files:** `server/houses/nba/driverPolicy.ts`, `adjustments.ts`, `evaluation.ts`, `server/learning/evaluationDataset.ts`, `tests/g3-nba-house.test.ts`.

- [ ] For teammate OUT, starting role and rotation changes, define separate candidate features with evidence rules, minimum samples and pre-registered hypotheses.
- [ ] Build player-game historical pairs with **point-in-time** inputs, compare minutes/usage/fantasy-point error against baseline and estimate uncertainty.
- [ ] Run time-separated holdout evaluations; report sample size, mean/median error, calibration, subgroup regressions and data leakage checks.
- [ ] Promote a driver only if the reviewed evaluation passes pre-agreed thresholds and no material subgroup safety regression. Otherwise keep `REPORT_ONLY` or `ABSTAIN`.
- [ ] Preserve rivalry, contract-year, former-team and behavioral context for explanation; no numeric uplift without independent evidence.
- [ ] Add explicit policy-version compatibility checks and source expiry handling.

**Acceptance:** every active numeric driver has an approved policy/evaluation ID; unsupported effects are still visible as context but change projections by exactly zero. **Important:** Full architectural alignment does **not** require forcing these unproven drivers live.

### G3.3 — Harden model promotion and rollback [P0, ENG-HOUSE + ENG-PLATFORM]

**Files:** `server/houses/nba/modelResolver.ts`, `runtimeAdapter.ts`, `server/learning/promotion.ts`, `api/model-evaluations.ts`, `server/runtime.ts`, `tests/g3-nba-house.test.ts`.

- [ ] Define state machine `DRAFT → SHADOW → EVALUATED → APPROVED → CANARY → ACTIVE → ROLLED_BACK`; invalid transitions fail with reason codes.
- [ ] Separate model proposal approval from deployment approval; require reviewer identity, holdout dataset hash, cutoff, evaluation metrics and timestamp.
- [ ] Pin canary allocation deterministically using tenant/run key and version; log assignment and ensure retries cannot switch models.
- [ ] Fail closed to legacy on model registry outage, incompatible schema, missing source or bad numeric output. Do not silently blend models.
- [ ] Test emergency disable under active traffic and restore baseline within the agreed operations target.

**Acceptance:** a reviewed model can be promoted and rolled back in staging; an unapproved model never affects live output.

---

## 6. G4 — Full-game simulations: validation before trust (10 points)

### G4.1 — Establish repeatable historical evaluation [P0, ENG-HOUSE]

**Existing:** `server/houses/nba/simulationService.ts`, `simulationEvaluation.ts`, `src/lib/engine/gameSimulation.ts`, `scripts/evaluate-nba-simulations.mjs`, `tests/g4-simulation.test.ts`.

- [ ] Freeze a documented holdout cohort of completed NBA games and associated **pre-lock** snapshots; exclude post-lock facts from model inputs.
- [ ] For each slate, run a reproducible fixed-seed simulation batch at the agreed production scenario count; capture run duration and provider/API cost.
- [ ] Evaluate player minutes, fantasy-point P10/P50/P90 coverage, team totals, pace, blowouts, overtime, correlated player outcomes and lineup tail scores.
- [ ] Compare against the current legacy simulation using identical slates, seeds and scoring rules. Record calibration, error, Monte Carlo standard error and worst-case subgroups.
- [ ] Publish versioned `PASS | HOLD | FAIL` decision; a HOLD must keep the legacy model in control. No retrospective tuning on the same untouched holdout.
- [ ] Add synthetic scenario tests: teammate scratch, blowout, overtime, star minutes cap, game cancellation, low-minute bench player, simultaneous usage changes.

**Acceptance:** one reproducible evaluation report, code/fixture hashes, seed, summary metrics and reviewed release decision. **Do not claim calibration based only on deterministic fixture tests.**

### G4.2 — Ensure coherent scenario propagation [P1, ENG-HOUSE]

**Files:** `server/houses/nba/simulationService.ts`, `src/lib/engine/gameSimulation.ts`, `server/runtime.ts`, `tests/g4-simulation.test.ts`.

- [ ] Ensure all players in the same game share a game-level scenario (pace, scoring environment, blowout, overtime), not independent fantasy-point rolls.
- [ ] Verify team/player minutes and opportunity totals remain physically plausible; overtime minutes may exceed regulation caps where applicable, but individual restrictions must be respected.
- [ ] Use the same scenario IDs when scoring competing lineups; preserve correlation for contest comparisons.
- [ ] Guard against NaN/Infinity, negative minutes, invalid probabilities and empty sample sets. Flag simulation status if budget truncates sample count.

**Acceptance:** deterministic correlation and conservation tests pass; the optimizer receives labeled, internally consistent simulation samples.

---

## 7. G5 — DraftKings contest and portfolio optimization (15 points)

**Implementation status — 2026-10-31:** Code-level work is implemented for explicit contest-term provenance, fail-closed payout readiness, bounded joint portfolio search and constraints, exact entered-entry settlement links, refunds, and independent final-entry legality checks. G5 automated tests and production build have passed in this workspace. G5 is **not accepted/complete**: verified provenance for current contest-specific terms and an independent historical slate set for selector backtesting are absent. The previously verified linked migration history showed local and remote migrations matching through `20261031070000_g5_g6_ties_refunds_and_decision_terms.sql`.

### G5.1 — Validate actual contest terms and legal rosters [P0, ENG-LINEUP]

**Files:** `server/lineupAgent/contest.ts`, `contracts.ts`, `server/runtime.ts`, `src/lib/engine/optimizer.ts`, `src/lib/engine/selection.ts`, `tests/g5-contest-portfolio.test.ts`.

- [ ] Support NBA Showdown and Classic as distinct rulesets; verify position/roster slots, salary cap, captain multiplier for both captain points and salary, team/game constraints, lock and late-swap rules **against current contest-specific DraftKings terms**.
- [ ] Validate player pool/salary data freshness and source. Contest metadata must include contest ID, field size, max entries, fee, payout tiers, tie rules and applicable lock.
- [ ] If contest details cannot be obtained, require explicit import/manual input with provenance and verification; never invent entry fee or payouts.
- [ ] Reject duplicate player within lineup, invalid captain designation, ineligible positions, salary over cap, player outside pool, and entry count over verified limit.
- [ ] Preserve original rule/contest snapshot with run for settlement and replay.

**Acceptance:** fixture suite includes legal/illegal Showdown and Classic, captain math, contest revisions and missing-payout fallback; final exported lineup passes a second independent legality validator.

### G5.2 — Improve joint portfolio decisions without claiming false optimality [P1, ENG-LINEUP]

**Baseline note:** The October 30 handoff described portfolio selection as delegating to `selectLineups`. The current workspace contains bounded joint portfolio search and shared-scenario scoring while continuing to report `globalOptimalityClaimed: false`. Historical backtesting remains unavailable, so this does not establish live performance or global optimality.

**Files:** `server/lineupAgent/portfolioOptimizer.ts`, `expectedValue.ts`, `fieldModel.ts`, `src/lib/engine/selection.ts`, `tests/g5-contest-portfolio.test.ts`; OPTIONAL CREATE `server/lineupAgent/portfolioSearch.ts` if separate search materially simplifies implementation.

- [ ] Define portfolio objective precisely: expected **total net contest return** across selected entries, with explicit treatment of correlation, duplication, overlap and exposure. Show cash probability and tail risk as diagnostics, not interchangeable with profit.
- [ ] If calibrated opponent-field scenarios and complete payouts exist, evaluate **joint** candidate portfolios against common simulated contest scenarios; calculate total payout minus all entry fees, including tie handling and correlated outcomes.
- [ ] Implement a bounded search (beam, local swap or exact search for small candidate sets) over combinations of legal lineups; compare with current greedy/selection fallback on the same scenario batch.
- [ ] Enforce max entries, max exposure, lineup overlap, locked slots and duplicate constraints in candidate generation and final selection.
- [ ] Return `COMPLETE | PARTIAL | BLOCKED`, search budget, selected count, objective type, estimated return uncertainty and `globalOptimalityClaimed=false` unless mathematically proven.
- [ ] When field model/payout readiness is insufficient, keep `expectedProfit` and portfolio EV **null**, select by transparent score/upside policy, and label fallback clearly in UI.
- [ ] Backtest the new selector on independent historical slates; only activate if it meets pre-agreed non-regression criteria. Do not optimize to a small handpicked set of winning contests.

**Acceptance:** 1, 2 and 4-entry portfolios are legal, deterministic and satisfy constraints; joint evaluation is demonstrably different from independently picking the top N in at least one controlled fixture; null EV remains null without readiness.

### G5.3 — Prove entered-lineup and contest settlement lifecycle [P0, ENG-LINEUP]

**Files:** `api/lineup-portfolios.ts`, `api/lineups/[lineupId]/result.ts`, `api/results/[lineupId].ts`, `api/results/import.ts`, `api/results/import-field.ts`, `server/learning/portfolioOutcomes.ts`, `tests/p5-portfolio-results.test.ts`.

- [ ] Distinguish `GENERATED`, `USER_CONFIRMED_ENTERED`, `NOT_ENTERED`, `PENDING`, `SETTLED`, `DISPUTED`, `CANCELLED`; adapt to existing enum names rather than duplicating them.
- [ ] Record actual entered lineup ID, contest ID, entry fee, entry timestamp, original lineup and roster-slot snapshot. Never infer entry from lineup generation.
- [ ] Import actual DK scoring and contest payout evidence; reconcile score, rank, ties, payout, refunds, late swaps and duplicate entries.
- [ ] Make settlement idempotent and auditable. Re-importing the same contest must not double-count fees or payouts.
- [ ] Calculate realized net profit = verified payout + refunds − verified entry fees; realized ROI = net profit / entry fees for settled entered records only.

**Acceptance:** historical redacted case yields exact reproducible fee, payout and ROI; unentered/unsettled lineups are excluded.

---

## 8. G6 — Closed learning loop and governance (10 points)

**Implementation status — 2026-10-31:** Point-in-time paired evaluation, missing-data-safe metrics, slate-clustered intervals, exact settled-entry joins, association-only diagnosis labels, proposal evidence gates, and frozen chronological holdout checks are implemented and covered by automated tests. G6 is **not accepted/complete**: the available database does not establish the required independent historical holdout, and proposals remain separate from runtime routing. The previously approved rollout constraint remains shadow-only until NBA validation passes; staging was explicitly declined.

### G6.1 — Produce point-in-time evaluation and diagnosis [P0, ENG-HOUSE + ENG-DATA]

**Files:** `server/learning/evaluationDataset.ts`, `diagnostics.ts`, `contracts.ts`, `server/learning/portfolioOutcomes.ts`, `api/learning/calibration.ts`, `tests/g6-learning.test.ts`.

- [ ] Build evaluation rows from pinned pre-lock run inputs and **final verified** player actuals; separate statistical accuracy from contest financial outcomes.
- [ ] Report minutes error, usage/role error, fantasy-point error, simulation interval coverage, lineup score error, contest cash rate, realized net return and sample counts.
- [ ] Attribute errors cautiously: `SOURCE_MISSING`, `LATE_INJURY`, `MINUTES`, `USAGE`, `SIMULATION`, `FIELD_MODEL`, `OPTIMIZATION`, `SETTLEMENT`, `UNKNOWN`; avoid asserting causality from correlation alone.
- [ ] Segment by game type, player role, injury return, contest field size and model version. Include confidence intervals where practical.
- [ ] Exclude unresolved, cancelled or nonentered records from realized-return denominators.

**Acceptance:** independently reproducible historical evaluation, no leakage, no missing-data values silently converted to zero.

### G6.2 — Demonstrate review → candidate → holdout → canary/HOLD [P0, ENG-HOUSE]

**Files:** `api/learning/proposals.ts`, `server/learning/promotion.ts`, `api/model-evaluations.ts`, `server/houses/nba/modelResolver.ts`, `tests/g6-learning.test.ts`.

- [ ] Generate a structured proposal from repeated diagnosed errors: feature/driver, rationale, sample cohort, candidate model version, expected improvement and risks.
- [ ] Require independent time-separated holdout evaluation with frozen dataset hash and predeclared metrics.
- [ ] Keep proposal approval separate from model deployment approval. Persist reviewer, timestamp, version and reason.
- [ ] Demonstrate both branches: failing candidate remains HOLD; passing candidate receives reviewed canary authorization and deterministic rollout.
- [ ] Re-run evaluation after canary exposure; monitor regressions and trigger rollback on configured thresholds.

**Acceptance:** one redacted end-to-end settlement-to-proposal-to-decision case, plus a negative test proving no automatic promotion on a single good outcome.

---

## 9. G7 — Operator-friendly product UX (5 points)

**Implementation status — 2026-10-31:** Street Team now shows independent upcoming schedule rows, schedule last/next sync, last collection success, contest lock, source freshness and near-lock alerts. Run detail exposes portfolio objective/search budget/EV readiness and persisted independent lineup validation; NBA House, Learning and portfolio results expose their evidence and HOLD/unavailable states. The tenant/operator-scoped Operations API is enforced server-side and its React route is now wrapped in the existing `AdminGuard`. **Acceptance remains open:** no browser-based task smoke suite, staging user journeys, screenshots, or accessibility audit were run.

### G7.1 — Show state, lineage and limitations without raw JSON [P1, ENG-FRONTEND]

**Files:** `src/pages/StreetTeamPage.tsx`, `NbaHousePage.tsx`, `RunPage.tsx`, `LearningPage.tsx`, `src/components/PortfolioResults.tsx`, `src/components/ModelChangeProposals.tsx`.

- [ ] Street Team: last successful refresh, next refresh, games being watched, stale/unknown/conflict warnings, sources, timestamps and pre-lock status.
- [ ] NBA House: baseline vs candidate minutes/points, driver decision, evidence links, shadow/canary/active state, reason for abstention and model version.
- [ ] Lineup Lab: contest source and verified terms, legality status, financial-readiness label, score/upside fallback, selected entries, exposures, projected payout uncertainty and partial optimization warnings.
- [ ] Results: generated vs entered vs settled, fees, payouts, realized ROI and unresolved imports clearly separated.
- [ ] Learning: holdout sample size, calibration, candidate evaluation status, review history and rollback state.
- [ ] Accessible loading/error/empty states, keyboard navigation, responsive layout and source drilldown.

**Acceptance:** QA can complete NBA Showdown from scouting to lineup confirmation to historical results review without using the database console. Record screenshots or short videos and accessibility checks.

### G7.2 — Automate task-based UI smoke tests [P1, ENG-FRONTEND]

**Files:** CREATE `tests/e2e/nba-v1-flow.spec.ts` (choose Playwright or existing supported harness; document any new dependency), MODIFY CI to run it against fixture-backed staging/test server.

- [ ] Test healthy, stale, conflicting, missing-payout, provider-down, unapproved-House and partial-optimizer scenarios.
- [ ] Test authorization for model approval and manual refresh; confirm unauthorized users cannot mutate governance state.
- [ ] Verify every financial number is labeled projected or realized; missing EV shows unknown rather than `$0`.

**Acceptance:** E2E tests run in CI and capture failure artifacts.

---

## 10. G8 — Operations, demonstration and release (5 points)

**Implementation status — 2026-10-31:** Added a tenant-scoped operational snapshot endpoint, `/operations` dashboard, deterministic alert/unknown-state tests, and [G8_Operations_Runbook.md](G8_Operations_Runbook.md). The dashboard reports observed refresh, schedule, model/evaluation, lineup, settlement and runtime-incident data, and labels uninstrumented measures unavailable. **Acceptance remains open:** no staging end-to-end trace, two-dispatch execution evidence, external alert delivery, injected production recovery, or rollback rehearsal was performed. Staging was previously declined and no production deployment was requested in this turn.

### G8.1 — Full end-to-end staging trace [P0, TECH LEAD]

**Files:** `server/runtime.ts`, relevant API routes, scheduler, lineage, portfolio outcomes; CREATE `scripts/verify-nba-v1-e2e.mjs` if no existing equivalent.

Run this exact scenario and preserve a redacted trace:

1. **T−24h:** NBA schedule discovers an upcoming game independently of lineup generation.
2. **T−2h:** Street Team updates roster/injury/lineup data, classifies source and writes immutable observation.
3. **T−15m:** Pre-lock recheck records eligibility decision; inject a late scratch to prove safe response.
4. **T−10m:** User selects an actual or fixture-backed DK Showdown contest with known terms and requests two lineups.
5. **House:** Load pinned evidence, calculate legacy baseline, evaluate approved and report-only drivers, resolve model routing.
6. **Simulation:** Run shared-game scenarios with pinned seed; attach validation status.
7. **Optimizer:** Produce two legal, exposure-compliant lineups, label EV readiness, persist lineage and search status.
8. **Entry:** Confirm one lineup entered and one not entered; do not record ROI for unentered lineup.
9. **Settlement:** Import verified final results, rank and payout; calculate net return and ROI only for the entered lineup.
10. **Learning:** Produce diagnostics, submit proposal, run holdout, demonstrate HOLD or reviewed canary.
11. **Rollback:** Disable House model; verify next run uses legacy without losing historical lineage.

**Acceptance:** every transition has a stable correlation/run ID, timestamp, input/output schema version, evidence reference and explicit status; independent reviewer can replay it.

### G8.2 — Alerts, budgets and production controls [P0, ENG-PLATFORM]

- [ ] Dashboard: Street Team freshness, missed locks, provider calls/budget, House selection/fallback rate, simulation error rate, lineup legality failures, settlement backlog and evaluation coverage.
- [ ] Alert ownership and escalation for stale official injury feeds near lock, scheduler failure, bad House model, impossible simulations, payout mismatch and cost spikes.
- [ ] Feature flags: Street Team V2, House shadow/canary/active, simulation candidate, financial objective and learning promotion. Document precedence and defaults.
- [ ] Staged rollout: shadow → limited canary → reviewed active, with monitoring windows and manual rollback; avoid automatic full rollout based on a single slate.
- [ ] Record costs per scouting refresh, model evaluation and lineup generation; enforce daily provider budget and retry ceilings.
- [ ] Publish runbook with commands for refresh, replay, model rollback, settlement correction and recovery from failed migrations.

**Acceptance:** on-call engineer completes a rollback drill in staging and confirms restored baseline; dashboard and alert examples are attached.

---

## 11. Canonical handoff contracts

Do not add redundant tables or incompatible API types if existing contracts already represent these fields. Treat the shapes below as **required semantic fields**, mapped to existing TypeScript/Supabase contracts where possible.

### 11.1 Street Team observation → NBA House

```ts
type IntelObservation = {
  id: string; tenantId: string; sport: 'NBA'; subjectId: string;
  factType: string; value: unknown; sourceName: string; sourceRef: string;
  sourceClass: 'OFFICIAL_CONFIRMED' | 'SECONDARY' | 'SOCIAL_CONTEXT';
  confidence: number; effectiveAt: string; ingestedAt: string;
  expiresAt?: string; supersedesId?: string; contentHash: string;
};
type HouseEvidenceRequest = {
  tenantId: string; slateId: string; eventCutoff: string;
  knowledgeCutoff: string; snapshotId: string; snapshotHash: string;
};
```

**Rules:** explicit source provenance; UTC; deterministic identity mapping; no observations after either cutoff; conflicts stay visible.

### 11.2 House candidate → simulation/optimizer

```ts
type HouseProjectionDecision = {
  tenantId: string; runId: string; playerId: string;
  baselineModelVersion: string; houseModelVersion: string;
  driverPolicyVersion: string; snapshotId: string;
  baselineMinutes: number; selectedMinutes: number;
  baselineFantasyPoints: number; selectedFantasyPoints: number;
  driverDecisions: Array<{
    driverType: string; decision: 'APPLY' | 'REPORT_ONLY' | 'ABSTAIN';
    evidenceIds: string[]; delta: number | null; reasonCode: string;
  }>;
  routing: 'LEGACY' | 'SHADOW' | 'CANARY' | 'ACTIVE' | 'FALLBACK';
  asOf: string;
};
```

**Rules:** House does not invent data; only reviewed drivers may change numeric values; simulation consumes the **selected** projection version; full run lineage is persisted.

### 11.3 Portfolio → results → learning

```ts
type PortfolioDecision = {
  tenantId: string; runId: string; contestId: string; contestTermsHash: string;
  requestedEntries: number; selectedLineupIds: string[];
  optimizerVersion: string; simulationSeed: string;
  objective: 'MAX_EXPECTED_NET_RETURN' | 'SAFE_SCORE_UPSIDE';
  financialReadiness: 'READY' | 'UNVALIDATED' | 'UNAVAILABLE';
  expectedNetReturn: number | null;
  searchStatus: 'COMPLETE' | 'PARTIAL' | 'BLOCKED';
};
type SettledEntry = {
  tenantId: string; lineupId: string; contestId: string;
  entered: boolean; settlementStatus: 'PENDING' | 'SETTLED' | 'DISPUTED';
  entryFee: number | null; payout: number | null;
  refund: number | null; netProfit: number | null;
  actualScore: number | null; actualRank: number | null;
  verifiedSourceRef?: string;
};
```

**Rules:** `expectedNetReturn=null` if uncalibrated; `netProfit=null` unless actually entered and settled; zero payout is a valid verified result and must not be confused with missing payout.

---

## 12. Exact engineering PR order

| PR | Scope | Depends on | Gate |
|---|---|---|---|
| PR-01 | CI workflow, `.nvmrc`, complete tests, regression baselines | None | G0 |
| PR-02 | Independent NBA schedule repository and migration | PR-01 | G1 |
| PR-03 | Scheduler integration, deployed cron verification, alerts | PR-02 | G1 |
| PR-04 | Pre-lock eligibility and conflict integration | PR-02 | G1 |
| PR-05 | Bitemporal staging replay and pinned lineage | PR-01 | G2 |
| PR-06 | Approved minutes-cap end-to-end House fixture and runtime trace | PR-04, PR-05 | G3 |
| PR-07 | Model registry state machine, canary and rollback | PR-06 | G3 |
| PR-08 | Paired full-game simulation holdout and scenario invariants | PR-06 | G4 |
| PR-09 | DK contest legality and terms verification | PR-01 | G5 |
| PR-10 | Joint portfolio EV search with safe fallback | PR-08, PR-09 | G5 |
| PR-11 | Entered/settled lineup reconciliation | PR-09 | G5 |
| PR-12 | Evaluation dataset, diagnostics and governed proposals | PR-07, PR-08, PR-11 | G6 |
| PR-13 | Street Team/House/Lineup/Learning UI and E2E | PR-03, PR-06, PR-10, PR-12 | G7 |
| PR-14 | Full NBA V1 trace, monitoring, rollback and sign-off | All | G8 |

**Note:** PR-06 can demonstrate the reviewed minutes-cap policy with fixture data even when real holdout performance is insufficient to activate the House in production. PR-07 must retain HOLD in that case. A failed candidate is not a failed safety gate.

---

## 13. Mandatory ticket template (copy into GitHub)

```md
## Ticket ID / title
## Gate / priority / owner
## Current behavior (file + function)
## Target behavior
## Files to modify/create
## Ordered implementation steps
- [ ] ...
## Schema/API changes and compatibility
## Test cases (positive, negative, retry, tenant, as-of)
## Observability / failure handling
## Rollback plan
## Acceptance criteria (observable, measurable)
## Evidence links (CI, staging run ID, screenshots, evaluation)
## Reviewer and sign-off
```

### Required pull request review checklist

- [ ] Existing behavior and data providers preserved; no unnecessary duplicate architecture.
- [ ] TypeScript and API contracts are backward compatible or migrated safely.
- [ ] No cross-tenant access or secret exposure.
- [ ] No future leakage; as-of cutoff enforced.
- [ ] Reproducible seeds and model versions persisted.
- [ ] Negative cases tested (stale, conflict, rate limit, payout missing, bad model).
- [ ] No unreviewed projection adjustments or invented financial values.
- [ ] Migrations are additive, idempotent where feasible, and staging-tested.
- [ ] Feature-flag/rollback behavior proven.
- [ ] CI and staging evidence attached.

---

## 14. Final 100/100 acceptance worksheet

Engineering lead must fill **actual evidence**, not simply check boxes based on code presence.

| Gate | Points | Accepted? | Evidence URL / run ID | Reviewer |
|---|---:|---|---|---|
| G0 | 10 | [ ] | | |
| G1 | 15 | [ ] | | |
| G2 | 10 | [ ] | | |
| G3 | 20 | [ ] | | |
| G4 | 10 | [ ] | | |
| G5 | 15 | [ ] | | |
| G6 | 10 | [ ] | | |
| G7 | 5 | [ ] | | |
| G8 | 5 | [ ] | | |
| **TOTAL** | **100** | **[ ] All accepted** | | |

**Sign-off questions:**

1. Does scouting run without a user-created contest, with real NBA schedule discovery?
2. Can we prove an injury/roster fact was known **before** lock and trace its original source?
3. Does an approved House driver alter the correct projection and reach lineup selection, while an unapproved driver remains non-numeric?
4. Do simulated games preserve shared scenarios and have a reproducible independent calibration report?
5. Are all selected DraftKings lineups legal for their specific contest, with honest EV availability?
6. Can we reconcile an actually entered lineup to exact verified financial settlement?
7. Can a reviewed proposal safely stay HOLD, or enter a controlled canary, and be rolled back?
8. Can an operator understand status, uncertainty, evidence and failures in the UI?
9. Does CI pass from a clean checkout and does an intentionally failing test block release?
10. Can a reviewer reproduce the complete NBA V1 trace from stored versions and evidence?

**Release decision:** Mark **100/100 architectural alignment** only when all nine gates pass and every sign-off question is supported by attached evidence. A lower score remains appropriate if deployment evidence, validation or integration is missing, even if all planned code has been merged.

---

## Appendix — Source-specific notes and audit limitations

This handoff began from the October 30 application package and separately provided `tests.zip`, plus the 87/100 audit. The baseline descriptions and “Observed” statements in this document refer to that package, not necessarily the current workspace; implementation-status notes record later verified changes. The supplied user constraint remains: no further historical DraftKings data is available, and live testing will be performed by the user. That constraint does not create historical holdout or staging evidence. **Do not treat code, local tests, migration history, or assumptions of provider/database availability as proof of successful end-to-end deployment.**

**Baseline audit facts (re-check against current code before relying on them):**
- The old G1 generation-run-only schedule statement has been superseded by the current ESPN schedule repository and schedule-sync state; deployment cadence is still unverified.
- The House driver policy supports only evidence-backed approved minutes caps for numeric changes; contextual effects remain report-only absent independent validation.
- The old G5 greedy-selection statement has been superseded by bounded joint portfolio search; global optimality is explicitly not claimed and historical backtesting remains unavailable.
- `.github/workflows/ci.yml`, `.nvmrc`, and the G0–G8 deterministic scripts are present in the current workspace. A CI run URL, clean-checkout evidence, pull request, and reviewer sign-off have not been recorded here.
