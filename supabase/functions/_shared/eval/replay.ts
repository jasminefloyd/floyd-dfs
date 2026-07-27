export interface ReplayManifest<TPlayer = unknown, TSlate = unknown> {
  manifest_id?: string;
  sport: string;
  contest_type: string;
  contest_date?: string;
  contest_id?: string;
  game_id?: string;
  slate?: TSlate;
  player_roster: TPlayer[];
}

export interface ReplayConfig {
  excludedPlayers?: string[];
  riskTolerance?: string;
  lineupMode?: string;
  contestStrategy?: string;
  maxPlayerExposure?: number;
  maxTeamExposure?: number;
  minPrimaryStack?: number;
  diversifyLineups?: boolean;
  lateSwapMode?: boolean;
  entryCount?: number;
  fieldSize?: number;
  maxEntriesPerUser?: number;
  payoutShape?: string;
  ownershipWeight?: number;
  maxCaptainExposure?: number;
  captainPool?: string[];
  forceUniqueCaptains?: boolean;
  minSalaryUsed?: number;
  maxDuplication?: number;
}

export function replayPayloadFromManifest(manifest: ReplayManifest, config: ReplayConfig = {}) {
  return {
    manifestId: manifest.manifest_id,
    sport: manifest.sport,
    contestType: manifest.contest_type,
    contestDate: manifest.contest_date,
    contestId: manifest.contest_id,
    gameId: manifest.game_id,
    slate: manifest.slate,
    playerRoster: manifest.player_roster,
    ...config,
  };
}
