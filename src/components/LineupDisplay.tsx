import type { MIOS_FantasyManifest } from '../lib/MIOS_FantasyAgents';
import { generateCorrelationPairs, type CorrelationPair } from '../lib/correlationAgent';

export interface LineupPlayer {
  id?: string;
  name?: string;
  full_name?: string;
  position?: string;
  team?: string;
  nfl_team?: string;
  salary?: number;
  last_5_stats?: {
    avg_fantasy_pts?: number;
  };
}

export interface Lineup {
  rank: number;
  players: LineupPlayer[];
  projected_points: number;
  salary_used: number;
  confidence_score: number;
  narrative: string;
}

interface LineupDisplayProps {
  lineups: Lineup[];
  manifest: MIOS_FantasyManifest | null;
  onSaveLineup?: (lineup: Lineup) => void;
}

function playerName(id: string, manifest: MIOS_FantasyManifest | null): string {
  return manifest?.player_roster.find((p) => p.id === id)?.name ?? id;
}

function lineupContainsPair(lineup: Lineup, pair: CorrelationPair): boolean {
  const ids = new Set(lineup.players.map((p) => p.id).filter(Boolean));
  return ids.has(pair.player1_id) && ids.has(pair.player2_id);
}

export function LineupDisplay({ lineups, manifest, onSaveLineup }: LineupDisplayProps) {
  const topStacks: CorrelationPair[] = manifest
    ? generateCorrelationPairs(manifest.player_roster, manifest.sport)
        .filter((p) => p.correlation_score > 0.6)
        .slice(0, 3)
    : [];

  return (
    <div className="space-y-6">
      {topStacks.length > 0 && (
        <div className="bg-primary/10 border border-primary/30 rounded-lg p-4">
          <h3 className="text-[13px] font-bold text-primary mb-2">Recommended Stack</h3>
          <ul className="space-y-1">
            {topStacks.map((pair) => (
              <li key={`${pair.player1_id}-${pair.player2_id}`} className="text-[13px] text-primary">
                Stack {playerName(pair.player1_id, manifest)} + {playerName(pair.player2_id, manifest)} (
                {pair.correlation_score.toFixed(2)} correlation)
              </li>
            ))}
          </ul>
        </div>
      )}

      {lineups.map((lineup) => {
        const matchedStacks = topStacks.filter((pair) => lineupContainsPair(lineup, pair));
        const highlightedIds = new Set(
          matchedStacks.flatMap((pair) => [pair.player1_id, pair.player2_id])
        );

        return (
          <div key={lineup.rank} className="bg-white rounded-lg border border-gray-200 p-6">
            {/* Header */}
            <div className="flex flex-wrap justify-between items-center gap-x-4 gap-y-2 mb-4">
              <div>
                <h3 className="text-lg font-bold">Lineup #{lineup.rank}</h3>
                <p className="text-[13px] text-gray-600">
                  Confidence: {(lineup.confidence_score * 100).toFixed(0)}%
                </p>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-primary">
                  {lineup.projected_points.toFixed(1)} pts
                </div>
                <div className="text-[13px] text-gray-600">
                  ${(lineup.salary_used / 1000).toFixed(1)}k / $50k
                </div>
              </div>
            </div>

            {/* Narrative */}
            <p className="text-[13px] text-gray-700 mb-4 italic">{lineup.narrative}</p>

            {matchedStacks.length > 0 && (
              <p className="text-[13px] text-success font-medium mb-4">
                🔥 Contains recommended stack:{' '}
                {matchedStacks
                  .map((pair) => `${playerName(pair.player1_id, manifest)} + ${playerName(pair.player2_id, manifest)}`)
                  .join(', ')}
              </p>
            )}

            {/* Player List */}
            <div className="space-y-2">
              {lineup.players.map((player, idx) => {
                const isHighlighted = !!player.id && highlightedIds.has(player.id);
                return (
                  <div
                    key={idx}
                    className={`flex flex-wrap justify-between items-center gap-x-4 gap-y-1 p-3 rounded ${
                      isHighlighted ? 'bg-success/10 ring-1 ring-success/40' : 'bg-gray-50'
                    }`}
                  >
                    <div>
                      <p className="text-base font-medium">{player.name || player.full_name}</p>
                      <p className="text-[13px] text-gray-600">
                        {player.position} • {player.team || player.nfl_team}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold">${player.salary ?? '—'}</p>
                      <p className="text-[13px] text-gray-600">
                        {player.last_5_stats?.avg_fantasy_pts?.toFixed(1) ?? '—'} avg
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Action Buttons */}
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => onSaveLineup?.(lineup)}
                className="flex-1 bg-success hover:bg-success/90 text-white py-2 rounded font-semibold transition-colors duration-[var(--transition-fast)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-success"
              >
                Save Lineup
              </button>
              <button className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-900 py-2 rounded font-semibold transition-colors duration-[var(--transition-fast)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-500">
                Copy to Clipboard
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
