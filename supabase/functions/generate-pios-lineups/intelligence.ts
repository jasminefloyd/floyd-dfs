import { dkFantasyPoints, type DkRole, type DkSport } from '../_shared/dkScoring.ts';

export type PiosHomeAway = 'home' | 'away' | 'unknown';

export interface PiosRecentGame {
  date?: string;
  fantasy_points?: number;
  fantasy_pts?: number;
  minutes?: number;
  usage_rate?: number;
  [key: string]: unknown;
}

export interface PiosFormMetrics {
  last_3_avg: number | null;
  last_5_avg: number | null;
  last_10_avg: number | null;
  season_to_date_avg: number | null;
  recency_weighted_avg: number | null;
  trend: 'up' | 'down' | 'stable' | 'unknown';
  opportunity_trend: 'up' | 'down' | 'stable' | 'unknown';
  sample_size: number;
  source: string;
  is_synthetic: boolean;
}

export interface PiosNewsEvidence {
  summary?: string;
  score: number;
  impact_type: 'availability' | 'role' | 'performance' | 'sentiment' | 'unknown';
  confirmed: boolean;
  is_speculative: boolean;
  reliability: number;
  source: string;
  observed_at?: string;
}

export interface PiosRelationship {
  player_id: string;
  related_player_id: string;
  type: 'same_team' | 'same_game' | 'stack' | 'bringback' | 'opposing' | 'sequence';
  direction: 'positive' | 'negative' | 'neutral';
  strength: number;
  source: 'derived_from_slate_context' | 'historical_pair_data';
  sample_size: number;
  validated: boolean;
}

export interface PiosScenario {
  key: 'high_total' | 'favorite_control' | 'underdog_comeback' | 'close_game' | 'blowout_risk' | 'neutral';
  confidence: number;
  evidence: string[];
}

function roleForPosition(position?: string): DkRole | undefined {
  const normalized = String(position ?? '').toUpperCase();
  if (normalized === 'DST' || normalized === 'DEF' || normalized === 'D/ST') return 'dst';
  if (normalized === 'K') return 'kicker';
  if (['P', 'SP', 'RP'].includes(normalized)) return 'pitcher';
  if (normalized) return 'hitter';
  return undefined;
}

export function deriveFormMetrics(stats?: { avg_fantasy_pts?: number; games_sample_size?: number; is_synthetic?: boolean; games?: PiosRecentGame[] }, sport?: string, position?: string): PiosFormMetrics {
  const normalizedSport = String(sport ?? '').toLowerCase();
  const games = (stats?.games ?? []).map((game) => {
    const supplied = Number(game.fantasy_points ?? game.fantasy_pts);
    if (Number.isFinite(supplied)) return supplied;
    if (['nba', 'wnba', 'nfl', 'mlb'].includes(normalizedSport)) return dkFantasyPoints(game as Record<string, number>, normalizedSport as DkSport, roleForPosition(position));
    return NaN;
  }).filter(Number.isFinite).slice(0, 5);
  const fallback = Number(stats?.avg_fantasy_pts);
  const values = games.length ? games : Number.isFinite(fallback) ? [fallback] : [];
  if (!values.length) return { last_3_avg: null, last_5_avg: null, last_10_avg: null, season_to_date_avg: null, recency_weighted_avg: null, trend: 'unknown', opportunity_trend: 'unknown', sample_size: 0, source: 'unavailable', is_synthetic: true };
  const orderedGames = [...(stats?.games ?? [])].sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
  const orderedValues = orderedGames.map((game) => Number(game.fantasy_points ?? game.fantasy_pts)).filter(Number.isFinite).length ? orderedGames.map((game) => {
    const supplied = Number(game.fantasy_points ?? game.fantasy_pts);
    return Number.isFinite(supplied) ? supplied : NaN;
  }).filter(Number.isFinite) : values;
  const avg = (items: number[]) => items.length ? items.reduce((sum, value) => sum + value, 0) / items.length : null;
  const recent = orderedValues.slice(0, 3);
  const weights = [0.4, 0.25, 0.18, 0.11, 0.06];
  const weighted = orderedValues.reduce((sum, value, index) => sum + value * (weights[index] ?? 0), 0) / weights.slice(0, orderedValues.length).reduce((sum, value) => sum + value, 0);
  const trendDelta = orderedValues.length >= 4 ? avg(orderedValues.slice(0, 2))! - avg(orderedValues.slice(-2))! : 0;
  const opportunityValues = orderedGames.map((game) => Number(game.minutes ?? game.snap_count ?? game.targets ?? game.at_bats)).filter(Number.isFinite);
  const opportunityDelta = opportunityValues.length >= 4 ? avg(opportunityValues.slice(0, 2))! - avg(opportunityValues.slice(-2))! : 0;
  return {
    last_3_avg: Number((avg(recent) ?? 0).toFixed(2)),
    last_5_avg: Number((avg(orderedValues.slice(0, 5)) ?? 0).toFixed(2)),
    last_10_avg: orderedValues.length >= 10 ? Number((avg(orderedValues.slice(0, 10)) ?? 0).toFixed(2)) : null,
    season_to_date_avg: null,
    recency_weighted_avg: Number(weighted.toFixed(2)),
    trend: Math.abs(trendDelta) < 1 ? 'stable' : trendDelta > 0 ? 'up' : 'down',
    opportunity_trend: Math.abs(opportunityDelta) < 1 ? 'stable' : opportunityDelta > 0 ? 'up' : 'down',
    sample_size: orderedValues.length,
    source: stats?.games?.length ? `MIOS recent game logs (${normalizedSport || 'unknown'} DK scoring)` : 'MIOS aggregate fallback',
    is_synthetic: Boolean(stats?.is_synthetic) || !stats?.games?.length,
  };
}

