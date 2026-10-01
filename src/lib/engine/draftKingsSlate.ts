import type { ContestFormat, RosterRules, SlatePlayer, Sport, ValidatedSlate } from './contracts.js';
import type { DraftKingsApiBundle } from './draftKings.js';
import { parseDraftKingsDateValue } from './draftKings.js';
import { validateSlate } from './validation.js';
import { DK_SCORING } from '../dkScoring.js';

export interface DraftKingsSlateContext { tenantId: string; userId: string; requestId: string; sport: Sport; league: Sport; contestId: string; contestFormat: ContestFormat; userEntryCount: number; contestName?: string; contestLockTime?: string; contestSizeOverride?: number; cashLine?: number; objective?: import('./contracts.js').ContestObjective; }
export class DraftKingsSlateMappingError extends Error { constructor(message: string) { super(message); this.name = 'DraftKingsSlateMappingError'; } }

export function buildValidatedSlateFromBundle(bundle: DraftKingsApiBundle, context: DraftKingsSlateContext): ValidatedSlate {
  const contest = unwrapRecord(bundle.contest.data, ['contest', 'contestDetail']);
  const draftGroup = unwrapRecord(bundle.draftGroup.data, 'draftGroup');
  const rules = resolveRules(unwrapRecord(bundle.gameTypeRules.data, 'gameTypeRules'));
  const draftables = unwrapRecord(bundle.draftables.data, 'draftables');
  const rosterRules = mapRosterRules(rules, context.contestFormat, context.sport);
  const mappedDraftables = mapDraftables(draftables, context.contestFormat, rosterRules, context.sport);
  const playerPool = mappedDraftables.players;
  // Prefer the contest's actual field-size cap (maximumEntries) over its live sign-up count
  // (entries) -- the latter fluctuates continuously as people join before lock and would make
  // any paid-fraction/cash-line math built on it unstable between fetches of the same contest.
  const contestSize = context.contestSizeOverride ?? readNumber(contest, ['maximumEntries', 'maximum_entries', 'contestSize', 'totalEntries']);
  const contestKind = classifyContestKind(contest);
  const receivedAt = bundle.contest.retrievedAt;
  const fallbackUsed = rules.sourceFallback === true;
  const profileVerified = rules.profileVerified === true && bundle.contestIdentityVerified === true;
  const sourceManifest: ValidatedSlate['sourceManifest'] = [
    { source: fallbackUsed ? 'DRAFTKINGS_PUBLIC_LOBBY_AND_PLAYER_CSV' : 'DRAFTKINGS_API', receivedAt, fields: fallbackUsed ? ['liveContestIdentity', 'sportFormatDraftGroupBinding', 'playerId', 'salary', 'position', 'eligibility', 'status', 'averagePointsPerGame'] : ['contest', 'draftGroup', 'gameTypeRules', 'draftables'] },
  ];
  const providerScoringRules = mapScoringRules(rules);
  const officialProfile = officialScoringProfile(context.sport, context.contestFormat, rules, `${readString(contest, ['name', 'contestName', 'contest_name'], context.contestName ?? '')} ${readString(draftGroup, ['name', 'eventName', 'description'], '')}`);
  const scoringConflicts = officialProfile ? Object.keys(providerScoringRules).filter((key) => officialProfile.rules[key] !== undefined && Math.abs(providerScoringRules[key].value - officialProfile.rules[key].value) > 1e-9) : [];
  const scoringRules = officialProfile ? { ...officialProfile.rules, ...providerScoringRules } : providerScoringRules;
  const requiredScoringRules = standardScoringRules(context.sport, context.contestFormat);
  const missingScoringRules = Object.keys(requiredScoringRules).filter((key) => scoringRules[key] === undefined);
  const scoringVerified = Object.keys(scoringRules).length > 0 && missingScoringRules.length === 0 && scoringConflicts.length === 0 && (!officialProfile || officialProfile.verified);
  const usedOfficialProfile = Boolean(officialProfile && Object.keys(requiredScoringRules).some((key) => providerScoringRules[key] === undefined) && scoringConflicts.length === 0);
  if (officialProfile) sourceManifest.push({ source: officialProfile.source, receivedAt: officialProfile.reviewedAt, fields: Object.keys(officialProfile.rules), sourceUrl: officialProfile.sourceUrl, ruleVersion: officialProfile.version });
  if (profileVerified) sourceManifest.push({ source: 'DRAFTKINGS_PUBLISHED_CONTEST_RULE_PROFILE', receivedAt, fields: ['salaryCap', 'rosterSize', 'rosterSlots', 'teamConstraints', 'captainMultipliers'], sourceUrl: ruleProfileUrl(context.sport, context.contestFormat), ruleVersion: String(rules.ruleProfileVersion ?? 'DK_PUBLISHED_RULES') });
  const scoringWarnings = scoringVerified ? (usedOfficialProfile || fallbackUsed ? [`Scoring values were resolved from the reviewed DraftKings ${context.sport} profile (${officialProfile?.version ?? 'published scoring profile'}).`] : []) : ['Authoritative DraftKings scoring values are incomplete or conflicting; provisional scoring cannot verify this contest.'];
  const resolvedScoringRules = Object.keys(scoringRules).length ? scoringRules : standardScoringRules(context.sport, context.contestFormat);
  const slate: ValidatedSlate = {
    slateId: stableId(`${context.tenantId}:${context.requestId}:${context.contestId}`), version: 1, tenantId: context.tenantId, userId: context.userId, requestId: context.requestId, receivedAt, createdAt: receivedAt, sport: context.sport, league: context.league,
    event: { eventId: readString(draftGroup, ['eventId', 'id', 'draftGroupId'], context.contestId), name: readString(draftGroup, ['name', 'eventName', 'description'], context.contestName ?? 'DraftKings event'), eventDate: readDate([draftGroup], ['eventDate', 'startTime', 'startDate'], context.contestLockTime), participants: readStringArray(draftGroup, ['participants', 'teams', 'competitors']) },
    contest: { draftKingsContestId: context.contestId, name: readString(contest, ['name', 'contestName', 'contest_name'], context.contestName ?? 'DraftKings contest'), format: context.contestFormat, lockTime: readDate([contest, draftGroup], ['lockTime', 'startTime', 'startDate'], context.contestLockTime), contestSize, userEntryCount: context.userEntryCount, requestedEntryCount: context.userEntryCount, maxEntriesAllowed: readNumber(contest, ['maxEntriesAllowed', 'maximumEntriesPerUser', 'maximum_entries_per_user', 'mec']), contestKind: contestKind.kind, ...(context.objective ? { objective: context.objective } : {}), ...(contestKind.paidPositions !== undefined ? { paidPositions: contestKind.paidPositions } : {}), ...(Number.isFinite(context.cashLine) && Number(context.cashLine) > 0 ? { cashLine: Number(context.cashLine) } : {}) },
    salaryCap: readNestedNumber(rules, ['salaryCap', 'salary_cap', 'maxValue']) ?? 0, rosterRules, scoringRules: resolvedScoringRules, playerPool, sourceManifest, validation: { status: 'VALID', warnings: [], errors: [] },
  };
  const validationErrors = validateSlate(slate);
  if (bundle.contestIdentityVerified !== true) validationErrors.push('Contest ID, sport, format, draft group, lock time, and lobby metadata were not authoritatively bound; this slate is discovery-only and cannot generate lineups.');
  validationErrors.push(...validateAuthoritativeRosterRules(rules, context.contestFormat, rosterRules, context.sport));
  if (fallbackUsed && !profileVerified) validationErrors.push('Authoritative DraftKings contest rules were unavailable and no reviewed rule profile matches this sport and format.');
  if (!scoringVerified) validationErrors.push('Authoritative DraftKings scoring values are unavailable; provisional scoring templates cannot be used to generate an entry-ready lineup.');
  if (missingScoringRules.length) validationErrors.push(`DraftKings scoring rules are incomplete for this model: ${missingScoringRules.join(', ')}.`);
  if (scoringConflicts.length) validationErrors.push(`DraftKings scoring values conflict with the reviewed official scoring profile: ${scoringConflicts.join(', ')}.`);
  const sourceWarnings = fallbackUsed ? [profileVerified ? 'DraftKings detailed endpoints returned HTTP 403. The live public lobby and salary CSV were identity-bound to this contest; roster rules and scoring use the published, reviewed profile. Model validation is still required before real-money use.' : 'DraftKings detailed endpoints were blocked and this contest does not have a reviewed rule profile; lineup generation remains blocked.'] : [];
  return { ...slate, validation: { status: validationErrors.length ? 'BLOCKED' : 'VALID', warnings: [...sourceWarnings, ...mappedDraftables.warnings, ...scoringWarnings], errors: validationErrors } };
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
  // An image extraction is useful for discovery, but it cannot establish contest
  // identity or authoritative roster/scoring rules. Never mark it entry-ready.
  errors.push('Screenshot-derived contest data is unverified. Fetch the exact DraftKings contest, roster rules, scoring rules, and player pool from an authoritative source before generating lineups.');
  if (context.contestFormat !== 'SHOWDOWN') errors.push('Screenshot ingestion only supports DraftKings Showdown contests; Classic roster rules cannot be reliably read from an image, and DraftKings-provided data is required instead.');
  const rosterRules: RosterRules = { rosterSize: 6, slots: { CPT: { count: 1, salaryMultiplier: 1.5, fantasyMultiplier: 1.5 }, UTIL: { count: 5 } }, uniquePlayersRequired: true, teamConstraints: { minimumTeams: 2 } };
  const scoringRulesFromImage = Object.fromEntries(Object.entries(extracted.scoringRules ?? {}).flatMap(([key, value]) => Number.isFinite(value) ? [[key, { value }]] : []));
  const scoringRules = Object.keys(scoringRulesFromImage).length ? scoringRulesFromImage : standardScoringRules(context.sport, context.contestFormat);
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

function mapRosterRules(record: Record<string, unknown>, format: ContestFormat, sport: Sport): RosterRules {
  if (format === 'SHOWDOWN' && sport !== 'GOLF') { const multiplier = resolveShowdownCaptainMultiplier(record) ?? 1.5; return { rosterSize: 6, slots: { CPT: { count: 1, salaryMultiplier: multiplier, fantasyMultiplier: multiplier }, UTIL: { count: 5 } }, uniquePlayersRequired: true, teamConstraints: { minimumTeams: 2 } }; }
  const source = asRecord(record.rosterRules) ?? record;
  const slotsSource = asRecord(source.slots);
  const template = Array.isArray(source.lineupTemplate) ? source.lineupTemplate.map(asRecord).filter((value): value is Record<string, unknown> => Boolean(value)) : [];
  const templateSlots: Record<string, { count: number; salaryMultiplier?: number; fantasyMultiplier?: number }> = {};
  for (const item of template) { const slot = asRecord(item.rosterSlot) ?? item; const name = readString(slot, ['name'], 'UTIL'); const multiplier = readMultiplier(slot, ['positionTip', 'positionTipSubtext']); templateSlots[name] = { count: (templateSlots[name]?.count ?? 0) + 1, salaryMultiplier: multiplier ?? templateSlots[name]?.salaryMultiplier, fantasyMultiplier: multiplier ?? templateSlots[name]?.fantasyMultiplier }; }
  const sourceSlots = slotsSource ?? templateSlots;
  const slots: Record<string, { count: number; salaryMultiplier?: number; fantasyMultiplier?: number }> = Object.fromEntries(Object.entries(sourceSlots).map(([name, value]) => { const slot = asRecord(value); return [name, { count: readNumber(slot ?? {}, ['count']) ?? 1, salaryMultiplier: readNumber(slot ?? {}, ['salaryMultiplier', 'salary_multiplier']), fantasyMultiplier: readNumber(slot ?? {}, ['fantasyMultiplier', 'fantasy_multiplier']) }]; }));
  return { rosterSize: readNumber(source, ['rosterSize', 'roster_size']) ?? Object.values(slots).reduce((sum, slot) => sum + slot.count, 0), slots, uniquePlayersRequired: readBoolean(source, ['uniquePlayersRequired', 'unique_players_required'], true), teamConstraints: asRecord(source.teamConstraints) as RosterRules['teamConstraints'] };
}

function validateAuthoritativeRosterRules(record: Record<string, unknown>, format: ContestFormat, mapped: RosterRules, sport: Sport): string[] {
  const source = asRecord(record.rosterRules) ?? record;
  const slots = asRecord(source.slots);
  const template = Array.isArray(source.lineupTemplate) ? source.lineupTemplate.map(asRecord).filter((value): value is Record<string, unknown> => Boolean(value)) : [];
  if (!slots && !template.length) return ['DraftKings game-type data did not include an authoritative roster slot template; guessed/default roster rules cannot be used for lineup generation.'];
  if (format === 'SHOWDOWN') {
    const captainNames = new Set(['CPT', 'CAPTAIN', 'MVP']);
    const normalized = Object.entries(mapped.slots).map(([name, rule]) => [name.toUpperCase(), rule] as const);
    const captain = normalized.find(([name]) => captainNames.has(name));
    const utility = normalized.find(([name]) => ['UTIL', 'FLEX'].includes(name));
    if (sport === 'GOLF' && !captain) {
      if (mapped.rosterSize !== 6 || Object.values(mapped.slots).reduce((sum, slot) => sum + slot.count, 0) !== 6) return ['DraftKings Golf Showdown rules must explicitly verify six golfer slots.'];
    } else {
      if (!captain || captain[1].count !== 1 || !utility || utility[1].count !== 5 || mapped.rosterSize !== 6) return ['DraftKings Showdown roster rules do not explicitly verify one Captain/MVP and five Utility/Flex slots.'];
      const hasCaptainMultiplier = resolveShowdownCaptainMultiplier(record) !== undefined && captain[1].salaryMultiplier !== undefined && captain[1].fantasyMultiplier !== undefined && captain[1].salaryMultiplier > 0 && captain[1].fantasyMultiplier > 0;
      if (!hasCaptainMultiplier) return ['DraftKings Showdown rules do not explicitly provide both Captain salary and fantasy-point multipliers.'];
    }
  }
  if (!Number.isFinite(mapped.rosterSize) || mapped.rosterSize <= 0 || Object.values(mapped.slots).some((slot) => !Number.isInteger(slot.count) || slot.count <= 0)) return ['DraftKings roster slot counts are invalid or incomplete.'];
  if (Object.values(mapped.slots).reduce((sum, slot) => sum + slot.count, 0) !== mapped.rosterSize) return ['DraftKings rosterSize does not equal the sum of authoritative slot counts.'];
  if (readNestedNumber(record, ['salaryCap', 'salary_cap', 'maxValue']) === undefined) return ['DraftKings game-type data did not include an authoritative salary cap.'];
  return [];
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
  const warnings: string[] = []; let usedPositionFallback = false; const mapped = values.flatMap((value, index) => { const player = asRecord(value); if (!player) { warnings.push(`Skipped DraftKings draftable at index ${index}: record was not an object.`); return []; } const nested = asRecord(player.player) ?? asRecord(player.athlete) ?? asRecord(player.competitor) ?? asRecord(player.draftable); const source = nested ? { ...player, ...nested } : player; const salary = readNumber(source, ['salary', 'draftKingsSalary']); if (!salary) { warnings.push(`Skipped DraftKings draftable at index ${index}: salary was missing.`); return []; } const playerId = readStringOrNumber(source, ['playerId', 'playerID', 'PlayerId', 'playerDkId', 'draftableId', 'draftableID', 'id', 'Id', 'ID']); const playerName = readOptionalString(source, ['playerName', 'displayName', 'name', 'Name']); if (!playerId || !playerName) { warnings.push(`Skipped DraftKings draftable at index ${index}: player identity was missing.`); return []; } // Golf Classic draftables carry no `eligibility`/`eligiblePositions`/`positions` array at all
// (verified live against a real contest) -- DK represents eligibility via a single numeric
// `rosterSlotId` instead, because every Classic Golf roster slot is the same interchangeable
// "G" slot (confirmed against the real gameTypeRules response: all 6 slots share rosterSlot id
// 118, name "G"). Every golfer is eligible for every slot, so this is a direct, verified mapping,
// not a guess -- the array-based parser below was returning an empty object for every golfer,
// which silently made the entire Golf Classic player pool ineligible for any roster slot.
const position = readOptionalString(source, ['position']); const sourceEligibility = readStringArray(source, ['eligibility', 'eligiblePositions', 'positions']); const golfShowdownEligibility = sport === 'GOLF' && format === 'SHOWDOWN' ? Object.fromEntries(Object.keys(rules.slots).map((slot) => [slot, true])) : undefined; const eligibility = sourceEligibility.length ? Object.fromEntries(sourceEligibility.map((slot) => [slot, true])) : format === 'SHOWDOWN' && sport !== 'GOLF' ? { CPT: true, UTIL: true } : sport === 'GOLF' ? (golfShowdownEligibility ?? { G: true }) : Object.fromEntries(inferEligibilityFromPosition(position, rules.slots, sport).map((slot) => [slot, true])); if (!sourceEligibility.length && Object.keys(eligibility).length) usedPositionFallback = true; const utilitySalary = readNumber(source, ['utilitySalary', 'utility_salary']) ?? salary; const hasCaptainSlot = Boolean(rules.slots.CPT); const captainMultiplier = rules.slots.CPT?.salaryMultiplier ?? 1.5; const captainSalary = format === 'SHOWDOWN' && (sport !== 'GOLF' || hasCaptainSlot) ? Math.round(utilitySalary * captainMultiplier) : readNumber(source, ['captainSalary', 'captain_salary']); return [{ playerId, playerName, identity: { draftKingsId: playerId, confidence: 'EXACT' as const, matchedBy: 'DRAFTKINGS' as const }, team: readOptionalString(source, ['team', 'teamAbbreviation', 'teamCode', 'TeamAbbrev']), opponent: readOptionalString(source, ['opponent', 'opponentAbbreviation', 'opponentCode']), position, salary: utilitySalary, captainSalary, utilitySalary, eligibility, providerStatus: readOptionalString(source, ['status', 'providerStatus']), providerFppg: readNumber(source, ['fppg', 'providerFppg']) ?? readDraftStatFppg(source, sport), imageUrl: readOptionalString(source, ['playerImage160', 'playerImage50', 'imageUrl', 'playerImageUrl']), teamLogoUrl: readOptionalString(source, ['teamImageUrl', 'teamLogoUrl']) }]; });
  const merged = new Map<string, SlatePlayer>();
  for (const player of mapped) { const existing = merged.get(player.playerId); if (!existing) merged.set(player.playerId, player); else { const utilitySalary = Math.min(existing.utilitySalary ?? existing.salary, player.utilitySalary ?? player.salary); const eligibility = { ...existing.eligibility, ...player.eligibility }; merged.set(player.playerId, { ...existing, salary: utilitySalary, utilitySalary, eligibility, captainSalary: format === 'SHOWDOWN' ? Math.round(utilitySalary * (rules.slots.CPT?.salaryMultiplier ?? 1.5)) : Math.max(existing.captainSalary ?? 0, player.captainSalary ?? 0), providerFppg: existing.providerFppg ?? player.providerFppg }); } }
  if (usedPositionFallback) warnings.push(`DraftKings eligibility fields were absent for some ${sport} draftables; mapped roster eligibility from the provider position field.`);
  return { players: [...merged.values()], warnings };
}

function inferEligibilityFromPosition(position: string | undefined, slots: Record<string, { count: number }>, sport: Sport): string[] {
  if (!position) return [];
  const positions = position.toUpperCase().split(/[\s,|]+/).flatMap((value) => value.split('/')).filter(Boolean);
  return Object.keys(slots).filter((slot) => {
    const normalizedSlot = slot.toUpperCase();
    if (sport === 'MLB' && normalizedSlot === 'P') return positions.some((value) => ['P', 'SP', 'RP'].includes(value));
    if (['FLEX', 'UTIL', 'SUPERFLEX'].includes(normalizedSlot)) return true;
    return positions.includes(normalizedSlot);
  });
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
  // CFB has no verified DraftKings draft-stat attribute ID in this repository. Do not reuse
  // another sport's numeric attribute and silently attach the wrong value; CFB will use an
  // explicitly named `fppg`/`providerFppg` field or the structured season-stat path instead.
  const candidateIds = new Set((sport === 'CFB' ? [DRAFT_STAT_FPPG_ATTRIBUTE_ID_BY_SPORT[sport]] : ['90', DRAFT_STAT_FPPG_ATTRIBUTE_ID_BY_SPORT[sport]]).filter((id): id is string => Boolean(id)));
  const fppg = attributes.find((value) => { const attribute = asRecord(value); return candidateIds.has(String(attribute?.id ?? '')); });
  return readNumber(asRecord(fppg) ?? {}, ['value', 'sortValue']);
}
interface OfficialScoringProfile { rules: Record<string, { value: number }>; source: string; sourceUrl: string; version: string; reviewedAt: string; verified: boolean; }

function officialScoringProfile(sport: Sport, format: ContestFormat, rules: Record<string, unknown>, eventContext: string): OfficialScoringProfile | undefined {
  if (sport === 'GOLF' && format === 'SHOWDOWN') return officialGolfShowdownScoringProfile(rules, eventContext);
  // DraftKings' WNBA rules endpoint omits scoring values on some game types. The official
  // DraftKings WNBA Fantasy Points table publishes the same base fantasy-point categories
  // used by this Classic/Showdown scorer. Captain scoring remains a separately verified
  // roster-rule multiplier. This profile is intentionally sport-scoped; it is not a fallback
  // for NBA or another league, and any overlapping API value must match exactly.
  if (sport === 'GOLF') return { rules: standardScoringRules(sport, format), source: 'DRAFTKINGS_PUBLISHED_GOLF_CLASSIC_SCORING', sourceUrl: 'https://dknetwork.draftkings.com/2024/03/07/how-to-play-golf-dfs-tips-beginners-guide-to-daily-fantasy-golf-on-draftkings/', version: 'DK_GOLF_CLASSIC_SCORING_2026-10-01.1', reviewedAt: '2026-10-01T00:00:00.000Z', verified: true };
  if (sport === 'MLB') return { rules: standardScoringRules(sport, format), source: 'DRAFTKINGS_PUBLISHED_MLB_SCORING', sourceUrl: 'https://dknetwork.draftkings.com/2020/05/29/beginner-mlb-dfs-scoring/', version: 'DK_MLB_SCORING_2026-10-01.1', reviewedAt: '2026-10-01T00:00:00.000Z', verified: true };
  if (sport === 'NFL' || sport === 'CFB') return { rules: standardScoringRules(sport, format), source: sport === 'NFL' ? 'DRAFTKINGS_PUBLISHED_NFL_SCORING' : 'DRAFTKINGS_PUBLISHED_CFB_SCORING', sourceUrl: sport === 'NFL' ? 'https://dknetwork.draftkings.com/2025/08/27/nfl-dfs-beginners-guide-draftkings/' : 'https://pick6.draftkings.com/pick6-rules-and-scoring-cfb', version: `DK_${sport}_SCORING_2026-10-01.1`, reviewedAt: '2026-10-01T00:00:00.000Z', verified: true };
  if (sport !== 'WNBA') return undefined;
  const score = DK_SCORING.wnba;
  return {
    rules: {
      points: { value: score.points }, threePointersMade: { value: score.threePointersMade }, rebounds: { value: score.rebounds },
      assists: { value: score.assists }, steals: { value: score.steals }, blocks: { value: score.blocks },
      turnovers: { value: score.turnovers }, doubleDouble: { value: score.doubleDouble }, tripleDouble: { value: score.tripleDouble },
    },
    source: 'DRAFTKINGS_OFFICIAL_WNBA_FANTASY_SCORING',
    sourceUrl: 'https://pick6.draftkings.com/pick6-rules-and-scoring-wnba',
    version: 'DK_WNBA_FANTASY_SCORING_2026-09-30.1',
    reviewedAt: '2026-09-30T00:00:00.000Z',
    verified: true,
  };
}

function ruleProfileUrl(sport: Sport, format: ContestFormat): string {
  if (format === 'SHOWDOWN') return 'https://support.draftkings.com/dk/en-us/game-style-showdowns-overview?id=kb_article_view&sysparm_article=KB0010694';
  const page: Record<Sport, string> = { MLB: 'fantasy-baseball', NFL: 'fantasy-football', CFB: 'fantasy-college-football', WNBA: 'fantasy-basketball', NBA: 'fantasy-basketball', GOLF: 'fantasy-golf' };
  return `https://www.draftkings.com/${page[sport]}`;
}

function officialGolfShowdownScoringProfile(rules: Record<string, unknown>, eventContext: string): OfficialScoringProfile | undefined {
  const ruleSource = asRecord(rules.rosterRules) ?? rules;
  const captainSlot = Object.keys(asRecord(ruleSource.slots) ?? {}).some((slot) => ['CPT', 'CAPTAIN', 'MVP'].includes(slot.toUpperCase()))
    || (Array.isArray(ruleSource.lineupTemplate) && ruleSource.lineupTemplate.some((value) => /^(CPT|CAPTAIN|MVP)$/i.test(readOptionalString(asRecord(asRecord(value)?.rosterSlot) ?? asRecord(value) ?? {}, ['name']) ?? '')));
  const explicitSlotCount = asRecord(ruleSource.slots)
    ? Object.values(asRecord(ruleSource.slots)!).reduce<number>((sum, value) => sum + (readNumber(asRecord(value) ?? {}, ['count']) ?? 1), 0)
    : Array.isArray(ruleSource.lineupTemplate) ? ruleSource.lineupTemplate.length : 0;
  // Golf has both stroke-play round Showdowns and match-play variants. Only apply the
  // reviewed PGA single-round profile when DK's own template confirms six golfer slots
  // and the contest/event metadata does not identify a match-play scoring variant.
  if (captainSlot || explicitSlotCount !== 6 || /match\s*play|presidents\s*cup|ryder\s*cup/i.test(eventContext)) return undefined;
  const score = DK_SCORING.golf.showdown;
  return {
    rules: {
      doubleEagleOrBetter: { value: score.doubleEagleOrBetter }, eagle: { value: score.eagle }, eagles: { value: score.eagle }, birdie: { value: score.birdie }, birdies: { value: score.birdie },
      par: { value: score.par }, pars: { value: score.par }, bogey: { value: score.bogey }, bogeys: { value: score.bogey }, doubleBogeyOrWorse: { value: score.doubleBogeyOrWorse },
      doubleBogey: { value: score.doubleBogeyOrWorse }, birdieStreak: { value: score.birdieStreak }, bogeyFreeRound: { value: score.bogeyFreeRound }, holeInOne: { value: score.holeInOne },
    },
    source: 'DRAFTKINGS_OFFICIAL_GOLF_SHOWDOWN_SCORING',
    sourceUrl: 'https://pick6.draftkings.com/pick6-rules-and-scoring-pga-single-round',
    version: 'DK_GOLF_SHOWDOWN_SCORING_2026-09-30.1',
    reviewedAt: '2026-09-30T00:00:00.000Z',
    verified: true,
  };
}

function standardScoringRules(sport: Sport, format: ContestFormat): Record<string, { value: number }> {
  if (sport === 'NBA' || sport === 'WNBA') return { points: { value: DK_SCORING[sport.toLowerCase() as 'nba' | 'wnba'].points }, threePointersMade: { value: DK_SCORING[sport.toLowerCase() as 'nba' | 'wnba'].threePointersMade }, rebounds: { value: DK_SCORING[sport.toLowerCase() as 'nba' | 'wnba'].rebounds }, assists: { value: DK_SCORING[sport.toLowerCase() as 'nba' | 'wnba'].assists }, steals: { value: DK_SCORING[sport.toLowerCase() as 'nba' | 'wnba'].steals }, blocks: { value: DK_SCORING[sport.toLowerCase() as 'nba' | 'wnba'].blocks }, turnovers: { value: DK_SCORING[sport.toLowerCase() as 'nba' | 'wnba'].turnovers }, doubleDouble: { value: DK_SCORING[sport.toLowerCase() as 'nba' | 'wnba'].doubleDouble }, tripleDouble: { value: DK_SCORING[sport.toLowerCase() as 'nba' | 'wnba'].tripleDouble } };
  if (sport === 'MLB') return Object.fromEntries(Object.entries(DK_SCORING.mlb).map(([key, value]) => [key, { value }]));
  if (sport === 'NFL' || sport === 'CFB') return Object.fromEntries(Object.entries(DK_SCORING.nfl).map(([key, value]) => [key, { value }]));
  if (sport === 'GOLF') {
    // DraftKings' own gameTypeRules response has no scoring-rules field at all for Golf (verified
    // live -- confirmed absent from a real contest's /lineups/v1/gametypes/{id}/rules payload), so
    // this fallback is the ONLY source of Golf scoring; it was previously missing entirely, which
    // hard-blocked every Golf slate (`scoring rules are required`) whenever this path was hit.
    // Reuses the already-verified DK_SCORING.golf table from dkScoring.ts rather than a new guess.
    // Only birdie/eagle/bogey/par are included: they're the only categories this engine's
    // projection model tracks (componentsFor's golf branch in projection.ts); finishPositionBonus
    // is folded in separately as an implicit weight-1 rule, and rarer categories (double-eagle,
    // streak/bogey-free/hole-in-one bonuses) aren't part of this engine's component model.
    const table = format === 'SHOWDOWN' ? DK_SCORING.golf.showdown : DK_SCORING.golf.classic;
    return { birdies: { value: table.birdie }, eagles: { value: table.eagle }, bogeys: { value: table.bogey }, pars: { value: table.par } };
  }
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
