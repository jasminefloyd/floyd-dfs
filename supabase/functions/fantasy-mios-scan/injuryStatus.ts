export type InjuryStatus = 'out' | 'doubtful' | 'questionable' | 'probable' | 'day_to_day' | 'active';

const INJURY_CONTEXT_PATTERN = /\b(injur\w*|ankle|knee|hamstring|illness|soreness|surgery|concussion|il|ir)\b/i;
const EXPLICIT_OUT_PATTERN = /\b(ruled\s+out|out\s+indefinitely|will\s+not\s+play|inactive|injured\s+reserve|placed\s+on\s+(?:the\s+)?(?:il|ir))\b/i;
const BARE_OUT_PATTERN = /\bout\b/i;
const SHORT_OUT_STATUS_PATTERN = /^\s*(?:o|out)(?:\s*\([^)]*\))?\s*$/i;

export const NEWS_INJURY_PREFILTER_PATTERN = /\b(out|injured|injury|questionable|doubtful|probable|day-to-day|inactive|ruled)\b/i;

export function normalizeInjuryStatus(raw: unknown): InjuryStatus {
  const text = String(raw ?? '').trim();
  if (!text) return 'active';

  if (
    EXPLICIT_OUT_PATTERN.test(text)
    || SHORT_OUT_STATUS_PATTERN.test(text)
    || /^\s*(?:ir|il)\s*$/i.test(text)
    || (BARE_OUT_PATTERN.test(text) && INJURY_CONTEXT_PATTERN.test(text))
  ) {
    return 'out';
  }

  if (/\b(doubtful|unlikely\s+to\s+play)\b/i.test(text)) return 'doubtful';
  if (/\b(questionable|game[-\s]?time\s+decision|uncertain)\b/i.test(text)) return 'questionable';
  if (/\b(probable|expected\s+to\s+play|available)\b/i.test(text)) return 'probable';
  if (/\b(day[-\s]?to[-\s]?day|dtd|limited)\b/i.test(text)) return 'day_to_day';
  return 'active';
}

export function injuryContextNear(text: string, playerKey: string): boolean {
  if (!playerKey) return false;

  const normalizedText = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const playerPattern = new RegExp([...playerKey.toLowerCase()].map(escapeRegExp).join('[^a-z0-9]*'), 'g');
  let match = playerPattern.exec(normalizedText);

  while (match) {
    const start = Math.max(0, match.index - 120);
    const end = Math.min(normalizedText.length, match.index + match[0].length + 120);
    const nearbyText = normalizedText.slice(start, end);
    if (INJURY_CONTEXT_PATTERN.test(nearbyText) || NEWS_INJURY_PREFILTER_PATTERN.test(nearbyText)) return true;
    match = playerPattern.exec(normalizedText);
  }

  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
