import { useState } from 'react';
import { AppPage, ErrorBox } from '../components/AppPrimitives';
import { floydRequest } from '../lib/floydDfsClient';

export default function LearningPage() {
  const [runId, setRunId] = useState('');
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
          {error ? <div className="mt-3"><ErrorBox message={error} /></div> : result ? <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{JSON.stringify(result, null, 2)}</pre> : <p className="mt-3 text-sm text-slate-500">No check has been run in this session.</p>}
        </section>
      </div>
    </AppPage>
  );
}
