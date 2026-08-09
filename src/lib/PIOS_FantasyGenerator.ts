import { normalizePlayerName } from './validation';

export interface LineupPlayerDraft {
  name: string;
  team: string;
  image_url?: string;
  team_logo_url?: string;
  position: string;
  salary: number;
  base_salary?: number;
  salary_multiplier?: number;
  roster_slot?: string;
  salary_source?: string;
  player_id: string;
  confidence_score: number;
  last_5_avg_pts: number;
  injury_status: string;
  projected_points?: number;
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
  depth_chart_order?: number;
  ownership_projection?: number;
  cpt_ownership_projection?: number;
  flex_ownership_projection?: number;
  minutes_projection?: number;
  role_stability?: number;
  minutes_volatility?: number;
  recent_fantasy_per_minute?: number;
  usage_rate?: number;
  pace_metric?: number;
  stdev_fantasy_pts?: number;
  games_sample_size?: number;
  minutes_stdev?: number;
  context_score?: number;
  news_score?: number;
  news_note?: string;
  contextual_projection?: number;
  floor_projection?: number;
  ceiling_projection?: number;
  volatility_score?: number;
  boom_probability?: number;
  bust_probability?: number;
  batting_order?: number;
  game_context_tags?: string[];
  home_away?: 'home' | 'away' | 'unknown';
  form_metrics?: { last_3_avg: number | null; last_5_avg: number | null; last_10_avg: number | null; season_to_date_avg: number | null; recency_weighted_avg: number | null; trend: 'up' | 'down' | 'stable' | 'unknown'; opportunity_trend: 'up' | 'down' | 'stable' | 'unknown'; sample_size: number; source: string; is_synthetic: boolean };
  news_evidence?: { summary?: string; score: number; impact_type: string; confirmed: boolean; is_speculative: boolean; reliability: number; source: string };
}

export interface DraftLineup {
  players: LineupPlayerDraft[];
  projected_points: number;
  salary_used: number;
  confidence_score: number;
  simulation_ev?: number;
  ceiling_score?: number;
  floor_score?: number;
  p99_score?: number;
  win_rate?: number;
  top_10_rate?: number;
  top_decile_rate?: number;
  top_n_rate?: number;
  expected_payout?: number;
  leverage_score?: number;
  ownership_sum?: number;
  expected_duplicates?: number;
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
  scenario_key?: 'high_total' | 'favorite_control' | 'underdog_comeback' | 'close_game' | 'blowout_risk' | 'neutral';
  scenario_confidence?: number;
  relationship_score?: number;
  evidence_summary?: string[];
  constraint_violations: string[];
}

interface RosterSlot {
  slot: string;
  eligible: string[];
}

const LINEUP_ELIGIBLE_INJURY_STATUSES = new Set(['active', 'probable', 'day_to_day', 'questionable']);

// Verified against DraftKings' documented Classic roster construction (2026-07-14):
// - NBA/WNBA: 8 spots (PG, SG, SF, PF, C, G, F, UTIL)
// - NFL: 9 spots (QB, 2xRB, 3xWR, TE, FLEX, DST)
// - MLB: 10 spots (2xP, C, 1B, 2B, 3B, SS, 3xOF)
const ROSTER_SLOTS: Record<string, RosterSlot[]> = {
  nba: [
    { slot: 'PG', eligible: ['PG'] },
    { slot: 'SG', eligible: ['SG'] },
    { slot: 'SF', eligible: ['SF'] },
    { slot: 'PF', eligible: ['PF'] },
    { slot: 'C', eligible: ['C'] },
    { slot: 'G', eligible: ['PG', 'SG'] },
    { slot: 'F', eligible: ['SF', 'PF'] },
    { slot: 'UTIL', eligible: ['PG', 'SG', 'SF', 'PF', 'C'] }
  ],
  wnba: [
    { slot: 'G1', eligible: ['PG', 'SG'] },
    { slot: 'G2', eligible: ['PG', 'SG'] },
    { slot: 'F1', eligible: ['SF', 'PF'] },
    { slot: 'F2', eligible: ['SF', 'PF'] },
    { slot: 'UTIL1', eligible: ['PG', 'SG', 'SF', 'PF', 'C'] },
    { slot: 'UTIL2', eligible: ['PG', 'SG', 'SF', 'PF', 'C'] }
  ],
  nfl: [
    { slot: 'QB', eligible: ['QB'] },
    { slot: 'RB1', eligible: ['RB'] },
    { slot: 'RB2', eligible: ['RB'] },
    { slot: 'WR1', eligible: ['WR'] },
    { slot: 'WR2', eligible: ['WR'] },
    { slot: 'WR3', eligible: ['WR'] },
    { slot: 'TE', eligible: ['TE'] },
    { slot: 'FLEX', eligible: ['RB', 'WR', 'TE'] },
    { slot: 'DST', eligible: ['DST', 'DEF'] }
  ],
  mlb: [
    { slot: 'P1', eligible: ['P', 'SP', 'RP'] },
    { slot: 'P2', eligible: ['P', 'SP', 'RP'] },
    { slot: 'C', eligible: ['C'] },
    { slot: '1B', eligible: ['1B'] },
    { slot: '2B', eligible: ['2B'] },
    { slot: '3B', eligible: ['3B'] },
    { slot: 'SS', eligible: ['SS'] },
    { slot: 'OF1', eligible: ['OF'] },
    { slot: 'OF2', eligible: ['OF'] },
    { slot: 'OF3', eligible: ['OF'] }
  ]
};

