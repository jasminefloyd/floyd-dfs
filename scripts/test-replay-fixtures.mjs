import assert from 'node:assert/strict';
import { replayFixtures } from '../tests/fixtures/replay-cases.mjs';

const supportedSports = new Set(['NBA', 'WNBA', 'MLB', 'NFL', 'CFB', 'GOLF']);
const fixtureIds = new Set();

for (const fixture of replayFixtures) {
  assert.ok(!fixtureIds.has(fixture.fixtureId), `duplicate fixture ${fixture.fixtureId}`);
  fixtureIds.add(fixture.fixtureId);
  assert.equal(fixture.fixtureKind, 'SYNTHETIC_SANITIZED_REPLAY');
  assert.ok(supportedSports.has(fixture.sport), `unsupported fixture sport ${fixture.sport}`);
  assert.ok(fixture.games.length > 0, `${fixture.fixtureId} has no games`);
  assert.ok(fixture.rules.rosterSize > 0, `${fixture.fixtureId} has no roster slots`);
  assert.equal(Object.values(fixture.rules.slots).reduce((sum, count) => sum + count, 0), fixture.rules.rosterSize);
  assert.ok(fixture.salaryRows.length >= fixture.rules.rosterSize, `${fixture.fixtureId} has too few salary rows`);

  const games = new Set(fixture.games.map((game) => game.gameId));
  const players = new Map(fixture.salaryRows.map((player) => [player.playerId, player]));
  assert.equal(players.size, fixture.salaryRows.length, `${fixture.fixtureId} has duplicate player IDs`);
  for (const game of fixture.games) {
    assert.ok(Number.isFinite(Date.parse(game.scheduledStart)));
    assert.ok(Number.isFinite(Date.parse(game.lockTime)));
    assert.equal(game.teams.length, 2);
  }
  for (const player of fixture.salaryRows) {
    assert.ok(games.has(player.gameId), `${fixture.fixtureId}: ${player.playerId} has an unknown game`);
    assert.ok(Number.isFinite(player.salary) && player.salary > 0);
    assert.ok(player.eligibility?.length > 0, `${fixture.fixtureId}: ${player.playerId} has no eligibility`);
    assert.ok(Number.isFinite(player.projection.expectedPoints));
    assert.ok(Number.isFinite(Date.parse(player.projection.asOf)));
    assert.equal(player.availability.status, 'ACTIVE');
  }

  const assignedIds = Object.values(fixture.expected.rosterSlots);
  assert.equal(assignedIds.length, fixture.rules.rosterSize);
  assert.equal(new Set(assignedIds).size, assignedIds.length, `${fixture.fixtureId} repeats a player`);
  assert.deepEqual([...assignedIds].sort(), [...fixture.expected.playerIds].sort());
  let salary = 0;
  for (const [slot, playerId] of Object.entries(fixture.expected.rosterSlots)) {
    const player = players.get(playerId);
    assert.ok(player, `${fixture.fixtureId}: expected player ${playerId} is missing`);
    assert.ok(player.eligibility.includes(slot), `${fixture.fixtureId}: ${playerId} is not eligible for ${slot}`);
    salary += slot === 'CPT' ? Math.round(player.salary * 1.5) : player.salary;
  }
  assert.equal(fixture.expected.salaryUsed, salary);
  assert.ok(salary <= fixture.rules.salaryCap, `${fixture.fixtureId} expected lineup exceeds salary cap`);
  for (const observation of fixture.news) {
    assert.ok(players.has(observation.subjectPlayerId));
    assert.ok(Number.isFinite(Date.parse(observation.publishedAt)));
    assert.ok(Number.isFinite(Date.parse(observation.retrievedAt)));
  }
}

assert.ok(replayFixtures.some((fixture) => fixture.fixtureId === 'nba-classic-multi-game' && fixture.games.length > 1));
assert.ok(replayFixtures.some((fixture) => fixture.sport === 'NBA' && fixture.format === 'SHOWDOWN'));
assert.ok(replayFixtures.some((fixture) => fixture.sport === 'WNBA'));
for (const sport of supportedSports) assert.ok(replayFixtures.some((fixture) => fixture.sport === sport), `missing ${sport} replay fixture`);

console.log(`sanitized replay fixture checks passed (${replayFixtures.length} fixtures)`);
