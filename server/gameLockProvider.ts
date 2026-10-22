import type { Sport, ValidatedSlate } from '../src/lib/engine/contracts.js';
import { assessGameLocks, parseEspnScoreboard, parseSportsDataIoGames } from '../src/lib/engine/gameLockState.js';
import { fetchEspnJson } from '../src/lib/engine/espnApiClient.js';
import { SportsDataIoClient } from '../src/lib/engine/sportsDataIoProvider.js';

export interface LateSwapLockSnapshot {
  tenantId: string;
  contestId: string;
  lateSwapAllowed: boolean | null;
  verification: 'VERIFIED' | 'UNKNOWN' | 'UNSUPPORTED';
  verifiedAt: string;
  source: string;
  games: ReturnType<typeof assessGameLocks>;
  reasons: string[];
}

/** Use existing project feeds for game-level states. Contest eligibility stays unknown unless DraftKings supplies an explicit reviewed field. */
export async function getLateSwapLockSnapshot(slate: ValidatedSlate, options: { now?: Date; signal?: AbortSignal; lateSwapAllowed?: boolean | null } = {}): Promise<LateSwapLockSnapshot> {
  const now = options.now ?? new Date();
  const retrievedAt = now.toISOString();
  if (!slate.games?.length) return unknownSnapshot(slate, retrievedAt, 'UNSUPPORTED', 'This slate has no canonical per-game identities to reconcile.');
  if (slate.sport === 'GOLF') return unknownSnapshot(slate, retrievedAt, 'UNSUPPORTED', 'The configured sources do not provide individual DraftKings golfer lock times for a golf slate.');
  try {
    let source: string;
    let providerGames;
    if (slate.sport === 'MLB') {
      const key = process.env.SPORTS_DATA_IO_KEY?.trim();
      if (!key) return unknownSnapshot(slate, retrievedAt, 'UNSUPPORTED', 'SPORTS_DATA_IO_KEY is not configured; the existing production integration uses SportsDataIO for MLB because ESPN MLB scoreboard access is blocked.');
      const client = new SportsDataIoClient({ apiKey: key, baseUrl: process.env.SPORTS_DATA_IO_BASE_URL });
      const payload = await client.get<unknown>('MLB', 'scores', 'GamesByDate', dateForSlate(slate), options.signal);
      providerGames = parseSportsDataIoGames(payload);
      source = 'SPORTSDATAIO_MLB_GAMES_BY_DATE';
    } else {
      const sportPath = espnSportPath(slate.sport);
      const baseUrl = (process.env.ESPN_BASE_URL ?? 'https://site.api.espn.com/apis/site/v2').replace(/\/+$/, '');
      const result = await fetchEspnJson(`${baseUrl}/sports/${sportPath}/scoreboard?dates=${dateForSlate(slate)}`, { signal: options.signal, cacheTtlMs: 30_000, maxAttempts: 2 });
      providerGames = parseEspnScoreboard(result.payload);
      source = `ESPN_${slate.sport}_SCOREBOARD`;
    }
    const games = assessGameLocks({ sport: slate.sport, games: slate.games, providerGames, source, retrievedAt, now });
    const reasons = games.flatMap((game) => game.reason ? [`${game.gameId}: ${game.reason}`] : []);
    if (options.lateSwapAllowed === null || options.lateSwapAllowed === undefined) reasons.push('DraftKings contest metadata did not explicitly report late-swap eligibility; actionable swaps remain blocked.');
    else if (options.lateSwapAllowed === false) reasons.push('DraftKings explicitly reports that this contest does not permit late swap.');
    if (!games.length) reasons.push('The provider returned no games for this slate.');
    const locksVerified = games.length > 0 && games.every((game) => game.locked !== null);
    const verification = options.lateSwapAllowed === false ? 'VERIFIED' : options.lateSwapAllowed === true && locksVerified ? 'VERIFIED' : 'UNKNOWN';
    return { tenantId: slate.tenantId, contestId: slate.contest.draftKingsContestId, lateSwapAllowed: options.lateSwapAllowed ?? null, verification, verifiedAt: retrievedAt, source, games, reasons };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Configured game-status provider request failed.';
    return unknownSnapshot(slate, retrievedAt, 'UNKNOWN', message);
  }
}

function unknownSnapshot(slate: ValidatedSlate, retrievedAt: string, verification: 'UNKNOWN' | 'UNSUPPORTED', reason: string): LateSwapLockSnapshot {
  return { tenantId: slate.tenantId, contestId: slate.contest.draftKingsContestId, lateSwapAllowed: null, verification, verifiedAt: retrievedAt, source: 'UNAVAILABLE', games: (slate.games ?? []).map((game) => ({ gameId: game.gameId, source: 'UNAVAILABLE', retrievedAt, lockTime: null, status: 'UNKNOWN' as const, locked: null, reason })), reasons: [reason, 'DraftKings contest late-swap eligibility is not verified; do not create or apply an actionable swap plan.'] };
}
function dateForSlate(slate: ValidatedSlate): string { return new Date(slate.event.eventDate).toISOString().slice(0, 10).replaceAll('-', ''); }
function espnSportPath(sport: Exclude<Sport, 'MLB' | 'GOLF'>): string { return ({ NFL: 'football/nfl', CFB: 'football/college-football', NBA: 'basketball/nba', WNBA: 'basketball/wnba' })[sport]; }
