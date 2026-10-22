import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const fixture = JSON.parse(await readFile(new URL('../tests/fixtures/contracts/fds-transport-v1.json', import.meta.url), 'utf8'));
const roundTrip = JSON.parse(JSON.stringify(fixture));
assert.equal(roundTrip.contractVersion, '2026-10-21.1');
assert.equal(roundTrip.transportContractVersion, 'fds.transport.v1');
assert.equal(roundTrip.providerIds.DRAFTKINGS, '0000123400');
assert.equal(roundTrip.photo.url, null);
assert.equal(roundTrip.marketContext, null);
assert.equal(roundTrip.salary, 0);
assert.equal(Object.hasOwn(roundTrip, 'fieldThatWasUndefined'), false);
console.log('Contract fixture preserves versions, string IDs, null, zero, and omission.');
