import type { MIOS_FantasyManifest } from '../lib/MIOS_FantasyAgents';
import { generateCorrelationPairs, type CorrelationPair } from '../lib/correlationAgent';
import { ExportLineup } from './ExportLineup';

export interface LineupPlayer {
  id?: string;
  name?: string;
  full_name?: string;
  position?: string;
  team?: string;
  nfl_team?: string;
  salary?: number;
  base_salary?: number;
  salary_multiplier?: number;
  roster_slot?: string;
  salary_source?: string;
  last_5_stats?: {
    avg_fantasy_pts?: number;
    trend?: 'up' | 'down' | 'stable';
  };
}

export interface Lineup {
  rank: number;
  players: LineupPlayer[];
  projected_points: number;
  salary_used: number;
  confidence_score: number;
  simulation_ev?: number;
  ceiling_score?: number;
  floor_score?: number;
  win_rate?: number;
  top_10_rate?: number;
  leverage_score?: number;
  ownership_sum?: number;
  lineup_type?: 'high_ev' | 'contrarian_tournament' | 'late_swap_candidate';
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
                {lineup.lineup_type ? (
                  <p className="mt-1 text-[12px] font-semibold uppercase tracking-wide text-primary">
                    {lineupTypeLabel(lineup.lineup_type)}
                  </p>
                ) : null}
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

            {(lineup.simulation_ev || lineup.ceiling_score || lineup.leverage_score) ? (
              <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
                <Metric label="Expected FPTS" value={lineup.simulation_ev?.toFixed(1) ?? '—'} />
                <Metric label="Ceiling" value={lineup.ceiling_score?.toFixed(1) ?? '—'} />
                <Metric label="Top 10" value={lineup.top_10_rate !== undefined ? `${(lineup.top_10_rate * 100).toFixed(1)}%` : '—'} />
                <Metric label="Leverage" value={lineup.leverage_score?.toFixed(1) ?? '—'} />
              </div>
            ) : null}

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
                const trend = player.last_5_stats?.trend ?? 'stable';
                const trendSymbol = trend === 'up' ? '↗' : trend === 'down' ? '↘' : '→';
                return (
                  <div
                    key={idx}
                    className={`flex flex-wrap justify-between items-center gap-x-4 gap-y-1 p-3 rounded ${
                      isHighlighted ? 'bg-success/10 ring-1 ring-success/40' : 'bg-gray-50'
                    }`}
                  >
                    <div>
                      <p className="text-base font-medium">
                        {player.roster_slot ? (
                          <span className="mr-2 rounded-sm bg-gray-900 px-1.5 py-0.5 text-[11px] font-bold text-white">
                            {player.roster_slot}
                          </span>
                        ) : null}
                        {player.name || player.full_name}
                      </p>
                      <p className="text-[13px] text-gray-600">
                        {player.position} • {player.team || player.nfl_team || 'FA'} • {trendSymbol}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold">{formatSalary(player.salary)}</p>
                      <p className="text-[13px] text-gray-600">
                        {player.last_5_stats?.avg_fantasy_pts?.toFixed(1) ?? '—'} avg
                        {player.salary_multiplier && player.salary_multiplier > 1
                          ? ` • ${player.salary_multiplier}x from ${formatSalary(player.base_salary)}`
                          : ''}
                        {player.salary_source === 'estimated' ? ' • est. salary' : ''}
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
              <div className="flex-[2]">
                <ExportLineup lineup={lineup} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatSalary(salary?: number): string {
  return salary === undefined ? '$—' : `$${salary.toLocaleString()}`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
      <p className="text-[11px] font-medium uppercase text-gray-500">{label}</p>
      <p className="text-sm font-bold text-gray-900">{value}</p>
    </div>
  );
}

function lineupTypeLabel(type: NonNullable<Lineup['lineup_type']>): string {
  if (type === 'contrarian_tournament') return 'Contrarian Tournament';
  if (type === 'late_swap_candidate') return 'Late Swap Candidate';
  return 'High EV';
}
