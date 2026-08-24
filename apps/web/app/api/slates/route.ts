import { DraftKingsApiClient, type DraftKingsContestSummary } from "@sports-engine/draftkings";
import type { Sport } from "@sports-engine/contracts";
import { authErrorResponse, publicTenantContext } from "../../../lib/server-auth";

const SPORTS: Sport[] = ["NBA", "WNBA", "NFL", "MLB", "GOLF"];

export async function GET(request: Request) {
  try {
    await publicTenantContext();
    const url = new URL(request.url);
    const requestedSport = (url.searchParams.get("sport") ?? "NBA").toUpperCase() as Sport;
    if (!SPORTS.includes(requestedSport)) return Response.json({ error: `Unsupported sport: ${requestedSport}.` }, { status: 400 });
    const format = (url.searchParams.get("format") ?? "CLASSIC").toUpperCase();

    const discovery = new DraftKingsApiClient({ sportCodes: {} });
    const available = await discovery.listSports();
    const match = available.find((item) => item.abbreviatedName.toUpperCase() === requestedSport);
    const fallback = requestedSport === "WNBA" ? available.find((item) => item.abbreviatedName.toUpperCase() === "NBA") : undefined;
    const lobbySport = match ?? fallback;
    if (!lobbySport) return Response.json({ sport: requestedSport, format, contests: [], warning: `DraftKings did not return an enabled ${requestedSport} sport in the live sports response.` });
    const client = new DraftKingsApiClient({ sportCodes: { [lobbySport.abbreviatedName as Sport]: lobbySport.abbreviatedName } as Partial<Record<Sport, string>> });
    const now = new Date();
    const horizon = endOfCalendarDay(addCalendarDays(now, 3));
    const contests = (await client.listContests(lobbySport.abbreviatedName as Sport)).filter((contest) => contest.format === format && contestSportMatches(contest.name, requestedSport) && Date.parse(contest.lockTime) >= now.getTime() && Date.parse(contest.lockTime) <= horizon.getTime()).sort((a, b) => Date.parse(a.lockTime) - Date.parse(b.lockTime));
    return Response.json({ sport: requestedSport, format, contests: serializeContests(contests, requestedSport), source: "DraftKings lobby API", retrievedAt: now.toISOString(), windowDays: 3 });
  } catch (error) { return authErrorResponse(error); }
}

function serializeContests(contests: DraftKingsContestSummary[], sport: Sport) {
  return contests.map((contest) => ({ id: contest.draftKingsContestId, name: contest.name, sport, format: contest.format, lockTime: contest.lockTime, contestSize: contest.contestSize, maxEntriesAllowed: contest.maxEntriesAllowed, matchup: parseMatchup(contest.name) }));
}

function contestSportMatches(name: string, sport: Sport): boolean {
  return new RegExp(`^${sport}\\b`, "i").test(name);
}

function parseMatchup(name: string): { away: string; home: string } | null {
  const match = name.match(/\(([^)]+)\)/);
  const matchup = match?.[1].match(/([A-Z0-9]{2,4})\s*@\s*([A-Z0-9]{2,4})/i);
  return matchup ? { away: matchup[1].toUpperCase(), home: matchup[2].toUpperCase() } : null;
}

function addCalendarDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function endOfCalendarDay(date: Date): Date {
  date.setHours(23, 59, 59, 999);
  return date;
}
