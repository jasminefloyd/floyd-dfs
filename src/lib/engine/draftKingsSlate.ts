import type { ContestFormat, RosterRules, SlatePlayer, Sport, ValidatedSlate } from './contracts.js';
import type { DraftKingsApiBundle } from './draftKings.js';
import { parseDraftKingsDateValue } from './draftKings.js';
import { validateSlate } from './validation.js';

export interface DraftKingsSlateContext { tenantId: string; userId: string; requestId: string; sport: Sport; league: Sport; contestId: string; contestFormat: ContestFormat; userEntryCount: number; contestName?: string; contestLockTime?: string; contestSizeOverride?: number; cashLine?: number; }
export class DraftKingsSlateMappingError extends Error { constructor(message: string) { super(message); this.name = 'DraftKingsSlateMappingError'; } }

export function buildValidatedSlateFromBundle(bundle: DraftKingsApiBundle, context: DraftKingsSlateContext): ValidatedSlate {
  const contest = unwrapRecord(bundle.contest.data, ['contest', 'contestDetail']);
  const draftGroup = unwrapRecord(bundle.draftGroup.data, 'draftGroup');
  const rules = resolveRules(unwrapRecord(bundle.gameTypeRules.data, 'gameTypeRules'));
  const draftables = unwrapRecord(bundle.draftables.data, 'draftables');
  const rosterRules = mapRosterRules(rules, context.contestFormat);
  const mappedDraftables = mapDraftables(draftables, context.contestFormat, rosterRules, context.sport);
  const playerPool = mappedDraftables.players;
  // Prefer the contest's actual field-size cap (maximumEntries) over its live sign-up count
  // (entries) -- the latter fluctuates continuously as people join before lock and would make
  // any paid-fraction/cash-line math built on it unstable between fetches of the same contest.
  const contestSize = context.contestSizeOverride ?? readNumber(contest, ['maximumEntries', 'contestSize', 'entries', 'totalEntries', 'maxEntries']);
  const contestKind = classifyContestKind(contest);
  const receivedAt = bundle.contest.retrievedAt;
  const sourceManifest = [
    { source: 'DRAFTKINGS_API', receivedAt, fields: ['contest', 'draftGroup', 'gameTypeRules', 'draftables'] },
  ];
  const scoringRules = mapScoringRules(rules);
  const scoringWarnings = Object.keys(scoringRules).length ? [] : [`DraftKings game-type rules did not return scoring values; applied the verified standard ${context.sport} scoring profile.`];
  const resolvedScoringRules = Object.keys(scoringRules).length ? scoringRules : standardScoringRules(context.sport);
  const slate: ValidatedSlate = {
    slateId: stableId(`${context.tenantId}:${context.requestId}:${context.contestId}`), version: 1, tenantId: context.tenantId, userId: context.userId, requestId: context.requestId, receivedAt, createdAt: receivedAt, sport: context.sport, league: context.league,
    event: { eventId: readString(draftGroup, ['eventId', 'id', 'draftGroupId'], context.contestId), name: readString(draftGroup, ['name', 'eventName', 'description'], context.contestName ?? 'DraftKings event'), eventDate: readDate([draftGroup], ['eventDate', 'startTime', 'startDate'], context.contestLockTime), participants: readStringArray(draftGroup, ['participants', 'teams', 'competitors']) },
    contest: { draftKingsContestId: context.contestId, name: readString(contest, ['name', 'contestName', 'contest_name'], context.contestName ?? 'DraftKings contest'), format: context.contestFormat, lockTime: readDate([contest, draftGroup], ['lockTime', 'startTime', 'startDate'], context.contestLockTime), contestSize, userEntryCount: context.userEntryCount, requestedEntryCount: context.userEntryCount, maxEntriesAllowed: readNumber(contest, ['maxEntriesAllowed', 'maxEntriesPerUser', 'maximumEntriesPerUser', 'mec']), contestKind: contestKind.kind, ...(contestKind.paidPositions !== undefined ? { paidPositions: contestKind.paidPositions } : {}), ...(Number.isFinite(context.cashLine) && Number(context.cashLine) > 0 ? { cashLine: Number(context.cashLine) } : {}) },
    salaryCap: readNestedNumber(rules, ['salaryCap', 'salary_cap', 'maxValue']) ?? 0, rosterRules, scoringRules: resolvedScoringRules, playerPool, sourceManifest, validation: { status: 'VALID', warnings: [], errors: [] },
  };
  const validationErrors = validateSlate(slate);
  return { ...slate, validation: { status: validationErrors.length ? 'BLOCKED' : 'VALID', warnings: [...mappedDraftables.warnings, ...scoringWarnings], errors: validationErrors } };
}

