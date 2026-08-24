import { describe, expect, it } from "vitest";
import { buildSlateFromApiBundle } from "./api-normalizer";
import type { DraftKingsApiBundle } from "./provider";

const retrievedAt = "2026-08-23T16:00:00.000Z";

function bundle(): DraftKingsApiBundle {
  return {
    contest: { status: 200, url: "https://api.test/contest", retrievedAt, data: { name: "WNBA Showdown", contestSize: 1200, maxEntriesAllowed: 20 } },
    draftGroup: { status: 200, url: "https://api.test/draftgroup", retrievedAt, data: { name: "IND at CHI", eventId: "event-1", eventDate: "2026-08-23T23:00:00.000Z", participants: ["IND", "CHI"], lockTime: "2026-08-23T23:00:00.000Z" } },
    gameTypeRules: { status: 200, url: "https://api.test/rules", retrievedAt, data: { salaryCap: 50000, rosterSize: 2, uniquePlayersRequired: true, slots: { CPT: { count: 1, salaryMultiplier: 1.5, fantasyMultiplier: 1.5 }, UTIL: { count: 1 } }, scoringRules: { points: { value: 1 }, rebounds: { value: 1.25 } } } },
    draftables: { status: 200, url: "https://api.test/draftables", retrievedAt, data: { draftables: [{ id: 101, displayName: "Player One", team: "IND", salary: 10000, positions: ["CPT", "UTIL"] }, { id: "p-2", displayName: "Player Two", team: "CHI", salary: 9000, positions: ["CPT", "UTIL"] }] } },
  };
}

describe("DraftKings API Slate normalizer", () => {
  it("builds a validated slate and retains source lineage", () => {
    const result = buildSlateFromApiBundle(bundle(), {
      tenantId: "tenant-1",
      userId: "user-1",
      requestId: "request-1",
      sport: "WNBA",
      league: "WNBA",
      contestId: "contest-1",
      draftGroupId: "group-1",
      gameTypeId: "game-1",
      contestFormat: "SHOWDOWN",
      userEntryCount: 1,
    });

    expect(result.validatedSlate.validation.status).toBe("VALID");
    expect(result.validatedSlate.contest.draftKingsContestId).toBe("contest-1");
    expect(result.validatedSlate.event.participants).toEqual(["IND", "CHI"]);
    expect(result.validatedSlate.playerPool).toHaveLength(2);
    expect(result.validatedSlate.sourceManifest).toHaveLength(5);
    expect(result.validatedSlate.sourceManifest.filter((source) => source.source === "DRAFTKINGS_API")).toHaveLength(4);
    expect(result.validatedSlate.sourceManifest.some((source) => source.source === "DRAFTKINGS_RULES_REGISTRY")).toBe(true);
    expect(result.validatedSlate.sourceManifest.every((source) => Boolean(source.payloadHash))).toBe(true);
    expect(result.rawResponses).toBeDefined();
  });

  it("returns WARNING when contest metadata is not present", () => {
    const raw = bundle();
    raw.contest.data = { name: "WNBA Showdown" };
    const result = buildSlateFromApiBundle(raw, {
      tenantId: "tenant-1",
      userId: "user-1",
      requestId: "request-2",
      sport: "WNBA",
      league: "WNBA",
      contestId: "contest-1",
      draftGroupId: "group-1",
      gameTypeId: "game-1",
      contestFormat: "SHOWDOWN",
      userEntryCount: 1,
    });

    expect(result.validatedSlate.validation.status).toBe("WARNING");
    expect(result.validatedSlate.validation.errors).toEqual([]);
    expect(result.validatedSlate.validation.warnings).toHaveLength(2);
  });

  it("uses the verified scoring registry when game-type metadata omits scoring rules", () => {
    const raw = bundle();
    raw.gameTypeRules.data = {
      gameTypeName: "Classic",
      salaryCap: { maxValue: 50000 },
      lineupTemplate: [{ rosterSlot: { name: "UTIL" } }],
    };

    const result = buildSlateFromApiBundle(raw, {
      tenantId: "tenant-1",
      userId: "user-1",
      requestId: "request-3",
      sport: "MLB",
      league: "MLB",
      contestId: "contest-1",
      draftGroupId: "group-1",
      gameTypeId: "game-1",
      contestFormat: "CLASSIC",
      userEntryCount: 1,
    });
    expect(result.validatedSlate.scoringRules.single.value).toBe(3);
    expect(result.validatedSlate.sourceManifest.some((source) => source.source === "DRAFTKINGS_RULES_REGISTRY")).toBe(true);
  });

  it("uses the user field-size override in the validated slate", () => {
    const result = buildSlateFromApiBundle(bundle(), {
      tenantId: "tenant-1",
      userId: "user-1",
      requestId: "request-4",
      sport: "WNBA",
      league: "WNBA",
      contestId: "contest-1",
      draftGroupId: "group-1",
      gameTypeId: "game-1",
      contestFormat: "SHOWDOWN",
      userEntryCount: 1,
      contestSizeOverride: 713,
    });

    expect(result.validatedSlate.contest.contestSize).toBe(713);
  });

  it("merges DraftKings showdown captain and utility rows by player", () => {
    const raw = bundle();
    raw.draftables.data = {
      draftables: [
        { draftableId: "captain-row", playerId: "player-1", displayName: "Player One", team: "IND", salary: 15000, positions: ["CPT"] },
        { draftableId: "utility-row", playerId: "player-1", displayName: "Player One", team: "IND", salary: 10000, positions: ["UTIL"] },
      ],
    };
    const result = buildSlateFromApiBundle(raw, {
      tenantId: "tenant-1",
      userId: "user-1",
      requestId: "request-5",
      sport: "WNBA",
      league: "WNBA",
      contestId: "contest-1",
      draftGroupId: "group-1",
      gameTypeId: "game-1",
      contestFormat: "SHOWDOWN",
      userEntryCount: 1,
    });

    expect(result.validatedSlate.playerPool).toHaveLength(1);
    expect(result.validatedSlate.playerPool[0]).toMatchObject({ playerId: "player-1", salary: 10000, utilitySalary: 10000, captainSalary: 15000 });
  });
});
