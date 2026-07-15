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
    <nav className="bg-white border-b border-gray-200 px-6 py-4">
      <div className="flex items-center justify-between max-w-7xl mx-auto">
        <div className="flex items-center space-x-8">
          <Link
            to="/"
            className="font-bold text-lg text-primary hover:underline transition-colors duration-[var(--transition-fast)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Fantasy AI
          </Link>
          <Link
            to="/"
            className="text-gray-700 hover:text-gray-900 hover:underline transition-colors duration-[var(--transition-fast)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Scan
          </Link>
          {isAdmin ? (
            <Link
              to="/admin/design-system"
              className="text-gray-700 hover:text-gray-900 hover:underline text-sm transition-colors duration-[var(--transition-fast)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              Admin
            </Link>
          ) : null}
        </div>
        <div>
          <span className="text-gray-600">{email ?? 'Not logged in'}</span>
        </div>
      </div>
    </nav>
  );
}
