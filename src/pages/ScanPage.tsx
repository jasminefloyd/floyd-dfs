import { useState } from 'react';
import { MIOS_FantasyScanner, type ScanParams } from '../components/MIOS_FantasyScanner';
import { LineupDisplay, type Lineup } from '../components/LineupDisplay';
import { PlayerListSkeleton, LineupSkeleton } from '../components/Skeleton';
import { useToast } from '../components/ToastProvider';
import type { MIOS_FantasyManifest, Player } from '../lib/MIOS_FantasyAgents';
import { generateLineups, type DraftLineup, type LineupPlayerDraft } from '../lib/PIOS_FantasyGenerator';

type ScanPhase = 'idle' | 'fetching' | 'generating';

export default function ScanPage() {
  const [phase, setPhase] = useState<ScanPhase>('idle');
  const [manifest, setManifest] = useState<MIOS_FantasyManifest | null>(null);
  const [lineups, setLineups] = useState<Lineup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  const handleScan = async (params: ScanParams) => {
    setPhase('fetching');
    setError(null);

    try {
      // Call MIOS_Fantasy orchestrator (server-side, avoids CORS on ESPN/Sleeper/Ergast)
      const query = new URLSearchParams({
        sport: params.sport,
        contestType: params.contestType,
        contestDate: params.contestDate,
        userId: 'temp-user-id' // TODO: Replace with actual user ID from auth
      });
      const response = await fetch(`/api/mios-fantasy/scan?${query.toString()}`);
      if (!response.ok) {
        throw new Error(`Scan failed: ${response.status}`);
      }
      const data: MIOS_FantasyManifest = await response.json();

      setManifest(data);
      setPhase('generating');

      // Generate real PIOS_Fantasy lineups
      const draftPlayers = mapToDraftPlayers(data.player_roster);
      const draftLineups = generateLineups(
        draftPlayers,
        params.sport,
        params.contestType,
        params.excludedPlayers,
        params.riskTolerance
      );
      setLineups(toDisplayLineups(draftLineups));
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
        <MIOS_FantasyScanner onScan={handleScan} loading={phase !== 'idle'} />
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
            <h2 className="text-3xl font-bold mb-6">Recommended Lineups</h2>
            <LineupDisplay lineups={lineups} manifest={manifest} onSaveLineup={() => showToast('Lineup saved!', 'success')} />
          </div>
        ) : (
          <div className="text-center text-gray-500 py-12">
            <p>Select sport, contest type, and date, then click Scan to get started.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// TEMPORARY mapping layer: no agent in the MIOS_Fantasy pipeline collects DraftKings
// salary or live per-player injury_status yet, so those are mocked here until a real
// salary/injury agent exists. Everything else is real data from the manifest.
function mapToDraftPlayers(players: Player[]): LineupPlayerDraft[] {
  return players.map((p, idx) => {
    const avgPts = p.last_5_stats?.avg_fantasy_pts ?? 0;
    return {
      name: p.name,
      team: p.team ?? '',
      position: p.position ?? '',
      salary: 3000 + Math.round(avgPts * 200) + (idx % 5) * 100, // MOCK
      player_id: p.id,
      confidence_score: p.last_5_stats?.confidence ?? 0.5,
      last_5_avg_pts: avgPts,
      injury_status: p.injury_status ?? 'active' // MOCK default
    };
  });
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
      last_5_stats: { avg_fantasy_pts: p.last_5_avg_pts }
    })),
    projected_points: lu.projected_points,
    salary_used: lu.salary_used,
    confidence_score: lu.confidence_score,
    // TEMP placeholder narrative; no narration agent has been built yet.
    narrative: `Confidence ${(lu.confidence_score * 100).toFixed(0)}% — $${lu.salary_used.toLocaleString()} salary used.`
  }));
}
