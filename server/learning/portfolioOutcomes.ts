import type { SupabaseClient } from '@supabase/supabase-js';

/** Copy only reconciled official outcomes into the latest entered portfolio revision. */
export async function syncVerifiedPortfolioOutcome(db: SupabaseClient, input: {
  tenantId: string;
  lineupId: string;
  resultId: string;
}): Promise<{ updated: boolean; reason?: string }> {
  const result = await db.from('floyd_dfs_contest_results')
    .select('payout,entry_fee,official_outcome,reconciliation_status')
    .eq('tenant_id', input.tenantId)
    .eq('id', input.resultId)
    .maybeSingle();
  if (result.error) throw result.error;
  if (result.data?.official_outcome !== true || result.data?.reconciliation_status !== 'MATCHED') {
    return { updated: false, reason: 'Outcome is not official and reconciled.' };
  }
  const payout = finiteNonnegative(result.data.payout);
  if (payout === null) return { updated: false, reason: 'Reconciled result has no payout value.' };

  const member = await db.from('floyd_dfs_portfolio_members')
    .select('portfolio_id,lineup_revision')
    .eq('tenant_id', input.tenantId)
    .eq('lineup_id', input.lineupId)
    .eq('entry_status', 'ENTERED')
    .order('lineup_revision', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (member.error) throw member.error;
  if (!member.data) return { updated: false, reason: 'No entered portfolio revision exists for this lineup.' };

  const entryFee = finiteNonnegative(result.data.entry_fee);
  const update = await db.from('floyd_dfs_portfolio_members')
    .update({ actual_payout: payout, ...(entryFee === null ? {} : { entry_fee: entryFee }) })
    .eq('tenant_id', input.tenantId)
    .eq('portfolio_id', member.data.portfolio_id)
    .eq('lineup_id', input.lineupId)
    .eq('lineup_revision', member.data.lineup_revision);
  if (update.error) throw update.error;
  return { updated: true };
}

function finiteNonnegative(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
