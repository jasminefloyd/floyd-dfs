import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';

export default function Navigation() {
  const [email, setEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadUser() {
      const { data: authData } = await supabase.auth.getUser();
      const user = authData.user;
      if (!mounted || !user) return;
      setEmail(user.email ?? null);

      const { data } = await supabase.rpc('fantasy_ai_get_admin_status', { p_user_id: user.id });
      if (mounted) setIsAdmin(data === true);
    }

    void loadUser();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <nav className="bg-[#0b1f3a] px-3 py-3 text-white sm:px-6">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3 sm:gap-6">
          <Link
            to="/"
            className="min-w-0 text-base font-black tracking-wide text-white transition-colors duration-[var(--transition-fast)] hover:text-cyan-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 sm:text-lg"
          >
            FLOYD DFS
          </Link>
          <Link
            to="/"
            className="rounded-md border border-cyan-300/40 bg-cyan-300/10 px-3 py-1.5 text-xs font-black uppercase tracking-wide text-cyan-100 transition-colors duration-[var(--transition-fast)] hover:border-cyan-200 hover:bg-cyan-300/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
          >
            Scan
          </Link>
          {isAdmin ? (
            <Link
              to="/admin/design-system"
              className="rounded-md border border-white/15 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-blue-100 transition-colors duration-[var(--transition-fast)] hover:border-cyan-200 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
            >
              Admin
            </Link>
          ) : null}
        </div>
        <div className="min-w-0">
          <span className="block max-w-[116px] truncate text-right text-[10px] font-bold uppercase tracking-wide text-blue-200 sm:max-w-none sm:text-xs">{email ?? 'Guest Mode'}</span>
        </div>
      </div>
    </nav>
  );
}
