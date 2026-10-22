import { createHash } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, method, parseBody, requireOperator, respondError, tenantContext } from '../../server/runtime.js';
import { reconcileAndDiagnose } from './import.js';

const REQUIRED = ['contest_id','external_entry_id','sport','contest_format','field_size','entry_fee','paid_positions','finish_position','actual_dk_points','payout','player_ids'];
/** Imports full-field DraftKings standings, then joins registered user entries. */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!method(req, res, ['POST'])) return;
  try {
    const body = parseBody(req); const csv = typeof body.csvText === 'string' ? body.csvText : '';
    if (!csv.trim() || csv.length > 8_000_000) throw new Error('csvText is required and must be under 8 MB.');
    const records = parseCsv(csv); const headers = records.shift()?.map((value) => value.trim().toLowerCase().replace(/[\s-]+/g, '_')) ?? [];
    for (const name of REQUIRED) if (!headers.includes(name)) throw new Error(`CSV is missing required column "${name}".`);
    if (records.length > 50000) throw new Error('Standings upload exceeds the 50,000 entry limit.');
    const context = await tenantContext(req); requireOperator(context); let imported = 0; let linkedOutcomes = 0; const errors: Array<{ row: number; error: string }> = [];
    const touchedContests = new Set<string>(); const prepared: Array<{ rowNo: number; value: Record<string, unknown> }> = [];
    for (const [index, values] of records.entries()) {
      const rowNo = index + 2;
      try {
        const row = Object.fromEntries(headers.map((header, i) => [header, values[i] ?? '']));
        const contestId = text(row.contest_id); const externalEntryId = text(row.external_entry_id);
        const sport = text(row.sport).toUpperCase(); const format = text(row.contest_format).toUpperCase();
        const fieldSize = integer(row.field_size); const paidPositions = integer(row.paid_positions); const finishPosition = integer(row.finish_position);
        const entryFee = numeric(row.entry_fee); const points = numeric(row.actual_dk_points); const payout = numeric(row.payout);
        const playerIds = text(row.player_ids).split(/[;|]/).map((id) => id.trim()).filter(Boolean);
        if (!contestId || !externalEntryId) throw new Error('contest_id and external_entry_id are required.');
        if (!['MLB','WNBA','NFL','CFB','GOLF','NBA'].includes(sport) || !['CLASSIC','SHOWDOWN'].includes(format)) throw new Error('sport or contest_format is unsupported.');
        if (fieldSize < 1 || paidPositions < 1 || paidPositions > fieldSize || finishPosition < 1 || finishPosition > fieldSize) throw new Error('Field size, paid positions, or finish position is out of range.');
        if (entryFee < 0 || payout < 0 || points < 0 || !playerIds.length) throw new Error('Points, entry fee, and payout must be nonnegative; player_ids must contain DraftKings IDs.');
        const normalized = { tenant_id: context.tenantId, contest_id: contestId, external_entry_id: externalEntryId, sport, contest_format: format, field_size: fieldSize, entry_fee: entryFee, paid_positions: paidPositions, finish_position: finishPosition, actual_dk_points: points, payout, player_ids: playerIds, outcome_source: 'DRAFTKINGS_STANDINGS_CSV', finality_status: 'FINAL' };
        const source_sha256 = createHash('sha256').update(stableJson(normalized)).digest('hex');
        prepared.push({ rowNo, value: { ...normalized, source_sha256 } }); touchedContests.add(contestId);
      } catch (error) { errors.push({ row: rowNo, error: error instanceof Error ? error.message : 'Invalid standings row.' }); }
    }

    for (let offset = 0; offset < prepared.length; offset += 500) {
      const batch = prepared.slice(offset, offset + 500);
      const saved = await context.db.from('floyd_dfs_contest_field_entries').upsert(batch.map((item) => item.value), { onConflict: 'tenant_id,contest_id,external_entry_id,source_sha256', ignoreDuplicates: true });
      if (saved.error) { errors.push({ row: batch[0]?.rowNo ?? 0, error: saved.error.message }); continue; }
      imported += batch.length;
    }

    for (const contestId of touchedContests) {
      const contestRows = await context.db.from('floyd_dfs_contest_field_entries').select('contest_id,external_entry_id,sport,contest_format,field_size,entry_fee,paid_positions,finish_position,actual_dk_points,payout,player_ids').eq('tenant_id', context.tenantId).eq('contest_id', contestId).in('finality_status', ['FINAL','CORRECTED']).limit(50000);
      if (contestRows.error) throw contestRows.error;
      const field = contestRows.data ?? []; if (!field.length) continue;
      const expected = Number(field[0].field_size);
      if (field.some((entry) => Number(entry.field_size) !== expected || Number(entry.paid_positions) !== Number(field[0].paid_positions) || Number(entry.entry_fee) !== Number(field[0].entry_fee) || entry.sport !== field[0].sport || entry.contest_format !== field[0].contest_format)) {
        errors.push({ row: 0, error: `Contest ${contestId} has inconsistent contest labels; no lineup outcomes were reconciled.` }); continue;
      }
      const uniqueEntries = new Set(field.map((entry) => String(entry.external_entry_id)));
      if (uniqueEntries.size !== expected || field.length !== expected) {
        errors.push({ row: 0, error: `Contest ${contestId} standings are incomplete (${uniqueEntries.size}/${expected} unique entries); no cash line or lineup outcome was inferred.` }); continue;
      }
      const paid = field.filter((entry) => Number(entry.payout) > 0);
      if (!paid.length) { errors.push({ row: 0, error: `Contest ${contestId} has no positive payout rows; the cash line cannot be derived.` }); continue; }
      const cashLine = Math.min(...paid.map((entry) => Number(entry.actual_dk_points)));
      const linkResult = await context.db.from('floyd_dfs_entry_links').select('generated_lineup_id,external_entry_id').eq('tenant_id', context.tenantId).eq('contest_id', contestId);
      if (linkResult.error) throw linkResult.error;
      const links = new Map((linkResult.data ?? []).map((link) => [String(link.external_entry_id), String(link.generated_lineup_id)]));
      for (const entry of field) {
        const lineupId = links.get(String(entry.external_entry_id)); if (!lineupId) continue;
        const lineupResult = await context.db.from('floyd_dfs_generated_lineups').select('id,status,lineup_payload,selection_run_id').eq('tenant_id', context.tenantId).eq('id', lineupId).maybeSingle();
        if (lineupResult.error) throw lineupResult.error; if (!lineupResult.data || lineupResult.data.status !== 'ENTERED') continue;
        const actual = Number(entry.actual_dk_points); const finish = Number(entry.finish_position); const fieldSize = Number(entry.field_size); const fee = Number(entry.entry_fee); const payout = Number(entry.payout);
        const contestResult = await context.db.from('floyd_dfs_contest_results').select('id').eq('tenant_id', context.tenantId).eq('generated_lineup_id', lineupId).eq('contest_id', contestId).order('measured_at', { ascending: false }).limit(1).maybeSingle();
        if (contestResult.error) throw contestResult.error;
        const fieldSnapshotHash = createHash('sha256').update(stableJson(field.map((item) => [item.external_entry_id,item.finish_position,item.actual_dk_points,item.payout]))).digest('hex');
        const values = { actual_dk_points: actual, cash_line: cashLine, beat_cash_line: actual >= cashLine, finish_position: finish, finish_percentile: 100 * (1 - (finish - 1) / Math.max(1, fieldSize - 1)), payout, roi: fee > 0 ? (payout - fee) / fee : null, contest_id: contestId, contest_name: text(body.contestName) || null, sport: entry.sport, contest_format: entry.contest_format, field_size: fieldSize, entry_fee: fee, paid_positions: Number(entry.paid_positions), outcome_source: 'DRAFTKINGS_STANDINGS_CSV', external_entry_id: entry.external_entry_id, official_outcome: true, model_evaluation_eligible: false, reconciliation_status: 'UNVERIFIED', result_payload: { source: 'DRAFTKINGS_STANDINGS_CSV', fullFieldImport: true, fieldRows: field.length, fieldSnapshotHash, cashLine } };
        const savedResult = contestResult.data
          ? await context.db.from('floyd_dfs_contest_results').update(values).eq('tenant_id', context.tenantId).eq('id', contestResult.data.id).select('id').single()
          : await context.db.from('floyd_dfs_contest_results').insert({ tenant_id: context.tenantId, generated_lineup_id: lineupId, ...values }).select('id').single();
        if (savedResult.error) throw savedResult.error;
        await reconcileAndDiagnose({ context, resultId: String(savedResult.data.id), lineupId, lineupPayload: lineupResult.data.lineup_payload, selectionRunId: String(lineupResult.data.selection_run_id), enteredScore: actual, contestKey: contestId });
        linkedOutcomes += 1;
      }
    }
    cors(req, res); res.status(errors.length ? 207 : 200).json({ imported, linkedOutcomes, failed: errors.length, errors: errors.slice(0,100), note: 'Cash line is derived only from complete field standings. Contest outcomes are reconciled to saved lineups through the DraftKings entry ID recorded in the app.' });
  } catch (error) { respondError(req, res, error); }
}
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function numeric(value: unknown): number { const raw = text(value).replace(/^\$/, '').replace(/,/g, ''); const result = Number(raw); if (!raw || !Number.isFinite(result)) throw new Error(`Invalid numeric value "${raw}".`); return result; }
function integer(value: unknown): number { const result = numeric(value); if (!Number.isInteger(result)) throw new Error(`Expected an integer, got ${result}.`); return result; }
function parseCsv(source: string): string[][] { const rows: string[][]=[]; let row:string[]=[]; let field=''; let quoted=false; for(let i=0;i<source.length;i++){const c=source[i]; if(quoted){if(c==='"'&&source[i+1]==='"'){field+='"';i++;}else if(c==='"')quoted=false;else field+=c;}else if(c==='"')quoted=true;else if(c===','){row.push(field);field='';}else if(c==='\n'){row.push(field.replace(/\r$/,''));if(row.some((v)=>v.trim()))rows.push(row);row=[];field='';}else field+=c;} if(quoted)throw new Error('CSV contains an unclosed quoted field.');row.push(field.replace(/\r$/,''));if(row.some((v)=>v.trim()))rows.push(row);return rows; }
function stableJson(value: unknown): string { if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return `[${value.map(stableJson).join(',')}]`;return `{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`; }
