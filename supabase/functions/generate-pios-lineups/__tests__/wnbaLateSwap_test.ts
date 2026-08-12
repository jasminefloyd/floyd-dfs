import { changedInputs, lockedPlayersFromState, materialSwapAdvantage, preservesLockedSlots } from '../../_shared/wnbaLateSwap.ts';
function assert(value: boolean, message: string) { if (!value) throw new Error(message); }
Deno.test('late swap preserves locked slots and rejects changes inside noise', () => {
  const original = { players: [{ name: 'Locked Player', roster_slot: 'G1' }, { name: 'Swap Player', roster_slot: 'F1' }], top_n_rate: 0.1, duplicate_adjusted_expected_payout: 0.2, simulation_uncertainty: 0.02 };
  const candidate = { players: [{ name: 'Locked Player', roster_slot: 'G1' }, { name: 'Replacement', roster_slot: 'F1' }], top_n_rate: 0.11, duplicate_adjusted_expected_payout: 0.22, simulation_uncertainty: 0.02 };
  const states = [{ player_name: 'Locked Player', game_state: 'started' as const, player_state: 'started' as const, source: 'official', source_reliability: 1, observed_at: '2026-08-12T20:00:00Z' }];
  const locks = lockedPlayersFromState(original, states);
  assert(locks.length === 1 && preservesLockedSlots(original, candidate, locks), 'locked slot must remain unchanged');
  assert(!materialSwapAdvantage(original, candidate), 'small projected change must remain inside noise');
  assert(changedInputs([{ ...states[0], player_name: 'Late Scratch', game_state: 'unlocked', player_state: 'out' }]).length === 1, 'late scratch must trigger reoptimization');
});
