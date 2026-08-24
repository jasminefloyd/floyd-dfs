import { createHash } from "node:crypto";
import type { ScoringRules, Sport } from "@sports-engine/contracts";

export interface DraftKingsScoringSource {
  source: "DRAFTKINGS_RULES_REGISTRY";
  reference: string;
  payloadHash: string;
}

type ScoringEntry = [string, number, string];

// DraftKings publishes these fantasy-point formulas separately from the live
// game-type rules endpoint. Values are kept explicit and source-linked; they
// are not inferred from gameTypeName or glossary metadata.
const SOURCES: Record<Sport, string> = {
  NBA: "https://pick6.draftkings.com/pick6-rules-and-scoring-nba",
  WNBA: "https://pick6.draftkings.com/pick6-rules-and-scoring-wnba",
  NFL: "https://dknetwork.draftkings.com/2025/08/27/nfl-dfs-beginners-guide-draftkings/",
  MLB: "https://pick6.draftkings.com/pick6-rules-and-scoring-mlb",
  GOLF: "https://pick6.draftkings.com/pick6-rules-and-scoring-pga-full-tournament",
};

const RULES: Record<Sport, ScoringEntry[]> = {
  NBA: [
    ["points", 1, "Point"], ["threes", 0.5, "Made 3pt Shot"], ["rebounds", 1.25, "Rebound"],
    ["assists", 1.5, "Assist"], ["steals", 2, "Steal"], ["blocks", 2, "Block"], ["turnovers", -0.5, "Turnover"],
    ["doubleDouble", 1.5, "Double-Double"], ["tripleDouble", 3, "Triple-Double"],
  ],
  WNBA: [
    ["points", 1, "Point"], ["threes", 0.5, "Made 3pt Shot"], ["rebounds", 1.25, "Rebound"],
    ["assists", 1.5, "Assist"], ["steals", 2, "Steal"], ["blocks", 2, "Block"], ["turnovers", -0.5, "Turnover"],
    ["doubleDouble", 1.5, "Double-Double"], ["tripleDouble", 3, "Triple-Double"],
  ],
  NFL: [
    ["passingYards", 0.04, "Passing Yards"], ["passingTouchdowns", 4, "Passing TD"], ["interceptions", -1, "Interception"],
    ["rushingYards", 0.1, "Rushing Yards"], ["rushingTouchdowns", 6, "Rushing TD"], ["receivingYards", 0.1, "Receiving Yards"],
    ["receivingTouchdowns", 6, "Receiving TD"], ["receptions", 1, "Reception"], ["fumblesLost", -1, "Fumble Lost"],
  ],
  MLB: [
    ["single", 3, "Single"], ["double", 5, "Double"], ["triple", 8, "Triple"], ["homeRun", 10, "Home Run"],
    ["rbi", 2, "Run Batted In"], ["runs", 2, "Run"], ["walks", 2, "Base on Balls"], ["hitByPitch", 2, "Hit By Pitch"],
    ["stolenBases", 5, "Stolen Base"], ["inningsPitched", 2.25, "Inning Pitched"], ["strikeouts", 2, "Strikeout"],
    ["wins", 4, "Win"], ["earnedRunsAllowed", -2, "Earned Run Allowed"], ["hitsAllowed", -0.6, "Hit Against"],
    ["walksAllowed", -0.6, "Base on Balls Against"], ["hitBatsmen", -0.6, "Hit Batsman"], ["completeGame", 2.5, "Complete Game"],
    ["completeGameShutout", 2.5, "Complete Game Shutout"], ["noHitter", 5, "No Hitter"],
  ],
  GOLF: [
    ["doubleEagle", 13, "Double Eagle or Better"], ["eagle", 8, "Eagle"], ["birdies", 3, "Birdie"], ["pars", 0.5, "Par"],
    ["bogeys", -0.5, "Bogey"], ["doubleBogeys", -1, "Double Bogey"], ["worseThanDoubleBogey", -1, "Worse than Double Bogey"],
    ["birdieStreak", 3, "Streak of 3 Birdies or Better"], ["bogeyFreeRound", 3, "Bogey Free Round"], ["under70Rounds", 5, "All Predetermined Rounds Under 70 Strokes"],
    ["holeInOne", 5, "Hole In One"], ["firstPlace", 30, "1st"], ["secondPlace", 20, "2nd"], ["thirdPlace", 18, "3rd"],
  ],
};

export function resolveDraftKingsScoringRules(sport: Sport): { rules: ScoringRules; source: DraftKingsScoringSource } {
  const entries = RULES[sport];
  const rules = Object.fromEntries(entries.map(([name, value, description]) => [name, { value, description }]));
  const payloadHash = createHash("sha256").update(JSON.stringify({ sport, rules })).digest("hex");
  return { rules, source: { source: "DRAFTKINGS_RULES_REGISTRY", reference: SOURCES[sport], payloadHash } };
}
