export type StoredEvaluation = {
  id: string;
  tenant_id: string;
  sport: string;
  component: string;
  gate_decision: string;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  review_note?: string | null;
  sample_count: number;
  metrics?: unknown;
  data_manifest?: unknown;
};

export function promotionEvidence(evaluation: StoredEvaluation): { eligible: boolean; reasons: string[]; independentSlates: number; playerRows: number } {
  const metrics = record(evaluation.metrics);
  const evidence = record(metrics?.promotionGate);
  const manifest = record(evaluation.data_manifest);
  const independentSlates = number(evidence?.independentSlates);
  const playerRows = number(evidence?.playerRows ?? evaluation.sample_count);
  const reasons: string[] = [];
  if (evaluation.gate_decision !== 'PROMOTE') reasons.push('Evaluation has not received an explicit PROMOTE review decision.');
  if (!evaluation.reviewed_by || !evaluation.reviewed_at || !evaluation.review_note?.trim()) reasons.push('A named operator review with a note is required.');
  if (!evidence || evidence.eligible !== true) reasons.push(String(evidence?.reason ?? 'Stored evaluation does not contain a passing pre-registered promotion gate.'));
  if (!/^[a-f0-9]{64}$/i.test(String(manifest?.holdoutDatasetSha256 ?? ''))) reasons.push('A frozen holdout dataset SHA-256 is required.');
  if (!String(manifest?.holdoutWindow ?? '').trim() || manifest?.holdoutSplit !== 'CHRONOLOGICAL_SLATE_LOCK_TIME') reasons.push('A time-separated chronological holdout window and split manifest are required.');
  if (independentSlates < 30) reasons.push(`At least 30 independent holdout slates are required; recorded=${independentSlates}.`);
  if (playerRows < 100) reasons.push(`At least 100 paired holdout player rows are required; recorded=${playerRows}.`);
  return { eligible: reasons.length === 0, reasons, independentSlates, playerRows };
}

export function canReviewEvaluation(metricsValue: unknown, sampleCount: number): { promotable: boolean; reason: string; independentSlates: number; playerRows: number } {
  const metrics = record(metricsValue);
  const evidence = record(metrics?.promotionGate);
  const independentSlates = number(evidence?.independentSlates);
  const playerRows = number(evidence?.playerRows ?? sampleCount);
  const promotable = evidence?.eligible === true && independentSlates >= 30 && playerRows >= 100;
  return {
    promotable,
    reason: promotable ? String(evidence?.reason ?? 'Pre-registered evidence gates passed; human review remains required.') : String(evidence?.reason ?? 'Insufficient or incomplete evaluation evidence; retain HOLD.'),
    independentSlates,
    playerRows,
  };
}

function record(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function number(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
