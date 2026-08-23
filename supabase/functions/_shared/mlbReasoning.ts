import type { GameScript } from './decisionContracts.ts';

export interface MlbSplitStats {
  sample_size: number;
  k_rate: number | null;
  bb_rate: number | null;
  hr_rate: number | null;
  woba: number | null;
  iso: number | null;
  xwoba: number | null;
  xslg: number | null;
  barrel_rate: number | null;
  hard_hit_rate: number | null;
  exit_velocity: number | null;
  launch_angle: number | null;
}

export interface MlbDecisionFeatures {
    version: 'mlb-reasoning-v1';
  role: 'pitcher' | 'hitter';
  handedness_split?: 'vs_lhp' | 'vs_rhp' | 'unknown';
  season: MlbSplitStats;
  recent: MlbSplitStats;
  injury_adjusted: MlbSplitStats;
  pitcher_metrics?: { k_percent: number | null; bb_percent: number | null; hr_per_nine: number | null; xfip: number | null; siera: number | null; woba_allowed: number | null; iso_allowed: number | null; barrel_rate_allowed: number | null };
  hitter_metrics?: { woba: number | null; iso: number | null; k_percent: number | null; bb_percent: number | null; xwoba: number | null; xslg: number | null; barrel_rate: number | null; hard_hit_rate: number | null; exit_velocity: number | null; launch_angle: number | null };
  pitch_type_edges: Record<string, number>;
  projected_plate_appearances: number | null;
  projected_innings: number | null;
  projected_strikeouts: { p10: number | null; p50: number | null; p90: number | null };
  early_exit_probability: number | null;
  times_through_order_risk: number | null;
  home_run_probability: number | null;
  hit_probability: number | null;
  double_probability: number | null;
  rbi_probability: number | null;
  run_probability: number | null;
  walk_probability: number | null;
  stolen_base_probability: number | null;
  matchup_edge: number | null;
  shrinkage_weight: number;
  notes: string[];
  source: 'observed_and_shrunk' | 'modeled_inputs';
}

export interface MlbGameScriptContext {
  game_id?: string;
  home_team?: string;
  away_team?: string;
  home_implied?: number | null;
  away_implied?: number | null;
  total?: number | null;
  run_factor?: number | null;
  weather_factor?: number | null;
  weather_note?: string | null;
  bullpen_freshness?: Record<string, number>;
}

export interface MlbScriptPlayer {
  id: string;
  name: string;
  team: string;
  position: string;
  batting_order?: number;
  projected_points?: number;
  ownership_projection?: number;
  confirmed_starter?: boolean;
  own_probable_starter?: boolean;
  mlb_decision_features?: MlbDecisionFeatures;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function emptySplit(sampleSize = 0): MlbSplitStats {
  return { sample_size: sampleSize, k_rate: null, bb_rate: null, hr_rate: null, woba: null, iso: null, xwoba: null, xslg: null, barrel_rate: null, hard_hit_rate: null, exit_velocity: null, launch_angle: null };
}

function numberFrom(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) if (finite(row[key])) return Number(row[key]);
  return null;
}

