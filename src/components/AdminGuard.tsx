import { useEffect, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';

interface AdminGuardProps {
  children: ReactNode;
}

type GuardState = 'checking' | 'allowed' | 'denied';

export function AdminGuard({ children }: AdminGuardProps) {
  const [state, setState] = useState<GuardState>('checking');

  useEffect(() => {
    let mounted = true;

    async function checkAdmin() {
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData.user?.id;
      if (!userId) {
        if (mounted) setState('denied');
        return;
      }

      const { data, error } = await supabase.rpc('fantasy_ai_get_admin_status', { p_user_id: userId });
      if (mounted) setState(!error && data === true ? 'allowed' : 'denied');
    }

    void checkAdmin();
    return () => {
      mounted = false;
    };
  }, []);

  if (state === 'checking') {
    return <div className="p-6 text-sm text-slate-600">Checking admin access...</div>;
  }

  if (state === 'denied') return <Navigate to="/" replace />;
  return children;
}
