import type { EvaluationDataset } from './evaluationDataset.js';

export interface VerifiedContestOutcome { entered: true; settlement: 'VERIFIED'; contestId: string; externalEntryId: string; payout: number; refund: number; fee: number; finishPosition: number | null; paidPositions: number | null; }

/** Descriptive pre-lock forecast diagnostics; contest strategy metrics use only exact verified entries. */
export function summarizeEvaluationDataset(dataset: EvaluationDataset, outcomes: VerifiedContestOutcome[] = []) {
  const rows = dataset.rows; const errors = rows.map((row) => row.median - row.actual); const absolute = errors.map(Math.abs);
  const mae95Ci = slateClusterBootstrap(rows, (row) => Math.abs(row.median - row.actual), dataset.datasetSha256);
  const bias95Ci = slateClusterBootstrap(rows, (row) => row.median - row.actual, `${dataset.datasetSha256}:bias`);
  const verifiedOutcomes = outcomes.filter((row) => row.entered === true && row.settlement === 'VERIFIED' && Boolean(row.contestId) && Boolean(row.externalEntryId) && Number.isFinite(row.payout) && row.payout >= 0 && Number.isFinite(row.refund) && row.refund >= 0 && Number.isFinite(row.fee) && row.fee >= 0);
  const fees = verifiedOutcomes.reduce((sum, row) => sum + row.fee, 0); const payouts = verifiedOutcomes.reduce((sum, row) => sum + row.payout + row.refund, 0);
  const availableError = (projected: 'projectedMinutes' | 'projectedUsage', actual: 'actualMinutes' | 'actualUsage') => {
    const pairs = rows.filter((row) => Number.isFinite(row[projected]) && Number.isFinite(row[actual]));
    const values = pairs.map((row) => Number(row[projected]) - Number(row[actual]));
    return { pairedRows: pairs.length, mae: values.length ? mean(values.map(Math.abs)) : null, bias: mean(values) };
  };
  const rolePairs = rows.filter((row) => row.projectedRole && row.actualRole);
  const roleMismatches = rolePairs.filter((row) => row.projectedRole !== row.actualRole).length;
  const cashEligible = verifiedOutcomes.filter((row) => row.finishPosition !== null && row.paidPositions !== null && row.finishPosition > 0 && row.paidPositions > 0);
  const segments: Record<string, Record<string, { pairedRows: number; independentSlates: number; mae: number | null; bias: number | null; mae95Ci: { lower: number; upper: number } | null }>> = {};
  for (const dimension of ['gameType', 'playerRole', 'injuryReturn', 'contestFieldSize', 'modelVersion'] as const) {
    const groups = new Map<string, typeof rows>();
    for (const row of rows) { const label = String(row[dimension] ?? 'UNKNOWN'); groups.set(label, [...(groups.get(label) ?? []), row]); }
    segments[dimension] = Object.fromEntries([...groups].map(([label, group]) => { const groupErrors = group.map((row) => Math.abs(row.median - row.actual)); return [label, { pairedRows: group.length, independentSlates: new Set(group.map((row) => row.slateId)).size, mae: mean(groupErrors), bias: mean(group.map((row) => row.median - row.actual)), mae95Ci: slateClusterBootstrap(group, (row) => Math.abs(row.median - row.actual), `${dataset.datasetSha256}:${dimension}:${label}`) }]; }));
  }
  return {
    datasetSha256: dataset.datasetSha256, sampleSize: rows.length, independentSlates: dataset.independentSlates,
    exclusions: dataset.exclusions,
    errorClassification: {
      inputSource: { excludedRows: Object.values(dataset.exclusions).reduce((sum, count) => sum + count, 0), reasons: dataset.exclusions },
      projection: { pairedRows: rows.length, mae: mean(absolute), rmse: rows.length ? Math.sqrt(mean(errors.map((value) => value * value))!) : null, bias: mean(errors) },
      minutes: availableError('projectedMinutes', 'actualMinutes'), usage: availableError('projectedUsage', 'actualUsage'),
      role: { pairedRows: rolePairs.length, mismatches: rolePairs.length ? roleMismatches : null, errorRate: rolePairs.length ? roleMismatches / rolePairs.length : null },
      lineupContestStrategy: { verifiedEnteredRows: verifiedOutcomes.length, pendingOrUnverifiedExcluded: Math.max(0, outcomes.length - verifiedOutcomes.length) },
    },
    projection: {
      mae: mean(absolute), rmse: rows.length ? Math.sqrt(mean(errors.map((value) => value * value))!) : null,
      bias: mean(errors), mae95Ci, bias95Ci, confidenceIntervalMethod: 'SLATE_CLUSTER_BOOTSTRAP_PCTL_95',
      quantileCoverage: { floor: coverage(rows.map((row) => [row.actual, row.floor] as const)), median: coverage(rows.map((row) => [row.actual, row.median] as const)), ceiling: coverage(rows.map((row) => [row.actual, row.ceiling] as const)) },
      baselineMae: mean(rows.map((row) => Math.abs(row.baseline - row.actual))),
      minutesMae: availableError('projectedMinutes', 'actualMinutes').mae,
      usageMae: availableError('projectedUsage', 'actualUsage').mae,
      segments,
    },
    contestStrategy: {
      verifiedEntries: verifiedOutcomes.length,
      cashRate: cashEligible.length ? cashEligible.filter((row) => row.finishPosition! <= row.paidPositions!).length / cashEligible.length : null,
      cashRateSampleSize: cashEligible.length,
      realizedNet: verifiedOutcomes.length ? payouts - fees : null,
      realizedRoi: verifiedOutcomes.length && fees > 0 ? (payouts - fees) / fees : null,
      entryCount: verifiedOutcomes.length,
      note: 'Only exact contest/external-entry matches with VERIFIED settlement, payout, refund, and fee are included; unresolved entries are excluded, not counted as losses.',
    },
  };
}
function mean(values: number[]): number | null { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }
function slateClusterBootstrap<T extends { slateId: string }>(rows: T[], metric: (row: T) => number, seedValue: string): { lower: number; upper: number } | null {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(row.slateId, [...(groups.get(row.slateId) ?? []), row]);
  const clusters = [...groups.values()];
  if (!clusters.length) return null;
  if (clusters.length === 1) { const values = clusters[0]!.map(metric); return { lower: mean(values)!, upper: mean(values)! }; }
  let seed = Number.parseInt(seedValue.slice(0, 8), 16) >>> 0;
  if (!seed) seed = 0x9e3779b9;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 0x1_0000_0000; };
  const estimates: number[] = [];
  for (let sample = 0; sample < 1000; sample += 1) {
    const values: number[] = [];
    for (let cluster = 0; cluster < clusters.length; cluster += 1) {
      const chosen = clusters[Math.floor(random() * clusters.length)]!;
      values.push(...chosen.map(metric));
    }
    estimates.push(mean(values)!);
  }
  estimates.sort((left, right) => left - right);
  return { lower: estimates[Math.floor((estimates.length - 1) * 0.025)]!, upper: estimates[Math.ceil((estimates.length - 1) * 0.975)]! };
}
function coverage(rows: ReadonlyArray<readonly [number, number | undefined]>): number | null { const present = rows.filter((row): row is readonly [number, number] => typeof row[1] === 'number' && Number.isFinite(row[1])); return present.length ? present.filter(([actual, quantile]) => actual <= quantile).length / present.length : null; }
