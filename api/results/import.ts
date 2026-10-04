import type { VercelRequest, VercelResponse } from '@vercel/node';
import { diagnoseLineupResult } from '../../server/learningDiagnosis.js';
import { cors, method, parseBody, respondError, tenantContext } from '../../server/runtime.js';

const COLUMNS = ['lineup_id', 'actual_dk_points', 'finish_position', 'cash_line', 'field_size', 'entry_fee', 'payout'];
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!method(req, res, ['POST'])) return;
  try {
    const body = parseBody(req);
    const csv = typeof body.csvText === 'string' ? body.csvText : '';
    if (!csv.trim() || csv.length > 2_000_000) throw new Error('csvText is required and must be under 2 MB.');
    const records = parseCsv(csv);
    const headers = records.shift()?.map((header) => header.trim().toLowerCase().replace(/\s+/g, '_')) ?? [];
    for (const required of COLUMNS) if (!headers.includes(required)) throw new Error(`CSV is missing required column "${required}".`);
    if (!headers.includes('contest_id') && !headers.includes('contest_name')) throw new Error('CSV must include contest_id or contest_name to identify the contest.');
    const batchId = crypto.randomUUID();
    const context = await tenantContext();
    let imported = 0;
    const errors: Array<{ row: number; error: string }> = [];
    for (const [index, values] of records.entries()) {
      const rowNumber = index + 2;
      try {
        const row = Object.fromEntries(headers.map((header, column) => [header, values[column] ?? '']));
        const lineupId = text(row.lineup_id);
        const lineup = await context.db.from('floyd_dfs_generated_lineups').select('id,status,lineup_payload,selection_run_id').eq('tenant_id', context.tenantId).eq('id', lineupId).maybeSingle();
        if (lineup.error) throw lineup.error;
        if (!lineup.data || lineup.data.status !== 'ENTERED') throw new Error('lineup_id does not identify an entered lineup in this tenant.');
        const actual = number(row.actual_dk_points, true)!;
        const cashLine = number(row.cash_line);
        const finishPosition = integer(row.finish_position);
        const finishPercentile = number(row.finish_percentile);
        const payout = number(row.payout);
        const entryFee = number(row.entry_fee);
        const fieldSize = integer(row.field_size);
        const paidPositions = integer(row.paid_positions);
        const contestId = text(row.contest_id) || null;
        const contestName = text(row.contest_name) || null;
        if (cashLine === null || finishPosition === null || fieldSize === null || entryFee === null || payout === null) throw new Error('Contest outcome requires cash_line, finish_position, field_size, entry_fee, and payout.');
        if (!contestId && !contestName) throw new Error('Contest identity requires contest_id or contest_name.');
        if (cashLine !== null && cashLine <= 0) throw new Error('cash_line must be greater than zero.');
        if (finishPosition !== null && (finishPosition < 1 || (fieldSize !== null && finishPosition > fieldSize))) throw new Error('finish_position must be within the field size.');
        if (fieldSize !== null && fieldSize < 1) throw new Error('field_size must be positive.');
        if (paidPositions !== null && (paidPositions < 1 || (fieldSize !== null && paidPositions > fieldSize))) throw new Error('paid_positions is outside the valid field size.');
        if (finishPercentile !== null && (finishPercentile < 0 || finishPercentile > 100)) throw new Error('finish_percentile must be between 0 and 100.');
        if (payout !== null && payout < 0) throw new Error('payout cannot be negative.');
        if (entryFee !== null && entryFee < 0) throw new Error('entry_fee cannot be negative.');
        const sport = text(row.sport)?.toUpperCase() ?? null;
        const contestFormat = text(row.contest_format)?.toUpperCase() ?? null;
        const actualPercentile = finishPercentile ?? (finishPosition !== null && fieldSize && fieldSize > 1 ? 100 * (1 - (finishPosition - 1) / (fieldSize - 1)) : null);
        const valuesToSave = {
          actual_dk_points: actual, cash_line: cashLine, beat_cash_line: cashLine === null ? null : actual >= cashLine,
          finish_position: finishPosition, finish_percentile: actualPercentile, payout,
          roi: payout !== null && entryFee !== null && entryFee > 0 ? (payout - entryFee) / entryFee : null,
          contest_id: contestId, contest_name: contestName, sport, contest_format: contestFormat,
          field_size: fieldSize, entry_fee: entryFee, paid_positions: paidPositions,
          outcome_source: 'DRAFTKINGS_CSV', external_entry_id: text(row.external_entry_id) || null,
          official_outcome: true, model_evaluation_eligible: false, reconciliation_status: 'UNVERIFIED',
          result_payload: { source: 'DRAFTKINGS_CSV', importBatchId: batchId, csvRow: rowNumber },
        };
        const prior = await context.db.from('floyd_dfs_contest_results').select('id').eq('tenant_id', context.tenantId).eq('generated_lineup_id', lineupId).order('measured_at', { ascending: false }).limit(1).maybeSingle();
        if (prior.error) throw prior.error;
        const saved = prior.data
          ? await context.db.from('floyd_dfs_contest_results').update(valuesToSave).eq('tenant_id', context.tenantId).eq('id', prior.data.id).select('id').single()
          : await context.db.from('floyd_dfs_contest_results').insert({ tenant_id: context.tenantId, generated_lineup_id: lineupId, ...valuesToSave }).select('id').single();
        if (saved.error) throw saved.error;
        await reconcileAndDiagnose({ context, resultId: String(saved.data.id), lineupId, lineupPayload: lineup.data.lineup_payload, selectionRunId: String(lineup.data.selection_run_id), enteredScore: actual, contestKey: contestId ?? contestName ?? `result:${lineupId}` });
        imported += 1;
      } catch (error) { errors.push({ row: rowNumber, error: error instanceof Error ? error.message : 'Row import failed.' }); }
    }
    cors(req, res);
    res.status(errors.length ? 207 : 200).json({ batchId, imported, failed: errors.length, errors: errors.slice(0, 100), note: 'DraftKings export rows must include a lineup_id column copied from lineup history so standings can be reconciled to the exact generated lineup.' });
  } catch (error) { respondError(req, res, error); }
}

