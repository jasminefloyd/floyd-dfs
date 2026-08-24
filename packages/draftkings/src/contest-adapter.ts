import type { DraftKingsContestSummary } from "./provider";
import type { Sport } from "@sports-engine/contracts";

export interface DraftKingsContestReference {
  contestId: string;
  draftGroupId: string;
  gameTypeId: string;
}

export class DraftKingsContestMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftKingsContestMappingError";
  }
}

export function extractContestSummaries(payload: unknown, sport: Sport): DraftKingsContestSummary[] {
  const record = asRecord(payload);
  const contests = record && (Array.isArray(record.Contests) ? record.Contests : Array.isArray(record.contests) ? record.contests : undefined);
  if (!contests) throw new DraftKingsContestMappingError("DraftKings contest discovery response did not contain a Contests array.");

  let unsupportedError: unknown;
  const mapped = contests.flatMap((value, index) => {
    const contest = asRecord(value);
    if (!contest) throw new DraftKingsContestMappingError(`Contest at index ${index} is not an object.`);
    const contestId = readRequiredString(contest, ["contestId", "contestID", "id", "ContestId"], `contests[${index}].contestId`);
    const gameType = readString(contest, ["format", "contestFormat", "gameTypeName", "gameType"], "CLASSIC");
    let format: DraftKingsContestSummary["format"];
    try { format = parseContestFormat(gameType); } catch (error) { unsupportedError ??= error; return []; }
    return [{
      draftKingsContestId: contestId,
      sport,
      format,
      name: readRequiredString(contest, ["name", "contestName", "ContestName", "n"], `contests[${index}].name`),
      lockTime: readDateString(contest, ["lockTime", "startTime", "startDate", "sd"], `contests[${index}].lockTime`),
      contestSize: readOptionalNumber(contest, ["contestSize", "totalEntries", "entryCount", "ec"]),
      maxEntriesAllowed: readOptionalNumber(contest, ["maxEntriesAllowed", "maxEntries", "maximumEntries", "mec"]),
    }];
  });
  // A live lobby can legitimately contain only contest types outside this app's
  // supported Classic/Showdown scope. Preserve strict rejection for the
  // single-record adapter contract, while treating a multi-record lobby as a
  // supported-contest filter operation.
  if (!mapped.length && unsupportedError && contests.length === 1) throw unsupportedError;
  return mapped;
}

export function extractContestMetadata(payload: unknown): Pick<DraftKingsContestSummary, "contestSize" | "maxEntriesAllowed"> {
  const root = asRecord(payload);
  const contest = root ? asRecord(root.contest) ?? asRecord(root.Contest) ?? asRecord(root.contestDetail) ?? asRecord(root.ContestDetail) ?? root : undefined;
  const contestSize = contest
    ? readOptionalNumber(contest, ["contestSize", "totalEntries", "entryCount", "ec"]) ?? readOptionalNumber(contest, ["maxEntries", "maximumEntries", "entries"])
    : undefined;
  const maxEntriesAllowed = contest
    ? readOptionalNumber(contest, ["maxEntriesAllowed", "maxEntriesPerUser", "maximumEntriesPerUser", "mec"]) ?? readOptionalNumber(contest, ["maxEntries", "maximumEntries"])
    : undefined;
  return {
    contestSize,
    maxEntriesAllowed,
  };
}

export function extractContestReference(payload: unknown, contestId: string): DraftKingsContestReference {
  const root = asRecord(payload);
  const contest = root ? asRecord(root.contest) ?? asRecord(root.Contest) ?? asRecord(root.contestDetail) ?? asRecord(root.ContestDetail) ?? root : undefined;
  if (!contest) throw new DraftKingsContestMappingError("DraftKings contest response was not a JSON object.");

  return {
    contestId,
    draftGroupId: readRequiredString(contest, ["draftGroupId", "draftGroupID", "draftGroup", "dg"], "draftGroupId"),
    gameTypeId: readRequiredString(contest, ["gameTypeId", "gameTypeID", "gameType", "gt"], "gameTypeId"),
  };
}

function parseContestFormat(value: string): "SHOWDOWN" | "CLASSIC" {
  const normalized = value.toUpperCase();
  if (normalized.includes("SHOWDOWN") || normalized.includes("CAPTAIN") || normalized.includes("MVP")) return "SHOWDOWN";
  if (normalized.includes("CLASSIC")) return "CLASSIC";
  throw new DraftKingsContestMappingError(`Unsupported DraftKings contest format: ${value}.`);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readString(record: Record<string, unknown>, keys: string[], fallback?: string): string {
  return readOptionalString(record, keys) ?? fallback ?? (() => { throw new DraftKingsContestMappingError(`Missing required field: ${keys.join(" / ")}.`); })();
}

function readRequiredString(record: Record<string, unknown>, keys: string[], field: string): string {
  return readOptionalString(record, keys) ?? readNumericIdentifier(record, keys) ?? (() => { throw new DraftKingsContestMappingError(`Missing required field: ${field}.`); })();
}

function readNumericIdentifier(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function readDateString(record: Record<string, unknown>, keys: string[], field: string): string {
  const value = readOptionalString(record, keys);
  if (value) {
    const dotNet = value.match(/^\/Date\((\d+)\)\/$/);
    if (dotNet) return new Date(Number(dotNet[1])).toISOString();
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  throw new DraftKingsContestMappingError(`Missing required date field: ${field}.`);
}

function readOptionalString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) if (typeof record[key] === "string" && (record[key] as string).trim()) return (record[key] as string).trim();
  return undefined;
}

function readOptionalNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return undefined;
}
