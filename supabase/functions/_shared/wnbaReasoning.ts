import type { GameScript } from './decisionContracts.ts';

export interface WnbaDecisionFeatures {
  role: 'primary_creator' | 'secondary_creator' | 'starter' | 'bench' | 'replacement' | 'unknown';
  healthy_role: string;
  minutes: { p10: number | null; p50: number | null; p90: number | null; dnp_probability: number | null; standard_deviation: number | null };
  opportunity: { usage: number | null; assists: number | null; rebounds: number | null; fantasy_per_minute: number | null };
  game_environment: { implied_total: number | null; spread: number | null; close_game_probability: number; blowout_risk: number; overtime_probability: number };
  injury_replacement: { is_contingent: boolean; minutes_gain: number | null; replacement_for: string[]; replacement_rank: number | null };
  correlation_tags: string[];
  source: 'wnba_reasoning_model';
}

export interface WnbaReasoningPlayer {
  name?: string;
  team?: string;
  position?: string;
  injury_status?: string;
  confirmed_starter?: boolean;
  minutes_projection?: number;
  minutes_distribution?: { p10: number | null; p50: number | null; p90: number | null; standardDeviation: number | null; didNotPlayProbability: number | null };
  wnba_role_prior?: { replacementMinutesGain?: number | null; cohort?: string; didNotPlayProbability?: number | null };
  role_stability?: number;
  recent_fantasy_per_minute?: number;
  usage_rate?: number;
  wnba_component_projection?: { assists?: number; rebounds?: number };
  implied_total?: number;
  spread?: number;
  opponent_team?: string;
  role_counterfactual?: string[];
}

export function buildWnbaDecisionFeatures(player: WnbaReasoningPlayer, teammates: WnbaReasoningPlayer[] = []): WnbaDecisionFeatures {
  const minutes = player.minutes_distribution;
  const rolePrior = String(player.wnba_role_prior?.cohort ?? 'unknown');
  const role = player.role_counterfactual?.length || rolePrior === 'elevated' ? 'replacement'
    : player.confirmed_starter === true || rolePrior === 'starter' ? 'starter'
      : rolePrior === 'stable_bench' || rolePrior === 'volatile_bench' ? 'bench' : 'unknown';
  const spread = Number(player.spread);
  const total = Number(player.implied_total);
  const closeGameProbability = Number.isFinite(spread) ? Math.max(0.05, Math.min(0.95, 1 - Math.abs(spread) / 14)) : 0.5;
  const blowoutRisk = Number.isFinite(spread) ? Math.max(0, Math.min(0.9, (Math.abs(spread) - 6) / 10)) : 0.15;
  const replacementMinutesGain = Number(player.wnba_role_prior?.replacementMinutesGain);
  const replacementFor = player.role_counterfactual ?? [];
  const tags = [
    player.confirmed_starter === true ? 'confirmed_starter' : '',
    rolePrior === 'elevated' || replacementFor.length ? 'injury_replacement' : '',
    closeGameProbability >= 0.65 ? 'competitive_game' : '',
    blowoutRisk >= 0.35 ? 'blowout_sensitive' : '',
    Number(player.usage_rate) >= 0.24 ? 'usage_concentration' : '',
    Number(player.wnba_component_projection?.assists) >= 4 ? 'assist_correlation' : '',
    Number(player.wnba_component_projection?.rebounds) >= 7 ? 'rebound_correlation' : '',
  ].filter(Boolean);
  return {
    role,
    healthy_role: rolePrior,
    minutes: { p10: minutes?.p10 ?? null, p50: minutes?.p50 ?? player.minutes_projection ?? null, p90: minutes?.p90 ?? null, dnp_probability: minutes?.didNotPlayProbability ?? player.wnba_role_prior?.didNotPlayProbability ?? null, standard_deviation: minutes?.standardDeviation ?? null },
    opportunity: { usage: Number.isFinite(Number(player.usage_rate)) ? Number(player.usage_rate) : null, assists: player.wnba_component_projection?.assists ?? null, rebounds: player.wnba_component_projection?.rebounds ?? null, fantasy_per_minute: player.recent_fantasy_per_minute ?? null },
    game_environment: { implied_total: Number.isFinite(total) ? total : null, spread: Number.isFinite(spread) ? spread : null, close_game_probability: Number(closeGameProbability.toFixed(3)), blowout_risk: Number(blowoutRisk.toFixed(3)), overtime_probability: Number((0.055 + closeGameProbability * 0.025).toFixed(3)) },
    injury_replacement: { is_contingent: replacementFor.length > 0 || rolePrior === 'elevated', minutes_gain: Number.isFinite(replacementMinutesGain) ? replacementMinutesGain : null, replacement_for: replacementFor, replacement_rank: replacementFor.length ? Math.max(1, teammates.findIndex((item) => item.name === player.name) + 1) : null },
    correlation_tags: tags,
    source: 'wnba_reasoning_model',
  };
}

