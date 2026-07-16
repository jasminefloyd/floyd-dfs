import type { MIOS_FantasyManifest } from '../lib/MIOS_FantasyAgents';
import type { Lineup } from './LineupDisplay';

interface PivotSuggestionsProps {
  lineups: Lineup[];
  manifest: MIOS_FantasyManifest | null;
}

export function PivotSuggestions({ lineups, manifest }: PivotSuggestionsProps) {
  if (!manifest || !lineups.length) return null;

  const topLineup = lineups[0];
  const lineupIds = new Set(topLineup.players.map((player) => player.id));
  const pivots = topLineup.players
    .map((player) => {
      const replacement = manifest.player_roster
        .filter((candidate) => !lineupIds.has(candidate.id))
        .filter((candidate) => candidate.injury_status !== 'out')
        .filter((candidate) => candidate.position === player.position)
        .filter((candidate) => candidate.salary <= (player.salary ?? 0))
        .sort((a, b) => (b.projected_points ?? 0) - (a.projected_points ?? 0))[0];

      if (!replacement) return null;
      return {
        out: player,
        replacement,
        delta: (replacement.projected_points ?? 0) - (player.last_5_stats?.avg_fantasy_pts ?? 0)
      };
    })
    .filter(Boolean)
    .slice(0, 3);

  if (!pivots.length) return null;

  return (
    <section className="mb-4 rounded-lg border border-green-200 bg-green-50 p-4">
      <h3 className="mb-3 text-sm font-black text-green-800">Pivot Suggestions</h3>
      <div className="space-y-2">
        {pivots.map((pivot) => (
          <p key={`${pivot!.out.id}-${pivot!.replacement.id}`} className="text-sm text-green-900">
            If {pivot!.out.name} is ruled out, pivot to {pivot!.replacement.name} ({pivot!.replacement.team || 'FA'}). Projection change: {pivot!.delta >= 0 ? '+' : ''}{pivot!.delta.toFixed(1)}.
          </p>
        ))}
      </div>
    </section>
  );
}
