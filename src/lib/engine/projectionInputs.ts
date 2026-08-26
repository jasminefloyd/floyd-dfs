import type { SlatePlayer, Sport } from './contracts.js';
import { normalizeProviderName, normalizeTeamCode } from './availability.js';

// Converts raw SportsDataIO PlayerGameProjectionStatsByDate rows into the per-minute/PA/
// inning/target rate fields projection.ts's REQUIRED lists expect. Field names are read
// defensively (multiple plausible key variants) because this repo has no live SportsDataIO
// subscription to verify exact field names against; a player who doesn't match or lacks the
// needed fields simply gets no projectionInputs and falls back to the providerFppg path in
// projection.ts — never a guessed rate.
// SportsDataIO's PlayerSeasonStats rows carry season TOTALS (e.g. PlateAppearances across the
// whole season), not a single game's line -- every *PerPA/*PerMinute/*PerInning rate below is
// already correct computed straight against those totals (a rate is scale-invariant between a
// season and a single game), but the "expected volume" field (expectedPA, expectedMinutes,
// expectedInnings, passAttempts/targets/carries) must become a per-game average, not the raw
// season sum. `gamesPlayed` does exactly that division; callers passing single-game rows keep
// today's behavior unchanged via the default of 1.
export function deriveSeasonBasedInputs(sport: Sport, player: SlatePlayer, seasonRows: Record<string, unknown>[]): Record<string, number> | undefined {
  const row = findRow(player, seasonRows);
  if (!row) return undefined;
  const gamesPlayed = gamesPlayedFromRow(row);
  if (gamesPlayed <= 0) return undefined;
  if (sport === 'NBA' || sport === 'WNBA') return deriveBasketballInputs(row, gamesPlayed);
  if (sport === 'MLB') return isPitcher(player) ? derivePitcherInputs(row, gamesPlayed) : deriveHitterInputs(row, gamesPlayed);
  if (sport === 'NFL') return isQuarterback(player) ? deriveQuarterbackInputs(row, gamesPlayed) : deriveSkillPlayerInputs(row, gamesPlayed);
  return undefined;
}

export function isPitcher(player: { position?: string }): boolean { return /^(SP|RP|P)$/i.test(player.position ?? ''); }
export function isQuarterback(player: { position?: string }): boolean { return /^QB$/i.test(player.position ?? ''); }

// MLB/NBA report games played under `Games`; NFL's season-stats endpoint uses `Played` instead
// (verified live -- `Games` comes back undefined for every NFL row on this account).
export function gamesPlayedFromRow(row: Record<string, unknown>): number { return readNumber(row, ['Games', 'Played', 'games']) ?? 0; }

export function findRow(player: SlatePlayer, rows: Record<string, unknown>[]): Record<string, unknown> | undefined {
  const targetName = normalizeProviderName(player.playerName);
  const targetTeam = normalizeTeamCode(player.team);
  return rows.find((row) => {
    const name = normalizeProviderName(readString(row, ['Name', 'PlayerName', 'name']) ?? '');
    const team = normalizeTeamCode(readString(row, ['Team', 'team', 'TeamAbbreviation']));
    return name === targetName && (!targetTeam || !team || team === targetTeam);
  });
}

function deriveBasketballInputs(row: Record<string, unknown>, gamesPlayed = 1): Record<string, number> | undefined {
  const minutes = readNumber(row, ['Minutes', 'minutes']);
  if (!minutes || minutes <= 0 || gamesPlayed <= 0) return undefined;
  const points = readNumber(row, ['Points', 'points']) ?? 0;
  const rebounds = readNumber(row, ['Rebounds', 'rebounds']) ?? 0;
  const assists = readNumber(row, ['Assists', 'assists']) ?? 0;
  const steals = readNumber(row, ['Steals', 'steals']) ?? 0;
  const blocks = readNumber(row, ['BlockedShots', 'Blocks', 'blocks']) ?? 0;
  const turnovers = readNumber(row, ['Turnovers', 'turnovers']) ?? 0;
  const threes = readNumber(row, ['ThreePointersMade', 'threePointersMade']) ?? 0;
  return { expectedMinutes: minutes / gamesPlayed, pointsPerMinute: points / minutes, reboundsPerMinute: rebounds / minutes, assistsPerMinute: assists / minutes, stealsPerMinute: steals / minutes, blocksPerMinute: blocks / minutes, turnoversPerMinute: turnovers / minutes, threesPerMinute: threes / minutes };
}

