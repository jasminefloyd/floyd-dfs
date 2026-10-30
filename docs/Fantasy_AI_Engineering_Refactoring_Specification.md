# Fantasy AI → Multi-Agent Sports Intelligence System

> Evidence boundary: This is a static code audit, not an executed integration audit. Per instruction, database connectivity and existing external provider availability are assumed verified. Source presence does not prove correctness, performance, licensing, or live deployment behavior. No database credentials or external requests were used.

## Executive assessment

The application already contains a seven-stage engine, multi-sport contracts, evidence ledger, roster/availability protections, NBA/NFL connected game simulation, legal-lineup optimization, contest-field simulations, expected payout calculations, result imports, calibration, and learning reports. The major gap is architectural: research is slate/run-triggered rather than a continuously operating shared Street Team; sport-specific House ownership is implicit rather than a clear service boundary; human-behavior research lacks controlled quantitative governance; and portfolio optimization plus prospective evaluation need explicit contracts and release gates.

### What changes from the previous review

- **Retain** `gameSimulation.ts`; it explicitly sets `releaseStatus: UNVALIDATED`, and returns a `PARTIAL` package in connected-game mode. Never represent this as production-validated until it passes prospective gates.
- **Retain** `optimizer.ts` and `contestSimulation.ts`; expected payouts and expected profits already exist. Add portfolio-level optimization and stronger field/ownership calibration rather than duplicate the contest model.
- **Retain** evidence and source resolution modules; add persistent global collection independent of any slate and point-in-time NBA House snapshots.
- **Retain** authentication, single-tenant isolation, existing API routes and SQL migrations. Introduce new endpoints and additive tables with staged rollout.
- **Treat the existing `ResearchAgent` as a slate-research adapter**, not the whole Street Team; it uses `ValidatedSlate` and `createResearchPlan`, fetches providers concurrently with timeouts and filters evidence for that slate.
- **Do not silently promote contextual stories into point bonuses.** Behavioral observations should default to report-only, with learned effects and guardrails required for numeric adjustments.

## A. Repository-wide file-by-file audit

Inventory: 191 files in the extracted archive; 170 text/source/config/SQL files in scope for per-file inspection. Every item below has a disposition. Symbols are statically extracted and are illustrative, not a complete call graph.

### `README.md`
- **Observed:** 76 lines; exported/declaration anchors: —.
- **Action:** KEEP configuration/static assets; adjust routes/build scripts only when required.

### `api/contests/[contestId].ts`
- **Observed:** 3 lines; exported/declaration anchors: handler.
- **Action:** EXTEND contest and lineup APIs for payout readiness, portfolio, entry verification, and immutable revisions.

### `api/generate.ts`
- **Observed:** 1 lines; exported/declaration anchors: —.
- **Action:** MODIFY orchestration to invoke NBA House via versioned stage services, retain old route compatibility.

### `api/generation-runs/[runId]/lineups.ts`
- **Observed:** 3 lines; exported/declaration anchors: handler.
- **Action:** MODIFY orchestration to invoke NBA House via versioned stage services, retain old route compatibility.

### `api/generation-runs/[runId]/recheck.ts`
- **Observed:** 88 lines; exported/declaration anchors: handler.
- **Action:** MODIFY orchestration to invoke NBA House via versioned stage services, retain old route compatibility.

### `api/generation-runs/[runId]/refresh.ts`
- **Observed:** 36 lines; exported/declaration anchors: handler.
- **Action:** MODIFY orchestration to invoke NBA House via versioned stage services, retain old route compatibility.

### `api/generation-runs/[runId].ts`
- **Observed:** 30 lines; exported/declaration anchors: handler.
- **Action:** MODIFY orchestration to invoke NBA House via versioned stage services, retain old route compatibility.

### `api/generation-runs.ts`
- **Observed:** 27 lines; exported/declaration anchors: handler.
- **Action:** MODIFY orchestration to invoke NBA House via versioned stage services, retain old route compatibility.

### `api/history.ts`
- **Observed:** 3 lines; exported/declaration anchors: handler.
- **Action:** KEEP existing API behavior; add validation/contract tests where adjacent functionality changes.

### `api/learning/calibration.ts`
- **Observed:** 183 lines; exported/declaration anchors: handler.
- **Action:** EXTEND learning/result endpoints with point-in-time forecast linkage and portfolio ROI diagnostics.

### `api/learning/contest-field-validation.ts`
- **Observed:** 63 lines; exported/declaration anchors: handler.
- **Action:** EXTEND learning/result endpoints with point-in-time forecast linkage and portfolio ROI diagnostics.

### `api/learning/lessons.ts`
- **Observed:** 3 lines; exported/declaration anchors: handler.
- **Action:** EXTEND learning/result endpoints with point-in-time forecast linkage and portfolio ROI diagnostics.

### `api/learning/pre-lock.ts`
- **Observed:** 4 lines; exported/declaration anchors: handler.
- **Action:** EXTEND learning/result endpoints with point-in-time forecast linkage and portfolio ROI diagnostics.

### `api/learning/weekly-report.ts`
- **Observed:** 25 lines; exported/declaration anchors: handler.
- **Action:** EXTEND learning/result endpoints with point-in-time forecast linkage and portfolio ROI diagnostics.

### `api/lineups/[lineupId]/entered.ts`
- **Observed:** 57 lines; exported/declaration anchors: handler.
- **Action:** EXTEND contest and lineup APIs for payout readiness, portfolio, entry verification, and immutable revisions.

### `api/lineups/[lineupId]/result.ts`
- **Observed:** 59 lines; exported/declaration anchors: handler.
- **Action:** EXTEND contest and lineup APIs for payout readiness, portfolio, entry verification, and immutable revisions.

### `api/lineups/[lineupId]/status.ts`
- **Observed:** 3 lines; exported/declaration anchors: handler.
- **Action:** EXTEND contest and lineup APIs for payout readiness, portfolio, entry verification, and immutable revisions.

### `api/lineups/[lineupId]/swap-plans/[planId]/confirm.ts`
- **Observed:** 86 lines; exported/declaration anchors: handler.
- **Action:** EXTEND contest and lineup APIs for payout readiness, portfolio, entry verification, and immutable revisions.

### `api/lineups/[lineupId]/swap-plans.ts`
- **Observed:** 176 lines; exported/declaration anchors: handler.
- **Action:** EXTEND contest and lineup APIs for payout readiness, portfolio, entry verification, and immutable revisions.

### `api/lineups/[lineupId].ts`
- **Observed:** 3 lines; exported/declaration anchors: handler.
- **Action:** EXTEND contest and lineup APIs for payout readiness, portfolio, entry verification, and immutable revisions.

### `api/lineups.ts`
- **Observed:** 49 lines; exported/declaration anchors: handler.
- **Action:** EXTEND contest and lineup APIs for payout readiness, portfolio, entry verification, and immutable revisions.

### `api/maintenance/draftkings-audit.ts`
- **Observed:** 109 lines; exported/declaration anchors: config, handler.
- **Action:** KEEP existing API behavior; add validation/contract tests where adjacent functionality changes.

### `api/news.ts`
- **Observed:** 65 lines; exported/declaration anchors: handler.
- **Action:** EXTEND read surface to serve persistent Street Team intelligence, preserve existing response shape.

### `api/player-photos/[playerId]/failed.ts`
- **Observed:** 15 lines; exported/declaration anchors: handler.
- **Action:** KEEP existing API behavior; add validation/contract tests where adjacent functionality changes.

### `api/research/[runId].ts`
- **Observed:** 3 lines; exported/declaration anchors: handler.
- **Action:** EXTEND read surface to serve persistent Street Team intelligence, preserve existing response shape.

### `api/results/[lineupId].ts`
- **Observed:** 3 lines; exported/declaration anchors: handler.
- **Action:** EXTEND learning/result endpoints with point-in-time forecast linkage and portfolio ROI diagnostics.

### `api/results/import-field.ts`
- **Observed:** 86 lines; exported/declaration anchors: handler.
- **Action:** EXTEND learning/result endpoints with point-in-time forecast linkage and portfolio ROI diagnostics.

### `api/results/import.ts`
- **Observed:** 167 lines; exported/declaration anchors: handler, reconcileAndDiagnose.
- **Action:** EXTEND learning/result endpoints with point-in-time forecast linkage and portfolio ROI diagnostics.

