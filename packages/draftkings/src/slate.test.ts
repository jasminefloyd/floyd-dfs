import { describe, expect, it } from "vitest";
import type { SlateInput } from "@sports-engine/contracts";
import { normalizeAndValidateSlate, validateSlate } from "./slate";

function validInput(overrides: Partial<SlateInput> = {}): SlateInput {
  return {
    tenantId: "tenant-1",
    userId: "user-1",
    requestId: "request-1",
    receivedAt: "2026-08-23T16:00:00.000Z",
    sport: "WNBA",
    league: "WNBA",
    event: {
      eventId: "event-1",
      name: "Indiana Fever at Chicago Sky",
      eventDate: "2026-08-23T23:00:00.000Z",
      participants: ["IND", "CHI"],
    },
    contest: {
      draftKingsContestId: "dk-1",
      name: "WNBA Showdown",
      format: "SHOWDOWN",
      lockTime: "2026-08-23T23:00:00.000Z",
      userEntryCount: 1,
      contestSize: 1200,
      maxEntriesAllowed: 20,
    },
    salaryCap: 50000,
    rosterRules: {
      rosterSize: 2,
      slots: {
        CPT: { count: 1, salaryMultiplier: 1.5, fantasyMultiplier: 1.5 },
        UTIL: { count: 1 },
      },
      uniquePlayersRequired: true,
    },
    scoringRules: {
      points: { value: 1 },
      rebounds: { value: 1.25 },
      turnovers: { value: -0.5 },
    },
    playerPool: [
      { playerId: "p-1", playerName: "Player One", team: "IND", salary: 10000, eligibility: { CPT: true, UTIL: true } },
      { playerId: "p-2", playerName: "Player Two", team: "CHI", salary: 9000, eligibility: { CPT: true, UTIL: true } },
    ],
    sourceManifest: [{ source: "DRAFTKINGS_API", receivedAt: "2026-08-23T16:00:00.000Z", fields: ["contest", "playerPool"] }],
    ...overrides,
  };
}

describe("Slate validation", () => {
  it("returns VALID when required data is complete", () => {
    expect(validateSlate(validInput())).toEqual({ status: "VALID", warnings: [], errors: [] });
  });

  it("returns WARNING when contest size or max entries are unavailable", () => {
    const input = validInput({ contest: { ...validInput().contest, contestSize: undefined, maxEntriesAllowed: undefined } });
    const result = validateSlate(input);

    expect(result.status).toBe("WARNING");
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(2);
  });

  it("blocks invalid entry counts instead of guessing", () => {
    const input = validInput({ contest: { ...validInput().contest, userEntryCount: 21 } });
    const result = validateSlate(input);

    expect(result.status).toBe("BLOCKED");
    expect(result.errors).toContain("contest.userEntryCount cannot exceed contest.maxEntriesAllowed.");
  });

  it("blocks duplicate player IDs", () => {
    const input = validInput({
      playerPool: [validInput().playerPool[0], { ...validInput().playerPool[0], playerName: "Duplicate" }],
      sourceManifest: [{ source: "DRAFTKINGS_API", receivedAt: "2026-08-23T16:00:00.000Z", fields: ["contest"] }, { source: "DRAFTKINGS_RSS", receivedAt: "2026-08-23T16:01:00.000Z", fields: ["playerPool"] }],
    });
    const result = validateSlate(input);

    expect(result.status).toBe("BLOCKED");
    expect(result.errors).toContain("playerPool playerId values must be unique.");
  });

  it("creates a stable version-one slate ID and preserves validation metadata", () => {
    const now = new Date("2026-08-23T16:05:00.000Z");
    const result = normalizeAndValidateSlate(validInput(), now);

    expect(result.slateId).toHaveLength(32);
    expect(result.version).toBe(1);
    expect(result.createdAt).toBe(now.toISOString());
    expect(result.validation.status).toBe("VALID");
  });
});