function deriveSplit(games: Array<Record<string, unknown>>, role: 'pitcher' | 'hitter'): MlbSplitStats {
  const usable = games.filter((game) => Object.values(game).some((value) => finite(value)));
  if (!usable.length) return emptySplit();
  const sum = (keys: string[]) => usable.reduce((total, game) => total + (numberFrom(game, keys) ?? 0), 0);
  const denominator = role === 'pitcher' ? sum(['batters_faced', 'bf', 'plate_appearances']) : sum(['plate_appearances', 'pa', 'at_bats', 'ab']);
  const battedBalls = sum(['batted_balls', 'battedBalls', 'balls_in_play', 'bip']);
  const hits = sum(['hits', 'h']);
  const totalBases = sum(['total_bases', 'tb']);
  const walks = sum(['walks', 'bb']);
  const strikeouts = sum(['strikeouts', 'so', 'k']);
  const homeRuns = sum(['home_runs', 'hr']);
  const hardHits = sum(['hard_hits', 'hard_hit']);
  const barrels = sum(['barrels', 'barrel']);
  const average = (keys: string[]) => {
    const values = usable.map((game) => numberFrom(game, keys)).filter(finite);
    return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
  };
  return {
    sample_size: usable.length,
    k_rate: denominator > 0 ? strikeouts / denominator : null,
    bb_rate: denominator > 0 ? walks / denominator : null,
    hr_rate: denominator > 0 ? homeRuns / denominator : null,
    woba: numberFrom({ value: average(['woba', 'wOBA']) }, ['value']) ?? (denominator > 0 ? (hits + walks * 0.7 + homeRuns * 0.3) / denominator : null),
    iso: denominator > 0 ? Math.max(0, (totalBases - hits) / denominator) : null,
    xwoba: average(['xwoba', 'xwOBA']),
    xslg: average(['xslg', 'xSLG']),
    barrel_rate: battedBalls > 0 ? barrels / battedBalls : null,
    hard_hit_rate: battedBalls > 0 ? hardHits / battedBalls : null,
    exit_velocity: average(['exit_velocity', 'ev', 'launch_speed']),
    launch_angle: average(['launch_angle', 'la']),
  };
}

export function shrinkEstimate(observed: number | null, sampleSize: number, prior: number, priorWeight = 50): number {
  if (observed == null || !Number.isFinite(observed)) return prior;
  return (observed * sampleSize + prior * priorWeight) / (sampleSize + priorWeight);
}

function isPitcher(position: string): boolean {
  return /^(P|SP|RP)$/i.test(position);
}

