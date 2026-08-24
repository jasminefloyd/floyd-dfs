import { createHash } from "node:crypto";
import type { ContestFormat, SlateInput, Sport } from "@sports-engine/contracts";
import type { DraftKingsApiBundle } from "./provider";
import { normalizeAndValidateSlate } from "./slate";
import { resolveDraftKingsScoringRules } from "./scoring-rules";

export interface DraftKingsSlateBuildContext {
  tenantId: string;
  userId: string;
  requestId: string;
  sport: Sport;
  league: string;
  contestId: string;
  draftGroupId: string;
  gameTypeId: string;
  contestFormat: ContestFormat;
  userEntryCount: number;
  contestName?: string;
  contestLockTime?: string;
  contestSizeOverride?: number;
}

export interface DraftKingsSlateBuildResult {
  slateInput: SlateInput;
  validatedSlate: ReturnType<typeof normalizeAndValidateSlate>;
  rawResponses: DraftKingsApiBundle;
}

export class DraftKingsSlateMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftKingsSlateMappingError";
  }
}

export function buildSlateFromApiBundle(bundle: DraftKingsApiBundle, context: DraftKingsSlateBuildContext, now = new Date()): DraftKingsSlateBuildResult {
  const contest = unwrapRecord(bundle.contest.data, "contest");
  const draftGroup = unwrapRecord(bundle.draftGroup.data, "draftGroup");
  const rules = unwrapRecord(bundle.gameTypeRules.data, "gameTypeRules");
  const draftables = unwrapRecord(bundle.draftables.data, "draftables");

  const rosterRules = mapRosterRules(rules);
  const playerPool = mapDraftables(draftables, context.contestFormat);
  const slateInput: SlateInput = {
    tenantId: context.tenantId,
    userId: context.userId,
    requestId: context.requestId,
    receivedAt: bundle.contest.retrievedAt,
    sport: context.sport,
    league: context.league,
    event: mapEvent(draftGroup, draftables, context.draftGroupId),
    contest: {
      draftKingsContestId: context.contestId,
      name: readString(contest, ["name", "contestName", "contest_name"], context.contestName),
      format: context.contestFormat,
      lockTime: mapLockTime(draftGroup, contest, context.contestLockTime),
      contestSize: context.contestSizeOverride ?? readOptionalNumber(contest, ["contestSize", "entries", "maxEntries"]),
      userEntryCount: context.userEntryCount,
      maxEntriesAllowed: readOptionalNumber(contest, ["maxEntriesAllowed", "maxEntries", "max_entries"]),
    },
    salaryCap: readRequiredNumber(rules, ["salaryCap", "salary_cap"], "salaryCap", ["maxValue"]),
    rosterRules,
    scoringRules: mapScoringRules(rules, context.sport),
    playerPool: applyVerifiedSlotSalaries(playerPool, rosterRules, context.contestFormat),
    sourceManifest: [
      sourceManifest(bundle.contest, ["contest"], "contest"),
      sourceManifest(bundle.draftGroup, ["event", "contest", "lockTime"], "draftGroup"),
      sourceManifest(bundle.gameTypeRules, ["salaryCap", "rosterRules", "scoringRules"], "gameTypeRules"),
      scoringSourceManifest(context.sport, bundle.gameTypeRules.retrievedAt),
      sourceManifest(bundle.draftables, ["playerPool", "salaries", "eligibility"], "draftables"),
    ],
  };

  return {
    slateInput,
    validatedSlate: normalizeAndValidateSlate(slateInput, now),
    rawResponses: bundle,
  };
}

function applyVerifiedSlotSalaries(players: SlateInput["playerPool"], rosterRules: NonNullable<SlateInput["rosterRules"]>, contestFormat: ContestFormat): SlateInput["playerPool"] {
  if (contestFormat !== "SHOWDOWN") return players;
  const captainMultiplier = rosterRules.slots.CPT?.salaryMultiplier ?? 1.5;
  return players.map((player) => ({
    ...player,
    // DraftKings supplies the base salary and/or slot-specific rows. When a
    // slot-specific value is absent, derive it only from the DraftKings rules
    // response—not from a third-party projection or a UI assumption.
    utilitySalary: player.utilitySalary ?? player.salary,
    captainSalary: player.captainSalary ?? player.salary * captainMultiplier,
  }));
}

