# Fantasy AI / FDS — Engineering Implementation Checklist

Prepared October 21, 2026 from the Fantasy AI repository and reviewed implementation findings, including its active server orchestration. This is an implementation handoff, not a statement that these changes have been implemented or validated in production.

## 1. Assignment, scope, and completion rules

Improve the reliability and quality of DraftKings lineup generation, make verified game/team/player context usable by the model, explain the actual selection, support player photographs and legal late-scratch alternatives, and detect provider integration changes on a monthly schedule.

No engineering plan can guarantee error-free implementation or winning fantasy lineups. This checklist makes decisions explicit, supplies regression cases, and requires review and measurable release gates. Historical contest performance is required to establish whether the changes improve outcomes.

- [ ] Assign one technical lead responsible for contract approval, cross-module review, and release decisions. Junior engineers implement the bounded work packages below; they must not invent provider fields, model weights, database relationships, or authorization rules.
- [ ] Assign an owner and reviewer to every package in the execution table. Record the pull request and evidence links beside its completion box.
- [ ] Keep this document as the scope checklist. A checked item means the change, relevant tests, documentation, and review are complete—not merely that code was written.
- [ ] Treat NBA as the first validation target, while preserving MLB, NFL, WNBA, CFB, and golf behavior. Do not copy NBA rules to another sport or format without verifying that format's rules.
- [ ] Preserve existing entered-lineup history and immutable forecasts. Replacement recommendations create revisions; they do not rewrite the original submission.
- [ ] Keep prediction uncertainty and model validation status visible. Do not enable win-probability, cash-probability, or ROI claims merely because the software defects are fixed.
- [ ] Implement the monthly audit inside the deployed product. This checklist does not create a ChatGPT reminder, deploy a cron, submit DraftKings entries, or authorize automated account actions.

### Execution order and ownership boundaries

