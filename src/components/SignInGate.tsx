import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { supabase } from '../lib/supabaseClient';

export function SignInGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!supabase) { setReady(true); return; }
    void supabase.auth.getSession().then(({ data }) => { setSignedIn(Boolean(data.session)); setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setSignedIn(Boolean(session)));
    return () => data.subscription.unsubscribe();
  }, []);
  async function signIn(event: FormEvent) {
    event.preventDefault(); setError('');
    if (!supabase) { setError('Authentication is not configured for this deployment.'); return; }
    const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (authError) setError(authError.message);
  }
  if (!ready) return <div className="min-h-screen bg-[#07172c]" />;
  if (signedIn) return <>{children}</>;
  return <main className="min-h-screen bg-[#07172c] text-white flex items-center justify-center px-5"><form onSubmit={signIn} className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[.04] p-7 shadow-2xl"><p className="text-xs font-bold tracking-[.22em] text-cyan-300">FLOYD DFS</p><h1 className="mt-3 text-2xl font-bold">Sign in</h1><p className="mt-2 text-sm text-slate-300">Use your Floyd DFS account to continue.</p><label className="mt-6 block text-sm">Email<input required type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-lg bg-slate-900 px-3 py-2 text-white" /></label><label className="mt-4 block text-sm">Password<input required type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded-lg bg-slate-900 px-3 py-2 text-white" /></label>{error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}<button className="mt-6 w-full rounded-lg bg-cyan-300 px-4 py-2 font-bold text-slate-950">Sign in</button></form></main>;
}
