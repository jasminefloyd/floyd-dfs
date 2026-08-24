import { describe, expect, it, vi } from "vitest";
import { SportsDataIoClient } from "./sportsdataio-provider";

describe("SportsDataIO client", () => {
  it("uses the documented league URL pattern and subscription header", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify([{ GameKey: "g1" }]), { status: 200 }));
    const client = new SportsDataIoClient({ apiKey: "test-key", fetcher });
    await client.get("WNBA", "scores", "GamesByDate", "2026-08-24");
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.sportsdata.io/v3/wnba/scores/json/GamesByDate/2026-08-24",
      expect.objectContaining({ headers: expect.objectContaining({ "Ocp-Apim-Subscription-Key": "test-key" }) }),
    );
  });

  it("reports subscription access failures clearly", async () => {
    const client = new SportsDataIoClient({ apiKey: "test-key", fetcher: async () => new Response("forbidden", { status: 403 }) });
    await expect(client.get("NFL", "scores", "GamesByDate", "2026-08-24")).rejects.toThrow("subscription feed permissions");
  });
});
