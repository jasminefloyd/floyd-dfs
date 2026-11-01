import { useEffect, useState } from 'react';
import { AppPage, ErrorBox } from '../components/AppPrimitives';
import { floydRequest } from '../lib/floydDfsClient';
import { ModelChangeProposals } from '../components/ModelChangeProposals';

interface Lesson { id: string; sport: string; stage: string; status: string; sample_count: number; observation: string; proposed_change: string; confidence?: string; }
interface ForecastSummary { sampleSize: number; meanAbsoluteError: number | null; meanBias: number | null; p20Coverage: number | null; p50Coverage: number | null; p90Coverage: number | null; validationStatus: string; }
interface ForecastValidation { overall: ForecastSummary; bySport: Record<string, ForecastSummary>; note: string; }
interface PairedMetric { playerRows: number; independentSlates: number; candidateMae: number | null; candidateRmse: number | null; candidateBias: number | null; baselineMae: number | null; relativeMaeImprovement: number | null; candidateQuantileCoverage: { p20: number | null; p50: number | null; p90: number | null }; status: string; }
interface PairedBaseline { cutoff: string; holdout: PairedMetric; holdoutBySport: Record<string, PairedMetric>; holdoutBySportAndRole: Record<string, PairedMetric>; releaseStatus: string; note: string; }
interface GameMetric { scenarioPlayerRows: number; independentSlates: number; meanAbsoluteError: number | null; meanBias: number | null; crps: number | null; p10Coverage: number | null; p20Coverage: number | null; p50Coverage: number | null; p80Coverage: number | null; p90Coverage: number | null; centralIntervalCoverage?: { '50': number | null; '80': number | null; '90': number | null }; }
interface GameValidation { cutoff: string; pairedPlayerRows: number; releaseDecision: string; bySportFormat: Record<string, { sport: string; format: string; holdout: { baseline: GameMetric; gameSimulation: GameMetric; relativeCrpsImprovement: number | null; materialCalibrationRegression: boolean }; threshold: { minimumIndependentSlates: number; minimumPlayerRows: number; minimumCrpsImprovement: number; maximumAbsoluteIntervalCoverageRegression: number }; status: string; releaseDecision: string }>; note: string; }
interface LearningAudit { evaluations: Array<Record<string, unknown>>; registry: Array<Record<string, unknown>>; portfolioPerformance: Array<Record<string, unknown>>; nbaHouseShadowParity: Array<Record<string, unknown>>; rollout: { featureFlags: Record<string, boolean>; productionCutover: string; canarySportScope: string; canaryRuntimeAdapter: string; legacyGenerationRoute: string }; promotionRelease: string; }
interface EvaluationDiagnostics { datasetSha256: string; sampleSize: number; independentSlates: number; exclusions: Record<string, number>; projection: { mae: number | null; rmse: number | null; bias: number | null; mae95Ci: { lower: number; upper: number } | null; bias95Ci: { lower: number; upper: number } | null }; contestStrategy: { verifiedEntries: number; cashRate: number | null; realizedNet: number | null }; }