function mapEvent(record: JsonRecord, draftables: JsonRecord, fallbackId: string): SlateInput["event"] {
  const competitions = Array.isArray(draftables.competitions) ? draftables.competitions.map(asRecord).filter((value): value is JsonRecord => Boolean(value)) : [];
  const competitionNames = competitions.map((competition) => readOptionalString(competition, ["name", "nameDisplay"])).filter((value): value is string => Boolean(value));
  const participants = readStringArray(record, ["participants", "teams", "competitors"]);
  return {
    eventId: readString(record, ["eventId", "id", "draftGroupId"], fallbackId),
    name: readString(record, ["name", "eventName", "description"], competitionNames[0] ?? "DraftKings event"),
    eventDate: readRequiredString(record, ["eventDate", "startTime", "startDate"], "eventDate", firstCompetitionStart(competitions)),
    participants: participants.length ? participants : competitionNames,
    venue: readOptionalString(record, ["venue", "venueName"]),
  };
}

function firstCompetitionStart(competitions: JsonRecord[]): JsonRecord | undefined {
  const start = competitions.map((competition) => readOptionalString(competition, ["startTime", "startDate", "eventDate"])).find((value): value is string => Boolean(value));
  return start ? { eventDate: start } : undefined;
}

function mapLockTime(draftGroup: JsonRecord, contest: JsonRecord, fallback?: string): string {
  return readOptionalString(draftGroup, ["lockTime", "startTime", "startDate"]) ?? readOptionalString(contest, ["lockTime", "startTime", "startDate"]) ?? fallback ?? (() => { throw new DraftKingsSlateMappingError("Missing required string field: contest.lockTime."); })();
}

function mapRosterRules(record: JsonRecord): NonNullable<SlateInput["rosterRules"]> {
  const rules = asRecord(record.rosterRules) ?? record;
  const template = Array.isArray(rules.lineupTemplate) ? rules.lineupTemplate.map(asRecord).filter((value): value is JsonRecord => Boolean(value)) : [];
  const templateSlots: Array<[string, { count: number; salaryMultiplier?: number; fantasyMultiplier?: number }]> = [];
  for (const item of template) {
    const slot = asRecord(item.rosterSlot);
    const slotName = readString(slot ?? {}, ["name"], "UNKNOWN");
    const existing = templateSlots.find(([name]) => name === slotName);
    const multiplier = readMultiplier(slot ?? {}, ["positionTip", "positionTipSubtext"]);
    if (existing) {
      existing[1].count += 1;
      if (multiplier !== undefined) existing[1].salaryMultiplier = existing[1].fantasyMultiplier = multiplier;
    } else templateSlots.push([slotName, { count: 1, salaryMultiplier: multiplier, fantasyMultiplier: multiplier }]);
  }
  const slotsRecord = asRecord(rules.slots) ?? Object.fromEntries(templateSlots);
  if (!slotsRecord) throw new DraftKingsSlateMappingError("DraftKings game-type rules did not contain a structured slots object.");

  const slots = Object.fromEntries(Object.entries(slotsRecord).map(([slotName, value]) => {
    const slot = asRecord(value);
    if (!slot) throw new DraftKingsSlateMappingError(`Roster slot ${slotName} is not an object.`);
    return [slotName, {
      count: readRequiredNumber(slot, ["count", "数量"], `rosterRules.slots.${slotName}.count`),
      salaryMultiplier: readOptionalNumber(slot, ["salaryMultiplier", "salary_multiplier"]),
      fantasyMultiplier: readOptionalNumber(slot, ["fantasyMultiplier", "fantasy_multiplier"]),
    }];
  }));

  return {
    rosterSize: readOptionalNumber(rules, ["rosterSize", "roster_size"]) ?? template.length,
    slots,
    uniquePlayersRequired: readBoolean(rules, ["uniquePlayersRequired", "unique_players_required"], true),
    teamConstraints: asRecord(rules.teamConstraints) as NonNullable<SlateInput["rosterRules"]["teamConstraints"]> | undefined,
  };
}

function readMultiplier(record: JsonRecord, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== "string") continue;
    const match = value.match(/([0-9]+(?:\.[0-9]+)?)\s*x/i);
    if (match) return Number(match[1]);
  }
  return undefined;
}

