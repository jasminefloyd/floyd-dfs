import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getOwnedLineupSlate, method, parseBody, requireOwnedLineup, respondError, tenantContext } from '../../../server/runtime.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!method(req, res, ['POST'])) return;
  try {
    const context = await tenantContext(req); await requireOwnedLineup(context, String(req.query.lineupId ?? ''));
    const id = String(req.query.lineupId ?? '');
    const body = parseBody(req);
    const savedSlate = await getOwnedLineupSlate(context, id);
    const requestedContestId = text(body.contestId);
    if (requestedContestId && savedSlate?.contest.draftKingsContestId && requestedContestId !== savedSlate.contest.draftKingsContestId) throw new Error('Contest ID does not match the contest selected for this saved lineup.');
    const contestId = requestedContestId || savedSlate?.contest.draftKingsContestId || '';
    const externalEntryId = text(body.externalEntryId);
    const contestName = text(body.contestName) || savedSlate?.contest.name || '';
    const sport = text(body.sport).toUpperCase() || savedSlate?.sport || '';
    const contestFormat = text(body.contestFormat).toUpperCase() || savedSlate?.contest.format || '';
    if (externalEntryId && !contestId) throw new Error('The selected contest could not be recovered for this lineup; refresh the run before linking a DraftKings entry ID.');
    if (externalEntryId && (!['MLB','WNBA','NFL','CFB','GOLF','NBA'].includes(sport) || !['CLASSIC','SHOWDOWN'].includes(contestFormat))) throw new Error('A linked DraftKings entry requires a supported sport and contest format.');

    const current = await context.db.from('floyd_dfs_generated_lineups').select('id,status,lineup_payload,selection_run_id').eq('id', id).eq('tenant_id', context.tenantId).maybeSingle();
    if (current.error) throw current.error;
    if (!current.data || !['GENERATED','ENTERED'].includes(String(current.data.status))) {
      res.status(409).json({ error: 'Only a generated or already-entered lineup can be recorded as an external entry.' });
      return;
    }

    if (contestId && externalEntryId) {
      const prior = await context.db.from('floyd_dfs_entry_links').select('id,generated_lineup_id').eq('tenant_id', context.tenantId).eq('contest_id', contestId).eq('external_entry_id', externalEntryId).maybeSingle();
      if (prior.error) throw prior.error;
      if (prior.data && String(prior.data.generated_lineup_id) !== id) throw new Error('That DraftKings entry ID is already linked to a different saved lineup.');
      if (!prior.data) {
        const linked = await context.db.from('floyd_dfs_entry_links').insert({ tenant_id: context.tenantId, generated_lineup_id: id, contest_id: contestId, contest_name: contestName || null, external_entry_id: externalEntryId, sport, contest_format: contestFormat });
        if (linked.error) throw linked.error;
      }
    }

    if (current.data.status === 'GENERATED') {
      const result = await context.db.from('floyd_dfs_generated_lineups').update({ status: 'ENTERED', entered_at: new Date().toISOString() }).eq('id', id).eq('tenant_id', context.tenantId).eq('status', 'GENERATED').select('id,lineup_payload,selection_run_id').single();
      if (result.error) throw result.error;
      const selection = await context.db.from('floyd_dfs_selection_runs').select('generation_run_id').eq('tenant_id', context.tenantId).eq('id', result.data.selection_run_id).single();
      if (selection.error) throw selection.error;
      const stages = await context.db.from('engine_stage_runs').select('stage,version,output_payload').eq('tenant_id', context.tenantId).eq('generation_run_id', selection.data.generation_run_id).in('stage', ['RESEARCH', 'SPORT_ADJUSTMENT', 'PROJECTION', 'OPTIMIZE', 'SELECTION']);
      if (stages.error) throw stages.error;
      const output = new Map((stages.data ?? []).map((stage) => [stage.stage, stage]));
      const projection = output.get('PROJECTION')?.output_payload as Record<string, unknown> | undefined;
      const selectionPackage = output.get('SELECTION')?.output_payload as Record<string, unknown> | undefined;
      const snapshot = await context.db.from('floyd_dfs_lock_snapshots').insert({ tenant_id: context.tenantId, generated_lineup_id: id, locked_at: new Date().toISOString(), lineup_payload: result.data.lineup_payload, projection_snapshot: projection ?? {}, game_script: null, risk_flags: [], research_version: Number(output.get('RESEARCH')?.version ?? 1), adjustment_version: Number(output.get('SPORT_ADJUSTMENT')?.version ?? 1), projection_version: Number(output.get('PROJECTION')?.version ?? 1), optimization_version: Number(output.get('OPTIMIZE')?.version ?? 1), selection_version: Number(output.get('SELECTION')?.version ?? 1) });
      if (snapshot.error) throw snapshot.error;
      res.status(200).json({ lineupId: id, status: 'ENTERED', contestId: contestId || null, entryLinked: Boolean(externalEntryId), lockSnapshotCreated: true, selection: selectionPackage ?? null });
      return;
    }
    res.status(200).json({ lineupId: id, status: 'ENTERED', contestId: contestId || null, entryLinked: Boolean(externalEntryId), lockSnapshotCreated: false });
  } catch (error) { respondError(req, res, error); }
}

function text(value: unknown): string { return typeof value === 'string' ? value.trim().slice(0, 300) : ''; }
