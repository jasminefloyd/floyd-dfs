import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { MIOS_FantasyManifest } from '../lib/MIOS_FantasyAgents';
import { generateCorrelationPairs, type CorrelationPair } from '../lib/correlationAgent';
import { ExportLineup } from './ExportLineup';

export interface LineupPlayer {
  id?: string;
  name?: string;
  full_name?: string;
  image_url?: string;
  team_logo_url?: string;
  position?: string;
  team?: string;
  nfl_team?: string;
  salary?: number;
  base_salary?: number;
  salary_multiplier?: number;
  roster_slot?: string;
  salary_source?: string;
  news_note?: string;
  context_score?: number;
  contextual_projection?: number;
  floor_projection?: number;
  ceiling_projection?: number;
  volatility_score?: number;
  boom_probability?: number;
  bust_probability?: number;
  batting_order?: number;
  game_context_tags?: string[];
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
  lineup_intelligence_score?: number;
  stack_quality_score?: number;
  context_edge_score?: number;
  volatility_score?: number;
  win_condition?: string;
  primary_stack_team?: string;
  primary_stack_size?: number;
  anti_correlation_flags?: string[];
  exposure_flags?: string[];
  late_swap_flags?: string[];
  strategy_notes?: string[];
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
  const [expandedRanks, setExpandedRanks] = useState<Set<number>>(new Set());
  const topStacks: CorrelationPair[] = manifest
    ? generateCorrelationPairs(manifest.player_roster, manifest.sport)
        .filter((p) => p.correlation_score > 0.6)
        .slice(0, 3)
    : [];
  const toggleLineup = (rank: number) => {
    setExpandedRanks((current) => {
      const next = new Set(current);
      if (next.has(rank)) {
        next.delete(rank);
      } else {
        next.add(rank);
      }
      return next;
    });
  };

