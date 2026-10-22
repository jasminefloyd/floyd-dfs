import { ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MIOS_FantasyManifest } from '../lib/MIOS_FantasyAgents';
import { confirmFloydSwapRecommendation, createFloydSwapPlans, floydRequest, type FloydSwapPlan } from '../lib/floydDfsClient';
import { ExportLineup } from './ExportLineup';

export interface LineupPlayer {
  id?: string;
  status?: string;
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
  role_status?: string;
  projection_confidence?: string;
  role_uncertainty?: string;
  news_freshness?: string;
  news_source?: string;
  minutes_volatility?: number;
  recent_fantasy_per_minute?: number;
  minutes_trend?: 'up' | 'down' | 'stable' | 'unknown';
  ownership_projection?: number;
  context_score?: number;
  contextual_projection?: number;
  expected_points?: number;
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
  status?: string;
  rank: number;
  players: LineupPlayer[];
  projected_points?: number;
  expected_points?: number;
  salary_used?: number;
  salary_cap?: number;
  decision_trace?: Record<string, unknown>;
  objective_label?: string;
  salary_remaining?: number;
  data_as_of?: string;
  next_lock_at?: string;
  validation_status?: string;
  search_status?: string;
  latest_revision?: number;
  confidence_score: number | null;
  cash_line_confidence?: 'CALIBRATED' | 'SIMULATED_ESTIMATE' | 'UNAVAILABLE';
  contest_kind?: 'CASH' | 'GPP' | 'UNKNOWN';
  ceiling_score?: number;
  floor_score?: number;
  p99_score?: number;
  win_rate?: number;
  top_n_rate?: number;
  expected_payout?: number;
  ownership_sum?: number;
  lineup_type?: 'optimizer_ranked' | 'high_ev' | 'contrarian_tournament' | 'late_swap_candidate';
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
  readiness_status?: 'READY' | 'READY_WITH_WATCH' | 'PROVISIONAL';
}

interface LineupDisplayProps {
  lineups: Lineup[];
  manifest?: MIOS_FantasyManifest | null;
  selectedLineupRank?: number;
  onSelectLineup?: (rank: number) => void;
  onSaveLineup?: (lineup: Lineup, entry: { contestId: string; externalEntryId: string }) => void | Promise<void>;
}

