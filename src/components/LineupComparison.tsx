import type { Lineup } from './LineupDisplay';

interface LineupComparisonProps {
  lineups: Lineup[];
}

export function LineupComparison({ lineups }: LineupComparisonProps) {
  const topLineups = lineups.slice(0, 3);
  if (topLineups.length < 2) return null;

  const playerSets = topLineups.map((lineup) => new Set(lineup.players.map((player) => player.name || player.full_name)));

  return (
    <section className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-bold text-gray-900">Lineup Comparison</h3>
      <div className="grid gap-3 md:grid-cols-3">
        {topLineups.map((lineup, index) => {
          const otherNames = new Set(
            playerSets
              .filter((_, setIndex) => setIndex !== index)
              .flatMap((set) => Array.from(set))
          );
          const uniquePlayers = lineup.players.filter((player) => !otherNames.has(player.name || player.full_name));

          return (
            <div key={lineup.rank} className="rounded-md border border-gray-200 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="font-semibold">#{lineup.rank}</p>
                <p className="text-xs text-gray-600">${lineup.salary_used.toLocaleString()}</p>
              </div>
              <p className="mb-2 text-sm text-primary">{lineup.projected_points.toFixed(1)} projected</p>
              <p className="text-xs text-gray-500">Unique players</p>
              <p className="text-sm text-gray-800">
                {uniquePlayers.map((player) => player.name || player.full_name).join(', ') || 'None'}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
