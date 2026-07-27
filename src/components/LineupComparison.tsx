import type { Lineup } from './LineupDisplay';

interface LineupComparisonProps {
  lineups: Lineup[];
}

export function LineupComparison({ lineups }: LineupComparisonProps) {
  const topLineups = lineups.slice(0, 5);
  if (topLineups.length < 2) return null;

  const playerSets = topLineups.map((lineup) => new Set(lineup.players.map((player) => player.name || player.full_name)));
  const pairOverlaps = topLineups.flatMap((lineup, index) => (
    topLineups.slice(index + 1).map((other) => ({
      first: lineup.rank,
      second: other.rank,
      shared: sharedPlayers(lineup, other),
    }))
  ));
  const maxOverlap = pairOverlaps.reduce((max, pair) => Math.max(max, pair.shared.length), 0);
  const captainCounts = countBy(topLineups.map((lineup) => lineup.players.find((player) => player.roster_slot === 'CPT')?.name || lineup.players[0]?.name || 'No CPT'));
  const scriptCounts = countBy(topLineups.map((lineup) => lineup.win_condition ?? 'No game script'));
  const repeatedScripts = Object.entries(scriptCounts).filter(([, count]) => count > 1);

  return (
    <section className="mb-3 rounded-lg border border-slate-200 bg-white p-3 shadow-[var(--shadow-subtle)] sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-black text-[#0b1f3a]">Portfolio Correlation</h3>
        <span className="rounded-md bg-cyan-50 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-cyan-800">Top {topLineups.length}</span>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <PortfolioMetric label="Max Shared" value={`${maxOverlap}`} />
        <PortfolioMetric label="Captains" value={`${Object.keys(captainCounts).length}`} />
        <PortfolioMetric label="Scripts" value={`${Object.keys(scriptCounts).length}`} />
        <PortfolioMetric label="Avg Dupes" value={average(topLineups.map((lineup) => lineup.expected_duplicates ?? 0)).toFixed(1)} />
      </div>
      {repeatedScripts.length ? (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
          {repeatedScripts.map(([script, count]) => `${count} lineups: ${script}`).join(' • ')}
        </div>
      ) : null}
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
              <p className="mb-2 text-xs font-bold text-slate-600">
                CPT {lineup.players.find((player) => player.roster_slot === 'CPT')?.name || '—'} • Dupes {lineup.expected_duplicates?.toFixed(1) ?? '—'}
              </p>
              {lineup.win_condition ? (
                <p className="mb-2 line-clamp-3 text-xs font-medium text-slate-600">{lineup.win_condition}</p>
              ) : null}
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

function sharedPlayers(first: Lineup, second: Lineup): string[] {
  const secondNames = new Set(second.players.map((player) => player.name || player.full_name));
  return first.players
    .map((player) => player.name || player.full_name || '')
    .filter((name) => name && secondNames.has(name));
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function PortfolioMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-sm font-black text-[#0b1f3a]">{value}</p>
    </div>
  );
}