function deriveHitterInputs(row: Record<string, unknown>, gamesPlayed = 1): Record<string, number> | undefined {
  const atBats = readNumber(row, ['AtBats', 'atBats']) ?? 0;
  const walks = readNumber(row, ['Walks', 'BaseOnBalls', 'walks']) ?? 0;
  const hitByPitch = readNumber(row, ['HitByPitch', 'hitByPitch']) ?? 0;
  const sacFly = readNumber(row, ['SacrificeFlies', 'sacrificeFlies']) ?? 0;
  const plateAppearances = readNumber(row, ['PlateAppearances', 'plateAppearances']) ?? (atBats + walks + hitByPitch + sacFly);
  if (!plateAppearances || plateAppearances <= 0 || gamesPlayed <= 0) return undefined;
  const hits = readNumber(row, ['Hits', 'hits']) ?? 0;
  const singles = readNumber(row, ['Singles', 'singles']) ?? 0;
  const doubles = readNumber(row, ['Doubles', 'doubles']) ?? 0;
  const triples = readNumber(row, ['Triples', 'triples']) ?? 0;
  const homeRuns = readNumber(row, ['HomeRuns', 'homeRuns']) ?? 0;
  const totalBases = readNumber(row, ['TotalBases', 'totalBases']) ?? (singles || (hits - doubles - triples - homeRuns)) + doubles * 2 + triples * 3 + homeRuns * 4;
  const rbi = readNumber(row, ['RunsBattedIn', 'RBI', 'rbi']) ?? 0;
  const runs = readNumber(row, ['Runs', 'runs']) ?? 0;
  const stolenBases = readNumber(row, ['StolenBases', 'stolenBases']) ?? 0;
  return { expectedPA: plateAppearances / gamesPlayed, hitRate: hits / plateAppearances, totalBasesPerPA: totalBases / plateAppearances, rbiPerPA: rbi / plateAppearances, runsPerPA: runs / plateAppearances, stolenBasesPerPA: stolenBases / plateAppearances };
}

// PlayerSeasonStats rows carry a batter/pitcher split -- a pitcher's own real strikeouts/walks/
// hits-allowed/earned-runs live under the Pitching*-prefixed fields (verified live: a real
// starting pitcher's season row had `Strikeouts: 0` (their own at-bats as a batter) but
// `PitchingStrikeouts: 62.8` (their real total)). Pitching* is checked first since it's the
// verified-correct field for season rows; the bare names stay as a fallback for any other row
// shape this function might still receive.
function derivePitcherInputs(row: Record<string, unknown>, gamesPlayed = 1): Record<string, number> | undefined {
  const innings = readNumber(row, ['InningsPitchedDecimal', 'InningsPitched', 'inningsPitched']);
  if (!innings || innings <= 0 || gamesPlayed <= 0) return undefined;
  const strikeouts = readNumber(row, ['PitchingStrikeouts', 'Strikeouts', 'strikeouts']) ?? 0;
  const walks = readNumber(row, ['PitchingWalks', 'Walks', 'BaseOnBallsAllowed', 'walks']) ?? 0;
  const hitsAllowed = readNumber(row, ['PitchingHits', 'HitsAllowed', 'hitsAllowed']) ?? 0;
  const earnedRuns = readNumber(row, ['PitchingEarnedRuns', 'EarnedRuns', 'earnedRuns']) ?? 0;
  return { expectedInnings: innings / gamesPlayed, strikeoutsPerInning: strikeouts / innings, walksPerInning: walks / innings, hitsAllowedPerInning: hitsAllowed / innings, earnedRunsPerInning: earnedRuns / innings };
}