export function generateLineups(
  roster: LineupPlayerDraft[],
  sport: string,
  contestType: string,
  excludedPlayers: string[],
  riskTolerance: string
): DraftLineup[] {
  const excludedLower = excludedPlayers.map(normalizePlayerName);
  const mlbHasHitterStarterContext = sport === 'mlb' ? hasMlbHitterStarterContext(roster) : false;

  // Filter roster: remove unavailable players and manual exclusions.
  const eligiblePlayers = roster.filter(
    (p) => LINEUP_ELIGIBLE_INJURY_STATUSES.has(p.injury_status)
      && !excludedLower.includes(normalizePlayerName(p.name ?? ''))
      && isPlayerEligibleForConfirmedRole(p, sport, mlbHasHitterStarterContext)
  );

  // Sort by recent production (used as a proxy for confidence when picking within a slot)
  const sortedPlayers = [...eligiblePlayers].sort(
    (a, b) => (b.last_5_avg_pts || 0) - (a.last_5_avg_pts || 0)
  );

  // Generate candidate lineups
  const candidates: DraftLineup[] =
    contestType === 'showdown'
      ? generateShowdownLineups(sortedPlayers, sport)
      : generateClassicLineups(sortedPlayers, sport);

  // Score and rank by highest probable total fantasy points.
  const rankedLineups = candidates
    .filter((lineup) => validateLineup(lineup, contestType))
    .map((lineup) => ({
      ...lineup,
      confidence_score: calculateLineupConfidence(lineup)
    }))
    .sort((a, b) => lineupRankScore(b) - lineupRankScore(a))
    .slice(0, 5); // Top 5

  // Return the highest expected-FPTS lineups; risk tolerance affects the number shown.
  if (riskTolerance === 'aggressive') {
    return rankedLineups; // Keep all
  }
  return rankedLineups.slice(0, 3); // Conservative/balanced: top 3
}

function generateShowdownLineups(players: LineupPlayerDraft[], _sport: string): DraftLineup[] {
  const lineups: DraftLineup[] = [];
  const signatures = new Set<string>();
  const salaryCapShowdown = 50000;
  const topCaptains = [...players].sort((a, b) => playerValueScore(b) - playerValueScore(a)).slice(0, 12);

  for (const captain of topCaptains) {
    const captainWithMultiplier: LineupPlayerDraft = {
      ...captain,
      base_salary: captain.base_salary ?? captain.salary,
      salary: Math.floor(captain.salary * 1.5),
      salary_multiplier: 1.5,
      roster_slot: 'CPT',
      projected_points: (captain.last_5_avg_pts || captain.projected_points || 0) * 1.5
    };

    const remainingSalary = salaryCapShowdown - captainWithMultiplier.salary;
    const fieldCandidates = players
      .filter((p) => p.player_id !== captain.player_id)
      .filter((p) => p.salary <= remainingSalary)
      .sort((a, b) => playerValueScore(b) - playerValueScore(a))
      .slice(0, 30);

    function search(startIndex: number, selected: LineupPlayerDraft[], salaryUsed: number) {
      if (lineups.length >= 50) return;
      if (selected.length === 5) {
        const lineupPlayers = [
          captainWithMultiplier,
          ...selected.map((player) => ({
            ...player,
            base_salary: player.base_salary ?? player.salary,
            salary_multiplier: 1,
            roster_slot: 'FLEX'
          }))
        ];
        if (uniqueTeams(lineupPlayers).length < 2) return;
        const signature = lineupPlayers.map((player) => player.player_id).sort().join('|');
        if (signatures.has(signature)) return;
        signatures.add(signature);
        lineups.push({
          players: lineupPlayers,
          projected_points: calculateProjectedPoints(lineupPlayers),
          salary_used: salaryUsed,
          confidence_score: 0,
          constraint_violations: []
        });
        return;
      }

      for (let index = startIndex; index < fieldCandidates.length; index += 1) {
        const candidate = fieldCandidates[index];
        if (salaryUsed + candidate.salary > salaryCapShowdown) continue;
        selected.push(candidate);
        search(index + 1, selected, salaryUsed + candidate.salary);
        selected.pop();
        if (lineups.length >= 50) return;
      }
    }

    if (captainWithMultiplier.salary <= salaryCapShowdown) {
      search(0, [], captainWithMultiplier.salary);
    }
  }

  return lineups;
}

