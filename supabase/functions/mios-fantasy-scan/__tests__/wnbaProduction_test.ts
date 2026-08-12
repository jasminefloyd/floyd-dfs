import { deriveWnbaComponentProjection } from '../wnbaProduction.ts';

function assert(value: boolean, message: string) { if (!value) throw new Error(message); }

Deno.test('WNBA component projection uses role history and preserves a hierarchical fallback', () => {
  const history = deriveWnbaComponentProjection([
    { minutes: 30, points: 18, totalRebounds: 5, assists: 7, steals: 1, blocks: 0, turnovers: 2, threePointFieldGoalsMade: 2 },
    { minutes: 28, points: 14, totalRebounds: 4, assists: 6, steals: 2, blocks: 0, turnovers: 1, threePointFieldGoalsMade: 1 },
    { minutes: 32, points: 20, totalRebounds: 6, assists: 8, steals: 1, blocks: 1, turnovers: 3, threePointFieldGoalsMade: 3 },
    { minutes: 29, points: 16, totalRebounds: 4, assists: 5, steals: 1, blocks: 0, turnovers: 2, threePointFieldGoalsMade: 2 },
  ], { position: 'PG', projectedMinutes: 31, roleStability: 0.8 });
  assert(history.source === 'role_filtered_history', `expected history source, got ${history.source}`);
  assert(history.fantasyPoints > 25 && history.assists > 4, `unexpected component result ${JSON.stringify(history)}`);
  const sparse = deriveWnbaComponentProjection([], { position: 'C', projectedMinutes: 28 });
  assert(sparse.source === 'position_hierarchical_prior' && sparse.fantasyPoints > 15, 'sparse player must use an explicit position prior');
});
