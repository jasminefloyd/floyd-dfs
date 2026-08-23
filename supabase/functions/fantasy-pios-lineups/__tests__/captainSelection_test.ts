import { selectCaptainCandidates, MIN_CAPTAIN_CONFIDENCE } from '../captainSelection.ts';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function player(id: string, confidence: number) {
  return { player_id: id, name: id, confidence_score: confidence };
}

Deno.test('excludes a low-confidence player from captain eligibility', () => {
  const players = [player('reliable_a', 0.9), player('reliable_b', 0.9), player('synthetic_only', 0.45)];
  const candidates = selectCaptainCandidates(players, false);

  assert(!candidates.some((p) => p.player_id === 'synthetic_only'), 'low-confidence player should be excluded');
  assert(candidates.length === 2, `expected 2 confident candidates, got ${candidates.length}`);
});

Deno.test('falls back to the full pool when every player is low-confidence', () => {
  const players = [player('a', 0.3), player('b', 0.45)];
  const candidates = selectCaptainCandidates(players, false);

  assert(candidates.length === 2, 'should not produce zero captain candidates when data is uniformly poor');
});

Deno.test('an explicit captain pool bypasses the confidence floor entirely', () => {
  const players = [player('reliable', 0.9), player('synthetic_only', 0.45)];
  const candidates = selectCaptainCandidates(players, true);

  assert(candidates.length === 2, 'explicit captain pool should not be filtered by confidence');
  assert(candidates.some((p) => p.player_id === 'synthetic_only'), 'low-confidence player should remain when pool is explicit');
});

Deno.test('the confidence floor is set at 0.5, above the 0.45 synthetic-fallback sentinel', () => {
  assert(MIN_CAPTAIN_CONFIDENCE === 0.5, `expected 0.5, got ${MIN_CAPTAIN_CONFIDENCE}`);
  assert(0.45 < MIN_CAPTAIN_CONFIDENCE, 'synthetic-fallback confidence (0.45) must fall below the floor');
});
