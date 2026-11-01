import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { replayFixtures } from '../tests/fixtures/replay-cases.mjs';

const baseline = JSON.parse(await readFile(new URL('../tests/fixtures/legacy-output-baselines.json', import.meta.url), 'utf8'));
const byId = new Map(replayFixtures.map((fixture) => [fixture.fixtureId, fixture]));
for (const [fixtureId, expected] of Object.entries(baseline.fixtures)) {
  const fixture = byId.get(fixtureId);
  assert.ok(fixture, `missing baseline fixture ${fixtureId}`);
  const stableInput = JSON.stringify({ fixtureId: fixture.fixtureId, sport: fixture.sport, format: fixture.format, games: fixture.games, rules: fixture.rules, salaryRows: fixture.salaryRows, expected: fixture.expected });
  const hash = createHash('sha256').update(stableInput).digest('hex');
  assert.equal(hash, expected.sha256, `${fixtureId} input hash changed; review and version the baseline explicitly`);
  let salaryUsed = 0;
  let providerFppgSum = 0;
  for (const [slot, playerId] of Object.entries(fixture.expected.rosterSlots)) {
    const player = fixture.salaryRows.find((row) => row.playerId === playerId);
    assert.ok(player, `${fixtureId}: missing output player ${playerId}`);
    salaryUsed += slot === 'CPT' ? Math.round(player.salary * 1.5) : player.salary;
    providerFppgSum += slot === 'CPT' ? player.projection.expectedPoints * 1.5 : player.projection.expectedPoints;
  }
  assert.deepEqual(fixture.expected.rosterSlots, expected.output.rosterSlots, `${fixtureId} expected lineup changed`);
  assert.ok(Math.abs(salaryUsed - expected.output.salaryUsed) <= baseline.numericTolerance, `${fixtureId} salary output changed`);
  assert.ok(Math.abs(providerFppgSum - expected.output.providerFppgSum) <= baseline.numericTolerance, `${fixtureId} provider projection sum changed`);
}
console.log('G0 NBA Classic and Showdown fixture output baselines passed.');
