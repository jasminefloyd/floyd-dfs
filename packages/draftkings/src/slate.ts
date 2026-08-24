import { createHash } from "node:crypto";
import type {
  RosterRules,
  ScoringRules,
  SlateInput,
  SlatePlayer,
  SourceManifestItem,
  ValidatedSlate,
} from "@sports-engine/contracts";
import type { DraftKingsSlatePayload } from "./provider";

export interface SlateValidationResult {
  status: ValidatedSlate["validation"]["status"];
  warnings: string[];
  errors: string[];
}

export interface DraftKingsSlateRecord {
  tenantId: string;
  userId: string;
  requestId: string;
  receivedAt: string;
  sport: SlateInput["sport"];
  league: string;
  event: SlateInput["event"];
  contest: SlateInput["contest"];
  salaryCap: number;
  rosterRules: RosterRules;
  scoringRules: ScoringRules;
  playerPool: SlatePlayer[];
  sourceManifest: SourceManifestItem[];
}

export function createSlateInput(payload: DraftKingsSlatePayload, record: Omit<DraftKingsSlateRecord, "sourceManifest" | "receivedAt">): SlateInput {
  return {
    ...record,
    receivedAt: payload.receivedAt,
    sourceManifest: [
      {
        source: payload.source,
        receivedAt: payload.receivedAt,
        fields: ["contest", "event", "salaryCap", "rosterRules", "scoringRules", "playerPool"],
      },
    ],
  };
}

export function validateSlate(input: SlateInput): SlateValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  requireText(input.tenantId, "tenantId", errors);
  requireText(input.userId, "userId", errors);
  requireText(input.requestId, "requestId", errors);
  requireText(input.league, "league", errors);
  requireText(input.event.eventId, "event.eventId", errors);
  requireText(input.event.name, "event.name", errors);
  requireText(input.contest.draftKingsContestId, "contest.draftKingsContestId", errors);
  requireText(input.contest.name, "contest.name", errors);

  if (!isValidDate(input.receivedAt)) errors.push("receivedAt must be a valid ISO timestamp.");
  if (!isValidDate(input.event.eventDate)) errors.push("event.eventDate must be a valid ISO timestamp.");
  if (!isValidDate(input.contest.lockTime)) errors.push("contest.lockTime must be a valid ISO timestamp.");

  if (!Number.isFinite(input.salaryCap) || input.salaryCap <= 0) errors.push("salaryCap must be greater than zero.");
  if (!Number.isInteger(input.contest.userEntryCount) || input.contest.userEntryCount <= 0) {
    errors.push("contest.userEntryCount must be a positive integer.");
  }

  if (input.contest.contestSize === undefined) {
    warnings.push("contest.contestSize is unavailable and was not independently verified.");
  } else if (!isPositiveInteger(input.contest.contestSize)) {
    errors.push("contest.contestSize must be a positive integer when provided.");
  }

  if (input.contest.maxEntriesAllowed === undefined) {
    warnings.push("contest.maxEntriesAllowed is unavailable and was not independently verified.");
  } else if (!isPositiveInteger(input.contest.maxEntriesAllowed)) {
    errors.push("contest.maxEntriesAllowed must be a positive integer when provided.");
  } else if (input.contest.userEntryCount > input.contest.maxEntriesAllowed) {
    errors.push("contest.userEntryCount cannot exceed contest.maxEntriesAllowed.");
  }

  validateEvent(input, errors);
  validateRosterRules(input.rosterRules, input.salaryCap, errors);
  validateScoringRules(input.scoringRules, errors);
  validatePlayerPool(input.playerPool, input.rosterRules, errors);
  validateSources(input.sourceManifest, errors);

  const status = errors.length > 0 ? "BLOCKED" : warnings.length > 0 ? "WARNING" : "VALID";
  return { status, warnings, errors };
}

export function normalizeAndValidateSlate(input: SlateInput, now = new Date()): ValidatedSlate {
  const validation = validateSlate(input);
  const createdAt = now.toISOString();
  const slateId = createSlateId(input);

  return {
    ...input,
    slateId,
    version: 1,
    validation,
    createdAt,
  };
}

function validateEvent(input: SlateInput, errors: string[]): void {
  if (!input.event.participants.length) errors.push("event.participants must contain at least one participant.");
  if (new Set(input.event.participants).size !== input.event.participants.length) {
    errors.push("event.participants must not contain duplicates.");
  }
  if (!input.event.participants.every((participant) => participant.trim().length > 0)) {
    errors.push("event.participants must contain non-empty names.");
  }
}