function deriveQuarterbackInputs(row: Record<string, unknown>, gamesPlayed = 1): Record<string, number> | undefined {
  const attempts = readNumber(row, ['PassingAttempts', 'passingAttempts']);
  if (!attempts || attempts <= 0 || gamesPlayed <= 0) return undefined;
  const completions = readNumber(row, ['PassingCompletions', 'Completions', 'passingCompletions']) ?? 0;
  const passingYards = readNumber(row, ['PassingYards', 'passingYards']) ?? 0;
  const passingTouchdowns = readNumber(row, ['PassingTouchdowns', 'passingTouchdowns']) ?? 0;
  const interceptions = readNumber(row, ['PassingInterceptions', 'Interceptions', 'passingInterceptions']) ?? 0;
  const carries = readNumber(row, ['RushingAttempts', 'rushingAttempts']) ?? 0;
  const rushingYards = readNumber(row, ['RushingYards', 'rushingYards']) ?? 0;
  const rushingTouchdowns = readNumber(row, ['RushingTouchdowns', 'rushingTouchdowns']) ?? 0;
  return { passAttempts: attempts / gamesPlayed, completionRate: completions / attempts, yardsPerCompletion: completions > 0 ? passingYards / completions : 0, passingTouchdownRate: passingTouchdowns / attempts, interceptionRate: interceptions / attempts, carries: carries / gamesPlayed, yardsPerCarry: carries > 0 ? rushingYards / carries : 0, touchdownProbability: rushingTouchdowns / gamesPlayed };
}

function deriveSkillPlayerInputs(row: Record<string, unknown>, gamesPlayed = 1): Record<string, number> | undefined {
  const targets = readNumber(row, ['ReceivingTargets', 'Targets', 'targets']) ?? 0;
  const carries = readNumber(row, ['RushingAttempts', 'rushingAttempts']) ?? 0;
  if ((targets <= 0 && carries <= 0) || gamesPlayed <= 0) return undefined;
  const snaps = readNumber(row, ['OffensiveSnapsPlayed', 'Snaps', 'snaps']) ?? 0;
  const routes = readNumber(row, ['RoutesRun', 'routes']) ?? targets;
  const receptions = readNumber(row, ['Receptions', 'receptions']) ?? 0;
  const receivingYards = readNumber(row, ['ReceivingYards', 'receivingYards']) ?? 0;
  const receivingTouchdowns = readNumber(row, ['ReceivingTouchdowns', 'receivingTouchdowns']) ?? 0;
  const rushingYards = readNumber(row, ['RushingYards', 'rushingYards']) ?? 0;
  const rushingTouchdowns = readNumber(row, ['RushingTouchdowns', 'rushingTouchdowns']) ?? 0;
  return { snaps: snaps / gamesPlayed, routes: routes / gamesPlayed, targets: targets / gamesPlayed, carries: carries / gamesPlayed, catchRate: targets > 0 ? receptions / targets : 0, yardsPerTarget: targets > 0 ? receivingYards / targets : 0, yardsPerCarry: carries > 0 ? rushingYards / carries : 0, touchdownProbability: (receivingTouchdowns + rushingTouchdowns) / gamesPlayed };
}

function readString(record: Record<string, unknown>, keys: string[]): string | undefined { for (const key of keys) if (typeof record[key] === 'string' && String(record[key]).trim()) return String(record[key]).trim(); return undefined; }
function readNumber(record: Record<string, unknown>, keys: string[]): number | undefined { for (const key of keys) { const value = record[key]; if (typeof value === 'number' && Number.isFinite(value)) return value; if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value); } return undefined; }
