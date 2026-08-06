// KEEP IN SYNC — canonical copy in supabase/functions/_shared/dkScoring.ts
// DraftKings Classic scoring implemented from the repo requirement and DK scoring references
// checked 2026-07-23. DK Help notes DFS scoring is finalized from official stats:
// https://help.draftkings.com/hc/en-us/articles/4405224006931
// DK basketball rules define double/triple categories as points, rebounds, assists,
// steals, and blocks: https://sportsbook.draftkings.com/help/sport-rules/basketball

export type DkSport = 'nba' | 'wnba' | 'nfl' | 'mlb' | 'golf';
export type DkContestType = 'classic' | 'showdown';
export type DkRole = 'hitter' | 'pitcher' | 'dst' | 'kicker';
export type StatLine = Record<string, number>;

export const DK_SCORING = {
  nba: {
    points: 1,
    threePointersMade: 0.5,
    rebounds: 1.25,
    assists: 1.5,
    steals: 2,
    blocks: 2,
    turnovers: -0.5,
    doubleDouble: 1.5,
    tripleDouble: 3,
  },
  wnba: {
    points: 1,
    threePointersMade: 0.5,
    rebounds: 1.25,
    assists: 1.5,
    steals: 2,
    blocks: 2,
    turnovers: -0.5,
    doubleDouble: 1.5,
    tripleDouble: 3,
  },
  nfl: {
    passingYards: 0.04,
    passingTouchdown: 4,
    passingYardBonus: 3,
    interception: -1,
    rushingYards: 0.1,
    rushingTouchdown: 6,
    rushingYardBonus: 3,
    receivingYards: 0.1,
    reception: 1,
    receivingTouchdown: 6,
    receivingYardBonus: 3,
    fumbleLost: -1,
    twoPointConversion: 2,
    returnTouchdown: 6,
    offensiveFumbleRecoveryTouchdown: 6,
    dstSack: 1,
    dstInterception: 2,
    dstFumbleRecovery: 2,
    dstTouchdown: 6,
    dstSafety: 2,
    dstBlockedKick: 2,
    dstTwoPointReturn: 2,
    extraPoint: 1,
    fieldGoal0to39: 3,
    fieldGoal40to49: 4,
    fieldGoal50Plus: 5,
  },
  golf: {
    classic: {
      doubleEagleOrBetter: 13,
      eagle: 8,
      birdie: 3,
      par: 0.5,
      bogey: -0.5,
      doubleBogeyOrWorse: -1,
      birdieStreak: 3,
      bogeyFreeRound: 3,
      allRoundsUnder70: 5,
      holeInOne: 5,
    },
    showdown: {
      doubleEagleOrBetter: 16,
      eagle: 11,
      birdie: 5.75,
      par: 1.5,
      bogey: -1.8,
      doubleBogeyOrWorse: -3.9,
      birdieStreak: 5,
      bogeyFreeRound: 5,
      // Showdown Golf - Round 1 has no tournament-finish or rounds-under-70 bonus;
      // it's a single round, so those concepts don't apply.
      allRoundsUnder70: 0,
      holeInOne: 5,
    },
  },
  mlb: {
    single: 3,
    double: 5,
    triple: 8,
    homeRun: 10,
    rbi: 2,
    run: 2,
    walk: 2,
    hitByPitch: 2,
    stolenBase: 5,
    inningPitched: 2.25,
    strikeout: 2,
    win: 4,
    earnedRun: -2,
    hitAgainst: -0.6,
    walkAgainst: -0.6,
    hitBatsman: -0.6,
    completeGame: 2.5,
    completeGameShutout: 2.5,
    noHitter: 5,
  },
} as const;

