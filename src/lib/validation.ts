const SPORTS = new Set(['nba', 'wnba', 'nfl', 'mlb']);
const CONTEST_TYPES = new Set(['showdown', 'classic']);
const RISK_TOLERANCES = new Set(['conservative', 'balanced', 'aggressive']);
const LINEUP_MODES = new Set(['max_fpts', 'balanced_ev', 'tournament', 'safe']);

export interface ScanValidationInput {
  sport: string;
  contestType: string;
  contestDate: string;
  contestStartTime?: string | null;
  riskTolerance: string;
  lineupMode?: string;
  entryCount?: number;
  fieldSize?: number;
  maxEntriesPerUser?: number;
  payoutShape?: string;
  maxCaptainExposure?: number;
  lockedPlayers?: string[];
  excludedPlayers?: string[];
  captainPool?: string[];
  minPerTeam?: number;
  rosterSize?: number;
  minSalaryUsed?: number;
  lockedSalaryTotal?: number;
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
  const latestAllowedDate = new Date(today);
  latestAllowedDate.setDate(today.getDate() + 2);
  const selectedDate = new Date(`${input.contestDate}T00:00:00`);
  const selectedStartTime = input.contestStartTime ? new Date(input.contestStartTime) : null;
  const hasValidStartTime = selectedStartTime !== null && !Number.isNaN(selectedStartTime.getTime());

  if (!SPORTS.has(input.sport)) errors.push('Choose a supported sport.');
  if (!CONTEST_TYPES.has(input.contestType)) errors.push('Choose a supported contest type.');
  if (!input.contestDate || Number.isNaN(selectedDate.getTime())) errors.push('Choose a valid contest date.');
  if (hasValidStartTime) {
    const latestAllowedTime = new Date(Date.now() + 48 * 60 * 60 * 1000);
    if (selectedStartTime < new Date()) errors.push('Contest date must be today or later.');
    if (selectedStartTime > latestAllowedTime) errors.push('Contest date is outside the supported slate window.');
  } else {
    if (selectedDate < today) errors.push('Contest date must be today or later.');
    if (!Number.isNaN(selectedDate.getTime()) && selectedDate > latestAllowedDate) {
      errors.push('Contest date is outside the supported slate window.');
    }
  }
  if (!RISK_TOLERANCES.has(input.riskTolerance)) errors.push('Choose a valid risk tolerance.');
  if (input.lineupMode && !LINEUP_MODES.has(input.lineupMode)) errors.push('Choose a valid lineup mode.');
  if (input.entryCount !== undefined && (!Number.isInteger(input.entryCount) || input.entryCount < 1 || input.entryCount > 20)) {
    errors.push('Entry count must be between 1 and 20.');
  }
  if (input.maxEntriesPerUser !== undefined && (!Number.isInteger(input.maxEntriesPerUser) || input.maxEntriesPerUser < 1 || input.maxEntriesPerUser > 150)) {
    errors.push('Max entries per user must be between 1 and 150.');
  }
  if (
    input.entryCount !== undefined
    && input.maxEntriesPerUser !== undefined
    && input.entryCount > input.maxEntriesPerUser
  ) {
    errors.push('Entry count cannot exceed the contest max entries per user.');
  }
  if (
    input.entryCount !== undefined
    && input.maxEntriesPerUser === 1
    && input.entryCount > 1
  ) {
    errors.push('Single-entry contests can only build one lineup.');
  }
  if (input.fieldSize !== undefined && (!Number.isInteger(input.fieldSize) || input.fieldSize < 2 || input.fieldSize > 500_000)) {
    errors.push('Field size must be between 2 and 500,000.');
  }
  if (
    ['tournament', 'balanced_ev'].includes(input.lineupMode ?? '')
    && (input.fieldSize === undefined || input.fieldSize < 2)
  ) {
    errors.push('Field size is required for tournament objectives.');
  }
  if (
    input.entryCount !== undefined
    && input.maxCaptainExposure !== undefined
    && input.maxCaptainExposure * input.entryCount < 1
  ) {
    errors.push('Captain exposure is too low for the requested entry count.');
  }
  const locked = new Set((input.lockedPlayers ?? []).map(normalizePlayerName));
  const excluded = new Set((input.excludedPlayers ?? []).map(normalizePlayerName));
  for (const player of locked) {
    if (excluded.has(player)) errors.push(`${player} cannot be both locked and excluded.`);
  }
  if (input.captainPool?.length && input.lockedPlayers?.length) {
    const captainPool = new Set(input.captainPool.map(normalizePlayerName));
    const lockedOutsideCaptainPool = input.lockedPlayers.map(normalizePlayerName).filter((player) => !captainPool.has(player));
    if (input.contestType === 'showdown' && lockedOutsideCaptainPool.length === input.lockedPlayers.length) {
      errors.push('At least one locked player must be captain-eligible when a captain pool is set.');
    }
  }
  if (
    input.minPerTeam !== undefined
    && input.rosterSize !== undefined
    && input.minPerTeam * 2 > input.rosterSize
  ) {
    errors.push('Minimum players per team is not possible for the roster size.');
  }
  if (
    input.minSalaryUsed !== undefined
    && input.lockedSalaryTotal !== undefined
    && input.lockedSalaryTotal > 50_000
  ) {
    errors.push('Locked players exceed the salary cap.');
  }

  return errors;
}