export function deriveNewsEvidence(score?: number, note?: string, observedAt?: string, events: Array<{ headline?: string; source?: string; published_at?: string; impact_type?: string; confirmed?: boolean; is_speculative?: boolean }> = []): PiosNewsEvidence {
  const text = String(events[0]?.headline ?? note ?? '').trim();
  const lower = text.toLowerCase();
  const confirmed = /confirmed|official|will start|starting|active|out|ruled out/.test(lower);
  const impact_type = /injur|out|questionable|illness|return/.test(lower)
    ? 'availability' : /start|rotation|minutes|snap|batting order|role/.test(lower)
      ? 'role' : /prop|projection|form|performance/.test(lower) ? 'performance' : text ? 'sentiment' : 'unknown';
  const event = events[0];
  return { summary: text || undefined, score: Number(score ?? 0), impact_type: (event?.impact_type as PiosNewsEvidence['impact_type']) ?? impact_type, confirmed: event?.confirmed ?? confirmed, is_speculative: event?.is_speculative ?? (Boolean(text) && !confirmed), reliability: event ? (event.confirmed ? 0.85 : 0.35) : confirmed ? 0.8 : text ? 0.35 : 0, source: event?.source ?? 'MIOS aggregated news context', observed_at: event?.published_at ?? observedAt };
}

export function deriveRelationships(players: Array<{ id: string; team?: string; position?: string; opponent_team?: string; game_id?: string; batting_order?: number }>, sport: string): PiosRelationship[] {
  const edges: PiosRelationship[] = [];
  const add = (a: typeof players[number], b: typeof players[number], type: PiosRelationship['type'], direction: PiosRelationship['direction'], strength: number) => edges.push({ player_id: a.id, related_player_id: b.id, type, direction, strength, source: 'derived_from_slate_context', sample_size: 0, validated: false });
  for (let i = 0; i < players.length; i += 1) for (let j = i + 1; j < players.length; j += 1) {
    const a = players[i]; const b = players[j];
    const sameTeam = a.team && b.team && a.team.toUpperCase() === b.team.toUpperCase();
    const sameGame = a.game_id && b.game_id && a.game_id === b.game_id;
    if (sport === 'mlb' && sameGame && String(a.position).match(/^(P|SP|RP)$/i) && a.opponent_team && b.team && a.opponent_team.toUpperCase() === b.team.toUpperCase()) { add(a, b, 'opposing', 'negative', 0.22); add(b, a, 'opposing', 'negative', 0.22); }
    else if (sport === 'nfl' && sameTeam && ([a.position, b.position].some((p) => p === 'QB')) && [a.position, b.position].some((p) => ['WR', 'TE'].includes(String(p)))) { add(a, b, 'stack', 'positive', 0.28); add(b, a, 'stack', 'positive', 0.28); }
    else if (sport === 'mlb' && sameTeam && a.batting_order && b.batting_order && Math.abs(a.batting_order - b.batting_order) <= 2) { add(a, b, 'sequence', 'positive', 0.16); add(b, a, 'sequence', 'positive', 0.16); }
    else if (sameGame && !sameTeam) { add(a, b, 'same_game', 'positive', 0.08); add(b, a, 'same_game', 'positive', 0.08); }
    else if (sameTeam) { add(a, b, 'same_team', 'positive', sport === 'mlb' ? 0.1 : 0.06); add(b, a, 'same_team', 'positive', sport === 'mlb' ? 0.1 : 0.06); }
  }
  return edges;
}

