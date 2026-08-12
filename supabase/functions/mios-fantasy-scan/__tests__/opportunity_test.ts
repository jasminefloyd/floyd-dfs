import { computeOpportunityProjection, minutesAverage, positionMeanPpm, redistributeMinutes, type OpportunityPlayer } from '../opportunity.ts';

Deno.test('WNBA opportunity priors are sport-specific rather than an NBA scale factor', () => {
  if (positionMeanPpm('PG', 'wnba') !== 0.91) throw new Error('Expected the WNBA PG prior to be used');
  if (positionMeanPpm('PG', 'nba') !== 1.05) throw new Error('Expected the NBA PG prior to remain unchanged');
});

Deno.test('WNBA minutes use recency weighting while NBA retains the simple average', () => {
  const player: OpportunityPlayer = {
    id: 'recent-rotation-change',
    name: 'Recent Rotation Change',
    team: 'NYL',
    position: 'PG',
    injury_status: 'active',
    last_5_stats: {
      avg_fantasy_pts: 20,
      minutes_avg: 20,
      games: [{ minutes: 34 }, { minutes: 30 }, { minutes: 24 }, { minutes: 18 }, { minutes: 12 }],
    },
  };
  const wnbaMinutes = minutesAverage(player, 'wnba');
  const nbaMinutes = minutesAverage(player, 'nba');
  if (wnbaMinutes !== 28) throw new Error(`Expected recency-weighted WNBA minutes of 28, got ${wnbaMinutes}`);
  if (nbaMinutes !== 20) throw new Error(`Expected NBA to retain direct aggregate minutes of 20, got ${nbaMinutes}`);
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

Deno.test('WNBA opportunity projection does not blend the same last-five sample twice', () => {
  const result = computeOpportunityProjection([{
    id: 'wnba-role-player',
    name: 'WNBA Role Player',
    team: 'NYL',
    position: 'PG',
    injury_status: 'active',
    projected_points: 30,
    projection_source: 'last_5',
    last_5_stats: {
      avg_fantasy_pts: 30,
      games: Array.from({ length: 5 }, () => ({ minutes: 30, fantasy_points: 30 })),
    },
  }], 'wnba');
  const player = result.players[0];
  if (player.projected_points !== 28.31) {
    throw new Error(`Expected direct minutes-rate projection of 28.31, got ${player.projected_points}`);
  }
  if (player.minutes_distribution?.p50 !== 30 || player.minutes_distribution.p10 === null || player.minutes_distribution.p90 === null) {
    throw new Error(`Expected shadow minutes distribution centered at 30, got ${JSON.stringify(player.minutes_distribution)}`);
  }
  if (player.minutes_distribution.didNotPlayProbability !== 0) {
    throw new Error(`Expected zero DNP probability for five played games, got ${player.minutes_distribution.didNotPlayProbability}`);
  }
});

Deno.test('WNBA replacement logic prefers settled replacement-minute priors over a fixed share', () => {
  const result = redistributeMinutes([
    { id: 'out', name: 'Out starter', team: 'NYL', position: 'PG', injury_status: 'out', minutes_projection: 30 },
    { id: 'replacement', name: 'Replacement', team: 'NYL', position: 'PG', injury_status: 'active', minutes_projection: 20, confirmed_starter: true,
      wnba_role_prior: { sampleSize: 12, historicalMinutes: 24, historicalMinutesStddev: 3, replacementMinutesGain: 12, didNotPlayProbability: 0, cohort: 'elevated' } },
  ], 'wnba');
  const replacement = result.players.find((player) => player.id === 'replacement');
  if (!replacement || replacement.minutes_projection <= 30 || !replacement.role_counterfactual?.some((note) => note.includes('Out starter out'))) {
    throw new Error(`Expected an evidence-traceable WNBA replacement adjustment, got ${JSON.stringify(replacement)}`);
  }
});
