import { describe, expect, it } from "vitest";
import { extractContestMetadata, extractContestReference, extractContestSummaries } from "./contest-adapter";

describe("DraftKings contest adapter", () => {
  it("maps contest discovery records without making contest judgments", () => {
    const result = extractContestSummaries({ Contests: [{ contestId: "c-1", name: "NBA Showdown", format: "Showdown", lockTime: "2026-08-23T23:00:00.000Z", totalEntries: 2500, maxEntries: 20 }] }, "NBA");

    expect(result).toEqual([{ draftKingsContestId: "c-1", sport: "NBA", format: "SHOWDOWN", name: "NBA Showdown", lockTime: "2026-08-23T23:00:00.000Z", contestSize: 2500, maxEntriesAllowed: 20 }]);
  });

  it("resolves the Draft Group and Game Type references", () => {
    expect(extractContestReference({ contest: { draftGroupId: "dg-1", gameTypeId: "gt-1" } }, "c-1")).toEqual({ contestId: "c-1", draftGroupId: "dg-1", gameTypeId: "gt-1" });
  });

  it("reads field size from a contest detail response", () => {
    expect(extractContestMetadata({ Contest: { entryCount: "713", maximumEntries: 20 } })).toEqual({ contestSize: 713, maxEntriesAllowed: 20 });
  });

  it("maps DraftKings contest-detail capacity and per-user limits", () => {
    expect(extractContestMetadata({ contestDetail: { entries: 35, maximumEntries: 37, maximumEntriesPerUser: 1 } })).toEqual({ contestSize: 37, maxEntriesAllowed: 1 });
  });

  it("rejects unsupported contest formats instead of coercing them", () => {
    expect(() => extractContestSummaries({ Contests: [{ contestId: "c-1", name: "Unknown", format: "Unknown", lockTime: "2026-08-23T23:00:00.000Z" }] }, "MLB")).toThrow("Unsupported DraftKings contest format");
  });
});
