import type { SupabaseClient } from '@supabase/supabase-js';
import type { VerifiedContestOutcome } from './diagnostics.js';

interface LearningPortfolio { id: string; contest_id: string; }
interface LearningMember { portfolio_id: string; lineup_id: string; lineup_revision: number; entry_status: string; settlement_status?: string | null; entry_fee?: number | string | null; }
interface LearningEntryLink { generated_lineup_id: string; contest_id: string; external_entry_id: string; }
interface LearningResult { generated_lineup_id: string; contest_id: string; external_entry_id?: string | null; payout?: number | string | null; refund_amount?: number | string | null; entry_fee?: number | string | null; finish_position?: number | null; paid_positions?: number | null; official_outcome?: boolean; reconciliation_status?: string | null; model_evaluation_eligible?: boolean; finality_status?: string | null; revision?: number; measured_at?: string; }

/** Exact join from entered portfolio revision through the external DK ID to a verified settlement. */
export function joinVerifiedEnteredOutcomes(input: { portfolios: LearningPortfolio[]; members: LearningMember[]; entryLinks: LearningEntryLink[]; results: LearningResult[] }): VerifiedContestOutcome[] {
  const portfolios = new Map(input.portfolios.map((row) => [row.id, row]));
  const latest = new Map<string, LearningMember>();
  for (const member of [...input.members].sort((a, b) => b.lineup_revision - a.lineup_revision)) {
    const key = `${member.portfolio_id}:${member.lineup_id}`;
    if (!latest.has(key)) latest.set(key, member);
  }
  const results = new Map<string, LearningResult[]>();
  for (const result of input.results) {
    if (!result.external_entry_id) continue;
    const key = `${result.contest_id}:${result.external_entry_id}`;
    results.set(key, [...(results.get(key) ?? []), result]);
  }
  const outcomes: VerifiedContestOutcome[] = [];
  for (const member of latest.values()) {
    if (member.entry_status !== 'ENTERED' || member.settlement_status !== 'VERIFIED') continue;
    const portfolio = portfolios.get(member.portfolio_id);
    if (!portfolio?.contest_id) continue;
    const matchingLinks = (input.entryLinks).filter((link) => link.generated_lineup_id === member.lineup_id && link.contest_id === portfolio.contest_id);
    if (matchingLinks.length !== 1) continue;
    const link = matchingLinks[0]!;
    const matchingResults = [...(results.get(`${link.contest_id}:${link.external_entry_id}`) ?? [])].sort((a, b) => (Number(b.revision) || 0) - (Number(a.revision) || 0) || Date.parse(String(b.measured_at ?? '')) - Date.parse(String(a.measured_at ?? '')));
    const result = matchingResults[0];
    if (!result || result.generated_lineup_id !== member.lineup_id || result.official_outcome !== true || result.reconciliation_status !== 'MATCHED' || result.model_evaluation_eligible !== true || !['FINAL','CORRECTED'].includes(String(result.finality_status))) continue;
    const payout = finiteNonnegative(result.payout);
    const refund = finiteNonnegative(result.refund_amount);
    const fee = finiteNonnegative(result.entry_fee ?? member.entry_fee);
    if (payout === null || refund === null || fee === null) continue;
    outcomes.push({ entered: true, settlement: 'VERIFIED', contestId: link.contest_id, externalEntryId: link.external_entry_id, payout, refund, fee, finishPosition: finitePositiveInteger(result.finish_position), paidPositions: finitePositiveInteger(result.paid_positions) });
  }
  return outcomes;
}

export async function loadVerifiedEnteredPortfolioOutcomes(db: SupabaseClient, tenantId: string): Promise<VerifiedContestOutcome[]> {
  const [portfolios, members, entryLinks, results] = await Promise.all([
    queryAll((start, end) => db.from('floyd_dfs_lineup_portfolios').select('id,contest_id').eq('tenant_id', tenantId).range(start, end)),
    queryAll((start, end) => db.from('floyd_dfs_portfolio_members').select('portfolio_id,lineup_id,lineup_revision,entry_status,settlement_status,entry_fee').eq('tenant_id', tenantId).order('lineup_revision', { ascending: false }).range(start, end)),
    queryAll((start, end) => db.from('floyd_dfs_entry_links').select('generated_lineup_id,contest_id,external_entry_id').eq('tenant_id', tenantId).range(start, end)),
    queryAll((start, end) => db.from('floyd_dfs_contest_results').select('generated_lineup_id,contest_id,external_entry_id,payout,refund_amount,entry_fee,finish_position,paid_positions,official_outcome,reconciliation_status,model_evaluation_eligible,finality_status,revision,measured_at').eq('tenant_id', tenantId).eq('official_outcome', true).range(start, end)),
  ]);
  return joinVerifiedEnteredOutcomes({ portfolios, members, entryLinks, results });
}

