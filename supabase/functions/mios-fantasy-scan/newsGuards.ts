const NEWS_ALIAS_MAP: Record<string, string[]> = {
  lebronjames: ['lebron'],
  nikolajokic: ['jokic', 'joker'],
  shaigilgeousalexander: ['shai', 'sga'],
};

export function normalizeNewsName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export interface NewsGuardItem {
  raw: string;
  timestamp?: number;
}

export function mostRecentMatchingNews(playerName: string, team: string, newsItems: NewsGuardItem[], now = Date.now()): NewsGuardItem | null {
  const playerKey = normalizeNewsName(playerName);
  const lastNameKey = normalizeNewsName(playerName.split(/\s+/).at(-1) ?? '');
  const teamKey = normalizeNewsName(team);
  const aliases = NEWS_ALIAS_MAP[playerKey] ?? [];
  const cutoff = now - 48 * 60 * 60 * 1000;
  const matched = newsItems
    .filter((item) => !item.timestamp || item.timestamp >= cutoff)
    .filter((item) => {
      const rawKey = normalizeNewsName(item.raw);
      return rawKey.includes(playerKey)
        || aliases.some((alias) => rawKey.includes(normalizeNewsName(alias)))
        || (lastNameKey && teamKey && rawKey.includes(lastNameKey) && rawKey.includes(teamKey));
    })
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  return matched[0] ?? null;
}