function validateRosterRules(rules: RosterRules, salaryCap: number, errors: string[]): void {
  if (!Number.isInteger(rules.rosterSize) || rules.rosterSize <= 0) {
    errors.push("rosterRules.rosterSize must be a positive integer.");
  }

  const slotCount = Object.values(rules.slots).reduce((sum, slot) => sum + slot.count, 0);
  if (slotCount !== rules.rosterSize) errors.push("rosterRules slot counts must equal rosterSize.");
  if (!Object.keys(rules.slots).length) errors.push("rosterRules.slots must not be empty.");

  for (const [slotName, slot] of Object.entries(rules.slots)) {
    if (!Number.isInteger(slot.count) || slot.count <= 0) errors.push(`rosterRules.slots.${slotName}.count must be a positive integer.`);
    for (const [multiplierName, multiplier] of [["salaryMultiplier", slot.salaryMultiplier], ["fantasyMultiplier", slot.fantasyMultiplier]] as const) {
      if (multiplier !== undefined && (!Number.isFinite(multiplier) || multiplier <= 0)) {
        errors.push(`rosterRules.slots.${slotName}.${multiplierName} must be greater than zero.`);
      }
    }
  }

  if (rules.teamConstraints?.minimumTeams !== undefined && (!Number.isInteger(rules.teamConstraints.minimumTeams) || rules.teamConstraints.minimumTeams <= 0)) {
    errors.push("rosterRules.teamConstraints.minimumTeams must be a positive integer.");
  }
  if (!Number.isFinite(salaryCap) || salaryCap <= 0) errors.push("salaryCap must be present before roster validation.");
}

function validateScoringRules(rules: ScoringRules, errors: string[]): void {
  if (!Object.keys(rules).length) {
    errors.push("scoringRules must not be empty.");
    return;
  }
  for (const [ruleName, rule] of Object.entries(rules)) {
    if (!Number.isFinite(rule.value)) errors.push(`scoringRules.${ruleName}.value must be numeric.`);
  }
}

function validatePlayerPool(players: SlatePlayer[], rosterRules: RosterRules, errors: string[]): void {
  if (!players.length) errors.push("playerPool must contain at least one player.");

  const ids = players.map((player) => player.playerId);
  if (ids.some((id) => !id.trim())) errors.push("playerPool players must have non-empty playerId values.");
  if (new Set(ids).size !== ids.length) errors.push("playerPool playerId values must be unique.");

  for (const player of players) {
    if (!player.playerName.trim()) errors.push(`Player ${player.playerId || "<unknown>"} must have a playerName.`);
    if (!Number.isInteger(player.salary) || player.salary <= 0) errors.push(`Player ${player.playerId || "<unknown>"} must have a positive integer salary.`);
    if (!Object.keys(player.eligibility).length) errors.push(`Player ${player.playerId || "<unknown>"} must have eligibility.`);
    for (const slotName of Object.keys(player.eligibility)) {
      if (!(slotName in rosterRules.slots)) errors.push(`Player ${player.playerId || "<unknown>"} has unsupported roster eligibility: ${slotName}.`);
    }
    for (const [salaryName, salary] of [["captainSalary", player.captainSalary], ["utilitySalary", player.utilitySalary]] as const) {
      if (salary !== undefined && (!Number.isInteger(salary) || salary <= 0)) errors.push(`Player ${player.playerId || "<unknown>"}.${salaryName} must be a positive integer.`);
    }
  }
}

function validateSources(sources: SourceManifestItem[], errors: string[]): void {
  if (!sources.length) {
    errors.push("sourceManifest must contain at least one trusted DraftKings source.");
    return;
  }
  for (const source of sources) {
    if (source.source !== "DRAFTKINGS_API" && source.source !== "DRAFTKINGS_RSS" && source.source !== "DRAFTKINGS_RULES_REGISTRY") {
      errors.push("sourceManifest contains an unsupported source type.");
    }
    if (!isValidDate(source.receivedAt)) errors.push("sourceManifest.receivedAt values must be valid ISO timestamps.");
    if (!source.fields.length) errors.push("sourceManifest fields must not be empty.");
  }
}

function createSlateId(input: SlateInput): string {
  return createHash("sha256")
    .update(`${input.tenantId}:${input.requestId}:${input.contest.draftKingsContestId}`)
    .digest("hex")
    .slice(0, 32);
}

function requireText(value: string | undefined, field: string, errors: string[]): void {
  if (!value?.trim()) errors.push(`${field} is required.`);
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function isValidDate(value: string): boolean {
  return Boolean(value) && !Number.isNaN(Date.parse(value));
}
