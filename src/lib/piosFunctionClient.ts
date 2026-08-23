import { supabase, supabaseAnonKey, supabaseUrl } from './supabaseClient';
import type { MIOS_FantasyManifest } from './MIOS_FantasyAgents';
import type { DraftLineup } from './PIOS_FantasyGenerator';

export interface PiosLineupRequest {
  manifest: MIOS_FantasyManifest;
  sport: string;
  contestType: string;
  excludedPlayers: string[];
  lockedPlayers: string[];
  riskTolerance: string;
  lineupMode: string;
  contestStrategy: string;
  maxPlayerExposure: number;
  maxTeamExposure: number;
  minPrimaryStack: number;
  diversifyLineups: boolean;
  lateSwapMode: boolean;
  entryCount: number;
  fieldSize: number;
  maxEntriesPerUser: number;
  payoutShape: string;
  ownershipWeight: number;
  correlationWeight: number;
  maxCaptainExposure: number;
  captainPool: string[];
  minPerTeam: number;
  forceUniqueCaptains: boolean;
  minSalaryUsed: number;
  maxDuplication: number;
  maxSharedPlayers?: number;
  simulationIterations: number;
  fieldSimulationSize: number;
  showDiagnostics: boolean;
}

interface PiosFunctionResponse {
  lineups: DraftLineup[];
  data_warnings?: string[];
  contest_id?: string | null;
  game_id?: string | null;
}

interface PiosFunctionError {
  error?: string;
}

export async function invokePiosLineupGeneration(
  params: PiosLineupRequest,
  signal?: AbortSignal
): Promise<PiosFunctionResponse> {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase URL and anon key are required to call PIOS_Fantasy.');
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token ?? supabaseAnonKey;
  const userId = sessionData.session?.user.id;
  const endpoint = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/fantasy-pios-lineups`;

  const response = await fetch(endpoint, {
    method: 'POST',
    signal,
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      manifestId: params.manifest.manifest_id,
      snapshotId: params.manifest.snapshot_id,
      requestId: params.manifest.request_id,
      dossierVersion: params.manifest.dossier_version,
      dossier: params.manifest.dossier,
      modelVersion: params.manifest.model_version,
      readiness: params.manifest.readiness,
      sport: params.sport,
      contestType: params.contestType,
      contestDate: params.manifest.contest_date,
      contestId: params.manifest.contest_id,
      gameId: params.manifest.game_id,
      slate: params.manifest.slate,
      playerRoster: params.manifest.player_roster.map((player) => ({
        id: player.id,
        name: player.name,
        team: player.team,
        image_url: player.image_url,
        team_logo_url: player.team_logo_url,
        position: player.position,
        salary: player.salary,
        salary_source: player.salary_source,
        injury_status: player.injury_status,
        projected_points: player.projected_points,
        p10_projection: player.p10_projection,
        p25_projection: player.p25_projection,
        p50_projection: player.p50_projection,
        p75_projection: player.p75_projection,
        p90_projection: player.p90_projection,
        p95_projection: player.p95_projection,
        stdev_fantasy_pts: player.stdev_fantasy_pts,
        boom_probability: player.boom_probability,
        bust_probability: player.bust_probability,
        projection_source: player.projection_source,
        prop_projection: player.prop_projection,
        implied_total: player.implied_total,
        spread: player.spread,
        confirmed_starter: player.confirmed_starter,
        batting_order: player.batting_order,
        run_factor: player.run_factor,
        opponent_team: player.opponent_team,
        opposing_probable_pitcher_id: player.opposing_probable_pitcher_id,
        opposing_probable_pitcher_name: player.opposing_probable_pitcher_name,
        own_probable_starter: player.own_probable_starter,
        game_id: player.game_id,
        tee_time: player.tee_time,
        depth_chart_order: player.depth_chart_order,
        ownership_projection: player.ownership_projection,
        cpt_ownership_projection: player.cpt_ownership_projection,
        flex_ownership_projection: player.flex_ownership_projection,
        minutes_projection: player.minutes_projection,
        minutes_distribution: player.minutes_distribution,
        wnba_role_prior: player.wnba_role_prior,
        role_counterfactual: player.role_counterfactual,
        wnba_component_projection: player.wnba_component_projection,
        wnba_decision_features: player.wnba_decision_features,
        wnba_scenarios: player.wnba_scenarios,
        sport_decision_features: player.sport_decision_features,
        candidate_fantasy_projection: player.candidate_fantasy_projection,
        usage_rate: player.usage_rate,
        pace_metric: player.pace_metric,
        context_score: player.context_score,
        news_score: player.news_score,
        news_note: player.news_note,
        news_events: player.news_events,
        confidence_breakdown: player.confidence_breakdown,
        projection_trace: player.projection_trace,
        mlb_decision_features: player.mlb_decision_features,
        field_provenance: player.field_provenance,
        last_5_stats: player.last_5_stats
          ? {
              avg_fantasy_pts: player.last_5_stats.avg_fantasy_pts,
              stdev_fantasy_pts: player.last_5_stats.stdev_fantasy_pts,
              games_sample_size: player.last_5_stats.games_sample_size,
              minutes_stdev: player.last_5_stats.minutes_stdev,
              confidence: player.last_5_stats.confidence,
              is_synthetic: player.last_5_stats.is_synthetic,
              games: player.last_5_stats.games,
              source: player.last_5_stats.source,
              last_updated_at: player.last_5_stats.last_updated_at,
            }
          : undefined,
      })),
      excludedPlayers: params.excludedPlayers,
      lockedPlayers: params.lockedPlayers,
      riskTolerance: params.riskTolerance,
      lineupMode: params.lineupMode,
      contestStrategy: params.contestStrategy,
      maxPlayerExposure: params.maxPlayerExposure,
      maxTeamExposure: params.maxTeamExposure,
      minPrimaryStack: params.minPrimaryStack,
      diversifyLineups: params.diversifyLineups,
      lateSwapMode: params.lateSwapMode,
      entryCount: params.entryCount,
      fieldSize: params.fieldSize,
      maxEntriesPerUser: params.maxEntriesPerUser,
      payoutShape: params.payoutShape,
      ownershipWeight: params.ownershipWeight,
      correlationWeight: params.correlationWeight,
      maxCaptainExposure: params.maxCaptainExposure,
      captainPool: params.captainPool,
      minPerTeam: params.minPerTeam,
      forceUniqueCaptains: params.forceUniqueCaptains,
      minSalaryUsed: params.minSalaryUsed,
      maxDuplication: params.maxDuplication,
      maxSharedPlayers: params.maxSharedPlayers,
      simulationIterations: params.simulationIterations,
      fieldSimulationSize: params.fieldSimulationSize,
      showDiagnostics: params.showDiagnostics,
      userId,
    }),
  });

  const contentType = response.headers.get('content-type') ?? '';
  const responseText = await response.text();
  if (!contentType.includes('application/json')) {
    throw new Error(`PIOS_Fantasy Edge Function did not return JSON (${response.status}): ${responseText.slice(0, 280)}`);
  }

  const data = responseText ? JSON.parse(responseText) as PiosFunctionResponse | PiosFunctionError : {};
  if (!response.ok) {
    throw new Error('error' in data && data.error ? data.error : `PIOS_Fantasy generation failed: ${response.status}: ${responseText.slice(0, 280)}`);
  }

  return data as PiosFunctionResponse;
}
