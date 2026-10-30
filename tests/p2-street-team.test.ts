import assert from 'node:assert/strict';
import { SportsDataIoClient } from '../src/lib/engine/sportsDataIoProvider.js';
import { SportsDataIoNbaStreetTeamProvider } from '../server/nbaStreetTeamProvider.js';

const fixedNow = () => new Date('2026-10-29T16:00:00.000Z');
const requested: string[] = [];
const fetcher: typeof fetch = async (input, init) => {
  const url = String(input);
  requested.push(url);
  if (url.includes('/espn/rss/nba/news')) return new Response('<rss><channel><item><title>Example Player returns to practice</title><link>https://news.example/nba/example-player</link><pubDate>Thu, 29 Oct 2026 15:00:00 GMT</pubDate><description>Team lists Example Player in a practice update.</description></item></channel></rss>', { status: 200, headers: { 'content-type': 'application/rss+xml' } });
  if (url.includes('rotowire.com/rss/news.php?sport=NBA')) return new Response('<rss><channel><item><title>NBA rotation watch</title><link>https://news.example/nba/rotation-watch</link><pubDate>Thu, 29 Oct 2026 15:00:00 GMT</pubDate><description>Several teams provide updates.</description></item></channel></rss>', { status: 200, headers: { 'content-type': 'application/rss+xml' } });
  assert.equal(new Headers(init?.headers).get('Ocp-Apim-Subscription-Key'), 'test-key');
  let payload: unknown = [];
  if (url.endsWith('/nba/scores/json/Players')) payload = [
    { PlayerID: 42, Name: 'Example Player', Team: 'BOS', TeamID: 2, Status: 'Active', InjuryStatus: null, DraftKingsPlayerID: 900 },
    { PlayerID: 43, FirstName: 'Second', LastName: 'Player', Team: 'NY', TeamID: 3, Status: 'Active' },
  ];
  if (url.endsWith('/nba/projections/json/InjuredPlayers')) payload = [
    { PlayerID: 42, Name: 'Example Player', Team: 'BOS', InjuryStatus: 'Questionable', InjuryBodyPart: 'ankle', InjuryNote: 'Listed questionable' },
  ];
  if (url.endsWith('/nba/projections/json/StartingLineupsByDate/2026-OCT-29')) payload = [{ GameID: 700, HomeTeamID: 2, HomeTeam: 'BOS', HomeLineup: [{ PlayerID: 42, FirstName: 'Example', LastName: 'Player', Starting: true, Confirmed: true, LineupStatus: 'Starting' }], AwayTeamID: 3, AwayTeam: 'NY', AwayLineup: [] }];
  if (url.endsWith('/nba/scores/json/TransactionsByDate/2026-OCT-29')) payload = [{ PlayerID: 42, Name: 'Example Player', FormerTeamID: 2, FormerTeam: 'BOS', TeamID: 3, Team: 'NY', Type: 'Traded', Date: '2026-10-29', Note: 'Example transaction' }];
  if (url.endsWith('/nba/scores/json/TransactionsByDate/2026-OCT-28')) payload = [];
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
};

async function main(): Promise<void> {
const client = new SportsDataIoClient({ apiKey: 'test-key', fetcher, maxAttempts: 1 });
const provider = new SportsDataIoNbaStreetTeamProvider(client, fixedNow, fetcher);
const result = await provider.collect({ windowStart: new Date('2026-10-28T16:00:00.000Z'), asOf: fixedNow() });

assert.equal(result.rosterState.length, 3);
assert.equal(result.rosterState[0].playerId, 'nba:player:sportsdataio:42');
assert.equal(result.availability[0].status, 'QUESTIONABLE');
assert.equal(result.transactions.length, 1);
assert.equal(result.transactions[0].transactionType, 'Traded');
assert.equal(result.transactions[0].effectiveAt, '2026-10-29T00:00:00.000Z');
assert.equal(result.unknowns.length, 0);
assert.ok(requested.some((url) => url.endsWith('/nba/scores/json/Players')));
assert.ok(requested.some((url) => url.endsWith('/nba/projections/json/InjuredPlayers')));
assert.ok(requested.some((url) => url.endsWith('/nba/scores/json/TransactionsByDate/2026-OCT-28')));
assert.ok(result.observations.every((observation) => observation.classification === 'SINGLE_SOURCE_REPORT'));
assert.ok(result.observations.some((observation) => observation.provider === 'ESPN NBA' && observation.subjectId === 'nba:player:sportsdataio:42'));
assert.ok(result.observations.some((observation) => observation.subjectKind === 'LEAGUE' && observation.subjectId === 'nba:league'));
assert.ok(result.resolvedFacts.every((fact) => fact.observationIds.every((id) => result.observations.some((observation) => observation.id === id))));

const conflictProvider = new SportsDataIoNbaStreetTeamProvider(new SportsDataIoClient({
  apiKey: 'test-key', maxAttempts: 1,
  fetcher: async (input) => {
    const url = String(input);
    const payload = url.endsWith('/nba/scores/json/Players')
      ? [{ PlayerID: 9, Name: 'Same ID', Team: 'BOS' }, { PlayerID: 9, Name: 'Same ID', Team: 'NY' }]
      : [];
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  },
}), fixedNow, async () => new Response('<rss><channel></channel></rss>', { status: 200, headers: { 'content-type': 'application/rss+xml' } }));
const conflict = await conflictProvider.collect({ windowStart: fixedNow(), asOf: fixedNow() });
assert.equal(conflict.rosterState.length, 0);
assert.ok(conflict.unknowns.some((unknown) => unknown.reason.includes('quarantined')));

console.log('P2 NBA provider normalization, identity quarantine, timestamp, and provenance checks passed.');
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