export interface DraftKingsScreenshotExtraction {
  sport?: string | null;
  contestName?: string | null;
  contestFormat?: string | null;
  lockTime?: string | null;
  salaryCap?: number | null;
  scoringRules?: Record<string, number>;
  players: Array<{ playerId?: string | null; playerName: string; team?: string | null; salary?: number | null; captainSalary?: number | null; utilitySalary?: number | null; eligibility: string[] }>;
}

export interface DraftKingsScreenshotContext { tenantId: string; userId: string; requestId: string; assetId: string; sport: Sport; league: Sport; contestFormat: ContestFormat; userEntryCount: number; receivedAt: string; }

export function buildValidatedSlateFromScreenshot(extracted: DraftKingsScreenshotExtraction, context: DraftKingsScreenshotContext): ValidatedSlate {
  const warnings: string[] = [];
  const errors: string[] = [];
  if (context.contestFormat !== 'SHOWDOWN') errors.push('Screenshot ingestion only supports DraftKings Showdown contests; Classic roster rules cannot be reliably read from an image, and DraftKings-provided data is required instead.');
  const rosterRules: RosterRules = { rosterSize: 6, slots: { CPT: { count: 1, salaryMultiplier: 1.5, fantasyMultiplier: 1.5 }, UTIL: { count: 5 } }, uniquePlayersRequired: true, teamConstraints: { minimumTeams: 2 } };
  const scoringRulesFromImage = Object.fromEntries(Object.entries(extracted.scoringRules ?? {}).flatMap(([key, value]) => Number.isFinite(value) ? [[key, { value }]] : []));
  const scoringRules = Object.keys(scoringRulesFromImage).length ? scoringRulesFromImage : standardScoringRules(context.sport);
  if (!Object.keys(scoringRulesFromImage).length) warnings.push(`Screenshot did not contain readable scoring rules; applied the verified standard ${context.sport} scoring profile.`);
  const players: SlatePlayer[] = [];
  (extracted.players ?? []).forEach((player, index) => {
    if (!player.playerName || !Number.isFinite(player.salary ?? NaN) || Number(player.salary) <= 0) { warnings.push(`Skipped screenshot player at index ${index}: name or salary was not readable.`); return; }
    const utilitySalary = Number.isFinite(player.utilitySalary ?? NaN) ? Number(player.utilitySalary) : Number(player.salary);
    const captainSalary = Number.isFinite(player.captainSalary ?? NaN) ? Number(player.captainSalary) : Math.round(utilitySalary * rosterRules.slots.CPT.salaryMultiplier!);
    players.push({ playerId: player.playerId?.trim() ? player.playerId.trim() : stableId(`${context.requestId}:${player.playerName}:${index}`), playerName: player.playerName, team: player.team ?? undefined, salary: utilitySalary, captainSalary, utilitySalary, eligibility: { CPT: true, UTIL: true } });
  });
  if (!players.length) errors.push('Screenshot did not contain any readable players.');
  if (!Number.isFinite(extracted.salaryCap ?? NaN) || Number(extracted.salaryCap) <= 0) errors.push('Screenshot did not contain a readable salary cap.');
  const lockTime = extracted.lockTime ? parseDraftKingsDateValue(extracted.lockTime) : undefined;
  if (!lockTime) errors.push('Screenshot did not contain a readable lock time.');
  const now = context.receivedAt;
  const slate: ValidatedSlate = {
    slateId: stableId(`${context.tenantId}:${context.requestId}:${context.assetId}`), version: 1, tenantId: context.tenantId, userId: context.userId, requestId: context.requestId, receivedAt: now, createdAt: now, sport: context.sport, league: context.league,
    event: { eventId: context.assetId, name: extracted.contestName ?? 'DraftKings event (screenshot)', eventDate: lockTime ?? now, participants: [] },
    contest: { draftKingsContestId: context.assetId, name: extracted.contestName ?? 'DraftKings contest (screenshot)', format: context.contestFormat, lockTime: lockTime ?? now, contestSize: undefined, userEntryCount: context.userEntryCount, requestedEntryCount: context.userEntryCount, maxEntriesAllowed: undefined },
    salaryCap: Number.isFinite(extracted.salaryCap ?? NaN) ? Number(extracted.salaryCap) : 0,
    rosterRules, scoringRules, playerPool: players,
    sourceManifest: [{ source: 'DRAFTKINGS_SCREENSHOT', receivedAt: now, fields: ['players', 'salaryCap', 'scoringRules', 'lockTime'] }],
    validation: { status: 'VALID', warnings, errors },
  };
  const validationErrors = [...errors, ...validateSlate(slate).filter((error) => !errors.includes(error))];
  return { ...slate, validation: { status: validationErrors.length ? 'BLOCKED' : 'VALID', warnings, errors: validationErrors } };
}

