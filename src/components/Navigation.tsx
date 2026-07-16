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
    <nav className="border-b border-gray-200 bg-white px-4 py-3 text-gray-900 shadow-[var(--shadow-subtle)] sm:px-6">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4 sm:gap-8">
          <Link
            to="/"
            className="text-lg font-black tracking-wide text-gray-950 transition-colors duration-[var(--transition-fast)] hover:text-green-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-success"
          >
            FLOYD DFS
          </Link>
          <Link
            to="/"
            className="rounded-full border border-green-200 bg-green-50 px-3 py-1 text-sm font-semibold text-green-700 transition-colors duration-[var(--transition-fast)] hover:border-green-500 hover:bg-green-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-success"
          >
            Scan
          </Link>
          {isAdmin ? (
            <Link
              to="/admin/design-system"
              className="rounded-full border border-gray-200 px-3 py-1 text-sm text-gray-600 transition-colors duration-[var(--transition-fast)] hover:border-green-500 hover:text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-success"
            >
              Admin
            </Link>
          ) : null}
        </div>
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">{email ?? 'Guest Mode'}</span>
        </div>
      </div>
    </nav>
  );
}
