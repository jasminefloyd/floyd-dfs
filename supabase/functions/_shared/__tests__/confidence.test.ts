import { calculateLineupConfidence } from '../confidence.ts';

Deno.test('lineup confidence is independent of salary utilization', () => {
  const players = [
    { confidence_score: 0.8, injury_status: 'active' },
    { confidence_score: 0.6, injury_status: 'active' },
  ];
  if (calculateLineupConfidence(players) !== 0.7) throw new Error('confidence should average player confidence scores');
});

Deno.test('lineup confidence applies injury penalty without salary boost', () => {
  const players = [
    { confidence_score: 0.8, injury_status: 'questionable' },
    { confidence_score: 0.6, injury_status: 'active' },
  ];
  if (calculateLineupConfidence(players) !== 0.65) throw new Error('questionable player should reduce confidence by 0.05');
});
