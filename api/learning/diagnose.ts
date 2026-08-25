import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, method, parseBody, respondError, tenantContext } from '../../server/runtime.js';
import { recordLessonCandidate } from '../../server/learningDiagnosis.js';

// Two measurements "differ" for diagnosis purposes only when they diverge by a meaningful
// margin — an exact-equality check flags nearly every real measurement as a PROJECTION error,
// since raw stat lines almost never match a projection number-for-number.
function opportunityDiffersMaterially(projected: unknown, actual: unknown): boolean {
  if (!projected || !actual || typeof projected !== 'object' || typeof actual !== 'object') return false;
  const projectedRecord = projected as Record<string, unknown>;
  const actualRecord = actual as Record<string, unknown>;
  return Object.keys(projectedRecord).some((key) => {
    const projectedValue = Number(projectedRecord[key]);
    const actualValue = Number(actualRecord[key]);
    if (!Number.isFinite(projectedValue) || !Number.isFinite(actualValue)) return false;
    return Math.abs(actualValue - projectedValue) > Math.max(1, Math.abs(projectedValue) * 0.3);
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!method(req, res, ['POST'])) return;
  try {
    const context = await tenantContext();
    const body = parseBody(req);
    const generationRunId = String(body.generationRunId ?? '').trim();
    const generatedLineupId = String(body.generatedLineupId ?? '').trim();
    if (!generationRunId || !generatedLineupId) { cors(req, res); res.status(400).json({ error: 'generationRunId and generatedLineupId are required.' }); return; }
    const measurements = Array.isArray(body.measurements) ? body.measurements as Array<Record<string, unknown>> : [];
    const outOfRange = measurements.filter((row) => row.withinExpectedRange === false);
    const opportunityError = measurements.some((row) => opportunityDiffersMaterially(row.projectedOpportunity, row.actualOpportunity));
    const errorStage = opportunityError ? 'PROJECTION' : 'VARIANCE';
    const diagnosisText = opportunityError ? 'Actual opportunity differed materially from the explicit projection assumption.' : 'Observed outcome was evaluated against the projected distribution; losing alone is not evidence of model failure.';
    const confidence = opportunityError ? 'MEDIUM' : 'LOW';
    const evidence = { measurementCount: measurements.length, outOfRangeCount: outOfRange.length };
    const diagnostic = { tenant_id: context.tenantId, generation_run_id: generationRunId, subject_type: 'GENERATED_LINEUP', subject_id: generatedLineupId, error_stage: errorStage, severity: errorStage === 'VARIANCE' ? 'LOW' : 'MEDIUM', confidence, assumption: opportunityError ? 'Projected opportunity was compared with actual opportunity.' : 'Projected distribution was compared with measured outcomes.', actual_outcome: body.actualOutcome ?? null, evidence, diagnosis: diagnosisText };
    const result = await context.db.from('floyd_dfs_learning_diagnostics').insert(diagnostic).select('*').single();
    if (result.error) throw result.error;
    if (errorStage !== 'VARIANCE') await recordLessonCandidate(context.db, context.tenantId, String(body.sport ?? 'UNKNOWN'), errorStage, diagnosisText, confidence, evidence);
    cors(req, res); res.status(201).json({ diagnostic: result.data });
  } catch (error) { respondError(req, res, error); }
}
