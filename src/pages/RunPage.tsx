import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppPage, EmptyState, ErrorBox, Metric, StatusBadge } from '../components/AppPrimitives';
import { formatDate, formatMoney, formatNumber } from '../lib/formatters';
import { floydRequest } from '../lib/floydDfsClient';

type RecordValue = Record<string, unknown>;

export default function RunPage() {
  const { runId = '' } = useParams();
  const [data, setData] = useState<RecordValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (!runId) { setError('A generation run ID is required.'); return; }
    void floydRequest<RecordValue>(`/api/runs/${encodeURIComponent(runId)}`).then(setData).catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load this run.'));
  }, [runId]);

  const run = data?.run as RecordValue | undefined;
  const stages = Array.isArray(data?.stages) ? data.stages as RecordValue[] : [];
  const lineups = Array.isArray(data?.lineups) ? data.lineups as RecordValue[] : [];
  const diagnostics = stageDiagnostics(stages);
  const contestName = contestNameFrom(run) ?? 'Contest name unavailable';

  async function copyLog() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setCopyStatus('copied');
      window.setTimeout(() => setCopyStatus('idle'), 2200);
    } catch { setCopyStatus('failed'); }
  }

  return <AppPage eyebrow="03 / RUN DETAIL" title={contestName} subtitle="The complete stage lineage behind this decision set.">
    {error ? <ErrorBox message={error} /> : !data ? <EmptyState text="Loading run details…" /> : <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[var(--shadow-subtle)]">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{String(run?.sport ?? 'DFS')} · {String(run?.contest_format ?? 'contest')}</p><p className="mt-1 break-all font-mono text-[11px] text-slate-500">Run {String(run?.id ?? runId)}</p></div><div className="flex items-center gap-2"><StatusBadge status={String(run?.state ?? 'unknown')} /><button type="button" onClick={() => void copyLog()} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-wide text-slate-700 hover:border-cyan-500 hover:text-cyan-800">{copyStatus === 'copied' ? 'Copied' : copyStatus === 'failed' ? 'Copy failed' : 'Copy scan log'}</button></div></div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3"><Metric label="Created" value={formatDate(String(run?.created_at ?? ''))} /><Metric label="Entries" value={String(run?.requested_entry_count ?? '—')} /><Metric label="Lineups" value={String(lineups.length)} /></div>
      </section>
      <GeneratedLineups lineups={lineups} run={run} stages={stages} />
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[var(--shadow-subtle)]"><h2 className="!text-sm font-black uppercase tracking-wide text-[#0b1f3a]">Stage lineage</h2><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{stages.map((stage, index) => <div key={String(stage.id ?? index)} className="rounded-lg border border-slate-200 bg-slate-50 p-3"><div className="flex justify-between gap-2"><span className="text-xs font-black text-[#0b1f3a]">{String(stage.stage ?? 'Stage')}</span><span className="text-[10px] font-bold uppercase text-slate-500">{String(stage.status ?? '—')}</span></div><p className="mt-2 text-[11px] text-slate-500">{String(stage.completed_at ?? stage.created_at ?? 'Timestamp unavailable')}</p></div>)}</div></section>
      {diagnostics.length ? <section className="rounded-xl border border-amber-200 bg-amber-50 p-4"><h2 className="!text-sm font-black uppercase tracking-wide text-amber-900">Why a stage is partial</h2><div className="mt-3 space-y-3">{diagnostics.map((item, index) => <div key={`${item.label}-${index}`}><p className="text-xs font-black uppercase tracking-wide text-amber-900">{item.label}</p><ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-amber-950">{item.details.map((detail, detailIndex) => <li key={`${detail}-${detailIndex}`}>{detail}</li>)}</ul></div>)}</div></section> : null}
      <div className="flex flex-wrap gap-3"><Link to={`/research/${encodeURIComponent(runId)}`} className="rounded-md bg-[#0b1f3a] px-4 py-2.5 text-xs font-black text-white">View research</Link><Link to="/history" className="rounded-md border border-slate-200 bg-white px-4 py-2.5 text-xs font-black text-slate-700">Back to history</Link></div>
    </div>}
  </AppPage>;
}

function GeneratedLineups({ lineups, run, stages }: { lineups: RecordValue[]; run?: RecordValue; stages: RecordValue[] }) {
  const players = playerMap(run, stages);
  return <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[var(--shadow-subtle)]"><div className="flex items-center justify-between gap-3"><h2 className="!text-sm font-black uppercase tracking-wide text-[#0b1f3a]">Lineup generated</h2><span className="text-[10px] font-black uppercase tracking-wide text-slate-500">{lineups.length} selected</span></div>{lineups.length ? <div className="mt-3 grid gap-3 lg:grid-cols-2">{lineups.map((row, index) => { const payload = recordOf(row.lineup_payload) ?? {}; const playerIds = Array.isArray(payload.playerIds) ? payload.playerIds.map(String) : []; const slots = recordOf(payload.rosterSlots) ?? {}; return <div key={String(row.id ?? index)} className="rounded-lg border border-slate-200 bg-slate-50 p-3"><div className="flex items-center justify-between gap-2"><p className="text-xs font-black text-[#0b1f3a]">Lineup #{String(payload.bulletNumber ?? row.bullet_number ?? index + 1)}</p><p className="text-xs font-black text-cyan-800">{formatNumber(payload.median)} median</p></div><div className="mt-2 space-y-1">{playerIds.map((playerId) => { const slot = Object.entries(slots).find(([, value]) => String(value) === playerId)?.[0] ?? 'PLAYER'; const player = players.get(playerId); return <div key={`${playerId}-${slot}`} className="flex items-center justify-between gap-2 text-[11px] text-slate-600"><span className="font-black uppercase text-slate-400">{slot}</span><span className="min-w-0 truncate text-right font-bold text-[#0b1f3a]">{player?.name ?? `Player ${playerId}`}{player?.team ? ` · ${player.team}` : ''}</span></div>; })}</div><div className="mt-3 grid grid-cols-2 gap-2"><Metric label="Salary" value={formatMoney(payload.salaryUsed)} /><Metric label="Status" value={String(row.status ?? 'GENERATED')} /></div></div>; })}</div> : <EmptyState text="No generated lineup was persisted for this run." />}</section>;
}

function playerMap(run?: RecordValue, stages: RecordValue[] = []): Map<string, { name: string; team?: string }> {
  const map = new Map<string, { name: string; team?: string }>();
  const requestPayload = recordOf(run?.request_payload); const input = recordOf(requestPayload?.input); const validatedSlate = recordOf(input?.validatedSlate);
  const slateStage = stages.find((stage) => String(stage.stage ?? '').toUpperCase() === 'SLATE'); const stageSlate = recordOf(slateStage?.output_payload ?? slateStage?.output);
  for (const slate of [validatedSlate, stageSlate]) for (const player of arrayOf(slate?.playerPool)) { const id = String(player.playerId ?? ''); const name = String(player.playerName ?? ''); if (id && name) map.set(id, { name, team: typeof player.team === 'string' ? player.team : undefined }); }
  return map;
}

function contestNameFrom(run?: RecordValue): string | undefined { const requestPayload = recordOf(run?.request_payload); const input = recordOf(requestPayload?.input); const name = input?.contestName; return typeof name === 'string' && name.trim() ? name : undefined; }
function recordOf(value: unknown): RecordValue | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : undefined; }
function arrayOf(value: unknown): RecordValue[] { return Array.isArray(value) ? value.filter((item): item is RecordValue => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : []; }

function stageDiagnostics(stages: RecordValue[]): Array<{ label: string; details: string[] }> {
  const diagnostics: Array<{ label: string; details: string[] }> = [];
  for (const stage of stages) {
    const output = recordOf(stage.output_payload ?? stage.output); if (!output || stage.status !== 'PARTIAL') continue;
    const details: string[] = [];
    for (const provider of arrayOf(output.providerResults)) { if (provider.status === 'FAILED' || provider.status === 'EMPTY') details.push(`${String(provider.provider)}: ${String(provider.status).toLowerCase()} (${String(provider.error ?? `${String(provider.articleCount ?? 0)} articles`)})`); if (Number(provider.rejectedArticleCount ?? 0) > 0) details.push(`${String(provider.provider)}: ${String(provider.acceptedArticleCount ?? 0)} accepted, ${String(provider.rejectedArticleCount)} rejected (${Array.isArray(provider.rejectionSamples) ? provider.rejectionSamples.join('; ') : 'matching rules rejected the records'}).`); }
    for (const unknown of arrayOf(output.unknowns)) details.push(`${String(unknown.question)}: ${String(unknown.reason)}`);
    for (const conflict of arrayOf(output.conflicts)) if (conflict.resolved === false) details.push(`Unresolved conflict: ${String(conflict.summary)}`);
    for (const gap of Array.isArray(output.gaps) ? output.gaps : []) details.push(String(typeof gap === 'string' ? gap : (gap as RecordValue).reason ?? gap));
    if (details.length) diagnostics.push({ label: String(stage.stage ?? 'Stage'), details: [...new Set(details)] });
  }
  return diagnostics;
}
