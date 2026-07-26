import type { MIOS_FantasyManifest } from '../lib/MIOS_FantasyAgents';
import type { ProjectionCalibration, ProjectionCalibrationV2 } from '../lib/calibrationClient';
import type { LineupScoreboardRow } from '../lib/scoreboardClient';
import type { Lineup } from './LineupDisplay';

interface CalibrationDashboardProps {
  manifest: MIOS_FantasyManifest | null;
  lineups: Lineup[];
  calibration: ProjectionCalibration | null;
  calibrationV2?: ProjectionCalibrationV2[] | null;
  scoreboard?: LineupScoreboardRow[] | null;
}

export function CalibrationDashboard({ manifest, lineups, calibration, calibrationV2, scoreboard }: CalibrationDashboardProps) {
  if (!manifest) return null;

  const sourceEntries = Object.entries(manifest.source_status ?? {});
  const okSources = sourceEntries.filter(([, status]) => status === 'ok').length;
  const partialSources = sourceEntries.filter(([, status]) => status === 'partial').length;
  const unavailableSources = sourceEntries.filter(([, status]) => status === 'unavailable').length;
  const topLineup = lineups[0];
  const sampleSize = calibration?.sample_size ?? 0;
  const biasMultiplier = calibration?.projection_bias_multiplier ?? 1;
  const tuningLabel = calibration && sampleSize >= 50
    ? `${biasMultiplier.toFixed(2)}x active`
    : sampleSize > 0
      ? 'warming up'
      : 'inactive';
  const v2Rows = [...(calibrationV2 ?? [])].sort((a, b) => (
    `${a.position_group}:${a.salary_tier}`.localeCompare(`${b.position_group}:${b.salary_tier}`)
  ));
  const scoreboardRows = scoreboard ?? [];
  const rollingPct = scoreboardRows.length
    ? scoreboardRows.reduce((sum, row) => sum + (row.best_pct_of_optimal ?? 0), 0) / scoreboardRows.length
    : null;
  const hasBacktestData = sampleSize > 0 || v2Rows.length > 0 || scoreboardRows.length > 0;
  const topLineupRange = topLineup && typeof topLineup.ceiling_score === 'number' && typeof topLineup.floor_score === 'number'
    ? `${(topLineup.ceiling_score - topLineup.floor_score).toFixed(1)} pts`
    : 'Not simulated';

  return (
    <section className="mb-3 rounded-lg border border-slate-200 bg-white p-3 shadow-[var(--shadow-subtle)] sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-wide text-cyan-700">Model Control</p>
          <h3 className="mt-1 text-lg font-black text-[#0b1f3a]">Post-Slate Results</h3>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="Samples" value={String(sampleSize)} />
          <Metric label="Bias" value={tuningLabel} />
          <Metric label="Avg Error" value={formatPoint(calibration?.avg_projection_error)} />
          <Metric label="Abs Error" value={formatPoint(calibration?.avg_absolute_error)} />
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Signal label="Source Health" value={`${okSources} ok / ${partialSources} partial / ${unavailableSources} off`} />
        <Signal label="Lineup Range" value={topLineupRange} />
        <Signal label="Auto Tuning" value={calibration && sampleSize >= 50 ? 'Enabled' : 'Needs scored results'} />
      </div>

      {!hasBacktestData ? (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-3">
          <p className="text-sm font-black text-amber-900">No scored results yet</p>
          <p className="mt-1 text-xs font-medium leading-5 text-amber-800">
            This area starts working after generated lineups are scored against final actual results. Until then, there is no backtest, no bias reading, and no calibration table to show.
          </p>
        </div>
      ) : null}

      <div className="mt-4 overflow-x-auto rounded-md border border-slate-200">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Lineup Scoreboard</p>
          <p className="text-xs font-bold text-slate-700">
            Rolling optimal capture {rollingPct === null ? '—' : `${(rollingPct * 100).toFixed(1)}%`}
          </p>
        </div>
        <table className="min-w-full text-left text-xs">
          <thead className="bg-white text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 font-black">Slate</th>
              <th className="px-3 py-2 font-black">Lineups</th>
              <th className="px-3 py-2 font-black">Projected</th>
              <th className="px-3 py-2 font-black">Actual</th>
              <th className="px-3 py-2 font-black">Optimal</th>
              <th className="px-3 py-2 font-black">Captured</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {scoreboardRows.length ? scoreboardRows.slice(0, 5).map((row) => (
              <tr key={`${row.sport}-${row.contest_date}-${row.contest_type}-${row.contest_id ?? ''}`}>
                <td className="px-3 py-2 font-bold text-slate-800">{row.contest_date} · {row.contest_type}</td>
                <td className="px-3 py-2 text-slate-700">{row.lineup_count}</td>
                <td className="px-3 py-2 text-slate-700">{formatPoint(row.best_projected)}</td>
                <td className="px-3 py-2 text-slate-700">{formatPoint(row.best_actual)}</td>
                <td className="px-3 py-2 text-slate-700">{formatPoint(row.optimal_points)}</td>
                <td className="px-3 py-2 text-slate-700">{formatPercent(row.best_pct_of_optimal)}</td>
              </tr>
            )) : (
              <tr>
                <td className="px-3 py-3 text-slate-500" colSpan={6}>Waiting for scored lineup results</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 overflow-x-auto rounded-md border border-slate-200">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 font-black">Group</th>
              <th className="px-3 py-2 font-black">Tier</th>
              <th className="px-3 py-2 font-black">Samples</th>
              <th className="px-3 py-2 font-black">Bias</th>
              <th className="px-3 py-2 font-black">Avg Error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {v2Rows.length ? v2Rows.map((row) => (
              <tr key={`${row.position_group}-${row.salary_tier}`}>
                <td className="px-3 py-2 font-bold text-slate-800">{row.position_group}</td>
                <td className="px-3 py-2 text-slate-700">{row.salary_tier}</td>
                <td className="px-3 py-2 text-slate-700">{row.sample_size}</td>
                <td className="px-3 py-2 text-slate-700">{formatMultiplier(row.bias_multiplier)}</td>
                <td className="px-3 py-2 text-slate-700">{formatPoint(row.avg_error)}</td>
              </tr>
            )) : (
              <tr>
                <td className="px-3 py-3 text-slate-500" colSpan={5}>Waiting for enough scored player results</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatPoint(value?: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(1) : '—';
}

function formatMultiplier(value?: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)}x` : '—';
}

function formatPercent(value?: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-center">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-sm font-black text-[#0b1f3a]">{value}</p>
    </div>
  );
}

function Signal({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-sm font-bold text-slate-800">{value}</p>
    </div>
  );
}
