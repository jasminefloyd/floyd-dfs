export function parseNumber(value: unknown): number {
  const parsed = Number(String(value ?? '').split('-')[0]);
  return Number.isFinite(parsed) ? parsed : 0;
}

// ESPN reuses short column headers (YDS, TD, REC, ...) across unrelated stat groups
// (passing/rushing/receiving all use "TD"; receiving's "REC" collides with fumbles'
// "REC"), so the group name must disambiguate before falling back to the generic map.
const NFL_GROUP_SCOPED_LABELS: Record<string, Record<string, string>> = {
  passing: { yds: 'passingYards', td: 'passingTouchdowns', int: 'interceptions' },
  rushing: { yds: 'rushingYards', td: 'rushingTouchdowns' },
  receiving: { rec: 'receptions', yds: 'receivingYards', td: 'receivingTouchdowns' },
  fumbles: { fum: 'fumbles', lost: 'fumblesLost', rec: 'fumblesRecovered' },
  kickreturns: { td: 'kickReturnTouchdowns' },
  puntreturns: { td: 'puntReturnTouchdowns' },
};

export function statKeyFromLabel(label: string, groupName = ''): string {
  const key = label.toLowerCase().replace(/[^a-z0-9]/g, '');
  const groupKey = groupName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const scoped = NFL_GROUP_SCOPED_LABELS[groupKey]?.[key];
  if (scoped) return scoped;
  const map: Record<string, string> = {
    min: 'minutes',
    minutes: 'minutes',
    pts: 'points',
    points: 'points',
    reb: 'totalRebounds',
    rebounds: 'totalRebounds',
    ast: 'assists',
    assists: 'assists',
    stl: 'steals',
    steals: 'steals',
    blk: 'blocks',
    blocks: 'blocks',
    to: 'turnovers',
    tov: 'turnovers',
    turnovers: 'turnovers',
    '3pt': 'threePointFieldGoalsMade',
    fg3m: 'threePointFieldGoalsMade',
    passyds: 'passingYards',
    passingyards: 'passingYards',
    passtd: 'passingTouchdowns',
    passingtd: 'passingTouchdowns',
    int: 'interceptions',
    interceptions: 'interceptions',
    rushyds: 'rushingYards',
    rushingyards: 'rushingYards',
    rushtd: 'rushingTouchdowns',
    rushingtd: 'rushingTouchdowns',
    rec: 'receptions',
    receptions: 'receptions',
    receiving: 'receptions',
    recyds: 'receivingYards',
    receivingyards: 'receivingYards',
    rectd: 'receivingTouchdowns',
    receivingtd: 'receivingTouchdowns',
    fumlost: 'fumblesLost',
    fumbleslost: 'fumblesLost',
  };
  return map[key] ?? key;
}

export function parseEspnAthleteStats(athlete: any, labels: string[], groupName = ''): Record<string, number> {
  const stats = Array.isArray(athlete?.stats) ? athlete.stats : [];
  const statLine: Record<string, number> = {};
  labels.forEach((label, index) => {
    statLine[statKeyFromLabel(label, groupName)] = parseNumber(stats[index]);
  });
  return statLine;
}
