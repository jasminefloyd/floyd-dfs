import { detectAntiCorrelation, type AntiCorrelationLineup } from '../antiCorrelation.ts';

function assertEquals<T>(actual: T, expected: T) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test('MLB anti-correlation flags hitters facing lineup pitcher by opponent team', () => {
  const lineup: AntiCorrelationLineup = {
    players: [
      { name: 'Ace Pitcher', team: 'NYY', position: 'P', opponent_team: 'BOS' },
      { name: 'Boston Bat 1', team: 'BOS', position: 'OF', opposing_probable_pitcher_name: 'Ace Pitcher' },
      { name: 'Boston Bat 2', team: 'BOS', position: '1B', opposing_probable_pitcher_name: 'Ace Pitcher' },
      { name: 'Own Bat', team: 'NYY', position: 'OF' },
    ],
  };

  assertEquals(detectAntiCorrelation(lineup, 'mlb'), ['2 hitters facing Ace Pitcher']);
});

Deno.test('MLB anti-correlation ignores unrelated hitters', () => {
  const lineup: AntiCorrelationLineup = {
    players: [
      { name: 'Ace Pitcher', team: 'NYY', position: 'P', opponent_team: 'BOS' },
      { name: 'Toronto Bat 1', team: 'TOR', position: 'OF' },
      { name: 'Houston Bat 2', team: 'HOU', position: '1B' },
    ],
  };

  assertEquals(detectAntiCorrelation(lineup, 'mlb'), []);
});
