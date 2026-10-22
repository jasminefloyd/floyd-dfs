// Synthetic, sanitized fixtures. These are not DraftKings rules profiles or real player data.
const kickoff = '2026-09-30T23:00:00.000Z';
const receivedAt = '2026-09-30T18:00:00.000Z';

function makeFixture({ id, sport, format = 'CLASSIC', games = ['game-1'], slots, players, expectedSlots }) {
  const gameRows = games.map((gameId, index) => ({
    gameId,
    providerGameId: `${sport.toLowerCase()}-fixture-${index + 1}`,
    teams: [`${sport}-HOME-${index + 1}`, `${sport}-AWAY-${index + 1}`],
    scheduledStart: kickoff,
    lockTime: kickoff,
    status: 'SCHEDULED',
  }));
  const salaryRows = players.map(([playerId, gameId, team, positions, salary, projection], index) => ({
    playerId,
    providerPlayerId: `${sport.toLowerCase()}-fixture-player-${index + 1}`,
    gameId,
    team,
    eligibility: positions,
    salary,
    projection: { expectedPoints: projection, modelVersion: 'synthetic-baseline-1', asOf: receivedAt },
    availability: { status: 'ACTIVE', source: 'FIXTURE', retrievedAt: receivedAt },
  }));
  return {
    fixtureId: id,
    fixtureKind: 'SYNTHETIC_SANITIZED_REPLAY',
    sport,
    format,
    rules: {
      version: 'fixture-only-1',
      salaryCap: 50000,
      rosterSize: Object.values(slots).reduce((sum, count) => sum + count, 0),
      slots,
      scoring: { profile: 'fixture-only-points', points: 1 },
      note: 'Reduced structural fixture for deterministic baseline tests; not an authoritative contest profile.',
    },
    games: gameRows,
    salaryRows,
    news: salaryRows.map((player, index) => ({
      observationId: `${id}-news-${index + 1}`,
      subjectPlayerId: player.playerId,
      factType: 'availability.status',
      value: 'ACTIVE',
      publishedAt: receivedAt,
      retrievedAt: receivedAt,
    })),
    expected: {
      outcome: 'LEGAL_LINEUP',
      rosterSlots: expectedSlots,
      playerIds: Object.values(expectedSlots),
      salaryUsed: Object.entries(expectedSlots).reduce((sum, [slot, playerId]) => {
        const player = salaryRows.find((row) => row.playerId === playerId);
        return sum + (slot === 'CPT' ? Math.round(player.salary * 1.5) : player.salary);
      }, 0),
    },
  };
}

export const replayFixtures = [
  makeFixture({ id: 'nba-classic-multi-game', sport: 'NBA', games: ['nba-game-east', 'nba-game-west'], slots: { G: 1, C: 1 }, players: [
    ['nba-pg-001', 'nba-game-east', 'NBA-HOME-1', ['G'], 7000, 38],
    ['nba-c-002', 'nba-game-west', 'NBA-AWAY-2', ['C'], 6200, 32],
    ['nba-g-003', 'nba-game-east', 'NBA-AWAY-1', ['G'], 5400, 27],
  ], expectedSlots: { G: 'nba-pg-001', C: 'nba-c-002' } }),
  makeFixture({ id: 'nba-showdown', sport: 'NBA', format: 'SHOWDOWN', slots: { CPT: 1, UTIL: 1 }, players: [
    ['nba-cpt-001', 'game-1', 'NBA-HOME-1', ['CPT', 'UTIL'], 9000, 40],
    ['nba-util-002', 'game-1', 'NBA-AWAY-1', ['CPT', 'UTIL'], 7000, 31],
    ['nba-util-003', 'game-1', 'NBA-HOME-1', ['CPT', 'UTIL'], 6000, 26],
  ], expectedSlots: { CPT: 'nba-cpt-001', UTIL: 'nba-util-002' } }),
  makeFixture({ id: 'wnba-classic', sport: 'WNBA', slots: { G: 1, F: 1 }, players: [
    ['wnba-g-001', 'game-1', 'WNBA-HOME-1', ['G'], 8500, 37],
    ['wnba-f-002', 'game-1', 'WNBA-AWAY-1', ['F'], 7900, 34],
    ['wnba-f-003', 'game-1', 'WNBA-HOME-1', ['F'], 6200, 25],
  ], expectedSlots: { G: 'wnba-g-001', F: 'wnba-f-002' } }),
  makeFixture({ id: 'mlb-classic', sport: 'MLB', slots: { P: 1, UTIL: 1 }, players: [
    ['mlb-p-001', 'game-1', 'MLB-HOME-1', ['P'], 9800, 24],
    ['mlb-h-002', 'game-1', 'MLB-AWAY-1', ['UTIL'], 5100, 11],
    ['mlb-h-003', 'game-1', 'MLB-HOME-1', ['UTIL'], 4600, 9],
  ], expectedSlots: { P: 'mlb-p-001', UTIL: 'mlb-h-002' } }),
  makeFixture({ id: 'nfl-classic', sport: 'NFL', slots: { QB: 1, FLEX: 1 }, players: [
    ['nfl-qb-001', 'game-1', 'NFL-HOME-1', ['QB'], 7200, 25],
    ['nfl-wr-002', 'game-1', 'NFL-AWAY-1', ['FLEX'], 6800, 19],
    ['nfl-rb-003', 'game-1', 'NFL-HOME-1', ['FLEX'], 7400, 20],
  ], expectedSlots: { QB: 'nfl-qb-001', FLEX: 'nfl-wr-002' } }),
  makeFixture({ id: 'cfb-classic', sport: 'CFB', slots: { QB: 1, FLEX: 1 }, players: [
    ['cfb-qb-001', 'game-1', 'CFB-HOME-1', ['QB'], 8800, 31],
    ['cfb-wr-002', 'game-1', 'CFB-AWAY-1', ['FLEX'], 6600, 18],
    ['cfb-rb-003', 'game-1', 'CFB-HOME-1', ['FLEX'], 7600, 22],
  ], expectedSlots: { QB: 'cfb-qb-001', FLEX: 'cfb-wr-002' } }),
  makeFixture({ id: 'golf-classic', sport: 'GOLF', slots: { G: 1, UTIL: 1 }, players: [
    ['golf-player-001', 'game-1', 'GOLF-FIELD', ['G'], 10200, 48],
    ['golf-player-002', 'game-1', 'GOLF-FIELD', ['UTIL'], 7600, 33],
    ['golf-player-003', 'game-1', 'GOLF-FIELD', ['UTIL'], 6200, 25],
  ], expectedSlots: { G: 'golf-player-001', UTIL: 'golf-player-002' } }),
  makeFixture({ id: 'golf-showdown', sport: 'GOLF', format: 'SHOWDOWN', slots: { G: 1, UTIL: 1 }, players: [
    ['golf-showdown-001', 'game-1', 'GOLF-FIELD', ['G'], 9400, 44],
    ['golf-showdown-002', 'game-1', 'GOLF-FIELD', ['UTIL'], 7100, 31],
    ['golf-showdown-003', 'game-1', 'GOLF-FIELD', ['UTIL'], 5700, 23],
  ], expectedSlots: { G: 'golf-showdown-001', UTIL: 'golf-showdown-002' } }),
];