function mapScoringRules(record: JsonRecord, sport: Sport): SlateInput["scoringRules"] {
  // The live rules response also contains metadata such as gameTypeName.
  // Only explicitly named scoring containers are eligible; falling back to the
  // entire rules record would incorrectly treat metadata as scoring rules.
  const scoring = asRecord(record.scoringRules) ?? asRecord(record.scoring);
  if (!scoring) return resolveDraftKingsScoringRules(sport).rules;

  const result = Object.fromEntries(Object.entries(scoring).flatMap(([ruleName, value]) => {
    const rule = asRecord(value);
    const numberValue = typeof value === "number" ? value : rule ? readOptionalNumber(rule, ["value", "points"]) : undefined;
    // Ignore descriptive/non-scoring keys inside a scoring container, but do
    // not allow a container with no numeric rules to pass validation.
    return numberValue === undefined ? [] : [[ruleName, { value: numberValue, description: rule ? readOptionalString(rule, ["description", "name"]) : undefined }]];
  }));
  return Object.keys(result).length ? result : resolveDraftKingsScoringRules(sport).rules;
}

function scoringSourceManifest(sport: Sport, receivedAt: string) {
  const resolved = resolveDraftKingsScoringRules(sport);
  return { source: resolved.source.source, receivedAt, fields: Object.keys(resolved.rules), reference: resolved.source.reference, payloadHash: resolved.source.payloadHash };
}

function mapDraftables(record: JsonRecord, contestFormat: ContestFormat): SlateInput["playerPool"] {
  const values = Array.isArray(record.draftables) ? record.draftables : Array.isArray(record.players) ? record.players : undefined;
  if (!values) throw new DraftKingsSlateMappingError("DraftKings draftables response did not contain a draftables or players array.");
  const fppgIds = Array.isArray(record.draftStats)
    ? record.draftStats.map(asRecord).filter((value): value is JsonRecord => Boolean(value)).filter((stat) => readOptionalString(stat, ["abbr", "name"])?.toUpperCase().includes("FPPG") || readOptionalString(stat, ["name"])?.toLowerCase().includes("fantasy points per game")).map((stat) => stat.id).filter((id): id is number => typeof id === "number")
    : [];

  const hasProviderData = values.some((value) => {
    const player = asRecord(value);
    return Boolean(player && ("fppg" in player || "providerFppg" in player || "status" in player || "providerStatus" in player));
  });
  const mapped = values.map((value, index) => {
    const player = asRecord(value);
    if (!player) throw new DraftKingsSlateMappingError(`Draftable at index ${index} is not an object.`);
    const eligibilityValues = readStringArray(player, ["eligibility", "eligiblePositions", "positions"]);
    if (!eligibilityValues.length) eligibilityValues.push(...(readOptionalString(player, ["position"]) ?? "").split(/[\\/,]/).map((value) => value.trim()).filter(Boolean));
    const eligibility = contestFormat === "SHOWDOWN"
      ? { CPT: true, UTIL: true }
      : Object.fromEntries(eligibilityValues.map((slot) => [slot, true]));
    return {
      playerId: readRequiredString(player, ["playerId", "playerDkId", "draftableId", "id"], `playerPool[${index}].playerId`),
      playerName: readRequiredString(player, ["playerName", "displayName", "name"], `playerPool[${index}].playerName`),
      team: readOptionalString(player, ["team", "teamAbbreviation"]),
      opponent: readOptionalString(player, ["opponent", "opponentAbbreviation"]),
      position: readOptionalString(player, ["position"]),
      salary: readRequiredNumber(player, ["salary", "draftKingsSalary"], `playerPool[${index}].salary`),
      captainSalary: readOptionalNumber(player, ["captainSalary", "captain_salary"]),
      utilitySalary: readOptionalNumber(player, ["utilitySalary", "utility_salary"]),
      eligibility,
      providerStatus: readOptionalString(player, ["status", "providerStatus"]),
      providerFppg: readOptionalNumber(player, ["fppg", "providerFppg"]) ?? readDraftStatValue(player, fppgIds),
      imageUrl: readOptionalString(player, ["playerImage160", "playerImage50", "imageUrl", "playerImageUrl"]),
      teamLogoUrl: readOptionalString(player, ["teamImageUrl", "teamLogoUrl"]),
    };
  });
  const normalized = contestFormat === "SHOWDOWN" ? mergeShowdownDraftables(mapped) : mapped;
  // DraftKings can include IL/inactive entries and incomplete draftables in
  // the contest response. They cannot produce a verified projection or a
  // legal recommendation, so remove them before validation/optimization.
  if (!hasProviderData) return normalized;
  return normalized.filter((player) => {
    const unavailable = /\bIL\b|inactive|out|scratched/i.test(player.providerStatus ?? "");
    const projectable = Number.isFinite(player.providerFppg);
    return !unavailable && projectable;
  });
}

