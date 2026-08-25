import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, method, providerSet, respondError, tenantContext } from '../../../server/runtime.js';
import { computePreLockDecision, diffAvailabilityForChangeEvents } from '../../../server/learningDiagnosis.js';

// Cheap pre-lock recheck: re-runs Research against the already-validated slate and diffs the
// fresh availability list against the research version that was actually used to generate the
// run's lineups. Real detected changes then flow through the same KEEP/ADJUST/REBUILD decision
// logic api/learning/pre-lock.ts uses manually — so the Learning page's "Run pre-lock check"
// can be backed by real data instead of an empty caller-supplied array.
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!method(req, res, ['GET'])) return;
  try {
    const context = await tenantContext();
    const runId = String(req.query.runId ?? '');
    if (!runId) throw new Error('runId is required.');

    const stages = await context.db.from('engine_stage_runs').select('stage,version,output_payload').eq('generation_run_id', runId).in('stage', ['SLATE', 'RESEARCH']).order('version', { ascending: false });
    if (stages.error) throw stages.error;
    const latestByStage = new Map<string, { version: number; output_payload: unknown }>();
    for (const row of stages.data ?? []) if (!latestByStage.has(row.stage)) latestByStage.set(row.stage, { version: row.version, output_payload: row.output_payload });
    const slate = latestByStage.get('SLATE')?.output_payload as Record<string, unknown> | undefined;
    const previousResearch = latestByStage.get('RESEARCH')?.output_payload as Record<string, unknown> | undefined;
    if (!slate) { cors(req, res); res.status(404).json({ error: 'No SLATE stage output found for this run.' }); return; }

    const { agent } = providerSet();
    const freshResearch = await agent.run({ validatedSlate: slate as never });
    const changes = diffAvailabilityForChangeEvents(previousResearch, freshResearch as unknown as Record<string, unknown>);

    const selectionRuns = await context.db.from('floyd_dfs_selection_runs').select('id').eq('generation_run_id', runId);
    if (selectionRuns.error) throw selectionRuns.error;
    const selectionRunIds = (selectionRuns.data ?? []).map((row) => row.id);
    const enteredLineups = selectionRunIds.length ? await context.db.from('floyd_dfs_generated_lineups').select('id').in('selection_run_id', selectionRunIds).eq('status', 'ENTERED') : { data: [], error: null };
    if (enteredLineups.error) throw enteredLineups.error;
    const immutableLineupIds = (enteredLineups.data ?? []).map((row) => String(row.id));

    if (changes.length) {
      const saved = await context.db.from('floyd_dfs_change_events').insert(changes.map((event) => ({ tenant_id: context.tenantId, generation_run_id: runId, event_type: event.eventType ?? 'UNKNOWN', subject: String(event.subject ?? 'SLATE'), previous_state: event.previousState ?? {}, new_state: event.newState ?? {}, materiality: event.materiality ?? 'LOW', source: event.source ?? {}, affected_lineup_ids: immutableLineupIds })));
      if (saved.error) throw saved.error;
    }

    cors(req, res);
    res.status(200).json({ decision: computePreLockDecision(changes, immutableLineupIds), changeEvents: changes, researchStatus: freshResearch.status });
  } catch (error) { respondError(req, res, error); }
}