### `api/runs/[runId]/process.ts`
- **Observed:** 64 lines; exported/declaration anchors: handler.
- **Action:** MODIFY orchestration to invoke NBA House via versioned stage services, retain old route compatibility.

### `api/runs/[runId].ts`
- **Observed:** 1 lines; exported/declaration anchors: —.
- **Action:** MODIFY orchestration to invoke NBA House via versioned stage services, retain old route compatibility.

### `api/settings.ts`
- **Observed:** 3 lines; exported/declaration anchors: handler.
- **Action:** KEEP existing API behavior; add validation/contract tests where adjacent functionality changes.

### `api/slates/screenshot.ts`
- **Observed:** 20 lines; exported/declaration anchors: handler.
- **Action:** KEEP existing API behavior; add validation/contract tests where adjacent functionality changes.

### `api/slates.ts`
- **Observed:** 3 lines; exported/declaration anchors: handler.
- **Action:** KEEP existing API behavior; add validation/contract tests where adjacent functionality changes.

### `api/sports.ts`
- **Observed:** 3 lines; exported/declaration anchors: handler.
- **Action:** KEEP existing API behavior; add validation/contract tests where adjacent functionality changes.

### `deno.json`
- **Observed:** 8 lines; exported/declaration anchors: —.
- **Action:** KEEP configuration/static assets; adjust routes/build scripts only when required.

### `index.html`
- **Observed:** 13 lines; exported/declaration anchors: —.
- **Action:** KEEP configuration/static assets; adjust routes/build scripts only when required.

### `package.json`
- **Observed:** 56 lines; exported/declaration anchors: —.
- **Action:** KEEP configuration/static assets; adjust routes/build scripts only when required.

### `scripts/backfill-player-actuals.mjs`
- **Observed:** 353 lines; exported/declaration anchors: —.
- **Action:** KEEP existing maintenance/test tooling; update fixtures and model-version expectations as needed.

### `scripts/backfill-run-evidence.mjs`
- **Observed:** 58 lines; exported/declaration anchors: —.
- **Action:** KEEP existing maintenance/test tooling; update fixtures and model-version expectations as needed.

### `scripts/backup-fds-p02-production.mjs`
- **Observed:** 79 lines; exported/declaration anchors: —.
- **Action:** KEEP existing maintenance/test tooling; update fixtures and model-version expectations as needed.

### `scripts/nflverseActuals.mjs`
- **Observed:** 92 lines; exported/declaration anchors: fetchNflverseFinalPlayerRows, scoreNflversePlayer.
- **Action:** KEEP existing maintenance/test tooling; update fixtures and model-version expectations as needed.

### `scripts/officialActualSources.mjs`
- **Observed:** 123 lines; exported/declaration anchors: mapMlbOfficialBoxScore, mapWnbaOfficialPlayerStats, mapNbaOfficialPlayerStats, scoreMlbOfficial, scoreWnbaOfficial, scoreNbaOfficial, actualPointIncrement.
- **Action:** KEEP existing maintenance/test tooling; update fixtures and model-version expectations as needed.

### `scripts/run-engine-parity.mjs`
- **Observed:** 12 lines; exported/declaration anchors: —.
- **Action:** KEEP existing maintenance/test tooling; update fixtures and model-version expectations as needed.

### `scripts/test-contract-fixtures.mjs`
- **Observed:** 13 lines; exported/declaration anchors: —.
- **Action:** KEEP existing maintenance/test tooling; update fixtures and model-version expectations as needed.

### `scripts/test-official-actual-sources.mjs`
- **Observed:** 41 lines; exported/declaration anchors: —.
- **Action:** KEEP existing maintenance/test tooling; update fixtures and model-version expectations as needed.

### `scripts/test-replay-fixtures.mjs`
- **Observed:** 59 lines; exported/declaration anchors: —.
- **Action:** KEEP existing maintenance/test tooling; update fixtures and model-version expectations as needed.

### `scripts/test-request-auth.mjs`
- **Observed:** 15 lines; exported/declaration anchors: —.
- **Action:** KEEP existing maintenance/test tooling; update fixtures and model-version expectations as needed.

### `server/authPolicy.d.mts`
- **Observed:** 4 lines; exported/declaration anchors: parseBearer, tenantHeaderAllowed, secretMatches, isOperator.
- **Action:** KEEP infrastructure; add new capability without bypassing tenant/auth controls.

### `server/authPolicy.mjs`
- **Observed:** 21 lines; exported/declaration anchors: parseBearer, tenantHeaderAllowed, secretMatches, isOperator.
- **Action:** KEEP infrastructure; add new capability without bypassing tenant/auth controls.

### `server/evidenceLedger.ts`
- **Observed:** 144 lines; exported/declaration anchors: persistEvidenceLedger.
- **Action:** EXTEND append-only evidence persistence, latest-fact projection, and snapshot references.

### `server/gameLockProvider.ts`
- **Observed:** 58 lines; exported/declaration anchors: LateSwapLockSnapshot, getLateSwapLockSnapshot.
- **Action:** KEEP infrastructure; add new capability without bypassing tenant/auth controls.

### `server/learningDiagnosis.ts`
- **Observed:** 131 lines; exported/declaration anchors: LineupDiagnosisInput, diagnoseLineupResult, recordLessonCandidate, ChangeEvent, PreLockDecision, computePreLockDecision, diffAvailabilityForChangeEvents.
- **Action:** EXTEND model evaluation and diagnostics for out-of-sample and portfolio outcomes.

### `server/learningReport.ts`
- **Observed:** 41 lines; exported/declaration anchors: WeeklyReportData, loadWeeklyReport, renderWeeklyLearningReport, sendWeeklyLearningReport.
- **Action:** EXTEND model evaluation and diagnostics for out-of-sample and portfolio outcomes.

### `server/playerPhotoCache.ts`
- **Observed:** 69 lines; exported/declaration anchors: cacheSlatePlayerPhotos.
- **Action:** KEEP infrastructure; add new capability without bypassing tenant/auth controls.

### `server/runtime.ts`
- **Observed:** 813 lines; exported/declaration anchors: serverSupabase, ApiError, TenantContext, tenantContext, schedulerContext, workerTenantContext, hasWorkerAuthorization.
- **Action:** SPLIT orchestration responsibilities into services; keep auth/tenant and existing entry points; inject Street Team and NBA House.

### `server/schemaManifest.ts`
- **Observed:** 21 lines; exported/declaration anchors: FDS_SCHEMA_MANIFEST.
- **Action:** KEEP infrastructure; add new capability without bypassing tenant/auth controls.

### `src/App.css`
- **Observed:** 184 lines; exported/declaration anchors: —.
- **Action:** KEEP configuration/static assets; adjust routes/build scripts only when required.

### `src/App.tsx`
- **Observed:** 64 lines; exported/declaration anchors: —.
- **Action:** KEEP configuration/static assets; adjust routes/build scripts only when required.

### `src/components/AdminGuard.tsx`
- **Observed:** 11 lines; exported/declaration anchors: AdminGuard.
- **Action:** REUSE UI component; adapt labels, data contracts and status indicators as needed; avoid wholesale rewrite.

### `src/components/AppPrimitives.tsx`
- **Observed:** 5 lines; exported/declaration anchors: AppPage, ErrorBox, EmptyState, Metric, StatusBadge.
- **Action:** REUSE UI component; adapt labels, data contracts and status indicators as needed; avoid wholesale rewrite.

### `src/components/ErrorBoundary.tsx`
- **Observed:** 42 lines; exported/declaration anchors: ErrorBoundary.
- **Action:** REUSE UI component; adapt labels, data contracts and status indicators as needed; avoid wholesale rewrite.

### `src/components/ExportLineup.tsx`
- **Observed:** 59 lines; exported/declaration anchors: ExportLineup.
- **Action:** REUSE UI component; adapt labels, data contracts and status indicators as needed; avoid wholesale rewrite.

### `src/components/HistoryDashboard.tsx`
- **Observed:** 46 lines; exported/declaration anchors: HistoryDashboard.
- **Action:** REUSE UI component; adapt labels, data contracts and status indicators as needed; avoid wholesale rewrite.

