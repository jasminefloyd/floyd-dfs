export interface BasketballScoringResult { points: number; components: Record<string, number>; bonusThresholdCategories: string[]; qualifyingCategories: number; doubleDouble: number; tripleDouble: number; reason?: string; }
export function scoreBasketballStatLine(statLine: Record<string, number>, scoringRules: Record<string, number | { value: number }>): BasketballScoringResult;
