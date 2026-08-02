import { useState } from 'react';
import { MIOS_FantasyScanner, type ScanParams } from '../components/MIOS_FantasyScanner';
import { LineupDisplay, type Lineup } from '../components/LineupDisplay';
import { PivotSuggestions } from '../components/PivotSuggestions';
import { InjuryReport } from '../components/InjuryReport';
import { PlayerListSkeleton, LineupSkeleton } from '../components/Skeleton';
import { useToast } from '../hooks/useToast';
import type { MIOS_FantasyManifest } from '../lib/MIOS_FantasyAgents';
import type { DraftLineup } from '../lib/PIOS_FantasyGenerator';
import { useInjuryAlerts } from '../hooks/useInjuryAlerts';
import { invokeMiosFantasyScan } from '../lib/miosFunctionClient';
import { invokePiosLineupGeneration } from '../lib/piosFunctionClient';

type ScanPhase = 'idle' | 'fetching' | 'generating';

export default function ScanPage() {
  const [phase, setPhase] = useState<ScanPhase>('idle');
  const [manifest, setManifest] = useState<MIOS_FantasyManifest | null>(null);
  const [lineups, setLineups] = useState<Lineup[]>([]);
  const [dataWarnings, setDataWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  useInjuryAlerts(manifest?.player_roster ?? [], lineups.length > 0, (alert) => {
    showToast(alert.message, 'info');
  });

  const handleScan = async (params: ScanParams) => {
    setPhase('fetching');
    setError(null);
    setManifest(null);
    setLineups([]);
    setDataWarnings([]);

    try {
      const miosController = new AbortController();
      const miosTimeout = window.setTimeout(() => miosController.abort(), 90_000);
      let data: MIOS_FantasyManifest;
      try {
        data = await invokeMiosFantasyScan(params, miosController.signal);
      } finally {
        window.clearTimeout(miosTimeout);
      }

      setManifest(data);
      const miosWarnings = data.data_warnings ?? [];
      const blockingWarnings = blockingDataWarnings(miosWarnings, params.lineupMode);
      const trustBlocks = data.readiness?.hard_blocks ?? [];
      const tournamentBlocked = params.lineupMode !== 'safe'
        && params.lineupMode !== 'max_fpts'
        && data.readiness
        && !data.readiness.eligible_for_tournament;
      if (trustBlocks.length || tournamentBlocked || blockingWarnings.length) {
        setDataWarnings(miosWarnings);
        const reasons = [
          ...trustBlocks,
          ...(tournamentBlocked ? (data.readiness?.cautions ?? ['The scan is not tournament-ready.']) : []),
          ...blockingWarnings,
        ];
        throw new Error(`Lineup generation blocked: ${[...new Set(reasons)].join(' ')}`);
      }
      setPhase('generating');

      const piosController = new AbortController();
      const piosTimeout = window.setTimeout(() => piosController.abort(), 30_000);
      let piosResult;
      try {
        piosResult = await invokePiosLineupGeneration(
          {
            manifest: data,
            sport: params.sport,
            contestType: params.contestType,
            excludedPlayers: params.excludedPlayers,
            lockedPlayers: params.lockedPlayers,
            riskTolerance: params.riskTolerance,
            lineupMode: params.lineupMode,
            contestStrategy: params.contestStrategy,
            maxPlayerExposure: params.maxPlayerExposure,
            maxTeamExposure: params.maxTeamExposure,
            minPrimaryStack: params.minPrimaryStack,
            diversifyLineups: params.diversifyLineups,
            lateSwapMode: params.lateSwapMode,
            entryCount: params.entryCount,
            fieldSize: params.fieldSize,
            maxEntriesPerUser: params.maxEntriesPerUser,
            payoutShape: params.payoutShape,
            ownershipWeight: params.ownershipWeight,
            correlationWeight: params.correlationWeight,
            maxCaptainExposure: params.maxCaptainExposure,
            captainPool: params.captainPool,
            minPerTeam: params.minPerTeam,
            forceUniqueCaptains: params.forceUniqueCaptains,
            minSalaryUsed: params.minSalaryUsed,
            maxDuplication: params.maxDuplication,
            maxSharedPlayers: params.maxSharedPlayers,
            simulationIterations: params.simulationIterations,
            fieldSimulationSize: params.fieldSimulationSize,
            showDiagnostics: params.showDiagnostics
          },
          piosController.signal
        );
      } finally {
        window.clearTimeout(piosTimeout);
      }
      const displayLineups = toDisplayLineups(piosResult.lineups);
      setLineups(displayLineups);
      const warnings = [
        ...(data.data_warnings ?? []),
        ...(piosResult.data_warnings ?? [])
      ];
      setDataWarnings(warnings);
      if (actionableDataWarnings(warnings).length) {
        showToast('Scan completed with data warnings', 'warning');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      showToast('Failed to scan', 'error');
      console.error('Scan error:', err);
    } finally {
      setPhase('idle');
    }
  };

  return (
    <div className="min-h-screen bg-[#f4f7fb] text-slate-900">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-3 py-3 sm:px-5 lg:grid lg:grid-cols-[380px_minmax(0,1fr)] lg:gap-5 lg:py-5">
        <aside className="w-full lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] lg:overflow-y-auto">
          <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-[var(--shadow-medium)] sm:p-4">
            <MIOS_FantasyScanner
              onScan={handleScan}
              loading={phase !== 'idle'}
              onValidationError={(errors) => errors.forEach((validationError) => showToast(validationError, 'error'))}
            />
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          {error && (
            <div className="mb-3 rounded-lg border border-error/25 bg-red-50 p-3">
              <p className="text-error">{error}</p>
            </div>
          )}

          {phase === 'fetching' ? (
            <PlayerListSkeleton />
          ) : phase === 'generating' ? (
            <LineupSkeleton />
          ) : lineups.length > 0 ? (
            <div className="space-y-3">
              <div className="sticky top-0 z-10 rounded-lg border border-slate-200 bg-white/95 p-3 shadow-[var(--shadow-subtle)] backdrop-blur sm:p-4 lg:static lg:bg-white">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  <ResultTitle manifest={manifest} />
                  <ResultSummary lineups={lineups} manifest={manifest} warnings={dataWarnings} />
                </div>
              </div>

              <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start">
                <div className="min-w-0">
                    <LineupDisplay manifest={manifest} lineups={lineups} onSaveLineup={() => showToast('Lineup saved!', 'success')} />
                </div>

                <aside className="hidden space-y-3 xl:sticky xl:top-5 xl:block xl:max-h-[calc(100vh-2.5rem)] xl:overflow-y-auto">
                  <ScanDiagnostics
                    manifest={manifest}
                    lineups={lineups}
                  />
                </aside>
              </div>

              <details className="rounded-lg border border-slate-200 bg-white shadow-[var(--shadow-subtle)] xl:hidden">
                <summary className="cursor-pointer list-none px-3 py-3 text-sm font-black text-[#0b1f3a] marker:hidden">
                  <div className="flex items-center justify-between gap-3">
                    <span>Scan Details</span>
                    <span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-600">
                      {dataWarnings.length} warning{dataWarnings.length === 1 ? '' : 's'}
                    </span>
                  </div>
                </summary>
                <div className="border-t border-slate-200 p-3">
                  <ScanDiagnostics
                    manifest={manifest}
                    lineups={lineups}
                  />
                </div>
              </details>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-slate-500 shadow-[var(--shadow-subtle)]">
              <p>{manifest ? 'No valid lineups could be generated with the collected roster.' : 'Select a sport, contest type, and DraftKings slate to run a DFS Scan.'}</p>
              {manifest && actionableDataWarnings(dataWarnings).length > 0 && (
                <div className="mx-auto mt-4 max-w-2xl text-left">
                  <p className="text-xs font-black uppercase tracking-wide text-slate-500">Diagnostics</p>
                  <ul className="mt-2 space-y-2 text-sm text-slate-600">
                    {actionableDataWarnings(dataWarnings).map((warning) => (
                      <li key={warning} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                        {warning}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function ResultTitle({ manifest }: { manifest: MIOS_FantasyManifest | null }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-black uppercase tracking-wide text-cyan-700">Recommended Lineups</p>
      <h2 className="mt-0.5 truncate text-lg font-black text-[#0b1f3a] sm:text-xl">
        {manifest?.slate?.slate_name ?? 'Optimizer Board'}
      </h2>
      <p className="mt-0.5 truncate text-xs font-medium text-slate-500">
        {manifest?.contest_date ?? 'Current scan'}
        {manifest?.game_id ? ` · Game ${manifest.game_id}` : ''}
      </p>
    </div>
  );
}

function ResultSummary({ lineups, manifest, warnings }: { lineups: Lineup[]; manifest: MIOS_FantasyManifest | null; warnings: string[] }) {
  const topLineup = lineups[0];
  const injuries = manifest?.player_roster.filter((player) => player.injury_status !== 'active').length ?? 0;
  const sourceEntries = Object.entries(manifest?.source_status ?? {});
  const sourceProblems = sourceEntries.filter(([, status]) => status !== 'ok').length;
  const warningCount = actionableDataWarnings(warnings).length;
  const noteCount = routineDataNotes(warnings).length;

  return (
    <div className="grid grid-cols-3 gap-2 text-center sm:grid-cols-6 xl:min-w-[620px]">
      <SummaryPill label="Lineups" value={String(lineups.length)} />
      <SummaryPill label="Top EV" value={(topLineup?.simulation_ev ?? topLineup?.projected_points ?? 0).toFixed(1)} />
      <SummaryPill label="Salary" value={`$${Math.round((topLineup?.salary_used ?? 0) / 1000)}k`} />
      <SummaryPill label="Top Decile" value={topLineup?.top_decile_rate !== undefined ? `${(topLineup.top_decile_rate * 100).toFixed(0)}%` : topLineup?.top_10_rate !== undefined ? `${(topLineup.top_10_rate * 100).toFixed(0)}%` : '—'} />
      <SummaryPill label="Flags" value={String(injuries)} tone={injuries ? 'warn' : 'neutral'} />
      <SummaryPill
        label="Data"
        value={warningCount ? `${warningCount} warn` : noteCount ? `${noteCount} notes` : sourceProblems ? `${sourceProblems} gaps` : 'ok'}
        tone={warningCount ? 'warn' : 'neutral'}
      />
    </div>
  );
}

function ScanDiagnostics({
  manifest,
  lineups,
}: {
  manifest: MIOS_FantasyManifest | null;
  lineups: Lineup[];
}) {
  return (
    <div className="space-y-3">
      <TrustPanel manifest={manifest} />
      <InjuryReport manifest={manifest} />
      <PivotSuggestions lineups={lineups} manifest={manifest} />
    </div>
  );
}

function TrustPanel({ manifest }: { manifest: MIOS_FantasyManifest | null }) {
  if (!manifest) return null;
  const readiness = manifest.readiness;
  const sourceHealth = Object.entries(manifest.source_health ?? {});
  const statusStyles = readiness?.status === 'ready'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : readiness?.status === 'blocked'
      ? 'border-red-200 bg-red-50 text-red-800'
      : 'border-amber-200 bg-amber-50 text-amber-800';
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-[var(--shadow-subtle)]" aria-label="MIOS trust details">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">MIOS trust status</p>
          <p className="mt-1 text-sm font-black text-[#0b1f3a]">{readiness?.status === 'ready' ? 'Ready' : readiness?.status === 'blocked' ? 'Blocked' : 'Use with caution'}</p>
        </div>
        <span className={`rounded-md border px-2 py-1 text-[10px] font-black uppercase tracking-wide ${statusStyles}`}>
          {manifest.is_fallback ? 'Cached fallback' : `Model ${manifest.model_version ?? 'current'}`}
        </span>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-600">
        Confidence is projection reliability—not a probability of winning. It reflects data completeness, freshness, lineup certainty, and historical consistency.
      </p>
      {readiness?.hard_blocks?.length ? (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
          <p className="font-black">Generation limits</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">{readiness.hard_blocks.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      ) : null}
      {readiness?.cautions?.length ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          <p className="font-black">Cautions</p>
          <ul className="mt-1 max-h-32 list-disc space-y-1 overflow-y-auto pl-4">{readiness.cautions.slice(0, 5).map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      ) : null}
      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-black text-slate-600">View source coverage</summary>
        <div className="mt-2 space-y-1.5">
          {sourceHealth.map(([source, health]) => (
            <div key={source} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="truncate text-slate-600">{source.replaceAll('_', ' ')}</span>
              <span className={health.status === 'ok' ? 'font-bold text-emerald-700' : health.status === 'partial' ? 'font-bold text-amber-700' : 'font-bold text-red-700'}>
                {health.coverage ? `${health.coverage.percent}% · ` : ''}{health.status}{health.freshness_seconds !== null && health.freshness_seconds !== undefined ? ` · ${formatAge(health.freshness_seconds)}` : ''}
              </span>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}

function formatAge(seconds: number): string {
  if (seconds < 60) return '<1m';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function actionableDataWarnings(messages: string[]): string[] {
  return messages.filter((message) => !isRoutineDataNote(message));
}

function blockingDataWarnings(messages: string[], lineupMode: string): string[] {
  if (lineupMode === 'safe' || lineupMode === 'max_fpts') return [];
  return messages.filter((message) => (
    /confirmed-lineup data is .*hours old/i.test(message)
    || /Confirmed-lineup extraction returned zero rows/i.test(message)
    || /Ownership coverage is (?:0|[0-5]\d)%/i.test(message)
    || /Public ownership projections were unavailable/i.test(message)
  ));
}

function routineDataNotes(messages: string[]): string[] {
  return messages.filter(isRoutineDataNote);
}

function isRoutineDataNote(message: string): boolean {
  return [
    /^Public ownership projections were unavailable/i,
    /^The Odds API requests remaining/i,
    /^Sportsbook player props were unavailable/i,
    /^Verified free odds context is unavailable/i,
    /^Enriched \d+ of \d+ slate players/i,
    /^Opportunity model applied/i,
    /^Vegas implied-total context was unavailable/i,
    /^DraftKings salary rows did not include projected points/i,
    /^Projection calibration is not active yet/i,
    /^Projection calibration applied/i,
    /^Reddit public RSS signals were unavailable/i,
    /^Player-specific news signals were unavailable/i,
    /^Manifest persistence skipped/i,
    /^Applied /i,
    /^Confirmed MLB batting/i,
    /^Baseball Savant Statcast quality signals were unavailable/i,
    /^Free MLB schedule/i,
  ].some((pattern) => pattern.test(message));
}

function SummaryPill({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'warn' }) {
  return (
    <div className={`rounded-md border px-2 py-2 ${tone === 'warn' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
      <p className={`text-[10px] font-bold uppercase tracking-wide ${tone === 'warn' ? 'text-amber-700' : 'text-slate-500'}`}>{label}</p>
      <p className="text-sm font-black text-[#0b1f3a]">{value}</p>
    </div>
  );
}

function toDisplayLineups(draftLineups: DraftLineup[]): Lineup[] {
  return draftLineups.map((lu, idx) => ({
    rank: idx + 1,
    players: lu.players.map((p) => ({
      id: p.player_id,
      name: p.name,
      image_url: p.image_url,
      team_logo_url: p.team_logo_url,
      position: p.position,
      team: p.team,
      salary: p.salary,
      base_salary: p.base_salary,
      salary_multiplier: p.salary_multiplier,
      roster_slot: p.roster_slot,
      salary_source: p.salary_source,
      context_score: p.context_score,
      contextual_projection: p.contextual_projection,
      floor_projection: p.floor_projection,
      ceiling_projection: p.ceiling_projection,
      volatility_score: p.volatility_score,
      boom_probability: p.boom_probability,
      bust_probability: p.bust_probability,
      batting_order: p.batting_order,
      run_factor: p.run_factor,
      opponent_team: p.opponent_team,
      opposing_probable_pitcher_id: p.opposing_probable_pitcher_id,
      opposing_probable_pitcher_name: p.opposing_probable_pitcher_name,
      own_probable_starter: p.own_probable_starter,
      game_id: p.game_id,
      game_context_tags: p.game_context_tags,
      news_note: p.news_note,
      news_evidence: p.news_evidence,
      home_away: p.home_away,
      last_5_stats: {
        avg_fantasy_pts: p.last_5_avg_pts,
        stdev_fantasy_pts: p.stdev_fantasy_pts,
        games_sample_size: p.games_sample_size,
        minutes_stdev: p.minutes_stdev,
        trend: 'stable'
      }
    })),
    projected_points: lu.projected_points,
    salary_used: lu.salary_used,
    confidence_score: lu.confidence_score,
    simulation_ev: lu.simulation_ev,
    ceiling_score: lu.ceiling_score,
    floor_score: lu.floor_score,
    p99_score: lu.p99_score,
    win_rate: lu.win_rate,
    top_10_rate: lu.top_10_rate,
    top_decile_rate: lu.top_decile_rate,
    top_n_rate: lu.top_n_rate,
    expected_payout: lu.expected_payout,
    leverage_score: lu.leverage_score,
    ownership_sum: lu.ownership_sum,
    expected_duplicates: lu.expected_duplicates,
    lineup_type: lu.lineup_type,
    lineup_intelligence_score: lu.lineup_intelligence_score,
    stack_quality_score: lu.stack_quality_score,
    context_edge_score: lu.context_edge_score,
    volatility_score: lu.volatility_score,
    win_condition: lu.win_condition,
    primary_stack_team: lu.primary_stack_team,
    primary_stack_size: lu.primary_stack_size,
    anti_correlation_flags: lu.anti_correlation_flags,
    exposure_flags: lu.exposure_flags,
    portfolio_correlation_flags: lu.portfolio_correlation_flags,
    late_swap_flags: lu.late_swap_flags,
    strategy_notes: lu.strategy_notes,
    scenario_key: lu.scenario_key,
    scenario_confidence: lu.scenario_confidence,
    relationship_score: lu.relationship_score,
    evidence_summary: lu.evidence_summary,
    narrative: lineupNarrative(lu, idx)
  }));
}

function lineupNarrative(lineup: DraftLineup, idx: number): string {
  const expectedFpts = lineup.simulation_ev !== undefined ? lineup.simulation_ev : lineup.projected_points;
  const leverage = lineup.leverage_score !== undefined ? ` Secondary leverage score: ${lineup.leverage_score.toFixed(1)}.` : '';
  const intelligence = lineup.lineup_intelligence_score !== undefined ? ` PIOS intelligence score: ${lineup.lineup_intelligence_score.toFixed(1)}.` : '';
  return `Lineup #${idx + 1} ranked by ${expectedFpts.toFixed(1)} expected total FPTS, ${(lineup.confidence_score * 100).toFixed(0)}% projection reliability, and $${lineup.salary_used.toLocaleString()} salary used.${leverage}${intelligence}`;
}
