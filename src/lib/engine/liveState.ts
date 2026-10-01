import type { LiveGameState, ValidatedSlate } from './contracts.js';

export interface LiveStatePackage {
  eventId: string;
  observedAt: string;
  source: string;
  status: LiveGameState['status'];
  facts: LiveGameState;
  warnings: string[];
}

/** Validates live facts without manufacturing pace, usage, or fantasy points. */
export function buildLiveStatePackage(slate: Pick<ValidatedSlate, 'event' | 'runMode' | 'liveGameState'>): LiveStatePackage | null {
  if (slate.runMode !== 'LIVE') return null;
  const state = slate.liveGameState;
  if (!state) throw new Error('LiveStatePackage is BLOCKED; structured liveGameState was not supplied.');
  const errors: string[] = [];
  if (state.eventId !== slate.event.eventId) errors.push('liveGameState.eventId does not match the slate event.');
  if (!state.source || !state.observedAt) errors.push('liveGameState source and observedAt are required.');
  if (!Number.isFinite(Date.parse(state.observedAt))) errors.push('liveGameState.observedAt is not a valid timestamp.');
  if (state.status === 'LIVE' && state.period === undefined && state.clockSeconds === undefined) errors.push('LIVE state requires period or clockSeconds.');
  if (errors.length) throw new Error(`LIVE_STATE contract validation failed: ${errors.join(' ')}`);
  const warnings = ['Live facts are descriptive inputs only; no first-half fantasy points are extrapolated.'];
  if (!state.playerStats) warnings.push('Player live-stat facts were not supplied.');
  if (!state.injuries) warnings.push('Live injury/substitution facts were not supplied.');
  return { eventId: state.eventId, observedAt: state.observedAt, source: state.source, status: state.status, facts: state, warnings };
}