async function reconcileAndDiagnose(input: { context: Awaited<ReturnType<typeof tenantContext>>; resultId: string; lineupId: string; lineupPayload: unknown; selectionRunId: string; enteredScore: number; contestKey: string }): Promise<void> {
  const { context, resultId, lineupId, selectionRunId } = input;
  const payload = record(input.lineupPayload); const playerIds = [...new Set((Array.isArray(payload.playerIds) ? payload.playerIds : []).map(String))];
  const selection = await context.db.from('floyd_dfs_selection_runs').select('generation_run_id,selection_package').eq('tenant_id', context.tenantId).eq('id', selectionRunId).maybeSingle();
  if (selection.error) throw selection.error;
  const generationRunId = String(selection.data?.generation_run_id ?? '');
  const generation = generationRunId ? await context.db.from('generation_runs').select('request_payload').eq('tenant_id', context.tenantId).eq('id', generationRunId).maybeSingle() : { data: null, error: null };
  if (generation.error) throw generation.error;
  const request = record(generation.data?.request_payload); const runInput = record(request.input); const slate = record(runInput.validatedSlate); const rosterRules = record(slate.rosterRules); const slotRules = record(rosterRules.slots);
  const actualsResult = generationRunId && playerIds.length ? await context.db.from('floyd_dfs_historical_player_actuals').select('player_id,actual_dk_points,actual_components,source_validation_status,source_validation_reason,finality_status').eq('tenant_id', context.tenantId).eq('generation_run_id', generationRunId).in('player_id', playerIds) : { data: [], error: null };
  if (actualsResult.error) throw actualsResult.error;
  const actualRows = actualsResult.data ?? []; const byPlayer = new Map(actualRows.map((row) => [String(row.player_id), row]));
  let status = 'UNAVAILABLE'; let computed: number | null = null; let difference: number | null = null; let eligible = false; const reasons: string[] = [];
  if (playerIds.length && playerIds.every((id) => byPlayer.has(id))) {
    const invalidRows = actualRows.filter((row) => playerIds.includes(String(row.player_id)) && (row.source_validation_status !== 'VERIFIED' || !['FINAL','CORRECTED'].includes(String(row.finality_status))));
    if (invalidRows.length) { status = 'SOURCE_INVALID'; reasons.push(...invalidRows.map((row) => String(row.source_validation_reason ?? 'Player actual source is not verified/final.'))); }
    else {
      const slots = record(payload.rosterSlots);
      computed = playerIds.reduce((sum, playerId) => {
        const row = byPlayer.get(playerId)!; const slot = Object.entries(slots).find(([, assigned]) => String(assigned) === playerId)?.[0];
        const rule = slot ? record(slotRules[slot]) : {}; const multiplier = Number(rule.fantasyMultiplier ?? 1);
        return sum + Number(row.actual_dk_points) * (Number.isFinite(multiplier) ? multiplier : 1);
      }, 0);
      difference = Number((computed - input.enteredScore).toFixed(4)); status = Math.abs(difference) <= 0.05 ? 'MATCHED' : 'MISMATCH'; eligible = status === 'MATCHED';
      if (status === 'MISMATCH') reasons.push('Verified player actuals and saved roster slot multipliers do not sum to the recorded DraftKings score.');
    }
  } else reasons.push('Exact event-matched actuals are missing for one or more lineup players.');
  const savedResult = await context.db.from('floyd_dfs_contest_results').select('result_payload').eq('tenant_id', context.tenantId).eq('id', resultId).single();
  if (savedResult.error) throw savedResult.error;
  const previous = record(savedResult.data.result_payload);
  const reconciliation = { status, computedPlayerActualScore: computed === null ? null : Number(computed.toFixed(4)), recordedActualScore: input.enteredScore, difference, playerCount: playerIds.length, source: 'SPORTSDATAIO_FINAL', scoring: 'provider DraftKings player actuals and saved roster slot multipliers', reasons: [...new Set(reasons)], reconciledAt: new Date().toISOString() };
  const update = await context.db.from('floyd_dfs_contest_results').update({ reconciliation_status: status, model_evaluation_eligible: eligible, official_outcome: true, result_payload: { ...previous, reconciliation } }).eq('tenant_id', context.tenantId).eq('id', resultId);
  if (update.error) throw update.error;
  if ((eligible || status === 'MISMATCH') && selection.data) {
    const snapshot = await context.db.from('floyd_dfs_lock_snapshots').select('research_version,adjustment_version,lineup_payload').eq('generated_lineup_id', lineupId).order('locked_at', { ascending: false }).limit(1).maybeSingle();
    if (snapshot.error) throw snapshot.error;
    if (snapshot.data) {
      const packageValue = record(selection.data.selection_package);
      const projectionRun = await context.db.from('floyd_dfs_projection_runs').select('projection_package').eq('tenant_id', context.tenantId).eq('generation_run_id', generationRunId).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (projectionRun.error) throw projectionRun.error;
      const projectionPackage = record(projectionRun.data?.projection_package); const projections = new Map((Array.isArray(projectionPackage.players) ? projectionPackage.players : []).map((player) => [String(record(player).playerId), record(player)]));
      let opportunityMiss: { dimension: string; playerId: string; projected: number; actual: number } | undefined;
      for (const row of actualRows.filter((candidate) => playerIds.includes(String(candidate.player_id)))) {
        const forecast = projections.get(String(row.player_id)); if (!forecast) continue;
        const opportunity = record(forecast.adjustedOpportunity); const components = record(row.actual_components);
        const candidates = [
          { dimension: 'minutes', projected: Number(opportunity.expectedMinutes), actual: Number(components.minutes), threshold: 8 },
          { dimension: 'innings pitched', projected: Number(opportunity.expectedInnings), actual: Number(components.InningsPitchedDecimal), threshold: 1 },
        ].filter((item) => Number.isFinite(item.projected) && Number.isFinite(item.actual) && item.projected > item.threshold && Math.abs(item.projected - item.actual) >= Math.max(item.threshold, item.projected * 0.35));
        const largest = candidates.sort((a,b) => Math.abs(b.projected - b.actual) / b.projected - Math.abs(a.projected - a.actual) / a.projected)[0];
        if (largest) opportunityMiss = { dimension: largest.dimension, playerId: String(row.player_id), projected: largest.projected, actual: largest.actual };
      }
      const changeRows = await context.db.from('floyd_dfs_change_events').select('event_type,subject,affected_lineup_ids').eq('tenant_id', context.tenantId).eq('generation_run_id', generationRunId);
      if (changeRows.error) throw changeRows.error;
      const relevantChange = (changeRows.data ?? []).find((event) => Array.isArray(event.affected_lineup_ids) && event.affected_lineup_ids.map(String).includes(lineupId) && (event.event_type === 'WEATHER_CHANGE' || playerIds.includes(String(event.subject))));
      const lateChange = relevantChange ? { eventType: String(relevantChange.event_type), subject: String(relevantChange.subject) } : undefined;
      try { await diagnoseLineupResult(context.db, { tenantId: context.tenantId, generationRunId, generatedLineupId: lineupId, contestKey: input.contestKey, sport: String(packageValue.sport ?? slate.sport ?? 'UNKNOWN'), lineupPayload: record(snapshot.data.lineup_payload ?? payload), actualDkPoints: input.enteredScore, researchVersion: Number(snapshot.data.research_version), adjustmentVersion: Number(snapshot.data.adjustment_version), opportunityMiss, lateChange, scoringMismatch: status === 'MISMATCH' }); }
      catch { /* result and reconciliation remain saved if a diagnosis record cannot be written */ }
    }
  }
}

function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function number(value: unknown, required = false): number | null { const raw = text(value); if (!raw) { if (required) throw new Error('actual_dk_points is required.'); return null; } const parsed = Number(raw.replace(/^\$|,/g, '')); if (!Number.isFinite(parsed)) throw new Error(`Invalid numeric value "${raw}".`); return parsed; }
function integer(value: unknown): number | null { const parsed = number(value); if (parsed === null) return null; if (!Number.isInteger(parsed)) throw new Error(`Expected an integer but received "${parsed}".`); return parsed; }
function parseCsv(textValue: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false;
  for (let index = 0; index < textValue.length; index += 1) {
    const character = textValue[index];
    if (quoted) { if (character === '"' && textValue[index + 1] === '"') { field += '"'; index += 1; } else if (character === '"') quoted = false; else field += character; }
    else if (character === '"') quoted = true;
    else if (character === ',') { row.push(field); field = ''; }
    else if (character === '\n') { row.push(field.replace(/\r$/, '')); if (row.some((value) => value.trim())) rows.push(row); row = []; field = ''; }
    else field += character;
  }
  if (quoted) throw new Error('CSV has an unclosed quoted field.');
  row.push(field.replace(/\r$/, '')); if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
