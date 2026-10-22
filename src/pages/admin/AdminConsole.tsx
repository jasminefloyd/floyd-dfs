import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { authenticatedHeaders } from '../../lib/supabaseClient';

interface AdminConsoleProps {
  children?: React.ReactNode;
}

export default function AdminConsole({ children }: AdminConsoleProps) {
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [auditBusy, setAuditBusy] = useState(false);
  const [auditError, setAuditError] = useState('');
  const refreshHealth = async () => {
    try { const headers = await authenticatedHeaders(); const response = await fetch('/api/maintenance/draftkings-audit?status=1', { headers }); if (!response.ok) throw new Error(`Health request failed (${response.status}).`); setHealth(await response.json()); setAuditError(''); }
    catch (error) { setAuditError(error instanceof Error ? error.message : 'Could not load provider health.'); }
  };
  useEffect(() => { void refreshHealth(); }, []);
  const runDiagnostic = async () => {
    setAuditBusy(true); setAuditError('');
    try { const headers = await authenticatedHeaders({ 'content-type': 'application/json' }); const response = await fetch('/api/maintenance/draftkings-audit', { method: 'POST', headers }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? `Audit failed (${response.status}).`); setHealth((current) => ({ ...(current ?? {}), latestDiagnostic: result })); await refreshHealth(); }
    catch (error) { setAuditError(error instanceof Error ? error.message : 'Audit failed.'); }
    finally { setAuditBusy(false); }
  };
  const latest = health?.lastAudit as Record<string, unknown> | null | undefined;
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Admin Console</h1>
            <p className="text-sm text-gray-600">Fantasy AI operations and internal tools</p>
          </div>
          <nav className="flex gap-3 text-sm">
            <Link to="/admin/design-system" className="text-primary hover:underline">
              Design System
            </Link>
          </nav>
        </div>
      </div>
      <main>
        {children}
        <section className="mx-auto my-8 max-w-7xl rounded-xl border border-gray-200 bg-white p-5" aria-labelledby="provider-health-title">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 id="provider-health-title" className="text-lg font-semibold text-gray-900">DraftKings provider health</h2><p className="text-sm text-gray-600">Monthly compatibility audit: 14:00 UTC on the first day of each month.</p></div><button type="button" onClick={() => void runDiagnostic()} disabled={auditBusy} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{auditBusy ? 'Running audit…' : 'Run diagnostic audit'}</button></div>
          {auditError && <p role="alert" className="mt-3 text-sm text-red-700">{auditError}</p>}
          <div className="mt-4 grid gap-2 text-sm text-gray-700 sm:grid-cols-2"><p>Last scheduled audit: {String(latest?.completed_at ?? 'No completed audit')}</p><p>Current status: {String(latest?.status ?? 'UNKNOWN')}</p><p>Expected next run: {String(health?.expectedNextAuditAt ?? 'Loading')}</p><p>Independent missed-run monitor: not configured</p></div>
          {latest?.result !== null && latest?.result !== undefined ? <pre className="mt-4 max-h-64 overflow-auto rounded bg-gray-50 p-3 text-xs">{JSON.stringify(latest.result, null, 2)}</pre> : null}
        </section>
      </main>
    </div>
  );
}
