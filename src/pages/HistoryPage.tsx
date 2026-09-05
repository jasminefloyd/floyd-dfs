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
  useEffect(() => { void floydRequest<{ lineups: HistoryRow[] }>('/api/lineups').then((data) => setRows(data.lineups ?? [])).catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load lineup history.')); }, []);
  const filtered = rows.filter((row) => status === 'all' || String(row.status ?? '').toLowerCase() === status);
  return <AppPage eyebrow="04 / HISTORY" title="Your lineup history." subtitle="Every generated and entered lineup stays attached to its run lineage.">
    <div className="mb-4 flex flex-wrap gap-2">{['all', 'generated', 'entered'].map((value) => <button key={value} type="button" onClick={() => setStatus(value)} className={`rounded-md border px-3 py-2 text-xs font-black uppercase tracking-wide ${status === value ? 'border-[#0b1f3a] bg-[#0b1f3a] text-white' : 'border-slate-200 bg-white text-slate-600'}`}>{value}</button>)}</div>
    {error ? <ErrorBox message={error} /> : filtered.length ? <div className="grid gap-3 md:grid-cols-2">{filtered.map((row, index) => <HistoryCard key={String(row.id ?? index)} row={row} />)}</div> : <EmptyState text="No persisted lineups match this filter." />}
  </AppPage>;
}

function HistoryCard({ row }: { row: HistoryRow }) {
  const payload = (row.lineup_payload ?? {}) as HistoryRow;
  const players = Array.isArray(payload.playerIds) ? payload.playerIds.length : 0;
  const isEntered = String(row.status ?? '').toLowerCase() === 'entered';
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
    <div className="mt-4 flex items-center justify-between gap-3 text-xs text-slate-500">
      <span>{formatDate(String(row.created_at ?? ''))}</span>
      {generationRunId ? <Link className="font-black text-[#0b1f3a] underline" to={`/runs/${encodeURIComponent(generationRunId)}`}>View run</Link> : <span className="text-[10px] text-slate-400">Run lineage unavailable</span>}
    </div>
    {isEntered ? <RecordResult lineupId={String(row.id ?? '')} existingResult={row.actual_dk_points as number | undefined} existingCashLine={row.cash_line as number | undefined} /> : null}
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

function RecordResult({ lineupId, existingResult, existingCashLine }: { lineupId: string; existingResult?: number; existingCashLine?: number }) {
  const [expanded, setExpanded] = useState(false);
  const [actualDkPoints, setActualDkPoints] = useState(existingResult !== undefined ? String(existingResult) : '');
  const [cashLine, setCashLine] = useState(existingCashLine !== undefined ? String(existingCashLine) : '');
  const [finishPosition, setFinishPosition] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(existingResult !== undefined);
  const [diagnostic, setDiagnostic] = useState<Diagnostic | null>(null);

  async function submit() {
    const points = Number(actualDkPoints);
    if (!Number.isFinite(points)) { setError('Actual DK points is required and must be a number.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const cashLineValue = cashLine.trim() ? Number(cashLine) : undefined;
      const finishPositionValue = finishPosition.trim() ? Number(finishPosition) : undefined;
      const response = await floydRequest<{ diagnostic: Diagnostic | null }>(`/api/lineups/${encodeURIComponent(lineupId)}/result`, {
        method: 'POST',
        body: JSON.stringify({ actualDkPoints: points, ...(cashLineValue !== undefined ? { cashLine: cashLineValue } : {}), ...(finishPositionValue !== undefined ? { finishPosition: finishPositionValue } : {}) }),
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
        <label className="block text-[10px] font-black uppercase tracking-wide text-slate-500">
          Cash line (optional)
          <input type="number" value={cashLine} onChange={(event) => setCashLine(event.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-800" />
        </label>
        <label className="block text-[10px] font-black uppercase tracking-wide text-slate-500">
          Finish position (optional)
          <input type="number" value={finishPosition} onChange={(event) => setFinishPosition(event.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-800" />
        </label>
      </div>
      {error ? <p className="text-xs font-bold text-error">{error}</p> : null}
      <div className="flex gap-2">
        <button type="button" onClick={() => void submit()} disabled={submitting} className="flex-1 rounded-md bg-[#0b1f3a] py-2 text-xs font-black text-white disabled:opacity-50">{submitting ? 'Saving…' : 'Save result'}</button>
        <button type="button" onClick={() => setExpanded(false)} className="rounded-md border border-slate-300 px-3 py-2 text-xs font-black text-slate-600">Cancel</button>
      </div>
      <p className="text-[10px] text-slate-500">Recording real results is what lets cash-line confidence move from a simulated estimate to a calibrated one over time.</p>
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
