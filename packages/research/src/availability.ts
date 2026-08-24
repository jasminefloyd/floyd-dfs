import type { SlatePlayer, Sport, ValidatedSlate } from "@sports-engine/contracts";
import type { SportsDataIoClient } from "./sportsdataio-provider";

type JsonRecord = Record<string, unknown>;

export interface AvailabilitySnapshot {
  source: string;
  retrievedAt: string;
  records: AvailabilityRecord[];
  confirmedLineupAvailable: boolean;
  note?: string;
}

export interface AvailabilityRecord {
  playerName: string;
  team?: string;
  providerPlayerId?: string;
  status: NonNullable<SlatePlayer["availability"]>["status"];
  confirmed: boolean;
  battingOrder?: number;
  updatedAt?: string;
  note?: string;
}

/**
 * Applies only explicit provider availability to a DraftKings player pool.
 * DraftKings remains the source of identity and price; unmapped records are
 * intentionally left UNKNOWN rather than guessed into a player.
 */
export function applyAvailabilitySnapshot(slate: ValidatedSlate, snapshot: AvailabilitySnapshot): ValidatedSlate {
  const byKey = new Map<string, AvailabilityRecord[]>();
  for (const record of snapshot.records) {
    const key = identityKey(record.playerName, record.team);
    byKey.set(key, [...(byKey.get(key) ?? []), record]);
  }

  const warnings = [...slate.validation.warnings];
  const playerPool = slate.playerPool.map((player) => {
    const records = byKey.get(identityKey(player.playerName, player.team)) ?? [];
    if (records.length !== 1) {
      return {
        ...player,
        availability: {
          status: "UNKNOWN" as const,
          confirmed: false,
          source: snapshot.source,
          retrievedAt: snapshot.retrievedAt,
          mappedBy: "UNMAPPED" as const,
          note: records.length > 1 ? "Provider identity match was ambiguous." : snapshot.note ?? "Provider returned no exact name/team match.",
        },
      };
    }
    const record = records[0];
    return {
      ...player,
      availability: {
        status: record.status,
        confirmed: record.confirmed,
        source: snapshot.source,
        retrievedAt: snapshot.retrievedAt,
        providerPlayerId: record.providerPlayerId,
        mappedBy: "NAME_AND_TEAM" as const,
        note: record.note ?? (record.battingOrder ? `Batting order ${record.battingOrder}.` : undefined),
      },
    };
  });

  const removed = playerPool.filter((player) => player.availability?.status === "OUT" || player.availability?.status === "INACTIVE").length;
  // We remove only explicit OUT/INACTIVE records. For MLB, once a confirmed
  // lineup exists, non-starters are not eligible for a recommendation.
  const filtered = slate.sport === "MLB" && snapshot.confirmedLineupAvailable
    ? playerPool.filter((player) => {
      const status = player.availability?.status;
      // A confirmed MLB feed is authoritative for the recommendation pool.
      // Unknown means the DK identity could not be verified against that feed,
      // so it is excluded rather than silently treated as a starter.
      return status === "CONFIRMED_STARTER" || status === "ACTIVE";
    })
    : playerPool;
  if (removed) warnings.push(`${removed} DraftKings player(s) removed after an explicit ${snapshot.source} OUT/INACTIVE status.`);
  if (snapshot.confirmedLineupAvailable) warnings.push(`${snapshot.source} confirmed lineup state applied at ${snapshot.retrievedAt}.`);
  else warnings.push(`${snapshot.source} did not provide a confirmed pregame lineup; unconfirmed players remain labeled UNKNOWN.`);

  return {
    ...slate,
    playerPool: filtered,
    sourceManifest: [...slate.sourceManifest, {
      source: "SPORTSDATAIO",
      receivedAt: snapshot.retrievedAt,
      fields: ["playerName", "team", "providerPlayerId", "status", "confirmed", "retrievedAt"],
      reference: snapshot.note ?? "availability snapshot",
    }],
    validation: { ...slate.validation, warnings },
  };
}

export async function refreshSlateAvailability(client: SportsDataIoClient, slate: ValidatedSlate, signal?: AbortSignal): Promise<ValidatedSlate> {
  const snapshot = await client.getAvailabilitySnapshot(slate, signal);
  return applyAvailabilitySnapshot(slate, snapshot);
}

export function normalizeProviderName(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function identityKey(name: string, team?: string): string { return `${normalizeProviderName(name)}|${normalizeProviderName(team ?? "")}`; }

export function parseAvailabilityRecords(payload: unknown, sport: Sport, retrievedAt: string): AvailabilitySnapshot {
  const rows = Array.isArray(payload) ? payload : [];
  const records = rows.flatMap((value) => {
    const row = asRecord(value);
    if (!row) return [];
    const name = readString(row, ["Name", "PlayerName", "FullName", "name", "playerName"]);
    if (!name) return [];
    const team = readString(row, ["Team", "team", "TeamAbbreviation"]);
    const confirmed = readBoolean(row, ["Confirmed", "BattingOrderConfirmed", "confirmed"]);
    const available = readBoolean(row, ["Available", "available"]);
    const state = readString(row, ["Status", "InjuryStatus", "LineupStatus", "status"]) ?? "";
    const inactive = /inactive|out|scratched|doubtful/i.test(state);
    const battingOrder = readNumber(row, ["BattingOrder", "battingOrder"]);
    const status: AvailabilityRecord["status"] = inactive ? (/(out|scratched|doubtful)/i.test(state) ? "OUT" : "INACTIVE")
      : sport === "MLB" && confirmed && battingOrder !== undefined ? "CONFIRMED_STARTER"
        : confirmed ? "ACTIVE" : available === false ? "INACTIVE" : "PROJECTED";
    return [{ playerName: name, team, providerPlayerId: readString(row, ["PlayerID", "PlayerId", "playerId"]), status, confirmed, battingOrder, updatedAt: readString(row, ["Updated", "DateTime", "updatedAt"]) }];
  });
  return { source: "SPORTSDATAIO", retrievedAt, records, confirmedLineupAvailable: sport === "MLB" && records.some((record) => record.confirmed && record.battingOrder !== undefined) };
}

function asRecord(value: unknown): JsonRecord | undefined { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined; }
function readString(record: JsonRecord, keys: string[]): string | undefined { for (const key of keys) if (typeof record[key] === "string" && String(record[key]).trim()) return String(record[key]).trim(); return undefined; }
function readNumber(record: JsonRecord, keys: string[]): number | undefined { for (const key of keys) { const value = record[key]; if (typeof value === "number" && Number.isFinite(value)) return value; if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value); } return undefined; }
function readBoolean(record: JsonRecord, keys: string[]): boolean { for (const key of keys) { if (typeof record[key] === "boolean") return record[key] as boolean; if (record[key] === 1 || record[key] === "1" || String(record[key]).toLowerCase() === "true") return true; } return false; }