function mapRosterRules(record: Record<string, unknown>, format: ContestFormat): RosterRules {
  if (format === 'SHOWDOWN') { const multiplier = resolveShowdownCaptainMultiplier(record) ?? 1.5; return { rosterSize: 6, slots: { CPT: { count: 1, salaryMultiplier: multiplier, fantasyMultiplier: multiplier }, UTIL: { count: 5 } }, uniquePlayersRequired: true, teamConstraints: { minimumTeams: 2 } }; }
  const source = asRecord(record.rosterRules) ?? record;
  const slotsSource = asRecord(source.slots);
  const template = Array.isArray(source.lineupTemplate) ? source.lineupTemplate.map(asRecord).filter((value): value is Record<string, unknown> => Boolean(value)) : [];
  const templateSlots: Record<string, { count: number; salaryMultiplier?: number; fantasyMultiplier?: number }> = {};
  for (const item of template) { const slot = asRecord(item.rosterSlot) ?? item; const name = readString(slot, ['name'], 'UTIL'); const multiplier = readMultiplier(slot, ['positionTip', 'positionTipSubtext']); templateSlots[name] = { count: (templateSlots[name]?.count ?? 0) + 1, salaryMultiplier: multiplier ?? templateSlots[name]?.salaryMultiplier, fantasyMultiplier: multiplier ?? templateSlots[name]?.fantasyMultiplier }; }
  const sourceSlots = slotsSource ?? templateSlots;
  const slots: Record<string, { count: number; salaryMultiplier?: number; fantasyMultiplier?: number }> = Object.fromEntries(Object.entries(sourceSlots).map(([name, value]) => { const slot = asRecord(value); return [name, { count: readNumber(slot ?? {}, ['count']) ?? 1, salaryMultiplier: readNumber(slot ?? {}, ['salaryMultiplier', 'salary_multiplier']), fantasyMultiplier: readNumber(slot ?? {}, ['fantasyMultiplier', 'fantasy_multiplier']) }]; }));
  return { rosterSize: readNumber(source, ['rosterSize', 'roster_size']) ?? Object.values(slots).reduce((sum, slot) => sum + slot.count, 0), slots, uniquePlayersRequired: readBoolean(source, ['uniquePlayersRequired', 'unique_players_required'], true), teamConstraints: asRecord(source.teamConstraints) as RosterRules['teamConstraints'] };
}

function resolveShowdownCaptainMultiplier(record: Record<string, unknown>): number | undefined {
  const source = asRecord(record.rosterRules) ?? record;
  const template = Array.isArray(source.lineupTemplate) ? source.lineupTemplate.map(asRecord).filter((value): value is Record<string, unknown> => Boolean(value)) : [];
  for (const item of template) {
    const slot = asRecord(item.rosterSlot) ?? item;
    const name = readOptionalString(slot, ['name'])?.toUpperCase() ?? '';
    if (!name.includes('CPT') && !name.includes('CAPTAIN') && !name.includes('MVP')) continue;
    const multiplier = readMultiplier(slot, ['positionTip', 'positionTipSubtext']) ?? readNumber(slot, ['salaryMultiplier', 'salary_multiplier', 'fantasyMultiplier', 'fantasy_multiplier']);
    if (multiplier) return multiplier;
  }
  return readNumber(source, ['captainMultiplier', 'captain_multiplier']);
}

