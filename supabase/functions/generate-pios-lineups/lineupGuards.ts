export interface GuardPlayer {
  player_id: string;
  name: string;
  team: string;
  salary: number;
  roster_slot?: string;
  salary_multiplier?: number;
  ownership_projection?: number;
  cpt_ownership_projection?: number;
  flex_ownership_projection?: number;
}

export interface GuardLineup {
  players: GuardPlayer[];
  salary_used: number;
  top_n_rate?: number;
  win_rate?: number;
  expected_payout?: number;
}

export function isValidShowdownLineup(lineup: GuardLineup, minSalaryUsed = 0): boolean {
  const teams = new Set(lineup.players.map((player) => player.team).filter(Boolean));
  const ids = new Set(lineup.players.map((player) => player.player_id));
  const captainCount = lineup.players.filter((player) => player.roster_slot === 'CPT' && player.salary_multiplier === 1.5).length;
  return lineup.players.length === 6
    && ids.size === lineup.players.length
    && teams.size >= 2
    && captainCount === 1
    && lineup.salary_used <= 50_000
    && lineup.salary_used >= minSalaryUsed;
}

export function takeEntryCount<T>(lineups: T[], entryCount: number): T[] {
  return lineups.slice(0, Math.max(1, Math.floor(entryCount)));
}

export function maxPlayerExposureCount(lineups: GuardLineup[]): number {
  const counts = new Map<string, number>();
  for (const lineup of lineups) {
    for (const player of lineup.players) {
      counts.set(player.player_id, (counts.get(player.player_id) ?? 0) + 1);
    }
  }
  return Math.max(0, ...counts.values());
}

export function playerExposureWithinCap(lineups: GuardLineup[], maxPlayerExposure: number): boolean {
  return maxPlayerExposureCount(lineups) <= Math.max(1, Math.ceil(lineups.length * maxPlayerExposure));
}

export function uniqueCaptainCount(lineups: GuardLineup[]): number {
  return new Set(lineups.map((lineup) => lineup.players.find((player) => player.roster_slot === 'CPT')?.player_id).filter(Boolean)).size;
}

export function shrunkFantasyStdDev(observed: number, sampleSize: number, positionPrior: number): number {
  const safeSampleSize = Math.max(0, Math.floor(sampleSize));
  return observed * (safeSampleSize / (safeSampleSize + 4)) + positionPrior * (4 / (safeSampleSize + 4));
}

export function payoutObjectiveScore(lineup: GuardLineup, payoutShape: string): number {
  if (payoutShape === 'winner_take_all') return (lineup.win_rate ?? 0) * 10_000 + (lineup.expected_payout ?? 0);
  if (payoutShape === 'flat' || payoutShape === 'double_up') return (lineup.top_n_rate ?? 0) * 10_000 + (lineup.expected_payout ?? 0);
  return (lineup.expected_payout ?? 0) * 10_000 + (lineup.win_rate ?? 0) * 100;
}

export function expectedDuplicatesFromOwnership(players: GuardPlayer[], fieldSize: number): number {
  const product = players.reduce((probability, player) => {
    const ownership = player.roster_slot === 'CPT'
      ? player.cpt_ownership_projection ?? player.ownership_projection ?? 0
      : player.flex_ownership_projection ?? player.ownership_projection ?? 0;
    return probability * Math.max(ownership, 0);
  }, 1);
  return product * fieldSize;
}