  return (
    <div className="space-y-3">
      {topStacks.length > 0 && (
        <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3">
          <h3 className="mb-2 text-[12px] font-black uppercase tracking-wide text-cyan-800">Recommended Stack</h3>
          <ul className="space-y-1">
            {topStacks.map((pair) => (
              <li key={`${pair.player1_id}-${pair.player2_id}`} className="text-[13px] font-medium text-slate-700">
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
        const isExpanded = expandedRanks.has(lineup.rank);
        const summaryId = `lineup-${lineup.rank}-summary`;
        const detailsId = `lineup-${lineup.rank}-details`;

        return (
          <div key={lineup.rank} className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[var(--shadow-medium)]">
            <button
              type="button"
              id={summaryId}
              aria-expanded={isExpanded}
              aria-controls={detailsId}
              onClick={() => toggleLineup(lineup.rank)}
              className="block w-full text-left transition-colors duration-[var(--transition-fast)] hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cyan-500"
            >
              {/* Header */}
              <div className="border-b border-slate-200 bg-slate-50 p-3 sm:p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-black uppercase tracking-wide text-cyan-700">Lineup #{lineup.rank}</p>
                    <h3 className="mt-1 truncate text-base font-black text-[#0b1f3a] sm:text-lg">{lineupTypeLabel(lineup.lineup_type ?? 'high_ev')}</h3>
                    <p className="mt-1 text-[12px] font-medium text-slate-500">
                      Confidence: {(lineup.confidence_score * 100).toFixed(0)}%
                    </p>
                  </div>
                  <div className="flex shrink-0 items-start gap-2 text-right">
                    <div>
                      <div className="text-2xl font-black text-[#0b1f3a] sm:text-3xl">
                        {lineup.projected_points.toFixed(1)} pts
                      </div>
                      <div className="text-[12px] font-bold text-slate-500">
                        ${(lineup.salary_used / 1000).toFixed(1)}k / $50k
                      </div>
                    </div>
                    <ChevronDown
                      className={`mt-1 h-5 w-5 text-slate-400 transition-transform duration-[var(--transition-default)] ${
                        isExpanded ? 'rotate-180' : ''
                      }`}
                      aria-hidden="true"
                    />
                  </div>
                </div>
              </div>

              {(lineup.simulation_ev || lineup.ceiling_score || lineup.leverage_score) ? (
                <div className="grid grid-cols-2 gap-2 border-b border-slate-200 p-3 sm:grid-cols-4 sm:p-4">
                  <Metric label="Expected FPTS" value={lineup.simulation_ev?.toFixed(1) ?? '—'} />
                  <Metric label="Ceiling" value={lineup.ceiling_score?.toFixed(1) ?? '—'} />
                  <Metric label="Top 10" value={lineup.top_10_rate !== undefined ? `${(lineup.top_10_rate * 100).toFixed(1)}%` : '—'} />
                  <Metric label="PIOS Edge" value={lineup.lineup_intelligence_score?.toFixed(1) ?? lineup.leverage_score?.toFixed(1) ?? '—'} />
                </div>
              ) : null}

              {/* Narrative */}
              <p className={`px-3 py-3 text-[13px] font-medium text-slate-600 sm:px-4 ${isExpanded ? 'border-b border-slate-200' : ''}`}>
                {lineup.narrative}
                {lineup.win_condition ? (
                  <span className="mt-2 block font-bold text-[#0b1f3a]">{lineup.win_condition}</span>
                ) : null}
              </p>
              {lineup.strategy_notes?.length ? (
                <div className="flex flex-wrap gap-2 border-t border-slate-200 px-3 py-3 sm:px-4">
                  {lineup.strategy_notes.slice(0, 4).map((note) => (
                    <span key={note} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-600">
                      {note}
                    </span>
                  ))}
                </div>
              ) : null}
            </button>

            {isExpanded ? (
              <div id={detailsId} aria-labelledby={summaryId}>
                <LineupAlerts lineup={lineup} />
                {matchedStacks.length > 0 && (
                  <p className="border-b border-slate-200 px-3 py-3 text-[13px] font-bold text-cyan-800 sm:px-4">
                    Contains recommended stack:{' '}
                    {matchedStacks
                      .map((pair) => `${playerName(pair.player1_id, manifest)} + ${playerName(pair.player2_id, manifest)}`)
                      .join(', ')}
                  </p>
                )}

                {/* Player List */}
                <div className="space-y-2 p-3 sm:p-4">
                  {lineup.players.map((player, idx) => {
                    const isHighlighted = !!player.id && highlightedIds.has(player.id);
                    const trend = player.last_5_stats?.trend ?? 'stable';
                    const trendSymbol = trend === 'up' ? '↗' : trend === 'down' ? '↘' : '→';
                    return (
                      <div
                        key={idx}
                        className={`flex items-center gap-3 rounded-md border p-3 ${
                          isHighlighted ? 'border-cyan-300 bg-cyan-50' : 'border-slate-200 bg-slate-50'
                        }`}
                      >
                        <PlayerPortrait player={player} />
                        <TeamMark team={player.team || player.nfl_team || 'FA'} logoUrl={player.team_logo_url} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-black text-[#0b1f3a] sm:text-base">
                            {player.roster_slot ? (
                              <span className="mr-2 rounded-sm bg-[#0b1f3a] px-1.5 py-0.5 text-[10px] font-black text-white">
                                {player.roster_slot}
                              </span>
                            ) : null}
                            {player.name || player.full_name}
                          </p>
                          <p className="truncate text-[12px] font-medium text-slate-500">
                            {player.position} • {player.team || player.nfl_team || 'FA'} • {trendSymbol}
                          </p>
                          {player.news_note ? (
                            <p className="mt-1 max-h-8 overflow-hidden text-[11px] text-slate-500">
                              {player.news_note}
                            </p>
                          ) : null}
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-black text-[#0b1f3a]">{formatSalary(player.salary)}</p>
                          <p className="max-w-[118px] text-[12px] font-medium text-slate-500 sm:max-w-[130px]">
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
                <div className="flex gap-2 border-t border-slate-200 p-3 sm:p-4">
                  <button
                    onClick={() => onSaveLineup?.(lineup)}
                    className="flex-1 rounded-md bg-[#0b1f3a] py-2 font-black text-white transition-colors duration-[var(--transition-fast)] hover:bg-[#061426] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-500"
                  >
                    Save Lineup
                  </button>
                  <div className="flex-[2]">
                    <ExportLineup lineup={lineup} />
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function LineupAlerts({ lineup }: { lineup: Lineup }) {
  const alerts = [
    ...(lineup.anti_correlation_flags ?? []).map((text) => ({ text, tone: 'error' as const })),
    ...(lineup.exposure_flags ?? []).map((text) => ({ text, tone: 'warning' as const })),
    ...(lineup.late_swap_flags ?? []).map((text) => ({ text, tone: 'warning' as const })),
  ];
  if (!alerts.length) return null;

  return (
    <div className="space-y-2 border-b border-slate-200 px-3 py-3 sm:px-4">
      {alerts.slice(0, 6).map((alert) => (
        <p
          key={`${alert.tone}-${alert.text}`}
          className={`rounded-md border px-3 py-2 text-[12px] font-bold ${
            alert.tone === 'error'
              ? 'border-error/30 bg-error/10 text-error'
              : 'border-warning/30 bg-warning/10 text-warning'
          }`}
        >
          {alert.text}
        </p>
      ))}
    </div>
  );
}

function formatSalary(salary?: number): string {
  return salary === undefined ? '$—' : `$${salary.toLocaleString()}`;
}

function PlayerPortrait({ player }: { player: LineupPlayer }) {
  const name = player.name || player.full_name || 'Player';
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  if (player.image_url) {
    return (
      <img
        src={player.image_url}
        alt=""
        className="h-11 w-11 shrink-0 rounded-md border border-slate-200 object-cover"
      />
    );
  }

  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-xs font-black text-slate-500">
      {initials || 'P'}
    </div>
  );
}

function TeamMark({ team, logoUrl }: { team: string; logoUrl?: string }) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt=""
        className="hidden h-9 w-9 shrink-0 rounded-full border border-cyan-200 bg-white object-contain p-1 sm:block"
      />
    );
  }

  return (
    <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full border border-cyan-200 bg-cyan-50 text-[10px] font-black text-cyan-800 sm:flex">
      {team.slice(0, 3).toUpperCase()}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-sm font-black text-[#0b1f3a]">{value}</p>
    </div>
  );
}

function lineupTypeLabel(type: NonNullable<Lineup['lineup_type']>): string {
  if (type === 'contrarian_tournament') return 'Contrarian Tournament';
  if (type === 'late_swap_candidate') return 'Late Swap Candidate';
  return 'High EV';
}
