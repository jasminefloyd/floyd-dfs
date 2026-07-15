import type { Last5Game, Player } from './MIOS_FantasyAgents';
import { DK_SCORING } from './productConstants';

export interface CorrelationPair {
  player1_id: string;
  player2_id: string;
  correlation_score: number; // -1 to 1
  co_appearance_count: number; // games played together
  avg_combined_points: number;
  recommendation: string; // "stack together", "avoid together", "neutral"
}

// Minimum shared games required before a correlation is considered statistically
// meaningful. Below this, Pearson correlation on so few points is noise.
const MIN_CO_APPEARANCES = 3;

// Converts a single game's raw stat line into DraftKings fantasy points, per sport.
// NOTE: Last5Game has no `turnovers` or `three_pointers` fields, so those NBA/WNBA
// DK_SCORING categories can't be applied here — this is a data gap upstream, not a
// bug in this calculation.
function calculateFantasyPoints(game: Last5Game, sport: string): number {
  switch (sport) {
    case 'nba':
    case 'wnba': {
      const scoring = DK_SCORING[sport];
      return (
        (game.points || 0) * scoring.points +
        (game.rebounds || 0) * scoring.rebounds +
        (game.assists || 0) * scoring.assists +
        (game.steals || 0) * scoring.steals +
        (game.blocks || 0) * scoring.blocks
      );
    }
    case 'nfl': {
      const scoring = DK_SCORING.nfl;
      return (
        (game.passing_yards || 0) * scoring.passing_yards +
        (game.passing_tds || 0) * scoring.passing_td +
        (game.interceptions || 0) * scoring.interception +
        (game.rushing_yards || 0) * scoring.rushing_yards +
        (game.rushing_tds || 0) * scoring.rushing_td +
        (game.receiving_yards || 0) * scoring.receiving_yards +
        (game.receiving_tds || 0) * scoring.receiving_td +
        (game.receptions || 0) * scoring.reception
      );
    }
    case 'mlb': {
      const scoring = DK_SCORING.mlb;
      const singles = Math.max(
        (game.hits || 0) - (game.doubles || 0) - (game.triples || 0) - (game.home_runs || 0),
        0
      );
      return (
        singles * scoring.single +
        (game.doubles || 0) * scoring.double +
        (game.triples || 0) * scoring.triple +
        (game.home_runs || 0) * scoring.home_run +
        (game.rbis || 0) * scoring.rbi +
        (game.runs || 0) * scoring.run +
        (game.stolen_bases || 0) * scoring.stolen_base +
        (game.strikeouts || 0) * scoring.strikeout +
        (game.walks || 0) * scoring.walk
      );
    }
    case 'f1': {
      // NOTE: DraftKings' real F1 finishing-position formula wasn't verified this
      // session. This is a simplified, unverified placeholder (higher finish = more
      // points on a 20-point ordinal scale) consistent with the earlier caveat that
      // F1 roster/scoring rules haven't been confirmed against DK's actual rules.
      const scoring = DK_SCORING.f1;
      const positionPts = game.position ? Math.max(21 - game.position, 0) * scoring.position_finish : 0;
      const poleBonus = game.qualifying_pos === 1 ? scoring.pole_position : 0;
      const fastestLapBonus = game.fastest_lap ? scoring.fastest_lap : 0;
      return positionPts + poleBonus + fastestLapBonus;
    }
    default:
      return 0;
  }
}

function matchGamesByDate(gamesA: Last5Game[], gamesB: Last5Game[]): Array<[Last5Game, Last5Game]> {
  const mapB = new Map(gamesB.map((g) => [g.date, g]));
  const pairs: Array<[Last5Game, Last5Game]> = [];
  for (const gA of gamesA) {
    const gB = mapB.get(gA.date);
    if (gB) pairs.push([gA, gB]);
  }
  return pairs;
}

// Pearson correlation coefficient. Returns null when there isn't enough variance or
// data to compute a meaningful value (fewer than 2 points, or zero variance in either
// series would otherwise divide by zero).
function pearsonCorrelation(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;

  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let denomX = 0;
  let denomY = 0;

  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }

  if (denomX === 0 || denomY === 0) return null;

  return numerator / Math.sqrt(denomX * denomY);
}

export function generateCorrelationPairs(roster: Player[], sport: string): CorrelationPair[] {
  const withGames = roster.filter((p) => (p.last_5_stats?.games?.length ?? 0) > 0);
  const pairs: CorrelationPair[] = [];

  for (let i = 0; i < withGames.length; i++) {
    for (let j = i + 1; j < withGames.length; j++) {
      const playerA = withGames[i];
      const playerB = withGames[j];

      const matched = matchGamesByDate(playerA.last_5_stats!.games, playerB.last_5_stats!.games);
      if (matched.length < MIN_CO_APPEARANCES) continue;

      const aPoints = matched.map(([gA]) => calculateFantasyPoints(gA, sport));
      const bPoints = matched.map(([, gB]) => calculateFantasyPoints(gB, sport));

      const correlation = pearsonCorrelation(aPoints, bPoints);
      if (correlation === null) continue;

      const avgCombined =
        aPoints.reduce((sum, v, idx) => sum + v + bPoints[idx], 0) / matched.length;

      let recommendation = 'neutral';
      if (correlation > 0.6) recommendation = 'stack together';
      else if (correlation < -0.2) recommendation = 'avoid together';

      pairs.push({
        player1_id: playerA.id,
        player2_id: playerB.id,
        correlation_score: correlation,
        co_appearance_count: matched.length,
        avg_combined_points: avgCombined,
        recommendation
      });
    }
  }

  return pairs.sort((a, b) => b.correlation_score - a.correlation_score).slice(0, 10);
}
