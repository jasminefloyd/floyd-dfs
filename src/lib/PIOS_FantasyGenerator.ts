export interface LineupPlayerDraft {
  name: string;
  team: string;
  position: string;
  salary: number;
  player_id: string;
  confidence_score: number;
  last_5_avg_pts: number;
  injury_status: string;
  projected_points?: number;
}

export interface DraftLineup {
  players: LineupPlayerDraft[];
  projected_points: number;
  salary_used: number;
  confidence_score: number;
  constraint_violations: string[];
}

interface RosterSlot {
  slot: string;
  eligible: string[];
}

// Verified against DraftKings' documented Classic roster construction (2026-07-14):
// - NBA/WNBA: 8 spots (PG, SG, SF, PF, C, G, F, UTIL)
// - NFL: 9 spots (QB, 2xRB, 3xWR, TE, FLEX, DST)
// - MLB: 10 spots (2xP, C, 1B, 2B, 3B, SS, 3xOF)
// F1's roster rules were not verified this session; kept as a simplified 6-driver
// placeholder consistent with the original stub's intent.
const ROSTER_SLOTS: Record<string, RosterSlot[]> = {
  nba: [
    { slot: 'PG', eligible: ['PG'] },
    { slot: 'SG', eligible: ['SG'] },
    { slot: 'SF', eligible: ['SF'] },
    { slot: 'PF', eligible: ['PF'] },
    { slot: 'C', eligible: ['C'] },
    { slot: 'G', eligible: ['PG', 'SG'] },
    { slot: 'F', eligible: ['SF', 'PF'] },
    { slot: 'UTIL', eligible: ['PG', 'SG', 'SF', 'PF', 'C'] }
  ],
  wnba: [
    { slot: 'PG', eligible: ['PG'] },
    { slot: 'SG', eligible: ['SG'] },
    { slot: 'SF', eligible: ['SF'] },
    { slot: 'PF', eligible: ['PF'] },
    { slot: 'C', eligible: ['C'] },
    { slot: 'G', eligible: ['PG', 'SG'] },
    { slot: 'F', eligible: ['SF', 'PF'] },
    { slot: 'UTIL', eligible: ['PG', 'SG', 'SF', 'PF', 'C'] }
  ],
  nfl: [
    { slot: 'QB', eligible: ['QB'] },
    { slot: 'RB1', eligible: ['RB'] },
    { slot: 'RB2', eligible: ['RB'] },
    { slot: 'WR1', eligible: ['WR'] },
    { slot: 'WR2', eligible: ['WR'] },
    { slot: 'WR3', eligible: ['WR'] },
    { slot: 'TE', eligible: ['TE'] },
    { slot: 'FLEX', eligible: ['RB', 'WR', 'TE'] },
    { slot: 'DST', eligible: ['DST', 'DEF'] }
  ],
  mlb: [
    { slot: 'P1', eligible: ['P', 'SP', 'RP'] },
    { slot: 'P2', eligible: ['P', 'SP', 'RP'] },
    { slot: 'C', eligible: ['C'] },
    { slot: '1B', eligible: ['1B'] },
    { slot: '2B', eligible: ['2B'] },
    { slot: '3B', eligible: ['3B'] },
    { slot: 'SS', eligible: ['SS'] },
    { slot: 'OF1', eligible: ['OF'] },
    { slot: 'OF2', eligible: ['OF'] },
    { slot: 'OF3', eligible: ['OF'] }
  ],
  f1: [
    { slot: 'D1', eligible: ['DRIVER'] },
    { slot: 'D2', eligible: ['DRIVER'] },
    { slot: 'D3', eligible: ['DRIVER'] },
    { slot: 'D4', eligible: ['DRIVER'] },
    { slot: 'D5', eligible: ['DRIVER'] },
    { slot: 'D6', eligible: ['DRIVER'] }
  ]
};

export function generateLineups(
  roster: LineupPlayerDraft[],
  sport: string,
  contestType: string,
  excludedPlayers: string[],
  riskTolerance: string
): DraftLineup[] {
  const excludedLower = excludedPlayers.map((p) => p.toLowerCase());

  // Filter roster: remove injured, remove excluded
  const eligiblePlayers = roster.filter(
    (p) => p.injury_status !== 'out' && !excludedLower.includes(p.name?.toLowerCase())
  );

  // Sort by recent production (used as a proxy for confidence when picking within a slot)
  const sortedPlayers = [...eligiblePlayers].sort(
    (a, b) => (b.last_5_avg_pts || 0) - (a.last_5_avg_pts || 0)
  );

  // Generate candidate lineups
  const candidates: DraftLineup[] =
    contestType === 'showdown'
      ? generateShowdownLineups(sortedPlayers, sport)
      : generateClassicLineups(sortedPlayers, sport);

  // Score and rank by confidence
  const rankedLineups = candidates
    .map((lineup) => ({
      ...lineup,
      confidence_score: calculateLineupConfidence(lineup)
    }))
    .sort((a, b) => b.confidence_score - a.confidence_score)
    .slice(0, 5); // Top 5

  // Apply risk tolerance filter
  if (riskTolerance === 'conservative') {
    return rankedLineups.filter((lu) => lu.confidence_score > 0.75);
  } else if (riskTolerance === 'aggressive') {
    return rankedLineups; // Keep all
  } else {
    return rankedLineups.slice(0, 3); // Balanced: top 3
  }
}

