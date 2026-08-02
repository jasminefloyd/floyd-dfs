import { positionMeanPpm, redistributeMinutes, type OpportunityPlayer } from '../opportunity.ts';

Deno.test('WNBA opportunity priors are sport-specific rather than an NBA scale factor', () => {
  if (positionMeanPpm('PG', 'wnba') !== 0.91) throw new Error('Expected the WNBA PG prior to be used');
  if (positionMeanPpm('PG', 'nba') !== 1.05) throw new Error('Expected the NBA PG prior to remain unchanged');
});

Deno.test('redistributeMinutes sends 70 percent of out guard minutes to active guard teammates', () => {
  const players: OpportunityPlayer[] = [
    {
      id: 'starter-pg',
      name: 'Starter PG',
      team: 'BOS',
      position: 'PG',
      injury_status: 'out',
      minutes_projection: 34,
      projected_points: 34,
      last_5_stats: { avg_fantasy_pts: 34, minutes_avg: 34, games: [{}] },
    },
    {
      id: 'backup-a',
      name: 'Backup A',
      team: 'BOS',
      position: 'PG',
      injury_status: 'active',
      minutes_projection: 18,
      projected_points: 18,
      last_5_stats: { avg_fantasy_pts: 18, minutes_avg: 18, games: [{}] },
    },
    {
      id: 'backup-b',
      name: 'Backup B',
      team: 'BOS',
      position: 'SG',
      injury_status: 'active',
      minutes_projection: 12,
      projected_points: 12,
      last_5_stats: { avg_fantasy_pts: 12, minutes_avg: 12, games: [{}] },
    },
  ];

  const result = redistributeMinutes(players);
  const backupA = result.players.find((player) => player.id === 'backup-a');
  const backupB = result.players.find((player) => player.id === 'backup-b');

  // 34 out minutes * 70% = 23.8 redistributed.
  // Weights are current minutes 18 and 12, so Backup A gets 23.8 * 18/30 = 14.28.
  // Backup B gets 23.8 * 12/30 = 9.52.
  if (backupA?.minutes_projection !== 32.28) {
    throw new Error(`Expected Backup A at 32.28 minutes, got ${backupA?.minutes_projection}`);
  }
  if (backupB?.minutes_projection !== 21.52) {
    throw new Error(`Expected Backup B at 21.52 minutes, got ${backupB?.minutes_projection}`);
  }
  if (result.cascadeBoostCount !== 2) {
    throw new Error(`Expected 2 boosted players, got ${result.cascadeBoostCount}`);
  }
});
