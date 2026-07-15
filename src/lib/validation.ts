const SPORTS = new Set(['nba', 'wnba', 'nfl', 'mlb', 'f1']);
const CONTEST_TYPES = new Set(['showdown', 'classic']);
const RISK_TOLERANCES = new Set(['conservative', 'balanced', 'aggressive']);

export interface ScanValidationInput {
  sport: string;
  contestType: string;
  contestDate: string;
  riskTolerance: string;
}

export function normalizePlayerName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s.'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseExcludedPlayers(value: string): string[] {
  return value
    .split(',')
    .map(normalizePlayerName)
    .filter(Boolean);
}

export function validateScanInput(input: ScanValidationInput): string[] {
  const errors: string[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const selectedDate = new Date(`${input.contestDate}T00:00:00`);

  if (!SPORTS.has(input.sport)) errors.push('Choose a supported sport.');
  if (!CONTEST_TYPES.has(input.contestType)) errors.push('Choose a supported contest type.');
  if (!input.contestDate || Number.isNaN(selectedDate.getTime())) errors.push('Choose a valid contest date.');
  if (selectedDate < today) errors.push('Contest date must be today or later.');
  if (!RISK_TOLERANCES.has(input.riskTolerance)) errors.push('Choose a valid risk tolerance.');

  return errors;
}