### `src/components/InjuryReport.tsx`
- **Observed:** 70 lines; exported/declaration anchors: InjuryReport.
- **Action:** REUSE UI component; adapt labels, data contracts and status indicators as needed; avoid wholesale rewrite.

### `src/components/LineupDisplay.tsx`
- **Observed:** 571 lines; exported/declaration anchors: LineupPlayer, Lineup, LineupDisplay.
- **Action:** REUSE UI component; adapt labels, data contracts and status indicators as needed; avoid wholesale rewrite.

### `src/components/MIOS_FantasyScanner.tsx`
- **Observed:** 832 lines; exported/declaration anchors: ScanParams, MIOS_FantasyScanner.
- **Action:** REUSE UI component; adapt labels, data contracts and status indicators as needed; avoid wholesale rewrite.

### `src/components/Navigation.tsx`
- **Observed:** 6 lines; exported/declaration anchors: Navigation.
- **Action:** REUSE UI component; adapt labels, data contracts and status indicators as needed; avoid wholesale rewrite.

### `src/components/ReasoningPresentation.tsx`
- **Observed:** 61 lines; exported/declaration anchors: ReasoningPresentation.
- **Action:** REUSE UI component; adapt labels, data contracts and status indicators as needed; avoid wholesale rewrite.

### `src/components/SignInGate.tsx`
- **Observed:** 26 lines; exported/declaration anchors: SignInGate.
- **Action:** REUSE UI component; adapt labels, data contracts and status indicators as needed; avoid wholesale rewrite.

### `src/components/Skeleton.tsx`
- **Observed:** 37 lines; exported/declaration anchors: SkeletonLine, SkeletonCircle, PlayerListSkeleton, LineupSkeleton.
- **Action:** REUSE UI component; adapt labels, data contracts and status indicators as needed; avoid wholesale rewrite.

### `src/components/SportsNewsTicker.tsx`
- **Observed:** 124 lines; exported/declaration anchors: SportsNewsTicker.
- **Action:** REUSE UI component; adapt labels, data contracts and status indicators as needed; avoid wholesale rewrite.

### `src/components/ToastProvider.tsx`
- **Observed:** 51 lines; exported/declaration anchors: ToastProvider.
- **Action:** REUSE UI component; adapt labels, data contracts and status indicators as needed; avoid wholesale rewrite.

### `src/components/toastContext.ts`
- **Observed:** 9 lines; exported/declaration anchors: ToastVariant, ToastContextValue, ToastContext.
- **Action:** REUSE UI component; adapt labels, data contracts and status indicators as needed; avoid wholesale rewrite.

### `src/hooks/useEnterTransition.ts`
- **Observed:** 22 lines; exported/declaration anchors: useEnterTransition.
- **Action:** KEEP configuration/static assets; adjust routes/build scripts only when required.

### `src/hooks/useInjuryAlerts.ts`
- **Observed:** 34 lines; exported/declaration anchors: useInjuryAlerts.
- **Action:** KEEP configuration/static assets; adjust routes/build scripts only when required.

### `src/hooks/useToast.ts`
- **Observed:** 8 lines; exported/declaration anchors: useToast.
- **Action:** KEEP configuration/static assets; adjust routes/build scripts only when required.

### `src/index.css`
- **Observed:** 134 lines; exported/declaration anchors: —.
- **Action:** KEEP configuration/static assets; adjust routes/build scripts only when required.

### `src/lib/MIOS_FantasyAgents.ts`
- **Observed:** 351 lines; exported/declaration anchors: Last5Game, Player, ReadinessStatus, EngineValidationState, ConfidenceBreakdown, ProjectionTrace, MlbDecisionFeatures.
- **Action:** KEEP client utility and provider/client wrapper; extend typed endpoints only as needed.

### `src/lib/dkBasketballScoring.cjs`
- **Observed:** 30 lines; exported/declaration anchors: —.
- **Action:** KEEP client utility and provider/client wrapper; extend typed endpoints only as needed.

### `src/lib/dkBasketballScoring.d.cts`
- **Observed:** 2 lines; exported/declaration anchors: BasketballScoringResult, scoreBasketballStatLine.
- **Action:** KEEP client utility and provider/client wrapper; extend typed endpoints only as needed.

### `src/lib/dkScoring.ts`
- **Observed:** 320 lines; exported/declaration anchors: DkSport, DkContestType, DkRole, StatLine, DK_SCORING, dkBasketballFantasyPoints, dkNflFantasyPoints.
- **Action:** KEEP client utility and provider/client wrapper; extend typed endpoints only as needed.

### `src/lib/draftkingsSlateClient.ts`
- **Observed:** 34 lines; exported/declaration anchors: DraftKingsGameGroup, listDraftKingsGameGroups, DraftKingsSlate, listDraftKingsSlates.
- **Action:** KEEP client utility and provider/client wrapper; extend typed endpoints only as needed.

### `src/lib/engine/adjustment.ts`
- **Observed:** 245 lines; exported/declaration anchors: MAGNITUDE_WEIGHTS, netSignedMagnitude, adjustSlate, netOpportunityDirectionFrom.
- **Action:** MOVE behind NBA House adapter; preserve math, isolate NBA-specific behavior, add calibrated contextual adjustment and versioned scenario outputs.

### `src/lib/engine/anthropicResearchSynthesizer.ts`
- **Observed:** 59 lines; exported/declaration anchors: AnthropicResearchSynthesizerOptions, AnthropicResearchSynthesizer, FallbackResearchSynthesizer.
- **Action:** REUSE provider integration unchanged where possible; wrap with provider adapters, TTL, provenance and rate-limit controls.

### `src/lib/engine/anthropicStageFallback.ts`
- **Observed:** 65 lines; exported/declaration anchors: adjustWithAnthropic, selectWithAnthropic.
- **Action:** KEEP engine utility; add regression coverage and adjust only if new contract requires it.

### `src/lib/engine/availability.ts`
- **Observed:** 171 lines; exported/declaration anchors: AvailabilityRecord, AvailabilitySnapshot, normalizeProviderName, normalizeTeamCode, withDegradedAvailability, applyAvailabilitySnapshot, parseAvailabilityRecords.
- **Action:** KEEP engine utility; add regression coverage and adjust only if new contract requires it.

### `src/lib/engine/boundaryContracts.ts`
- **Observed:** 71 lines; exported/declaration anchors: BoundaryContractError, parseValidatedSlate, normalizeSlateGames, isFdsApiError, sanitizeProviderRoute, serializeContract.
- **Action:** EXTEND versioned boundary contracts with intel snapshot, model provenance, portfolio and result types; keep compatibility.

### `src/lib/engine/calibration.ts`
- **Observed:** 181 lines; exported/declaration anchors: ProjectionObservation, PreLockBacktestRow, LineupBacktestObservation, LineupBacktestMetrics, ProbabilityCalibrationMetrics, ModelPromotionDecision, PREREGISTERED_VALIDATION.
- **Action:** EXTEND evaluation to walk-forward calibration, bias checks, promotion gates, and financial metrics.

### `src/lib/engine/cashLineCalibration.ts`
- **Observed:** 91 lines; exported/declaration anchors: CASH_LINE_CALIBRATION_VERSION, CASH_LINE_TARGET_PROBABILITY, CASH_LINE_MIN_BUCKET_SAMPLES, CASH_LINE_MIN_APPROVAL_SAMPLES, CashLineCalibrationStatus, CashLinePredictionInput, CashLineObservation.
- **Action:** EXTEND evaluation to walk-forward calibration, bias checks, promotion gates, and financial metrics.

### `src/lib/engine/configuredResearchProvider.ts`
- **Observed:** 2 lines; exported/declaration anchors: ConfiguredResearchProvider.
- **Action:** REUSE provider integration unchanged where possible; wrap with provider adapters, TTL, provenance and rate-limit controls.

### `src/lib/engine/contestSimulation.ts`
- **Observed:** 196 lines; exported/declaration anchors: ContestSimulationOptions, ContestSimulationResult, simulateContestField, averagePayoutForTie.
- **Action:** EXTEND objective scoring to portfolio-level expected net payout; preserve existing legality and bounded-search warnings.

### `src/lib/engine/contracts.ts`
- **Observed:** 734 lines; exported/declaration anchors: Sport, ContestFormat, ContestObjective, EngineStage, GenerationRunState, ENGINE_CONTRACT_VERSION, FDS_TRANSPORT_CONTRACT_VERSION.
- **Action:** EXTEND versioned boundary contracts with intel snapshot, model provenance, portfolio and result types; keep compatibility.

