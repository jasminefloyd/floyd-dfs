import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'node:crypto';
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
      await appendEnteredRevision(context.db, context.tenantId, id, String(selection.data.generation_run_id), result.data.lineup_payload, savedSlate);
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
async function appendEnteredRevision(db: Awaited<ReturnType<typeof tenantContext>>['db'], tenantId: string, lineupId: string, generationRunId: string, payload: unknown, slate: Awaited<ReturnType<typeof getOwnedLineupSlate>>): Promise<void> {
  const latest = await db.from('floyd_dfs_lineup_revisions').select('revision').eq('tenant_id', tenantId).eq('lineup_id', lineupId).order('revision', { ascending: false }).limit(1).maybeSingle();
  if (latest.error) throw latest.error;
  const parent = latest.data ? Number(latest.data.revision) : null;
  const revision = (parent ?? 0) + 1;
  const generatedAt = new Date().toISOString();
  const lineup = asRecord(payload) ?? {};
  const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const inserted = await db.from('floyd_dfs_lineup_revisions').insert({
    tenant_id: tenantId,
    lineup_id: lineupId,
    revision,
    parent_revision: parent,
    generation_run_id: generationRunId,
    input_sha256: digest({ slateId: slate?.slateId, contestId: slate?.contest.draftKingsContestId }),
    model_sha256: digest({ modelVersion: lineup.modelVersion, candidateId: lineup.candidateId }),
    rules_sha256: digest({ salaryCap: slate?.salaryCap, scoringRules: slate?.scoringRules, rosterRules: slate?.rosterRules }),
    slot_assignments: lineup.rosterSlots ?? {},
    generated_at: generatedAt,
    state: 'USER_CONFIRMED_ENTERED',
    submission_confirmed_at: generatedAt,
    content_sha256: digest({ lineupId, revision, payload, generatedAt, state: 'USER_CONFIRMED_ENTERED' }),
  });
  if (inserted.error) throw inserted.error;
  const portfolios = await db.from('floyd_dfs_lineup_portfolios').select('id').eq('tenant_id', tenantId).eq('generation_run_id', generationRunId);
  if (portfolios.error) throw portfolios.error;
  for (const portfolio of portfolios.data ?? []) {
    const member = await db.from('floyd_dfs_portfolio_members').insert({ tenant_id: tenantId, portfolio_id: portfolio.id, lineup_id: lineupId, lineup_revision: revision, entry_status: 'ENTERED', estimated_payout: null, actual_payout: null, entry_fee: slate?.contest.entryFee ?? null });
    if (member.error) throw member.error;
  }
}
function asRecord(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