function generateClassicLineups(players: LineupPlayerDraft[], sport: string): DraftLineup[] {
  const slots = ROSTER_SLOTS[sport];
  if (!slots) return [];

  const lineups: DraftLineup[] = [];
  const signatures = new Set<string>();
  let iterations = 0;
  const maxIterations = 200_000;
  const candidateLists = slots.map((slotDef) => players
    .filter((player) => playerEligibleForSlot(player, slotDef))
    .sort((a, b) => playerValueScore(b) - playerValueScore(a))
    .slice(0, 30));

  function search(slotIndex: number, selected: LineupPlayerDraft[], usedIds: Set<string>, salaryUsed: number) {
    iterations += 1;
    if (iterations > maxIterations || lineups.length >= 50) return;

    if (slotIndex === slots.length) {
      const signature = selected.map((player) => player.player_id).sort().join('|');
      if (signatures.has(signature)) return;
      signatures.add(signature);
      lineups.push({
        players: [...selected],
        projected_points: calculateProjectedPoints(selected),
        salary_used: salaryUsed,
        confidence_score: 0,
        constraint_violations: []
      });
      return;
    }

    for (const candidate of candidateLists[slotIndex]) {
      if (usedIds.has(candidate.player_id)) continue;
      if (salaryUsed + candidate.salary > 50000) continue;

      selected.push({ ...candidate, roster_slot: slots[slotIndex].slot, salary_multiplier: 1, base_salary: candidate.base_salary ?? candidate.salary });
      usedIds.add(candidate.player_id);
      search(slotIndex + 1, selected, usedIds, salaryUsed + candidate.salary);
      usedIds.delete(candidate.player_id);
      selected.pop();

      if (iterations > maxIterations || lineups.length >= 50) return;
    }
  }

  search(0, [], new Set<string>(), 0);
  return lineups;
}

function playerValueScore(player: LineupPlayerDraft): number {
  const projected = player.projected_points || player.last_5_avg_pts || 0;
  const salary = Math.max(player.salary, 1);
  const contextBoost = (player.context_score ?? 0) * 2.5;
  const newsBoost = (player.news_score ?? 0) * 0.8;
  return projected * 0.7 + (projected / salary) * 10000 * 0.3 + contextBoost + newsBoost;
}

function playerEligibleForSlot(player: LineupPlayerDraft, slotDef: RosterSlot): boolean {
  return String(player.position ?? '')
    .split('/')
    .map((position) => position.trim())
    .some((position) => slotDef.eligible.includes(position));
}

function calculateProjectedPoints(players: LineupPlayerDraft[]): number {
  // Sum of player average fantasy points
  return players.reduce((sum, p) => sum + (p.projected_points || p.last_5_avg_pts || 0), 0);
}

function validateLineup(lineup: DraftLineup, contestType: string): boolean {
  const violations: string[] = [];
  if (lineup.salary_used > 50000) violations.push('salary cap exceeded');
  if (lineup.players.length === 0) violations.push('no players selected');
  if (new Set(lineup.players.map((player) => player.player_id)).size !== lineup.players.length) {
    violations.push('duplicate player selected');
  }
  if (contestType === 'showdown' && uniqueTeams(lineup.players).length < 2) {
    violations.push('showdown lineups must include players from both teams');
  }
  if (lineup.projected_points <= 0) violations.push('projected points must be positive');
  if (lineup.players.some((player) => !player.position || !player.name || player.salary <= 0)) {
    violations.push('player missing required fields');
  }

  lineup.constraint_violations = violations;
  if (violations.length) {
    console.warn('Lineup validation failed:', violations, lineup);
    return false;
  }
  return true;
}

function isPlayerEligibleForConfirmedRole(player: LineupPlayerDraft, sport: string, hasHitterStarterContext = true): boolean {
  if (sport !== 'mlb') return true;
  if (/^(P|SP|RP)$/.test(String(player.position ?? '').toUpperCase())) return player.own_probable_starter === true;
  if (typeof player.confirmed_starter === 'boolean' && !player.confirmed_starter) return false;
  if (!hasHitterStarterContext) return true;
  return hasConfirmedMlbBattingRole(player);
}

function hasConfirmedMlbBattingRole(player: LineupPlayerDraft): boolean {
  if (player.confirmed_starter !== true) return false;
  return true;
}

function hasMlbHitterStarterContext(players: LineupPlayerDraft[]): boolean {
  return players.some((player) => !/^(P|SP|RP)$/.test(String(player.position ?? '').toUpperCase()) && typeof player.confirmed_starter === 'boolean');
}

function uniqueTeams(players: LineupPlayerDraft[]): string[] {
  return [...new Set(players.map((player) => String(player.team ?? '').toUpperCase()).filter(Boolean))];
}

function calculateLineupConfidence(lineup: DraftLineup): number {
  if (!lineup.players.length) return 0;
  const avgConfidence = lineup.players.reduce((sum, player) => sum + (player.confidence_score ?? 0.5), 0) / lineup.players.length;
  const injuryCount = lineup.players.filter((player) => player.injury_status !== 'active').length;
  return Math.min(Math.max(avgConfidence - injuryCount * 0.05, 0), 1);
}

function lineupRankScore(lineup: DraftLineup): number {
  const expectedFpts = lineup.simulation_ev ?? lineup.projected_points;
  const ceiling = lineup.ceiling_score ?? lineup.projected_points;
  return expectedFpts * 100 + ceiling * 0.4 + lineup.confidence_score * 2;
}
