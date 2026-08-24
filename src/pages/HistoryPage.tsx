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

function HistoryCard({ row }: { row: HistoryRow }) { const payload = (row.lineup_payload ?? {}) as HistoryRow; const players = Array.isArray(payload.playerIds) ? payload.playerIds.length : 0; return <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-[var(--shadow-subtle)]"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{String(row.sport ?? 'DFS')} · {String(row.contest_format ?? row.contest_type ?? 'contest')}</p><h2 className="mt-1 text-lg font-black text-[#0b1f3a]">Lineup #{String(row.bullet_number ?? '—')}</h2></div><StatusBadge status={String(row.status ?? 'unknown')} /></div><div className="mt-4 grid grid-cols-3 gap-2 text-center"><Metric label="Median" value={formatNumber(payload.median)} /><Metric label="Salary" value={formatMoney(payload.salaryUsed)} /><Metric label="Players" value={String(players || '—')} /></div><div className="mt-4 flex items-center justify-between gap-3 text-xs text-slate-500"><span>{formatDate(String(row.created_at ?? ''))}</span>{row.selection_run_id ? <Link className="font-black text-[#0b1f3a] underline" to={`/runs/${String(row.generation_run_id)}`}>View run</Link> : null}</div></article>; }
