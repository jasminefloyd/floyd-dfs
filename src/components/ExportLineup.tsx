import type { Lineup } from './LineupDisplay';

interface ExportLineupProps {
  lineup: Lineup;
}

function csvEscape(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

export function ExportLineup({ lineup }: ExportLineupProps) {
  const rows = [
    ['Slot', 'Player', 'Position', 'Team', 'Salary', 'Base Salary', 'Multiplier', 'Projected'],
    ...lineup.players.map((player) => [
      player.roster_slot || '',
      player.name || player.full_name || '',
      player.position || '',
      player.team || player.nfl_team || '',
      player.salary ?? '',
      player.base_salary ?? player.salary ?? '',
      player.salary_multiplier ?? 1,
      player.last_5_stats?.avg_fantasy_pts ?? ''
    ])
  ];
  const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\n');
  const copyText = lineup.players
    .map((player) => {
      const slot = player.roster_slot ? `${player.roster_slot} ` : '';
      const multiplier = player.salary_multiplier && player.salary_multiplier > 1 ? `, ${player.salary_multiplier}x` : '';
      return `${slot}${player.name || player.full_name} (${player.position}) $${player.salary ?? 0}${multiplier}`;
    })
    .join('\n');

  return (
    <div className="flex gap-2">
      <button
        onClick={() => void navigator.clipboard?.writeText(copyText)}
        className="flex-1 rounded border border-gray-300 bg-white py-2 font-semibold text-gray-900 transition-colors duration-[var(--transition-fast)] hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-500"
      >
        Copy
      </button>
      <button
        onClick={() => {
          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `fantasy-ai-lineup-${lineup.rank}.csv`;
          link.click();
          URL.revokeObjectURL(url);
        }}
        className="flex-1 rounded bg-gray-900 py-2 font-semibold text-white transition-colors duration-[var(--transition-fast)] hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary"
      >
        CSV
      </button>
    </div>
  );
}
