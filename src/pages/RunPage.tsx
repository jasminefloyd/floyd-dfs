import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppPage, EmptyState, ErrorBox, Metric, StatusBadge } from '../components/AppPrimitives';
import { PortfolioResults } from '../components/PortfolioResults';
import { formatDate, formatMoney, formatNumber } from '../lib/formatters';
import { floydRequest } from '../lib/floydDfsClient';

type RecordValue = Record<string, unknown>;

export default function RunPage() {
  const { runId = '' } = useParams();
  const [data, setData] = useState<RecordValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [portfolioData, setPortfolioData] = useState<RecordValue | null>(null);
  const [portfolioError, setPortfolioError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) { setError('A generation run ID is required.'); return; }
    void floydRequest<RecordValue>(`/api/runs/${encodeURIComponent(runId)}`).then(setData).catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load this run.'));
  }, [runId]);

  const loadPortfolio = useCallback(async () => {
    if (!runId) return;
    try { setPortfolioData(await floydRequest<RecordValue>(`/api/lineup-portfolios?runId=${encodeURIComponent(runId)}`)); setPortfolioError(null); }
    catch (reason) { setPortfolioError(reason instanceof Error ? reason.message : 'Unable to load portfolio results.'); }
  }, [runId]);

  useEffect(() => { void loadPortfolio(); }, [loadPortfolio]);

  const run = data?.run as RecordValue | undefined;
  const stages = Array.isArray(data?.stages) ? data.stages as RecordValue[] : [];
  const lineups = Array.isArray(data?.lineups) ? data.lineups as RecordValue[] : [];
  const decisionTraces = Array.isArray(data?.decisionTraces) ? data.decisionTraces as RecordValue[] : [];
  const lineage = recordOf(data?.lineage);
  const projectionArtifacts = arrayOf(data?.projectionArtifacts);
  const lineupRevisions = arrayOf(data?.lineupRevisions);
  const trustRecord = recordOf(data?.trust);
  const trust = recordOf(trustRecord?.trust_payload);
  const diagnostics = stageDiagnostics(stages);
  const contestName = contestNameFrom(run) ?? 'Contest name unavailable';
  const savedPortfolio = recordOf(portfolioData?.portfolio);
  const contestSpec = recordOf(savedPortfolio?.contest_spec);

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
      <PortfolioResults data={portfolioData} error={portfolioError} />
      {contestSpec ? <ContestSnapshotCard spec={contestSpec} /> : null}
      <PortfolioDecisionCard stages={stages} />
      <LineupLegalityCard lineups={lineups} />
      <GeneratedLineups lineups={lineups} run={run} stages={stages} traces={decisionTraces} onEntered={loadPortfolio} />
      {trust ? <RunTrustCard trust={trust} /> : null}
      {lineage ? <RunLineageCard lineage={lineage} artifacts={projectionArtifacts} revisions={lineupRevisions} /> : null}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[var(--shadow-subtle)]"><h2 className="!text-sm font-black uppercase tracking-wide text-[#0b1f3a]">Stage lineage</h2><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{stages.map((stage, index) => <div key={String(stage.id ?? index)} className="rounded-lg border border-slate-200 bg-slate-50 p-3"><div className="flex justify-between gap-2"><span className="text-xs font-black text-[#0b1f3a]">{String(stage.stage ?? 'Stage')}</span><span className="text-[10px] font-bold uppercase text-slate-500">{String(stage.status ?? '—')}</span></div><p className="mt-2 text-[11px] text-slate-500">{String(stage.completed_at ?? stage.created_at ?? 'Timestamp unavailable')}</p></div>)}</div></section>
      {diagnostics.length ? <section className="rounded-xl border border-amber-200 bg-amber-50 p-4"><h2 className="!text-sm font-black uppercase tracking-wide text-amber-900">Why a stage is partial</h2><div className="mt-3 space-y-3">{diagnostics.map((item, index) => <div key={`${item.label}-${index}`}><p className="text-xs font-black uppercase tracking-wide text-amber-900">{item.label}</p><ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-amber-950">{item.details.map((detail, detailIndex) => <li key={`${detail}-${detailIndex}`}>{detail}</li>)}</ul></div>)}</div></section> : null}
      <div className="flex flex-wrap gap-3"><Link to={`/research/${encodeURIComponent(runId)}`} className="rounded-md bg-[#0b1f3a] px-4 py-2.5 text-xs font-black text-white">View research</Link><Link to="/history" className="rounded-md border border-slate-200 bg-white px-4 py-2.5 text-xs font-black text-slate-700">Back to history</Link></div>
    </div>}
  </AppPage>;
}

function ContestSnapshotCard({ spec }: { spec: RecordValue }) {
  const warnings = Array.isArray(spec.warnings) ? spec.warnings.map(String) : [];
  const provenance = recordOf(spec.provenance) ?? {};
  return <section className="rounded-xl border border-cyan-200 bg-cyan-50 p-4" aria-labelledby="contest-snapshot-title"><h2 id="contest-snapshot-title" className="!text-sm font-black uppercase tracking-wide text-cyan-950">Saved contest rules and readiness</h2><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Format / readiness" value={`${String(spec.format ?? 'UNKNOWN')} · ${String(spec.readiness ?? 'UNKNOWN')}`} /><Metric label="Entry fee / field" value={`${spec.entryFee === null || spec.entryFee === undefined ? 'Unavailable' : formatMoney(Number(spec.entryFee))} / ${String(spec.fieldSize ?? 'Unavailable')}`} /><Metric label="Entry limit / requested" value={`${String(spec.entryLimit ?? 'Unavailable')} / ${String(spec.requestedEntries ?? '—')}`} /><Metric label="Spec version" value={String(spec.specVersion ?? 'Unversioned')} /></div><details className="mt-3 rounded border border-cyan-200 bg-white p-2"><summary className="cursor-pointer text-xs font-bold text-cyan-950">Data sources and payout terms</summary><p className="mt-2 break-all text-xs text-slate-600">{Object.entries(provenance).map(([key, value]) => `${key}: ${String(value)}`).join(' · ')}</p><p className="mt-2 text-xs text-slate-600">Payout tiers: {Array.isArray(spec.payoutTiers) && spec.payoutTiers.length ? spec.payoutTiers.map((tier) => { const row = recordOf(tier) ?? {}; return `#${String(row.rank)} ${formatMoney(Number(row.payout))}`; }).join(' · ') : 'Unavailable'}</p><p className="mt-1 break-all font-mono text-[10px] text-slate-500">Eligible pool: {Array.isArray(spec.eligiblePlayerIds) ? spec.eligiblePlayerIds.map(String).join(', ') : 'Unavailable'}</p></details>{warnings.length ? <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-amber-950">{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : null}</section>;
}

function PortfolioDecisionCard({ stages }: { stages: RecordValue[] }) {
  const stage = stages.find((item) => String(item.stage ?? '').toUpperCase() === 'SELECTION');
  const selection = recordOf(stage?.output_payload ?? stage?.output);
  const optimization = recordOf(selection?.portfolioOptimization);
  if (!optimization) return null;
  const search = recordOf(optimization.search) ?? {};
  const warnings = Array.isArray(selection?.warnings) ? selection.warnings : [];
  return <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[var(--shadow-subtle)]" aria-labelledby="portfolio-decision-title"><h2 id="portfolio-decision-title" className="!text-sm font-black uppercase tracking-wide text-[#0b1f3a]">Portfolio decision and legality</h2><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Objective" value={String(optimization.objective ?? 'UNKNOWN').replaceAll('_', ' ')} /><Metric label="Search status" value={String(optimization.status ?? stage?.status ?? 'UNKNOWN')} /><Metric label="Search nodes / budget" value={`${String(search.nodesVisited ?? '—')} / ${String(search.nodeBudget ?? '—')}`} /><Metric label="Expected net return" value={optimization.expectedNetReturn === null || optimization.expectedNetReturn === undefined ? 'Unavailable' : formatMoney(Number(optimization.expectedNetReturn))} /></div><p className="mt-3 text-xs text-slate-600">Search completion: {search.complete === true ? 'complete' : search.complete === false ? 'bounded / incomplete' : 'not recorded'} · field readiness: {String(optimization.fieldReadiness ?? 'UNKNOWN')} · global optimality: {optimization.globalOptimalityClaimed === true ? 'claimed' : 'not claimed'}.</p>{optimization.fieldReadinessReason ? <p className="mt-1 text-xs text-amber-900">Financial readiness: {String(optimization.fieldReadinessReason)}</p> : null}{optimization.fieldScenarioSetSha256 ? <details className="mt-2 rounded border border-slate-200 p-2"><summary className="cursor-pointer text-xs font-bold">Joint scenario provenance</summary><p className="mt-1 break-all font-mono text-[10px] text-slate-600">Field dataset: {String(optimization.fieldScenarioDatasetSha256 ?? 'Unavailable')} · scenario set: {String(optimization.fieldScenarioSetSha256)} · seed: {String(optimization.fieldScenarioSeed)} · simulation: {String(optimization.fieldScenarioSimulationVersion)} · as of: {formatDate(String(optimization.fieldScenarioAsOf ?? ''))} · rules: {String(optimization.fieldScenarioRulesHash)}</p></details> : null}{warnings.length ? <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-900">{warnings.map((warning, index) => <li key={index}>{String(warning)}</li>)}</ul> : null}</section>;
}

function LineupLegalityCard({ lineups }: { lineups: RecordValue[] }) {
  if (!lineups.length) return null;
  const checked = lineups.filter((row) => recordOf(row.lineup_payload)?.independentExportValidation && recordOf(recordOf(row.lineup_payload)?.independentExportValidation)?.status === 'PASSED');
  const versions = [...new Set(checked.map((row) => String(recordOf(recordOf(row.lineup_payload)?.independentExportValidation)?.validatorVersion ?? 'unknown')))];
  return <section className="rounded-xl border border-slate-200 bg-white p-4" aria-label="Independent lineup legality validation"><h2 className="!text-sm font-black uppercase tracking-wide text-[#0b1f3a]">Independent roster legality</h2><p className="mt-2 text-sm">{checked.length} of {lineups.length} saved lineups have a recorded passing export-validation check{versions.length ? ` · ${versions.join(', ')}` : ''}.</p>{checked.length !== lineups.length ? <p className="mt-1 text-xs text-amber-900">Some lineups predate persisted validation status or lack a validation record. Review the current contest snapshot before entry.</p> : null}</section>;
}

function RunLineageCard({ lineage, artifacts, revisions }: { lineage: RecordValue; artifacts: RecordValue[]; revisions: RecordValue[] }) {
  const checksums = recordOf(lineage.input_checksums) ?? {};
  return <section className="rounded-xl border border-cyan-200 bg-cyan-50 p-4"><h2 className="!text-sm font-black uppercase tracking-wide text-cyan-950">Point-in-time run lineage</h2><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Slate / contest" value={`${String(lineage.slate_id ?? '—')} / ${String(lineage.contest_id ?? '—')}`} /><Metric label="Event cutoff" value={formatDate(String(lineage.event_cutoff ?? ''))} /><Metric label="Knowledge cutoff" value={formatDate(String(lineage.knowledge_cutoff ?? ''))} /><Metric label="Random seed" value={String(lineage.random_seed ?? 'Not recorded')} /></div><div className="mt-3 grid gap-2 text-xs sm:grid-cols-2"><p>Baseline: <strong>{String(lineage.baseline_model_version ?? '—')}</strong></p><p>House: <strong>{String(lineage.house_model_version ?? 'Not recorded')}</strong></p><p>Simulation: <strong>{String(lineage.simulation_version ?? 'Not recorded')}</strong></p><p>Optimizer: <strong>{String(lineage.optimizer_version ?? '—')}</strong></p><p>Field model: <strong>{String(lineage.field_model_version ?? 'Not recorded')}</strong></p><p>Snapshot: <strong>{String(lineage.intel_snapshot_id ?? 'Not recorded')}</strong></p></div><details className="mt-3 rounded-md border border-cyan-200 bg-white p-2"><summary className="cursor-pointer text-[10px] font-black uppercase tracking-wide text-cyan-900">Input checksums · {Object.keys(checksums).length}</summary><ul className="mt-2 space-y-1 font-mono text-[10px] text-slate-600">{Object.entries(checksums).map(([name, value]) => <li key={name} className="break-all">{name}: {String(value)}</li>)}</ul></details><div className="mt-3 grid gap-3 md:grid-cols-2">{artifacts.map((artifact) => <div key={String(artifact.id)} className="rounded-md border border-cyan-100 bg-white p-3"><p className="text-xs font-black">{String(artifact.artifact_type)} projection · {String(artifact.model_version)}</p><p className="mt-1 text-[11px] text-slate-600">Adjustment reason: {artifact.adjustment_reason == null ? 'No adjustment reason recorded' : JSON.stringify(artifact.adjustment_reason)}</p><p className="mt-1 break-all text-[10px] text-slate-500">Evidence IDs: {Array.isArray(artifact.evidence_ids) && artifact.evidence_ids.length ? artifact.evidence_ids.map(String).join(', ') : 'None recorded'}</p></div>)}</div>{revisions.length ? <div className="mt-3"><p className="text-[10px] font-black uppercase tracking-wide text-cyan-900">Lineup revisions</p><div className="mt-1 space-y-1">{revisions.map((revision) => <div key={String(revision.id)} className="rounded bg-white px-2 py-1 text-[10px] text-slate-700"><span className="font-bold">{String(revision.id)}</span> · revision {String(revision.revision)} · {String(revision.state)} · {formatDate(String(revision.generated_at ?? ''))} · roster {JSON.stringify(revision.slot_assignments ?? {})}</div>)}</div></div> : <p className="mt-3 text-[11px] text-slate-600">No lineup revision rows are associated with this run.</p>}</section>;
}

function GeneratedLineups({ lineups, run, stages, traces, onEntered }: { lineups: RecordValue[]; run?: RecordValue; stages: RecordValue[]; traces: RecordValue[]; onEntered: () => Promise<void> }) {
  const [entryIds, setEntryIds] = useState<Record<string, string>>({});
  const [savingEntry, setSavingEntry] = useState<string | null>(null);
  const [entryErrors, setEntryErrors] = useState<Record<string, string>>({});
  const [enteredIds, setEnteredIds] = useState<Set<string>>(() => new Set(lineups.filter((row) => String(row.status).toUpperCase() === 'ENTERED').map((row) => String(row.id))));
  const players = playerMap(run, stages);
  const exposures = new Map<string, number>();
  for (const row of lineups) { const payload = recordOf(row.lineup_payload); for (const playerId of new Set(Array.isArray(payload?.playerIds) ? payload.playerIds.map(String) : [])) exposures.set(playerId, (exposures.get(playerId) ?? 0) + 1); }
  async function markEntered(row: RecordValue) { const id = String(row.id ?? ''); if (!id || savingEntry) return; setSavingEntry(id); setEntryErrors((current) => { const next = { ...current }; delete next[id]; return next; }); try { await floydRequest(`/api/lineups/${encodeURIComponent(id)}/entered`, { method: 'POST', body: JSON.stringify({ externalEntryId: entryIds[id] ?? '' }) }); setEnteredIds((current) => new Set(current).add(id)); await onEntered(); } catch (reason) { setEntryErrors((current) => ({ ...current, [id]: reason instanceof Error ? reason.message : 'Unable to record entry status.' })); } finally { setSavingEntry(null); } }
  return <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[var(--shadow-subtle)]"><div className="flex items-center justify-between gap-3"><h2 className="!text-sm font-black uppercase tracking-wide text-[#0b1f3a]">Lineup portfolio</h2><span className="text-[10px] font-black uppercase tracking-wide text-slate-500">{lineups.length} selected</span></div>{lineups.length ? <><details className="mt-3 rounded border border-slate-200 bg-slate-50 p-2"><summary className="cursor-pointer text-xs font-bold">Portfolio player exposures</summary><div className="mt-2 flex flex-wrap gap-2">{[...exposures.entries()].sort((a,b) => b[1] - a[1]).map(([playerId, count]) => <span key={playerId} className="rounded bg-white px-2 py-1 text-[10px]">{players.get(playerId)?.name ?? playerId}: {count}/{lineups.length} ({Math.round(count / lineups.length * 100)}%)</span>)}</div></details><div className="mt-3 grid gap-3 lg:grid-cols-2">{lineups.map((row, index) => { const payload = recordOf(row.lineup_payload) ?? {}; const playerIds = Array.isArray(payload.playerIds) ? payload.playerIds.map(String) : []; const slots = recordOf(payload.rosterSlots) ?? {}; const expectedPoints = Number(payload.expectedPoints); const traceRow = traces.find((item) => String(item.lineup_candidate_key) === String(row.candidate_key)); const trace = recordOf(traceRow?.trace_payload); const evidence = Array.isArray(trace?.recommendationEvidence) ? trace.recommendationEvidence as RecordValue[] : []; const id = String(row.id ?? ''); const entered = enteredIds.has(id); return <div key={id || index} className="rounded-lg border border-slate-200 bg-slate-50 p-3">{row.recheck_required === true && <p role="alert" className="mb-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs font-bold text-amber-950">Recheck required before contest lock. This saved lineup is unchanged; review current injury and roster evidence before replacing it.</p>}<div className="flex items-center justify-between gap-2"><p className="text-xs font-black text-[#0b1f3a]">Lineup #{String(payload.bulletNumber ?? row.bullet_number ?? index + 1)}</p><p className="text-xs font-black text-cyan-800">{Number.isFinite(expectedPoints) ? `${formatNumber(expectedPoints)} mean · ${formatNumber(payload.median)} median` : `${formatNumber(payload.median)} median`}</p></div><div className="mt-2 space-y-1">{playerIds.map((playerId) => { const slot = Object.entries(slots).find(([, value]) => String(value) === playerId)?.[0] ?? 'PLAYER'; const player = players.get(playerId); return <div key={`${playerId}-${slot}`} className="flex items-center justify-between gap-2 text-[11px] text-slate-600"><span className="font-black uppercase text-slate-400">{slot}</span><span className="min-w-0 truncate text-right font-bold text-[#0b1f3a]">{player?.name ?? `Player ${playerId}`}{player?.team ? ` · ${player.team}` : ''}</span></div>; })}</div><div className="mt-3 grid grid-cols-2 gap-2"><Metric label="Salary" value={formatMoney(payload.salaryUsed)} /><Metric label="Status" value={entered ? 'ENTERED' : String(row.status ?? 'GENERATED')} /></div>{evidence.length ? <details className="mt-3 rounded-md border border-slate-200 bg-white p-2"><summary className="cursor-pointer text-[10px] font-black uppercase tracking-wide text-slate-600">Why selected · {evidence.length} linked findings</summary><div className="mt-2 space-y-2">{evidence.map((item, evidenceIndex) => <div key={`${String(item.playerId)}-${evidenceIndex}`} className="border-t border-slate-100 pt-2 text-[11px] text-slate-700"><p className="font-bold">{String(item.finding ?? 'Evidence')} <span className="text-slate-400">· {String(item.confidence ?? 'UNKNOWN')}</span></p><p className="mt-0.5 text-slate-500">{String(item.source ?? 'Unknown source')} · retrieved {String(item.retrievedAt ?? 'time unavailable')}</p>{item.url ? <a className="mt-0.5 inline-block break-all text-cyan-700 underline" href={String(item.url)} target="_blank" rel="noreferrer">Open source</a> : null}{Array.isArray(item.projectionEffect) ? item.projectionEffect.map((effect, effectIndex) => <p key={effectIndex} className="mt-1 text-slate-600">Projection effect: {String((effect as RecordValue).direction)} {String((effect as RecordValue).magnitude)} · {String((effect as RecordValue).rationale)}</p>) : null}{item.uncertainty ? <p className="mt-1 font-bold text-amber-800">{String(item.uncertainty)}</p> : null}</div>)}</div></details> : <p className="mt-2 text-[10px] text-slate-500">No player-specific source finding was attached to this selection.</p>}<div className="mt-3 flex gap-2">{!entered ? <><input aria-label="DraftKings entry ID, optional" placeholder="Entry ID (optional)" value={entryIds[id] ?? ''} onChange={(event) => setEntryIds((current) => ({ ...current, [id]: event.target.value }))} className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-2 text-xs" /><button type="button" disabled={savingEntry === id} onClick={() => void markEntered(row)} className="rounded-md bg-[#0b1f3a] px-3 py-2 text-[10px] font-black uppercase text-white disabled:opacity-50">{savingEntry === id ? 'Saving…' : 'Mark entered'}</button></> : <p className="text-xs font-bold text-emerald-800">Entry confirmed in app{row.entered_at ? ` · ${formatDate(String(row.entered_at))}` : ''}</p>}</div>{entryErrors[id] ? <p role="alert" className="mt-2 text-xs text-rose-700">{entryErrors[id]}</p> : null}</div>; })}</div></> : <EmptyState text="No generated lineup was persisted for this run." />}</section>;
}

function RunTrustCard({ trust }: { trust: RecordValue }) {
  const missing = Array.isArray(trust.missingRequiredFacts) ? trust.missingRequiredFacts.map(String) : [];
  const reasons = Array.isArray(trust.releaseReasons) ? trust.releaseReasons.map(String) : [];
  const eligible = trust.entryEligible === true;
  return <section className="rounded-xl border border-amber-200 bg-amber-50 p-4"><h2 className="!text-sm font-black uppercase tracking-wide text-amber-950">Run confidence and data coverage</h2><div className="mt-3 grid gap-2 sm:grid-cols-3"><Metric label="Data tier" value={String(trust.dataTier ?? 'UNKNOWN')} /><Metric label="Model tier" value={String(trust.modelTier ?? 'UNKNOWN')} /><Metric label="Entry status" value={eligible ? 'ENTRY READY' : 'PROVISIONAL'} /></div><p className="mt-3 text-xs font-bold text-amber-950">Search: {String(trust.searchCompleteness ?? 'UNKNOWN')}. These tiers describe the evidence and model validation available for this run; they are not a win guarantee.</p>{reasons.length ? <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-950">{reasons.slice(0, 8).map((item, index) => <li key={index}>{item}</li>)}</ul> : null}{missing.length ? <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-950">{missing.slice(0, 8).map((item, index) => <li key={index}>{item}</li>)}</ul> : null}</section>;
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
