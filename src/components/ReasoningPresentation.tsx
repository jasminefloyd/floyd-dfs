import type { MIOS_FantasyManifest } from '../lib/MIOS_FantasyAgents';
import type { Lineup } from './LineupDisplay';

interface Props { manifest: MIOS_FantasyManifest | null; lineups: Lineup[]; }
type RecordValue = Record<string, unknown>;

export function ReasoningPresentation({ manifest, lineups }: Props) {
  const pipeline = manifest?.floyd_pipeline;
  const research = pipeline?.research;
  const adjustment = pipeline?.adjustment;
  const projection = pipeline?.projection;
  const optimizer = pipeline?.optimizer;
  const selection = pipeline?.selection;
  if (!manifest || !pipeline) return null;
  const findings = arrayOf(research?.findings);
  const primary = lineups[0];
  const relevantFindings = findings.filter((finding) => isRelevantFinding(finding, manifest, primary));
  const unknowns = arrayOf(research?.unknowns);
  const adjustmentRows = arrayOf(adjustment?.adjustments);
  const projectionRows = arrayOf(projection?.players);
  const selectedLineups = arrayOf(selection?.selectedLineups);
  const objective = recordOf(optimizer?.objectiveProfile);
  const playerNames = new Map((manifest.player_roster ?? []).map((player) => [player.id, player.name]));
  const actionableAdjustments = adjustmentRows.filter((row) => String(row.netOpportunityDirection ?? 'NEUTRAL') !== 'NEUTRAL' || arrayOf(row.adjustments).some((item) => String(item.magnitude ?? 'NONE') !== 'NONE'));
  const selectedProjectionRows = selectedPlayerRows(primary, projectionRows);

  return <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-[var(--shadow-subtle)] sm:p-4" aria-label="Floyd DFS reasoning">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">Why this lineup</p><h3 className="mt-1 text-base font-black text-[#0b1f3a]">Floyd DFS agent evidence</h3><p className="mt-1 text-xs leading-5 text-slate-600">{primary?.narrative ?? 'Selection explanation unavailable.'}</p></div><span className="shrink-0 rounded-full border border-cyan-200 bg-cyan-50 px-2 py-1 text-[10px] font-black text-cyan-800">{pipeline.completedCount}/{pipeline.totalCount} stages</span></div>
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3"><Summary label="Median" value={primary ? `${primary.projected_points.toFixed(1)} pts` : '—'} /><Summary label="Evidence" value={`${relevantFindings.length} relevant`} /><Summary label="Players evaluated" value={String((manifest.player_roster ?? []).length)} /></div>
    <div className="mt-3 space-y-2">
      <details open><summary className="cursor-pointer text-xs font-black text-[#0b1f3a]">Floyd stages</summary><div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">{pipeline.stages.map((stage) => <div key={`${stage.stage}-${stage.version ?? ''}`} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-2"><p className="truncate text-[10px] font-black uppercase text-slate-500">{stage.stage.replaceAll('_', ' ')}</p><p className={`mt-0.5 text-[11px] font-bold ${stage.status.toUpperCase() === 'COMPLETE' ? 'text-emerald-700' : 'text-amber-700'}`}>{stage.status}</p></div>)}</div></details>
      <details><summary className="cursor-pointer text-xs font-black text-slate-600">Research evidence · {relevantFindings.length} relevant</summary><div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto pr-1">{relevantFindings.slice(0, 6).map((finding, index) => <div key={String(finding.id ?? index)} className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-[11px] leading-4 text-slate-600"><p className="font-black text-[#0b1f3a]">{String(finding.sourceName ?? 'Research source')} · {String(finding.bucket ?? 'evidence').replaceAll('_', ' ')}</p><p className="mt-0.5">{String(finding.finding ?? 'Finding unavailable.')}</p><p className="mt-1 text-[10px] text-slate-400">{finding.confidence ? `${String(finding.confidence)} confidence` : ''}{finding.ageMinutes != null ? ` · ${String(finding.ageMinutes)}m old` : ''}</p></div>)}{!relevantFindings.length ? <p className="text-[11px] text-slate-500">No evidence tied to this slate or selected lineup was returned.</p> : null}</div></details>
      <details><summary className="cursor-pointer text-xs font-black text-slate-600">Sport adjustment · {actionableAdjustments.length} actionable</summary><div className="mt-2 space-y-1.5">{actionableAdjustments.slice(0, 6).map((row, index) => <div key={String(row.playerId ?? index)} className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-600"><p className="font-black text-[#0b1f3a]">{playerNames.get(String(row.playerId)) ?? `Player ${String(row.playerId ?? '')}`} · {String(row.netOpportunityDirection ?? 'NEUTRAL').replaceAll('_', ' ')}</p><p>{joinStrings(row.keyDeltas) || joinStrings(row.projectionNotes) || adjustmentRationale(row.adjustments) || 'No adjustment rationale returned.'}</p></div>)}{!actionableAdjustments.length ? <p className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-[11px] leading-4 text-slate-600">No player-specific opportunity adjustment was asserted for this slate. Neutral records are omitted.</p> : null}</div></details>
      <details><summary className="cursor-pointer text-xs font-black text-slate-600">Projection · {selectedProjectionRows.length} selected players</summary><div className="mt-2 space-y-1.5">{selectedProjectionRows.map((row) => { const outcomes = recordOf(row.projectedOutcomes); return <div key={String(row.playerId)} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-[11px]"><span className="min-w-0 truncate font-black text-[#0b1f3a]">{playerNames.get(String(row.playerId)) ?? `Player ${String(row.playerId)}`}</span><span className="shrink-0 text-right text-slate-600">P20 {number(outcomes?.floorP20)} · P50 {number(outcomes?.medianP50)} · P90 {number(outcomes?.ceilingP90)}</span></div>; })}</div></details>
      <details><summary className="cursor-pointer text-xs font-black text-slate-600">Optimize + selection</summary><div className="mt-2 space-y-1.5 text-[11px] leading-4 text-slate-600"><p>{objective ? `Objective: ${String(objective.name ?? 'verified optimizer profile')}.` : 'Optimizer objective profile unavailable.'}</p><p>{selectedLineups.length ? `Selection Agent returned ${selectedLineups.length} selected lineup${selectedLineups.length === 1 ? '' : 's'}.` : 'Selection output unavailable.'}</p></div></details>
      {(unknowns.length || manifest.data_warnings.length) ? <details><summary className="cursor-pointer text-xs font-black text-amber-800">Limitations · {unknowns.length + manifest.data_warnings.length}</summary><div className="mt-2 space-y-1 text-[11px] leading-4 text-amber-900">{manifest.data_warnings.slice(0, 3).map((item) => <p key={item}>• {item}</p>)}{unknowns.slice(0, 3).map((item, index) => <p key={index}>• {String(item.question ?? item.reason ?? 'Research unknown')}</p>)}</div></details> : null}
    </div>
  </section>;
}

function Summary({ label, value }: { label: string; value: string }) { return <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2"><p className="text-[9px] font-black uppercase tracking-wide text-slate-500">{label}</p><p className="mt-0.5 text-sm font-black text-[#0b1f3a]">{value}</p></div>; }
function arrayOf(value: unknown): RecordValue[] { return Array.isArray(value) ? value.filter((item): item is RecordValue => Boolean(item) && typeof item === 'object') : []; }
function recordOf(value: unknown): RecordValue | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : undefined; }
function joinStrings(value: unknown): string { return Array.isArray(value) ? value.map(String).slice(0, 2).join(' · ') : ''; }
function adjustmentRationale(value: unknown): string { return arrayOf(value).map((item) => String(item.rationale ?? '')).filter(Boolean).slice(0, 2).join(' · '); }
function number(value: unknown): string { return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(1) : '—'; }
function selectedPlayerRows(lineup: Lineup | undefined, rows: RecordValue[]): RecordValue[] { const ids = new Set((lineup?.players ?? []).map((player) => player.id).filter(Boolean)); const selected = rows.filter((row) => ids.has(String(row.playerId))); return selected.length ? selected : rows.slice(0, 6); }
function isRelevantFinding(finding: RecordValue, manifest: MIOS_FantasyManifest, lineup?: Lineup): boolean {
  const selectedPlayerIds = new Set((lineup?.players ?? []).map((player) => player.id));
  if (selectedPlayerIds.has(String(finding.subjectId ?? ''))) return true;
  const terms = [...(manifest.slate?.game_ids ?? []), ...(lineup?.players ?? []).flatMap((player) => [player.name, player.team]), ...(manifest.slate?.slate_name ? [manifest.slate.slate_name] : [])]
    .map((term) => String(term).trim().toLowerCase()).filter((term) => term.length >= 3);
  const metadata = recordOf(finding.metadata);
  const text = `${String(finding.finding ?? '')} ${String(metadata?.title ?? '')}`.toLowerCase();
  return terms.some((term) => new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i').test(text));
}
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