export function deriveScenario(players: Array<{ implied_total?: number; spread?: number; home_away?: PiosHomeAway }>, sport: string): PiosScenario {
  const totals = players.map((p) => Number(p.implied_total)).filter(Number.isFinite);
  const spreads = players.map((p) => Number(p.spread)).filter(Number.isFinite);
  const averageTotal = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null;
  const averageSpread = spreads.length ? spreads.reduce((a, b) => a + b, 0) / spreads.length : null;
  if (averageTotal !== null && averageTotal >= (sport === 'mlb' ? 9 : sport === 'nfl' ? 47 : 225)) return { key: 'high_total', confidence: 0.62, evidence: [`implied total average ${averageTotal.toFixed(1)}`] };
  if (averageSpread !== null && Math.abs(averageSpread) >= 7) return { key: 'blowout_risk', confidence: 0.58, evidence: [`spread magnitude ${Math.abs(averageSpread).toFixed(1)}`] };
  if (averageSpread !== null && averageSpread > 3) return { key: 'favorite_control', confidence: 0.5, evidence: [`favorite spread ${averageSpread.toFixed(1)}`] };
  if (averageSpread !== null && averageSpread < -3) return { key: 'underdog_comeback', confidence: 0.42, evidence: [`underdog spread ${averageSpread.toFixed(1)}`] };
  if (averageSpread !== null && Math.abs(averageSpread) <= 3) return { key: 'close_game', confidence: 0.55, evidence: [`spread magnitude ${Math.abs(averageSpread).toFixed(1)}`] };
  return { key: 'neutral', confidence: 0.3, evidence: ['insufficient structured game-environment evidence'] };
}

export function relationshipScore(playerIds: string[], edges: PiosRelationship[]): number {
  const ids = new Set(playerIds);
  return Number(edges.filter((edge) => ids.has(edge.player_id) && ids.has(edge.related_player_id)).reduce((sum, edge) => sum + (edge.direction === 'negative' ? -edge.strength : edge.strength), 0).toFixed(2));
}

export function evaluateRelationship(predictedCorrelation: number, firstOutcomes: number[], secondOutcomes: number[]): { sample_size: number; realized_correlation: number | null; absolute_error: number | null; status: 'validated' | 'insufficient_sample' } {
  const pairs = firstOutcomes.map((value, index) => [Number(value), Number(secondOutcomes[index])] as const).filter(([first, second]) => Number.isFinite(first) && Number.isFinite(second));
  if (pairs.length < 20) return { sample_size: pairs.length, realized_correlation: null, absolute_error: null, status: 'insufficient_sample' };
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const firstMean = mean(pairs.map(([first]) => first)); const secondMean = mean(pairs.map(([, second]) => second));
  const numerator = pairs.reduce((sum, [first, second]) => sum + (first - firstMean) * (second - secondMean), 0);
  const denominator = Math.sqrt(pairs.reduce((sum, [first]) => sum + (first - firstMean) ** 2, 0) * pairs.reduce((sum, [, second]) => sum + (second - secondMean) ** 2, 0));
  const realized = denominator > 0 ? Number((numerator / denominator).toFixed(4)) : 0;
  return { sample_size: pairs.length, realized_correlation: realized, absolute_error: Number(Math.abs(realized - predictedCorrelation).toFixed(4)), status: 'validated' };
}
