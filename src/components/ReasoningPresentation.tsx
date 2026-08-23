import type { ReactNode } from 'react';
import type { MIOS_FantasyManifest } from '../lib/MIOS_FantasyAgents';
import type { Lineup } from './LineupDisplay';

interface ReasoningPresentationProps {
  manifest: MIOS_FantasyManifest | null;
  lineups: Lineup[];
}

interface DossierView {
  player_hierarchy?: Record<string, string[]>;
  game_scripts?: Array<{ script_key?: string; thesis?: string; probability?: number; confidence?: number; required_conditions?: string[]; opposing_conditions?: string[] }>;
  source_evidence?: Array<{ source?: string; fact?: string; observed_at?: string | null; published_at?: string | null; is_modeled?: boolean; confidence?: number }>;
  game_environment?: { games?: Array<{ home_team?: string; away_team?: string; total?: number; spread?: number; weather_note?: string }> };
  data_gaps?: Array<{ message?: string; required?: boolean }>;
  freshness_deadline?: string;
}

export function ReasoningPresentation({ manifest, lineups }: ReasoningPresentationProps) {
  const dossier = (manifest?.dossier ?? null) as DossierView | null;
  if (!manifest || !dossier) return null;
  const playerNames = new Map((manifest.player_roster ?? []).map((player) => [player.id, player.name]));
  const hierarchy = dossier.player_hierarchy ?? {};
  const scripts = dossier.game_scripts ?? [];
  const evidence = dossier.source_evidence ?? [];
  const primaryScript = scripts.slice().sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0))[0];
  const freshness = dossier.freshness_deadline ? formatTimestamp(dossier.freshness_deadline) : 'Unavailable';

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-3 shadow-[var(--shadow-subtle)]" aria-label="Reasoning presentation">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Reasoning presentation</p>
          <h3 className="mt-1 text-sm font-black text-[#0b1f3a]">{primaryScript?.thesis ?? 'No primary slate thesis is available.'}</h3>
        </div>
        <span className="shrink-0 rounded-md bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">Fresh through {freshness}</span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <PresentationBlock title="Slate thesis">
          <p>{primaryScript ? `${primaryScript.script_key} · ${((primaryScript.probability ?? 0) * 100).toFixed(0)}% scenario probability.` : 'Scenario evidence is limited.'}</p>
          {primaryScript?.required_conditions?.length ? <p className="mt-1">Needs: {primaryScript.required_conditions.slice(0, 3).join(' · ')}</p> : null}
        </PresentationBlock>
        <PresentationBlock title="Confidence limits">
          <p>{manifest.readiness?.status === 'ready' ? 'Inputs passed readiness checks.' : 'Use additional caution because the scan has incomplete or uncertain inputs.'}</p>
          <p className="mt-1">Model confidence describes projection reliability, not a winning probability.</p>
        </PresentationBlock>
      </div>

      <details>
        <summary className="cursor-pointer text-xs font-black text-slate-600">Player hierarchy</summary>
        <div className="mt-2 space-y-1.5">
          {Object.entries(hierarchy).filter(([, ids]) => ids.length).map(([tier, ids]) => (
            <div key={tier} className="rounded-md bg-slate-50 px-2 py-1.5 text-[11px] text-slate-600">
              <span className="font-black text-[#0b1f3a]">{tier.replaceAll('_', ' ')}:</span> {ids.map((id) => playerNames.get(id) ?? id).join(', ')}
            </div>
          ))}
        </div>
      </details>

      <details>
        <summary className="cursor-pointer text-xs font-black text-slate-600">Game scripts and risks</summary>
        <div className="mt-2 space-y-2">
          {scripts.map((script) => (
            <div key={script.script_key} className="rounded-md border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-600">
              <p className="font-black text-[#0b1f3a]">{script.script_key} · {percent(script.probability)} likelihood · {percent(script.confidence)} confidence</p>
              <p className="mt-0.5">{script.thesis ?? 'No thesis supplied.'}</p>
              {script.opposing_conditions?.length ? <p className="mt-1 text-amber-800">Risk: {script.opposing_conditions.slice(0, 3).join(' · ')}</p> : null}
            </div>
          ))}
        </div>
      </details>

      <details>
        <summary className="cursor-pointer text-xs font-black text-slate-600">Evidence and freshness</summary>
        <div className="mt-2 max-h-60 space-y-1.5 overflow-y-auto">
          {evidence.slice(0, 30).map((item, index) => (
            <div key={`${item.source}-${item.fact}-${index}`} className="rounded-md border border-slate-200 px-2 py-1.5 text-[11px] text-slate-600">
              <p><span className="font-black text-[#0b1f3a]">{item.source ?? 'unknown source'}</span>{item.is_modeled ? ' · modeled' : ' · observed'}{item.confidence != null ? ` · ${percent(item.confidence)} confidence` : ''}</p>
              <p className="mt-0.5">{item.fact ?? 'Evidence fact unavailable.'}</p>
              <p className="mt-0.5 text-[10px] text-slate-400">{formatTimestamp(item.observed_at ?? item.published_at)}</p>
            </div>
          ))}
        </div>
      </details>

      <div>
        <p className="text-xs font-black text-slate-600">Recommendation reasoning</p>
        <div className="mt-2 space-y-2">
          {lineups.slice(0, 5).map((lineup) => (
            <div key={lineup.rank} className="rounded-md border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-600">
              <div className="flex items-center justify-between gap-2">
                <span className="font-black text-[#0b1f3a]">Lineup {lineup.rank} · {lineup.scenario_key?.replaceAll('_', ' ') ?? 'scenario unavailable'}</span>
                <span>${lineup.salary_used.toLocaleString()} · ${(lineup.salary_left_unused ?? 50000 - lineup.salary_used).toLocaleString()} left</span>
              </div>
              <p className="mt-1">Median {value(lineup.projected_points)} · Floor {value(lineup.floor_score)} · Ceiling {value(lineup.ceiling_score)} · Ownership {percent(lineup.ownership_sum)} · Leverage {value(lineup.leverage_score)}</p>
              {lineup.captain_rationale ? <p className="mt-1">Captain rationale: {lineup.captain_rationale}</p> : null}
              {lineup.failure_condition ? <p className="mt-1 text-amber-800">Failure condition: {lineup.failure_condition}</p> : null}
              {lineup.portfolio_correlation_flags?.length ? <p className="mt-1">Correlation: {lineup.portfolio_correlation_flags.join(' · ')}</p> : null}
            </div>
          ))}
        </div>
      </div>

      {dossier.data_gaps?.length ? <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900">Limitations: {dossier.data_gaps.slice(0, 3).map((gap) => gap.message).join(' · ')}</p> : null}
    </section>
  );
}

function PresentationBlock({ title, children }: { title: string; children: ReactNode }) {
  return <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-[11px] leading-4 text-slate-600"><p className="font-black uppercase tracking-wide text-slate-500">{title}</p><div className="mt-1">{children}</div></div>;
}

function percent(value?: number | null): string {
  return value == null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(0)}%`;
}

function value(value?: number | null): string {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(1);
}

function formatTimestamp(value?: string | null): string {
  if (!value) return 'Unavailable';
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? 'Unavailable' : timestamp.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
}
