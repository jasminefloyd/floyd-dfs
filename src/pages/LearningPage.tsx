import { useEffect, useState } from 'react';
import { AppPage, ErrorBox } from '../components/AppPrimitives';
import { floydRequest } from '../lib/floydDfsClient';

interface Lesson { id: string; sport: string; stage: string; status: string; sample_count: number; observation: string; proposed_change: string; confidence?: string; }

export default function LearningPage() {
  const [runId, setRunId] = useState('');
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [lessonsError, setLessonsError] = useState<string | null>(null);

  useEffect(() => {
    floydRequest<{ lessons: Lesson[] }>('/api/learning/lessons')
      .then((data) => setLessons(data.lessons ?? []))
      .catch((reason) => setLessonsError(reason instanceof Error ? reason.message : 'Unable to load lesson candidates.'));
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
