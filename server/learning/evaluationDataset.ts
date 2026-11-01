import { createHash } from 'node:crypto';

export interface VerifiedForecastRow {
  projection_run_id?: string; generation_run_id?: string; slate_id?: string; player_id?: string; provider_game_id?: string | null; sport?: string;
  model_version?: string; contest_format?: string; position?: string | null; projection_generated_at?: string; lock_time?: string; projected_floor?: number | null;
  projected_median?: number | null; projected_ceiling?: number | null; baseline_fppg?: number | null;
  actual_dk_points?: number | null; source_validation_status?: string; finality_status?: string;
  projected_minutes?: number | null; actual_minutes?: number | null; projected_usage?: number | null; actual_usage?: number | null;
  projected_role?: string | null; actual_role?: string | null;
  game_type?: string | null; player_role?: string | null; injury_return?: string | null; contest_field_size?: number | null;
}
export interface EvaluationDataset {
  rows: Array<{ projectionRunId: string; generationRunId: string; slateId: string; gameId?: string; playerId: string; sport: string; format: string; position: string; modelVersion: string; generatedAt: string; lockTime: string; floor?: number; median: number; ceiling?: number; baseline: number; actual: number; projectedMinutes?: number; actualMinutes?: number; projectedUsage?: number; actualUsage?: number; projectedRole?: string; actualRole?: string; gameType?: string; playerRole?: string; injuryReturn?: string; contestFieldSize?: number }>;
  datasetSha256: string;
  independentSlates: number;
  exclusions: Record<string, number>;
}

/** Join only exact projection-run/player records whose verified final actual is strictly post-lock. */
export function buildEvaluationDataset(input: VerifiedForecastRow[]): EvaluationDataset {
  const exclusions: Record<string, number> = {};
  const duplicateKeys = new Set<string>(); const seen = new Set<string>();
  for (const row of input) {
    const key = `${row.projection_run_id ?? ''}:${row.player_id ?? ''}`;
    if (!row.projection_run_id || !row.player_id) continue;
    if (seen.has(key)) duplicateKeys.add(key); else seen.add(key);
  }
  const rows = input.flatMap((row) => {
    const reject = (reason: string) => { exclusions[reason] = (exclusions[reason] ?? 0) + 1; return []; };
    const key = `${row.projection_run_id ?? ''}:${row.player_id ?? ''}`;
    if (!row.projection_run_id || !row.player_id || !row.generation_run_id || !row.slate_id || !row.model_version) return reject('MISSING_CANONICAL_IDENTITY');
    const sport = String(row.sport ?? 'UNKNOWN').toUpperCase();
    if (sport === 'NBA' && !String(row.provider_game_id ?? '').trim()) return reject('MISSING_CANONICAL_GAME_ID');
    if (duplicateKeys.has(key)) return reject('DUPLICATE_PROJECTION_PLAYER_JOIN');
    if (row.source_validation_status !== 'VERIFIED' || !['FINAL', 'CORRECTED'].includes(String(row.finality_status))) return reject('ACTUAL_NOT_VERIFIED_FINAL');
    const generatedAt = Date.parse(String(row.projection_generated_at ?? '')); const lockTime = Date.parse(String(row.lock_time ?? ''));
    if (!Number.isFinite(generatedAt) || !Number.isFinite(lockTime) || generatedAt >= lockTime) return reject('FORECAST_NOT_VERIFIABLY_PRELOCK');
    const median = finite(row.projected_median); const baseline = finite(row.baseline_fppg); const actual = finite(row.actual_dk_points);
    if (median === null || baseline === null || actual === null) return reject('MISSING_REQUIRED_NUMERIC_VALUE');
    const floor = finite(row.projected_floor); const ceiling = finite(row.projected_ceiling);
    const projectedMinutes = finite(row.projected_minutes); const actualMinutes = finite(row.actual_minutes); const projectedUsage = finite(row.projected_usage); const actualUsage = finite(row.actual_usage); const contestFieldSize = finite(row.contest_field_size);
    return [{ projectionRunId: row.projection_run_id, generationRunId: row.generation_run_id, slateId: row.slate_id, ...(row.provider_game_id ? { gameId: row.provider_game_id } : {}), playerId: row.player_id, sport, format: String(row.contest_format ?? 'UNKNOWN').toUpperCase(), position: String(row.position ?? 'UNKNOWN'), modelVersion: row.model_version, generatedAt: new Date(generatedAt).toISOString(), lockTime: new Date(lockTime).toISOString(), ...(floor === null ? {} : { floor }), median, ...(ceiling === null ? {} : { ceiling }), baseline, actual, ...(projectedMinutes === null ? {} : { projectedMinutes }), ...(actualMinutes === null ? {} : { actualMinutes }), ...(projectedUsage === null ? {} : { projectedUsage }), ...(actualUsage === null ? {} : { actualUsage }), ...(row.projected_role ? { projectedRole: row.projected_role } : {}), ...(row.actual_role ? { actualRole: row.actual_role } : {}), ...(row.game_type ? { gameType: row.game_type } : {}), ...(row.player_role ? { playerRole: row.player_role } : {}), ...(row.injury_return ? { injuryReturn: row.injury_return } : {}), ...(contestFieldSize === null ? {} : { contestFieldSize }) }];
  }).sort((a, b) => `${a.slateId}:${a.playerId}:${a.projectionRunId}`.localeCompare(`${b.slateId}:${b.playerId}:${b.projectionRunId}`));
  const canonical = JSON.stringify(rows);
  return { rows, datasetSha256: createHash('sha256').update(canonical).digest('hex'), independentSlates: new Set(rows.map((row) => `${row.sport}:${row.format}:${row.slateId}`)).size, exclusions };
}
function finite(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
