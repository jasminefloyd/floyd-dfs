import { injuryContextNear, normalizeInjuryStatus } from '../injuryStatus.ts';

function assertEquals<T>(actual: T, expected: T, message?: string) {
  if (actual !== expected) {
    throw new Error(`${message ? `${message}: ` : ''}expected ${String(expected)}, got ${String(actual)}`);
  }
}

Deno.test('normalizeInjuryStatus maps explicit injury statuses without substring false positives', () => {
  const cases: Array<[unknown, ReturnType<typeof normalizeInjuryStatus>]> = [
    ['ruled out', 'out'],
    ['out indefinitely', 'out'],
    ['OUT', 'out'],
    ['Out (ankle)', 'out'],
    ['O', 'out'],
    ['post-workout soreness', 'active'],
    ['talked about his return', 'active'],
    ['without restriction', 'active'],
    ['shoutout after practice', 'active'],
    ['roughed out five innings', 'active'],
    ['doubtful', 'doubtful'],
    ['questionable', 'questionable'],
    ['game-time decision', 'questionable'],
    ['probable', 'probable'],
    ['expected to play', 'probable'],
    ['day-to-day', 'day_to_day'],
    ['DTD', 'day_to_day'],
  ];

  for (const [input, expected] of cases) {
    assertEquals(normalizeInjuryStatus(input), expected, String(input));
  }
});

Deno.test('injuryContextNear requires injury context close to the player match', () => {
  assertEquals(injuryContextNear('Jane Doe is questionable with knee soreness after practice.', 'janedoe'), true);
  assertEquals(injuryContextNear('Jane Doe talked about his return without restriction.', 'janedoe'), false);
  assertEquals(
    injuryContextNear(`Jane Doe posted a workout update. ${'x'.repeat(140)} Team says knee soreness remains.`, 'janedoe'),
    false,
  );
});
