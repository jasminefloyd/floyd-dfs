import { Check, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { MIOS_FantasyManifest } from '../lib/MIOS_FantasyAgents';

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
  lineup_status?: 'confirmed' | 'unconfirmed' | 'unknown';
  salary_source?: string;
  news_note?: string;
  prop_projection?: number;
  implied_total?: number;
  spread?: number;
  confirmed_starter?: boolean;
  run_factor?: number;
  opponent_team?: string;
  opposing_probable_pitcher_id?: string;
  opposing_probable_pitcher_name?: string;
  own_probable_starter?: boolean;
  game_id?: string;
  minutes_projection?: number;
  role_stability?: number;
  minutes_volatility?: number;
  recent_fantasy_per_minute?: number;
  minutes_trend?: 'up' | 'down' | 'stable' | 'unknown';
  ownership_projection?: number;
  context_score?: number;
  contextual_projection?: number;
  floor_projection?: number;
  ceiling_projection?: number;
  volatility_score?: number;
  boom_probability?: number;
  bust_probability?: number;
  batting_order?: number;
  game_context_tags?: string[];
  home_away?: 'home' | 'away' | 'unknown';
  news_evidence?: { summary?: string; confirmed: boolean; is_speculative: boolean; reliability: number; source: string };
  form_metrics?: { last_3_avg: number | null; last_5_avg: number | null; last_10_avg: number | null; trend: string; opportunity_trend: string; sample_size: number; is_synthetic: boolean };
  last_5_stats?: {
    avg_fantasy_pts?: number;
    stdev_fantasy_pts?: number;
    games_sample_size?: number;
    minutes_stdev?: number;
    trend?: 'up' | 'down' | 'stable';
    minutes_avg?: number;
    role_stability?: number;
    minutes_volatility?: number;
    recent_fantasy_per_minute?: number;
    is_synthetic?: boolean;
  };
}

export interface Lineup {
  id?: string;
  rank: number;
  players: LineupPlayer[];
  projected_points: number;
  salary_used: number;
  confidence_score: number;
  cash_line_confidence?: 'CALIBRATED' | 'SIMULATED_ESTIMATE' | 'UNAVAILABLE';
  contest_kind?: 'CASH' | 'GPP' | 'UNKNOWN';
  simulation_ev?: number;
  ceiling_score?: number;
  floor_score?: number;
  p99_score?: number;
  win_rate?: number;
  top_n_rate?: number;
  expected_payout?: number;
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
  portfolio_correlation_flags?: string[];
  late_swap_flags?: string[];
  strategy_notes?: string[];
  scenario_key?: string;
  scenario_confidence?: number;
  relationship_score?: number;
  evidence_summary?: string[];
  failure_condition?: string;
  salary_left_unused?: number;
  captain_rationale?: string;
  narrative: string;
  watch_items?: string[];
  readiness_status?: 'READY' | 'READY_WITH_WATCH';
}

interface LineupDisplayProps {
  lineups: Lineup[];
  manifest?: MIOS_FantasyManifest | null;
  onSaveLineup?: (lineup: Lineup) => void;
}