### `src/lib/engine/decisionTrace.ts`
- **Observed:** 128 lines; exported/declaration anchors: DecisionTraceInput, buildLineupDecisionTrace.
- **Action:** KEEP engine utility; add regression coverage and adjust only if new contract requires it.

### `src/lib/engine/draftKings.ts`
- **Observed:** 316 lines; exported/declaration anchors: DRAFTKINGS_API_BASE_URL, DRAFTKINGS_LOBBY_BASE_URL, DEFAULT_DRAFTKINGS_API_ENDPOINTS, DraftKingsEndpointName, DraftKingsEndpointDefinition, DRAFTKINGS_ENDPOINT_REGISTRY, DEFAULT_DRAFTKINGS_SPORT_CODES.
- **Action:** KEEP engine utility; add regression coverage and adjust only if new contract requires it.

### `src/lib/engine/draftKingsSlate.ts`
- **Observed:** 392 lines; exported/declaration anchors: DraftKingsSlateContext, DraftKingsSlateMappingError, buildValidatedSlateFromBundle, DraftKingsScreenshotExtraction, DraftKingsScreenshotContext, buildValidatedSlateFromScreenshot, classifyContestKind.
- **Action:** KEEP engine utility; add regression coverage and adjust only if new contract requires it.

### `src/lib/engine/espnApiClient.ts`
- **Observed:** 60 lines; exported/declaration anchors: EspnApiDiagnostics, fetchEspnJson, clearEspnApiCache.
- **Action:** KEEP engine utility; add regression coverage and adjust only if new contract requires it.

### `src/lib/engine/espnNewsProvider.ts`
- **Observed:** 37 lines; exported/declaration anchors: EspnLeagueNewsProvider, createEspnLeagueNewsProvider.
- **Action:** REUSE provider integration unchanged where possible; wrap with provider adapters, TTL, provenance and rate-limit controls.

### `src/lib/engine/espnProjectionProvider.ts`
- **Observed:** 164 lines; exported/declaration anchors: BasketballProjectionRecord, EspnProjectionClient.
- **Action:** REUSE provider integration unchanged where possible; wrap with provider adapters, TTL, provenance and rate-limit controls.

### `src/lib/engine/espnStructuredResearchProvider.ts`
- **Observed:** 34 lines; exported/declaration anchors: EspnStructuredResearchProvider.
- **Action:** REUSE provider integration unchanged where possible; wrap with provider adapters, TTL, provenance and rate-limit controls.

### `src/lib/engine/factResolution.ts`
- **Observed:** 51 lines; exported/declaration anchors: FACT_RESOLUTION_RULE_VERSION, resolveObservations.
- **Action:** REFACTOR research into persistent shared Street Team, preserve evidence filtering and provenance.

### `src/lib/engine/gameLockState.ts`
- **Observed:** 101 lines; exported/declaration anchors: ProviderGameState, GameLockAssessment, assessGameLocks, parseEspnScoreboard, parseSportsDataIoGames.
- **Action:** KEEP engine utility; add regression coverage and adjust only if new contract requires it.

### `src/lib/engine/gameSimulation.ts`
- **Observed:** 312 lines; exported/declaration anchors: GAME_SIMULATION_MODEL_VERSION, SimulationMode, applyGameSimulation.
- **Action:** MOVE behind NBA House adapter; preserve math, isolate NBA-specific behavior, add calibrated contextual adjustment and versioned scenario outputs.

### `src/lib/engine/learningMetrics.ts`
- **Observed:** 10 lines; exported/declaration anchors: CalibrationRow, brierScore, logLoss, quantileCoverage, rankCorrelation, regret, roi.
- **Action:** EXTEND evaluation to walk-forward calibration, bias checks, promotion gates, and financial metrics.

### `src/lib/engine/lessonPromotion.ts`
- **Observed:** 11 lines; exported/declaration anchors: LessonStatus, PromotionInput, PromotionDecision, evaluateLessonPromotion.
- **Action:** EXTEND evaluation to walk-forward calibration, bias checks, promotion gates, and financial metrics.

### `src/lib/engine/liveState.ts`
- **Observed:** 27 lines; exported/declaration anchors: LiveStatePackage, buildLiveStatePackage.
- **Action:** KEEP engine utility; add regression coverage and adjust only if new contract requires it.

### `src/lib/engine/oddsProvider.ts`
- **Observed:** 82 lines; exported/declaration anchors: OddsResearchProviderOptions, OddsResearchProvider, TeamMarketContext, getTeamMarketContext.
- **Action:** REUSE provider integration unchanged where possible; wrap with provider adapters, TTL, provenance and rate-limit controls.

### `src/lib/engine/officialMlbStatsProvider.ts`
- **Observed:** 54 lines; exported/declaration anchors: OfficialMlbSeasonRows, fetchOfficialMlbSeasonRows.
- **Action:** REUSE provider integration unchanged where possible; wrap with provider adapters, TTL, provenance and rate-limit controls.

### `src/lib/engine/openAiAdjustment.ts`
- **Observed:** 8 lines; exported/declaration anchors: adjustWithOpenAi.
- **Action:** KEEP engine utility; add regression coverage and adjust only if new contract requires it.

### `src/lib/engine/openAiSelection.ts`
- **Observed:** 49 lines; exported/declaration anchors: OpenAiSelectionOptions, selectWithOpenAi.
- **Action:** KEEP engine utility; add regression coverage and adjust only if new contract requires it.

### `src/lib/engine/openAiSynthesizer.ts`
- **Observed:** 51 lines; exported/declaration anchors: OpenAiResearchSynthesizerOptions, OpenAiResearchSynthesizer.
- **Action:** REUSE provider integration unchanged where possible; wrap with provider adapters, TTL, provenance and rate-limit controls.

### `src/lib/engine/openAiTypes.ts`
- **Observed:** 3 lines; exported/declaration anchors: ResearchSynthesizerInput.
- **Action:** KEEP engine utility; add regression coverage and adjust only if new contract requires it.

### `src/lib/engine/optimizer.ts`
- **Observed:** 540 lines; exported/declaration anchors: OptimizerInput, OptimizerOptions, optimizeLineups.
- **Action:** EXTEND objective scoring to portfolio-level expected net payout; preserve existing legality and bounded-search warnings.

### `src/lib/engine/projection.ts`
- **Observed:** 455 lines; exported/declaration anchors: requiredProjectionFields, projectionReadiness, projectSlate.
- **Action:** MOVE behind NBA House adapter; preserve math, isolate NBA-specific behavior, add calibrated contextual adjustment and versioned scenario outputs.

### `src/lib/engine/projectionInputs.ts`
- **Observed:** 177 lines; exported/declaration anchors: deriveSeasonBasedInputs, deriveWeightedSeasonInputs, isPitcher, isQuarterback, gamesPlayedFromRow, currentSeasonWeight, findRow.
- **Action:** MOVE behind NBA House adapter; preserve math, isolate NBA-specific behavior, add calibrated contextual adjustment and versioned scenario outputs.

### `src/lib/engine/providerDiagnostics.ts`
- **Observed:** 29 lines; exported/declaration anchors: ProviderHttpDiagnostics, providerHttpError, diagnosticsFromError.
- **Action:** REUSE provider integration unchanged where possible; wrap with provider adapters, TTL, provenance and rate-limit controls.

### `src/lib/engine/researchAgent.ts`
- **Observed:** 167 lines; exported/declaration anchors: ResearchAgentOptions, ResearchAgentInput, ResearchAgent.
- **Action:** REFACTOR research into persistent shared Street Team, preserve evidence filtering and provenance.

### `src/lib/engine/researchEvidence.ts`
- **Observed:** 268 lines; exported/declaration anchors: filterArticlesForSlate, explainArticleRejection, normalizeArticles, normalizeSourceUrl, resolveResearchEvidence, findingsFromAvailability, findConflicts.
- **Action:** REFACTOR research into persistent shared Street Team, preserve evidence filtering and provenance.

### `src/lib/engine/researchPlan.ts`
- **Observed:** 40 lines; exported/declaration anchors: createResearchPlan.
- **Action:** REFACTOR research into persistent shared Street Team, preserve evidence filtering and provenance.