/** Copy only reconciled official outcomes into the latest entered portfolio revision. */
export async function syncVerifiedPortfolioOutcome(db: SupabaseClient, input: {
  tenantId: string;
  lineupId: string;
  resultId: string;
}): Promise<{ updated: boolean; reason?: string }> {
  const result = await db.from('floyd_dfs_contest_results')
    .select('generated_lineup_id,contest_id,external_entry_id,payout,refund_amount,entry_fee,official_outcome,reconciliation_status')
    .eq('tenant_id', input.tenantId)
    .eq('id', input.resultId)
    .maybeSingle();
  if (result.error) throw result.error;
  if (String(result.data?.generated_lineup_id ?? '') !== input.lineupId || !result.data?.contest_id || !result.data?.external_entry_id) return { updated: false, reason: 'No exact DraftKings contest and external-entry identity is attached to this outcome.' };
  const entryLink = await db.from('floyd_dfs_entry_links').select('generated_lineup_id').eq('tenant_id', input.tenantId).eq('contest_id', result.data.contest_id).eq('external_entry_id', result.data.external_entry_id).maybeSingle();
  if (entryLink.error) throw entryLink.error;
  if (String(entryLink.data?.generated_lineup_id ?? '') !== input.lineupId) return { updated: false, reason: 'Contest result does not match the exact saved DraftKings entry link.' };
  const member = await db.from('floyd_dfs_portfolio_members')
    .select('portfolio_id,lineup_revision,entry_fee')
    .eq('tenant_id', input.tenantId)
    .eq('lineup_id', input.lineupId)
    .eq('entry_status', 'ENTERED')
    .order('lineup_revision', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (member.error) throw member.error;
  if (!member.data) return { updated: false, reason: 'No entered portfolio revision exists for this lineup.' };

  const reconciliation = String(result.data?.reconciliation_status ?? 'UNAVAILABLE');
  const official = result.data?.official_outcome === true;
  const settlementStatus = reconciliation === 'MISMATCH' || reconciliation === 'DISPUTED' ? 'DISPUTED'
    : official && reconciliation === 'MATCHED' ? 'VERIFIED'
      : reconciliation === 'MATCHED' ? 'RESULTS_PENDING' : 'PARTIAL';
  const values: Record<string, unknown> = { settlement_status: settlementStatus };
  if (official && reconciliation === 'MATCHED') {
    const payout = finiteNonnegative(result.data?.payout);
    if (payout === null) values.settlement_status = 'PARTIAL';
    else {
      values.actual_payout = payout;
      const refund = finiteNonnegative(result.data?.refund_amount);
      const entryFee = finiteNonnegative(result.data?.entry_fee ?? member.data.entry_fee);
      if (refund === null || entryFee === null) { values.settlement_status = 'PARTIAL'; delete values.actual_payout; }
      else { values.refund_amount = refund; values.entry_fee = entryFee; }
    }
  }
  const update = await db.from('floyd_dfs_portfolio_members')
    .update(values)
    .eq('tenant_id', input.tenantId)
    .eq('portfolio_id', member.data.portfolio_id)
    .eq('lineup_id', input.lineupId)
    .eq('lineup_revision', member.data.lineup_revision);
  if (update.error) throw update.error;
  if (values.settlement_status === 'VERIFIED') {
    const payout = finiteNonnegative(result.data?.payout)!; const refund = finiteNonnegative(result.data?.refund_amount)!; const entryFee = finiteNonnegative(result.data?.entry_fee ?? member.data.entry_fee)!;
    const roi = entryFee > 0 ? (payout + refund - entryFee) / entryFee : null;
    const resultUpdate = await db.from('floyd_dfs_contest_results').update({ roi }).eq('tenant_id', input.tenantId).eq('id', input.resultId);
    if (resultUpdate.error) throw resultUpdate.error;
  }
  return { updated: true, ...(values.settlement_status === 'VERIFIED' ? {} : { reason: `Settlement status is ${values.settlement_status}.` }) };
}

function finiteNonnegative(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
function finitePositiveInteger(value: unknown): number | null { const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN; return Number.isInteger(number) && number > 0 ? number : null; }
async function queryAll(makeQuery: (start: number, end: number) => any): Promise<any[]> { const all: any[] = []; for (let start = 0; ; start += 1000) { const result = await makeQuery(start, start + 999); if (result.error) throw result.error; const rows = result.data ?? []; all.push(...rows); if (rows.length < 1000) return all; } }