export function buildMlbDecisionFeatures(input: {
  position: string;
  batting_order?: number;
  own_probable_starter?: boolean;
  confirmed_starter?: boolean;
  opposing_probable_pitcher_name?: string;
  last5Games?: Array<Record<string, unknown>>;
  statcastQuality?: { sample_size?: number; quality_score?: number; note?: string };
}): MlbDecisionFeatures {
  const role = isPitcher(input.position) ? 'pitcher' : 'hitter';
  const games = input.last5Games ?? [];
  const recent = deriveSplit(games.slice(-5), role);
  const season = deriveSplit(games, role);
  const notes: string[] = [];
  const sampleSize = season.sample_size;
  if (sampleSize < 10) notes.push('Small sample shrunk toward a sport baseline; do not treat recent rates as stable skill.');
  if (input.statcastQuality?.note) notes.push(input.statcastQuality.note);
  if (input.confirmed_starter === false) notes.push('Hitter is not confirmed in the starting lineup.');
  const shrinkageWeight = sampleSize / (sampleSize + 50);
  const injuryAdjusted = { ...season };
  const split: MlbDecisionFeatures['handedness_split'] = 'unknown';
  const kRate = shrinkEstimate(recent.k_rate, recent.sample_size, role === 'pitcher' ? 0.22 : 0.24);
  const hrRate = shrinkEstimate(recent.hr_rate, recent.sample_size, role === 'pitcher' ? 0.03 : 0.035);
  const matchupEdge = input.statcastQuality?.quality_score != null
    ? clamp(Number(input.statcastQuality.quality_score) - 0.5, -1, 1)
    : null;
  const projectedPlateAppearances = role === 'hitter' && input.batting_order
    ? Number(clamp(4.9 - Math.max(0, input.batting_order - 1) * 0.18, 3.1, 5.2).toFixed(2))
    : null;
  const projectedInnings = role === 'pitcher' && input.own_probable_starter === true ? 5.2 : null;
  const projectedStrikeouts = role === 'pitcher' && projectedInnings != null
    ? { p10: Number((projectedInnings * clamp(kRate * 3.1, 0.7, 3.5) * 0.55).toFixed(2)), p50: Number((projectedInnings * clamp(kRate * 3.1, 0.7, 3.5)).toFixed(2)), p90: Number((projectedInnings * clamp(kRate * 3.1, 0.7, 3.5) * 1.55).toFixed(2)) }
    : { p10: null, p50: null, p90: null };
  return {
    version: 'mlb-reasoning-v1', role, handedness_split: split, season, recent, injury_adjusted: injuryAdjusted,
    pitcher_metrics: role === 'pitcher' ? {
      k_percent: recent.k_rate,
      bb_percent: recent.bb_rate,
      hr_per_nine: recent.hr_rate == null ? null : Number((recent.hr_rate * 9).toFixed(3)),
      xfip: null,
      siera: null,
      woba_allowed: recent.woba,
      iso_allowed: recent.iso,
      barrel_rate_allowed: recent.barrel_rate,
    } : undefined,
    hitter_metrics: role === 'hitter' ? {
      woba: recent.woba,
      iso: recent.iso,
      k_percent: recent.k_rate,
      bb_percent: recent.bb_rate,
      xwoba: recent.xwoba,
      xslg: recent.xslg,
      barrel_rate: recent.barrel_rate,
      hard_hit_rate: recent.hard_hit_rate,
      exit_velocity: recent.exit_velocity,
      launch_angle: recent.launch_angle,
    } : undefined,
    pitch_type_edges: {}, projected_plate_appearances: projectedPlateAppearances, projected_innings: projectedInnings,
    projected_strikeouts: projectedStrikeouts,
    early_exit_probability: role === 'pitcher' ? Number(clamp(0.18 + (1 - shrinkageWeight) * 0.2, 0.08, 0.45).toFixed(3)) : null,
    times_through_order_risk: role === 'pitcher' ? Number(clamp(0.1 + (projectedInnings ?? 0) * 0.025, 0.1, 0.3).toFixed(3)) : null,
    home_run_probability: role === 'hitter' ? Number(clamp(hrRate * projectedPlateAppearances! * 1.8, 0.01, 0.55).toFixed(3)) : null,
    hit_probability: role === 'hitter' ? Number(clamp(shrinkEstimate(recent.k_rate, recent.sample_size, 0.24) < 0.2 ? 0.65 : 0.52, 0.2, 0.8).toFixed(3)) : null,
    double_probability: role === 'hitter' ? 0.12 : null,
    rbi_probability: role === 'hitter' ? Number(clamp(0.08 + (input.batting_order && input.batting_order <= 5 ? 0.08 : 0), 0.03, 0.35).toFixed(3)) : null,
    run_probability: role === 'hitter' ? Number(clamp(0.12 + (input.batting_order && input.batting_order <= 5 ? 0.08 : 0), 0.04, 0.4).toFixed(3)) : null,
    walk_probability: role === 'hitter' ? Number(clamp(shrinkEstimate(recent.bb_rate, recent.sample_size, 0.08) * projectedPlateAppearances! * 1.3, 0.03, 0.5).toFixed(3)) : null,
    stolen_base_probability: role === 'hitter' ? 0.04 : null,
    matchup_edge: matchupEdge,
    shrinkage_weight: Number(shrinkageWeight.toFixed(3)), notes, source: sampleSize >= 5 ? 'observed_and_shrunk' : 'modeled_inputs',
  };
}

