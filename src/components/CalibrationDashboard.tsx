import type { MIOS_FantasyManifest } from '../lib/MIOS_FantasyAgents';
import type { ProjectionCalibration } from '../lib/calibrationClient';
import type { Lineup } from './LineupDisplay';

interface CalibrationDashboardProps {
  manifest: MIOS_FantasyManifest | null;
  lineups: Lineup[];
  calibration: ProjectionCalibration | null;
}

export function CalibrationDashboard({ manifest, lineups, calibration }: CalibrationDashboardProps) {
  if (!manifest) return null;

  const sourceEntries = Object.entries(manifest.source_status ?? {});
  const okSources = sourceEntries.filter(([, status]) => status === 'ok').length;
  const partialSources = sourceEntries.filter(([, status]) => status === 'partial').length;
  const unavailableSources = sourceEntries.filter(([, status]) => status === 'unavailable').length;
  const topLineup = lineups[0];
  const biasMultiplier = calibration?.projection_bias_multiplier ?? 1;
  const tuningLabel = calibration && calibration.sample_size >= 50
    ? `${biasMultiplier.toFixed(2)}x active`
    : 'collecting';

  return (
    <section className="mb-3 rounded-lg border border-slate-200 bg-white p-3 shadow-[var(--shadow-subtle)] sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-wide text-cyan-700">Model Control</p>
          <h3 className="mt-1 text-lg font-black text-[#0b1f3a]">Backtest & Tuning</h3>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="Samples" value={String(calibration?.sample_size ?? 0)} />
          <Metric label="Bias" value={tuningLabel} />
          <Metric label="Avg Error" value={formatPoint(calibration?.avg_projection_error)} />
          <Metric label="Abs Error" value={formatPoint(calibration?.avg_absolute_error)} />
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Signal label="Source Health" value={`${okSources} ok / ${partialSources} partial / ${unavailableSources} off`} />
        <Signal label="Top Lineup Gap" value={topLineup ? `${((topLineup.ceiling_score ?? topLineup.projected_points) - (topLineup.floor_score ?? topLineup.projected_points)).toFixed(1)} pts` : '—'} />
        <Signal label="Auto Tuning" value={calibration && calibration.sample_size >= 50 ? 'Enabled' : 'Needs actuals'} />
      </div>
    </section>
  );
}

function formatPoint(value?: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(1) : '—';
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
