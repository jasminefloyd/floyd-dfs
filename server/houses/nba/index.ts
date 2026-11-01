import type { SupabaseClient } from '@supabase/supabase-js';
import { ENGINE_CONTRACT_VERSION, type NbaHouseReport, type ProjectionPackage, type StreetTeamSnapshot, type ValidatedSlate } from '../../../src/lib/engine/contracts.js';
import { parseNbaHouseReport } from '../../../src/lib/engine/boundaryContracts.js';
import { assertProjection } from '../../../src/lib/engine/validation.js';
import { getStreetTeamSnapshot, NBA_STREET_TEAM_SNAPSHOT_TTL_MS } from '../../streetTeam.js';
import { versionPayload } from '../../intelligence/contracts.js';
import { buildNbaBaseline } from './baseline.js';
import { buildNbaCandidate } from './adjustments.js';
import { NBA_HOUSE_DRIVER_POLICY_VERSION } from './driverPolicy.js';
import { buildDriverAttributions, splitDriverDecisions } from './report.js';

/** Build a report-only NBA House artifact. This facade never changes the caller's projection. */
export async function analyzeNbaSlate(db: SupabaseClient, run: Record<string, unknown>, slate: ValidatedSlate, adjustedProjections: ProjectionPackage, approvedPolicyVersion?: string, suppliedSnapshot?: StreetTeamSnapshot, registeredModelVersion?: string): Promise<NbaHouseReport | null> {
  const tenantId = String(run.tenant_id ?? '');
  const generationRunId = String(run.id ?? '');
  if (!tenantId || !generationRunId) throw new Error('NBA House requires tenant and generation-run identities.');
  if (slate.sport !== 'NBA' || slate.tenantId !== tenantId) throw new Error('NBA House requires a tenant-matched NBA slate.');

  const snapshot: StreetTeamSnapshot | null = suppliedSnapshot ?? await getStreetTeamSnapshot(db, tenantId);
  if (!snapshot) return null;
  if (snapshot.sport !== 'NBA' || snapshot.tenantId !== tenantId || Date.parse(snapshot.asOf) > Date.now()) throw new Error('NBA House received a cross-tenant, wrong-sport, or future Street Team snapshot.');

  const generatedAt = new Date().toISOString();
  const asOf = new Date(generatedAt);
  const baselineProjections = buildNbaBaseline({ slate, snapshot, asOf });
  const candidate = buildNbaCandidate({ slate, snapshot, baseline: baselineProjections, asOf, approvedPolicyVersion });
  const houseModelVersion = registeredModelVersion ?? 'nba-house.shadow.v1';
  const candidateProjection = { ...candidate.projection, modelVersion: houseModelVersion };
  const driverAttributions = buildDriverAttributions({ decisions: candidate.decisions, baseline: baselineProjections, candidate: candidate.projection, modelVersion: houseModelVersion });
  assertProjection(candidate.projection);
  const snapshotAgeMs = Date.now() - Date.parse(snapshot.asOf);
  const snapshotStale = snapshotAgeMs > NBA_STREET_TEAM_SNAPSHOT_TTL_MS;
  const warnings = [
    'Street Team evidence is attached for point-in-time audit; unsupported Street Team or behavioral effects remain non-numeric.',
    approvedPolicyVersion ? `The explicit minutes-cap candidate uses reviewed policy ${approvedPolicyVersion}; this report remains separate from runtime output until the model registry rollout gate selects it.` : 'Driver candidates remain report-only until the preregistered NBA evaluation and authorized review approve the policy version.',
  ];
  if (snapshotStale) warnings.push(`The latest Street Team snapshot is older than the configured 24-hour NBA freshness window (${Math.floor(snapshotAgeMs / 60_000)} minutes old).`);
  if (adjustedProjections.gameSimulation?.releaseStatus === 'UNVALIDATED') warnings.push('Connected game scenarios remain unvalidated against prospective NBA actuals.');
  const scenarioDistributions = adjustedProjections.gameSimulation && adjustedProjections.gameSimulation.mode !== 'BASELINE'
    ? [{
      scenarioId: `${adjustedProjections.gameSimulation.modelVersion}:${adjustedProjections.gameSimulation.seed}`,
      scenarioType: 'CONNECTED_GAME_TRIAL_DISTRIBUTION',
      playerOutcomes: Object.fromEntries(adjustedProjections.players.map((player) => {
        const samples = [...(player.simulatedFantasyPointSamples ?? [])].sort((left, right) => left - right);
        const quantile = (probability: number): number => {
          if (!samples.length) return player.projectedOutcomes.medianP50;
          const index = (samples.length - 1) * probability;
          const lower = Math.floor(index); const upper = Math.ceil(index);
          return samples[lower] + (samples[upper] - samples[lower]) * (index - lower);
        };
        return [player.playerId, { p10: quantile(0.1), p20: quantile(0.2), p50: quantile(0.5), p80: quantile(0.8), p90: quantile(0.9) }];
      })),
    }]
    : [];
  if (!scenarioDistributions.length) warnings.push('No connected game simulation was requested; scenario distributions are unavailable for this baseline run.');
  const trustStatus: NbaHouseReport['trustStatus'] = baselineProjections.status === 'BLOCKED' || adjustedProjections.status === 'BLOCKED'
    ? 'BLOCKED'
    : baselineProjections.status === 'PARTIAL' || adjustedProjections.status === 'PARTIAL' || snapshotStale || snapshot.providerDiagnostics.some((item) => item.status === 'FAILED' || item.status === 'RATE_LIMITED' || item.freshness !== 'FRESH')
      ? 'PARTIAL'
      : 'UNVALIDATED';
  const report = parseNbaHouseReport({
    contractVersion: ENGINE_CONTRACT_VERSION, houseReportId: crypto.randomUUID(), tenantId, sport: 'NBA', slateId: slate.slateId,
    intelSnapshotId: snapshot.snapshotId, modelVersion: houseModelVersion, baselineModelVersion: baselineProjections.modelVersion,
    forecastCutoff: snapshot.asOf, generatedAt, baselineProjections, adjustedProjections, driverAttributions, scenarioDistributions,
    trustStatus, unknowns: snapshot.unknowns.map((item) => item.question), warnings,
  }, { expectedTenantId: tenantId, expectedSlateId: slate.slateId, intelSnapshot: snapshot });
  const inserted = await db.from('floyd_dfs_house_reports').insert({
    id: report.houseReportId, tenant_id: tenantId, sport: 'NBA', generation_run_id: generationRunId, intel_snapshot_id: report.intelSnapshotId,
    model_version: report.modelVersion, baseline_model_version: report.baselineModelVersion, forecast_cutoff: report.forecastCutoff,
    baseline: versionPayload(report.baselineProjections), adjustments: versionPayload({ adjustedProjections: report.adjustedProjections, candidateProjection, driverAttributions: report.driverAttributions }),
    scenario_metadata: versionPayload({ simulation: adjustedProjections.gameSimulation ?? null, scenarioDistributions: report.scenarioDistributions, behaviorSignals: snapshot.behaviorSignals, driverDecisions: splitDriverDecisions(candidate.decisions), candidateProjection, playerCatalog: slate.playerPool.map((player) => ({ playerId: player.playerId, playerName: player.playerName, team: player.team ?? null, gameId: player.gameId ?? null })), policyVersion: NBA_HOUSE_DRIVER_POLICY_VERSION, evaluationState: 'UNVALIDATED', trustStatus: report.trustStatus, unknowns: report.unknowns, warnings }),
    trust_status: report.trustStatus,
  });
  if (inserted.error) throw inserted.error;
  return { ...report, candidateProjection, driverDecisions: splitDriverDecisions(candidate.decisions) };
}