### `src/lib/engine/rssProvider.ts`
- **Observed:** 54 lines; exported/declaration anchors: RssFeedConfig, DEFAULT_RSS_FEEDS, LEAGUE_NEWS_RSS_FEEDS, RssResearchProvider, createDefaultRssProviders, createLeagueNewsProviders, parseRss.
- **Action:** REUSE provider integration unchanged where possible; wrap with provider adapters, TTL, provenance and rate-limit controls.

### `src/lib/engine/runTrust.ts`
- **Observed:** 52 lines; exported/declaration anchors: buildRunTrust.
- **Action:** KEEP engine utility; add regression coverage and adjust only if new contract requires it.

### `src/lib/engine/selection.ts`
- **Observed:** 177 lines; exported/declaration anchors: SelectionInput, selectLineups, CashLineResolution, resolveCashLineProbability, overlap.
- **Action:** EXTEND objective scoring to portfolio-level expected net payout; preserve existing legality and bounded-search warnings.

### `src/lib/engine/sportsDataIoProvider.ts`
- **Observed:** 409 lines; exported/declaration anchors: SportsDataIoClientOptions, GolfProjectionRefresh, SportsDataIoGameWeather, WnbaRecentPlayerMinutes, NbaRecentPlayerGame, SportsDataIoClient, seasonParamFor.
- **Action:** REUSE provider integration unchanged where possible; wrap with provider adapters, TTL, provenance and rate-limit controls.

### `src/lib/engine/structuredSportsProvider.ts`
- **Observed:** 57 lines; exported/declaration anchors: JsonSportsProviderOptions, JsonSportsResearchProvider, espnProvider, ballDontLieProvider.
- **Action:** REUSE provider integration unchanged where possible; wrap with provider adapters, TTL, provenance and rate-limit controls.

### `src/lib/engine/validation.ts`
- **Observed:** 166 lines; exported/declaration anchors: EngineContractError, validateSlate, assertSupportedContractVersion, assertSlate, assertRosterFeasible, assertResearch, assertAdjustment.
- **Action:** EXTEND versioned boundary contracts with intel snapshot, model provenance, portfolio and result types; keep compatibility.

### `src/lib/engine/webResearchProvider.ts`
- **Observed:** 98 lines; exported/declaration anchors: normalizeResearchPublishedAt, SerpApiResearchProvider, FirecrawlResearchProvider.
- **Action:** REUSE provider integration unchanged where possible; wrap with provider adapters, TTL, provenance and rate-limit controls.

### `src/lib/floydDfsClient.ts`
- **Observed:** 366 lines; exported/declaration anchors: FloydGenerationResult, FloydSwapPlan, createFloydSwapPlans, confirmFloydSwapRecommendation, SCAN_STAGE_ORDER, SCAN_STAGE_LABELS, ScanProgressStage.
- **Action:** KEEP client utility and provider/client wrapper; extend typed endpoints only as needed.

### `src/lib/formatters.ts`
- **Observed:** 3 lines; exported/declaration anchors: formatNumber, formatMoney, formatDate.
- **Action:** KEEP client utility and provider/client wrapper; extend typed endpoints only as needed.

### `src/lib/monitoring.ts`
- **Observed:** 12 lines; exported/declaration anchors: initMonitoring.
- **Action:** KEEP client utility and provider/client wrapper; extend typed endpoints only as needed.

### `src/lib/productConstants.ts`
- **Observed:** 4 lines; exported/declaration anchors: SPORTS, CONTEST_TYPES.
- **Action:** KEEP client utility and provider/client wrapper; extend typed endpoints only as needed.

### `src/lib/sportsNewsClient.ts`
- **Observed:** 40 lines; exported/declaration anchors: SportsNewsItem, listSportsNews.
- **Action:** KEEP client utility and provider/client wrapper; extend typed endpoints only as needed.

### `src/lib/supabaseClient.ts`
- **Observed:** 14 lines; exported/declaration anchors: supabase, authenticatedHeaders.
- **Action:** KEEP client utility and provider/client wrapper; extend typed endpoints only as needed.

### `src/lib/theme.ts`
- **Observed:** 45 lines; exported/declaration anchors: COLORS, TYPOGRAPHY, SPACING, SHADOWS, RADIUS, TRANSITIONS.
- **Action:** KEEP client utility and provider/client wrapper; extend typed endpoints only as needed.

### `src/lib/validation.ts`
- **Observed:** 138 lines; exported/declaration anchors: ScanValidationInput, normalizePlayerName, parseExcludedPlayers, validateScanInput.
- **Action:** KEEP client utility and provider/client wrapper; extend typed endpoints only as needed.

### `src/main.tsx`
- **Observed:** 15 lines; exported/declaration anchors: —.
- **Action:** KEEP configuration/static assets; adjust routes/build scripts only when required.

### `src/pages/DesignSystem.tsx`
- **Observed:** 288 lines; exported/declaration anchors: DesignSystem.
- **Action:** MODIFY navigation/page to align with Street Team, NBA House, Lineup Lab and Learning; preserve existing controls where practical.

### `src/pages/HistoryPage.tsx`
- **Observed:** 224 lines; exported/declaration anchors: HistoryPage.
- **Action:** MODIFY navigation/page to align with Street Team, NBA House, Lineup Lab and Learning; preserve existing controls where practical.

### `src/pages/LearningPage.tsx`
- **Observed:** 211 lines; exported/declaration anchors: LearningPage.
- **Action:** MODIFY navigation/page to align with Street Team, NBA House, Lineup Lab and Learning; preserve existing controls where practical.

### `src/pages/ResearchPage.tsx`
- **Observed:** 7 lines; exported/declaration anchors: ResearchPage.
- **Action:** MODIFY navigation/page to align with Street Team, NBA House, Lineup Lab and Learning; preserve existing controls where practical.

### `src/pages/RunPage.tsx`
- **Observed:** 89 lines; exported/declaration anchors: RunPage.
- **Action:** MODIFY navigation/page to align with Street Team, NBA House, Lineup Lab and Learning; preserve existing controls where practical.

### `src/pages/ScanPage.tsx`
- **Observed:** 82 lines; exported/declaration anchors: ScanPage.
- **Action:** MODIFY navigation/page to align with Street Team, NBA House, Lineup Lab and Learning; preserve existing controls where practical.

### `src/pages/admin/AdminConsole.tsx`
- **Observed:** 51 lines; exported/declaration anchors: AdminConsole.
- **Action:** MODIFY navigation/page to align with Street Team, NBA House, Lineup Lab and Learning; preserve existing controls where practical.

### `src/styles/tokens.css`
- **Observed:** 51 lines; exported/declaration anchors: —.
- **Action:** KEEP configuration/static assets; adjust routes/build scripts only when required.

### `src/vite-env.d.ts`
- **Observed:** 25 lines; exported/declaration anchors: —.
- **Action:** KEEP configuration/static assets; adjust routes/build scripts only when required.

### `supabase/migrations/20260825000000_cash_line_calibration.sql`
- **Observed:** 14 lines; exported/declaration anchors: —.
- **Action:** KEEP migration immutable; inspect dependencies, add forward-only migration; do not edit applied SQL.

### `supabase/migrations/20260904000000_gate3_projection_artifacts.sql`
- **Observed:** 14 lines; exported/declaration anchors: —.
- **Action:** KEEP migration immutable; inspect dependencies, add forward-only migration; do not edit applied SQL.

### `supabase/migrations/20260905000000_nullable_legacy_lineup_candidate_columns.sql`
- **Observed:** 10 lines; exported/declaration anchors: —.
- **Action:** KEEP migration immutable; inspect dependencies, add forward-only migration; do not edit applied SQL.

### `supabase/migrations/20260905010000_add_cfb_engine_sport_constraints.sql`
- **Observed:** 13 lines; exported/declaration anchors: —.
- **Action:** KEEP migration immutable; inspect dependencies, add forward-only migration; do not edit applied SQL.

### `supabase/migrations/20260908010000_nullable_unavailable_contest_metrics.sql`
- **Observed:** 10 lines; exported/declaration anchors: —.
- **Action:** KEEP migration immutable; inspect dependencies, add forward-only migration; do not edit applied SQL.

