import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { MIOS_FantasyManifest, Player } from '../../src/lib/MIOS_FantasyAgents';
import { collectNewsAndInjuries } from './news-injuries';
import { collectLast5Stats } from './last5-stats';
import { collectRedditSentiment } from './reddit-sentiment';
import { collectSleeperProps } from './sleeper-props';
import { collectF1Stats } from './f1-stats';

// Helper functions
function extractPlayerIdFromInjury(_injuryLine: any): string {
  // Placeholder: would parse injury report to extract player ID
  return 'unknown';
}

function extractInjuryStatus(injuryLine: any): string {
  const raw: string = injuryLine?.raw ?? '';
  if (raw.includes('out')) return 'out';
  if (raw.includes('doubtful')) return 'doubtful';
  if (raw.includes('questionable')) return 'questionable';
  return 'active';
}

export async function orchestrateMIOS_FantasyScan(
  sport: string,
  contestType: string,
  contestDate: string,
  _userId: string
): Promise<MIOS_FantasyManifest> {
  console.log(`Starting MIOS_Fantasy scan: ${sport} ${contestDate}`);

  const startTime = Date.now();

  try {
    // Parallel collection (all at once)
    const [injuries, f1Drivers, sleeperPlayers] = await Promise.all([
      collectNewsAndInjuries(sport, contestDate),
      sport === 'f1' ? collectF1Stats(2026, 7) : Promise.resolve([]),
      collectSleeperProps(sport, contestDate)
    ]);

    // Build roster from collected data
    // NOTE: neither ESPN, Sleeper, nor Ergast provide DraftKings salary or a live
    // per-player injury_status here, so the roster only has what these agents actually
    // collect. Both fields still exist on Player for the pages/agents that DO have them.
    const playerRoster: (Partial<Player> & { player_id?: string; driver_id?: string })[] = [];

    if (sport === 'f1') {
      playerRoster.push(...f1Drivers);
    } else {
      playerRoster.push(...sleeperPlayers);
    }

    // For each player, collect last 5 stats and sentiment (in parallel batches)
    const statsPromises = playerRoster.slice(0, 20).map((player) => {
      const playerId = player.player_id ?? player.driver_id ?? player.id ?? '';
      return Promise.all([
        collectLast5Stats(playerId, sport),
        collectRedditSentiment(playerId, sport)
      ]);
    });

    const allStats = await Promise.all(statsPromises);

    // Assemble MIOS_Fantasy manifest
    const manifest: MIOS_FantasyManifest = {
      manifest_id: crypto.randomUUID(),
      sport,
      contest_type: contestType,
      contest_date: contestDate,
      player_roster: playerRoster.map((player, idx) => ({
        ...player,
        id: player.player_id ?? player.driver_id ?? player.id ?? '',
        last_5_stats: allStats[idx]?.[0]
      })) as Player[],
      injury_updates: injuries.map((inj) => ({
        player_id: extractPlayerIdFromInjury(inj),
        status: extractInjuryStatus(inj),
        confidence: 0.8
      })),
      vegas_context: [],
      social_sentiment: allStats.map((stats) => stats[1]).filter(Boolean),
      catalysts: [],
      narrative_seeds: [],
      collected_at: new Date().toISOString()
    };

    const elapsedTime = (Date.now() - startTime) / 1000;
    console.log(`MIOS_Fantasy scan completed in ${elapsedTime}s`);

    return manifest;
  } catch (error) {
    console.error('MIOS_Fantasy orchestration error:', error);
    throw error;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const sport = String(req.query.sport ?? '');
  const contestType = String(req.query.contestType ?? '');
  const contestDate = String(req.query.contestDate ?? '');
  const userId = String(req.query.userId ?? '');

  try {
    const manifest = await orchestrateMIOS_FantasyScan(sport, contestType, contestDate, userId);
    res.status(200).json(manifest);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
}
