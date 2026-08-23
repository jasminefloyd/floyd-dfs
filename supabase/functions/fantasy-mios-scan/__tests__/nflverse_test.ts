import { parseNflverseWeeklyStats } from '../nflverse.ts';

const csv = [
  'player_display_name,recent_team,season,week,game_date,opponent_team,passing_yards,passing_tds,rushing_yards,rushing_tds,receiving_yards,receptions,receiving_tds,targets',
  'Test Player,CHI,2025,1,2025-09-07,GB,250,2,10,0,0,0,0,0',
  'Test Player,CHI,2025,2,2025-09-14,DET,200,1,20,1,0,0,0,0',
  'Test Player,CHI,2025,3,2025-09-21,MIN,300,3,0,0,0,0,0,0',
].join('\n');

Deno.test('nflverse parser normalizes weekly stats and calculates DraftKings points', () => {
  const result = parseNflverseWeeklyStats(csv, { name: 'Test Player', team: 'CHI', position: 'QB' }, '2025-09-22T00:00:00.000Z');
  if (!result) throw new Error('expected a matched player');
  if (result.games_data.length !== 3) throw new Error(`expected 3 games, got ${result.games_data.length}`);
  if (result.games_data[0].date !== '2025-09-21') throw new Error('expected newest game first');
  if (result.games_data[0].fantasy_points !== 27) throw new Error(`unexpected DK score: ${result.games_data[0].fantasy_points}`);
  if (result.aggregated_stats.games_sample_size !== 3) throw new Error('expected aggregate sample size');
  if (result.source !== 'nflverse_player_stats') throw new Error('expected nflverse provenance');
});

Deno.test('nflverse parser does not cross-match a player to another team', () => {
  const result = parseNflverseWeeklyStats(csv, { name: 'Test Player', team: 'DET', position: 'QB' });
  if (result !== null) throw new Error('expected team mismatch to return no stats');
});