function mapDraftables(record: Record<string, unknown>, format: ContestFormat, rules: RosterRules, sport: Sport): { players: SlatePlayer[]; warnings: string[] } {
  const values = Array.isArray(record.draftables) ? record.draftables : Array.isArray(record.players) ? record.players : [];
  const warnings: string[] = []; const mapped = values.flatMap((value, index) => { const player = asRecord(value); if (!player) { warnings.push(`Skipped DraftKings draftable at index ${index}: record was not an object.`); return []; } const nested = asRecord(player.player) ?? asRecord(player.athlete) ?? asRecord(player.competitor) ?? asRecord(player.draftable); const source = nested ? { ...player, ...nested } : player; const salary = readNumber(source, ['salary', 'draftKingsSalary']); if (!salary) { warnings.push(`Skipped DraftKings draftable at index ${index}: salary was missing.`); return []; } const playerId = readStringOrNumber(source, ['playerId', 'playerID', 'PlayerId', 'playerDkId', 'draftableId', 'draftableID', 'id', 'Id', 'ID']); const playerName = readOptionalString(source, ['playerName', 'displayName', 'name', 'Name']); if (!playerId || !playerName) { warnings.push(`Skipped DraftKings draftable at index ${index}: player identity was missing.`); return []; } const eligibility = format === 'SHOWDOWN' ? { CPT: true, UTIL: true } : Object.fromEntries(readStringArray(source, ['eligibility', 'eligiblePositions', 'positions']).map((slot) => [slot, true])); const utilitySalary = readNumber(source, ['utilitySalary', 'utility_salary']) ?? salary; const captainMultiplier = rules.slots.CPT?.salaryMultiplier ?? 1.5; const captainSalary = format === 'SHOWDOWN' ? Math.round(utilitySalary * captainMultiplier) : (readNumber(source, ['captainSalary', 'captain_salary']) ?? Math.round(salary * captainMultiplier)); return [{ playerId, playerName, team: readOptionalString(source, ['team', 'teamAbbreviation', 'teamCode']), opponent: readOptionalString(source, ['opponent', 'opponentAbbreviation', 'opponentCode']), position: readOptionalString(source, ['position']), salary: utilitySalary, captainSalary, utilitySalary, eligibility, providerStatus: readOptionalString(source, ['status', 'providerStatus']), providerFppg: readNumber(source, ['fppg', 'providerFppg']) ?? readDraftStatFppg(source, sport), imageUrl: readOptionalString(source, ['playerImage160', 'playerImage50', 'imageUrl', 'playerImageUrl']), teamLogoUrl: readOptionalString(source, ['teamImageUrl', 'teamLogoUrl']) }]; });
  const merged = new Map<string, SlatePlayer>();
  for (const player of mapped) { const existing = merged.get(player.playerId); if (!existing) merged.set(player.playerId, player); else { const utilitySalary = Math.min(existing.utilitySalary ?? existing.salary, player.utilitySalary ?? player.salary); const eligibility = { ...existing.eligibility, ...player.eligibility }; merged.set(player.playerId, { ...existing, salary: utilitySalary, utilitySalary, eligibility, captainSalary: format === 'SHOWDOWN' ? Math.round(utilitySalary * (rules.slots.CPT?.salaryMultiplier ?? 1.5)) : Math.max(existing.captainSalary ?? 0, player.captainSalary ?? 0), providerFppg: existing.providerFppg ?? player.providerFppg }); } }
  return { players: [...merged.values()], warnings };
}

