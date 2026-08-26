import { useEffect, useState } from 'react';
import { MIOS_FantasyScanner, type ScanParams } from '../components/MIOS_FantasyScanner';
import { LineupDisplay, type Lineup } from '../components/LineupDisplay';
import { PlayerListSkeleton, LineupSkeleton } from '../components/Skeleton';
import { useToast } from '../hooks/useToast';
import type { MIOS_FantasyManifest } from '../lib/MIOS_FantasyAgents';
import { generateFloydLineups, markFloydLineupEntered, SCAN_STAGE_LABELS, SCAN_STAGE_ORDER, type ScanProgressStage } from '../lib/floydDfsClient';
import { ReasoningPresentation } from '../components/ReasoningPresentation';

type ScanPhase = 'idle' | 'fetching' | 'generating';

function currentStageLabel(stages: ScanProgressStage[]): string {
  const byName = new Map(stages.map((stage) => [stage.stage.toUpperCase(), stage.status.toUpperCase()]));
  const completeStatuses = ['COMPLETE', 'READY', 'SUCCEEDED', 'VALID'];
  let active: string | null = null;
  for (const stage of SCAN_STAGE_ORDER) {
    const status = byName.get(stage);
    if (!status) continue;
    active = stage;
    if (!completeStatuses.includes(status)) break;
  }
  return active ? SCAN_STAGE_LABELS[active as keyof typeof SCAN_STAGE_LABELS] : 'Starting scan';
}

export default function ScanPage() {
  const [phase, setPhase] = useState<ScanPhase>('idle');
  const [manifest, setManifest] = useState<MIOS_FantasyManifest | null>(null);
  const [lineups, setLineups] = useState<Lineup[]>([]);
  const [dataWarnings, setDataWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progressStages, setProgressStages] = useState<ScanProgressStage[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const { showToast } = useToast();

  useEffect(() => {
    if (phase === 'idle') return;
    const interval = window.setInterval(() => setElapsedSeconds((seconds) => seconds + 1), 1000);
    return () => window.clearInterval(interval);
  }, [phase]);

  const handleScan = async (params: ScanParams) => {
    setPhase('fetching'); setError(null); setManifest(null); setLineups([]); setDataWarnings([]); setProgressStages([]); setElapsedSeconds(0);
    try {
      const result = await generateFloydLineups({ sport: params.sport, contestType: params.contestType, contest: params.slate, entries: params.entryCount, fieldSize: params.fieldSize, lineupMode: params.lineupMode, minSalaryUsed: params.minSalaryUsed }, setProgressStages);
      setPhase('generating'); setManifest(result.manifest); setLineups(result.lineups); setDataWarnings(result.data_warnings);
      if (result.data_warnings.length) showToast('Scan completed with data warnings', 'warning');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message); showToast('Failed to generate lineups', 'error'); console.error('Floyd DFS generation error:', err);
    } finally { setPhase('idle'); }
  };
  const scanStatusLabel = phase === 'idle' ? undefined : `${currentStageLabel(progressStages)}... (${elapsedSeconds}s)`;

  const onSave = async (lineup: Lineup) => {
    if (!lineup.id) { showToast(`Lineup #${lineup.rank} is already persisted with this run.`, 'success'); return; }
    try { await markFloydLineupEntered(lineup.id); showToast(`Lineup #${lineup.rank} marked entered.`, 'success'); }
    catch (err) { showToast(err instanceof Error ? err.message : 'Unable to mark lineup entered.', 'error'); }
  };
  return <div className="min-h-screen bg-[#f4f7fb] text-slate-900"><div className="mx-auto flex max-w-7xl flex-col gap-3 px-3 py-3 sm:px-5 lg:grid lg:grid-cols-[380px_minmax(0,1fr)] lg:gap-5 lg:py-5"><aside className="w-full lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] lg:overflow-y-auto"><div className="rounded-lg border border-slate-200 bg-white p-3 shadow-[var(--shadow-medium)] sm:p-4"><MIOS_FantasyScanner onScan={handleScan} loading={phase !== 'idle'} loadingLabel={scanStatusLabel} onValidationError={(errors) => errors.forEach((item) => showToast(item, 'error'))} /></div></aside><main className="min-w-0 flex-1">{error && <div className="mb-3 rounded-lg border border-error/25 bg-red-50 p-3"><p className="text-error">{error}</p></div>}{phase === 'fetching' ? <PlayerListSkeleton /> : phase === 'generating' ? <LineupSkeleton /> : lineups.length ? <Results manifest={manifest} lineups={lineups} warnings={dataWarnings} onSave={onSave} /> : <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-slate-500 shadow-[var(--shadow-subtle)]"><p>{manifest ? 'No lineups were returned for this verified slate.' : 'Select a sport, contest type, and DraftKings slate to build lineups.'}</p>{dataWarnings.length ? <ul className="mx-auto mt-4 max-w-2xl space-y-2 text-left text-sm">{dataWarnings.map((warning) => <li key={warning} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">{warning}</li>)}</ul> : null}</div>}</main></div></div>;
}