export function buildWnbaGameScripts(games: Array<{ game_id?: string; home_team?: string; away_team?: string; total?: number | null; spread?: number | null }>, players: WnbaReasoningPlayer[], evidenceIds: string[]): GameScript[] {
  const totals = games.map((game) => Number(game.total)).filter(Number.isFinite);
  const spreads = games.map((game) => Math.abs(Number(game.spread))).filter(Number.isFinite);
  const averageTotal = totals.length ? totals.reduce((sum, value) => sum + value, 0) / totals.length : null;
  const averageSpread = spreads.length ? spreads.reduce((sum, value) => sum + value, 0) / spreads.length : null;
  const replacements = players.filter((player) => player.role_counterfactual?.length || player.wnba_role_prior?.cohort === 'elevated');
  const highTotal = averageTotal !== null && averageTotal >= 84;
  const close = averageSpread === null || averageSpread <= 6;
  const scripts: GameScript[] = [
    { script_key: 'wnba_competitive_high_total', thesis: 'A competitive, high-total game keeps core starters on the floor and expands correlated scoring, assist, and rebound outcomes.', required_conditions: ['Game total is elevated or pace signals are favorable.', 'Spread remains close enough to preserve fourth-quarter minutes.'], opposing_conditions: ['A decisive blowout removes starter minutes.', 'Late availability news changes the rotation.'], team_exposure_targets: {}, player_inclusion_rules: ['Prioritize stable starters and primary creators.', 'Pair correlated creators with rebound or assist partners when salary permits.'], player_exclusion_rules: ['Avoid thin-role players whose minutes depend on perfect game flow.'], probability: highTotal && close ? 0.34 : 0.2, evidence_ids: evidenceIds, confidence: highTotal || close ? 0.62 : 0.42, uncertainty: [highTotal ? '' : 'Total context is incomplete.', close ? '' : 'Spread context is incomplete or not competitive.'].filter(Boolean) },
    { script_key: 'wnba_favorite_controls', thesis: 'The favorite controls the game, concentrating production in its best role-secure players while opponent value remains fragile.', required_conditions: ['One team has a meaningful spread edge.', 'Favorite starters retain normal workload.'], opposing_conditions: ['Game remains close into the fourth quarter.', 'Favorite rotation is altered by late news.'], team_exposure_targets: {}, player_inclusion_rules: ['Concentrate exposure in favorite primary creators and secure-minute starters.', 'Use opponent pieces selectively as runbacks.'], player_exclusion_rules: ['Limit low-minute bench players on the favorite when blowout risk is high.'], probability: averageSpread !== null && averageSpread >= 7 ? 0.22 : 0.12, evidence_ids: evidenceIds, confidence: averageSpread !== null ? 0.56 : 0.35, uncertainty: ['Blowout timing is inherently uncertain.'] },
    { script_key: 'wnba_injury_replacement', thesis: 'An injury or availability change redistributes minutes and usage to identified replacement players.', required_conditions: ['A questionable or inactive player is confirmed, or replacement evidence is strong.', 'Replacement role is supported by minutes history or role prior.'], opposing_conditions: ['The injured player is active without a restriction.', 'Replacement minutes are absorbed by a committee.'], team_exposure_targets: {}, player_inclusion_rules: ['Use only named, role-supported replacements.', 'Increase opportunity exposure when the replacement gains minutes and usage.'], player_exclusion_rules: ['Do not force an unverified replacement into tournament builds.'], probability: replacements.length ? 0.2 : 0.1, evidence_ids: evidenceIds, confidence: replacements.length ? 0.58 : 0.3, uncertainty: ['Final lineup confirmation can change the replacement tree.'] },
    { script_key: 'wnba_blowout_minutes_loss', thesis: 'A wide margin reduces starter minutes and creates a lower-ceiling, wider bench rotation.', required_conditions: ['Spread or modeled margin creates material blowout risk.'], opposing_conditions: ['The game stays within a competitive margin.', 'Overtime or foul-driven minutes offset the risk.'], team_exposure_targets: {}, player_inclusion_rules: ['Prefer value players whose role survives a shortened game.', 'Discount fragile starter ceilings.'], player_exclusion_rules: ['Avoid over-concentrating on expensive starters with wide minutes distributions.'], probability: averageSpread !== null && averageSpread >= 8 ? 0.16 : 0.08, evidence_ids: evidenceIds, confidence: averageSpread !== null ? 0.5 : 0.28, uncertainty: ['WNBA blowout substitution patterns vary by coach.'] },
    { script_key: 'wnba_overtime_ceiling', thesis: 'A close game reaches extended minutes, amplifying high-minute creators and correlated counting-stat ceilings.', required_conditions: ['Game is projected close.', 'Primary players remain active late.'], opposing_conditions: ['Blowout or early foul trouble limits the core.'], team_exposure_targets: {}, player_inclusion_rules: ['Favor high-minute creators with assist, rebound, or double-double paths.'], player_exclusion_rules: ['Avoid DNP-sensitive players without an overtime path.'], probability: close ? 0.08 : 0.04, evidence_ids: evidenceIds, confidence: close ? 0.46 : 0.25, uncertainty: ['Overtime is low probability even in close games.'] },
  ];
  const total = scripts.reduce((sum, script) => sum + script.probability, 0) || 1;
  return scripts.map((script) => ({ ...script, probability: Number((script.probability / total).toFixed(4)) }));
}

export function explainWnbaRole(player: WnbaReasoningPlayer, features: WnbaDecisionFeatures): string {
  const minutes = features.minutes.p50 == null ? 'uncertain minutes' : `${features.minutes.p50.toFixed(1)} median minutes`;
  if (features.injury_replacement.is_contingent) return `${player.name ?? 'Player'} is an injury-contingent WNBA replacement with ${minutes}; treat the ceiling as dependent on the named role change${features.injury_replacement.replacement_for.length ? ` for ${features.injury_replacement.replacement_for.join(', ')}` : ''}.`;
  if (features.game_environment.blowout_risk >= 0.35) return `${player.name ?? 'Player'} has ${minutes}, but the game environment carries blowout risk that can reduce starter closing minutes.`;
  return `${player.name ?? 'Player'} projects for ${minutes} with a ${features.healthy_role} role and ${features.correlation_tags.join(', ') || 'no special correlation tag'}.`;
}