// Classifies a contest directly from DraftKings' own payout structure, never guessed. Verified
// live: a Double Up/50-50 (cash game) has exactly one payout tier covering roughly the top half
// of the field, paying every cashing position the same amount; a GPP/tournament has many tiers
// with a steep first-place-to-last-paid-place payout ratio. Missing/unparseable payout data
// yields UNKNOWN rather than a guess.
export function classifyContestKind(contest: Record<string, unknown>): { kind: 'CASH' | 'GPP' | 'UNKNOWN'; paidPositions?: number } {
  const tiers = Array.isArray(contest.payoutSummary) ? contest.payoutSummary.flatMap((value) => { const tier = asRecord(value); return tier ? [tier] : []; }) : [];
  if (!tiers.length) return { kind: 'UNKNOWN' };
  const paidPositions = Math.max(...tiers.map((tier) => readNumber(tier, ['maxPosition']) ?? 0));
  if (!paidPositions) return { kind: 'UNKNOWN' };
  const payoutAt = (position: number): number | undefined => {
    const tier = tiers.find((candidate) => { const min = readNumber(candidate, ['minPosition']) ?? 1; const max = readNumber(candidate, ['maxPosition']) ?? min; return position >= min && position <= max; });
    return tier ? readTierPayoutValue(tier) : undefined;
  };
  const firstPayout = payoutAt(1);
  const lastPayout = payoutAt(paidPositions);
  const topHeavyRatio = firstPayout !== undefined && lastPayout !== undefined && lastPayout > 0 ? firstPayout / lastPayout : undefined;
  if (topHeavyRatio === undefined) return { kind: 'UNKNOWN', paidPositions };
  const kind: 'CASH' | 'GPP' = tiers.length === 1 && topHeavyRatio <= 1.5 ? 'CASH' : 'GPP';
  return { kind, paidPositions };
}
function readTierPayoutValue(tier: Record<string, unknown>): number | undefined {
  const descriptions = Array.isArray(tier.payoutDescriptions) ? tier.payoutDescriptions : [];
  for (const value of descriptions) { const numeric = readNumber(asRecord(value) ?? {}, ['value']); if (numeric !== undefined) return numeric; }
  const tierPayoutDescriptions = asRecord(tier.tierPayoutDescriptions);
  if (tierPayoutDescriptions) for (const value of Object.values(tierPayoutDescriptions)) { const numeric = Number(String(value).replace(/[^0-9.]/g, '')); if (Number.isFinite(numeric)) return numeric; }
  return undefined;
}

