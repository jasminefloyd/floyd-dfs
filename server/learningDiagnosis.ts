import type { SupabaseClient } from '@supabase/supabase-js';

type Json = Record<string, unknown>;

export interface LineupDiagnosisInput {
  tenantId: string;
  generationRunId: string;
  generatedLineupId: string;
  sport: string;
  lineupPayload: Json;
  actualDkPoints: number | null;
  researchVersion: number;
  adjustmentVersion: number;
}

/**
 * Real (tolerance-based) post-contest diagnosis, fired automatically once a contest result is
 * recorded (see api/lineups/[lineupId]/result.ts). Replaces the old exact-JSON-match stub that
 * would flag PROJECTION error on nearly every real measurement. A miss inside the projected
 * floor/ceiling range is treated as normal variance, never automatic model failure. A miss
 * outside that range is attributed to the earliest upstream stage that carried real uncertainty
 * for this lineup's players (an unresolved CRITICAL research watch item, or a LOW role-certainty
 * adjustment) before defaulting to PROJECTION.
 */
export async function diagnoseLineupResult(db: SupabaseClient, input: LineupDiagnosisInput): Promise<Json | null> {
  if (input.actualDkPoints === null) return null;
  const median = Number(input.lineupPayload.median);
  if (!Number.isFinite(median)) return null;
  const floor = Number(input.lineupPayload.floor);
  const ceiling = Number(input.lineupPayload.ceiling);
  const actual = input.actualDkPoints;
  const withinRange = Number.isFinite(floor) && Number.isFinite(ceiling) ? actual >= floor && actual <= ceiling : Math.abs(actual - median) <= Math.max(5, median * 0.25);

  let errorStage = 'VARIANCE';
  let diagnosisText = 'Actual outcome fell within (or near) the projected range; losing or missing a target alone is not evidence of model failure.';
  let confidence: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';

  if (!withinRange) {
    const playerIds = Array.isArray(input.lineupPayload.playerIds) ? (input.lineupPayload.playerIds as unknown[]).map(String) : [];
    const researchStage = await db.from('engine_stage_runs').select('output_payload').eq('generation_run_id', input.generationRunId).eq('stage', 'RESEARCH').eq('version', input.researchVersion).maybeSingle();
    const researchOutput = researchStage.data?.output_payload as Json | undefined;
    const watchItems = Array.isArray(researchOutput?.watchItems) ? researchOutput.watchItems as Array<{ importance?: string; subjectId?: string }> : [];
    const unresolvedCritical = watchItems.some((item) => item.importance === 'CRITICAL' && (!item.subjectId || playerIds.includes(item.subjectId)));

    const adjustmentStage = await db.from('engine_stage_runs').select('output_payload').eq('generation_run_id', input.generationRunId).eq('stage', 'SPORT_ADJUSTMENT').eq('version', input.adjustmentVersion).maybeSingle();
    const adjustmentOutput = adjustmentStage.data?.output_payload as Json | undefined;
    const adjustments = Array.isArray(adjustmentOutput?.adjustments) ? adjustmentOutput.adjustments as Array<{ playerId?: string; roleCertainty?: string }> : [];
    const lowRoleCertainty = adjustments.some((item) => playerIds.includes(String(item.playerId)) && item.roleCertainty === 'LOW');

    if (unresolvedCritical) { errorStage = 'RESEARCH'; diagnosisText = 'Actual outcome fell outside the projected range for a lineup that had an unresolved CRITICAL research watch item at generation time.'; confidence = 'MEDIUM'; }
    else if (lowRoleCertainty) { errorStage = 'SPORT_ADJUSTMENT'; diagnosisText = 'Actual outcome fell outside the projected range for a lineup with LOW role-certainty opportunity adjustments.'; confidence = 'MEDIUM'; }
    else { errorStage = 'PROJECTION'; diagnosisText = 'Actual outcome fell materially outside the projected floor/ceiling range with no unresolved research gap or low-certainty adjustment flagged upstream.'; confidence = 'MEDIUM'; }
  }

  const evidence = { withinRange, floor, median, ceiling, actual };
  const diagnostic = { tenant_id: input.tenantId, generation_run_id: input.generationRunId, subject_type: 'GENERATED_LINEUP', subject_id: input.generatedLineupId, error_stage: errorStage, severity: errorStage === 'VARIANCE' ? 'LOW' : 'MEDIUM', confidence, assumption: `Projected floor ${floor}, median ${median}, ceiling ${ceiling}.`, actual_outcome: actual, evidence, diagnosis: diagnosisText };
  const inserted = await db.from('floyd_dfs_learning_diagnostics').insert(diagnostic).select('*').single();
  if (inserted.error) throw inserted.error;
  if (errorStage !== 'VARIANCE') await recordLessonCandidate(db, input.tenantId, input.sport, errorStage, diagnosisText, confidence, evidence);
  return inserted.data as Json;
}

const LESSON_ACCUMULATION_THRESHOLD = 3;

/**
 * Server-derived "generalizable" gate (was previously a client-supplied boolean the caller
 * could set to anything). A lesson only accumulates sample count and promotes OBSERVED ->
 * ACCUMULATING once the same sport+stage+observation pattern repeats; only a human/manual
 * review can promote a lesson to VALIDATED, per the design docs.
 */
