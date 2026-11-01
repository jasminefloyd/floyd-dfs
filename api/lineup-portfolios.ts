import type { VercelRequest, VercelResponse } from '@vercel/node';
import { method, requireOwnedRun, respondError, tenantContext } from '../server/runtime.js';
import { isFeatureEnabled } from '../server/featureFlags.js';

/** Read the immutable portfolio produced by a completed generation run. */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!method(req, res, ['GET'])) return;
  try {
    const context = await tenantContext(req);
    const runId = String(req.query.runId ?? '').trim();
    if (!runId) throw new Error('runId is required.');
    const run = await requireOwnedRun(context, runId);
    const portfolio = await context.db.from('floyd_dfs_lineup_portfolios').select('*').eq('tenant_id', context.tenantId).eq('generation_run_id', runId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (portfolio.error) throw portfolio.error;
    if (!portfolio.data) { res.status(200).json({ portfolio: null, members: [], payoutReadiness: 'UNAVAILABLE' }); return; }
    const members = await context.db.from('floyd_dfs_portfolio_members').select('lineup_id,lineup_revision,entry_status,settlement_status,estimated_payout,actual_payout,refund_amount,entry_fee,created_at').eq('tenant_id', context.tenantId).eq('portfolio_id', portfolio.data.id).order('lineup_revision', { ascending: false });
    if (members.error) throw members.error;
    const latestMembers = new Map<string, Record<string, unknown>>();
    for (const member of members.data ?? []) if (!latestMembers.has(String(member.lineup_id))) latestMembers.set(String(member.lineup_id), member as Record<string, unknown>);
    const request = run.request_payload && typeof run.request_payload === 'object' ? run.request_payload as Record<string, unknown> : {};
    const runInput = request.input && typeof request.input === 'object' ? request.input as Record<string, unknown> : {};
    const slate = runInput.validatedSlate && typeof runInput.validatedSlate === 'object' ? runInput.validatedSlate as Record<string, unknown> : {};
    const contest = slate.contest && typeof slate.contest === 'object' ? slate.contest as Record<string, unknown> : {};
    const lockAt = typeof contest.lockTime === 'string' ? Date.parse(contest.lockTime) : NaN;
    const now = Date.now();
    for (const member of latestMembers.values()) {
      let settlementStatus = String(member.settlement_status ?? (member.entry_status === 'ENTERED' ? 'ENTERED' : 'NOT_ENTERED'));
      if (member.entry_status === 'ENTERED' && settlementStatus === 'ENTERED' && Number.isFinite(lockAt) && now >= lockAt) settlementStatus = 'LOCKED';
      member.settlement_status = settlementStatus;
      const payout = finiteNonnegative(member.actual_payout); const refund = finiteNonnegative(member.refund_amount); const fee = finiteNonnegative(member.entry_fee);
      member.net_profit = settlementStatus === 'VERIFIED' && payout !== null && refund !== null && fee !== null ? payout + refund - fee : null;
      member.realized_roi = settlementStatus === 'VERIFIED' && payout !== null && refund !== null && fee !== null && fee > 0 ? (payout + refund - fee) / fee : null;
    }
    const lineups: Record<string, unknown>[] = [];
    const lineupIds = [...latestMembers.keys()];
    for (let offset = 0; offset < lineupIds.length; offset += 300) {
      const rows = await context.db.from('floyd_dfs_generated_lineups').select('id,status,entered_at,lineup_payload').eq('tenant_id', context.tenantId).in('id', lineupIds.slice(offset, offset + 300));
      if (rows.error) throw rows.error;
      lineups.push(...(rows.data ?? []));
    }
    const financialEstimates = isFeatureEnabled('PORTFOLIO_EV_V1') && portfolio.data.field_model_status === 'CALIBRATED' ? 'CALIBRATED' : 'UNAVAILABLE';
    res.status(200).json({ portfolio: portfolio.data, members: [...latestMembers.values()], lineups, payoutReadiness: portfolio.data.payout_status, financialEstimates, financialEstimateRelease: isFeatureEnabled('PORTFOLIO_EV_V1') ? 'ENABLED' : 'DISABLED_BY_ROLLBACK_SWITCH' });
  } catch (error) { respondError(req, res, error); }
}

function finiteNonnegative(value: unknown): number | null { const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN; return Number.isFinite(parsed) && parsed >= 0 ? parsed : null; }
