export interface ReplayManifest<TPlayer = unknown, TSlate = unknown> {
  manifest_id?: string;
  snapshot_id?: string;
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
  simulationIterations?: number;
  fieldSimulationSize?: number;
  simulationSeed?: number;
}

export interface ReplayTimestampEvidence {
  lock_time?: string | null;
  collected_at?: string | null;
  observed_at?: string | null;
  actual_recorded_at?: string | null;
}

export function assertReplayTimestampSafety(evidence: ReplayTimestampEvidence): void {
  const lock = Date.parse(String(evidence.lock_time ?? ''));
  if (!Number.isFinite(lock)) return;
  for (const [label, value] of Object.entries({
    collected_at: evidence.collected_at,
    observed_at: evidence.observed_at,
  })) {
    if (!value) continue;
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp) && timestamp > lock) {
      throw new Error(`Replay leakage guard: ${label} is after contest lock.`);
    }
  }
  if (evidence.actual_recorded_at) {
    const actualTimestamp = Date.parse(evidence.actual_recorded_at);
    if (Number.isFinite(actualTimestamp) && actualTimestamp <= lock) {
      throw new Error('Replay leakage guard: actual results were recorded at or before contest lock.');
    }
  }
}

export function replayPayloadFromManifest(manifest: ReplayManifest, config: ReplayConfig = {}) {
  return {
    manifestId: manifest.manifest_id,
    snapshotId: manifest.snapshot_id,
    sport: manifest.sport,
    contestType: manifest.contest_type,
    contestDate: manifest.contest_date,
    contestId: manifest.contest_id,
    gameId: manifest.game_id,
    slate: manifest.slate,
    playerRoster: manifest.player_roster,
    replayMode: true,
    ...config,
  };
}
