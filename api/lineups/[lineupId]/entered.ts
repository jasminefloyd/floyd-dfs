import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getOwnedLineupSlate, method, parseBody, requireOwnedLineup, respondError, tenantContext } from '../../../server/runtime.js';
import { validateLineupCandidate } from '../../../src/lib/engine/validation.js';
import type { ValidatedSlate } from '../../../src/lib/engine/contracts.js';
import { getStreetTeamSnapshot } from '../../../server/streetTeam.js';
import { validateNbaLineupAtEntry } from '../../../server/streetTeam/slateGate.js';
import { validateFinalLineupIndependently } from '../../../server/lineupAgent/entryValidator.js';

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

    const selection = await context.db.from('floyd_dfs_selection_runs').select('generation_run_id').eq('tenant_id', context.tenantId).eq('id', current.data.selection_run_id).single();
    if (selection.error) throw selection.error;
    const stages = await context.db.from('engine_stage_runs').select('stage,version,output_payload').eq('tenant_id', context.tenantId).eq('generation_run_id', selection.data.generation_run_id).in('stage', ['SLATE', 'RESEARCH', 'SPORT_ADJUSTMENT', 'PROJECTION', 'OPTIMIZE', 'SELECTION']);
    if (stages.error) throw stages.error;
    const output = new Map((stages.data ?? []).map((stage) => [stage.stage, stage]));
    const frozenSlate = (output.get('SLATE')?.output_payload as ValidatedSlate | undefined) ?? savedSlate;
    const lineupPayload = current.data.lineup_payload as Record<string, unknown>;
    if (!frozenSlate || frozenSlate.tenantId !== context.tenantId || frozenSlate.contest.draftKingsContestId !== contestId) throw new Error('The exact generation contest/slate snapshot could not be verified; refresh and regenerate before recording this entry.');
    const rosterSlots = lineupPayload.rosterSlots && typeof lineupPayload.rosterSlots === 'object' && !Array.isArray(lineupPayload.rosterSlots) ? lineupPayload.rosterSlots as Record<string, string> : {};
    const playerIds = Array.isArray(lineupPayload.playerIds) ? lineupPayload.playerIds.map(String) : [];
    const salaryUsed = Number(lineupPayload.salaryUsed);
    const legalityErrors = validateLineupCandidate({ playerIds, rosterSlots, salaryUsed }, frozenSlate);
    if (legalityErrors.length) throw new Error(`Entry confirmation failed the saved DraftKings rules check: ${legalityErrors.slice(0, 4).join(' ')}`);
    const independentLegalityErrors = validateFinalLineupIndependently({ playerIds, rosterSlots, salaryUsed }, frozenSlate);
    if (independentLegalityErrors.length) throw new Error(`Entry confirmation failed an independent DraftKings rules check: ${independentLegalityErrors.slice(0, 4).join(' ')}`);
    if (frozenSlate.sport === 'NBA') {
      const currentSnapshot = await getStreetTeamSnapshot(context.db, context.tenantId);
      if (!currentSnapshot) throw new Error('NBA entry confirmation is blocked until a current identity and availability snapshot is available.');
      const identityErrors = validateNbaLineupAtEntry(frozenSlate, currentSnapshot, playerIds);
      if (identityErrors.length) throw new Error(`NBA entry confirmation is blocked: ${identityErrors.join(' ')}`);
    }
    const projection = output.get('PROJECTION')?.output_payload as Record<string, unknown> | undefined;
    const selectionPackage = output.get('SELECTION')?.output_payload as Record<string, unknown> | undefined;
    const confirmation = await context.db.rpc('floyd_dfs_confirm_lineup_entry', {
      p_tenant_id: context.tenantId,
      p_lineup_id: id,
      p_actor_id: context.userId,
      p_contest_id: contestId || null,
      p_contest_name: contestName || null,
      p_external_entry_id: externalEntryId || null,
      p_sport: sport || null,
      p_contest_format: contestFormat || null,
      p_entry_fee: savedSlate?.contest.entryFee ?? null,
      p_projection_snapshot: projection ?? {},
      p_research_version: Number(output.get('RESEARCH')?.version ?? 1),
      p_adjustment_version: Number(output.get('SPORT_ADJUSTMENT')?.version ?? 1),
      p_projection_version: Number(output.get('PROJECTION')?.version ?? 1),
      p_optimization_version: Number(output.get('OPTIMIZE')?.version ?? 1),
      p_selection_version: Number(output.get('SELECTION')?.version ?? 1),
    });
    if (confirmation.error) throw confirmation.error;
    res.status(200).json({ ...(confirmation.data as Record<string, unknown>), contestId: contestId || null, selection: selectionPackage ?? null });
  } catch (error) { respondError(req, res, error); }
}

function text(value: unknown): string { return typeof value === 'string' ? value.trim().slice(0, 300) : ''; }