### `supabase/migrations/20260929010000_five_sport_evidence_ledger.sql`
- **Observed:** 195 lines; exported/declaration anchors: floyd_dfs_source_observations, floyd_dfs_resolved_facts, floyd_dfs_run_data_snapshots, floyd_dfs_quantitative_adjustments, floyd_dfs_run_trust, floyd_dfs_run_scenarios, floyd_dfs_player_projection_components.
- **Action:** KEEP migration immutable; inspect dependencies, add forward-only migration; do not edit applied SQL.

### `supabase/migrations/20261002010000_contest_outcome_completeness.sql`
- **Observed:** 59 lines; exported/declaration anchors: floyd_dfs_historical_player_actuals.
- **Action:** KEEP migration immutable; inspect dependencies, add forward-only migration; do not edit applied SQL.

### `supabase/migrations/20261002020000_allow_exact_name_only_actual_match.sql`
- **Observed:** 7 lines; exported/declaration anchors: —.
- **Action:** KEEP migration immutable; inspect dependencies, add forward-only migration; do not edit applied SQL.

### `supabase/migrations/20261003010000_actual_integrity_and_contest_field_validation.sql`
- **Observed:** 128 lines; exported/declaration anchors: floyd_dfs_player_actual_revisions, floyd_dfs_contest_field_entries, floyd_dfs_lesson_observations.
- **Action:** KEEP migration immutable; inspect dependencies, add forward-only migration; do not edit applied SQL.

### `supabase/migrations/20261004010000_scrambled_actuals_and_entry_linking.sql`
- **Observed:** 76 lines; exported/declaration anchors: floyd_dfs_entry_links.
- **Action:** KEEP migration immutable; inspect dependencies, add forward-only migration; do not edit applied SQL.

### `supabase/migrations/20261021010000_scheduler_job_idempotency.sql`
- **Observed:** 16 lines; exported/declaration anchors: floyd_dfs_scheduler_runs.
- **Action:** KEEP migration immutable; inspect dependencies, add forward-only migration; do not edit applied SQL.

### `supabase/migrations/20261021020000_fds_single_tenant_rls.sql`
- **Observed:** 39 lines; exported/declaration anchors: —.
- **Action:** KEEP migration immutable; inspect dependencies, add forward-only migration; do not edit applied SQL.

### `supabase/migrations/20261021030000_fds_private_storage.sql`
- **Observed:** 12 lines; exported/declaration anchors: —.
- **Action:** KEEP migration immutable; inspect dependencies, add forward-only migration; do not edit applied SQL.

### `supabase/migrations/20261021040000_fds_p02_contract_schema.sql`
- **Observed:** 139 lines; exported/declaration anchors: floyd_dfs_player_provider_mappings, floyd_dfs_slate_games, floyd_dfs_player_photos, floyd_dfs_lineup_revisions, floyd_dfs_swap_plans, floyd_dfs_provider_health_checks, floyd_dfs_runtime_health_incidents.
- **Action:** KEEP migration immutable; inspect dependencies, add forward-only migration; do not edit applied SQL.

### `supabase/migrations/20261022010000_p06_p07_optimizer_diagnostics.sql`
- **Observed:** 32 lines; exported/declaration anchors: —.
- **Action:** KEEP migration immutable; inspect dependencies, add forward-only migration; do not edit applied SQL.

### `supabase/migrations/20261022020000_fds_p09_swap_plan_lineage.sql`
- **Observed:** 38 lines; exported/declaration anchors: —.
- **Action:** KEEP migration immutable; inspect dependencies, add forward-only migration; do not edit applied SQL.

### `supabase/migrations/20261022030000_p10_p12_actuals_and_dk_audit.sql`
- **Observed:** 23 lines; exported/declaration anchors: —.
- **Action:** KEEP migration immutable; inspect dependencies, add forward-only migration; do not edit applied SQL.

### `supabase/migrations/20261022040000_p11_actual_scoring_rule_fingerprints.sql`
- **Observed:** 7 lines; exported/declaration anchors: —.
- **Action:** KEEP migration immutable; inspect dependencies, add forward-only migration; do not edit applied SQL.

### `supabase/operations/p02-production-postflight.sql`
- **Observed:** 39 lines; exported/declaration anchors: —.
- **Action:** KEEP production operational runbook; extend with new migration checks only.

### `supabase/operations/p02-production-preflight.sql`
- **Observed:** 44 lines; exported/declaration anchors: —.
- **Action:** KEEP production operational runbook; extend with new migration checks only.

### `supabase/operations/p02-production-rollback.sql`
- **Observed:** 37 lines; exported/declaration anchors: —.
- **Action:** KEEP production operational runbook; extend with new migration checks only.

### `tsconfig.app.json`
- **Observed:** 26 lines; exported/declaration anchors: —.
- **Action:** KEEP configuration/static assets; adjust routes/build scripts only when required.

### `tsconfig.json`
- **Observed:** 7 lines; exported/declaration anchors: —.
- **Action:** KEEP configuration/static assets; adjust routes/build scripts only when required.

### `tsconfig.node.json`
- **Observed:** 23 lines; exported/declaration anchors: —.
- **Action:** KEEP configuration/static assets; adjust routes/build scripts only when required.

### `tsconfig.server.json`
- **Observed:** 17 lines; exported/declaration anchors: —.
- **Action:** KEEP configuration/static assets; adjust routes/build scripts only when required.

### `vercel.json`
- **Observed:** 9 lines; exported/declaration anchors: —.
- **Action:** KEEP configuration/static assets; adjust routes/build scripts only when required.

### `vite.config.ts`
- **Observed:** 17 lines; exported/declaration anchors: —.
- **Action:** KEEP configuration/static assets; adjust routes/build scripts only when required.

## B. Target architecture and dependency rules

```text
Scheduled Street Team collectors → Provider adapters → Immutable observations → Resolved current facts
                                                         ↘ point-in-time evidence snapshots
Contest selection → DK slate & payout validation → NBA House (baseline → evidence adjustments → connected-game trials)
                                                        → Lineup Agent (legal candidates → field simulations → portfolio optimization)
                                                        → immutable lineup/entry revisions
Official actuals + contest results → scoring reconciliation → calibration & attribution → gated model registry
Podcast Agent (future) ← House read-only briefing API
```

**Boundaries:** Street Team may collect and classify evidence but must not mutate projections. House owns NBA model outputs but must not place entries. Lineup Agent cannot invent player pool, salaries, contest payouts, or roster rules. Learning Engine may propose model changes but cannot automatically promote them without evaluation gates. Podcast reads House outputs without changing decisions. All services use existing tenant identity and auth patterns.

## C. Exact code-level change plan

### C1. New modules (create)

| File | Responsibility / interface |
|---|---|
| `server/streetTeam/collector.ts` | `collectSportIntel({sport, since, now, providerSet})` with idempotent observation writes |
| `server/streetTeam/scheduler.ts` | schedule NBA transaction/injury/news polling, retries, locks and TTL-aware cadence |
| `server/streetTeam/identity.ts` | canonical player/team mapping; quarantine ambiguous identities |
| `server/streetTeam/resolver.ts` | immutable observations → ranked facts with supersession/conflict records |
| `server/streetTeam/snapshot.ts` | `createIntelSnapshot({sport, asOf, slateId?})` point-in-time retrieval |
| `server/streetTeam/priority.ts` | active DK pool, confirmed rosters, rotations, watch list, background tiers |
| `server/streetTeam/behavior.ts` | verified quotes/reporting, hypotheses, source confidence, no default projection bump |
| `server/houses/nba/index.ts` | `analyzeNbaSlate(input): Promise<NbaHouseReport>` orchestration facade |
| `server/houses/nba/baseline.ts` | wrap current `projectSlate` and model provenance |
| `server/houses/nba/adjustments.ts` | wrap `adjustSlate`; evidence/driver-level adjustment limits |
| `server/houses/nba/simulation.ts` | wrap `applyGameSimulation`, store seed/trial distributions and scenario validation |
| `server/houses/nba/report.ts` | NBA scouting and decision brief, facts versus hypotheses |
| `server/lineupAgent/contest.ts` | validate DK contest format, payouts, entry limits and readiness |
| `server/lineupAgent/portfolio.ts` | select N lineups jointly, using correlated payouts and diversification constraints |
| `server/lineupAgent/entry.ts` | reconcile generated/entered/withdrawn lineups, preserve entry revision |
| `server/learning/evaluate.ts` | as-of evaluation, player errors, coverage, payout/ROI, source attribution |
| `server/learning/promotion.ts` | model registry + promotion criteria; shadow→canary→active |
| `src/pages/StreetTeamPage.tsx` | NBA briefing, live changes, provenance, history |
| `src/pages/HousePage.tsx` | NBA assumptions, baseline vs adjusted, scenarios, confidence |
| `src/pages/LineupLabPage.tsx` | DK-style contest setup, captain/flex, portfolios, entry tracking |
| `src/components/PortfolioResults.tsx` | correlated cash probability, net payout and actual return breakdown |
| `api/street-team/briefings.ts` | authenticated latest and historical briefing reads |
| `api/street-team/collect.ts` | scheduler-secret collector endpoint, idempotent per window |
| `api/house/nba/analyze.ts` | authenticated snapshot-based NBA analysis |
| `api/lineup-portfolios.ts` | generate/read portfolio from candidate sets |
| `api/model-evaluations.ts` | evaluation and promotion read surface |

