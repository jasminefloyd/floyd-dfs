import type { SupabaseClient } from '@supabase/supabase-js';
import { ENGINE_CONTRACT_VERSION, type AdjustmentPackage, type NbaHouseReport, type ProjectionPackage, type StreetTeamSnapshot, type ValidatedSlate } from '../../../src/lib/engine/contracts.js';
import { parseNbaHouseReport } from '../../../src/lib/engine/boundaryContracts.js';
import { projectSlate } from '../../../src/lib/engine/projection.js';
import { assertProjection } from '../../../src/lib/engine/validation.js';
import { getStreetTeamSnapshot } from '../../streetTeam.js';

/** Build a report-only NBA House artifact. This facade never changes the caller's projection. */
export async function analyzeNbaSlate(db: SupabaseClient, run: Record<string, unknown>, slate: ValidatedSlate, adjustedProjections: ProjectionPackage): Promise<NbaHouseReport | null> {
  const tenantId = String(run.tenant_id ?? '');
  const generationRunId = String(run.id ?? '');
  if (!tenantId || !generationRunId) throw new Error('NBA House requires tenant and generation-run identities.');
  if (slate.sport !== 'NBA' || slate.tenantId !== tenantId) throw new Error('NBA House requires a tenant-matched NBA slate.');

  const snapshot: StreetTeamSnapshot | null = await getStreetTeamSnapshot(db, tenantId);
  if (!snapshot) return null;
  if (snapshot.sport !== 'NBA' || snapshot.tenantId !== tenantId || Date.parse(snapshot.asOf) > Date.now()) throw new Error('NBA House received a cross-tenant, wrong-sport, or future Street Team snapshot.');

  const generatedAt = new Date().toISOString();
  const baselineAdjustment: AdjustmentPackage = { slateId: slate.slateId, tenantId, sport: 'NBA', version: 1, generatedAt, adjustments: [], researchGaps: [], status: 'COMPLETE' };
  const baselineProjections = projectSlate(slate, baselineAdjustment, new Date(generatedAt));
  assertProjection(baselineProjections);
  const snapshotAgeMs = Date.now() - Date.parse(snapshot.asOf);
  const snapshotStale = snapshotAgeMs > 24 * 60 * 60_000;
  const warnings = [
    'Street Team evidence is attached for point-in-time audit; this House version does not apply unvalidated Street Team or behavioral effects to numeric projections.',
    'Evidence-linked numeric driver attributions are unavailable until calibrated House adjustments are implemented.',
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
    intelSnapshotId: snapshot.snapshotId, modelVersion: 'nba-house.shadow.v1', baselineModelVersion: baselineProjections.modelVersion,
    forecastCutoff: snapshot.asOf, generatedAt, baselineProjections, adjustedProjections, driverAttributions: [], scenarioDistributions,
    trustStatus, unknowns: snapshot.unknowns.map((item) => item.question), warnings,
  }, { expectedTenantId: tenantId, expectedSlateId: slate.slateId, intelSnapshot: snapshot });
  const inserted = await db.from('floyd_dfs_house_reports').insert({
    id: report.houseReportId, tenant_id: tenantId, sport: 'NBA', generation_run_id: generationRunId, intel_snapshot_id: report.intelSnapshotId,
    model_version: report.modelVersion, baseline_model_version: report.baselineModelVersion, forecast_cutoff: report.forecastCutoff,
    baseline: report.baselineProjections, adjustments: { adjustedProjections: report.adjustedProjections, driverAttributions: report.driverAttributions },
    scenario_metadata: { simulation: adjustedProjections.gameSimulation ?? null, scenarioDistributions: report.scenarioDistributions, trustStatus: report.trustStatus, unknowns: report.unknowns, warnings },
    trust_status: report.trustStatus,
  });
  if (inserted.error) throw inserted.error;
  return report;
}
