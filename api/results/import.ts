import type { VercelRequest, VercelResponse } from '@vercel/node';
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
        const lineup = await context.db.from('floyd_dfs_generated_lineups').select('id,status,lineup_payload').eq('tenant_id', context.tenantId).eq('id', lineupId).maybeSingle();
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
          result_payload: { source: 'DRAFTKINGS_CSV', importBatchId: batchId, csvRow: rowNumber },
        };
        const prior = await context.db.from('floyd_dfs_contest_results').select('id').eq('tenant_id', context.tenantId).eq('generated_lineup_id', lineupId).order('measured_at', { ascending: false }).limit(1).maybeSingle();
        if (prior.error) throw prior.error;
        const saved = prior.data
          ? await context.db.from('floyd_dfs_contest_results').update(valuesToSave).eq('tenant_id', context.tenantId).eq('id', prior.data.id)
          : await context.db.from('floyd_dfs_contest_results').insert({ tenant_id: context.tenantId, generated_lineup_id: lineupId, ...valuesToSave });
        if (saved.error) throw saved.error;
        imported += 1;
      } catch (error) { errors.push({ row: rowNumber, error: error instanceof Error ? error.message : 'Row import failed.' }); }
    }
    cors(req, res);
    res.status(errors.length ? 207 : 200).json({ batchId, imported, failed: errors.length, errors: errors.slice(0, 100), note: 'DraftKings export rows must include a lineup_id column copied from lineup history so standings can be reconciled to the exact generated lineup.' });
  } catch (error) { respondError(req, res, error); }
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