function mergeShowdownDraftables(players: SlateInput["playerPool"]): SlateInput["playerPool"] {
  const merged = new Map<string, SlateInput["playerPool"][number]>();
  for (const player of players) {
    const current = merged.get(player.playerId);
    if (!current) {
      merged.set(player.playerId, { ...player, salary: player.utilitySalary ?? player.salary });
      continue;
    }
    const utilitySalary = Math.min(current.utilitySalary ?? current.salary, player.utilitySalary ?? player.salary);
    const captainSalary = Math.max(current.captainSalary ?? current.salary, player.captainSalary ?? player.salary);
    merged.set(player.playerId, { ...current, salary: utilitySalary, utilitySalary, captainSalary });
  }
  return [...merged.values()];
}

function readDraftStatValue(record: JsonRecord, ids: number[]): number | undefined {
  const attributes = Array.isArray(record.draftStatAttributes) ? record.draftStatAttributes.map(asRecord).filter((value): value is JsonRecord => Boolean(value)) : [];
  for (const attribute of attributes) {
    if (typeof attribute.id !== "number" || (ids.length && !ids.includes(attribute.id))) continue;
    const value = readOptionalNumber(attribute, ["value", "sortValue"]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function sourceManifest(response: DraftKingsApiBundle["contest"], fields: string[], name: string) {
  return {
    source: "DRAFTKINGS_API" as const,
    receivedAt: response.retrievedAt,
    fields,
    reference: `${name}:${response.url}`,
    payloadHash: hashPayload(response.data),
  };
}

type JsonRecord = Record<string, unknown>;

function unwrapRecord(value: unknown, name: string): JsonRecord {
  const record = asRecord(value);
  if (!record) throw new DraftKingsSlateMappingError(`DraftKings ${name} response was not a JSON object.`);
  return asRecord(record[name]) ?? asRecord(record[name.toLowerCase()]) ?? record;
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function readString(record: JsonRecord, keys: string[], fallback?: string): string {
  return readOptionalString(record, keys) ?? fallback ?? (() => { throw new DraftKingsSlateMappingError(`Missing required string field: ${keys.join(" / ")}.`); })();
}

function readRequiredString(record: JsonRecord, keys: string[], field: string, fallbackRecord?: JsonRecord): string {
  const value = readOptionalString(record, keys) ?? (fallbackRecord ? readOptionalString(fallbackRecord, keys) : undefined);
  if (value) return value;
  for (const key of keys) {
    const numeric = record[key];
    if (typeof numeric === "number" && Number.isFinite(numeric)) return String(numeric);
  }
  if (fallbackRecord) {
    for (const key of keys) {
      const numeric = fallbackRecord[key];
      if (typeof numeric === "number" && Number.isFinite(numeric)) return String(numeric);
    }
  }
  throw new DraftKingsSlateMappingError(`Missing required string field: ${field}.`);
}

function readOptionalString(record: JsonRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function readStringArray(record: JsonRecord, keys: string[]): string[] {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value.flatMap((item) => typeof item === "string" ? [item] : asRecord(item) ? [readString(asRecord(item)!, ["name", "abbreviation", "displayName"], "")] : []).filter(Boolean);
  }
  return [];
}

function readRequiredNumber(record: JsonRecord, keys: string[], field: string, nestedKeys: string[] = []): number {
  const value = readOptionalNumber(record, keys) ?? nestedKeys.flatMap((nestedKey) => Object.values(record).map(asRecord).filter((value): value is JsonRecord => Boolean(value)).map((nested) => readOptionalNumber(nested, [nestedKey])).filter((value): value is number => value !== undefined))[0];
  if (value === undefined) throw new DraftKingsSlateMappingError(`Missing required numeric field: ${field}.`);
  return value;
}

function readOptionalNumber(record: JsonRecord, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return undefined;
}

function readBoolean(record: JsonRecord, keys: string[], fallback: boolean): boolean {
  for (const key of keys) if (typeof record[key] === "boolean") return record[key] as boolean;
  return fallback;
}

function hashPayload(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