function generateShowdownLineups(players: LineupPlayerDraft[], _sport: string): DraftLineup[] {
  const lineups: DraftLineup[] = [];
  const salaryCapShowdown = 50000;

  // Try different captain selections
  const topCaptains = players.slice(0, 5);

  for (const captain of topCaptains) {
    const captainWithMultiplier: LineupPlayerDraft = {
      ...captain,
      salary: Math.floor(captain.salary * 1.5),
      projected_points: (captain.last_5_avg_pts || 0) * 1.5
    };

    const remainingSalary = salaryCapShowdown - captainWithMultiplier.salary;
    const fieldPlayers = players
      .filter((p) => p.player_id !== captain.player_id)
      .filter((p) => p.salary <= remainingSalary)
      .sort((a, b) => (b.last_5_avg_pts || 0) - (a.last_5_avg_pts || 0))
      .slice(0, 5);

    if (fieldPlayers.length === 5) {
      const lineup: DraftLineup = {
        players: [captainWithMultiplier, ...fieldPlayers],
        projected_points: calculateProjectedPoints([captainWithMultiplier, ...fieldPlayers]),
        salary_used:
          captainWithMultiplier.salary + fieldPlayers.reduce((sum, p) => sum + p.salary, 0),
        confidence_score: 0, // Will be calculated later
        constraint_violations: []
      };

      if (lineup.salary_used <= salaryCapShowdown) {
        lineups.push(lineup);
      }
    }
  }

  return lineups;
}

function generateClassicLineups(players: LineupPlayerDraft[], sport: string): DraftLineup[] {
  const slots = ROSTER_SLOTS[sport];
  if (!slots) return [];

  const salaryCap = 50000;
  const lineups: DraftLineup[] = [];
  const excludeIds = new Set<string>();

  // Build up to 3 distinct lineups (no player reused across variants)
  for (let i = 0; i < 3; i++) {
    const lineup = buildClassicLineup(players, slots, salaryCap, excludeIds);
    if (!lineup) break;
    lineups.push(lineup);
    lineup.players.forEach((p) => excludeIds.add(p.player_id));
  }

  return lineups;
}

function buildClassicLineup(
  players: LineupPlayerDraft[],
  slots: RosterSlot[],
  salaryCap: number,
  excludeIds: Set<string>
): DraftLineup | null {
  const selected: LineupPlayerDraft[] = [];
  const usedIds = new Set<string>();
  let totalSalary = 0;

  for (const slotDef of slots) {
    const candidate = players
      .filter((p) => !excludeIds.has(p.player_id) && !usedIds.has(p.player_id))
      .filter((p) => slotDef.eligible.includes(p.position))
      .filter((p) => totalSalary + p.salary <= salaryCap)
      .sort((a, b) => (b.last_5_avg_pts || 0) - (a.last_5_avg_pts || 0))[0];

    if (!candidate) return null; // Can't fill this slot within cap

    selected.push(candidate);
    usedIds.add(candidate.player_id);
    totalSalary += candidate.salary;
  }

  return {
    players: selected,
    projected_points: calculateProjectedPoints(selected),
    salary_used: totalSalary,
    confidence_score: 0, // Calculated later
    constraint_violations: []
  };
}

function calculateProjectedPoints(players: LineupPlayerDraft[]): number {
  // Sum of player average fantasy points
  return players.reduce((sum, p) => sum + (p.last_5_avg_pts || p.projected_points || 0), 0);
}

function calculateLineupConfidence(lineup: DraftLineup): number {
  // Average of player confidence scores
  const avgConfidence =
    lineup.players.reduce((sum, p) => sum + (p.confidence_score || 0.5), 0) /
    lineup.players.length;

  // Boost if salary near cap (efficient use)
  const salaryEfficiency = lineup.salary_used / 50000;
  const efficiencyBoost = Math.min(salaryEfficiency * 0.1, 0.1);

  // Penalize if injury concerns
  const injuryCount = lineup.players.filter((p) => p.injury_status !== 'active').length;
  const injuryPenalty = injuryCount * 0.05;

  return Math.min(Math.max(avgConfidence + efficiencyBoost - injuryPenalty, 0), 1);
}
