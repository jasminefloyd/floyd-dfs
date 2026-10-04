import { useEffect, useState } from 'react';
import { AppPage, ErrorBox } from '../components/AppPrimitives';
import { floydRequest } from '../lib/floydDfsClient';

interface Lesson { id: string; sport: string; stage: string; status: string; sample_count: number; observation: string; proposed_change: string; confidence?: string; }
interface ForecastSummary { sampleSize: number; meanAbsoluteError: number | null; meanBias: number | null; p20Coverage: number | null; p50Coverage: number | null; p90Coverage: number | null; validationStatus: string; }
interface ForecastValidation { overall: ForecastSummary; bySport: Record<string, ForecastSummary>; note: string; }
interface PairedMetric { playerRows: number; independentSlates: number; candidateMae: number | null; candidateRmse: number | null; candidateBias: number | null; baselineMae: number | null; relativeMaeImprovement: number | null; candidateQuantileCoverage: { p20: number | null; p50: number | null; p90: number | null }; status: string; }
interface PairedBaseline { cutoff: string; holdout: PairedMetric; holdoutBySport: Record<string, PairedMetric>; holdoutBySportAndRole: Record<string, PairedMetric>; releaseStatus: string; note: string; }

export default function LearningPage() {
  const [runId, setRunId] = useState('');
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [lessonsError, setLessonsError] = useState<string | null>(null);
  const [forecastValidation, setForecastValidation] = useState<ForecastValidation | null>(null);
  const [pairedBaseline, setPairedBaseline] = useState<PairedBaseline | null>(null);
  const [contestId, setContestId] = useState('');
  const [fieldValidation, setFieldValidation] = useState<Record<string, unknown> | null>(null);
  const [forecastError, setForecastError] = useState<string | null>(null);

  useEffect(() => {
    floydRequest<{ lessons: Lesson[] }>('/api/learning/lessons')
      .then((data) => setLessons(data.lessons ?? []))
      .catch((reason) => setLessonsError(reason instanceof Error ? reason.message : 'Unable to load lesson candidates.'));
  }, []);

  useEffect(() => {
    floydRequest<{ projectionValidation: ForecastValidation; pairedBaseline: PairedBaseline }>('/api/learning/calibration')
      .then((data) => { setForecastValidation(data.projectionValidation); setPairedBaseline(data.pairedBaseline); })
      .catch((reason) => setForecastError(reason instanceof Error ? reason.message : 'Unable to load projection validation.'));
  }, []);

  async function runCheck() {
    setLoading(true);
    setError(null);
    try {
      const trimmed = runId.trim();
      const response = trimmed
        ? await floydRequest<Record<string, unknown>>(`/api/generation-runs/${encodeURIComponent(trimmed)}/recheck`)
        : await floydRequest<Record<string, unknown>>('/api/learning/pre-lock', { method: 'POST', body: JSON.stringify({ enteredLineups: [], changeEvents: [] }) });
      setResult(response);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to run the learning check.');
    } finally {
      setLoading(false);
    }
  }

  async function refreshRun() {
    if (!runId.trim()) return;
    setRefreshing(true); setError(null);
    try {
      const response = await floydRequest<Record<string, unknown>>(`/api/generation-runs/${encodeURIComponent(runId.trim())}/refresh`, { method: 'POST', body: JSON.stringify({}) });
      setResult({ ...(result ?? {}), refresh: response });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to queue replacement lineups.'); }
    finally { setRefreshing(false); }
  }

  async function validateField() {
    try { setError(null); const report = await floydRequest<Record<string, unknown>>(`/api/learning/contest-field-validation?contestId=${encodeURIComponent(contestId.trim())}`); setFieldValidation(report); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to compare imported contest field.'); }
  }

  return (
    <AppPage eyebrow="06 / LEARNING LOOP" title="Learning, measured." subtitle="Review the deterministic controls used to evaluate entered lineups and pre-lock changes.">
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-[var(--shadow-subtle)]">
          <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Pre-lock control</p>
          <h2 className="mt-2 text-xl font-black text-[#0b1f3a]">Run a readiness check.</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            With a generation run ID, this re-runs Research against that run's slate and diffs real availability changes
            since the run was generated. Without one, it calls the manual pre-lock endpoint with no change events (a KEEP baseline).
          </p>
          <label className="mt-4 block text-[10px] font-black uppercase tracking-wide text-slate-500">
            Generation run ID (optional)
            <input
              type="text"
              value={runId}
              onChange={(event) => setRunId(event.target.value)}
              placeholder="e.g. a run ID from History"
              className="mt-1.5 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800"
            />
          </label>
          <button type="button" onClick={() => void runCheck()} disabled={loading} className="mt-5 rounded-md bg-[#0b1f3a] px-4 py-2.5 text-xs font-black text-white disabled:opacity-50">
            {loading ? 'Checking…' : 'Run pre-lock check'}
          </button>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-[var(--shadow-subtle)]">
          <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Result</p>
          {error ? <div className="mt-3"><ErrorBox message={error} /></div> : result ? <><pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{JSON.stringify(result, null, 2)}</pre>{runId.trim() && result.replacementsAvailableBeforeLock === true ? <button type="button" onClick={() => void refreshRun()} disabled={refreshing} className="mt-3 rounded-md bg-[#0b1f3a] px-4 py-2.5 text-xs font-black text-white disabled:opacity-50">{refreshing ? 'Queueing replacement…' : 'Re-optimize from current DraftKings slate'}</button> : null}</> : <p className="mt-3 text-sm text-slate-500">No check has been run in this session.</p>}
        </section>
      </div>
      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-[var(--shadow-subtle)]">
        <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Forecast validation</p>
        <h2 className="mt-2 text-xl font-black text-[#0b1f3a]">Compare saved projections with recorded scores.</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">These are descriptive results from entered lineups only. They do not prove the optimizer beats a baseline or predict future contest outcomes.</p>
        {forecastError ? <div className="mt-3"><ErrorBox message={forecastError} /></div> : forecastValidation ? <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries({ OVERALL: forecastValidation.overall, ...forecastValidation.bySport }).map(([sport, metrics]) => <div key={sport} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-2"><p className="text-xs font-black uppercase tracking-wide text-[#0b1f3a]">{sport}</p><span className="text-[9px] font-black uppercase text-amber-700">{metrics.validationStatus.replaceAll('_', ' ')}</span></div>
              <p className="mt-2 text-xs text-slate-600">{metrics.sampleSize} recorded results · MAE {formatMetric(metrics.meanAbsoluteError)} · bias {formatMetric(metrics.meanBias)}</p>
              <p className="mt-1 text-[10px] text-slate-500">P20 / P50 / P90 coverage: {formatPercent(metrics.p20Coverage)} / {formatPercent(metrics.p50Coverage)} / {formatPercent(metrics.p90Coverage)}</p>
            </div>)}
          </div>
          <p className="mt-3 text-[10px] leading-5 text-slate-500">{forecastValidation.note}</p>
        </> : <p className="mt-3 text-sm text-slate-500">Loading saved result coverage…</p>}
      </section>
      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-[var(--shadow-subtle)]">
        <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Contest field diagnostic</p>
        <h2 className="mt-2 text-xl font-black text-[#0b1f3a]">Compare ownership with actual standings.</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">Import a completed standings CSV from History, then compare actual player ownership with the archived pre-lock estimates. One contest remains diagnostic and cannot enable win probabilities.</p>
        <div className="mt-3 flex flex-wrap gap-2"><input value={contestId} onChange={(event) => setContestId(event.target.value)} placeholder="DraftKings contest ID" className="min-w-56 rounded-md border border-slate-300 px-3 py-2 text-sm" /><button type="button" onClick={() => void validateField()} disabled={!contestId.trim()} className="rounded-md bg-[#0b1f3a] px-4 py-2 text-xs font-black text-white disabled:opacity-50">Run field diagnostic</button></div>
        {fieldValidation ? <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{JSON.stringify(fieldValidation, null, 2)}</pre> : null}
      </section>
      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-[var(--shadow-subtle)]">
        <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Chronological paired evaluation</p>
        <h2 className="mt-2 text-xl font-black text-[#0b1f3a]">Pre-lock model versus same-slate baseline.</h2>
        {pairedBaseline ? <>
          <p className="mt-2 text-sm leading-6 text-slate-600">Holdout begins {new Date(pairedBaseline.cutoff).toLocaleDateString()}. A slate is the independent unit; player rows from one slate do not increase the slate count. Promotion stays on hold until the sample and improvement thresholds pass review.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(pairedBaseline.holdoutBySport).map(([sport, metric]) => <div key={sport} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-2"><p className="text-xs font-black uppercase tracking-wide text-[#0b1f3a]">{sport}</p><span className="text-[9px] font-black uppercase text-amber-700">{metric.status.replaceAll('_', ' ')}</span></div>
              <p className="mt-2 text-xs text-slate-600">{metric.independentSlates} slates · {metric.playerRows} player rows</p>
              <p className="mt-1 text-xs text-slate-600">MAE model {formatMetric(metric.candidateMae)} · baseline {formatMetric(metric.baselineMae)} · improvement {formatPercent(metric.relativeMaeImprovement)}</p>
              <p className="mt-1 text-[10px] text-slate-500">Model bias {formatMetric(metric.candidateBias)} · P20/P50/P90 coverage {formatPercent(metric.candidateQuantileCoverage.p20)} / {formatPercent(metric.candidateQuantileCoverage.p50)} / {formatPercent(metric.candidateQuantileCoverage.p90)}</p>
            </div>)}
          </div>
          {Object.keys(pairedBaseline.holdoutBySportAndRole).length ? <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-xs"><thead><tr className="border-b border-slate-200 text-[10px] uppercase tracking-wide text-slate-500"><th className="py-2">Sport / role</th><th>Slates</th><th>Players</th><th>Model MAE</th><th>Baseline MAE</th><th>Improvement</th><th>Status</th></tr></thead><tbody>{Object.entries(pairedBaseline.holdoutBySportAndRole).map(([key, metric]) => <tr key={key} className="border-b border-slate-100 text-slate-700"><td className="py-2 font-bold">{key.replace('::', ' / ')}</td><td>{metric.independentSlates}</td><td>{metric.playerRows}</td><td>{formatMetric(metric.candidateMae)}</td><td>{formatMetric(metric.baselineMae)}</td><td>{formatPercent(metric.relativeMaeImprovement)}</td><td>{metric.status.replaceAll('_', ' ')}</td></tr>)}</tbody></table></div> : <p className="mt-3 text-xs text-slate-500">No paired holdout rows are available yet.</p>}
          <p className="mt-3 text-[10px] leading-5 text-slate-500">{pairedBaseline.note} Release state: {pairedBaseline.releaseStatus}.</p>
        </> : <p className="mt-3 text-sm text-slate-500">Loading paired holdout evaluation…</p>}
      </section>
      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-[var(--shadow-subtle)]">
        <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Lesson candidates</p>
        <h2 className="mt-2 text-xl font-black text-[#0b1f3a]">Recurring patterns across recorded results.</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Every non-variance diagnosis from a recorded contest result accumulates here by sport, stage, and observation.
          A lesson moves from Observed to Accumulating once the same pattern has been seen 3+ times; promoting a lesson to
          Validated is a manual review step, not automatic.
        </p>
        {lessonsError ? (
          <div className="mt-4"><ErrorBox message={lessonsError} /></div>
        ) : lessons.length ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {lessons.map((lesson) => (
              <div key={lesson.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">{lesson.sport} · {lesson.stage}</span>
                  <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-slate-600">{lesson.status}</span>
                </div>
                <p className="mt-2 text-sm text-slate-800">{lesson.observation}</p>
                <p className="mt-1 text-xs text-slate-500">{lesson.proposed_change}</p>
                <p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">Seen {lesson.sample_count}×{lesson.confidence ? ` · ${lesson.confidence} confidence` : ''}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">No lesson candidates yet — these accumulate as contest results are recorded in History.</p>
        )}
      </section>
    </AppPage>
  );
}

function formatMetric(value: number | null): string { return value === null ? '—' : value.toFixed(2); }
function formatPercent(value: number | null): string { return value === null ? '—' : `${Math.round(value * 100)}%`; }
