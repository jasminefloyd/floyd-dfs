import { useState } from 'react';
import { MIOS_FantasyScanner, type ScanParams } from '../components/MIOS_FantasyScanner';
import { LineupDisplay, type Lineup } from '../components/LineupDisplay';
import { LineupComparison } from '../components/LineupComparison';
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
            riskTolerance: params.riskTolerance,
            lineupMode: params.lineupMode
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
      if (warnings.length) {
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
    <div className="min-h-screen bg-gray-100 text-gray-900">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:gap-6 lg:py-6">
        <aside className="w-full lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] lg:w-[360px] lg:shrink-0 lg:overflow-y-auto">
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-[var(--shadow-medium)] sm:p-5">
            <MIOS_FantasyScanner
              onScan={handleScan}
              loading={phase !== 'idle'}
              onValidationError={(errors) => errors.forEach((validationError) => showToast(validationError, 'error'))}
            />
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          {error && (
            <div className="mb-4 rounded-lg border border-error/30 bg-error/10 p-4">
              <p className="text-error">{error}</p>
            </div>
          )}

          {phase === 'fetching' ? (
            <PlayerListSkeleton />
          ) : phase === 'generating' ? (
            <LineupSkeleton />
          ) : lineups.length > 0 ? (
            <div>
              <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4 shadow-[var(--shadow-subtle)] sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-green-600">Optimizer Board</p>
                    <h2 className="mt-1 text-2xl font-black text-gray-950 sm:text-3xl">Recommended Lineups</h2>
                    {manifest?.slate ? (
                      <p className="mt-2 text-sm text-gray-400">
                        {manifest.slate.slate_name} · {manifest.contest_date}
                        {manifest.game_id ? ` · Game ${manifest.game_id}` : ''}
                      </p>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <SummaryPill label="Lineups" value={String(lineups.length)} />
                    <SummaryPill label="Top FPTS" value={(lineups[0]?.simulation_ev ?? lineups[0]?.projected_points ?? 0).toFixed(1)} />
                    <SummaryPill label="Salary" value={`$${Math.round((lineups[0]?.salary_used ?? 0) / 1000)}k`} />
                  </div>
                </div>
              </div>
              <InjuryReport manifest={manifest} />
              {manifest?.data_warnings?.length ? (
                <div className="mb-4 rounded-md border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
                  {manifest.data_warnings.map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                </div>
              ) : null}
              <LineupComparison lineups={lineups} />
              <PivotSuggestions lineups={lineups} manifest={manifest} />
              <LineupDisplay lineups={lineups} manifest={manifest} onSaveLineup={() => showToast('Lineup saved!', 'success')} />
            </div>
          ) : (
            <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-gray-500">
              <p>{manifest ? 'No valid lineups could be generated with the collected roster.' : 'Select a sport, contest type, and DraftKings slate to run a DFS Scan.'}</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function SummaryPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-sm font-black text-gray-950">{value}</p>
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
      last_5_stats: { avg_fantasy_pts: p.last_5_avg_pts, trend: 'stable' }
    })),
    projected_points: lu.projected_points,
    salary_used: lu.salary_used,
    confidence_score: lu.confidence_score,
    simulation_ev: lu.simulation_ev,
    ceiling_score: lu.ceiling_score,
    floor_score: lu.floor_score,
    win_rate: lu.win_rate,
    top_10_rate: lu.top_10_rate,
    leverage_score: lu.leverage_score,
    ownership_sum: lu.ownership_sum,
    lineup_type: lu.lineup_type,
    narrative: lineupNarrative(lu, idx)
  }));
}

function lineupNarrative(lineup: DraftLineup, idx: number): string {
  const expectedFpts = lineup.simulation_ev !== undefined ? lineup.simulation_ev : lineup.projected_points;
  const leverage = lineup.leverage_score !== undefined ? ` Secondary leverage score: ${lineup.leverage_score.toFixed(1)}.` : '';
  return `Lineup #${idx + 1} ranked by ${expectedFpts.toFixed(1)} expected total FPTS, ${(lineup.confidence_score * 100).toFixed(0)}% confidence, and $${lineup.salary_used.toLocaleString()} salary used.${leverage}`;
}
