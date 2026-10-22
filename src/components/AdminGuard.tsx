import { useEffect, useState, type ReactNode } from 'react';
import { floydRequest } from '../lib/floydDfsClient';

export function AdminGuard({ children }: { children: ReactNode }) {
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => { void floydRequest<{ settings: { role?: string } }>('/api/settings').then((value) => setAllowed(value.settings.role === 'operator')).catch(() => setAllowed(false)).finally(() => setLoading(false)); }, []);
  if (loading) return <div className="min-h-64" />;
  if (!allowed) return <main className="mx-auto max-w-3xl px-6 py-16 text-center"><h1 className="text-2xl font-bold">Operator access required</h1><p className="mt-2 text-slate-500">This account is not configured for operator tools.</p></main>;
  return <>{children}</>;
}
