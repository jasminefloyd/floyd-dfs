import { createHash } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, method, parseBody, respondError, tenantContext } from '../../server/runtime.js';

const REQUIRED = ['contest_id','external_entry_id','sport','contest_format','field_size','entry_fee','paid_positions','finish_position','actual_dk_points','payout','player_ids'];
/** Imports the DraftKings standings CSV as immutable contest-field evidence. */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!method(req, res, ['POST'])) return;
  try {
    const body = parseBody(req); const csv = typeof body.csvText === 'string' ? body.csvText : '';
    if (!csv.trim() || csv.length > 8_000_000) throw new Error('csvText is required and must be under 8 MB.');
    const records = parseCsv(csv); const headers = records.shift()?.map((value) => value.trim().toLowerCase().replace(/[\s-]+/g, '_')) ?? [];
    for (const name of REQUIRED) if (!headers.includes(name)) throw new Error(`CSV is missing required column "${name}".`);
    const context = await tenantContext(); let imported = 0; const errors: Array<{ row: number; error: string }> = [];
    for (const [index, values] of records.entries()) {
      const rowNo = index + 2;
      try {
        const row = Object.fromEntries(headers.map((header, i) => [header, values[i] ?? '']));
        const sport = text(row.sport).toUpperCase(); const format = text(row.contest_format).toUpperCase();
        const fieldSize = integer(row.field_size); const paidPositions = integer(row.paid_positions); const finishPosition = integer(row.finish_position);
        const entryFee = numeric(row.entry_fee); const points = numeric(row.actual_dk_points); const payout = numeric(row.payout);
        const playerIds = text(row.player_ids).split(/[;|]/).map((id) => id.trim()).filter(Boolean);
        if (!text(row.contest_id) || !text(row.external_entry_id)) throw new Error('contest_id and external_entry_id are required.');
        if (!['MLB','WNBA','NFL','CFB','GOLF','NBA'].includes(sport) || !['CLASSIC','SHOWDOWN'].includes(format)) throw new Error('sport or contest_format is unsupported.');
        if (!fieldSize || !paidPositions || !finishPosition || finishPosition > fieldSize || paidPositions > fieldSize) throw new Error('Field size, paid positions, or finish position is out of range.');
        if (entryFee < 0 || payout < 0 || !playerIds.length) throw new Error('Entry fee/payout cannot be negative and player_ids must contain at least one DraftKings player ID.');
        const normalized = { tenant_id: context.tenantId, contest_id: text(row.contest_id), external_entry_id: text(row.external_entry_id), sport, contest_format: format, field_size: fieldSize, entry_fee: entryFee, paid_positions: paidPositions, finish_position: finishPosition, actual_dk_points: points, payout, player_ids: playerIds, outcome_source: 'DRAFTKINGS_STANDINGS_CSV', finality_status: 'FINAL' };
        const source_sha256 = createHash('sha256').update(stableJson(normalized)).digest('hex');
        const saved = await context.db.from('floyd_dfs_contest_field_entries').upsert({ ...normalized, source_sha256 }, { onConflict: 'tenant_id,contest_id,external_entry_id,source_sha256', ignoreDuplicates: true });
        if (saved.error) throw saved.error; imported += 1;
      } catch (error) { errors.push({ row: rowNo, error: error instanceof Error ? error.message : 'Invalid standings row.' }); }
    }
    cors(req, res); res.status(errors.length ? 207 : 200).json({ imported, failed: errors.length, errors: errors.slice(0,100), note: 'Field entries are immutable evidence. Import only completed DraftKings standings exports; use DraftKings player IDs separated by semicolons or pipes.' });
  } catch (error) { respondError(req, res, error); }
}
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function numeric(value: unknown): number { const raw = text(value).replace(/^\$/, '').replace(/,/g, ''); const result = Number(raw); if (!raw || !Number.isFinite(result)) throw new Error(`Invalid numeric value "${raw}".`); return result; }
function integer(value: unknown): number { const result = numeric(value); if (!Number.isInteger(result)) throw new Error(`Expected an integer, got ${result}.`); return result; }
function parseCsv(source: string): string[][] { const rows: string[][]=[]; let row:string[]=[]; let field=''; let quoted=false; for(let i=0;i<source.length;i++){const c=source[i]; if(quoted){if(c==='"'&&source[i+1]==='"'){field+='"';i++;}else if(c==='"')quoted=false;else field+=c;}else if(c==='"')quoted=true;else if(c===','){row.push(field);field='';}else if(c==='\n'){row.push(field.replace(/\r$/,''));if(row.some((v)=>v.trim()))rows.push(row);row=[];field='';}else field+=c;} if(quoted)throw new Error('CSV contains an unclosed quoted field.');row.push(field.replace(/\r$/,''));if(row.some((v)=>v.trim()))rows.push(row);return rows; }
function stableJson(value: unknown): string { if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return `[${value.map(stableJson).join(',')}]`;return `{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`; }
