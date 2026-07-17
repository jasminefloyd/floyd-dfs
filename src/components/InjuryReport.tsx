import { AlertTriangle } from 'lucide-react';
import type { MIOS_FantasyManifest, Player } from '../lib/MIOS_FantasyAgents';

interface InjuryReportProps {
  manifest: MIOS_FantasyManifest | null;
}

const STATUS_LABELS: Record<Player['injury_status'], string> = {
  out: 'Out',
  doubtful: 'Doubtful',
  questionable: 'Questionable',
  probable: 'Probable',
  day_to_day: 'Day-to-day',
  active: 'Active',
};

export function InjuryReport({ manifest }: InjuryReportProps) {
  if (!manifest) return null;

  const injuries = manifest.player_roster.filter((player) => player.injury_status !== 'active');
  const checkedAt = formatCheckedAt(manifest.collected_at);

  return (
    <section className="mb-4 rounded-lg border border-amber-200 bg-amber-50/70 p-4 text-gray-900 shadow-[var(--shadow-subtle)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-amber-200 bg-white text-amber-600">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wide text-amber-700">Injury Report</p>
            <h3 className="mt-1 text-base font-black text-gray-950">
              {injuries.length ? `${injuries.length} scan-related injury flag${injuries.length === 1 ? '' : 's'}` : 'No scan-related injury flags'}
            </h3>
            {checkedAt ? <p className="mt-1 text-xs text-gray-500">Checked {checkedAt}</p> : null}
          </div>
        </div>
        <span className="rounded-full border border-amber-200 bg-white px-2 py-1 text-xs font-bold text-amber-700">
          Injured players excluded
        </span>
      </div>

      {injuries.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {injuries.map((player) => (
            <div key={player.id} className="rounded-md border border-amber-200 bg-white px-3 py-2 text-xs">
              <p className="font-black text-gray-950">{player.name}</p>
              <p className="mt-0.5 text-gray-600">
                {STATUS_LABELS[player.injury_status]} · {player.team || 'Team N/A'} · {player.position}
              </p>
              {player.injury_note ? <p className="mt-1 text-amber-700">{player.injury_note}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function formatCheckedAt(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