export function LineupDisplay({ lineups, manifest, selectedLineupRank, onSelectLineup, onSaveLineup }: LineupDisplayProps) {
  const [expandedRanks, setExpandedRanks] = useState<Set<number>>(new Set([1]));
  const [enteredIds, setEnteredIds] = useState<Set<string>>(() => new Set(lineups.filter((lineup) => lineup.status?.toUpperCase() === 'ENTERED').map((lineup) => lineup.id).filter((id): id is string => Boolean(id))));
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const [entryDetails, setEntryDetails] = useState<Record<string, { contestId: string; externalEntryId: string }>>({});
  const [swapPlansByLineup, setSwapPlansByLineup] = useState<Record<string, { plans: FloydSwapPlan[]; message?: string; loading?: boolean; confirming?: string }>>({});
  const [revisionByLineup, setRevisionByLineup] = useState<Record<string, number>>(() => Object.fromEntries(lineups.flatMap((lineup) => lineup.id ? [[lineup.id, lineup.latest_revision ?? 0] as const] : [])));
  const [watchedLineupIds, setWatchedLineupIds] = useState<Set<string>>(() => new Set());
  const swapRequestIds = useRef(new Set<string>());
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
    const id = lineup.id;
    if (!id || savingIds.has(id)) return;
    const entry = entryDetails[id] ?? { contestId: '', externalEntryId: '' };
    if (!entry.contestId.trim() || !entry.externalEntryId.trim()) {
      setSaveErrors((current) => ({ ...current, [id]: 'Add the DraftKings contest ID and entry ID from your submitted entry.' }));
      return;
    }
    setSavingIds((current) => new Set(current).add(id));
    setSaveErrors((current) => { const next = { ...current }; delete next[id]; return next; });
    try {
      if (!onSaveLineup) throw new Error('Mark as entered is unavailable for this lineup.');
      await onSaveLineup(lineup, { contestId: entry.contestId.trim(), externalEntryId: entry.externalEntryId.trim() });
      setEnteredIds((current) => new Set(current).add(id));
    } catch (error) {
      setSaveErrors((current) => ({ ...current, [id]: error instanceof Error ? error.message : 'Unable to mark this lineup as entered. Try again.' }));
    } finally {
      setSavingIds((current) => { const next = new Set(current); next.delete(id); return next; });
    }
  };
  const refreshAlternatives = useCallback(async (lineup: Lineup, automatic = false) => {
    if (!lineup.id || swapRequestIds.current.has(lineup.id) || swapPlansByLineup[lineup.id]?.loading) return;
    const entryId = entryDetails[lineup.id]?.externalEntryId.trim();
    if (!entryId) { setSwapPlansByLineup((current) => ({ ...current, [lineup.id!]: { plans: [], message: 'Add and save the DraftKings entry ID before requesting alternatives.' } })); return; }
    swapRequestIds.current.add(lineup.id);
    setSwapPlansByLineup((current) => ({ ...current, [lineup.id!]: { plans: [], loading: true } }));
    try {
      const response = await createFloydSwapPlans({ lineupId: lineup.id, entryId, sourceRevision: revisionByLineup[lineup.id] ?? lineup.latest_revision ?? 0, trigger: automatic ? 'Watched lineup refresh.' : 'User requested fresh swap alternatives.', idempotencyKey: crypto.randomUUID() });
      setSwapPlansByLineup((current) => ({ ...current, [lineup.id!]: { plans: response.plans ?? [], message: response.plans?.length ? undefined : response.outcome === 'NO_SOLUTION' ? 'No distinct legal alternatives were found.' : response.submission ?? `Alternatives are unavailable (${response.outcome}).` } }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Alternatives could not be refreshed. Try again.';
      setSwapPlansByLineup((current) => ({ ...current, [lineup.id!]: { plans: [], message } }));
      if (automatic && /no unlocked games remain|not verified|does not permit late swap|unsupported/i.test(message)) setWatchedLineupIds((current) => { const next = new Set(current); next.delete(lineup.id!); return next; });
    } finally { swapRequestIds.current.delete(lineup.id); }
  }, [entryDetails, revisionByLineup, swapPlansByLineup]);
  useEffect(() => {
    if (!watchedLineupIds.size) return;
    const poll = () => {
      if (document.visibilityState !== 'visible') return;
      for (const id of watchedLineupIds) {
        const lineup = lineups.find((item) => item.id === id);
        if (lineup && enteredIds.has(id)) void refreshAlternatives(lineup, true);
      }
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') poll(); };
    const interval = window.setInterval(poll, 60_000);
    document.addEventListener('visibilitychange', onVisibility);
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', onVisibility); };
  }, [watchedLineupIds, enteredIds, lineups, entryDetails, revisionByLineup, refreshAlternatives]);
  const confirmRecommendation = async (lineup: Lineup, plan: FloydSwapPlan) => {
    if (!lineup.id || swapPlansByLineup[lineup.id]?.confirming) return;
    setSwapPlansByLineup((current) => ({ ...current, [lineup.id!]: { ...current[lineup.id!], confirming: plan.id } }));
    try {
      const result = await confirmFloydSwapRecommendation({ lineupId: lineup.id, planId: plan.id, sourceRevision: revisionByLineup[lineup.id] ?? lineup.latest_revision ?? 0 });
      setRevisionByLineup((current) => ({ ...current, [lineup.id!]: result.revision.revision }));
      setSwapPlansByLineup((current) => ({ ...current, [lineup.id!]: { plans: [], message: `Saved as local revision ${result.revision.revision}. DraftKings was not changed; review and enter it manually.` } }));
    } catch (error) {
      setSwapPlansByLineup((current) => ({ ...current, [lineup.id!]: { ...current[lineup.id!], message: error instanceof Error ? error.message : 'This recommendation could not be confirmed; refresh alternatives.' } }));
    }
  };

  return (
    <div className="space-y-4">
      {manifest?.readiness?.cautions?.length ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 shadow-sm">
          <span className="font-black">Engine state: {manifest.readiness.engine_state}.</span> These are provisional projections, not validated entry recommendations; contest rank and win probability are unavailable. {manifest.is_fallback ? 'This lineup set uses cached MIOS data. ' : ''}{manifest.readiness.cautions[0]}
        </div>
      ) : null}
      {manifest?.sport?.toLowerCase() === 'mlb' && lineups.some((lineup) => lineup.players.some((player) => player.lineup_status !== 'confirmed')) ? (
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
              aria-current={selectedLineupRank === lineup.rank ? 'true' : undefined}
              onClick={() => { toggleLineup(lineup.rank); onSelectLineup?.(lineup.rank); }}
              onFocus={() => onSelectLineup?.(lineup.rank)}
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
                      {lineup.readiness_status === 'PROVISIONAL' ? (
                        <span className="rounded-full border border-amber-300/40 bg-amber-400/20 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-amber-100">Model not validated</span>
                      ) : null}
                      {lineup.contest_kind === 'CASH' && lineup.cash_line_confidence !== 'UNAVAILABLE' && lineup.confidence_score !== null && lineup.confidence_score < 0.85 ? (
                        <span className="rounded-full border border-amber-300/40 bg-amber-400/20 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-amber-100">Below cash target</span>
                      ) : null}
                    </div>
                    <h3 className="mt-3 truncate text-xl font-black tracking-tight text-white sm:text-2xl">{lineup.win_condition || lineupTypeLabel(lineup.lineup_type ?? 'high_ev')}</h3>
                  </div>
                  <div className="flex shrink-0 items-start gap-2 text-right">
                    <div>
                      <div className="text-3xl font-black tracking-tight text-white sm:text-4xl">
                        {lineup.expected_points !== undefined ? `${lineup.expected_points.toFixed(1)} mean pts` : lineup.projected_points !== undefined ? `${lineup.projected_points.toFixed(1)} median pts` : 'Points unavailable'}
                      </div>
                      <div className="mt-0.5 text-[11px] font-bold uppercase tracking-wide text-cyan-200">
                        {lineup.salary_used !== undefined ? `$${lineup.salary_used.toLocaleString()} / ${lineup.salary_cap !== undefined ? `$${lineup.salary_cap.toLocaleString()}` : 'cap unavailable'}` : 'Salary unavailable'}
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
                <p className="mt-2 overflow-x-auto whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.1em] text-blue-200">
                  {cashLineLabel(lineup)}
                </p>
              </div>

              {(lineup.projected_points !== undefined || lineup.expected_points !== undefined || lineup.ceiling_score !== undefined) ? (
              <div className="grid grid-cols-2 gap-px border-b border-slate-200 bg-slate-200">
                  <Metric label="Mean FPTS" value={lineup.expected_points !== undefined ? lineup.expected_points.toFixed(1) : 'Unavailable'} />
                  <Metric label="Median FPTS" value={lineup.projected_points !== undefined ? lineup.projected_points.toFixed(1) : 'Unavailable'} />
                  <Metric label="P20–P90 range" value={lineup.floor_score !== undefined && lineup.ceiling_score !== undefined ? `${lineup.floor_score.toFixed(1)}–${lineup.ceiling_score.toFixed(1)}` : 'Unavailable'} />
                  <Metric label="Salary left" value={lineup.salary_remaining !== undefined ? `$${lineup.salary_remaining.toLocaleString()}` : 'Unavailable'} />
                </div>
              ) : null}
              <div className="flex flex-wrap gap-x-3 gap-y-1 border-b border-slate-200 px-4 py-2 text-[10px] text-slate-500 sm:px-5">
                {lineup.objective_label ? <span>Objective · {lineup.objective_label}</span> : null}
                {lineup.data_as_of ? <span>Data as of {formatLocalTime(lineup.data_as_of)}</span> : null}
                {lineup.next_lock_at ? <span>Next lock {formatLocalTime(lineup.next_lock_at)}</span> : null}
                {lineup.validation_status ? <span>Validation {lineup.validation_status}</span> : null}
                {lineup.search_status ? <span>Search {lineup.search_status}</span> : null}
              </div>

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
                        key={`${player.id ?? player.name ?? idx}:${player.image_url ?? ''}`}
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
                          {player.news_freshness || player.news_source ? <p className="mt-1 text-[10px] font-medium text-slate-500">News: {player.news_source ?? 'source unavailable'}{player.news_freshness ? ` · ${player.news_freshness}` : ''}</p> : null}
                          {player.role_status || player.role_uncertainty ? <p className="mt-1 text-[10px] font-bold text-amber-800">Role: {(player.role_status ?? 'unconfirmed').replaceAll('_', ' ').toLowerCase()}{player.projection_confidence ? ` · ${player.projection_confidence.toLowerCase()} model confidence` : ''}{player.role_uncertainty ? ` · ${player.role_uncertainty}` : ''}</p> : null}
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
                            {player.expected_points !== undefined ? `${player.expected_points.toFixed(1)} mean · ` : ''}{player.contextual_projection?.toFixed(1) ?? '—'} Floyd median
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
                  <div className="mb-3 grid gap-2 sm:grid-cols-2">
                    <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">DraftKings contest ID<input value={entryDetails[lineup.id ?? '']?.contestId ?? manifest?.slate?.contest_id ?? ''} onChange={(event) => lineup.id && setEntryDetails((current) => ({ ...current, [lineup.id!]: { contestId: event.target.value, externalEntryId: current[lineup.id!]?.externalEntryId ?? '' } }))} placeholder="Contest ID" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs normal-case tracking-normal text-slate-800" /></label>
                    <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Your DraftKings entry ID<input value={entryDetails[lineup.id ?? '']?.externalEntryId ?? ''} onChange={(event) => lineup.id && setEntryDetails((current) => ({ ...current, [lineup.id!]: { contestId: current[lineup.id!]?.contestId ?? manifest?.slate?.contest_id ?? '', externalEntryId: event.target.value } }))} placeholder="Entry ID from DraftKings" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs normal-case tracking-normal text-slate-800" /></label>
                  </div>
                  <button
                    type="button"
                    disabled={!lineup.id || savingIds.has(lineup.id)}
                    onClick={() => void markEntered(lineup)}
                    className="w-full rounded-xl bg-[#0b1f3a] py-3 text-sm font-black text-white transition-colors duration-[var(--transition-fast)] hover:bg-[#061426] disabled:cursor-default disabled:bg-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-500"
                  >
                    {savingIds.has(lineup.id ?? '') ? 'Saving…' : lineup.id && enteredIds.has(lineup.id) ? 'Link / update DraftKings entry ID' : 'Record external entry'}
                  </button>
                  <p className="mt-2 text-center text-[11px] text-slate-500">Saves the DraftKings contest and entry IDs so official standings can be matched later. It does not submit the lineup.</p>
                  {lineup.id && saveErrors[lineup.id] ? <p role="alert" className="mt-2 text-sm font-semibold text-red-700">{saveErrors[lineup.id]}</p> : null}
                  <div className="mt-3 border-t border-slate-200 pt-3">
                    <button type="button" disabled={!lineup.id || !enteredIds.has(lineup.id) || Boolean(swapPlansByLineup[lineup.id]?.loading)} onClick={() => void refreshAlternatives(lineup)} className="w-full rounded-lg border border-cyan-300 bg-cyan-50 px-3 py-2.5 text-sm font-black text-cyan-950 disabled:cursor-not-allowed disabled:opacity-50">{swapPlansByLineup[lineup.id ?? '']?.loading ? 'Checking contest and game status…' : 'Refresh alternatives'}</button>
                    {lineup.id && swapPlansByLineup[lineup.id]?.message ? <p role="status" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs leading-5 text-amber-900">{swapPlansByLineup[lineup.id]!.message}</p> : null}
                    {lineup.id ? swapPlansByLineup[lineup.id]?.plans.map((plan) => <SwapPlanCard key={plan.id} plan={plan} lineup={lineup} confirming={swapPlansByLineup[lineup.id!]?.confirming === plan.id} onConfirm={() => void confirmRecommendation(lineup, plan)} />) : null}
                    {lineup.id && enteredIds.has(lineup.id) ? <><button type="button" aria-pressed={watchedLineupIds.has(lineup.id)} onClick={() => setWatchedLineupIds((current) => { const next = new Set(current); if (next.has(lineup.id!)) next.delete(lineup.id!); else next.add(lineup.id!); return next; })} className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700">{watchedLineupIds.has(lineup.id) ? 'Stop watching this lineup' : 'Watch for lineup updates'}</button><p className="mt-2 text-[11px] text-slate-500">Watched lineups refresh every 60 seconds while this page is visible. Watching stops when the slate has no verified editable games. Plans can be blocked if DraftKings eligibility or any game lock cannot be verified. A local recommendation is not a DraftKings submission.</p></> : null}
                  </div>
                  <div className="mt-3"><ExportLineup lineup={lineup} /></div>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function SwapPlanCard({ plan, lineup, confirming, onConfirm }: { plan: FloydSwapPlan; lineup: Lineup; confirming: boolean; onConfirm: () => void }) {
  const players = new Map(lineup.players.map((player) => [String(player.id), player.name ?? player.full_name ?? String(player.id)]));
  return <article className="mt-3 rounded-xl border border-emerald-200 bg-white p-3" aria-label="Server-validated conditional swap alternative"><p className="text-xs font-black text-emerald-900">Conditional alternative · server-validated</p><ul className="mt-2 space-y-1 text-xs text-slate-700">{Object.entries(plan.replacement_roster).map(([slot, playerId]) => <li key={slot}><span className="font-bold">{slot}:</span> {players.get(playerId) ?? 'Replacement player'}</li>)}</ul><p className="mt-2 text-xs text-slate-600">Salary left ${plan.salary_remaining.toLocaleString()} · mean {deltaLabel(plan.mean_delta)} · median {deltaLabel(plan.median_delta)}</p>{plan.expires_at ? <p className="mt-1 text-[11px] text-amber-800">Expires {formatLocalTime(plan.expires_at)}{plan.next_lock_at ? ` · next lock ${formatLocalTime(plan.next_lock_at)}` : ''}</p> : null}{plan.risk_flags.length ? <p className="mt-1 text-[11px] text-amber-800">Watch: {plan.risk_flags.join(' · ')}</p> : null}<p className="mt-1 text-[11px] text-slate-500">Evidence references: {plan.evidence_ids.length}</p><button type="button" disabled={confirming} onClick={onConfirm} className="mt-3 w-full rounded-lg bg-emerald-800 px-3 py-2 text-xs font-black text-white disabled:opacity-50">{confirming ? 'Revalidating and saving…' : 'Confirm local recommendation'}</button><p className="mt-1 text-center text-[10px] text-slate-500">This does not submit to DraftKings.</p></article>;
}

function LineupAlerts({ lineup }: { lineup: Lineup }) {
  const alerts = [
    ...(lineup.anti_correlation_flags ?? []).map((text) => ({ text, tone: 'error' as const })),
    ...(lineup.exposure_flags ?? []).map((text) => ({ text, tone: 'warning' as const })),
    ...(lineup.portfolio_correlation_flags ?? []).map((text) => ({ text, tone: 'warning' as const })),
    ...(lineup.late_swap_flags ?? []).map((text) => ({ text, tone: 'warning' as const })),
    ...(lineup.watch_items ?? []).map((text) => ({ text: `Watch before lock: ${text}`, tone: 'warning' as const })),
  ];
  const uniqueAlerts = alerts.filter((alert, index) => alerts.findIndex((candidate) => candidate.tone === alert.tone && candidate.text === alert.text) === index);
  if (!uniqueAlerts.length) return null;

  return (
    <div className="space-y-2 border-b border-slate-200 px-3 py-3 sm:px-4">
      {uniqueAlerts.slice(0, 6).map((alert) => (
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
  if (lineup.cash_line_confidence === 'CALIBRATED' && lineup.confidence_score !== null && lineup.confidence_score > 0) return `${(lineup.confidence_score * 100).toFixed(0)}% cash-line probability (calibrated)`;
  if (lineup.cash_line_confidence === 'SIMULATED_ESTIMATE' && lineup.confidence_score !== null && lineup.confidence_score > 0) return `${(lineup.confidence_score * 100).toFixed(0)}% cash-line probability (simulated estimate)`;
  return 'Cash-line probability unavailable';
}

function formatSalary(salary?: number): string {
  return salary === undefined ? '$—' : `$${salary.toLocaleString()}`;
}

function formatLocalTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'time unavailable';
  // `timeZoneName` cannot be combined with `dateStyle`/`timeStyle` in
  // Intl.DateTimeFormat. Spell out the fields so dates render across browsers.
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(new Date(timestamp));
}
function deltaLabel(value: number | null): string { return value === null ? 'unavailable' : `${value > 0 ? '+' : ''}${value.toFixed(1)} pts`; }

function PlayerPortrait({ player }: { player: LineupPlayer }) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [player.image_url]);
  const name = player.name || player.full_name || 'Player';
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  if (player.image_url && !imageFailed) {
    return (
      <img
        src={player.image_url}
        alt=""
        className="h-11 w-11 shrink-0 rounded-md border border-slate-200 object-cover"
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => {
          setImageFailed(true);
          if (player.id) void floydRequest(`/api/player-photos/${encodeURIComponent(player.id)}/failed`, { method: 'POST' }).catch(() => undefined);
        }}
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
  if (type === 'optimizer_ranked') return 'Optimizer Ranked';
  if (type === 'contrarian_tournament') return 'Contrarian Tournament';
  if (type === 'late_swap_candidate') return 'Late Swap Candidate';
  return 'Optimizer Ranked';
}
