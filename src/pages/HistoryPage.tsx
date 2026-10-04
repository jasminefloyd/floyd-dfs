import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { floydRequest } from '../lib/floydDfsClient';
import { AppPage, EmptyState, ErrorBox, Metric, StatusBadge } from '../components/AppPrimitives';
import { formatDate, formatMoney, formatNumber } from '../lib/formatters';

type HistoryRow = Record<string, unknown>;

export default function HistoryPage() {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [status, setStatus] = useState('all');
  const [error, setError] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [fieldImportStatus, setFieldImportStatus] = useState<string | null>(null);
  useEffect(() => { void floydRequest<{ lineups: HistoryRow[] }>('/api/lineups').then((data) => setRows(data.lineups ?? [])).catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load lineup history.')); }, []);
  const filtered = rows.filter((row) => status === 'all' || String(row.status ?? '').toLowerCase() === status);
  async function importResults(file?: File) {
    if (!file) return;
    setImporting(true); setImportStatus(null); setError(null);
    try {
      const csvText = await file.text();
      const result = await floydRequest<{ imported: number; failed: number; errors?: Array<{ row: number; error: string }> }>('/api/results/import', { method: 'POST', body: JSON.stringify({ csvText }) });
      setImportStatus(`Imported ${result.imported} result(s); ${result.failed} row(s) need attention.${result.errors?.[0] ? ` First issue: row ${result.errors[0].row}: ${result.errors[0].error}` : ''}`);
      const refreshed = await floydRequest<{ lineups: HistoryRow[] }>('/api/lineups'); setRows(refreshed.lineups ?? []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to import contest results.'); }
    finally { setImporting(false); }
  }
  async function importField(file?: File) {
    if (!file) return;
    setImporting(true); setFieldImportStatus(null); setError(null);
    try {
      const csvText = await file.text();
      const result = await floydRequest<{ imported: number; failed: number; errors?: Array<{ row: number; error: string }> }>('/api/results/import-field', { method: 'POST', body: JSON.stringify({ csvText }) });
      setFieldImportStatus(`Imported ${result.imported} contest field row(s); ${result.failed} row(s) need attention.${result.errors?.[0] ? ` First issue: row ${result.errors[0].row}: ${result.errors[0].error}` : ''}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to import DraftKings standings.'); }
    finally { setImporting(false); }
  }
  return <AppPage eyebrow="04 / HISTORY" title="Your lineup history." subtitle="Every generated and entered lineup stays attached to its run lineage.">
    <div className="mb-4 flex flex-wrap gap-2">{['all', 'generated', 'entered'].map((value) => <button key={value} type="button" onClick={() => setStatus(value)} className={`rounded-md border px-3 py-2 text-xs font-black uppercase tracking-wide ${status === value ? 'border-[#0b1f3a] bg-[#0b1f3a] text-white' : 'border-slate-200 bg-white text-slate-600'}`}>{value}</button>)}</div>
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3"><label className="cursor-pointer rounded-md border border-slate-300 px-3 py-2 text-xs font-black text-[#0b1f3a]">{importing ? 'Importing…' : 'Import my DraftKings results'}<input type="file" accept=".csv,text/csv" className="sr-only" disabled={importing} onChange={(event) => { void importResults(event.target.files?.[0]); event.currentTarget.value = ''; }} /></label><span className="text-[11px] text-slate-500">Requires a <code>lineup_id</code> column to match your entry.</span><label className="cursor-pointer rounded-md border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs font-black text-cyan-900">Import full contest standings<input type="file" accept=".csv,text/csv" className="sr-only" disabled={importing} onChange={(event) => { void importField(event.target.files?.[0]); event.currentTarget.value = ''; }} /></label><span className="text-[11px] text-slate-500">Field CSV: contest_id, external_entry_id, sport, contest_format, field_size, entry_fee, paid_positions, finish_position, actual_dk_points, payout, player_ids.</span></div>
    {importStatus ? <p className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">{importStatus}</p> : null}
    {fieldImportStatus ? <p className="mb-3 rounded-md border border-cyan-200 bg-cyan-50 p-2 text-xs text-cyan-900">{fieldImportStatus}</p> : null}
    {error ? <ErrorBox message={error} /> : filtered.length ? <div className="grid gap-3 md:grid-cols-2">{filtered.map((row, index) => <HistoryCard key={String(row.id ?? index)} row={row} />)}</div> : <EmptyState text="No persisted lineups match this filter." />}
  </AppPage>;
}

function HistoryCard({ row }: { row: HistoryRow }) {
  const payload = (row.lineup_payload ?? {}) as HistoryRow;
  const players = Array.isArray(payload.playerIds) ? payload.playerIds.length : 0;
  const isEntered = String(row.status ?? '').toLowerCase() === 'entered';
  const hasRecordedResult = Number.isFinite(Number(row.actual_dk_points));
  const reconciliation = String(row.reconciliation_status ?? 'UNVERIFIED');
  const resultPayload = row.result_payload && typeof row.result_payload === 'object' ? row.result_payload as HistoryRow : {};
  const reconciliationDetail = resultPayload.reconciliation && typeof resultPayload.reconciliation === 'object' ? resultPayload.reconciliation as HistoryRow : {};
  const generationRunId = historyGenerationRunId(row);
  return <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-[var(--shadow-subtle)]">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{String(row.sport ?? 'DFS')} · {String(row.contest_format ?? row.contest_type ?? 'contest')}</p>
        <p className="mt-1 text-sm font-black text-[#0b1f3a]">{String(row.contest_name ?? 'Contest name unavailable')}</p>
        <h2 className="mt-1 text-lg font-black text-[#0b1f3a]">Lineup #{String(row.bullet_number ?? '—')}</h2>
      </div>
      <StatusBadge status={String(row.status ?? 'unknown')} />
    </div>
    <div className="mt-4 grid grid-cols-3 gap-2 text-center">
      <Metric label="Median" value={formatNumber(payload.median)} />
      <Metric label="Salary" value={formatMoney(payload.salaryUsed)} />
      <Metric label="Players" value={String(players || '—')} />
    </div>
    {hasRecordedResult ? <div className={`mt-3 rounded-lg border p-3 text-xs ${reconciliation === 'MATCHED' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-300 bg-amber-50 text-amber-950'}`}><p className="font-black">Contest outcome · {reconciliation.replaceAll('_', ' ')}{row.model_evaluation_eligible === true ? ' · eligible for evaluation' : ' · excluded from model evaluation'}</p><p className="mt-1">{Number(row.actual_dk_points).toFixed(2)} actual points{Number.isFinite(Number(row.cash_line)) ? ` · cash line ${Number(row.cash_line).toFixed(2)} · ${row.beat_cash_line ? 'cleared' : 'missed'}` : ''}{Number.isFinite(Number(row.finish_position)) ? ` · rank #${row.finish_position}` : ''}{Number.isFinite(Number(row.payout)) ? ` · payout $${Number(row.payout).toFixed(2)}` : ''}</p>{typeof reconciliationDetail.reasons === 'string' ? <p className="mt-1">{reconciliationDetail.reasons}</p> : Array.isArray(reconciliationDetail.reasons) && reconciliationDetail.reasons.length ? <p className="mt-1">{reconciliationDetail.reasons.map(String).join(' ')}</p> : null}</div> : null}
    <div className="mt-4 flex items-center justify-between gap-3 text-xs text-slate-500">
      <span>{formatDate(String(row.created_at ?? ''))}</span>
      {generationRunId ? <Link className="font-black text-[#0b1f3a] underline" to={`/runs/${encodeURIComponent(generationRunId)}`}>View run</Link> : <span className="text-[10px] text-slate-400">Run lineage unavailable</span>}
    </div>
    {isEntered ? <RecordResult lineupId={String(row.id ?? '')} row={row} /> : null}
  </article>;
}

function historyGenerationRunId(row: HistoryRow): string | undefined {
  const direct = typeof row.generation_run_id === 'string' ? row.generation_run_id : '';
  if (direct) return direct;
  const relation = row.floyd_dfs_selection_runs;
  const selection = Array.isArray(relation) ? relation[0] : relation;
  if (!selection || typeof selection !== 'object') return undefined;
  const generationRunId = (selection as HistoryRow).generation_run_id;
  return typeof generationRunId === 'string' && generationRunId ? generationRunId : undefined;
}

interface Diagnostic { error_stage?: string; diagnosis?: string; confidence?: string; error?: string; }

function RecordResult({ lineupId, row }: { lineupId: string; row: HistoryRow }) {
  const [expanded, setExpanded] = useState(false);
  const initial = (key: string) => row[key] === null || row[key] === undefined ? '' : String(row[key]);
  const [actualDkPoints, setActualDkPoints] = useState(initial('actual_dk_points'));
  const [cashLine, setCashLine] = useState(initial('cash_line'));
  const [finishPosition, setFinishPosition] = useState(initial('finish_position'));
  const [finishPercentile, setFinishPercentile] = useState(initial('finish_percentile'));
  const [payout, setPayout] = useState(initial('payout'));
  const [contestId, setContestId] = useState(initial('contest_id'));
  const [contestName, setContestName] = useState(initial('contest_name'));
  const [fieldSize, setFieldSize] = useState(initial('field_size'));
  const [entryFee, setEntryFee] = useState(initial('entry_fee'));
  const [paidPositions, setPaidPositions] = useState(initial('paid_positions'));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(row.actual_dk_points !== undefined && row.actual_dk_points !== null);
  const [diagnostic, setDiagnostic] = useState<Diagnostic | null>(null);

  async function submit() {
    const points = Number(actualDkPoints);
    if (!Number.isFinite(points)) { setError('Actual DK points is required and must be a number.'); return; }
    if (!contestId.trim() && !contestName.trim()) { setError('Add a DraftKings contest ID or contest name.'); return; }
    if (![cashLine, finishPosition, fieldSize, entryFee, payout].every((value) => value.trim() && Number.isFinite(Number(value)))) { setError('Complete cash line, finish position, field size, entry fee, and payout to save a fully labeled result.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const cashLineValue = cashLine.trim() ? Number(cashLine) : undefined;
      const finishPositionValue = finishPosition.trim() ? Number(finishPosition) : undefined;
      const finishPercentileValue = finishPercentile.trim() ? Number(finishPercentile) : undefined;
      const payoutValue = payout.trim() ? Number(payout) : undefined;
      const fieldSizeValue = fieldSize.trim() ? Number(fieldSize) : undefined;
      const entryFeeValue = entryFee.trim() ? Number(entryFee) : undefined;
      const paidPositionsValue = paidPositions.trim() ? Number(paidPositions) : undefined;
      const response = await floydRequest<{ diagnostic: Diagnostic | null }>(`/api/lineups/${encodeURIComponent(lineupId)}/result`, {
        method: 'POST',
        body: JSON.stringify({ actualDkPoints: points, cashLine: cashLineValue, finishPosition: finishPositionValue, ...(finishPercentileValue !== undefined ? { finishPercentile: finishPercentileValue } : {}), payout: payoutValue, ...(contestId.trim() ? { contestId: contestId.trim() } : {}), contestName: contestName.trim(), sport: row.sport, contestFormat: row.contest_format, fieldSize: fieldSizeValue, entryFee: entryFeeValue, ...(paidPositionsValue !== undefined ? { paidPositions: paidPositionsValue } : {}) }),
      });
      setSubmitted(true);
      setExpanded(false);
      setDiagnostic(response.diagnostic ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to record this result.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!expanded) {
    return (
      <>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-3 w-full rounded-md border border-slate-200 bg-slate-50 py-2 text-xs font-black uppercase tracking-wide text-slate-600 hover:border-cyan-500 hover:text-cyan-800"
        >
          {submitted ? 'Update result' : 'Record result'}
        </button>
        <DiagnosticNote diagnostic={diagnostic} />
      </>
    );
  }

  return (
    <div className="mt-3 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
      <label className="block text-[10px] font-black uppercase tracking-wide text-slate-500">
        Actual DK points
        <input type="number" value={actualDkPoints} onChange={(event) => setActualDkPoints(event.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-800" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-[10px] font-black uppercase tracking-wide text-slate-500">DraftKings contest ID<input value={contestId} onChange={(event) => setContestId(event.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm normal-case text-slate-800" /></label>
        <label className="block text-[10px] font-black uppercase tracking-wide text-slate-500">Contest name<input value={contestName} onChange={(event) => setContestName(event.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm normal-case text-slate-800" /></label>
        <label className="block text-[10px] font-black uppercase tracking-wide text-slate-500">Field size (required)<input type="number" min="1" value={fieldSize} onChange={(event) => setFieldSize(event.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-800" /></label>
        <label className="block text-[10px] font-black uppercase tracking-wide text-slate-500">Entry fee $ (required)<input type="number" min="0" step="0.01" value={entryFee} onChange={(event) => setEntryFee(event.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-800" /></label>
        <label className="block text-[10px] font-black uppercase tracking-wide text-slate-500">Paid positions<input type="number" min="1" value={paidPositions} onChange={(event) => setPaidPositions(event.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-800" /></label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-[10px] font-black uppercase tracking-wide text-slate-500">
          Cash line (required)
          <input type="number" value={cashLine} onChange={(event) => setCashLine(event.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-800" />
        </label>
        <label className="block text-[10px] font-black uppercase tracking-wide text-slate-500">
          Finish position (required)
          <input type="number" value={finishPosition} onChange={(event) => setFinishPosition(event.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-800" />
        </label>
        <label className="block text-[10px] font-black uppercase tracking-wide text-slate-500">
          Finish percentile 0–100 (optional)
          <input type="number" min="0" max="100" value={finishPercentile} onChange={(event) => setFinishPercentile(event.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-800" />
        </label>
        <label className="block text-[10px] font-black uppercase tracking-wide text-slate-500">
          Payout $ (required; enter 0 if no payout)
          <input type="number" min="0" step="0.01" value={payout} onChange={(event) => setPayout(event.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-800" />
        </label>
      </div>
      {error ? <p className="text-xs font-bold text-error">{error}</p> : null}
      <div className="flex gap-2">
        <button type="button" onClick={() => void submit()} disabled={submitting} className="flex-1 rounded-md bg-[#0b1f3a] py-2 text-xs font-black text-white disabled:opacity-50">{submitting ? 'Saving…' : 'Save result'}</button>
        <button type="button" onClick={() => setExpanded(false)} className="rounded-md border border-slate-300 px-3 py-2 text-xs font-black text-slate-600">Cancel</button>
      </div>
      <p className="text-[10px] text-slate-500">Add DraftKings contest metadata with the result so performance can be grouped by contest and field size. Recorded probabilities remain disabled until independent contest validation passes.</p>
    </div>
  );
}

function DiagnosticNote({ diagnostic }: { diagnostic: Diagnostic | null }) {
  if (!diagnostic) return null;
  if (diagnostic.error) return <p className="mt-2 text-[10px] text-slate-400">Automatic diagnosis wasn't available for this result: {diagnostic.error}</p>;
  if (diagnostic.error_stage === 'VARIANCE') return <p className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-[10px] text-slate-500">{diagnostic.diagnosis ?? 'No evidence of a modeling miss — the outcome fell within the projected range.'}</p>;
  return (
    <p className="mt-2 rounded-md border border-amber-300/60 bg-amber-50 px-2.5 py-2 text-[10px] text-amber-800">
      <span className="font-black uppercase tracking-wide">{diagnostic.error_stage ?? 'Diagnosis'}:</span> {diagnostic.diagnosis ?? 'Actual outcome fell outside the projected range.'}
    </p>
  );
}