function Results({ manifest, lineups, warnings, onSave }: { manifest: MIOS_FantasyManifest | null; lineups: Lineup[]; warnings: string[]; onSave: (lineup: Lineup) => void | Promise<void> }) {
  const definiteFlags = manifest?.player_roster.filter((player) => !['active', 'unknown'].includes(player.injury_status)).length ?? 0;
  return <div className="space-y-3"><div className="sticky top-0 z-10 overflow-hidden rounded-2xl border border-[#16385f] bg-[#0b1f3a]/[.98] p-3.5 shadow-[var(--shadow-medium)] backdrop-blur sm:p-4 lg:static"><div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between"><div className="min-w-0 flex-1"><p className="text-[10px] font-black uppercase tracking-[0.12em] text-cyan-300">Recommended Lineups</p><h2 className="!text-white mt-0.5 truncate text-lg font-black sm:text-xl">{manifest?.slate?.slate_name ?? 'Optimizer Board'}</h2><p className="mt-0.5 text-xs font-medium text-blue-200">{manifest?.contest_date ?? 'Current slate'} · Floyd DFS agentic pipeline</p></div><div className="grid w-full shrink-0 grid-cols-2 gap-1.5 text-center sm:grid-cols-5 xl:w-[360px]"><SummaryPill label="Lineups" value={String(lineups.length)} /><SummaryPill label="Top EV" value={(lineups[0]?.simulation_ev ?? lineups[0]?.projected_points ?? 0).toFixed(1)} /><SummaryPill label="Salary" value={`$${Math.round((lineups[0]?.salary_used ?? 0) / 1000)}k`} /><SummaryPill label="Flags" value={String(definiteFlags)} /><SummaryPill label="Data" value={warnings.length ? `${warnings.length} warn` : 'ok'} tone={warnings.length ? 'warn' : 'neutral'} /></div></div></div><div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start"><div className="min-w-0"><LineupDisplay manifest={manifest} lineups={lineups} onSaveLineup={onSave} /></div><aside className="hidden space-y-3 xl:sticky xl:top-5 xl:block xl:max-h-[calc(100vh-2.5rem)] xl:overflow-y-auto"><ScanDiagnostics manifest={manifest} lineups={lineups} /></aside></div><details className="rounded-lg border border-slate-200 bg-white shadow-[var(--shadow-subtle)] xl:hidden"><summary className="cursor-pointer list-none px-3 py-3 text-sm font-black text-[#0b1f3a]">Scan Details</summary><div className="border-t border-slate-200 p-3"><ScanDiagnostics manifest={manifest} lineups={lineups} /></div></details></div>;
}

function SummaryPill({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'warn' }) { return <div className={`rounded-lg border px-2 py-2 ${tone === 'warn' ? 'border-amber-300/60 bg-amber-300/15' : 'border-white/10 bg-white/[.08]'}`}><p className={`text-[9px] font-black uppercase tracking-[0.08em] ${tone === 'warn' ? 'text-amber-200' : 'text-blue-200'}`}>{label}</p><p className="text-sm font-black text-white">{value}</p></div>; }

function ScanDiagnostics({ manifest, lineups }: { manifest: MIOS_FantasyManifest | null; lineups: Lineup[] }) { return <ReasoningPresentation manifest={manifest} lineups={lineups} />; }
