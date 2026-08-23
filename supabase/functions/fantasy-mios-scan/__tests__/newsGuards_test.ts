import { mostRecentMatchingNews } from '../newsGuards.ts';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

Deno.test('9.8 stale out news loses to fresh expected-to-play news', () => {
  const now = Date.parse('2026-07-27T00:00:00Z');
  const match = mostRecentMatchingNews('LeBron James', 'LAL', [
    { raw: 'LeBron James ruled out for Lakers', timestamp: now - 7 * 24 * 60 * 60 * 1000 },
    { raw: 'LeBron James expected to play for Lakers tonight', timestamp: now - 20 * 60 * 1000 },
  ], now);

  assert(match?.raw.includes('expected to play') ?? false, 'fresh expected-to-play item should win');
});

Deno.test('9.9 shorthand player news matches canonical full name', () => {
  const now = Date.parse('2026-07-27T00:00:00Z');
  const match = mostRecentMatchingNews('LeBron James', 'LAL', [
    { raw: 'LeBron ruled out for LAL', timestamp: now - 15 * 60 * 1000 },
  ], now);

  assert(match?.raw.includes('LeBron ruled out') ?? false, 'LeBron shorthand should match LeBron James');
});
