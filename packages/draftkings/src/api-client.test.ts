import { describe, expect, it } from "vitest";
import { DraftKingsApiClient, DraftKingsApiError } from "./api-client";

function response(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) } as Response;
}

describe("DraftKingsApiClient", () => {
  it("builds the documented API request sequence", async () => {
    const calls: string[] = [];
    const client = new DraftKingsApiClient({
      apiBaseUrl: "https://api.test",
      lobbyBaseUrl: "https://lobby.test",
      sportCodes: { WNBA: "WNBA" },
      fetcher: async (input) => {
        calls.push(String(input));
        return response({ ok: true });
      },
    });

    await client.getContestLobby("WNBA");
    await client.getSlateBundle({ contestId: "contest-1", draftGroupId: "group-1", gameTypeId: "game-1" });

    expect(calls).toEqual([
      "https://lobby.test/lobby/getcontests?sport=WNBA",
      "https://api.test/contests/v1/contests/contest-1?format=json",
      "https://api.test/draftgroups/v1/group-1",
      "https://api.test/lineups/v1/gametypes/game-1/rules",
      "https://api.test/draftgroups/v1/draftgroups/group-1/draftables",
    ]);
  });

  it("reads the live sports directory without hardcoding unavailable sports", async () => {
    const client = new DraftKingsApiClient({
      apiBaseUrl: "https://api.test",
      sportCodes: {},
      fetcher: async () => response({ sports: [{ sportId: 4, fullName: "Basketball", regionAbbreviatedSportName: "NBA", hasPublicContests: true, isEnabled: true }] }),
    });

    await expect(client.listSports()).resolves.toEqual([{ sportId: 4, fullName: "Basketball", abbreviatedName: "NBA", hasPublicContests: true, isEnabled: true }]);
  });

  it("fails explicitly when a sport code is not configured", async () => {
    const client = new DraftKingsApiClient({ sportCodes: {} });

    await expect(client.getContestLobby("NBA")).rejects.toMatchObject({
      name: "DraftKingsApiError",
      message: "No DraftKings sport code configured for NBA.",
    });
  });

  it("preserves HTTP failure details", async () => {
    const client = new DraftKingsApiClient({
      sportCodes: { NBA: "NBA" },
      fetcher: async () => response({ error: "unavailable" }, 503),
    });

    await expect(client.getContest("contest-1")).rejects.toBeInstanceOf(DraftKingsApiError);
  });
});
