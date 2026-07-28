export type LineupSport = 'nba' | 'wnba' | 'mlb' | 'nfl';
export type LineupStatus = 'confirmed' | 'expected';
export type InjuryTag = 'OUT' | 'GTD' | 'QUES' | null;

export interface ConfirmedLineupRow {
  sport: LineupSport;
  game_date: string;
  team: string;
  player_name: string;
  batting_order: number | null;
  lineup_status: LineupStatus;
  injury_tag: InjuryTag;
  is_starting_pitcher: boolean;
}

const INJURY_PATTERN = /\b(OUT|GTD|QUES|Q)\b/i;

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripTags(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function attrValue(html: string, attr: string): string {
  const match = html.match(new RegExp(`\\b${attr}=["']([^"']+)["']`, 'i'));
  return decodeHtml(match?.[1] ?? '').trim();
}

function statusFromText(value: string): LineupStatus {
  return /\bconfirmed\b/i.test(value) ? 'confirmed' : 'expected';
}

function normalizeInjuryTag(value: string): InjuryTag {
  const match = value.match(INJURY_PATTERN);
  if (!match) return null;
  const tag = match[1].toUpperCase();
  if (tag === 'Q') return 'QUES';
  if (tag === 'OUT' || tag === 'GTD' || tag === 'QUES') return tag;
  return null;
}

function playerNameFromBlock(block: string): string {
  const explicit = attrValue(block, 'data-player') || attrValue(block, 'data-name');
  if (explicit) return explicit;
  const anchor = block.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i);
  if (anchor) return stripTags(anchor[1]);
  return stripTags(block)
    .replace(/^\d+\s*[.)\s-]\s*/, '')
    .replace(/\b(OUT|GTD|QUES|Q|Confirmed|Expected|SP|P)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function battingOrderFromBlock(block: string, _index: number, sport: LineupSport): number | null {
  if (sport !== 'mlb') return null;
  const attr = Number(attrValue(block, 'data-batting-order') || attrValue(block, 'data-order'));
  if (Number.isFinite(attr) && attr > 0) return attr;
  const match = stripTags(block).match(/^\s*(\d+)\s*[.)\s-]/);
  return match ? Number(match[1]) : null;
}

function isStartingPitcherBlock(block: string, sport: LineupSport): boolean {
  if (sport !== 'mlb') return false;
  const text = stripTags(block);
  return /\b(starting-pitcher|lineup__pitcher|probable-pitcher|pitcher)\b/i.test(block)
    || /\bSP\b/i.test(text);
}

function splitTeamBlocks(html: string): string[] {
  const dataTeamBlocks = [...html.matchAll(/<([a-z0-9]+)\b[^>]*\bdata-team=["'][^"']+["'][^>]*>[\s\S]*?<\/\1>/gi)]
    .map((match) => match[0]);
  if (dataTeamBlocks.length) return dataTeamBlocks;

  return [...html.matchAll(/<([a-z0-9]+)\b[^>]*class=["'][^"']*(?:lineup-card|lineup__team|lineup__list)[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi)]
    .map((match) => match[0]);
}

function teamFromBlock(block: string): string {
  const dataTeam = attrValue(block, 'data-team');
  if (dataTeam) return dataTeam.toUpperCase();
  const classMatch = block.match(/class=["'][^"']*(?:lineup__abbr|lineup__team-abbr|team-abbr|lineup-card__team)[^"']*["'][^>]*>([\s\S]*?)<\/[a-z0-9]+>/i);
  return stripTags(classMatch?.[1] ?? '').toUpperCase();
}

function playerBlocks(teamBlock: string): string[] {
  const dataPlayers = [...teamBlock.matchAll(/<([a-z0-9]+)\b[^>]*\bdata-player=["'][^"']+["'][^>]*>[\s\S]*?<\/\1>/gi)]
    .map((match) => match[0]);
  const listItems = [...teamBlock.matchAll(/<li\b[^>]*>[\s\S]*?<\/li>/gi)].map((match) => match[0]);
  const classPlayers = [...teamBlock.matchAll(/<([a-z0-9]+)\b[^>]*class=["'][^"']*(?:lineup__player|lineup__batter|lineup-player|player-name)[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi)]
    .map((match) => match[0]);
  return dataPlayers.length ? dataPlayers : listItems.length ? listItems : classPlayers;
}

export function parseRotowireLineups(html: string, sport: LineupSport, gameDate: string): ConfirmedLineupRow[] {
  const rows = splitTeamBlocks(html).flatMap((teamBlock) => {
    const team = teamFromBlock(teamBlock);
    if (!team) return [];
    const lineupStatus = statusFromText(attrValue(teamBlock, 'data-lineup-status') || stripTags(teamBlock));
    return playerBlocks(teamBlock).flatMap((block, index) => {
      const playerName = playerNameFromBlock(block);
      if (!playerName) return [];
      return [{
        sport,
        game_date: gameDate,
        team,
        player_name: playerName,
        batting_order: battingOrderFromBlock(block, index, sport),
        lineup_status: statusFromText(stripTags(block)) === 'confirmed' ? 'confirmed' : lineupStatus,
        injury_tag: normalizeInjuryTag(stripTags(block)),
        is_starting_pitcher: isStartingPitcherBlock(block, sport),
      }];
    });
  });

  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.sport}:${row.game_date}:${row.team}:${row.player_name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
