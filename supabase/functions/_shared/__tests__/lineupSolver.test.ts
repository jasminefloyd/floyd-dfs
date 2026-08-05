import {
  lineupSignature,
  solveOptimalLineups,
  type SolverPlayer,
  type SolverRosterSlot,
} from '../lineupSolver.ts';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const twoSlots: SolverRosterSlot[] = [
  { slot: 'A', eligible: ['A'] },
  { slot: 'B', eligible: ['B'] },
];

function player(id: string, position: string, projection: number, gameId?: string, team = 'T1', salary = 5_000): SolverPlayer {
  return { player_id: id, name: id, position, team, salary, projected_points: projection, game_id: gameId };
}

Deno.test('classic game constraint rejects a higher-scoring one-game lineup', () => {
  const players = [
    player('a_same', 'A', 100, 'game-1'),
    player('b_same', 'B', 100, 'game-1'),
    player('b_other', 'B', 80, 'game-2', 'T2'),
  ];
  const lineup = solveOptimalLineups(players, 'synthetic', 1, {
    slots: twoSlots,
    minDistinctGames: 2,
    deadlineMs: 1_000,
  })[0];

  assert(lineup.projected_points === 180, `expected two-game lineup at 180, got ${lineup?.projected_points}`);
  assert(lineup.players.some((candidate) => candidate.player_id === 'b_other'), 'expected player from the second game');
});

Deno.test('incomplete game data uses the two-team fallback', () => {
  const players = [
    player('a_same', 'A', 100, undefined, 'T1'),
    player('b_same', 'B', 100, 'game-1', 'T1'),
    player('b_other', 'B', 80, 'game-1', 'T2'),
  ];
  const lineup = solveOptimalLineups(players, 'synthetic', 1, {
    slots: twoSlots,
    minDistinctGames: 2,
    minDistinctTeams: 2,
    deadlineMs: 1_000,
  })[0];

  assert(lineup.projected_points === 180, `expected two-team fallback lineup at 180, got ${lineup?.projected_points}`);
  assert(new Set(lineup.players.map((candidate) => candidate.team)).size === 2, 'expected two distinct teams');
});

Deno.test('maxPerTeam rejects a higher-scoring lineup that overstacks one team', () => {
  const threeSlots: SolverRosterSlot[] = [
    { slot: 'A', eligible: ['A'] },
    { slot: 'B', eligible: ['B'] },
    { slot: 'PIT', eligible: ['P'] },
  ];
  const players = [
    player('a_hot', 'A', 100, 'game-1', 'T1'),
    player('b_hot', 'B', 100, 'game-1', 'T1'),
    player('c_pitcher_hot', 'P', 100, 'game-1', 'T1'),
    player('a_cool', 'A', 50, 'game-1', 'T2'),
    player('b_cool', 'B', 50, 'game-1', 'T2'),
    player('c_pitcher_cool', 'P', 50, 'game-1', 'T2'),
  ];
  const lineup = solveOptimalLineups(players, 'synthetic', 1, {
    slots: threeSlots,
    maxPerTeam: { max: 1, excludePositions: ['P'] },
    deadlineMs: 1_000,
  })[0];

  const hitterTeams = lineup.players.filter((candidate) => candidate.position !== 'P').map((candidate) => candidate.team);
  assert(new Set(hitterTeams).size === hitterTeams.length, `expected no team to supply more than 1 hitter, got teams ${hitterTeams}`);
  assert(lineup.players.some((candidate) => candidate.player_id === 'c_pitcher_hot'), 'excluded position should not count against the cap');
});

Deno.test('captain identity is part of a Showdown lineup signature', () => {
  const first = { players: [
    player('captain-a', 'UTIL', 10),
    player('flex-b', 'UTIL', 9),
  ].map((candidate, index) => ({ ...candidate, roster_slot: index === 0 ? 'CPT' : 'FLEX' })) };
  const second = { players: [
    player('captain-a', 'UTIL', 10),
    player('flex-b', 'UTIL', 9),
  ].map((candidate, index) => ({ ...candidate, roster_slot: index === 1 ? 'CPT' : 'FLEX' })) };

  assert(lineupSignature(first) !== lineupSignature(second), 'captain swaps must not deduplicate');
});

Deno.test('max shared players constrains additional lineups', () => {
  const players = [
    player('a1', 'A', 100), player('a2', 'A', 90), player('a3', 'A', 80),
    player('b1', 'B', 100), player('b2', 'B', 90), player('b3', 'B', 80),
  ];
  const lineups = solveOptimalLineups(players, 'synthetic', 3, {
    slots: twoSlots,
    maxSharedPlayers: 0,
    deadlineMs: 1_000,
  });

  assert(lineups.length === 3, `expected three lineups, got ${lineups.length}`);
  const firstIds = new Set(lineups[0].players.map((candidate) => candidate.player_id));
  for (const lineup of lineups.slice(1)) {
    const shared = lineup.players.filter((candidate) => firstIds.has(candidate.player_id)).length;
    assert(shared === 0, `expected no shared players, got ${shared}`);
  }
});

Deno.test('ties resolve by lower salary then deterministic signature', () => {
  const players = [
    player('a-cheap', 'A', 10, undefined, 'T1', 4_000),
    player('a-expensive', 'A', 10, undefined, 'T1', 5_000),
    player('b', 'B', 10, undefined, 'T2', 5_000),
  ];
  const lineup = solveOptimalLineups(players, 'synthetic', 1, { slots: twoSlots, deadlineMs: 1_000 })[0];
  assert(lineup.salary_used === 9_000, `expected cheaper tied lineup, got ${lineup.salary_used}`);
  assert(lineup.players.some((candidate) => candidate.player_id === 'a-cheap'), 'expected cheaper tied player');
});
