export interface AntiCorrelationPlayer {
  name: string;
  team: string;
  position: string;
  opponent_team?: string;
  opposing_probable_pitcher_name?: string;
}

export interface AntiCorrelationLineup {
  players: AntiCorrelationPlayer[];
}

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function normalizeTeam(value: unknown): string {
  return String(value ?? '').toUpperCase();
}

function isPitcher(player: AntiCorrelationPlayer): boolean {
  return /^(P|SP|RP)$/.test(String(player.position ?? '').toUpperCase());
}

function isQuarterback(player: AntiCorrelationPlayer): boolean {
  return String(player.position ?? '').toUpperCase() === 'QB';
}

function isDefense(player: AntiCorrelationPlayer): boolean {
  return ['DST', 'DEF'].includes(String(player.position ?? '').toUpperCase());
}

function hitters(lineup: AntiCorrelationLineup): AntiCorrelationPlayer[] {
  return lineup.players.filter((player) => !isPitcher(player));
}

export function detectAntiCorrelation(lineup: AntiCorrelationLineup, sport = ''): string[] {
  const flags: string[] = [];
  if (sport === 'mlb') {
    for (const pitcher of lineup.players.filter(isPitcher)) {
      const pitcherNameKey = normalizeName(pitcher.name);
      const pitcherTeam = normalizeTeam(pitcher.team);
      const opponentTeam = normalizeTeam(pitcher.opponent_team);
      const opposingHitters = hitters(lineup).filter((hitter) => {
        const hitterTeam = normalizeTeam(hitter.team);
        if (hitterTeam === pitcherTeam) return false;
        if (opponentTeam && hitterTeam === opponentTeam) return true;
        return normalizeName(hitter.opposing_probable_pitcher_name ?? '') === pitcherNameKey;
      });
      if (opposingHitters.length) {
        flags.push(`${opposingHitters.length} hitter${opposingHitters.length === 1 ? '' : 's'} facing ${pitcher.name}`);
      }
    }
    // Same-team hitters with their own pitcher are not flagged: MLB positive team
    // scoring does not directly reduce own pitcher points the way opposing hits/runs do.
    return flags;
  }

  if (sport === 'nfl') {
    const defenses = lineup.players.filter(isDefense);
    for (const qb of lineup.players.filter(isQuarterback)) {
      const qbOpponent = normalizeTeam(qb.opponent_team);
      const opposingDst = defenses.find((dst) => normalizeTeam(dst.team) === qbOpponent || normalizeTeam(dst.opponent_team) === normalizeTeam(qb.team));
      if (opposingDst) flags.push(`${qb.name} against opposing DST ${opposingDst.name}`);
    }
  }

  return flags;
}