export function buildMlbGameScripts(contexts: MlbGameScriptContext[], evidenceIds: string[]): GameScript[] {
  const totals = contexts.map((context) => Number(context.total ?? (Number(context.home_implied ?? 0) + Number(context.away_implied ?? 0)))).filter(Number.isFinite);
  const averageTotal = totals.length ? totals.reduce((sum, value) => sum + value, 0) / totals.length : null;
  const highEnvironment = averageTotal != null ? clamp((averageTotal - 7.5) / 3 + 0.25, 0.15, 0.65) : 0.33;
  const lowEnvironment = 1 - highEnvironment;
  return [
    { script_key: 'mlb_pitcher_duel', thesis: 'Run environment stays suppressed and strikeout/innings stability drives the slate.', required_conditions: ['Low or neutral run environment.', 'At least one pitcher has a stable innings/K path.'], opposing_conditions: ['Weather or bullpen conditions expand scoring.'], team_exposure_targets: {}, player_inclusion_rules: ['Prefer pitchers with confirmed starts and stable workload.', 'Use selective low-owned one-off hitters.'], player_exclusion_rules: ['Avoid overstacking weak run environments.'], probability: Number((lowEnvironment * 0.55).toFixed(3)), evidence_ids: evidenceIds, confidence: 0.55, uncertainty: ['Starter workload and bullpen transition remain uncertain.'] },
    { script_key: 'mlb_favorite_offense', thesis: 'One team converts lineup position and run environment into concentrated scoring.', required_conditions: ['A team has an above-average implied total or run factor.', 'Top/middle-order hitters are confirmed.'], opposing_conditions: ['Starter suppresses contact or weather lowers carry.'], team_exposure_targets: {}, player_inclusion_rules: ['Prioritize hitters batting 1–5 and a correlated bring-back when appropriate.'], player_exclusion_rules: ['Avoid bottom-order pieces without a distinct salary or matchup edge.'], probability: Number((highEnvironment * 0.5).toFixed(3)), evidence_ids: evidenceIds, confidence: 0.52, uncertainty: ['Baseball scoring is highly volatile.'] },
    { script_key: 'mlb_both_offenses', thesis: 'Both sides produce enough baserunners for correlated hitters and bring-backs to dominate.', required_conditions: ['Multiple usable offensive environments exist.'], opposing_conditions: ['Pitcher duel conditions or late weather suppression.'], team_exposure_targets: {}, player_inclusion_rules: ['Pair a primary stack with a bring-back and prioritize power/plate appearance paths.'], player_exclusion_rules: ['Avoid negatively correlated pitcher exposure without a deliberate leverage reason.'], probability: Number((highEnvironment * 0.35).toFixed(3)), evidence_ids: evidenceIds, confidence: 0.42, uncertainty: ['Requires multiple independent scoring events.'] },
    { script_key: 'mlb_starter_exit_bullpen_attack', thesis: 'A starter exits early and the opposing offense attacks a vulnerable or taxed bullpen.', required_conditions: ['Early-exit or bullpen-quality signal exists.'], opposing_conditions: ['Starter reaches a normal workload and bullpen is fresh.'], team_exposure_targets: {}, player_inclusion_rules: ['Prefer patient/high-contact bats and late-order salary unlocks only with evidence.'], player_exclusion_rules: ['Do not treat bullpen weakness as verified without a source.'], probability: 0.12, evidence_ids: evidenceIds, confidence: 0.3, uncertainty: ['Bullpen workload data is not yet fully available.'] },
    { script_key: 'mlb_one_sided_blowout', thesis: 'A favorite creates a concentrated one-sided score distribution.', required_conditions: ['Strong implied-total or matchup separation.'], opposing_conditions: ['Game remains close or underdog starter exceeds baseline.'], team_exposure_targets: {}, player_inclusion_rules: ['Concentrate on the leading offense and its highest plate-appearance paths.'], player_exclusion_rules: ['Limit opposing hitters except when salary/ownership leverage is intentional.'], probability: 0.12, evidence_ids: evidenceIds, confidence: 0.35, uncertainty: ['Blowout scoring can spread across many hitters.'] },
  ];
}

export function explainMlbStack(team: string, players: MlbScriptPlayer[]): string {
  const hitters = players.filter((player) => !isPitcher(player.position) && player.team.toUpperCase() === team.toUpperCase());
  const orders = hitters.map((player) => player.batting_order).filter((order): order is number => Number.isInteger(order));
  const topFive = orders.filter((order) => order <= 5).length;
  const averageOwnership = hitters.length ? hitters.reduce((sum, player) => sum + Number(player.ownership_projection ?? 0), 0) / hitters.length : 0;
  const matchup = hitters.map((player) => player.mlb_decision_features?.matchup_edge).filter((value): value is number => value != null);
  const matchupText = matchup.length ? ` matchup edge ${ (matchup.reduce((sum, value) => sum + value, 0) / matchup.length).toFixed(2)}` : '';
  return `${team} stack: ${hitters.length} hitters, ${topFive} top-five lineup slots, average ownership ${(averageOwnership * 100).toFixed(1)}%,${matchupText}. The scoring path is correlated through plate appearances, lineup position, and the game script; it is not a standalone projection claim.`;
}
