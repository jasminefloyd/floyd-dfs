import type { GameScript } from './decisionContracts.ts';

export interface SportDecisionFeatures {
  version: 'sport-reasoning-v1';
  sport: 'nba' | 'nfl' | 'golf';
  role: string;
  healthy_role: string;
  availability: { status: string; confirmed: boolean; restriction_probability: number; source_confidence: number };
  opportunity: Record<string, number | null>;
  environment: Record<string, number | string | null>;
  distribution: { p10: number | null; p50: number | null; p90: number | null; standard_deviation: number | null };
  uncertainty: string[];
  correlation_tags: string[];
  source: 'sport_reasoning_model';
}

type ReasoningPlayer = Record<string, unknown>;

function number(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function value(player: ReasoningPlayer, ...keys: string[]): number | null {
  for (const key of keys) {
    const parsed = number(player[key]);
    if (parsed !== null) return parsed;
  }
  return null;
}

function availability(player: ReasoningPlayer) {
  const status = String(player.injury_status ?? 'active');
  const confirmed = player.confirmed_starter === true || player.own_probable_starter === true || status === 'active';
  const restrictionProbability = status === 'out' ? 1 : status === 'doubtful' ? 0.75 : status === 'questionable' || status === 'day_to_day' ? 0.4 : 0.05;
  return { status, confirmed, restriction_probability: restrictionProbability, source_confidence: player.injury_note ? 0.72 : 0.45 };
}

function distribution(player: ReasoningPlayer, mean: number | null, stdev: number | null) {
  const center = mean ?? value(player, 'projected_points', 'last_5_avg_pts') ?? 0;
  const spread = Math.max(stdev ?? center * 0.3, 1);
  return { p10: Number(Math.max(0, center - 1.282 * spread).toFixed(2)), p50: Number(center.toFixed(2)), p90: Number((center + 1.282 * spread).toFixed(2)), standard_deviation: Number(spread.toFixed(2)) };
}

export function buildSportDecisionFeatures(sport: 'nba' | 'nfl' | 'golf', player: ReasoningPlayer, teammates: ReasoningPlayer[] = []): SportDecisionFeatures {
  const status = availability(player);
  const projected = value(player, 'projected_points', 'last_5_avg_pts');
  const stdev = value(player, 'stdev_fantasy_pts');
  const spread = value(player, 'spread');
  const impliedTotal = value(player, 'implied_total');
  const position = String(player.position ?? '').toUpperCase();
  const recentStats = player.last_5_stats as Record<string, unknown> | undefined;
  const recent = Array.isArray(recentStats?.games) ? recentStats.games as ReasoningPlayer[] : [];
  const snap = value(player, 'snap_count', 'snap_share') ?? value(recent[0] ?? {}, 'snap_count', 'snaps', 'snap_share');
  const usage = value(player, 'usage_rate', 'target_share', 'carry_share', 'route_participation');
  const unavailableTeammates = teammates.filter((item) => ['out', 'doubtful'].includes(String(item.injury_status))).map((item) => String(item.name ?? 'teammate')).filter(Boolean);
  const uncertainty: string[] = [];
  if (!status.confirmed) uncertainty.push('availability or role is not fully confirmed');
  if (status.restriction_probability >= 0.4) uncertainty.push('questionable status creates a restricted-role branch');
  if (spread !== null && Math.abs(spread) >= (sport === 'nfl' ? 10 : 8)) uncertainty.push('wide spread creates game-script risk');
  if (sport === 'golf' && player.tee_time == null) uncertainty.push('tee time is unavailable');
  const tags = [
    sport === 'nba' && position.startsWith('PG') ? 'primary_ball_handler_path' : '',
    sport === 'nba' && (usage ?? 0) >= 0.24 ? 'high_usage_creator' : '',
    sport === 'nfl' && position === 'QB' ? 'quarterback_stack_anchor' : '',
    sport === 'nfl' && (usage ?? 0) >= 0.2 ? 'concentrated_skill_usage' : '',
    sport === 'nfl' && snap !== null && snap < 0.7 ? 'unstable_snap_role' : '',
    sport === 'golf' && String(player.golf_wave ?? '').toLowerCase() === 'am' ? 'am_wave' : sport === 'golf' && player.golf_wave ? 'pm_wave' : '',
    unavailableTeammates.length ? 'injury_on_off_contingency' : '',
  ].filter(Boolean);
  const role = sport === 'nba'
    ? (unavailableTeammates.length ? 'injury_replacement' : (usage ?? 0) >= 0.24 ? 'primary_creator' : player.confirmed_starter === true ? 'starter' : 'bench')
    : sport === 'nfl'
      ? (position === 'QB' ? 'quarterback' : unavailableTeammates.length ? 'injury_replacement' : position === 'RB' ? 'backfield_role' : position === 'WR' || position === 'TE' ? 'receiving_role' : position === 'DST' || position === 'DEF' ? 'defense' : 'skill_role')
      : (value(player, 'made_cut_probability') ?? 0.5) >= 0.7 ? 'made_cut_stability' : 'ceiling_or_birdie_upside';
  const opportunity: Record<string, number | null> = sport === 'nba'
    ? { usage: value(player, 'usage_rate'), minutes: value(player, 'minutes_projection', 'minutes_avg'), assists: value(player, 'assists', 'assist_rate'), rebounds: value(player, 'rebounds', 'rebound_rate'), stocks: value(player, 'stocks', 'steals_blocks') }
    : sport === 'nfl'
      ? { expected_plays: value(player, 'expected_plays', 'plays'), pass_rate: value(player, 'pass_rate'), snap_share: snap, route_participation: value(player, 'route_participation'), target_share: value(player, 'target_share'), carry_share: value(player, 'carry_share'), red_zone_share: value(player, 'red_zone_share') }
      : { made_cut_probability: value(player, 'made_cut_probability'), birdie_rate: value(player, 'birdie_rate'), eagle_rate: value(player, 'eagle_rate'), finish_position: value(player, 'finish_position'), course_fit: value(player, 'course_fit_score') };
  const environment: Record<string, number | string | null> = sport === 'golf'
    ? { wave: player.golf_wave ? String(player.golf_wave) : null, wind: value(player, 'wind_speed', 'wind'), precipitation: value(player, 'precipitation'), course_difficulty: value(player, 'course_difficulty'), implied_total: impliedTotal }
    : { implied_total: impliedTotal, spread, close_game_probability: spread === null ? 0.5 : Math.max(0.05, Math.min(0.95, 1 - Math.abs(spread) / (sport === 'nfl' ? 21 : 14))), blowout_risk: spread === null ? 0.15 : Math.max(0, Math.min(0.9, (Math.abs(spread) - (sport === 'nfl' ? 7 : 6)) / 10)), overtime_probability: spread === null ? 0.05 : Math.max(0.03, 0.1 - Math.abs(spread) * 0.004) };
  return { version: 'sport-reasoning-v1', sport, role, healthy_role: String(player.role_stability ?? 'baseline'), availability: status, opportunity, environment, distribution: distribution(player, projected, stdev), uncertainty, correlation_tags: tags, source: 'sport_reasoning_model' };
}

export function buildSportGameScripts(sport: 'nba' | 'nfl' | 'golf', games: Array<Record<string, unknown>>, players: ReasoningPlayer[], evidenceIds: string[]): GameScript[] {
  const totals = games.map((game) => number(game.total ?? game.over_under)).filter((item): item is number => item !== null);
  const spreads = games.map((game) => Math.abs(number(game.spread) ?? 0)).filter((item) => item > 0);
  const high = totals.length ? totals.reduce((sum, item) => sum + item, 0) / totals.length >= (sport === 'nfl' ? 46 : 224) : false;
  const close = spreads.length ? spreads.reduce((sum, item) => sum + item, 0) / spreads.length <= (sport === 'nfl' ? 6 : 6) : true;
  const replacement = players.some((player) => ['out', 'doubtful'].includes(String(player.injury_status)));
  if (sport === 'golf') return golfScripts(evidenceIds, high);
  if (sport === 'nba') return normalizeScripts([
    script('nba_competitive_high_total', 'Competitive high-total game preserves starter minutes and multiplies correlated creator outcomes.', ['Elevated total or pace signal.', 'Game remains competitive.'], ['Blowout or late scratch changes the rotation.'], ['Prefer primary creators, high-minute starters, and correlated assist/rebound partners.'], 0.24, evidenceIds),
    script('nba_favorite_control', 'Favorite controls the game while its stars retain enough workload to separate.', ['Meaningful favorite spread.', 'Core starters remain active.'], ['Game stays close or rotation news changes.'], ['Concentrate on favorite creators and use selective opponent run-backs.'], 0.16, evidenceIds),
    script('nba_blowout_bench_value', 'Blowout creates bench value and reduces expensive starter closing minutes.', ['Wide spread or blowout signal.'], ['Competitive fourth quarter.'], ['Prefer rotation-secure value and discount fragile starter ceilings.'], 0.16, evidenceIds),
    script('nba_underdog_creator', 'Underdog primary creators exceed baseline through concentrated usage and competitive minutes.', ['Underdog remains competitive.', 'Usage is concentrated.'], ['Early blowout or foul trouble.'], ['Use primary ball handlers and high-touch creators.'], 0.14, evidenceIds),
    script('nba_injury_replacement', 'An absence redistributes minutes, usage, assists, rebounds, and stocks to identified replacements.', ['Material absence is confirmed.'], ['Inactive player returns without a restriction.'], ['Use replacements with a demonstrated role path.'], replacement ? 0.2 : 0.1, evidenceIds),
    script('nba_overtime_ceiling', 'A close game reaches extended minutes and amplifies high-minute creators.', ['Close-game context.', 'Core players remain active.'], ['Blowout or foul-driven restriction.'], ['Favor durable creators with multiple counting-stat paths.'], close ? 0.1 : 0.04, evidenceIds),
  ], sport);
  return normalizeScripts([
    script('nfl_shootout_stack', 'High-scoring game concentrates passing volume and correlated touchdown outcomes.', ['Elevated total.', 'Quarterbacks and primary skill roles are confirmed.'], ['Weather or defensive pressure suppresses passing.'], ['QB with primary receiver and opposing bring-back.'], 0.25, evidenceIds),
    script('nfl_favorite_control', 'Favorite controls the game through lead-back volume and efficient red-zone work.', ['Favorite has a meaningful edge.', 'Lead back role is secure.'], ['Underdog comeback or committee uncertainty.'], ['Pair favorite quarterback or defense with lead-back exposure deliberately.'], 0.17, evidenceIds),
    script('nfl_underdog_comeback', 'Underdog comeback forces pass volume into concentrated targets.', ['Underdog trails but remains live.', 'Target roles are concentrated.'], ['Favorite controls possession throughout.'], ['Use underdog QB with primary targets and selective bring-backs.'], 0.15, evidenceIds),
    script('nfl_defensive_game', 'Low-scoring conditions elevate sacks, turnovers, and defense-led outcomes.', ['Low total or defensive matchup.', 'Pressure/turnover signals exist.'], ['Shootout pace and clean protection.'], ['Use compatible defenses and avoid unsupported offensive concentration.'], 0.14, evidenceIds),
    script('nfl_weather_rushing', 'Wind or precipitation shifts expected plays toward rushing and short-area usage.', ['Material weather signal.', 'Rushing roles are stable.'], ['Indoor/roof conditions or weather clears.'], ['Prioritize backs, mobile quarterbacks, and defenses.'], 0.14, evidenceIds),
    script('nfl_injury_redistribution', 'An absence reallocates snaps, routes, targets, or carries to a named replacement.', ['Material skill or line absence.', 'Replacement role is supported.'], ['Expected player is active without restriction.'], ['Use replacement only when role evidence supports the volume.'], replacement ? 0.15 : 0.08, evidenceIds),
  ], sport);
}

function script(scriptKey: string, thesis: string, required: string[], opposing: string[], inclusion: string[], probability: number, evidenceIds: string[]): GameScript {
  return { script_key: scriptKey, thesis, required_conditions: required, opposing_conditions: opposing, team_exposure_targets: {}, player_inclusion_rules: inclusion, player_exclusion_rules: ['Avoid players whose role depends on unsupported assumptions.'], probability, evidence_ids: evidenceIds, confidence: evidenceIds.length ? 0.58 : 0.38, uncertainty: ['Late news can invalidate the branch.'] };
}

function normalizeScripts(scripts: GameScript[], sport: string): GameScript[] {
  const total = scripts.reduce((sum, item) => sum + item.probability, 0) || 1;
  return scripts.map((item) => ({ ...item, probability: Number((item.probability / total).toFixed(4)), thesis: `${sport.toUpperCase()}: ${item.thesis}` }));
}

function golfScripts(evidenceIds: string[], difficult: boolean): GameScript[] {
  return normalizeScripts([
    script('golf_calm_scoring', 'Calm scoring event rewards balanced made-cut probability with enough birdie equity.', ['Stable weather and normal scoring.'], ['Difficult conditions or wave separation.'], ['Blend high-skill ball strikers with reliable cut-makers.'], 0.18, evidenceIds),
    script('golf_difficult_cut', 'Difficult course conditions increase cut volatility and reward precision.', ['Course difficulty or cut volatility is elevated.'], ['Easy scoring and high made-cut rates.'], ['Prioritize cut equity and avoid fragile low-floor profiles.'], difficult ? 0.22 : 0.13, evidenceIds),
    script('golf_windy_wave', 'One tee-time wave gains a material weather advantage.', ['Wind or precipitation differs by wave.'], ['Weather remains symmetric.'], ['Concentrate selectively in the advantaged wave without overstacking it.'], 0.17, evidenceIds),
    script('golf_ball_striking', 'Approach and tee-to-green skill dominates putting variance.', ['Course fit favors ball striking.'], ['Putting-driven birdie event.'], ['Prefer course-fit and approach archetypes.'], 0.17, evidenceIds),
    script('golf_birdie_ceiling', 'Birdie/eagle equity matters more than small median differences in tournaments.', ['Scoring is birdie-heavy.'], ['Placement-heavy difficult event.'], ['Trade small median value for validated ceiling and birdie paths.'], 0.16, evidenceIds),
    script('golf_placement_stability', 'Made-cut and placement equity drive a stable portfolio branch.', ['Cut and placement probabilities are reliable.'], ['Withdrawal or weather uncertainty.'], ['Prefer high-floor golfers and diversify course-condition exposure.'], 0.15, evidenceIds),
  ], 'golf');
}

export function explainSportReasoning(player: ReasoningPlayer, features: SportDecisionFeatures): string {
  const name = String(player.name ?? 'Player');
  const uncertainty = features.uncertainty.length ? ` Risk: ${features.uncertainty.join('; ')}.` : '';
  return `${name} is modeled as a ${features.role} with a ${features.distribution.p50 ?? 'modeled'} median and ${features.distribution.p90 ?? 'modeled'} ceiling. Correlations: ${features.correlation_tags.join(', ') || 'none identified'}.${uncertainty}`;
}
