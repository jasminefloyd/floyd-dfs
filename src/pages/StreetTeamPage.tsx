import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

type StreetTeamPayload = { snapshot?: { snapshotId: string; asOf: string; observations: Array<{ id: string; claim: string; classification: string; confidence: number; source: string; retrievedAt: string; sourceUrl?: string }>; resolvedFacts: Array<{ id: string; factType: string; value: unknown; state: string; confidence: number; observationIds: string[] }>; unknowns: Array<{ question: string }>; providerDiagnostics: Array<{ provider: string; status: string; freshness: string; errorCode?: string }> }; currentStateFreshness?: string };
type SnapshotListItem = { id: string; as_of: string; freshness_state: string; evidence_hash: string; created_at: string };

export default function StreetTeamPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSnapshotId = searchParams.get('snapshotId')?.trim() || undefined;
  const [payload, setPayload] = useState<StreetTeamPayload | null>(null);
  const [history, setHistory] = useState<SnapshotListItem[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const selectedSnapshotPath = requestedSnapshotId
      ? `/api/street-team/briefings?snapshotId=${encodeURIComponent(requestedSnapshotId)}`
      : '/api/street-team/briefings';
    Promise.all([fetch(selectedSnapshotPath), fetch('/api/street-team/briefings?history=1&limit=20')]).then(async ([latestResponse, historyResponse]) => {
      const response = latestResponse;
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? body.message ?? 'Unable to load the Street Team briefing.');
      const historyBody = await historyResponse.json();
      if (!historyResponse.ok) throw new Error(historyBody.error?.message ?? historyBody.message ?? 'Unable to load Street Team snapshot history.');
      return { latest: body as StreetTeamPayload, history: Array.isArray(historyBody.snapshots) ? historyBody.snapshots as SnapshotListItem[] : [] };
    }).then(({ latest, history: snapshots }) => { if (active) { setPayload(latest); setHistory(snapshots); } }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [requestedSnapshotId]);
  const snapshot = payload?.snapshot;
  function viewSnapshot(snapshotId: string) { setSearchParams({ snapshotId }); }
  return <Page title="Street Team" subtitle="NBA intelligence snapshot, source freshness, and explicit unknowns.">
    {history.length > 0 && <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-black text-[#0b1f3a]">Snapshot history</h2><span className="text-xs text-slate-500">{history.length} most recent snapshots</span></div><div className="mt-3 flex gap-2 overflow-x-auto pb-1">{history.map((item) => <button key={item.id} type="button" onClick={() => void viewSnapshot(item.id)} className={`shrink-0 rounded-md border px-3 py-2 text-left ${snapshot?.snapshotId === item.id ? 'border-cyan-700 bg-cyan-50' : 'border-slate-200 bg-white'}`}><span className="block text-xs font-black">{new Date(item.as_of).toLocaleString()}</span><span className="mt-1 block text-[10px] text-slate-500">{item.freshness_state} · {item.id.slice(0, 8)}</span></button>)}</div></section>}
    {loading ? <Card>Loading {requestedSnapshotId ? 'the selected' : 'latest'} tenant-scoped snapshot…</Card> : error ? <Card tone="amber">{error}</Card> : !snapshot ? <Card>No Street Team snapshot is available yet. Collection must be enabled and a collection run must complete before this view can show sourced facts.</Card> : <>
      <Card><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wider text-slate-500">Snapshot {snapshot.snapshotId}</p><p className="mt-1 text-sm">Captured {new Date(snapshot.asOf).toLocaleString()}</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black">{payload?.currentStateFreshness ?? 'UNKNOWN'}</span></div></Card>
      <section className="grid gap-4 lg:grid-cols-2"><Card title={`Evidence observations (${snapshot.observations.length})`}>{snapshot.observations.length ? <ul className="space-y-3">{snapshot.observations.map((item) => <li key={item.id} className="border-b border-slate-100 pb-3 last:border-0"><p className="font-semibold">{item.claim}</p><p className="mt-1 text-xs text-slate-500">{item.classification} · {item.source} · confidence {item.confidence} · retrieved {new Date(item.retrievedAt).toLocaleString()}</p>{item.sourceUrl && <a className="mt-1 inline-block text-xs font-bold text-cyan-800 underline" href={item.sourceUrl} target="_blank" rel="noreferrer">Open source</a>}</li>)}</ul> : <p>No observations were returned in this snapshot.</p>}</Card>
        <Card title="Resolved facts, unknowns, and provider status"><h3 className="font-bold">Current resolved facts</h3><ul className="mb-5 mt-2 space-y-2">{snapshot.resolvedFacts.length ? snapshot.resolvedFacts.map((item) => <li key={item.id} className="rounded-md bg-slate-50 p-2 text-sm"><span className="font-bold">{item.factType}</span>: {JSON.stringify(item.value)} <span className="text-slate-500">({item.state}, confidence {item.confidence})</span></li>) : <li>None recorded.</li>}</ul><h3 className="font-bold">Unresolved questions</h3><ul className="mb-5 mt-2 list-disc space-y-1 pl-5">{snapshot.unknowns.length ? snapshot.unknowns.map((item, index) => <li key={`${item.question}-${index}`}>{item.question}</li>) : <li>None recorded.</li>}</ul><h3 className="font-bold">Providers</h3><ul className="mt-2 space-y-2">{snapshot.providerDiagnostics.map((item) => <li key={item.provider} className="flex justify-between gap-3 text-sm"><span>{item.provider}{item.errorCode ? ` · ${item.errorCode}` : ''}</span><span>{item.status} · {item.freshness}</span></li>)}</ul></Card></section>
    </>}
  </Page>;
}

function Page({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) { return <main className="min-h-screen bg-[#f4f7fb] px-4 py-8 text-slate-900"><div className="mx-auto max-w-7xl"><p className="text-xs font-black uppercase tracking-[.18em] text-cyan-700">Operations</p><h1 className="mt-2 text-3xl font-black text-[#0b1f3a]">{title}</h1><p className="mb-6 mt-2 text-slate-600">{subtitle}</p><div className="space-y-4">{children}</div></div></main> }
function Card({ title, children, tone = 'white' }: { title?: string; children: React.ReactNode; tone?: 'white' | 'amber' }) { return <section className={`rounded-xl border p-5 shadow-sm ${tone === 'amber' ? 'border-amber-200 bg-amber-50 text-amber-950' : 'border-slate-200 bg-white'}`}>{title && <h2 className="mb-3 text-lg font-black text-[#0b1f3a]">{title}</h2>}{children}</section> }
