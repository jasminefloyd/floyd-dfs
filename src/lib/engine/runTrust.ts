import type { OptimizerPackage, ProjectionPackage, ResearchPackage, RunTrust, SelectionPackage, ValidatedSlate } from './contracts.js';

/**
 * Summarizes whether a generated lineup is safe to present as entry-ready.
 * A finished pipeline is not a validated model: until sport/format backtests and
 * production rule fixtures certify the model, recommendations remain provisional.
 */
export function buildRunTrust(input: {
  slate: ValidatedSlate;
  research: ResearchPackage;
  projection: ProjectionPackage;
  optimizer: OptimizerPackage;
  selection: SelectionPackage;
  expiredFindingIds?: string[];
}): RunTrust {
  const { slate, research, projection, optimizer, selection } = input;
  const criticalUnknowns = (research.unknowns ?? []).filter((item) => item.importance === 'CRITICAL' || item.importance === 'HIGH');
  const fallbackPlayers = projection.players.filter((player) => player.modelPath === 'PROVIDER_FPPG_FALLBACK').map((player) => player.playerId);
  const missingRequiredFacts = [...criticalUnknowns.map((item) => item.reason), ...projection.gaps.map((item) => item.reason)];
  const staleFacts = input.expiredFindingIds ?? [];
  const releaseReasons = new Set<string>();

  if (slate.validation.status === 'BLOCKED') releaseReasons.add('Contest or slate validation is blocked.');
  if (criticalUnknowns.length) releaseReasons.add(`${criticalUnknowns.length} high-impact research question(s) remain unresolved.`);
  if (projection.status !== 'COMPLETE') releaseReasons.add(`Projection stage is ${projection.status.toLowerCase()}.`);
  if (research.status !== 'COMPLETE') releaseReasons.add(`Research stage is ${research.status.toLowerCase()}.`);
  if (fallbackPlayers.length) releaseReasons.add(`${fallbackPlayers.length} player projection(s) use the provider FPPG fallback.`);
  if (staleFacts.length) releaseReasons.add(`${staleFacts.length} research fact(s) expired before this run completed.`);
  if (optimizer.searchCompleteness !== 'EXHAUSTIVE') releaseReasons.add('Optimizer search is heuristic; no proven optimality bound is available.');
  if (optimizer.contestSimulation?.status !== 'COMPLETE' || optimizer.contestSimulation.fieldModel === 'UNAVAILABLE') releaseReasons.add('Contest outcome metrics are unavailable or use an unvalidated field model.');
  // No sport/format has the required as-of holdout and production trace certification yet.
  releaseReasons.add('Sport/format model validation and production certification are not recorded.');

  const isBlocked = slate.validation.status === 'BLOCKED' || projection.status === 'BLOCKED' || selection.status === 'BLOCKED';
  const isDegraded = !isBlocked && (research.status !== 'COMPLETE' || projection.status !== 'COMPLETE' || fallbackPlayers.length > 0 || staleFacts.length > 0 || optimizer.searchCompleteness !== 'EXHAUSTIVE');
  const dataTier: RunTrust['dataTier'] = isBlocked ? 'BLOCKED' : isDegraded ? 'DEGRADED' : 'COMPLETE';
  const modelTier: RunTrust['modelTier'] = 'UNVALIDATED';
  const entryEligible = false;

  return {
    dataTier,
    modelTier,
    recommendationStatus: isBlocked ? 'BLOCKED' : entryEligible ? 'ENTRY_READY' : 'PROVISIONAL',
    entryEligible,
    releaseReasons: [...releaseReasons],
    missingRequiredFacts,
    staleFacts,
    fallbackPlayers,
    searchCompleteness: optimizer.searchCompleteness === 'EXHAUSTIVE' ? 'EXHAUSTIVE' : 'HEURISTIC',
    contestMetricState: optimizer.contestSimulation?.status === 'COMPLETE' && optimizer.contestSimulation.fieldModel !== 'UNAVAILABLE' ? 'SIMULATED_UNVALIDATED' : 'UNAVAILABLE',
  };
}
