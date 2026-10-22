const ALIASES = {
  points: ['points', 'pts'],
  threePointersMade: ['threePointFieldGoalsMade', 'threePointersMade', 'threePointers', 'three_pointers', 'three_pointers_made', 'three_point_field_goals_made', 'threePointMade', 'threesMade', 'fg3m', '3pm'],
  rebounds: ['totalRebounds', 'rebounds', 'reb', 'total_rebounds'],
  assists: ['assists', 'ast'],
  steals: ['steals', 'stl'],
  blocks: ['blocks', 'blockedShots', 'blk'],
  turnovers: ['turnovers', 'turnover', 'tov'],
};
function value(line, names) { for (const name of names) { const candidate = Number(line?.[name]); if (Number.isFinite(candidate)) return candidate; } return 0; }
function rule(rules, key) { const item = rules?.[key]; const score = Number(typeof item === 'number' ? item : item?.value); return Number.isFinite(score) ? score : undefined; }

/** Single shared category scorer. Bonus counts are derived from actual integer category totals. */
function scoreBasketballStatLine(statLine, scoringRules) {
  const categories = Object.fromEntries(Object.entries(ALIASES).map(([key, aliases]) => [key, value(statLine, aliases)]));
  const bonusThresholdCategories = ['points', 'rebounds', 'assists', 'steals', 'blocks'];
  const qualifyingCategories = bonusThresholdCategories.filter((key) => categories[key] >= 10).length;
  const doubleDouble = qualifyingCategories >= 2 ? 1 : 0;
  const tripleDouble = qualifyingCategories >= 3 ? 1 : 0;
  const requiredRules = Object.keys(ALIASES);
  const components = Object.fromEntries(requiredRules.map((key) => [key, categories[key]]));
  components.doubleDouble = doubleDouble;
  components.tripleDouble = tripleDouble;
  const missing = Object.keys(components).filter((key) => rule(scoringRules, key) === undefined && components[key] !== 0);
  if (missing.length) return { points: NaN, components, bonusThresholdCategories, qualifyingCategories, doubleDouble, tripleDouble, reason: `Scoring rules omit non-zero categories: ${missing.join(', ')}.` };
  const points = Object.entries(components).reduce((sum, [key, count]) => sum + count * (rule(scoringRules, key) ?? 0), 0);
  return { points: Math.round((points + Number.EPSILON) * 1e6) / 1e6, components, bonusThresholdCategories, qualifyingCategories, doubleDouble, tripleDouble };
}

module.exports = { scoreBasketballStatLine };