function mapScoringRules(record: Record<string, unknown>): Record<string, { value: number }> { const scoring = record.scoringRules ?? record.scoring ?? record.scoringSettings; if (Array.isArray(scoring)) return Object.fromEntries(scoring.flatMap((value, index) => { const item = asRecord(value); if (!item) return []; const key = readOptionalString(item, ['name', 'key', 'stat', 'type']) ?? `rule_${index}`; const numeric = readNumber(item, ['value', 'points', 'multiplier']); return numeric === undefined ? [] : [[key, { value: numeric }]]; })); const object = asRecord(scoring); return Object.fromEntries(Object.entries(object ?? {}).flatMap(([key, value]) => { const numeric = typeof value === 'number' ? value : readNumber(asRecord(value) ?? {}, ['value', 'points', 'multiplier']); return numeric === undefined ? [] : [[key, { value: numeric }]]; })); }
// DraftKings' draftStatAttributes carries the FPPG-equivalent value under a numeric `id` that
// is NOT stable across sports (verified live: WNBA Showdown draftables used id 219 for a value
// that scaled consistently with salary across the pool; the SAME id on an MLB Showdown slate
// held an unrelated, much smaller value for some players -- using it there produced plausible-
// looking but wrong low projections instead of an honest gap, which is worse than the gap).
// Neither DK response names these ids, so each entry here is a live-verified id for that one
// sport, not a guess -- a sport with no verified id here falls back to id 90 only (the
// originally-observed id) rather than risk silently misattributing an unrelated stat.
const DRAFT_STAT_FPPG_ATTRIBUTE_ID_BY_SPORT: Partial<Record<Sport, string>> = { WNBA: '219', MLB: '408' };
function readDraftStatFppg(record: Record<string, unknown>, sport: Sport): number | undefined {
  const attributes = Array.isArray(record.draftStatAttributes) ? record.draftStatAttributes : [];
  const candidateIds = new Set(['90', DRAFT_STAT_FPPG_ATTRIBUTE_ID_BY_SPORT[sport]].filter((id): id is string => Boolean(id)));
  const fppg = attributes.find((value) => { const attribute = asRecord(value); return candidateIds.has(String(attribute?.id ?? '')); });
  return readNumber(asRecord(fppg) ?? {}, ['value', 'sortValue']);
}
function standardScoringRules(sport: Sport): Record<string, { value: number }> {
  if (sport === 'NBA' || sport === 'WNBA') return { points: { value: 1 }, threes: { value: 0.5 }, rebounds: { value: 1.25 }, assists: { value: 1.5 }, steals: { value: 2 }, blocks: { value: 2 }, turnovers: { value: -0.5 } };
  if (sport === 'MLB') return { single: { value: 3 }, double: { value: 5 }, triple: { value: 8 }, homeRun: { value: 10 }, rbi: { value: 2 }, run: { value: 2 }, walk: { value: 2 }, hitByPitch: { value: 2 }, sacrificeFly: { value: 1.25 }, sacrificeHit: { value: 1.25 }, stolenBase: { value: 5 }, inningPitched: { value: 2.25 }, strikeout: { value: 2 }, win: { value: 4 }, earnedRun: { value: -2 }, hitAgainst: { value: -0.6 }, walkAgainst: { value: -0.6 }, hitBatsman: { value: -0.6 }, completeGame: { value: 2.5 }, completeGameShutout: { value: 2.5 }, noHitter: { value: 5 } };
  if (sport === 'NFL') return { passingYards: { value: 0.04 }, passingTouchdown: { value: 4 }, interception: { value: -1 }, rushingYards: { value: 0.1 }, rushingTouchdown: { value: 6 }, reception: { value: 1 }, receivingYards: { value: 0.1 }, receivingTouchdown: { value: 6 }, twoPointConversion: { value: 2 }, fumbleLost: { value: -2 } };
  return {};
}
function unwrapRecord(value: unknown, key: string | string[]): Record<string, unknown> { const record = asRecord(value); if (!record) return {}; for (const candidate of Array.isArray(key) ? key : [key]) { const nested = asRecord(record[candidate]); if (nested) return nested; } return record; }
function resolveRules(record: Record<string, unknown>): Record<string, unknown> { const relevant = ['salaryCap', 'salary_cap', 'maxValue', 'scoringRules', 'scoring', 'rosterRules', 'lineupTemplate', 'slots']; if (relevant.some((key) => record[key] !== undefined)) return record; for (const key of ['rules', 'gameTypeRules', 'lineupRules', 'settings', 'configuration']) { const nested = asRecord(record[key]); if (nested) { const resolved = resolveRules(nested); if (relevant.some((candidate) => resolved[candidate] !== undefined)) return resolved; } } return record; }
function asRecord(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function readString(record: Record<string, unknown>, keys: string[], fallback?: string): string { return readOptionalString(record, keys) ?? fallback ?? (() => { throw new DraftKingsSlateMappingError(`Missing required field: ${keys.join(' / ')}.`); })(); }
function readOptionalString(record: Record<string, unknown>, keys: string[]): string | undefined { for (const key of keys) if (typeof record[key] === 'string' && String(record[key]).trim()) return String(record[key]).trim(); return undefined; }
function readStringOrNumber(record: Record<string, unknown>, keys: string[]): string | undefined { for (const key of keys) { const value = record[key]; if (typeof value === 'string' && value.trim()) return value.trim(); if (typeof value === 'number' && Number.isFinite(value)) return String(value); } return undefined; }
function readStringArray(record: Record<string, unknown>, keys: string[]): string[] { for (const key of keys) if (Array.isArray(record[key])) return (record[key] as unknown[]).map(String).filter(Boolean); return []; }
function readNumber(record: Record<string, unknown>, keys: string[]): number | undefined { for (const key of keys) { const value = record[key]; if (typeof value === 'number' && Number.isFinite(value)) return value; if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value); } return undefined; }
function readNestedNumber(record: Record<string, unknown>, keys: string[]): number | undefined { const direct = readNumber(record, keys); if (direct !== undefined) return direct; for (const key of keys) { const nested = asRecord(record[key]); const value = nested ? readNumber(nested, ['maxValue', 'value', 'maximum', 'amount']) : undefined; if (value !== undefined) return value; } return undefined; }
function readBoolean(record: Record<string, unknown>, keys: string[], fallback: boolean): boolean { for (const key of keys) { const value = record[key]; if (typeof value === 'boolean') return value; if (value === 'true' || value === 1) return true; if (value === 'false' || value === 0) return false; } return fallback; }
function readDate(records: Record<string, unknown>[], keys: string[], fallback?: string): string { for (const record of records) { const value = readOptionalString(record, keys); const parsed = value ? parseDraftKingsDateValue(value) : undefined; if (parsed) return parsed; } const fallbackParsed = fallback ? parseDraftKingsDateValue(fallback) : undefined; if (fallbackParsed) return fallbackParsed; throw new DraftKingsSlateMappingError(`Missing required date field: ${keys.join(' / ')}.`); }
function readMultiplier(record: Record<string, unknown>, keys: string[]): number | undefined { for (const key of keys) { const match = String(record[key] ?? '').match(/([0-9]+(?:\.[0-9]+)?)\s*x/i); if (match) return Number(match[1]); } return undefined; }
function stableId(value: string): string { let hash = 2166136261; for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(16).padStart(8, '0').repeat(4).slice(0, 32); }