export default function LearningPage() {
  const [runId, setRunId] = useState('');
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [lessonsError, setLessonsError] = useState<string | null>(null);
  const [forecastValidation, setForecastValidation] = useState<ForecastValidation | null>(null);
  const [evaluationDiagnostics, setEvaluationDiagnostics] = useState<EvaluationDiagnostics | null>(null);
  const [pairedBaseline, setPairedBaseline] = useState<PairedBaseline | null>(null);
  const [gameValidation, setGameValidation] = useState<GameValidation | null>(null);
  const [savingEvaluation, setSavingEvaluation] = useState(false);
  const [evaluationSaved, setEvaluationSaved] = useState<string | null>(null);
  const [contestId, setContestId] = useState('');
  const [fieldValidation, setFieldValidation] = useState<Record<string, unknown> | null>(null);
  const [forecastError, setForecastError] = useState<string | null>(null);
  const [learningAudit, setLearningAudit] = useState<LearningAudit | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);

  useEffect(() => {
    floydRequest<{ lessons: Lesson[] }>('/api/learning/lessons')
      .then((data) => setLessons(data.lessons ?? []))
      .catch((reason) => setLessonsError(reason instanceof Error ? reason.message : 'Unable to load lesson candidates.'));
  }, []);

  useEffect(() => {
    floydRequest<{ projectionValidation: ForecastValidation; evaluationDiagnostics: EvaluationDiagnostics; pairedBaseline: PairedBaseline; gameSimulationValidation: GameValidation }>('/api/learning/calibration')
      .then((data) => { setForecastValidation(data.projectionValidation); setEvaluationDiagnostics(data.evaluationDiagnostics); setPairedBaseline(data.pairedBaseline); setGameValidation(data.gameSimulationValidation); })
      .catch((reason) => setForecastError(reason instanceof Error ? reason.message : 'Unable to load projection validation.'));
  }, []);

  useEffect(() => {
    floydRequest<LearningAudit>('/api/model-evaluations')
      .then(setLearningAudit)
      .catch((reason) => setAuditError(reason instanceof Error ? reason.message : 'Unable to load model registry and portfolio results.'));
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

  async function saveModelEvaluation() {
    setSavingEvaluation(true); setForecastError(null); setEvaluationSaved(null);
    try {
      const data = await floydRequest<{ projectionValidation: ForecastValidation; evaluationDiagnostics: EvaluationDiagnostics; pairedBaseline: PairedBaseline; gameSimulationValidation: GameValidation; evaluationArtifacts: Array<{ sport: string; format: string; sampleCount: number; status: string }> }>('/api/learning/calibration', { method: 'POST', body: JSON.stringify({ saveEvaluationOnly: true }) });
      setForecastValidation(data.projectionValidation); setEvaluationDiagnostics(data.evaluationDiagnostics); setPairedBaseline(data.pairedBaseline); setGameValidation(data.gameSimulationValidation);
      setEvaluationSaved(`Saved ${data.evaluationArtifacts.length} tenant-scoped evaluation snapshots. All release decisions remain HOLD.`);
    } catch (reason) { setForecastError(reason instanceof Error ? reason.message : 'Unable to save the evaluation snapshot.'); }
    finally { setSavingEvaluation(false); }
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
          {error ? <div className="mt-3"><ErrorBox message={error} /></div> : result ? <><p role="status" aria-live="polite" className="mt-3 text-sm font-bold text-emerald-800">Readiness check completed. See decision and follow-up items below.</p><details className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3"><summary className="cursor-pointer text-xs font-bold">Technical response details</summary><pre className="mt-3 max-h-64 overflow-auto text-xs text-slate-700">{JSON.stringify(result, null, 2)}</pre></details>{runId.trim() && result.replacementsAvailableBeforeLock === true ? <button type="button" onClick={() => void refreshRun()} disabled={refreshing} className="mt-3 rounded-md bg-[#0b1f3a] px-4 py-2.5 text-xs font-black text-white disabled:opacity-50">{refreshing ? 'Queueing replacement…' : 'Re-optimize from current DraftKings slate'}</button> : null}</> : <p className="mt-3 text-sm text-slate-500" role="status">No check has been run in this session.</p>}
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
          {evaluationDiagnostics ? <div className="mt-4 rounded-lg border border-cyan-200 bg-cyan-50 p-3"><h3 className="text-xs font-black uppercase text-cyan-950">Canonical pre-lock forecast join</h3><p className="mt-1 text-xs text-cyan-900">{evaluationDiagnostics.sampleSize} verified forecast/actual player rows · {evaluationDiagnostics.independentSlates} independent slates · MAE {formatMetric(evaluationDiagnostics.projection.mae)} · RMSE {formatMetric(evaluationDiagnostics.projection.rmse)} · bias {formatMetric(evaluationDiagnostics.projection.bias)}.</p><p className="mt-1 break-all font-mono text-[10px] text-cyan-900">Dataset SHA-256: {evaluationDiagnostics.datasetSha256}</p><p className="mt-1 text-xs text-cyan-900">Verified entered contest results: {evaluationDiagnostics.contestStrategy.verifiedEntries} · cash rate {formatPercent(evaluationDiagnostics.contestStrategy.cashRate)} · realized net {evaluationDiagnostics.contestStrategy.realizedNet === null ? 'pending / unavailable' : `$${evaluationDiagnostics.contestStrategy.realizedNet.toFixed(2)}`}</p><details className="mt-2"><summary className="cursor-pointer text-[10px] font-bold">Excluded record counts</summary><ul className="mt-1 list-disc pl-5 text-[10px] text-cyan-950">{Object.entries(evaluationDiagnostics.exclusions).map(([reason, count]) => <li key={reason}>{reason.replaceAll('_', ' ').toLowerCase()}: {count}</li>)}</ul></details></div> : null}
        </> : <p className="mt-3 text-sm text-slate-500" role="status">Loading saved result coverage…</p>}
      </section>
      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-[var(--shadow-subtle)]">
        <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Contest field diagnostic</p>
        <h2 className="mt-2 text-xl font-black text-[#0b1f3a]">Compare ownership with actual standings.</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">Import a completed standings CSV from History, then compare actual player ownership with the archived pre-lock estimates. One contest remains diagnostic and cannot enable win probabilities.</p>
        <div className="mt-3 flex flex-wrap gap-2"><input value={contestId} onChange={(event) => setContestId(event.target.value)} placeholder="DraftKings contest ID" className="min-w-56 rounded-md border border-slate-300 px-3 py-2 text-sm" /><button type="button" onClick={() => void validateField()} disabled={!contestId.trim()} className="rounded-md bg-[#0b1f3a] px-4 py-2 text-xs font-black text-white disabled:opacity-50">Run field diagnostic</button></div>
        {fieldValidation ? <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3"><summary className="cursor-pointer text-xs font-bold">Technical field diagnostic details</summary><pre className="mt-3 max-h-64 overflow-auto text-xs text-slate-700">{JSON.stringify(fieldValidation, null, 2)}</pre></details> : null}
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
        <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Connected game-simulation validation</p>
        <h2 className="mt-2 text-xl font-black text-[#0b1f3a]">Compare game scenarios with the saved baseline.</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">Uses pre-lock scenario samples and verified final player stats, paired by generation run and player. A slate is counted once regardless of player rows. NFL secondary-source player stats support player projection evaluation only; they do not validate DraftKings standings, contest rank, or payouts.</p>
        {gameValidation ? <>
          <p className="mt-3 text-xs font-bold text-amber-800">Holdout starts {new Date(gameValidation.cutoff).toLocaleDateString()} · decision: {gameValidation.releaseDecision} · {gameValidation.pairedPlayerRows} paired player rows</p>
          <button type="button" onClick={() => void saveModelEvaluation()} disabled={savingEvaluation} className="mt-3 rounded-md bg-[#0b1f3a] px-4 py-2 text-xs font-black text-white disabled:opacity-50">{savingEvaluation ? 'Saving evaluation…' : 'Save evaluation snapshot'}</button>
          {evaluationSaved ? <p className="mt-2 text-xs font-bold text-emerald-800">{evaluationSaved}</p> : null}
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(gameValidation.bySportFormat).map(([key, report]) => <div key={key} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-2"><p className="text-xs font-black uppercase tracking-wide text-[#0b1f3a]">{report.sport} · {report.format}</p><span className="text-[9px] font-black uppercase text-amber-700">{report.status.replaceAll('_', ' ')}</span></div>
              <p className="mt-2 text-xs text-slate-600">{report.holdout.gameSimulation.independentSlates} slates · {report.holdout.gameSimulation.scenarioPlayerRows} players</p>
              <p className="mt-1 text-xs text-slate-600">CRPS baseline {formatMetric(report.holdout.baseline.crps)} · scenarios {formatMetric(report.holdout.gameSimulation.crps)} · improvement {formatPercent(report.holdout.relativeCrpsImprovement)}</p>
              <p className="mt-1 text-[10px] text-slate-500">Scenario bias {formatMetric(report.holdout.gameSimulation.meanBias)} · central 50/80/90% interval coverage {formatPercent(report.holdout.gameSimulation.centralIntervalCoverage?.['50'] ?? null)} / {formatPercent(report.holdout.gameSimulation.centralIntervalCoverage?.['80'] ?? null)} / {formatPercent(report.holdout.gameSimulation.centralIntervalCoverage?.['90'] ?? null)}</p>
              <p className="mt-1 text-[10px] text-slate-500">Requires {report.threshold.minimumIndependentSlates} independent slates, {report.threshold.minimumPlayerRows} players, {formatPercent(report.threshold.minimumCrpsImprovement)} CRPS improvement, no interval coverage regression above {formatPercent(report.threshold.maximumAbsoluteIntervalCoverageRegression)}, and independent review.</p>
            </div>)}
          </div>
          {!Object.keys(gameValidation.bySportFormat).length ? <p className="mt-3 text-xs text-slate-500">No eligible game-simulation forecast and actual pairs are available yet.</p> : null}
          <p className="mt-3 text-[10px] leading-5 text-slate-500">{gameValidation.note}</p>
        </> : <p className="mt-3 text-sm text-slate-500">Loading game-simulation evaluation…</p>}
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
      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-[var(--shadow-subtle)]">
        <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Model registry and realized portfolio results</p>
        <h2 className="mt-2 text-xl font-black text-[#0b1f3a]">Review versioned evidence.</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">Evaluations and model status are tenant scoped. Portfolio returns appear only when the entry is linked to a complete full-field import and its official result reconciles to verified player actuals.</p>
        {auditError ? <div className="mt-3"><ErrorBox message={auditError} /></div> : learningAudit ? <>
          <p className="mt-3 text-[10px] font-bold text-slate-500">{learningAudit.promotionRelease}</p>
          <div className="mt-3 rounded-lg border border-cyan-200 bg-cyan-50 p-3"><p className="text-xs font-black uppercase text-cyan-950">Rollout controls</p><p className="mt-1 text-xs text-cyan-900">Production cutover: {learningAudit.rollout.productionCutover} · canary scope: {learningAudit.rollout.canarySportScope} · runtime adapter: {learningAudit.rollout.canaryRuntimeAdapter} · legacy route: {learningAudit.rollout.legacyGenerationRoute}</p><p className="mt-1 text-[10px] text-cyan-900">Rollback flags: {Object.entries(learningAudit.rollout.featureFlags).map(([flag, enabled]) => `${flag}=${enabled ? 'on' : 'off'}`).join(' · ')}</p></div>
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-black uppercase text-[#0b1f3a]">NBA House shadow parity</p><p className="mt-1 text-[10px] text-slate-500">Side-by-side saved projection output only; these deltas are not outcome validation.</p>{learningAudit.nbaHouseShadowParity.length ? learningAudit.nbaHouseShadowParity.slice(0, 20).map((row, index) => <p key={String(row.reportId ?? index)} className="mt-2 text-xs text-slate-700">{String(row.createdAt)} · {String(row.trustStatus)} · {String(row.pairedPlayers)} paired / {String(row.changedPlayers)} changed · mean |median delta| {row.meanAbsoluteMedianDelta === null ? '—' : Number(row.meanAbsoluteMedianDelta).toFixed(2)} · {String(row.modelVersion)}</p>) : <p className="mt-2 text-xs text-slate-500">No NBA House shadow reports have been recorded.</p>}</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-black uppercase text-[#0b1f3a]">Model versions</p>{learningAudit.registry.length ? learningAudit.registry.map((row, index) => <p key={String(row.id ?? index)} className="mt-2 text-xs text-slate-700">{String(row.sport)} · {String(row.component)} · {String(row.model_version)} · {String(row.status)}</p>) : <p className="mt-2 text-xs text-slate-500">No registered candidate versions.</p>}</div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-black uppercase text-[#0b1f3a]">Portfolio results</p>{learningAudit.portfolioPerformance.length ? learningAudit.portfolioPerformance.map((row, index) => <p key={String(row.id ?? index)} className="mt-2 text-xs text-slate-700">{String(row.objective)} · {String(row.reconciledOfficialEntries)}/{String(row.enteredEntries)} entries reconciled · net {row.realizedNet === null ? '—' : `$${Number(row.realizedNet).toFixed(2)}`} · ROI {row.realizedRoi === null ? '—' : formatPercent(Number(row.realizedRoi))}</p>) : <p className="mt-2 text-xs text-slate-500">No saved portfolios.</p>}</div>
          </div>
          <p className="mt-3 text-xs text-slate-500">{learningAudit.evaluations.length} stored evaluation snapshots. Release decisions remain subject to an explicit operator review.</p>
          <details className="mt-3 rounded-lg border border-slate-200 bg-white p-3"><summary className="cursor-pointer text-xs font-bold">Evaluation review history · {learningAudit.evaluations.length}</summary><ol className="mt-2 max-h-64 space-y-2 overflow-auto">{learningAudit.evaluations.slice(0, 30).map((item, index) => <li key={String(item.id ?? index)} className="border-t border-slate-100 pt-2 text-xs"><p className="font-bold">{String(item.sport)} · {String(item.component)} · {String(item.candidate_model_version ?? item.model_version)} · {String(item.gate_decision ?? 'HOLD')}</p><p className="text-slate-500">{String(item.reviewed_at ?? 'Not reviewed')} · {String(item.sample_count ?? 0)} rows{item.reviewed_by ? ` · reviewer ${String(item.reviewed_by)}` : ''}</p>{item.review_note ? <p className="mt-1 text-slate-700">{String(item.review_note)}</p> : <p className="mt-1 text-slate-500">No review note recorded.</p>}</li>)}</ol></details>
        </> : <p className="mt-3 text-sm text-slate-500">Loading versioned model evidence…</p>}
      </section>
      <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-5">
        <p className="text-[10px] font-black uppercase tracking-wide text-amber-800">Model change control</p>
        <h2 className="mt-2 text-lg font-black text-amber-950">Diagnoses are hypotheses; promotions need a fresh holdout.</h2>
        <p className="mt-2 text-sm leading-6 text-amber-950">Test one sport, role, and model-stage change at a time against the same saved slates. The September 8, 2026 holdout has already been displayed, so it cannot be treated as unseen after tuning. Set a future cutoff before the next experiment; require clean actual-source audits, at least 30 independent slates and 100 player rows per sport, and at least 3% MAE improvement without hiding worse range or role calibration. Contest outcomes and win probabilities require their own complete, held-out standings review.</p>
        <p className="mt-3 text-xs font-bold text-amber-900">Engineering checklist: <code>docs/model-change-control.md</code>.</p>
      </section>
      <ModelChangeProposals />
    </AppPage>
  );
}

function formatMetric(value: number | null): string { return value === null ? '—' : value.toFixed(2); }
function formatPercent(value: number | null): string { return value === null ? '—' : `${Math.round(value * 100)}%`; }