### C2. Modify existing files (high-priority exact anchors)

| Existing file | Specific change |
|---|---|
| `server/runtime.ts` | Extract orchestration stages into services; call `createIntelSnapshot` before research; route NBA to House; retain `tenantContext`, `schedulerContext`, `workerTenantContext` and error handling |
| `src/lib/engine/researchAgent.ts` | Preserve provider fanout, 8s provider/25s synthesis timeouts and source filtering; accept precollected snapshots; use slate-specific research only for unresolved gaps |
| `src/lib/engine/researchPlan.ts` | Add high-priority NBA transaction, injury, return-to-play and rotation watch assignments |
| `src/lib/engine/researchEvidence.ts` | Add source-type/evidence-class labels, corroboration, behavioral claim separation |
| `src/lib/engine/factResolution.ts` | Add effective time, superseded facts, and as-of query semantics |
| `server/evidenceLedger.ts` | Persist immutable observation references, snapshot fingerprint, run association and idempotency |
| `src/lib/engine/contracts.ts` | Add StreetTeamSnapshot, NbaHouseReport, ContestPayoutReadiness, PortfolioSelection, ModelEvaluation; increment contract version compatibly |
| `src/lib/engine/boundaryContracts.ts` | Parse/validate new boundaries; reject mismatched sport, slate, tenant, version or cutoff |
| `src/lib/engine/projection.ts` | Separate raw baseline and adjusted projection; keep original samples and driver attribution |
| `src/lib/engine/adjustment.ts` | Require measured driver/guardrail for numerical behavioral effects; report-only default |
| `src/lib/engine/gameSimulation.ts` | Preserve connected scenarios; add reproducibility, overtime/blowout diagnostics, covariance checks and validation gating |
| `src/lib/engine/contestSimulation.ts` | Keep payout and expected-profit logic; expose paired trial-level payout samples and field model version |
| `src/lib/engine/optimizer.ts` | Preserve legal enumeration and bounded-search warnings; expose candidate pool to portfolio optimization and compare objective strategies |
| `src/lib/engine/selection.ts` | Select lineups jointly across entered portfolio, with explicit max overlap/exposure policies |
| `src/lib/engine/calibration.ts` | Add time-split calibration and distribution coverage diagnostics |
| `src/lib/engine/learningMetrics.ts` | Add lineup-level actual profit, ROI, cash rate, and proper scoring rules |
| `src/lib/engine/lessonPromotion.ts` | Require minimum samples and out-of-sample uplift before enabling lessons |
| `api/generation-runs.ts` | Continue existing route; delegate new runs to NBA House when feature flag enabled |
| `api/generation-runs/[runId]/refresh.ts` | Create a new snapshot/revision rather than rewriting historical forecast |
| `api/generation-runs/[runId]/recheck.ts` | Compare current roster/availability and invalidation reason against stored forecast |
| `api/lineups/[lineupId]/entered.ts` | Capture actual entry identifier, entry timestamp, fee, contest and submitted revision |
| `api/results/import.ts` | Attach official outcomes to immutable projection and entry snapshots |
| `api/results/import-field.ts` | Record field data completeness, rank/payout source and contest model calibration |
| `src/App.tsx` | Add `/street-team`, `/house/nba`, `/lineup-lab`; keep redirects for `/`, `/runs/:runId`, `/research/:runId`, `/learning` |
| `src/components/Navigation.tsx` | Present Street Team, NBA House, Lineup Lab, History, Learning |
| `src/pages/ScanPage.tsx` | Transition into contest/slate selection, or retain as compatibility route |
| `src/pages/ResearchPage.tsx` | Show persistent scouting intelligence plus run-specific snapshot |
| `src/pages/RunPage.tsx` | Show stage lineage and NBA House/Lineup Agent results |
| `src/pages/LearningPage.tsx` | Show calibration and actual money outcomes, not just wins/losses |

## D. Additive target database schemas

Preserve existing `floyd_dfs_*` tables, RLS, tenant keys and applied migrations. New migration: `supabase/migrations/20261030010000_street_team_nba_house.sql`. Follow with `20261030020000_portfolios_model_registry.sql`. Types below are logical SQL examples; adapt FK names to the existing production schema before execution.

```sql
create table public.floyd_dfs_intel_collection_runs (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, sport text not null,
 provider text not null, window_start timestamptz not null, window_end timestamptz not null,
 status text not null check(status in ('PENDING','RUNNING','COMPLETE','PARTIAL','FAILED')),
 started_at timestamptz not null default now(), finished_at timestamptz,
 unique(tenant_id,sport,provider,window_start,window_end));
create table public.floyd_dfs_intel_snapshots (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, sport text not null,
 as_of timestamptz not null, evidence_hash text not null,
 observation_ids jsonb not null default '[]'::jsonb,
 resolved_facts jsonb not null default '[]'::jsonb,
 created_at timestamptz not null default now(),
 unique(tenant_id,sport,as_of,evidence_hash));
create table public.floyd_dfs_behavior_signals (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, sport text not null,
 player_id text, team_id text, source_observation_id uuid,
 signal_type text not null, claim text not null, evidence_class text not null,
 confidence numeric check(confidence between 0 and 1),
 model_effect numeric, effect_status text not null default 'REPORT_ONLY',
 effective_at timestamptz, observed_at timestamptz not null default now());
create table public.floyd_dfs_house_reports (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, sport text not null,
 generation_run_id uuid, intel_snapshot_id uuid references public.floyd_dfs_intel_snapshots(id),
 model_version text not null, forecast_cutoff timestamptz not null,
 baseline jsonb not null, adjustments jsonb not null, scenario_metadata jsonb not null,
 trust_status text not null, created_at timestamptz not null default now());
create table public.floyd_dfs_lineup_portfolios (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
 contest_id text not null, generation_run_id uuid, model_version text not null,
 entry_count int not null check(entry_count > 0),
 estimated_net_payout numeric, cash_probability numeric,
 objective text not null, created_at timestamptz not null default now());
create table public.floyd_dfs_portfolio_members (
 portfolio_id uuid not null references public.floyd_dfs_lineup_portfolios(id),
 lineup_id uuid not null, lineup_revision int not null, entry_status text not null,
 estimated_payout numeric, actual_payout numeric, entry_fee numeric,
 primary key(portfolio_id,lineup_id,lineup_revision));
create table public.floyd_dfs_model_registry (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, sport text not null,
 component text not null, model_version text not null, status text not null,
 config jsonb not null, evaluation_id uuid, created_at timestamptz not null default now(),
 unique(tenant_id,sport,component,model_version));
```

Apply existing tenant RLS conventions to all new tables, including policy coverage for reads and writes; never expose service-role credentials to the browser. Add indexes on `(tenant_id,sport,as_of desc)`, `(tenant_id,sport,observed_at desc)`, and `(tenant_id,contest_id,created_at desc)`. Treat the ledger as append-only; new snapshots reference observations rather than replacing history.

## E. Agent contracts and handoffs

