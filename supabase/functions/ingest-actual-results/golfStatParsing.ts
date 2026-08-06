export interface GolfHoleResult {
  /** Absolute strokes taken on the hole (used only to detect a hole-in-one). */
  strokes: number;
  /** Score relative to par for the hole, e.g. -1 birdie, 0 par, 1 bogey. */
  relativeToPar: number;
}

export interface GolfRoundResult {
  holes: GolfHoleResult[];
  /** Total strokes for the round -- used for the all-rounds-under-70 bonus. */
  totalStrokes: number;
}

export interface GolfCompetitorScore {
  id: string;
  /** Tournament score relative to par (lower is better), e.g. -12. Ties share a rank. */
  score: number;
}

function bucketHole(hole: GolfHoleResult): 'doubleEagleOrBetter' | 'eagle' | 'birdie' | 'par' | 'bogey' | 'doubleBogeyOrWorse' {
  if (hole.relativeToPar <= -3) return 'doubleEagleOrBetter';
  if (hole.relativeToPar === -2) return 'eagle';
  if (hole.relativeToPar === -1) return 'birdie';
  if (hole.relativeToPar === 0) return 'par';
  if (hole.relativeToPar === 1) return 'bogey';
  return 'doubleBogeyOrWorse';
}

// DK's "streak of 3 birdies or better" bonus counts any 3+ consecutive holes scored
// birdie or better (relativeToPar <= -1), capped at 1 bonus per round no matter how many
// qualifying streaks (or how long a single streak runs) occur in that round.
export function hasBirdieStreakBonus(holes: GolfHoleResult[]): boolean {
  let streak = 0;
  for (const hole of holes) {
    streak = hole.relativeToPar <= -1 ? streak + 1 : 0;
    if (streak >= 3) return true;
  }
  return false;
}

// DK requires all 18 holes completed (with stats) and none worse than par for the
// bogey-free bonus; a round shortened below 18 holes is not eligible.
export function isBogeyFreeRound(holes: GolfHoleResult[]): boolean {
  return holes.length === 18 && holes.every((hole) => hole.relativeToPar <= 0);
}

export interface GolfAggregatedStatLine {
  doubleEagleOrBetterHoles: number;
  eagleHoles: number;
  birdieHoles: number;
  parHoles: number;
  bogeyHoles: number;
  doubleBogeyOrWorseHoles: number;
  holesInOne: number;
  birdieStreakBonusRounds: number;
  bogeyFreeRounds: number;
}

const EMPTY_BUCKETS: GolfAggregatedStatLine = {
  doubleEagleOrBetterHoles: 0,
  eagleHoles: 0,
  birdieHoles: 0,
  parHoles: 0,
  bogeyHoles: 0,
  doubleBogeyOrWorseHoles: 0,
  holesInOne: 0,
  birdieStreakBonusRounds: 0,
  bogeyFreeRounds: 0,
};

export function aggregateGolfRounds(rounds: GolfRoundResult[]): GolfAggregatedStatLine {
  const totals = { ...EMPTY_BUCKETS };
  for (const round of rounds) {
    for (const hole of round.holes) {
      const bucket = bucketHole(hole);
      totals[`${bucket}Holes`] += 1;
      if (hole.strokes === 1) totals.holesInOne += 1;
    }
    if (hasBirdieStreakBonus(round.holes)) totals.birdieStreakBonusRounds += 1;
    if (isBogeyFreeRound(round.holes)) totals.bogeyFreeRounds += 1;
  }
  return totals;
}

// DK's "all predetermined rounds under 70 strokes" bonus requires every round of the
// tournament's actual (non-shortened) length to be under 70 strokes. tournamentRoundCount
// should come from the event's own completed-round count (e.g. ESPN competition.period
// once the event status is final) -- if a golfer's round count doesn't match, either they
// didn't finish (missed cut / WD) or the event was shortened, and DK pays no bonus either way.
export function allRoundsUnder70Bonus(rounds: GolfRoundResult[], tournamentRoundCount: number): 0 | 1 {
  if (!rounds.length || rounds.length !== tournamentRoundCount) return 0;
  return rounds.every((round) => round.totalStrokes > 0 && round.totalStrokes < 70) ? 1 : 0;
}

// DraftKings pays full finish-position points to every golfer tied at that spot, so ties
// must share a rank (standard "competition ranking": the next distinct score's rank
// equals the count of golfers already ranked, not a plain 1-based sort position).
export function rankWithTies(competitors: GolfCompetitorScore[]): Map<string, number> {
  const sorted = [...competitors].sort((a, b) => a.score - b.score);
  const ranks = new Map<string, number>();
  let rank = 0;
  let previousScore: number | null = null;
  let seen = 0;
  for (const competitor of sorted) {
    seen += 1;
    if (previousScore === null || competitor.score !== previousScore) {
      rank = seen;
      previousScore = competitor.score;
    }
    ranks.set(competitor.id, rank);
  }
  return ranks;
}

export function buildGolfStatLine(
  rounds: GolfRoundResult[],
  tournamentRoundCount: number,
  finishPosition: number | null,
): Record<string, number> {
  const aggregated = aggregateGolfRounds(rounds);
  return {
    ...aggregated,
    allRoundsUnder70Bonus: allRoundsUnder70Bonus(rounds, tournamentRoundCount),
    ...(finishPosition !== null ? { finishPosition } : {}),
  };
}
