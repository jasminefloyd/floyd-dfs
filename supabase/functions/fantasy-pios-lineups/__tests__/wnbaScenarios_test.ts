import { normalizeWnbaScenarios, selectWnbaScenario } from '../wnbaScenarios.ts';
import { sampleWnbaOutcome } from '../simulation.ts';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

Deno.test('WNBA scenario probabilities are normalized and invalid states are discarded', () => {
  const scenarios = normalizeWnbaScenarios([
    { state: 'active', probability: 2 },
    { state: 'inactive', probability: 1 },
    { state: 'unknown', probability: 99 },
  ]);
  assert(scenarios.length === 2, 'expected two valid scenarios');
  assert(scenarios[0].probability === 2 / 3, 'expected normalized active probability');
  assert(scenarios[1].probability === 1 / 3, 'expected normalized inactive probability');
});

Deno.test('WNBA scenario selection is deterministic for a supplied random value', () => {
  const scenarios = normalizeWnbaScenarios([
    { state: 'active', probability: 0.75 },
    { state: 'inactive', probability: 0.25 },
  ]);
  assert(selectWnbaScenario(scenarios, 0.5)?.state === 'active', 'expected active scenario below threshold');
  assert(selectWnbaScenario(scenarios, 0.9)?.state === 'inactive', 'expected inactive scenario above threshold');
});

Deno.test('WNBA inactive scenario produces zero fantasy points', () => {
  const outcome = sampleWnbaOutcome(30, 8, [{ state: 'inactive', probability: 1 }], () => 0.5);
  assert(outcome === 0, 'inactive scenario must produce zero fantasy points');
});