| Package | Deliverable / single owner boundary | Depends on | Completion |
|---|---|---|---|
| P00 | Reproducible baseline, fixtures, tooling inventory | None | [~] (local clean install and checks complete; hosted CI and full baseline schema inventory pending) |
| P01 | Request authorization and scheduled-job authorization | P00 | [~] (implementation complete; deployment configuration and integration gate pending) |
| P02 | Shared contracts, schema upgrades, identity, revision model | P01 | [~] (contracts and production schema migration implemented; runtime data-path exit gates pending) |
| P03 | Provider adapters, scoring rules, freshness, image enrichment | P02 | [~] (NBA recent-game adapter implemented behind the production-data gate; provider entitlement, source-use approvals, fallback rules, and permitted photo hosts remain) |
| P04 | Observation normalization, fact resolution, event linkage | P03 | [~] (pre-model resolution, provenance, conservative linking, and deterministic checks implemented; dated roster history, source-specific authority policy, and durable-fact expiry still need approved source data/policy) |
| P05 | Quantitative adjustments and projection precedence | P04 | [~] (typed supported effects, bounded aggregation, precedence, reconciliation, and trace checks implemented; AI dimension proposals, validated role-redistribution coefficients, and a production overtime-probability source remain gated) |
| P06 | Correct lineup optimization and objective semantics | P05 | [x] (current optimizer and deterministic selection implementation complete; P09/P10 must reuse its validator when those later flows are built) |
| P07 | Diagnostic field simulation and payout arithmetic | P06 | [x] (bounded slot-aware diagnostics and payout arithmetic complete for supported single-entry contests; multi-entry field metrics are safely withheld, and outcome calibration remains P11) |
| P08 | Persisted decision explanations and public response mapping | P06; P07 for diagnostic fields | [~] (per-lineup traces and selected-lineup projections are complete; replacement-candidate DTO remains coupled to P09's server-generated candidate contract) |
| P09 | Server-side late-swap planning and revision safety | P08 | [~] (authenticated planner, locked-slot optimizer path, revision confirmation, freshness-bound plans, evidence/risk payloads, and tenant-bound migration are implemented; official late-swap rules are sourced, but contest plans still fail closed unless the exact response provides its explicit boolean; dynamic upload-template export, portfolio batch validation, and the full scenario suite remain) |
| P10 | Lineup UI, photographs, explanations, swap UX | P09 | [~] (active scan integration, per-lineup explanations, metrics, image fallback, and server-backed swap actions implemented; the official template flow is documented, but no exact slate template file is available; scratch-specific alert feed and manual accessibility/device acceptance remain) |
| P11 | Official actuals, calibration joins, historical evaluation | P08; P07 for payout evaluation | [~] (multi-sport official-source adapters, NBA scoring, tenant-mapped identities, pagination, contest-aware calibration, immutable HOLD artifacts, and a production actual backfill are implemented; reconciled mismatches, missing historical forecasts, holdout sufficiency, and reviewer gates remain) |
| P12 | Monthly provider audit and normal-request health checks | P03; after P10 in default single-team sequence | [~] (handler, durable lease, canary, sanitized health records, operator view, production secrets/operator, migrations, production deployment, and enabled cron registration are verified; independent heartbeat and staging audit remain) |
| P13 | End-to-end verification, staged release, operations handoff | All above | [~] (deterministic suite, CI coverage, source/history decisions, backfill report, environment inventory, operating/rollback guidance, and production cron registration are verified; manual staging/device acceptance, independent heartbeat, and model-review gates remain) |

Use this sequence by default. If engineers work concurrently, the lead may run P11 after P08 and P12 after P03, but only after P02 contracts are merged. P03 owns provider access; P04 must consume its normalized outputs rather than writing duplicate fetchers. P05 owns projection math; P08/P10 must consume its recorded effects rather than recalculate them. P06 owns roster legality/search; P09 must reuse it rather than build a UI-only replacement algorithm. One assigned migration owner integrates all schema changes.

### Required behavior after implementation

- [ ] A run binds to the correct contest, draft group, sport, format, scoring profile, and lock rules before any player is selected.
- [ ] It collects structured player data and contextual evidence with correct identities and timestamps, resolves conflicts before modeling, and records both used and unused context.
- [ ] Numeric adjustments change explicitly named model inputs once, within documented bounds. Explanations display the final applied effect.
- [ ] The optimizer returns legal lineups ranked by the selected, accurately labeled objective, and reports search limits or infeasibility honestly.
- [ ] Every lineup has its own explanation, every selected player has a reason, and each displayed claim links to its underlying evidence or model component.
- [ ] Photos display when a verified permitted source supplies them; missing/broken photos degrade gracefully.
- [ ] A late scratch produces freshly validated alternatives for the affected lineup, respecting locked slots and actual contest eligibility—or an explicit no-legal-swap result.
- [ ] Monthly audits detect integration drift; normal scans also validate their responses so failures are not hidden until the next month.
- [ ] Official post-contest results support replayable evaluation; unvalidated motivational features and payout metrics remain gated.

## 2. Review finding coverage

The FDS-01–15 identifiers refer to the original code review. FDS-16–19 below organize the additional presentation and monitoring requirements. FDS-20–21 are additional integration risks verified while preparing this handoff; deployed database state and live lock behavior still require staging verification.

| Finding | Required correction | Package |
|---|---|---|
| FDS-01 | [x] Replace hardcoded tenant/first-member context with verified caller authorization | P01 |
| FDS-02 | Map every adjustment type to a supported numeric dimension or context-only outcome | P02, P05 |
| FDS-03 | Prevent structured minutes from overwriting evidence-derived changes | P05 |
| FDS-04 | Deduplicate stories/claims and apply bounded aggregate effects once | P04, P05 |
| FDS-05 | Link team/event/venue context to relevant games and players | P03, P04 |
| FDS-06 | Replace first-found bounded lineup enumeration with objective-aware search and honest bounds | P06 |
| FDS-07 | Add usable NBA workload inputs, prior-season handling, and role uncertainty | P03, P05 |
| FDS-08 | Correct incomplete ESPN basketball fantasy-point arithmetic | P03 |
| FDS-09 | Resolve every game in multi-game slates | P02, P03 |
| FDS-10 | Add NBA to official player-actual ingestion and evaluation coverage | P11 |
| FDS-11 | Repair contest-ID calibration join and official-result eligibility filtering | P11 |
| FDS-12 | Preserve captain slots and multipliers in opponent simulations | P07 |
| FDS-13 | Correct ties spanning paid/unpaid ranks | P07 |
| FDS-14 | Resolve facts before decisions; persist the same accepted versions | P04, P08 |
| FDS-15 | Label objective heuristics accurately; validate ownership/payout models before use | P06, P07, P11 |
| FDS-16 | Complete portrait ingestion, identity matching, coverage, and broken-image fallback | P03, P10 |
| FDS-17 | Supply per-lineup and per-player explanations tied to actual decisions | P08, P10 |
| FDS-18 | Replace unmounted, incomplete pivot component with validated server alternatives | P09, P10 |
| FDS-19 | Add monthly DraftKings compatibility audit and runtime validation | P03, P12 |
| FDS-20 | Add NBA to affected evidence/actuals/evaluation/release schema constraints | P02 |
| FDS-21 | Separate pre-lock refresh from contest-aware post-lock late swap | P02, P09 |
| FDS-22 | [~] Make clean installs reproducible for supported Node/platform combinations; a clean Node 22.22.2 `npm ci` plus build/lint now passes, while hosted Node 22.12.0/other-platform CI has not run | P00, P13 |

## P00 — Establish the baseline before changing behavior

**Existing files:** `package.json`, `package-lock.json`, `scripts/run-engine-parity.mjs`, `scripts/test-official-actual-sources.mjs`, `tests/engine-parity.test.ts`, `CLAUDE.md`, `README.md`, `server/runtime.ts`, `src/lib/engine/*`, `supabase/migrations/*`.

- [x] Create an implementation branch from the checked-out complete project. Record its commit/hash, environment versions, and dependency lockfile. Per user direction, disregard/remove the supplied archives; no `fds.zip` or `server.zip` was present under the Vibes workspace.
- [x] Inventory actual frontend, API, worker/job, provider, database, and deployment paths. Document that `server/runtime.ts` invokes deterministic selection; the separate `openAiSelection.ts` path is not currently the active selector. See `docs/P00_Baseline.md`.
- [~] Run the baseline commands in the supported environment. Clean `npm ci` and build, server typecheck, lint, actual-source, parity, replay-fixture, contract, and auth checks pass on installed Node 22.22.2. The hosted Node 22.12.0 CI run remains outstanding; FDS-22 tracks cross-platform clean-install reproducibility. See `docs/P00_Baseline.md`.
- [x] Verify the parity test entry point and committed tests. `tests/engine-parity.test.ts` already existed and passes via `scripts/run-engine-parity.mjs`; the test runner compiles to a temporary CommonJS directory and cleans it after execution.
- [x] Establish one deterministic test runner and fixture convention compatible with supported TypeScript/Node versions. `npm run test:engine`, replay fixtures, contract fixtures, and auth policy checks are available; deployed API integration tests remain in P01.
- [ ] Port the review reproductions into repository tests. The review used controlled engine inputs, not production contest histories. Preserve original failing fixtures before fixing behavior.
- [ ] Obtain the complete baseline database schema in staging. The uploaded incremental migrations are not proof that a fresh empty database has every foundational table. Staging access/schema dump is still needed.
- [x] Create sanitized replay fixtures: NBA Classic multi-game slate, NBA Showdown, WNBA, and a representative fixture for MLB, NFL, CFB, and golf. Include rules, salary rows, player IDs, game times, projections, news timestamps, availability, and expected legality. Profiles are reduced synthetic test templates, not authoritative DraftKings rules.
- [x] Check for poor-performing contest/run IDs and label the evidence appropriately. No IDs or original snapshots were supplied, so review findings remain general defects, not a proven explanation of a specific result.
- [x] Configure CI to run deterministic tests without network or paid credentials. Optional live-provider checks are not part of `.github/workflows/ci.yml`.

**Exit gate:** reproducible baseline results, working test harness, complete schema inventory, and sanitized fixtures are committed. No implementation package may silently rely on missing credentials or tables. **Status: open** until supported-runtime clean-install CI results and the full Preview/staging baseline schema are available; API/integration tests and the review-reproduction crosswalk also remain outstanding.

## P01 — Secure API and job execution

**Existing files:** `server/runtime.ts` (`tenantContext`, run access, errors); every handler under `api/`; especially `api/generation-runs.ts`, `api/runs/[runId]/process.ts`, `api/learning/weekly-report.ts`, results import and lineup mutation routes.

- [x] Replace request-free `tenantContext()` with a verified request context. Validate the Supabase access token server-side with the supported verification method; derive the user ID from the verified token, never a request body.
- [x] Resolve the selected tenant from actual membership. If multiple tenants are supported, validate the requested tenant against membership; do not choose the first membership or hardcode `floyd-dfs`.
- [x] Centralize resource authorization for runs, lineups, results, evidence, settings, and imports. Child-table reads must be authorized through a tenant-scoped parent; knowing an ID is insufficient.
- [x] Separate end-user, operator/admin, and scheduler/worker permissions. Background jobs use a dedicated service context and explicit job scope, not an impersonated first user.
- [x] Require a valid scheduler bearer secret for cron endpoints, including the existing weekly email report. Fail closed if the secret is missing. Do not treat CORS or a platform header alone as authorization.
- [x] Secure the worker process route using the intended worker identity; user-triggered processing must additionally prove run ownership and allowed state.
- [x] Validate IDs, bounded entry counts, objective enums, upload sizes, contest inputs, and JSON request bodies before database/provider work. Do not accept client-supplied tenant/user ownership fields.
- [x] Keep service-role keys server-side. Check build output and logs for accidental secret exposure; redact authorization headers and provider credentials.
- [x] Scope service-role queries explicitly by tenant; RLS cannot protect queries that bypass it. Add least-privilege policies if direct browser table access is required; otherwise retain deny-by-default access.
- [x] Make mutating jobs idempotent and enforce allowed state transitions. Use atomic job claiming/leases and unique request keys to prevent duplicate stage execution and duplicate report sends.
- [ ] Complete deployed negative and positive integration tests for expired tokens, another user's resource, unauthorized admin action, worker/scheduler secrets, and duplicate cron delivery. Unit policy cases pass; this gate requires configured Supabase test accounts and a migrated deployment.

**Progress:** authorization modes are documented in `docs/P01_Authorization_Matrix.md`; server/client auth, ownership checks, separate worker/scheduler identities, bounded requests, and a weekly report idempotency table are implemented. Migrations `20261021010000_scheduler_job_idempotency.sql` and `20261021020000_fds_single_tenant_rls.sql` are applied to linked production. `20261021030000_fds_private_storage.sql` is authored but could not be applied: the linked SQL execution role does not own `storage.objects`; a database-owner connection is needed. `FDS_TENANT_SLUG=floyd-dfs` is configured in local/prod/preview env files. Operator/service credentials and deployed integration cases remain before closing P01.

**Exit gate:** all externally callable handlers have a documented authorization mode and negative tests. Scheduling additional jobs must wait until this gate passes.

## P02 — Freeze shared contracts and upgrade storage once

**Existing files:** `src/lib/engine/contracts.ts`, `draftKingsSlate.ts`, `validation.ts`, `src/lib/floydDfsClient.ts`, `server/runtime.ts`, `server/evidenceLedger.ts`, and migrations.

**Progress:** Versioned contracts, runtime boundary validation, legacy single-event adaptation, canonical-ID/schema mapping, and serialization fixtures are implemented. The owner approved the schema/API draft on October 22, 2026. A tenant-only backup was created (34,706 rows across eight affected tables; owner-only permissions and per-table SHA-256 hashes). The production-only P02 migration was applied to the verified `floyd-dfs` project, the read-only postflight passed, and only migration `20261021040000` was recorded in remote history. No unrelated remote history was changed. See `docs/P02_Schema_and_Contracts.md`, `docs/P02_Production_Migration_Runbook.md`, and `server/schemaManifest.ts`. Live NBA insert, application-level tenant isolation, and stale-revision/concurrency tests remain out of scope for this non-live-testing pass.

### Contract design

- [x] Add versioned shared types and runtime boundary validators. Transport, domain, and database mapping ownership is documented.
- [x] Document canonical IDs and mappings for all listed entities; provider identifiers remain strings.
- [x] Represent multi-game slates with versioned `games[]`, per-player game references, and a legacy single-event adapter. Actual per-game provider identities remain P03 work.
- [x] Define `SourceObservation` with game, value/unit, source, effective/observed timestamps, identity confidence, and duplicate-cluster metadata.
- [x] Define `ResolvedFact` with canonical key, explicit resolution state, supporting/rejected observation IDs, resolution rule version, and decision time.
- [x] Define `QuantitativeEffect` with game, target dimension, operation/units, baseline/final value, evidence/fact IDs, scenario, cap, model version, outcome, and reason.
- [x] Define nullable HTTPS photo metadata with provider identity and verification/expiry timestamps.
- [x] Define `LineupExplanation` decision provenance, player reasons, evidence, effects, alternatives, risks, and missing/unused context.
- [x] Define lock state separately from player availability, including unknown state and locked assignments.
- [x] Define `SwapPlan` with source revision, entry, constraints, complete replacement roster, deltas, expiry/next lock, evidence, and explicit outcomes.
- [x] Define `ProviderHealthResult` with route, environment, sport/format, timing, schema, freshness/identity, status, retry, and compatible-success metadata.
- [x] Define a versioned API error envelope and validator; runtime responses map to safe categories and include request ID/stage/reasons.
- [x] Owner approved the schema/API draft before production rollout. Contract serialization fixture covers version, string IDs, null, zero, and omission.

### Database and revision design

- [x] Reuse the existing evidence, projection, decision, trust, evaluation, release, actual, contest-entry, and entry-link tables; no duplicate evidence ledger is introduced.
- [x] Read-only production preflight inspected the seven live sport constraints and captured prior definitions. The forward migration adds NBA while preserving the six supported sports; production postflight passed. Staging inspection is omitted under the production-only rollout decision.
- [ ] Test both upgrade-from-baseline and clean-baseline-plus-all-migrations paths. Do not edit already-applied migration history to repair constraints.
- [x] Add the required mapping, game association, photo metadata, revision, swap plan, provider health, and runtime incident schema; exact names are in `server/schemaManifest.ts`.
- [x] Tenant-specific tables and uniqueness keys carry `tenant_id`; all new P02 tables are pinned to `floyd-dfs` with restrictive RLS and browser privileges revoked. No mutable shared provider table is introduced.
- [x] Add monotonic lineup revision, parent revision/run, input/model/rules hashes, complete slot assignments, generation timestamp, and recommendation/export/confirmed-entry states.
- [x] Separate recommendation/export state from confirmed DraftKings submission state.
- [x] Add append-only revision and transaction-level stale-revision protection.
- [x] Add stable idempotency/content keys in the relevant existing and new schemas; array positions are not used as identity.
- [~] Migration applies RLS, permissions, foreign keys, indexes, and redacted-field boundaries. Tenant-only retention policy is selected in `docs/P02_Schema_and_Contracts.md`; automated expiry/deletion enforcement and provider-license-specific limits remain open.
- [x] Provide rollback instructions and a tenant-only backup workflow. The reviewed backup and production migration completed; retain the backup securely.

**Exit gate:** local contract fixtures and production schema postflight pass. NBA row inserts, application-level tenant-isolation and stale-revision behavior, and automated enforcement of the selected retention policy remain open; P02 schema implementation is complete, while data-path release verification remains open.

## P03 — Correct provider data, scoring, game coverage, and photographs

**Existing files:** `draftKings.ts`, `draftKingsSlate.ts`, `espnApiClient.ts`, `espnProjectionProvider.ts`, `espnStructuredResearchProvider.ts`, `sportsDataIoProvider.ts`, `structuredSportsProvider.ts`, `providerDiagnostics.ts`, `projectionInputs.ts`, `server/runtime.ts`, and `src/lib/floydDfsClient.ts`.

### Provider adapters and rule integrity

- [x] Keep DraftKings endpoint definitions centralized in `draftKings.ts`. A typed registry now records route template, host, query parameters, parser version, required fields, access expectation, and sanitized representative fixture for every route.
- [x] Bind contest, sport, format, game type, draft group, and player pool identities. Lobby-to-contest/group/format binding is exact; returned group and rules identity mismatches are rejected; per-player IDs remain provider-specific.
- [x] Validate HTTP status, content type, parseability, required fields, and semantic identity. All provider requests stamp retrieval time; provider failures and incomplete joins remain visible. A `200` HTML block page is rejected and is not retried.
- [x] Preserve explicit provenance when HTTP 403 uses the public lobby and salary CSV. Guessed per-sport fallback templates are explicitly unverified and the slate stays discovery-only/blocked; no replacement URL is inferred from a 403.
- [~] Validate roster/scoring/salary/captain rules from live DraftKings metadata and block incomplete profiles. Versioned NBA, WNBA, NFL, MLB, CFB, and Golf Classic/Showdown fallbacks now use sport-specific DraftKings sources and require exact live contest/draft-group identity plus that group's CSV eligibility/salary rows. MLB Showdown enforces its hitter-per-team limit; event-specific golf scoring variants remain blocked without a matching reviewed profile. Provider access/usage permission and live/manual validation remain open.
- [x] Audit CSV identity, captain/utility merges, eligibility, quoted commas/BOM, missing fields, malformed salary values, and duplicate slot IDs. Canonical player IDs and slot-specific export IDs are preserved separately.
- [x] Implement bounded timeouts and transient-only retry/backoff with jitter for DraftKings, ESPN, and SportsDataIO adapters. Permanent access, content-type, schema, and identity failures do not enter retry loops.
- [x] Keep provider calls in server-side adapters. Client code contains no provider credentials or direct provider fetches.

### NBA inputs and complete game resolution

- [~] Resolve each slate game independently using sport/date/team identities and provider game IDs. DraftKings team/opponent pairs become canonical games; ESPN events are matched one game at a time. Inputs without an explicit matchup remain unjoined and warn.
- [x] Record unmatched/ambiguous games and affected players. Name/team matches are constrained by opponent/game; ambiguity retains the existing projection and warns rather than selecting another event.
- [~] Add NBA recent-game minutes, starts, rotation role, injury/return restrictions, teammate availability, and current team membership with source timestamps where the configured provider supplies them. SportsDataIO's documented NBA per-player game-log schema is now adapted for exact-ID minutes/starts and wired behind `SPORTS_DATA_IO_DATA_TIER=PRODUCTION_VERIFIED`; account entitlement and permission to use this route are not verified. Rotation/injury and current-team history still depend on approved source coverage.
- [~] Add prior-season data fallback for early-season NBA with documented sample weighting and uncertainty. NBA current rates now blend with the prior season by `games / (games + 20)` bounded to 0.2–0.85; missing current rows use the prior season without substituting zero rates. Preseason/postseason source partitioning remains.
- [~] Handle traded players, rookies, two-way/new call-ups, recent returns, and uncertain starters. Exact provider IDs/current roster evidence are preferred; unresolved players retain missing-input uncertainty or are excluded by projection readiness. NBA workload/role history is still a provider dependency.
- [x] Extend research requests to cover slate games and player names using deterministic batches, a tenant-scoped cache, environment-configured query/batch budgets, and coverage diagnostics. Queries no longer silently stop at the first eight names; any subjects skipped by the configured budget are counted.
- [ ] Capture team schedule/rest/travel, opponent context, odds/total when licensed and available, ceremonies, former-team matchups, and contract status through dated structured observations. Provider absence must remain visible.
- [~] Preserve SportsDataIO production/scrambled-data safeguards. Season totals and workload enrichment remain gated by `PRODUCTION_VERIFIED`; an operator's attestation still requires external entitlement/integrity evidence before deployment.

### Basketball scoring and fallback priority

- [x] Move basketball scoring to one tested rules-driven function shared by fallback projection and official actual scoring. Evaluation consumes the saved actual points produced by the same scorer; Classic/Showdown multipliers remain separate lineup rules.
- [x] The shared basketball profile includes points, made threes, rebounds, assists, steals, blocks, turnovers, double-double, and triple-double. DD and TD both apply on triple-doubles; actual category thresholds use integer box-score counts.
- [x] Regression fixture: 20 points, four threes, eight rebounds, six assists, two steals, four blocks, four turnovers produces 51 NBA DK points before bonuses: `20 + 2 + 10 + 9 + 4 + 8 - 2`.
- [~] Deterministic fixtures cover the 51-point line, negative turnovers, zero/DNP-equivalent line, double-double and stacked triple-double bonuses, and unrounded category contributions. Overtime has no distinct basketball scoring rule and is covered by treating the same box-score categories identically; a separately labeled overtime case remains.
- [x] Distinguish actual/expected category counts, provider fantasy averages, and simulated outcomes. ESPN season averages now include all available linear basketball categories and explicitly exclude DD/TD bonuses rather than awarding bonuses from average box scores.
- [x] Establish input priority: compatible structured category/workload inputs first; provider FPPG only as fallback; missing/low-confidence otherwise. Late ESPN and SportsDataIO responses no longer overwrite an already populated provider FPPG.

### Portrait enrichment

- [x] Preserve recognized DraftKings image fields through `draftKingsSlate.ts` and the frontend DTO. CSV fallback is separately reported as zero-photo coverage unless its rows supply an approved image field.
- [~] DraftKings player-image fields are consumed only from the exact DraftKings player record; no ESPN URL pattern or external host is assumed. Production rights/source terms and the active feed's host list still need explicit confirmation.
- [x] Match photos only through exact DraftKings player IDs. Name-only photo matching is not used.
- [~] Persist photo metadata in the tenant-owned P02 table with configurable seven-day revalidation, tenant filtering, identity-change invalidation, and UI error invalidation. Provider cache headers/asset expiry and source usage terms cannot be checked because no image is fetched/proxied.
- [x] Only allow explicitly configured HTTPS hostnames; arbitrary hosts, ports, credentials, and non-HTTPS URLs are rejected. No image proxy was introduced.
- [x] Emit photo coverage by sport/provider/ingestion path and keep missing portraits presentation-only.

**Exit gate:** multi-game NBA joins are complete or explicitly flagged; scoring fixture returns 51 before bonuses; CSV degradation is visible; images reach the mapped lineup DTO; provider failures cannot masquerade as healthy empty results.

**Progress (October 22, 2026):** Added typed DraftKings route registry and sanitized route fixtures; strict JSON/CSV validation, exact contest/group identity checks, CSV slot IDs, explicit 403 provenance, and bounded timeout/retry controls across DraftKings, ESPN, and SportsDataIO. Unverified CSV rule templates now remain discovery-only and block lineup generation. DraftKings matchup pairs form canonical games; ESPN scoreboard joins run per game, retain event IDs, and warn for missing/ambiguous coverage. NBA prior-season rates use an explicit sample weight and missing current-season rows do not become zero rates. A bounded SportsDataIO NBA recent-game adapter now extracts minutes and starter status by exact provider ID; the official API documentation lists `PlayerGameStatsBySeason/{season}/{playerid}/{numberofgames}`. The runtime uses it only when the explicit production data-tier gate is set. The local `.env.local` contains a SportsDataIO key but no data-tier setting; entitlement is not verified. SerpAPI research now batches games/player names under environment-configured budgets, caches by tenant, and records query coverage. One rules-driven CJS scorer is shared by projection and official basketball actual scoring; regression coverage includes 51 base points, zero, DD/TD stacking, and negative turnovers. Photo metadata is tenant-scoped, allowlist-gated, configurable at seven days, passed into the DTO, and invalidated on identity mismatch or image-load failure. Local deterministic checks pass; no live provider, entitlement, or production-data tests were run. P03 remains open for SportsDataIO entitlement evidence, per-sport fallback rule approvals, DraftKings/data/photo usage permission and permitted photo hostnames, and cache-control/source terms. DraftKings' published terms restrict automated extraction and reuse of content; deployment use needs owner confirmation before enabling those flows.

## P04 — Resolve contextual facts before modeling

**Existing files:** `researchPlan.ts`, `researchAgent.ts`, `researchEvidence.ts`, `configuredResearchProvider.ts`, `webResearchProvider.ts`, `rssProvider.ts`, `espnNewsProvider.ts`, `factResolution.ts`, `server/evidenceLedger.ts`, `server/runtime.ts`.

- [x] Split observation construction/resolution from `persistEvidenceLedger`. Invoke normalization and fact resolution before adjustment/projection; persistence stores the same precomputed result.
- [x] Use typed fact keys for availability, restrictions, rest/travel, ceremonies, former-team, contracts, and conservative hashed claims. Distinct claims do not collapse into one bucket-level fact.
- [x] Normalize source URLs conservatively, remove known tracking parameters, preserve meaningful parameters, and create stable IDs without article array positions.
- [x] Keep independent source observations while resolving corroborating claims once; adjustment deduplication keys include canonical fact and effective period.
- [~] Link exact PLAYER facts and scope EVENT/TEAM claims conservatively. Dated roster-history linkage is not available: team facts without a verified player/date association remain context-only and the reason is recorded.
- [~] Avoid slate-wide application and do not infer contract status or former-team impacts. Exact historical transaction/contract verification remains unavailable until an approved effective-dated roster source is configured.
- [~] Apply versioned resolution with timestamp, identity, status-authority, and recency checks; equally trusted contradictions remain `CONFLICT`. Provider/fact-type-specific authority precedence still needs owner-approved rules.
- [x] Distinguish publication, effective, observed, retrieval, and expiry times; reject invalid/future timestamps and expired evidence at the forecast cutoff.
- [~] Configure availability (5 minutes) and context (24 hours) freshness from `.env`; provider/fact-type granularity and recheck-before-swap are deferred to P09's live swap service.
- [~] Facts are effective-dated in observation records, but contract/other durable-fact expiry still uses the context default until transaction invalidation sources and retention rules are approved.
- [x] Persist `ACCEPTED`, `CONFLICT`, `UNKNOWN`, and `EXPIRED` outcomes with source IDs and reasoning. Runtime numeric adjustment consumes accepted supporting observations only.
- [x] Treat retrieved text as untrusted and constrain LLM output to schema; reject non-canonical player/team/event IDs.
- [x] Keep atmosphere/former-team/contract claims context-only without validated numerical coefficients.
- [x] Capture the experimental-effects setting and keep context-only numeric effects at zero pending P11 validation.
- [x] Pass concrete supported role/availability signals through the typed adjustment stage; unsupported FPPG-only effects report context-only outcomes.
- [~] Deterministic checks cover duplicated and independent sources, tracking cleanup, future leakage, same-name identity handling, prompt injection/ID rejection, context-only outcomes, and stale/conflicting resolution. A traded-roster test awaits an authoritative roster-history fixture/source.

**Progress (October 22, 2026):** P04 normalization and fact resolution now run before modeling, and the same observation/fact artifacts are persisted. The runtime filters findings to accepted fact support before deterministic/AI adjustment. IDs are order-independent, URLs preserve meaningful parameters, distinct source observations corroborate one effective fact, and unresolved/unlinked context cannot make numerical changes. Deterministic checks pass for duplicate/independent evidence, future leakage, identity ambiguity, untrusted prompt text, and projection effect deduplication. **P04 remains partial** because the project has no approved dated roster/transaction feed, provider/fact-specific authority policy, or durable-fact invalidation source; swap-time freshness revalidation belongs to P09.

**Exit gate:** every quantitative adjustment references accepted pre-decision facts; event context reaches only relevant players; duplicated stories do not multiply model changes. **Status: partially met** pending dated entity linkage and source-policy decisions above.

## P05 — Repair projection mathematics and input precedence

**Existing files:** `adjustment.ts`, `projection.ts`, `projectionInputs.ts`, `openAiAdjustment.ts`, `anthropicStageFallback.ts`, `contracts.ts`, `server/runtime.ts`.

- [x] Map every emitted adjustment type to a supported input dimension or explicit `CONTEXT_ONLY`/`REJECTED` outcome. No arbitrary AI-specialist or pace coefficient reaches projections.
- [~] AI specialist output remains a typed-free contextual proposal and has zero numeric effect. A dimension proposal schema is intentionally gated until source-to-dimension rules and validated coefficients are approved; deterministic projection rejects unknown/unsupported types.
- [x] Establish the sequence: structured baseline → validated sport context → unique supported effects → one cap → scenario/category sampling → actual effect trace.
- [x] Structured minutes now establish the baseline before typed effects; later reconciliation can constrain minutes but does not overwrite them with stale context.
- [x] Deduplicate canonical fact effects, sum unique relative effects once by dimension, and cap once at ±40%.
- [x] Record requested/accepted effect, cap when applied, final value, dimension, evidence IDs, and reason; final minutes are updated after opportunity reconciliation.
- [x] Validate nonnegative finite inputs, bounded shares/probabilities/workloads, and ignore invalid sport-context multipliers with an explicit gap.
- [~] Context without a supported coefficient is numerical zero and disclosed. The existing ±40% cap is preserved as an engineering bound, not a P11-validated predictive coefficient.
- [~] Basketball reconciliation enforces regulation team-minute budgets (NBA 240, WNBA 200) without inflating incomplete pools. Explicit OT sampling supports sport-specific period lengths only when an overtime probability is supplied; no approved source currently supplies that probability in production.
- [~] Out-player redistribution is bounded to position-related same-team candidates and marked low confidence, then passes through team-minute reconciliation. A validated beneficiary allocation/usage-conservation model is still needed before claiming coherent rotation redistribution.
- [x] Supported minutes, target/carry, usage, and related role effects reach the structured model; aggregate FPPG fallback emits a context-only trace.
- [x] Preserve model path, baseline/adjusted opportunities, distribution provenance, seed/sample provenance, rules/model version, and uncertainty reasons in projection artifacts.
- [x] Simulated event samples produce reported quantiles from the same distribution; intervals are labeled quantiles, not guaranteed score bounds.
- [x] Regression: 30-minute structured baseline plus a unique 8% effect yields 32.4 before opportunity reconciliation.
- [x] Ten duplicate reports with the same canonical fact yield the same result as one report; the fixture also confirms a 30-minute baseline does not compound repeatedly.
- [~] End-to-end checks cover supported minute/target dimensions and context-only AI/FPPG/unsupported dimensions. Every enum is explicitly mapped, but not every sport/type pair has a positive validated numeric coefficient; those remain intentional context-only outcomes.
- [x] Experimental context effects remain zero unless a future validated P11 release authorizes a dimension-specific implementation; structured availability and lineup legality remain independent.

**Progress (October 22, 2026):** P05 now applies typed supported effects to explicit opportunity inputs, fixes context precedence, deduplicates canonical facts, bounds aggregate changes once, reconciles basketball minutes, samples optional NBA/WNBA overtime scenarios, and records final applied/context-only/rejected outcomes. Regression coverage includes 30 → 32.4, ten-copy deduplication, context precedence, unsupported aggregate FPPG, AI context-only behavior, WNBA overtime period sizing, and explicit provider fixtures. **P05 remains partial** for dimension-level AI proposals, validated starter-absence redistribution, and a production overtime-probability feed. No user-facing score or payout claim is validated by these engineering changes.

**Exit gate:** no silent no-op adjustment, no post-adjustment overwrite, no duplicate compounding, and persisted effects reconcile exactly with projection inputs within documented numerical tolerance. **Status: partially met** pending the model/input gates above.

## P06 — Make optimizer results legal, competitive, and honestly bounded

**Existing files:** `optimizer.ts`, `validation.ts`, `selection.ts`, `contracts.ts`, `runTrust.ts`.

- [~] One authoritative validator now protects optimizer output and deterministic selection, including salaries, required slots, eligibility, unique players, team constraints, and availability. P09/P10 swaps, exports, and reconstructed imports must call this shared validator when those flows are implemented.
- [x] Replaced first-found candidate cutoff with deterministic value-ordered search bounded by a configurable node budget. Additive `MAX_FPTS` uses a top-K incumbent and admissible slot-wise upper bounds; salary/team feasibility prunes impossible branches.
- [x] `MAX_FPTS` maximizes arithmetic expected fantasy points from modeled samples, with the same slot fantasy multipliers used by validation.
- [x] Nonlinear construction composites are fully searched only when the bounded tree is exhausted; otherwise results carry `BOUNDED`/`PARTIAL` status and no optimality claim.
- [x] Search continues past the returned candidate count up to proof by admissible bounds or the configured node budget; node work is capped through `.env`.
- [x] Emit termination reason, nodes, elapsed milliseconds, legal candidates evaluated, unique retained candidates, incumbent score, and an admissible Max FPTS upper bound/raw score gap when available. Bounded searches propagate an explicit warning into selection.
- [x] Canonicalize permutations of identical slots before scoring. Keep different slot roles (including captain and utility) distinct.
- [x] Stable lineup identity hashes canonical slot assignments, preserving captain/slot distinctions; athlete and DraftKings export identities remain separate.
- [x] Keep salary floor and portfolio max-exposure/overlap constraints enforced during deterministic selection. Reject invalid/duplicate candidate identities and disclose an underfilled portfolio when constraints cannot be satisfied.
- [x] All objective-profile dimensions are applied; `duplicationPenalty` subtracts its documented construction-score points per unit of the 0–1 ownership proxy. Ownership/leverage and `balanced_ev` remain labeled heuristic; P07 diagnostics do not choose lineups.
- [x] Deterministic selection remains the production authority. The unused AI selector is not wired into runtime; deterministic selection rejects invalid roster candidates and duplicate IDs.
- [x] UI objective labels call Balanced ranking a heuristic; objective ranking remains separate from validated payout EV. P07 field metrics are not selection inputs.
- [x] Small-instance optimizer results are compared with independently enumerated legal lineups, including expected-objective and legality checks.
- [x] Added the synthetic eight-slot/$50,000 regression: Max FPTS finds and proves the 400-point legal lineup using an admissible bound.
- [x] Determinism, multi-position eligibility, equivalent-slot permutations, captain/utility salary and scoring, exposure/overlap, invalid candidates, and runtime-budget termination have deterministic fixtures.
- [x] Request/worker search and field-simulation work are bounded through `.env`: `FDS_OPTIMIZER_MAX_SEARCH_NODES`, `FDS_FIELD_SIMULATIONS`, and `FDS_FIELD_SIMULATION_MAX_COMPARISONS`. The field comparison budget limits candidate × sample × opponent work; candidates beyond the deterministic prefix receive no metrics and the package is marked partial.

**Progress (October 22, 2026):** P06 searches past the returned shortlist, proves additive Max FPTS top candidates with an admissible bound, deduplicates equivalent slot permutations, uses one salary interpretation and candidate validator, applies all profile terms, enforces portfolio constraints in deterministic selection, and records honest search diagnostics. The eight-slot 400-point fixture, expected-points-vs-median case, bounded-search case, and portfolio fixtures pass. Request work is bounded, including P07 field-comparison cost. Migration `20261022010000` is applied to the verified Floyd DFS production project and recorded in migration history. Automated checks pass on Node 24. Production deployment `dpl_4tu7rpbxoT6Hr5ZQudEyre9FDvfh` is READY at `https://floyd-dfs.vercel.app`. **P06 implementation status: complete.** P09/P10 will consume the shared validator when those later flows are built. The production AI selector remains inactive.

**Exit gate:** small-instance optimality tests pass; all current optimizer/selection outputs validate; large-instance limits are visible; candidate count is no longer inflated by irrelevant permutations. **Status: met.** Production latency observation and later-phase consumers are tracked under release operations and their respective phases.

## P07 — Correct field diagnostics without overstating their validity

**Existing file:** `contestSimulation.ts`; shared scoring/lineup identity from P03/P06.

- [x] Preserve opponent slot assignments, athlete IDs, captain slots/multipliers, and canonical lineup identity through construction and score calculation.
- [x] Score candidate and opponent assignments through the same slot-aware scoring function. Player samples are independent in the current projection model, disclosed as such rather than represented as correlated joint outcomes.
- [x] Split tie prizes across every occupied rank; unpaid ranks contribute zero but remain in the divisor.
- [x] Regression: a two-way tie across the paid boundary shares a $2 first-place prize as $1 each; with a $1 fee expected profit and ROI are zero.
- [x] Deterministic payout fixtures cover all-paid ties, all-unpaid ties, prize conservation, first-place tie credit, and paid/unpaid boundary arithmetic. Report rank event frequency, fractional first-place credit, top-one-percent/cash events, positive-payout frequency, expected profit, and ROI separately.
- [~] Validate integer field/paid counts, candidate identities/lineups, unique and nonnegative payout ranks, payout amounts, fees, and rank coverage. Financial outputs remain absent when payout/fee inputs are incomplete. Multi-entry field simulation is explicitly unavailable until the user's full entered portfolio can be included; candidate duplicates are rejected, and field duplicate counts use canonical slot assignments.
- [x] Preserve the 2,001-entry ceiling and disclose unsupported larger fields; no large-field extrapolation is claimed.
- [x] Bound total candidate × simulation × opponent comparisons through `FDS_FIELD_SIMULATION_MAX_COMPARISONS`; return explicit partial status and omit metrics for candidates beyond the evaluated prefix.
- [x] Persist deterministic seed, sample count, standard errors, provider ownership provenance, field model, independent-sample assumption, and sport/format/scoring/roster rules hash in diagnostics.
- [x] Field metrics remain diagnostic-only; deterministic selection does not read them. Release gating and performance claims remain P11 work.

**Progress (October 22, 2026):** P07 preserves full slot roles and applies captain fantasy multipliers to candidate and sampled opponent lineups with shared scoring. Payout ties divide prizes by all tied entries, including unpaid ranks. First-place event frequency, fractional tie credit, paid-rank frequency, positive-payout frequency, profit, ROI, and standard errors are separate. Input/provenance/rules validation is recorded; missing financial inputs remain absent. Total comparison work is capped and partial candidate coverage is explicit. Multi-entry contests safely return `UNAVAILABLE` until the selected user portfolio can be included. **P07 implementation status: complete for the supported single-entry ownership model**; metrics remain diagnostic and unvalidated until P11, as designed. The migration was applied and the production deployment is READY; no manual/live user-flow testing was performed.

**Exit gate:** captain and tie regressions pass, payouts conserve the prize pool, work is bounded, and no repaired diagnostic is silently promoted into a selection guarantee. **Status: met for supported single-entry simulations; multi-entry field simulation is explicitly withheld.**

## P08 — Persist explanations from the actual decision trace

**Existing files:** `selection.ts` (`explain`, `buildExplanation`), `server/evidenceLedger.ts`, `server/runtime.ts`, `src/lib/floydDfsClient.ts`, `contracts.ts`.

- [x] Build and persist one deterministic explanation per selected lineup. The lineup candidate key binds each trace to its own selected roster; no first-lineup trace is reused.
- [x] Persist exact resolved facts, projection/model versions, rules, objective terms, rank, search diagnostics, slot assignments, and portfolio constraints in the immutable trace payload.
- [x] For selected players, include role/opportunity, matchup identifiers, slot salary/value, uncertainty, linked findings, and supported fact IDs; unsupported or context-only findings remain separately labeled.
- [x] Show baseline → final opportunity changes only from P05 projection effects marked `APPLIED`; raw requested research magnitudes are not used as realized effects.
- [x] Include source URLs and publication/effective/retrieval/expiry timestamps as distinct fields, plus confidence and accepted-support status.
- [x] Context-only accepted facts explicitly state that no validated numerical adjustment was applied.
- [x] Include evaluated alternatives, shared/changed players, objective score, salary, and a bounded-search disclaimer when applicable.
- [x] Persist mean, P20/P50/P90, salary used/remaining, objective, risks, missing inputs, and next relevant lock fields. Public DTO keeps mean and median distinct and omits unknown point/salary values rather than fabricating zero.
- [x] Omit unsupported financial predictions; the trace contains fantasy-point projections and no payout/profit claims.
- [x] Avoid double counting evidence by sourcing numerical effect rows from unique P05 applied effects, retaining canonical fact/evidence IDs.
- [x] Add deterministic recheck dependencies for availability/role/provider conflicts, scratches, workload restrictions, weather where relevant, postponements/rescheduling, and next lock.
- [x] Persist a deterministic structured trace; no generated prose is needed to establish numerical or evidence claims.
- [~] `floydDfsClient.ts` carries mean/median/intervals to selected player rows and preserves unknown values. Replacement-candidate projections are deferred until P09 provides server-validated candidate DTOs; surfacing an unvalidated pool now would imply swap eligibility.
- [x] Require audit-artifact persistence before the run completion transition; persistence errors fail the stage and prevent a success response. Evidence writes are content-addressed/idempotent.
- [x] Add parity coverage for distinct selected lineups and candidate/roster trace identity; server typecheck, engine parity, and production build pass.

**Progress (October 22, 2026):** P08's persisted explanation and selected-lineup response path is implemented: content-addressed per-candidate traces are required before run completion, returned from the owned run endpoint, and mapped to the matching lineup. Per-player mean/median/interval values remain distinct; unknown projections are omitted; recheck dependencies are explicit. Automated verification passed: `npm run check:server`, `npm run test:parity`, and `npm run build` on Node 24. **P08 core is complete; the replacement-candidate DTO remains open for P09's validated server-side candidate contract.** Historical runs without stored traces remain readable with their existing fallback narrative and no fabricated trace.

**Exit gate:** a reviewer can trace each player selection and numerical change from the UI response back to the exact pre-decision record.

## P09 — Build a server-authoritative late-swap service

**Existing files:** `api/generation-runs/[runId]/recheck.ts`, `api/generation-runs/[runId]/refresh.ts`, `src/lib/engine/optimizer.ts`, `validation.ts`, `liveState.ts`, `src/components/PivotSuggestions.tsx`, entry-link storage.

The existing refresh/recheck routes reject work after overall contest lock. That is appropriate for full pre-lock replacement, but cannot implement post-lock swaps in eligible multi-game contests. The current pivot component is unmounted and uses exact position strings, replacement salary no greater than outgoing salary, incomplete projections, and no lock validation.

- [x] Keep pre-lock full refresh behavior separate from a new explicit late-swap operation. Share provider and modeling services; do not overload a route so it silently changes its legal meaning.
- [x] Add authenticated `POST /api/lineups/[lineupId]/swap-plans` and revision-confirmation operations. Confirmation appends a local recommendation revision only and never submits to DraftKings.
- [ ] Require source lineup ID/revision, entry/contest identity, requested exclusions or triggering change, objective, and idempotency key. Fetch the authoritative stored roster server-side; never trust a client-supplied locked roster.
- [~] Obtain verified contest late-swap eligibility and individual slot/game lock state. ESPN scoreboard events cover NBA/WNBA/NFL/CFB; SportsDataIO MLB `GamesByDate` is used because ESPN MLB is edge-blocked in this deployment. Exact team-pair matching, stable provider game ID, schedule time, freshness, duplicate mapping, and postponed/cancelled status are checked; unknown/conflicting/stale state blocks. DraftKings' official help confirms eligibility is contest-specific; the adapter uses only a consistent explicit boolean from that exact contest response. A live authenticated target-contest response has not been manually confirmed, so missing/ambiguous eligibility still blocks every action.
- [x] Freeze locked player-slot assignments. The shared optimizer excludes unavailable players from open slots and preserves exact locked assignments, captain multipliers, eligibility, team/game restrictions, and full-roster salary rules.
- [x] Compute remaining budget from the full current lineup and permit retained-slot plus unused-cap reallocation; candidates are validated against full contest salary rules.
- [x] Refresh availability, research/facts, and projections from the existing server providers before solving; undefined projections are not treated as zero.
- [x] Reuse the P06 solver and validator for remaining slots; legal multi-player rebuilds are generated when available while locked players stay fixed.
- [~] The fresh run uses the existing pre-game projection pipeline. A dedicated explicit “never use live partial-game state” assertion for every supported provider/model path remains to be added before release.
- [x] Return up to three distinct legal alternatives with full roster, changed slots, salary remaining, separate mean/median deltas, risk flags, trace evidence IDs, and earliest freshness/game-lock deadline.
- [ ] For multiple saved/entered lineups, generate a plan per affected lineup and validate portfolio-level exposure/overlap across the proposed batch. Identify conflicts rather than silently exceeding limits.
- [x] Persist game-state snapshots by tenant and slate. Unmatched, stale, ambiguous, postponed, cancelled, or unsupported states fail closed.
- [x] Set plan expiry to the earliest projection freshness expiry and next unlocked game lock. Confirmation revalidates source revision, DraftKings eligibility, game state, slot locks, salary, and roster legality; expired plans cannot be extended.
- [x] Save a new append-only local lineup revision after explicit recommendation confirmation; original entry history is preserved and DraftKings submission remains separate.
- [~] Generate an actual DraftKings upload-template CSV after validation. Official help confirms templates are downloaded for the exact sport, format, and start time, and player IDs are slate-specific. No authentic target-slate template file is present in the project; do not fabricate its roster-column layout or slot identifiers. Details are in `docs/DraftKings_Eligibility_and_History_Sources.md`.
- [~] Plans refresh when explicitly requested. UI open/visible-screen refresh, 60-second watched polling, pause-on-hidden, and stop-after-last-editable-slot belong to the P10 active UI integration and are not yet implemented.
- [~] Automated coverage verifies ESPN/SportsDataIO parsing, exact mapping, stale/ambiguous/postponed fail-closed behavior, the conservative lock cutoff, explicit eligibility parsing, and locked-roster optimization. The full integration scenario matrix (including concurrency, portfolio batch conflicts, and confirmation-time expiry races) remains outstanding; no manual tests were run.

**Exit gate:** code enforces the shared validator and immutable locked slots. DraftKings' official late-swap documentation confirms eligibility is contest-specific, players lock at individual game starts, and replacement lineups must meet contest requirements. The API accepts only an explicit consistent boolean from that exact contest response and safely blocks when it is absent. The end-to-end staging gate remains unmet because no authenticated real contest response/target-slate upload template was supplied; upload export remains disabled.

**Progress (October 22, 2026):** The authenticated per-lineup late-swap operation binds to the tenant-owned entry/contest and current revision, refreshes the saved draft group, fetches source-backed availability/research/projections, reconciles and persists provider game state, and fails closed for stale/ambiguous/unknown games or contests without an explicit DraftKings late-swap boolean. DraftKings' official help is now linked in `docs/DraftKings_Eligibility_and_History_Sources.md`; its contest-specific signal is used only when returned explicitly, while unknown remains blocked. The official upload guide establishes a target-slate template flow, but its actual authenticated template is not in the repository, so export remains disabled. A conservative 15-minute pre-start cutoff, locked-slot optimizer, idempotency, failure cleanup, current-revision/lock/provider revalidation, and append-only local confirmation are covered by code/automated checks. Migration `20261022020000` is applied and recorded in Floyd DFS production. **P09 remains partial** pending an authenticated target contest/template and portfolio/concurrency acceptance; no template or contest permission is guessed.

## P10 — Connect the presentation layer to verified data

**Existing files:** `src/pages/ScanPage.tsx`, `src/components/LineupDisplay.tsx`, `ReasoningPresentation.tsx`, `PivotSuggestions.tsx`, `ExportLineup.tsx`, `InjuryReport.tsx`, `src/lib/floydDfsClient.ts`.

### Lineup overview and player rows

- [ ] Keep player portrait and team logo separate. `PlayerPortrait` already exists and is rendered; fix coverage through P03 rather than adding a duplicate avatar component.
- [x] Add image-load error handling with initials fallback and reset it when the player's URL changes. Prevent an error-retry loop and layout shift; use fixed dimensions and lazy loading where appropriate.
- [x] Use accessible image labeling: decorative portrait may have empty alt text when the adjacent name already identifies the player; team logos must not obscure the player name or status.
- [x] Display per-lineup objective, salary used/remaining, projected mean/median and interval labels, data-as-of time, next relevant lock with timezone, and validation/search status.
- [x] Put a brief “Why this lineup” summary on each lineup card. Expand to per-player reasons, evidence, quantified effects, alternatives, and conditions that require attention.
- [x] Replace `ReasoningPresentation`'s implicit `lineups[0]` focus with an explicit selected lineup/revision. Never show another lineup's evidence panel when the user changes cards.
- [x] Remove the fallback that displays arbitrary projection rows when selected player rows cannot be found. Show a mapping/data warning instead of unrelated players.
- [x] Show context-only vs applied effects clearly. Preserve uncertainty and source age. Do not describe no attached risk flag as proof of safety.
- [~] Use understandable player-facing terms; keep raw agent stages, model debugging fields, and large evidence dumps in optional diagnostics. Scan cards use lineup terms and optional evidence details; a full terminology/accessibility review remains.

### Swaps and action states

- [x] Mount the replacement UI in the active scan/lineup flow after P09 is available. Remove its existing client-side heuristic as the source of actionable suggestions.
- [x] Show a current conditional backup when verified plans are available, and a “Refresh alternatives” action. Clearly label a precomputed backup as conditional and timestamped.
- [ ] On a detected scratch, highlight affected lineups and show legal replacement cards with outgoing/incoming players, full roster changes, consistent projection delta, salary difference, deadline, and risks.
- [~] Support preview → revalidate → confirm local revision → validated export/manual DraftKings instructions. Local confirmation and details export are implemented; real DraftKings upload-template export remains blocked on a verified template contract.
- [x] Display blocked/expired/no-solution/unsupported-late-swap states with reasons. Never present a prohibited swap as clickable merely because the player is injured.
- [~] Distinguish loading, provider degraded, truly empty pool, impossible constraints, incomplete bounded search, and ordinary no-swap states. Recoverable server states are surfaced; full route-to-UI state matrix remains to be exercised.
- [x] Prevent duplicate requests; show progress and allow safe retry. Preserve scroll/selected lineup when fresh data arrives.
- [ ] Verify mobile, tablet, desktop, long names, multiple positions, missing photos, failed image URLs, keyboard navigation, focus management, screen-reader labels, contrast, and timezone formatting.
- [ ] Test that a lineup revision change refreshes its explanation/swap state atomically; no mixture of old narrative with new roster or projections.

**Exit gate:** every card explains its own roster; portraits/fallbacks work; no visible actionable swap originates from the old local heuristic; stale plans cannot be exported as current.

**Progress (October 22, 2026):** The active scan keeps an explicit selected lineup/revision for its evidence panel, constrains player rows to that roster, and separates applied effects from context. Cards show objective, salary, mean/median and interval, data time, timezone lock, and validation/search state. Portrait failure resets on URL changes and uses fixed lazy-loaded dimensions. Entered lineups can request/confirm tenant-owned swap plans; watched polling pauses while the page is hidden. Details CSV/copy remains labeled local-only. The DraftKings source and account-export flow are documented; official help confirms exact sport/format/start-time templates and slate-specific IDs, but the authenticated template file has not been captured. CI now includes contract and auth fixtures, and the watched-refresh hook warnings were fixed. **P10 remains partial** pending target-slate file support, scratch-specific alert UX, and manual accessibility/device acceptance.

## P11 — Repair actuals, calibration, and performance evaluation

**Existing files:** `scripts/backfill-player-actuals.mjs`, `scripts/officialActualSources.mjs`, `scripts/test-official-actual-sources.mjs`, `server/learningDiagnosis.ts`, `learningReport.ts`, `server/runtime.ts` (`loadCashLineCalibration`), `cashLineCalibration.ts`, `learningMetrics.ts`, `lessonPromotion.ts`, `runTrust.ts`.

### Official results and NBA coverage

- [x] Add NBA to supported official player-actual ingestion, source selection, diagnostics, schedules, and status reports. Updating a sport list without a working adapter is insufficient.
- [~] Join actuals by provider/canonical player and game IDs plus date/season. NBA canonical IDs fail closed through tenant-owned `NBA_STATS_API` mappings, and provider game IDs/date are persisted. Non-final game-state and DNP-specific records need a separate source-state ingestion path.
- [x] Use P03 rules-driven category scoring for official NBA box scores. Record source, finality, retrieval time, an exact scoring-rules fingerprint, content hash, and revisions on correction.
- [ ] Preserve production-data integrity checks, official-actual eligibility, actual revisions, and entry links. Imported or scrambled samples must not quietly enter release evaluation.
- [~] Make backfills resumable/idempotent and page through all records. Historical actual/projection joins retain model version and season where source data supplies it; old contest scoring-profile attribution remains to be confirmed.
- [ ] Link actually entered lineups to contest entry IDs, official placements, entry fees, payout, field size, contest format, and complete-result status. Generated-but-not-entered lineups may support retrospective points analysis but must not count as realized ROI.

### Cash-line calibration and dependence

- [x] Repair `loadCashLineCalibration()` to pass the actual contest ID required by `buildCashLineCalibration()`. Inspect source schema and join through verified contest/entry relationships; do not substitute lineup ID as contest ID.
- [~] Filter results by official source, integrity/finality, valid linkage, pre-lock forecast, compatible sport/format/model, and calibration eligibility before constructing observations. Official/finality/linkage/pre-lock conditions are enforced; calibration remains globally descriptive until per-scope release data is sufficient.
- [x] Replace arbitrary independent 5,000-row limits with ordered pagination and a documented evaluation window. Prevent silent truncation and mismatched joins.
- [x] Deduplicate repeated imports and same-contest entries according to the calibration contract. Multiple entries in one contest are not independent contests; multiple contests on one slate may also be dependent.
- [ ] Regression: 120 eligible independent contest observations must not become zero due to missing IDs. With raw probabilities intentionally in one bin, expect 120 independent contests and one populated bin; duplicate contest rows must not inflate independence.
- [x] Preserve `DISABLED_PENDING_OUT_OF_SAMPLE_VALIDATION` and the existing conservative approval thresholds until a reviewed chronological holdout supports release. Fixing the join is not approval to display calibrated probabilities.

### Historical evaluation and contextual-feature experiments

- [ ] Build an immutable replay dataset from pre-decision snapshots. Include exact available salary pool, rules, news publication/retrieval times, accepted facts, injuries, projections, seed, and model versions. Never use final box scores or later news to reconstruct supposedly pre-lock decisions.
- [~] Split evaluation chronologically into development, validation, and untouched holdout windows; group all entries/contests from the same slate to avoid leakage. Freeze configurations before holdout evaluation. The existing paired evaluator uses a frozen chronological holdout cutoff and slate grouping; actual development/validation/holdout evidence remains insufficient.
- [~] Compare old system, corrected foundations, and context-feature variants on the same slates and contest rules. Include a simple salary-compatible projection baseline. Salary-compatible baseline artifacts are now recorded; old-system/context ablations need verified historical data.
- [ ] Measure player mean error/bias, interval coverage, workload error, forecast calibration, lineup projected-objective regret on solvable fixtures, actual lineup score, field percentile, cash rate, and realized net ROI only for linked entered contests.
- [ ] Report results by sport, format, field size, season phase, player role, injury uncertainty, and data/model path. Report sample size and uncertainty clustered by slate; do not cherry-pick a single win or loss.
- [ ] Test ring/ceremony, former-team, contract-year, and similar atmosphere features with ablation. Control for role, minutes, age, injury, opponent, salary, schedule, and season; an association does not establish a motivational cause.
- [ ] Define experiment hypotheses, primary metric, minimum practically meaningful gain, sample sufficiency/power plan, and regression tolerances before looking at holdout results. A qualified reviewer must approve these values; insufficient data means “not validated,” not a guessed boost.
- [ ] Keep unproven features context-only. Release a numerical effect only for the validated scope; retain kill switches and independently monitor drift.
- [~] Store evaluation artifacts in `floyd_dfs_model_evaluations` and approvals in the existing sport/format release-gate system. Require evidence and an identified reviewer; avoid a global “all models validated” flag. POST writes tenant-owned immutable chronological comparison artifacts with explicit HOLD; no production release gate is approved by this implementation.
- [ ] Update weekly reports with coverage, missing actuals, official-result counts, drift, pending experiments, and release-gate state. Do not email unsupported causal explanations for losses.

**Exit gate:** NBA actuals ingest and score correctly; calibration joins populate without inflating independence; holdout results are documented. Prediction/financial claims remain unavailable for scopes without sufficient evidence.

**Progress (October 22, 2026):** The production tenant-scoped backfill ran over saved pre-lock Floyd DFS projections and imported/upserted 4,535 verified official actual rows (4,440 MLB, 95 WNBA; no eligible NBA projection run in this batch), with zero feed failures and zero quarantined rows. It found 3,160 unmatched player observations and skipped 34 SportsDataIO runs because production entitlement was unverified, 6 unsupported-format runs, and 11 unsupported CFB-scoring runs. It reconciled five existing result rows: zero MATCHED, three score mismatches retained as excluded, and two unavailable. Detailed counts and limits are in `docs/P11_Historical_Data_Backfill_2026-10-22.md`. Cash-line calibration remains disabled; P11 evaluation artifacts remain HOLD. Provider/account history, sufficient independent holdout, scoped ablations, DNP/non-final state coverage, fees/payouts, and reviewer approval remain open; no probability/ROI release is enabled.

## P12 — Add the monthly DraftKings compatibility audit

**Existing files:** `src/lib/engine/draftKings.ts`, `providerDiagnostics.ts`, `server/runtime.ts`, `vercel.json`, existing `api/learning/weekly-report.ts` scheduling pattern.

### Monthly job

- [x] Add a dedicated authenticated GET cron handler, proposed path `/api/maintenance/draftkings-audit`. Reuse P01 scheduler authorization and P03 endpoint registry/adapters.
- [x] Add its cron to `vercel.json` while preserving the weekly report: `{"path":"/api/maintenance/draftkings-audit","schedule":"0 14 1 * *"}`. This is the first day of each month at 14:00 UTC; document the UTC schedule rather than implying a fixed local daylight-saving time.
- [x] Confirm current Vercel plan limits, function timeouts, and production cron behavior before deployment. Official Vercel docs state cron jobs are available on all plans and fluid-compute Node functions support 300 seconds on Hobby; this monthly schedule satisfies the once-per-day limit. The function deploy is READY with a 300-second function limit, and Vercel metadata lists the cron as enabled. Hobby invocation timing can vary within the scheduled hour. If work exceeds the safe function budget, have the cron enqueue a durable audit job and return promptly; the worker owns progress/retries/completion.
- [ ] Run checks from the same deployed environment/access path as generation. A developer laptop's success does not prove the production host can access DraftKings.
- [x] Use idempotency by environment + audit period and a lease to prevent overlapping/manual duplicate runs. Allow an authenticated operator to run a diagnostic audit on demand without changing the monthly schedule.
- [x] Check all configured integration routes: sport discovery, lobby/contests, contest detail where actually used, draft group, game-type rules, draftables, and salary CSV fallback. Record routes not used by the active flow rather than claiming they caused generation failures.
- [ ] Select a currently available representative contest/group per supported active sport/format. Never hardcode an expired draft group. For off-season/no-slate combinations, report `NOT_APPLICABLE` with a reason and test static parser fixtures.
- [~] Validate reachability, response schema, semantic identity, required player/rules fields, salary/eligibility, lock parsing, freshness, and photo-field coverage. Distinguish optional image coverage warnings from critical rules failures. Active slate parser validation and shape hashes are recorded; photo coverage/freshness and some optional-field checks need provider-specific fixtures.
- [x] Run a non-submitting canary: ingest live permitted metadata, construct/validate a slate, exercise parsers/fallback handling, and validate a legal synthetic-scored candidate when inputs allow. Label synthetic projections clearly; do not submit an entry or present the canary as a performance forecast. The audit constructs and validates a real metadata slate without generating scores or submitting entries.
- [ ] Classify each result as `PASS`, `DEGRADED`, `FAIL`, `ACCESS_RESTRICTED`, `RATE_LIMITED`, `TIMEOUT`, or `NOT_APPLICABLE`. Record root cause, affected capabilities, adapter version, and next action.
- [ ] Do not interpret a 403 as “URL changed,” a 429 as “schema changed,” or an empty offseason lobby as a dead API. A CSV fallback must not conceal a failed primary integration in the report.
- [x] Store sanitized response shapes/hashes and sufficient bounded fixtures for diagnosis. Do not store credentials, account data, or unnecessary response bodies in alerts.
- [ ] Emit an internal health report and an incident record for critical failures. Before enabling outbound notifications, configure an approved operator destination/secret and deduplication; no guessed email or Slack recipient.
- [~] Track last successful audit and expected next run. The production scheduler row and operator status view track successful runs; an independent existing monitor or external heartbeat check (initial missed-run threshold: 48 hours after due time) still needs configuration. A dead job cannot alert on its own absence.

### Drift repair and normal-scan validation

- [ ] Check authoritative provider documentation/announcements and permitted observed response changes when an adapter fails. Do not brute-force hidden routes or bypass access restrictions.
- [ ] Produce a repair issue/draft change proposal containing affected adapter, evidence, proposed URL/schema change, fixture updates, compatibility impact, tests, and rollback. If automated PR creation is desired, configure explicit repository permissions; otherwise emit a reviewable internal report.
- [ ] Require review, passing contract tests, staging canary, and controlled deployment before promoting endpoint/parser changes. Never auto-rewrite production URLs based on a search result or first successful HTTP response.
- [ ] Add lightweight response/schema/identity/freshness checks on every real scan using P03 validators. This is event-driven validation, not a daily audit job.
- [ ] When critical rules/identity data fails, stop actionable generation and explain the failure. When an approved fallback is allowed, show degraded provenance and retain validation limits.
- [ ] Consolidate repeated runtime failures into one incident with counts and first/last seen. Close/recover only after successful compatible checks; do not create notification storms.
- [x] Add an operator health view with endpoint/version, last monthly audit, current runtime status, affected sport/format, fallback state, and next scheduled audit. The admin console displays latest audit/status/fallback data; production operator access is restricted to the identified Floyd DFS admin account.
- [ ] Test response field removal/type change, HTML-with-200, 403, 404, 429, timeout, stale data, identity mismatch, no active sport, fallback-only success, duplicate execution, missed heartbeat, and recovered endpoint.

**Exit gate:** manual authenticated staging audit completes; wrong/no secret is rejected; monthly configuration is deployed and confirmed; health records and an intentionally induced failure are visible; runtime errors do not wait for the next monthly audit.

**Progress (October 22, 2026):** The dedicated scheduler-authenticated monthly endpoint and authenticated operator status/manual-run routes are implemented. Each period uses a tenant-scoped durable scheduler row with a ten-minute lease and retry attempt count; current and no-slate sport/format pairs are identified without hardcoded draft groups. The job probes configured DraftKings routes, invokes the existing public CSV fallback only on primary HTTP 403, records that degraded state separately, constructs a live metadata slate without submitting or scoring, stores sanitized response-shape hashes and provider health checks, and aggregates recurring critical failures into a redacted incident. The admin console displays status and allows an operator-triggered audit. Scheduler secrets and one Floyd DFS operator account are configured in Vercel Production. Migration `20261022030000` is applied and recorded in production. Current production deployment `dpl_CTtaS8g4AkKHBDQhcn1Bj1uazVJ9` is READY at `https://floyd-dfs.vercel.app`. Vercel cron metadata confirms both the weekly report and DraftKings audit schedules are registered and enabled; monthly audit schedule is `0 14 1 * *` UTC. Vercel documents a 300-second Hobby maximum for fluid-compute Node functions and monthly frequency is within all-plan cron limits. **P12 remains operationally partial** pending the independent 48-hour heartbeat, manual staging audit, and deliberate failure/recovery scenario.

## P13 — End-to-end acceptance, release, and handoff

### Acceptance matrix

Each scenario must have a committed fixture or documented staging run, expected result, actual result, and reviewer. Passing a unit helper alone does not satisfy a route-to-UI scenario.

| ID | Scenario | Required result |
|---|---|---|
| A01 | Unauthorized/cross-tenant API request | Rejected; no data read/write, report send, or provider job |
| A02 | NBA evidence/actual/evaluation persistence | Every applicable insert succeeds under correct ownership |
| A03 | Four-plus-team NBA slate | Every game joined independently; unmatched games explicit |
| A04 | NBA category scoring fixture | 51 before bonuses; category/bonus tests pass |
| A05 | 30-minute baseline +8% supported effect | 32.4 before other declared constraints; not overwritten |
| A06 | Ten syndicated copies of one story | One effective claim; same quantitative result as one copy |
| A07 | Team ceremony without named players | Correct game/player linkage; context-only unless validated |
| A08 | Former-team/contract-year claim | Dated identity verified; no unconditional motivation boost |
| A09 | Conflicting/stale availability | Explicit resolution or blocked actionable result |
| A10 | Eight-slot salary fixture | Corrected max-points objective finds/proves 400 vs old 263 |
| A11 | Search budget exhausted | Legal partial output with bounded status and valid bound if available |
| A12 | Captain variant and equivalent slot permutations | Correct multipliers/identity; irrelevant duplicates removed |
| A13 | Two entries tie across one $2 paid place | $1 each; zero ROI at $1 fee |
| A14 | Multiple lineup explanations | Every card uses its own roster/revision and actual effects |
| A15 | Missing/broken/mismatched player photo | Safe initials fallback; no incorrect person/team-logo substitution |
| A16 | Pre-lock scratch with unused salary | Legal alternative may use outgoing salary plus unused budget |
| A17 | Early game locked, later game open | Eligible late swap preserves locked slots |
| A18 | Non-late-swap contest / unknown lock / expired plan | Action blocked with explicit reason |
| A19 | One-for-one impossible, two-player solution legal | Solver offers legal rebuild or explains remaining infeasibility |
| A20 | Concurrent revision / lock during confirmation | Stale plan rejected and refreshed; no overwrite |
| A21 | NBA official actual import rerun/correction | Idempotent import; revised official result retained |
| A22 | 120 eligible independent calibration contests | 120 independent IDs preserved; duplicate imports excluded |
| A23 | Future news inserted into historical replay | Excluded from pre-lock features |
| A24 | Monthly endpoint shape/access failures | Correct classifications, incident, no blind URL rewrite |
| A25 | Offseason and missed cron | No-slate marked N/A; independent heartbeat detects missed run |
| A26 | Provider failure during ordinary scan | Clear degraded/blocked state; no misleading healthy empty lineup |
| A27 | Refresh/export/manual entry confirmation | Original history preserved; export not mislabeled submitted |
| A28 | Other supported sports/formats | Scoring, legality, ingestion, and UI regression fixtures remain valid |

### Verification and rollout

- [x] Run the final repeatable repository checks: `npm ci`, `npm run build`, `npm run check:server`, `npm run lint`, `npm run test:actual-sources`, `npm run test:engine`, `npm run test:fixtures`, `npm run test:contracts`, `npm run test:auth`, and `git diff --check`. Results are recorded below. Route-to-UI, device, and live-provider acceptance are not substituted by these checks.
- [~] Review migrations and run staging backups/upgrade tests. Reviewed migration history and applied only targeted production migrations; no staging project is configured. Verify full NBA generation through persistence before widening deployment.
- [~] Test the active worker/API path end-to-end; the production actual backfill verified its tenant-scoped persistence path, while browser/API worker orchestration remains a manual staging check.
- [~] Confirm errors and partial writes leave recoverable states, with no duplicate entries, explanations, jobs, or notifications after retry. Idempotency/lease behavior is covered in code and fixtures, but duplicate/concurrency route behavior still needs staging acceptance.
- [ ] Measure representative provider calls, latency, solver time, memory, and UI response time. Commit budgets and instrumentation; enforce provider quotas before enabling refresh polling broadly.
- [x] Release additive schema first, compatible server contracts/adapters second, engine changes third, and frontend changes after compatible responses are available. Feature gates remain in place for experimental context and unvalidated outcomes; current deployment is compatible with applied schema.
- [ ] Run new generation in shadow mode against the same pre-decision inputs as baseline. Compare legality, missing-data rates, search quality, numerical changes, explanations, and latency before showing it as default.
- [ ] Start NBA Classic with a small staged cohort, then NBA Showdown and other validated formats. Do not expand a release gate automatically across sports.
- [x] Keep separate gates for software correctness, projection quality, probability calibration, and payout-model validity. These release decisions are documented in `docs/P13_Acceptance_and_Release.md`.
- [x] Define rollback triggers before rollout: unauthorized access, illegal/locked swaps, scoring mismatch, lost revisions/evidence, critical provider contract failure, timeout regression, or incompatible API responses. Immediate safety-critical failures disable the affected feature.
- [x] Preserve schema compatibility during rollback. Use feature gates to restore the previous generation/UI path while retaining new immutable records; do not erase evidence to hide a failed release.
- [~] Monitor user-visible empty/blocked/degraded rates, photo coverage, stale evidence, solver status, failed swaps, illegal-swap count (must remain zero), source incidents, actuals coverage, and latency. Admin health views exist, but independent cron heartbeat and route-level operational dashboards are not complete.
- [~] Technical implementation review and release-gate decisions are recorded in this checklist; independent domain/model reviewer approval remains required before any numerical or financial claim is released.

### Required handoff artifacts

- [x] Updated architecture/call-order and release decisions are recorded in `docs/P13_Acceptance_and_Release.md`; the code follows provider snapshots → resolved evidence → projections → optimization/selection → persisted trace → UI, with swaps using current game locks.
- [x] Contract/schema map and fixture sample exist in `docs/P02_Schema_and_Contracts.md` and `tests/fixtures/contracts/fds-transport-v1.json`; blocked/degraded/stale response cases are documented in endpoint contracts and test fixtures.
- [x] Migration/backfill and rollback instructions are documented in `docs/P02_Production_Migration_Runbook.md`, `docs/P13_Acceptance_and_Release.md`, and the P11 backfill report. Baseline-schema inventory and staging upgrade remain environment limitations.
- [~] Provider registry, entitlement notes, scoring profiles, fallbacks, image-source policy, and freshness gates are documented across P03 and `docs/DraftKings_Eligibility_and_History_Sources.md`; provider rights/entitlements remain unverified.
- [~] Test commands, fixtures, acceptance inventory, and limitations are documented. Representative production latency/memory benchmarks remain to be measured.
- [x] Scratch, provider failure, audit/missed cron, actual correction, and model rollback guidance is in `docs/P13_Acceptance_and_Release.md`.
- [x] Environment variable purposes and client/server boundaries are in `docs/FDS_Environment_Variables.md`; no secret values are recorded.
- [~] Official-actual backfill report is documented in `docs/P11_Historical_Data_Backfill_2026-10-22.md`; a chronological holdout report and independent reviewer-approved release gates do not yet exist.
- [x] `README.md` now points to environment, data import, history-source, schedule, and release guidance. The supported sports and test commands are listed.
- [~] Traceability is updated: known unavailable evidence is explicitly deferred with entry/prediction claims disabled; end-to-end staging acceptance and independent model review remain open.

**Progress (October 22, 2026):** Added official DraftKings references and evidence for contest-specific late-swap rules, slate-specific upload templates, entry-history downloads, and completed GameCenter standings. Added P13 acceptance/release and incident/rollback guidance, a tenant-scoped environment inventory, and an official-actual backfill report. The authorized production backfill imported/upserted 4,535 verified MLB/WNBA actual rows for saved pre-lock FDS forecasts, preserved 3 score mismatches and 2 incomplete reconciliations as excluded, and skipped unverified/unsupported source scopes. CI now runs contract and authorization fixtures; lint warnings in the watched-refresh UI were resolved. `npm ci`, build, server typecheck, lint, engine parity, official source tests, 8 replay fixtures, contract tests, auth tests, and `git diff --check` pass on Node 22.22.2. Production deploy `dpl_CTtaS8g4AkKHBDQhcn1Bj1uazVJ9` is READY. Vercel metadata confirms both crons enabled, including the monthly DraftKings audit at `0 14 1 * *` UTC. **P13 remains partial** because the manual route/UI/device/accessibility suite, independent missed-run heartbeat, live audit failure/recovery exercise, representative performance measurements, and independent model review remain outstanding. No live DraftKings audit or entry submission was performed.

## Reference rules and limits

- DraftKings late-swap eligibility, locks, and complete-lineup requirements: https://support.draftkings.com/dk/en-us/how-do-i-late-swap-a-player?id=kb_article_view&sysparm_article=KB0010830
- DraftKings exact template selection and file limits: https://support.draftkings.com/dk/en-us/how-do-i-upload-or-edit-multiple-lineups-at-once?id=kb_article_view&sysparm_article=KB0010800
- DraftKings official entry history and completed contest standings downloads: https://support.draftkings.com/dk/en-us/how-do-i-see-the-contests-ive-entered?id=kb_article_view&sysparm_article=KB0010685 and https://support.draftkings.com/dk/en-us/how-do-i-download-a-csv-to-see-gamecenter-standings-for-a-contest?id=kb_article_view&sysparm_article=KB0010448
- DraftKings NBA scoring explanation used in the review; reverify current contest-specific rules during implementation: https://dknetwork.draftkings.com/2025/10/17/nba-daily-fantasy-101-how-to-play-dfs-on-draftkings/
- Vercel cron behavior and UTC scheduling: https://vercel.com/docs/cron-jobs
- Vercel job authorization/management: https://vercel.com/docs/cron-jobs/manage-cron-jobs
- Vercel cron plan limits and function duration: https://vercel.com/docs/cron-jobs/usage-and-pricing and https://vercel.com/docs/functions/limitations
- Context-feature research example, not a universal contract-year scoring coefficient: https://kerrymtan.github.io/econ/research/NBA_OwsikTan.pdf
- Contrasting contract-year research abstract: https://etheses.whiterose.ac.uk/id/eprint/36243/

Production migration history and tenant-scoped official-actual writes have been verified, and Vercel reports the current deployment READY with both cron schedules enabled. This work did not verify end-user runtime authorization via manual cross-account requests, DraftKings live contest eligibility/template contents, provider data-use entitlements, every user contest/input snapshot, or improved historical ROI. Complete those through staging acceptance and P11 evidence; keep affected capabilities gated in the meantime.
