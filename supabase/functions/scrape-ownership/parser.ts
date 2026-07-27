export interface OwnershipProjection {
  player_name: string;
  ownership_pct: number;
  cpt_ownership_pct?: number;
  flex_ownership_pct?: number;
}

function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeHeader(value: string): string {
  return stripHtml(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function cleanPlayerName(value: string): string {
  return stripHtml(value)
    .replace(/^image\s+/i, '')
    .replace(/\s+[QOD]\s*$/i, '')
    .replace(/\s+OUT\s*$/i, '')
    .replace(/\s+DTD\s*$/i, '')
    .replace(/\s+•\s*\([LR]\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseOwnershipToken(value: string): number | undefined {
  const text = stripHtml(value).replace(/,/g, '');
  if (/^--?$/.test(text) || !text) return undefined;
  const match = text.match(/(-?\d+(?:\.\d+)?)\s*%?/);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  const normalized = parsed <= 1 && !/%/.test(text) ? parsed * 100 : parsed;
  return normalized <= 100 ? normalized : undefined;
}

function mergeRows(rows: OwnershipProjection[]): OwnershipProjection[] {
  const byName = new Map<string, OwnershipProjection>();
  for (const row of rows) {
    const name = cleanPlayerName(row.player_name);
    if (!name || !Number.isFinite(row.ownership_pct)) continue;
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!key || byName.has(key)) continue;
    byName.set(key, {
      player_name: name,
      ownership_pct: row.ownership_pct,
      cpt_ownership_pct: row.cpt_ownership_pct,
      flex_ownership_pct: row.flex_ownership_pct,
    });
  }
  return [...byName.values()];
}

function parseMarkdownTables(text: string): OwnershipProjection[] {
  const rows: OwnershipProjection[] = [];
  const lines = text.split(/\r?\n/).filter((line) => line.includes('|'));

  for (let index = 0; index < lines.length; index += 1) {
    const cells = lines[index].split('|').map((cell) => cell.trim()).filter(Boolean);
    const headers = cells.map(normalizeHeader);
    const playerIndex = headers.findIndex((header) => header === 'player' || header === 'playername' || header === 'name');
    const ownershipIndex = headers.findIndex((header) => /^(proj)?(own|ownership)(pct|percent|percentage)?$/.test(header));
    const cptIndex = headers.findIndex((header) => /^(cpt|captain)(own|ownership)?(pct|percent|percentage)?$/.test(header));
    const flexIndex = headers.findIndex((header) => /^(flex)(own|ownership)?(pct|percent|percentage)?$/.test(header));
    if (playerIndex < 0 || (ownershipIndex < 0 && cptIndex < 0 && flexIndex < 0)) continue;

    for (let rowIndex = index + 1; rowIndex < lines.length; rowIndex += 1) {
      const rowCells = lines[rowIndex].split('|').map((cell) => cell.trim()).filter(Boolean);
      if (rowCells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue;
      if (rowCells.length <= Math.max(playerIndex, ownershipIndex, cptIndex, flexIndex)) break;
      const cptOwnership = cptIndex >= 0 ? parseOwnershipToken(rowCells[cptIndex]) : undefined;
      const flexOwnership = flexIndex >= 0 ? parseOwnershipToken(rowCells[flexIndex]) : undefined;
      const ownership = ownershipIndex >= 0 ? parseOwnershipToken(rowCells[ownershipIndex]) : cptOwnership ?? flexOwnership;
      const playerName = cleanPlayerName(rowCells[playerIndex]);
      if (ownership !== undefined && playerName) rows.push({ player_name: playerName, ownership_pct: ownership, cpt_ownership_pct: cptOwnership, flex_ownership_pct: flexOwnership });
    }
  }

  return rows;
}

function parseHtmlTables(text: string): OwnershipProjection[] {
  const rows: OwnershipProjection[] = [];
  const tableMatches = text.matchAll(/<table[\s\S]*?<\/table>/gi);

  for (const tableMatch of tableMatches) {
    const rowMatches = [...tableMatch[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)]
      .map((match) => [...match[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => stripHtml(cell[1])));
    const headerIndex = rowMatches.findIndex((cells) => {
      const headers = cells.map(normalizeHeader);
      return headers.some((header) => header === 'player' || header === 'playername' || header === 'name')
        && headers.some((header) => /^(proj)?(own|ownership)(pct|percent|percentage)?$/.test(header) || /^(cpt|captain)(own|ownership)?(pct|percent|percentage)?$/.test(header) || /^(flex)(own|ownership)?(pct|percent|percentage)?$/.test(header));
    });
    if (headerIndex < 0) continue;

    const headers = rowMatches[headerIndex].map(normalizeHeader);
    const playerIndex = headers.findIndex((header) => header === 'player' || header === 'playername' || header === 'name');
    const ownershipIndex = headers.findIndex((header) => /^(proj)?(own|ownership)(pct|percent|percentage)?$/.test(header));
    const cptIndex = headers.findIndex((header) => /^(cpt|captain)(own|ownership)?(pct|percent|percentage)?$/.test(header));
    const flexIndex = headers.findIndex((header) => /^(flex)(own|ownership)?(pct|percent|percentage)?$/.test(header));
    for (const cells of rowMatches.slice(headerIndex + 1)) {
      if (cells.length <= Math.max(playerIndex, ownershipIndex, cptIndex, flexIndex)) continue;
      const cptOwnership = cptIndex >= 0 ? parseOwnershipToken(cells[cptIndex]) : undefined;
      const flexOwnership = flexIndex >= 0 ? parseOwnershipToken(cells[flexIndex]) : undefined;
      const ownership = ownershipIndex >= 0 ? parseOwnershipToken(cells[ownershipIndex]) : cptOwnership ?? flexOwnership;
      const playerName = cleanPlayerName(cells[playerIndex]);
      if (ownership !== undefined && playerName) rows.push({ player_name: playerName, ownership_pct: ownership, cpt_ownership_pct: cptOwnership, flex_ownership_pct: flexOwnership });
    }
  }

  return rows;
}

function parseArticlePercentages(text: string): OwnershipProjection[] {
  const rows: OwnershipProjection[] = [];
  const plain = stripHtml(text).replace(/\s+/g, ' ');
  const pattern = /\b([A-Z][A-Za-z'.-]+(?:\s+(?:[A-Z][A-Za-z'.-]+|Jr\.|Sr\.|III|II)){1,3})\s*(?:[:\-–]|\bat\b|\bownership\b)\s*(\d{1,2}(?:\.\d+)?)\s*%/g;

  for (const match of plain.matchAll(pattern)) {
    const ownership = parseOwnershipToken(`${match[2]}%`);
    const playerName = cleanPlayerName(match[1]);
    if (ownership !== undefined && playerName) rows.push({ player_name: playerName, ownership_pct: ownership });
  }

  return rows;
}

export function parseOwnershipRows(content: string): OwnershipProjection[] {
  return mergeRows([
    ...parseMarkdownTables(content),
    ...parseHtmlTables(content),
    ...parseArticlePercentages(content),
  ]);
}
