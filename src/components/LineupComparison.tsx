import type { Lineup } from './LineupDisplay';

interface LineupComparisonProps {
  lineups: Lineup[];
}

export function LineupComparison({ lineups }: LineupComparisonProps) {
  const topLineups = lineups.slice(0, 3);
  if (topLineups.length < 2) return null;

  const playerSets = topLineups.map((lineup) => new Set(lineup.players.map((player) => player.name || player.full_name)));

  return (
    <section className="mb-3 rounded-lg border border-slate-200 bg-white p-3 shadow-[var(--shadow-subtle)] sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-black text-[#0b1f3a]">Lineup Comparison</h3>
        <span className="rounded-md bg-cyan-50 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-cyan-800">Top 3</span>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {topLineups.map((lineup, index) => {
          const otherNames = new Set(
            playerSets
              .filter((_, setIndex) => setIndex !== index)
              .flatMap((set) => Array.from(set))
          );
          const uniquePlayers = lineup.players.filter((player) => !otherNames.has(player.name || player.full_name));

          return (
            <div key={lineup.rank} className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="font-black text-[#0b1f3a]">#{lineup.rank}</p>
                <p className="text-xs font-bold text-slate-600">${lineup.salary_used.toLocaleString()}</p>
              </div>
              <p className="mb-2 text-sm font-black text-cyan-800">{lineup.projected_points.toFixed(1)} projected</p>
              <p className="text-xs font-bold text-slate-500">Unique players</p>
              <p className="text-sm text-slate-800">
                {uniquePlayers.map((player) => player.name || player.full_name).join(', ') || 'None'}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