### Street Team
**Input:** `{tenantId,sport,asOf,providerSet,watchlist?,slateId?}`. **Output:** `{snapshotId,asOf,rosterState,availability,transactions,observations[],resolvedFacts[],behaviorSignals[],unknowns[],providerDiagnostics[],hash}`. **Guarantees:** source URL/ID, published/effective/retrieved times, identity mapping, freshness, provenance; no invented facts; separate report-only hypotheses; idempotent collection. **Triggers:** schedule, significant transaction/injury update, contest pre-lock refresh.

### NBA House
**Input:** `{validatedSlate,intelSnapshotId,baselineModelVersion,simulationMode,seed,forecastCutoff}`. **Output:** `{houseReportId,baselineProjections,adjustedProjections,driverAttributions,scenarioDistributions,trustStatus,unknowns,modelVersions}`. **Guarantees:** sport NBA only; point-in-time evidence; reproducible seed; preserved unadjusted baseline; no numeric behavior changes without validation.

### Lineup Agent
**Input:** `{validatedSlate,houseReportId,contestRules,payoutTiers,entryCount,portfolioConstraints}`. **Output:** `{portfolioId,candidates[],selectedLineups[],legalValidation[],expectedPayout,expectedProfit,cashProbability,fieldModelVersion,warnings}`. **Guarantees:** no unverified players; salary, captain multipliers and slot eligibility exact; never fabricate missing payout structures; incomplete payouts downgrade expected-profit status to unavailable.

### Learning Engine
**Input:** `{portfolioId,houseReportId,entryRevisions,officialActuals,fieldResults,payouts}`. **Output:** `{evaluationId,projectionErrors,calibration,simulationCoverage,portfolioROI,attribution,proposedChanges,gateDecision}`. **Guarantees:** immutable forecast cutoff; no post-lock leakage; distinguish player prediction errors from contest/ownership model errors; no automatic self-edit of production model.

## F. Execution order and milestones

1. **P0 Baseline:** tag release; snapshot current schema; run `npm ci`, `npm run build`, `npm run check:server`, `npm run lint`, `npm run test:parity`, `npm run test:fixtures`, `npm run test:contracts`, `npm run test:auth`, `npm run test:actual-sources`; record existing failures and known fixtures. Check package scripts referring to absent files.
2. **P1 Contracts:** implement type additions, boundary validation and feature flags; add additive migrations and RLS tests; no UI changes yet.
3. **P2 Street Team:** provider adapters → canonical identity → idempotent collector → immutable evidence → latest facts → snapshots → briefing API. Test with NBA only.
4. **P3 NBA House:** inject snapshot into current stage pipeline; isolate baseline and adjustment; emit House report; preserve current outputs for side-by-side parity.
5. **P4 Simulation verification:** replay historical slates and evaluate game correlation, distribution calibration, minutes, blowouts and outcomes; keep UNVALIDATED until gates pass.
6. **P5 Lineup Agent:** payout-ready contest selection, lineup legality, portfolio selection, actual entry revisions and DK-like presentation.
7. **P6 Learning:** official actuals, entry/field reconciliation, walk-forward scoring, portfolio ROI, versioned model registry and promotion gates.
8. **P7 Rollout:** shadow runs, canary for NBA only, parity dashboards, rollback switches, old route compatibility; other sports remain unchanged.

## G. Testing matrix and acceptance criteria

| Area | Required tests | Pass condition |
|---|---|
| Providers | mocked success/timeout/rate-limit, duplicate records, stale source, contradictory injury | no invented facts; idempotent retry; diagnostics persisted |
| Identity | traded player, same-name players, former-team match, inactive DK player | canonical current team; uncertain matches quarantined |
| Time travel | Monday injured, Tuesday injured, Wednesday active; run as-of each day | historical Monday/Tuesday runs cannot see Wednesday |
| Research | verified report vs speculation; duplicate syndication; source priority | behavior default report-only; conflicting facts surfaced |
| House | baseline vs adjusted, out-of-roster exclusion, injury minutes | attributable adjustments, reproducible outputs |
| Simulations | fixed seeds, correlated players, overtime, blowout, missing opponent | stable outputs; incomplete scenarios visibly degraded |
| Optimizer | Showdown captain 1.5× salary/points, cap, slots, uniqueness, lock, multiple entries | all selected lineups legal; truncated search warning retained |
| Contest EV | incomplete payouts, ties, multi-entry covariance, field size | no invented EV; portfolio expected payout computed jointly |
| Learning | official scoring, corrected actuals, late entries, walk-forward validation | immutable original forecast; corrected result version retained |
| Security | tenant isolation, scheduler auth, operator restrictions, RLS | cross-tenant requests rejected; browser never gets service key |
| UI | mobile and desktop, error/empty/partial states, entry confirmation | all critical workflows usable; no silent missing data |

### Quantitative promotion gates (proposed, not claimed achieved)

- On held-out chronological NBA slates, the adjusted projection model must beat or match baseline on a predefined proper scoring metric and show no material calibration regression.
- Report coverage of 50%/80%/90% prediction intervals against realized outcomes; do not assert validation from a handful of slates.
- Field simulation and cash probabilities must pass calibration checks across contest-size segments before EV is shown as trusted.
- Portfolio objective must beat the existing independent-lineup selector in paired backtests or remain experimental.
- Track entry fees, payout, net profit, ROI, cash rate, first-place rate and uncertainty; positive ROI is an observed outcome, never guaranteed.
- No unsupported numeric psychological adjustments; source and model versions present for every promoted report.

## H. Deployment, operational safeguards, and cost controls

- Preserve existing Vercel cron endpoints (`weekly-report`, `draftkings-audit`) and add NBA Street Team collection cadence via new authenticated cron/worker.
- Use provider-specific TTLs and event-driven refresh for injury/transaction changes; prioritize players in active DK pools, then watch list, then archival coverage.
- Cap LLM synthesis calls; deduplicate sources and cache evidence; use structured providers before web search; only trigger deep research for unresolved high-impact gaps.
- Store seeds, code/model versions, source timestamps, roster hashes, scoring fingerprints and payout fingerprints for every run.
- Guard runtime and spend with maximum player pool, trial count, candidate count, provider request budget and LLM token budget; surface partial readiness rather than fake precision.
- Keep rollback to current run path behind feature flags `STREET_TEAM_V2`, `NBA_HOUSE_V1`, `PORTFOLIO_EV_V1`, `LEARNING_V2`.

## I. Key open implementation checks

1. **Resolved 2026-10-30:** the current `package.json` contains no commands referencing `scripts/import-draftkings-slate.mjs`, `scripts/import-mlb-actual-results.mjs`, or `scripts/import-projection-results.mjs`; those absent scripts are not exposed as current project commands and are not release gates. The Phase 0 baseline retains its historical inventory of the earlier package state.
2. **Resolved 2026-10-30:** before the additive migrations, the P0 production catalog snapshot was captured with table columns, defaults, constraints, indexes, RLS policies, views, and triggers; the additive FK names/types were based on that schema evidence. The linked production migration ledger was subsequently verified aligned through `20261030060000` with no pending or remote-only versions. The snapshot is catalog metadata, not a complete `pg_dump` DDL artifact.
3. Existing NBA connected-game simulation is explicitly provisional; do not infer real-world accuracy from presence of code.
4. **NBA access and storage verified 2026-10-30:** the user confirmed SportsDataIO production NBA access and storage rights, and the `SPORTS_DATA_IO_DATA_TIER=PRODUCTION_VERIFIED` marker was added to Vercel Production. Rate limits, rights for other sports/feeds, and redistribution or commercial-use terms remain outside that confirmation and require separate review before those uses.
5. **Resolved 2026-10-30:** `.gitignore` excludes `dist/` and `supabase/.temp/`; `git ls-files dist supabase/.temp` returned no tracked generated artifacts. Continue excluding these directories from source reviews and commits.

## J. Definition of done — NBA V1

An authenticated user can select a real NBA DK contest and requested number of entries; the Street Team has continuously collected and versioned official roster/injury/transaction intelligence; the NBA House generates reproducible baseline and adjusted projections with traceable evidence and calibrated scenario outputs; the Lineup Agent creates legal, payout-aware portfolios or explicitly marks unavailable payout data; the user marks submitted entries; the Learning Engine reconciles official player/contest outcomes, measures financial results, and generates gated improvement proposals. Existing non-NBA functionality remains usable; all baseline and new contract/security tests pass; shadow/canary comparisons are documented; rollback is verified.
