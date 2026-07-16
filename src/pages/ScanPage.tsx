import { useState } from 'react';
import { MIOS_FantasyScanner, type ScanParams } from '../components/MIOS_FantasyScanner';
import { LineupDisplay, type Lineup } from '../components/LineupDisplay';
import { LineupComparison } from '../components/LineupComparison';
import { PivotSuggestions } from '../components/PivotSuggestions';
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
            riskTolerance: params.riskTolerance
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
    <div className="flex flex-col sm:flex-row min-h-screen bg-gray-50">
      {/* Left sidebar: Scan settings */}
      <div className="w-full sm:w-1/4 lg:w-1/3 bg-white border-b sm:border-b-0 sm:border-r border-gray-200 p-6 overflow-y-auto">
        <MIOS_FantasyScanner
          onScan={handleScan}
          loading={phase !== 'idle'}
          onValidationError={(errors) => errors.forEach((validationError) => showToast(validationError, 'error'))}
        />
      </div>

      {/* Right: Results display */}
      <div className="w-full sm:w-3/4 lg:w-2/3 p-6 overflow-y-auto">
        {error && (
          <div className="bg-error/10 border border-error/30 p-4 rounded mb-4">
            <p className="text-error">{error}</p>
          </div>
        )}

        {phase === 'fetching' ? (
          <PlayerListSkeleton />
        ) : phase === 'generating' ? (
          <LineupSkeleton />
        ) : lineups.length > 0 ? (
          <div>
            <div className="mb-6">
              <h2 className="text-3xl font-bold">Recommended Lineups</h2>
              {manifest?.slate ? (
                <p className="mt-2 text-sm text-gray-600">
                  {manifest.slate.slate_name} · {manifest.contest_date}
                  {manifest.game_id ? ` · Game ${manifest.game_id}` : ''}
                </p>
              ) : null}
            </div>
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
          <div className="text-center text-gray-500 py-12">
            <p>{manifest ? 'No valid lineups could be generated with the collected roster.' : 'Select a sport, contest type, and imported DraftKings slate to run MIOS and PIOS.'}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function toDisplayLineups(draftLineups: DraftLineup[]): Lineup[] {
  return draftLineups.map((lu, idx) => ({
    rank: idx + 1,
    players: lu.players.map((p) => ({
      id: p.player_id,
      name: p.name,
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
  const ev = lineup.simulation_ev !== undefined ? `${lineup.simulation_ev.toFixed(1)} simulated EV` : `${lineup.projected_points.toFixed(1)} projected points`;
  const leverage = lineup.leverage_score !== undefined ? `, ${lineup.leverage_score.toFixed(1)} leverage` : '';
  return `Lineup #${idx + 1} ranked by ${ev}${leverage}, ${(lineup.confidence_score * 100).toFixed(0)}% confidence, and $${lineup.salary_used.toLocaleString()} salary used.`;
}