export function LineupDisplay({ lineups, manifest, onSaveLineup }: LineupDisplayProps) {
  const [expandedRanks, setExpandedRanks] = useState<Set<number>>(new Set([1]));
  const [enteredRanks, setEnteredRanks] = useState<Set<number>>(new Set());
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
  const markEntered = async (lineup: Lineup) => {
    await onSaveLineup?.(lineup);
    setEnteredRanks((current) => new Set(current).add(lineup.rank));
  };

  return (
    <div className="space-y-4">
      {manifest?.readiness?.cautions?.length ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 shadow-sm">
          <span className="font-black">Trust note:</span> {manifest.is_fallback ? 'This lineup set uses cached MIOS data. ' : ''}{manifest.readiness.cautions[0]}
        </div>
      ) : null}
      {manifest?.sport?.toLowerCase() === 'mlb' ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 shadow-sm">
          <span className="font-black">MLB lineup status:</span> Player recommendations continue, but confirmed batting orders were not available when this lineup was generated. Players marked <span className="font-black">UNCONFIRMED</span> must be verified before entry.
        </div>
      ) : null}
      {lineups.map((lineup) => {
        const isExpanded = expandedRanks.has(lineup.rank);
        const summaryId = `lineup-${lineup.rank}-summary`;
        const detailsId = `lineup-${lineup.rank}-details`;

        return (
          <div key={lineup.rank} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[var(--shadow-medium)]">
            <button
              type="button"
              id={summaryId}
              aria-expanded={isExpanded}
              aria-controls={detailsId}
              onClick={() => toggleLineup(lineup.rank)}
              className="block w-full text-left transition-colors duration-[var(--transition-fast)] hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cyan-500"
            >
              {/* Header */}
              <div className="bg-[#0b1f3a] p-4 text-white sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-cyan-300 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-[#06213d]">Lineup #{lineup.rank}</span>
                      <span className="rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-blue-100">{lineupTypeLabel(lineup.lineup_type ?? 'high_ev')}</span>
                      {lineup.readiness_status === 'READY_WITH_WATCH' ? (
                        <span className="rounded-full border border-amber-300/40 bg-amber-400/20 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-amber-100">Watch items</span>
                      ) : null}
                      {lineup.contest_kind === 'CASH' && lineup.cash_line_confidence !== 'UNAVAILABLE' && lineup.confidence_score < 0.85 ? (
                        <span className="rounded-full border border-amber-300/40 bg-amber-400/20 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-amber-100">Below cash target</span>
                      ) : null}
                    </div>
                    <h3 className="mt-3 truncate text-xl font-black tracking-tight text-white sm:text-2xl">{lineup.win_condition || lineupTypeLabel(lineup.lineup_type ?? 'high_ev')}</h3>
                    <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.1em] text-blue-200">
                      {cashLineLabel(lineup)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-start gap-2 text-right">
                    <div>
                      <div className="text-3xl font-black tracking-tight text-white sm:text-4xl">
                        {lineup.projected_points.toFixed(1)} median pts
                      </div>
                      <div className="mt-0.5 text-[11px] font-bold uppercase tracking-wide text-cyan-200">
                        ${(lineup.salary_used / 1000).toFixed(1)}k / $50k
                      </div>
                    </div>
                    <ChevronDown
                      className={`mt-1 h-5 w-5 text-blue-200 transition-transform duration-[var(--transition-default)] ${
                        isExpanded ? 'rotate-180' : ''
                      }`}
                      aria-hidden="true"
                    />
                  </div>
                </div>
              </div>

              {(lineup.simulation_ev || lineup.ceiling_score) ? (
                <div className="grid grid-cols-2 gap-px border-b border-slate-200 bg-slate-200">
                  <Metric label="Expected FPTS" value={lineup.simulation_ev?.toFixed(1) ?? '—'} />
                  <Metric label="Ceiling" value={lineup.ceiling_score?.toFixed(1) ?? '—'} />
                </div>
              ) : null}

              {/* Narrative */}
              <div className={`border-b border-slate-200 px-4 py-3.5 sm:px-5 ${isExpanded ? '' : 'border-b-0'}`}>
                <p className="text-[13px] leading-5 text-slate-600">{lineup.narrative}</p>
              {(lineup.scenario_key || lineup.relationship_score !== undefined) ? (
                  <span className="mt-2 block text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">
                    {lineup.scenario_key ? `Scenario: ${lineup.scenario_key.replace(/_/g, ' ')}` : ''}
                    {lineup.relationship_score !== undefined ? ` • Relationship evidence: ${lineup.relationship_score.toFixed(2)}` : ''}
                  </span>
                ) : null}
                {lineup.evidence_summary?.length ? (
                  <span className="mt-2 block text-[11px] text-slate-500">
                    Evidence: {lineup.evidence_summary.slice(0, 3).join(' · ')}
                  </span>
                ) : null}
              </div>
              {!isExpanded ? (
                <div className="px-4 pb-4 pt-1 sm:px-5">
                  <div className="flex flex-wrap gap-1.5">
                    {lineup.players.slice(0, 10).map((player, index) => (
                      <span key={`${lineup.rank}-${player.id ?? player.name ?? index}`} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-bold text-slate-600">
                        {player.roster_slot ? `${player.roster_slot} ` : ''}{player.name || player.full_name}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              {lineup.strategy_notes?.length ? (
                <div className="flex flex-wrap gap-2 border-t border-slate-200 px-4 py-3 sm:px-5">
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

                {/* Player List */}
                <div className="space-y-2 p-3 sm:p-4">
                  {lineup.players.map((player, idx) => {
                    const trend = player.last_5_stats?.trend ?? 'stable';
                    const trendSymbol = trend === 'up' ? '↗' : trend === 'down' ? '↘' : '→';
                    return (
                    <div
                        key={idx}
                        className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 sm:flex sm:items-center"
                      >
                        <div className="flex items-center gap-2 sm:contents">
                          <PlayerPortrait player={player} />
                          <TeamMark team={player.team || player.nfl_team || 'FA'} logoUrl={player.team_logo_url} />
                        </div>
                        <div className="min-w-0 self-center">
                          <p className="line-clamp-2 break-words text-sm font-black tracking-tight text-[#0b1f3a] sm:text-base">
                            {player.roster_slot ? (
                              <span className="mr-2 rounded-sm bg-[#0b1f3a] px-1.5 py-0.5 text-[10px] font-black text-white">
                                {player.roster_slot}
                              </span>
                            ) : null}
                            {player.name || player.full_name}
                            {player.lineup_status === 'unconfirmed' ? (
                              <span className="ml-2 rounded-sm border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-amber-800">Unconfirmed</span>
                            ) : null}
                          </p>
                          <p className="break-words text-[12px] font-medium text-slate-500">
                            {player.position} • {player.team || player.nfl_team || 'FA'} • {trendSymbol}{player.home_away && player.home_away !== 'unknown' ? ` • ${player.home_away}` : ''}
                          </p>
                          {player.news_note ? (
                            <p className="mt-1 line-clamp-3 break-words text-[11px] leading-4 text-slate-500">
                              {player.news_note}
                            </p>
                          ) : null}
                          {player.news_evidence?.is_speculative ? (
                            <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-amber-700">Unconfirmed news signal</p>
                          ) : null}
                        </div>
                        <div className="col-span-2 grid grid-cols-2 gap-2 border-t border-slate-200 pt-2 text-left sm:col-span-1 sm:ml-auto sm:block sm:border-t-0 sm:pt-0 sm:text-right">
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Salary</p>
                            <p className="font-black text-[#0b1f3a]">{formatSalary(player.salary)}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Projection</p>
                            <p className="font-black text-emerald-700">{player.contextual_projection?.toFixed(1) ?? '—'} pts</p>
                          </div>
                          <p className="col-span-2 text-[11px] font-medium leading-4 text-slate-500 sm:max-w-[160px]">
                            {player.contextual_projection?.toFixed(1) ?? '—'} Floyd median
                            {player.last_5_stats?.stdev_fantasy_pts ? ` • σ ${player.last_5_stats.stdev_fantasy_pts.toFixed(1)}` : ''}
                            {player.salary_multiplier && player.salary_multiplier > 1
                              ? ` • ${player.salary_multiplier}x from ${formatSalary(player.base_salary)}`
                              : ''}
                            {player.salary_source === 'estimated' ? ' • est. salary' : ''}
                          </p>
                          {(player.minutes_projection !== undefined || player.role_stability !== undefined || player.ownership_projection !== undefined) ? (
                            <div className="col-span-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-bold uppercase tracking-wide text-slate-400 sm:justify-end">
                              {player.minutes_projection !== undefined ? <span>{player.minutes_projection.toFixed(1)} min</span> : null}
                              {player.role_stability !== undefined ? <span>Role {Math.round(player.role_stability * 100)}%</span> : null}
                              {player.ownership_projection !== undefined ? <span>Own {(player.ownership_projection * 100).toFixed(1)}%</span> : null}
                            </div>
                          ) : null}
                          {player.form_metrics?.sample_size ? (
                            <p className="col-span-2 mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400 sm:col-span-1">
                              Form {player.form_metrics.trend} · {player.form_metrics.sample_size} games{player.form_metrics.is_synthetic ? ' · fallback' : ''}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Action Buttons */}
                <div className="border-t border-slate-200 bg-slate-50 p-3.5 sm:p-4">
                  <button
                    type="button"
                    disabled={enteredRanks.has(lineup.rank)}
                    onClick={() => void markEntered(lineup)}
                    className="w-full rounded-xl bg-[#0b1f3a] py-3 text-sm font-black text-white transition-colors duration-[var(--transition-fast)] hover:bg-[#061426] disabled:cursor-default disabled:bg-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-500"
                  >
                    {enteredRanks.has(lineup.rank) ? <Check className="mx-auto h-6 w-6" aria-hidden="true" /> : 'Lineup Entered'}
                    {enteredRanks.has(lineup.rank) ? <span className="sr-only">Lineup Entered</span> : null}
                  </button>
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
    ...(lineup.portfolio_correlation_flags ?? []).map((text) => ({ text, tone: 'warning' as const })),
    ...(lineup.late_swap_flags ?? []).map((text) => ({ text, tone: 'warning' as const })),
    ...(lineup.watch_items ?? []).map((text) => ({ text: `Watch before lock: ${text}`, tone: 'warning' as const })),
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

// Never present a simulated estimate the same way as a real, historically-calibrated number --
// the tier is always labeled so the user can weigh how much to trust it.
function cashLineLabel(lineup: Lineup): string {
  if (lineup.cash_line_confidence === 'CALIBRATED' && lineup.confidence_score > 0) return `${(lineup.confidence_score * 100).toFixed(0)}% cash-line probability (calibrated)`;
  if (lineup.cash_line_confidence === 'SIMULATED_ESTIMATE' && lineup.confidence_score > 0) return `${(lineup.confidence_score * 100).toFixed(0)}% cash-line probability (simulated estimate)`;
  return 'Cash-line probability unavailable';
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
    <div className="bg-white px-3 py-2.5 sm:px-4">
      <p className="text-[9px] font-black uppercase tracking-[0.1em] text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm font-black text-[#0b1f3a]">{value}</p>
    </div>
  );
}

function lineupTypeLabel(type: NonNullable<Lineup['lineup_type']>): string {
  if (type === 'contrarian_tournament') return 'Contrarian Tournament';
  if (type === 'late_swap_candidate') return 'Late Swap Candidate';
  return 'High EV';
}