function stat(line: StatLine, keys: string[]): number {
  for (const key of keys) {
    const value = Number(line[key]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function hasStat(line: StatLine, keys: string[]): boolean {
  return keys.some((key) => key in line && Number.isFinite(Number(line[key])));
}

function atLeast(value: number, threshold: number): number {
  return value >= threshold ? 1 : 0;
}

export function dkBasketballFantasyPoints(statLine: StatLine): number {
  const points = stat(statLine, ['points', 'pts']);
  const threes = stat(statLine, [
    'threePointFieldGoalsMade',
    'threePointersMade',
    'threePointers',
    'three_pointers',
    'three_pointers_made',
    'three_point_field_goals_made',
    'threePointMade',
    'threesMade',
    'fg3m',
    '3pm',
  ]);
  const rebounds = stat(statLine, ['totalRebounds', 'rebounds', 'reb', 'total_rebounds']);
  const assists = stat(statLine, ['assists', 'ast']);
  const steals = stat(statLine, ['steals', 'stl']);
  const blocks = stat(statLine, ['blocks', 'blk']);
  const turnovers = stat(statLine, ['turnovers', 'turnover', 'tov']);
  const categoriesAtTen = [
    points,
    rebounds,
    assists,
    steals,
    blocks,
  ].reduce((count, value) => count + atLeast(value, 10), 0);
  // DK awards both bonuses on a triple-double: +1.5 for double-double and +3.0 for triple-double.
  const doubleDoubleBonus = categoriesAtTen >= 2 ? DK_SCORING.nba.doubleDouble : 0;
  const tripleDoubleBonus = categoriesAtTen >= 3 ? DK_SCORING.nba.tripleDouble : 0;

  return points
    + threes * DK_SCORING.nba.threePointersMade
    + rebounds * DK_SCORING.nba.rebounds
    + assists * DK_SCORING.nba.assists
    + steals * DK_SCORING.nba.steals
    + blocks * DK_SCORING.nba.blocks
    + turnovers * DK_SCORING.nba.turnovers
    + doubleDoubleBonus
    + tripleDoubleBonus;
}

export function dkNflFantasyPoints(statLine: StatLine, role?: DkRole): number {
  if (role === 'dst') return dkNflDstFantasyPoints(statLine);
  if (role === 'kicker') return dkNflKickerFantasyPoints(statLine);

  const passingYards = stat(statLine, ['passingYards', 'passing_yards', 'passYards', 'pass_yds']);
  const rushingYards = stat(statLine, ['rushingYards', 'rushing_yards', 'rushYards', 'rush_yds']);
  const receivingYards = stat(statLine, ['receivingYards', 'receiving_yards', 'recYards', 'rec_yds']);

  return passingYards * DK_SCORING.nfl.passingYards
    + stat(statLine, ['passingTouchdowns', 'passing_tds', 'passingTds', 'passingTD', 'pass_td']) * DK_SCORING.nfl.passingTouchdown
    + (passingYards >= 300 ? DK_SCORING.nfl.passingYardBonus : 0)
    + stat(statLine, ['interceptions', 'interceptionsThrown', 'ints', 'int']) * DK_SCORING.nfl.interception
    + rushingYards * DK_SCORING.nfl.rushingYards
    + stat(statLine, ['rushingTouchdowns', 'rushing_tds', 'rushingTds', 'rushingTD', 'rush_td']) * DK_SCORING.nfl.rushingTouchdown
    + (rushingYards >= 100 ? DK_SCORING.nfl.rushingYardBonus : 0)
    + receivingYards * DK_SCORING.nfl.receivingYards
    + stat(statLine, ['receptions', 'receivingReceptions', 'rec']) * DK_SCORING.nfl.reception
    + stat(statLine, ['receivingTouchdowns', 'receiving_tds', 'receivingTds', 'receivingTD', 'rec_td']) * DK_SCORING.nfl.receivingTouchdown
    + (receivingYards >= 100 ? DK_SCORING.nfl.receivingYardBonus : 0)
    + stat(statLine, ['fumblesLost', 'fumble_lost', 'lostFumbles']) * DK_SCORING.nfl.fumbleLost
    + stat(statLine, ['twoPointConversions', 'two_point_conversions', 'twoPtConversions', 'two_pt']) * DK_SCORING.nfl.twoPointConversion
    + returnTouchdowns(statLine) * DK_SCORING.nfl.returnTouchdown
    + stat(statLine, ['offensiveFumbleRecoveryTouchdowns', 'offensive_fumble_recovery_touchdowns']) * DK_SCORING.nfl.offensiveFumbleRecoveryTouchdown;
}

function returnTouchdowns(statLine: StatLine): number {
  const combined = stat(statLine, ['returnTouchdowns', 'return_tds']);
  if (combined) return combined;
  return stat(statLine, ['kickReturnTouchdowns', 'kick_return_touchdowns'])
    + stat(statLine, ['puntReturnTouchdowns', 'punt_return_touchdowns']);
}

export function dkNflDstFantasyPoints(statLine: StatLine): number {
  return stat(statLine, ['sacks', 'sack']) * DK_SCORING.nfl.dstSack
    + stat(statLine, ['interceptions', 'interceptionsForced', 'dstInterceptions', 'int']) * DK_SCORING.nfl.dstInterception
    + stat(statLine, ['fumblesRecovered', 'fumbleRecoveries', 'fumble_recoveries']) * DK_SCORING.nfl.dstFumbleRecovery
    + stat(statLine, ['defensiveTouchdowns', 'specialTeamsTouchdowns', 'dstTouchdowns', 'touchdowns', 'td']) * DK_SCORING.nfl.dstTouchdown
    + stat(statLine, ['safeties', 'safety']) * DK_SCORING.nfl.dstSafety
    + stat(statLine, ['blockedKicks', 'blocked_kicks', 'blocks']) * DK_SCORING.nfl.dstBlockedKick
    + stat(statLine, ['twoPointReturns', 'two_point_returns', 'defensiveTwoPointReturns']) * DK_SCORING.nfl.dstTwoPointReturn
    + dstPointsAllowedBonus(stat(statLine, ['pointsAllowed', 'points_allowed', 'pa']));
}

// Field goals must be reported pre-bucketed by distance (fieldGoalsMade0to39,
// fieldGoalsMade40to49, fieldGoalsMade50Plus) -- box-score feeds (e.g. ESPN's summary
// endpoint) only expose aggregate makes/attempts with no per-kick distance, so a caller
// without a play-by-play source cannot populate this precisely and must not guess a
// distance distribution.
export function dkNflKickerFantasyPoints(statLine: StatLine): number {
  return stat(statLine, ['extraPointsMade', 'extra_points_made', 'xpMade']) * DK_SCORING.nfl.extraPoint
    + stat(statLine, ['fieldGoalsMade0to39', 'field_goals_made_0_to_39']) * DK_SCORING.nfl.fieldGoal0to39
    + stat(statLine, ['fieldGoalsMade40to49', 'field_goals_made_40_to_49']) * DK_SCORING.nfl.fieldGoal40to49
    + stat(statLine, ['fieldGoalsMade50Plus', 'field_goals_made_50_plus']) * DK_SCORING.nfl.fieldGoal50Plus;
}

export function dstPointsAllowedBonus(pointsAllowed: number): number {
  if (pointsAllowed === 0) return 10;
  if (pointsAllowed <= 6) return 7;
  if (pointsAllowed <= 13) return 4;
  if (pointsAllowed <= 20) return 1;
  if (pointsAllowed <= 27) return 0;
  if (pointsAllowed <= 34) return -1;
  return -4;
}

export function dkMlbFantasyPoints(statLine: StatLine, role?: DkRole): number {
  if (role === 'pitcher' || hasPitchingStats(statLine)) return dkMlbPitcherFantasyPoints(statLine);
  return dkMlbHitterFantasyPoints(statLine);
}

export function dkMlbHitterFantasyPoints(statLine: StatLine): number {
  const hits = stat(statLine, ['hits', 'h']);
  const doubles = stat(statLine, ['doubles', 'double', '2b']);
  const triples = stat(statLine, ['triples', 'triple', '3b']);
  const homeRuns = stat(statLine, ['homeRuns', 'home_runs', 'home_run', 'hr']);
  const singlesKeys = ['singles', 'single', '1b'];
  const singles = Math.max(0, hasStat(statLine, singlesKeys)
    ? stat(statLine, singlesKeys)
    : hits - doubles - triples - homeRuns);

  return singles * DK_SCORING.mlb.single
    + doubles * DK_SCORING.mlb.double
    + triples * DK_SCORING.mlb.triple
    + homeRuns * DK_SCORING.mlb.homeRun
    + stat(statLine, ['rbi', 'rbis', 'runsBattedIn']) * DK_SCORING.mlb.rbi
    + stat(statLine, ['runs', 'run', 'r']) * DK_SCORING.mlb.run
    + stat(statLine, ['baseOnBalls', 'walks', 'walk', 'bb']) * DK_SCORING.mlb.walk
    + stat(statLine, ['hitByPitch', 'hit_by_pitch', 'hbp']) * DK_SCORING.mlb.hitByPitch
    + stat(statLine, ['stolenBases', 'stolen_bases', 'stolenBase', 'sb']) * DK_SCORING.mlb.stolenBase;
}

export function dkMlbPitcherFantasyPoints(statLine: StatLine): number {
  return stat(statLine, ['inningsPitched', 'innings_pitched', 'ip']) * DK_SCORING.mlb.inningPitched
    + stat(statLine, ['strikeOuts', 'strikeouts', 'strike_outs', 'k']) * DK_SCORING.mlb.strikeout
    + stat(statLine, ['wins', 'win', 'w']) * DK_SCORING.mlb.win
    + stat(statLine, ['earnedRuns', 'earned_runs', 'er']) * DK_SCORING.mlb.earnedRun
    + stat(statLine, ['hitsAllowed', 'hits_allowed', 'hitsAgainst', 'hits_against', 'ha']) * DK_SCORING.mlb.hitAgainst
    + stat(statLine, ['walksAllowed', 'walks_allowed', 'walksAgainst', 'baseOnBallsAllowed', 'base_on_balls_allowed', 'bbAllowed']) * DK_SCORING.mlb.walkAgainst
    + stat(statLine, ['hitBatsmen', 'hitBatsman', 'hitByPitch', 'hbp']) * DK_SCORING.mlb.hitBatsman
    + stat(statLine, ['completeGames', 'complete_games', 'cg']) * DK_SCORING.mlb.completeGame
    + stat(statLine, ['completeGameShutouts', 'shutouts', 'complete_game_shutouts', 'sho']) * DK_SCORING.mlb.completeGameShutout
    + stat(statLine, ['noHitters', 'no_hitters', 'noHitter']) * DK_SCORING.mlb.noHitter;
}

function hasPitchingStats(statLine: StatLine): boolean {
  return stat(statLine, ['inningsPitched', 'innings_pitched', 'ip']) > 0
    || stat(statLine, ['strikeOuts', 'strikeouts', 'strike_outs', 'k']) > 0
    || stat(statLine, ['earnedRuns', 'earned_runs', 'er']) > 0;
}

// DraftKings pays full finish-position points to every golfer tied at that position
// (not split/averaged), so this is a plain lookup, not a per-stroke rate.
export function golfFinishPositionBonus(place: number): number {
  if (!Number.isFinite(place) || place < 1) return 0;
  if (place === 1) return 30;
  if (place === 2) return 20;
  if (place === 3) return 18;
  if (place === 4) return 16;
  if (place === 5) return 14;
  if (place === 6) return 12;
  if (place === 7) return 10;
  if (place === 8) return 9;
  if (place === 9) return 8;
  if (place === 10) return 7;
  if (place <= 15) return 6;
  if (place <= 20) return 5;
  if (place <= 25) return 4;
  if (place <= 30) return 3;
  if (place <= 40) return 2;
  if (place <= 50) return 1;
  return 0;
}

// Golf's stat line is pre-aggregated hole/round counts (not a single game's raw box
// score) because DK scores every hole across every round played, plus round-level and
// tournament-level bonuses. contestType matters because Classic and Showdown - Round 1
// use entirely different point values, not a captain-style multiplier.
export function dkGolfFantasyPoints(statLine: StatLine, contestType: DkContestType = 'classic'): number {
  const table = contestType === 'showdown' ? DK_SCORING.golf.showdown : DK_SCORING.golf.classic;
  const perHole = stat(statLine, ['doubleEagleOrBetterHoles']) * table.doubleEagleOrBetter
    + stat(statLine, ['eagleHoles']) * table.eagle
    + stat(statLine, ['birdieHoles']) * table.birdie
    + stat(statLine, ['parHoles']) * table.par
    + stat(statLine, ['bogeyHoles']) * table.bogey
    + stat(statLine, ['doubleBogeyOrWorseHoles']) * table.doubleBogeyOrWorse;
  const bonuses = stat(statLine, ['birdieStreakBonusRounds']) * table.birdieStreak
    + stat(statLine, ['bogeyFreeRounds']) * table.bogeyFreeRound
    + stat(statLine, ['holesInOne']) * table.holeInOne
    + stat(statLine, ['allRoundsUnder70Bonus']) * table.allRoundsUnder70;
  const finishBonus = contestType === 'showdown' ? 0 : golfFinishPositionBonus(stat(statLine, ['finishPosition']));
  return perHole + bonuses + finishBonus;
}

export function dkFantasyPoints(statLine: StatLine, sport: DkSport, role?: DkRole, contestType?: DkContestType): number {
  if (sport === 'nba' || sport === 'wnba') return dkBasketballFantasyPoints(statLine);
  if (sport === 'nfl') return dkNflFantasyPoints(statLine, role);
  if (sport === 'mlb') return dkMlbFantasyPoints(statLine, role);
  if (sport === 'golf') return dkGolfFantasyPoints(statLine, contestType);
  return 0;
}