export async function recordLessonCandidate(db: SupabaseClient, tenantId: string, sport: string, stage: string, observation: string, confidence: string, evidence: Json): Promise<void> {
  const existing = await db.from('floyd_dfs_lesson_candidates').select('id,sample_count,status').eq('tenant_id', tenantId).eq('sport', sport).eq('stage', stage).eq('observation', observation).limit(1).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    const sampleCount = Number(existing.data.sample_count ?? 1) + 1;
    const status = existing.data.status === 'OBSERVED' && sampleCount >= LESSON_ACCUMULATION_THRESHOLD ? 'ACCUMULATING' : existing.data.status;
    const updated = await db.from('floyd_dfs_lesson_candidates').update({ sample_count: sampleCount, status }).eq('id', existing.data.id);
    if (updated.error) throw updated.error;
    return;
  }
  const inserted = await db.from('floyd_dfs_lesson_candidates').insert({ tenant_id: tenantId, sport, stage, observation, proposed_change: `Review ${stage} assumptions against repeated measured outcomes.`, status: 'OBSERVED', sample_count: 1, confidence, evidence: [evidence] });
  if (inserted.error) throw inserted.error;
}

export interface ChangeEvent { eventType?: string; materiality?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; subject?: string; previousState?: unknown; newState?: unknown; source?: unknown }
export interface PreLockDecision { decision: 'KEEP' | 'ADJUST' | 'REBUILD'; requiresUserConfirmation: boolean; immutableLineupIds: string[]; affectedStages: string[]; rationale: string }

/** Shared KEEP/ADJUST/REBUILD decision logic, used by both the manual api/learning/pre-lock.ts
 * endpoint and the automatic recheck handler (api/generation-runs/[runId]/recheck.ts). */
export function computePreLockDecision(changes: ChangeEvent[], enteredLineupIds: string[]): PreLockDecision {
  if (!changes.length) return { decision: 'KEEP', requiresUserConfirmation: false, immutableLineupIds: enteredLineupIds, affectedStages: [], rationale: 'No material pre-lock changes were detected.' };
  const severity: Record<string, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
  const highest = changes.reduce((best, value) => (severity[value.materiality ?? 'LOW'] > severity[best.materiality ?? 'LOW'] ? value : best), changes[0]);
  const materiality = highest.materiality ?? 'LOW';
  const decision: PreLockDecision['decision'] = materiality === 'CRITICAL' ? 'REBUILD' : materiality === 'HIGH' ? 'ADJUST' : 'KEEP';
  const affectedStages = /injur|availab|lineup|role/i.test(highest.eventType ?? '') ? ['RESEARCH', 'SPORT_ADJUSTMENT', 'PROJECTION', 'OPTIMIZE', 'SELECTION'] : /projection|model/i.test(highest.eventType ?? '') ? ['PROJECTION', 'OPTIMIZE', 'SELECTION'] : /contest|ownership|duplication/i.test(highest.eventType ?? '') ? ['OPTIMIZE', 'SELECTION'] : ['RESEARCH'];
  return { decision, requiresUserConfirmation: enteredLineupIds.length > 0 && decision !== 'KEEP', immutableLineupIds: enteredLineupIds, affectedStages, rationale: enteredLineupIds.length && decision !== 'KEEP' ? `${highest.eventType ?? 'Change'} is ${materiality}, but entered lineups remain immutable. Explicit user confirmation is required before any replacement or adjustment.` : `${highest.eventType ?? 'Change'} is ${materiality}; the earliest affected stages are ${affectedStages.join(', ')}.` };
}

/** Diffs a fresh Research pass's availability list against the availability list stored on a
 * prior ResearchPackage version, turning any status flip into a real ChangeEvent — used by the
 * recheck handler so pre-lock decisions are driven by actual detected changes instead of an
 * empty caller-supplied array. */
export function diffAvailabilityForChangeEvents(previousResearch: Json | undefined, freshResearch: Json | undefined): ChangeEvent[] {
  const previous = new Map((Array.isArray(previousResearch?.availability) ? previousResearch.availability as Array<{ playerId?: string; status?: string }> : []).map((item) => [String(item.playerId), String(item.status)]));
  const fresh = Array.isArray(freshResearch?.availability) ? freshResearch.availability as Array<{ playerId?: string; status?: string }> : [];
  return fresh.flatMap((item) => {
    const playerId = String(item.playerId ?? '');
    const previousStatus = previous.get(playerId);
    const newStatus = String(item.status ?? 'UNKNOWN');
    if (!playerId || !previousStatus || previousStatus === newStatus) return [];
    const materiality: ChangeEvent['materiality'] = newStatus === 'OUT' ? 'CRITICAL' : newStatus === 'QUESTIONABLE' || previousStatus === 'OUT' ? 'HIGH' : 'MEDIUM';
    return [{ eventType: 'AVAILABILITY_CHANGE', materiality, subject: playerId, previousState: { status: previousStatus }, newState: { status: newStatus }, source: { detectedBy: 'recheck' } }];
  });
}
