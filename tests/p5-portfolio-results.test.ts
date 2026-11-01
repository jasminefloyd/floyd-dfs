import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { syncVerifiedPortfolioOutcome } from '../server/learning/portfolioOutcomes.js';

function mockDb(input: { result: Record<string, unknown> | null; member: Record<string, unknown> | null; linkedLineup?: string | null }) {
  const updates: Array<Record<string, unknown>> = [];
  const resultUpdates: Array<Record<string, unknown>> = [];
  const tables: string[] = [];
  const db = {
    from(table: string) {
      tables.push(table);
      const query: Record<string, (...args: unknown[]) => unknown> = {};
      for (const method of ['select', 'eq', 'order', 'limit']) query[method] = () => query;
      query.maybeSingle = async () => ({ data: table === 'floyd_dfs_contest_results' ? input.result : table === 'floyd_dfs_entry_links' ? (input.linkedLineup === null ? null : { generated_lineup_id: input.linkedLineup ?? 'lineup-1' }) : input.member, error: null });
      query.update = (values: unknown) => {
        (table === 'floyd_dfs_contest_results' ? resultUpdates : updates).push(values as Record<string, unknown>);
        const updateQuery: Record<string, unknown> = {};
        for (const method of ['eq']) updateQuery[method] = () => updateQuery;
        updateQuery.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve);
        return updateQuery;
      };
      return query;
    },
  };
  return { db: db as unknown as SupabaseClient, updates, resultUpdates, tables };
}

async function main() {
const valid = mockDb({
  result: { generated_lineup_id: 'lineup-1', contest_id: 'contest-1', external_entry_id: 'entry-1', payout: '12.50', refund_amount: '0', entry_fee: '3', official_outcome: true, reconciliation_status: 'MATCHED' },
  member: { portfolio_id: 'portfolio-1', lineup_revision: 4, entry_fee: '3' },
});
const saved = await syncVerifiedPortfolioOutcome(valid.db, { tenantId: 'tenant-1', lineupId: 'lineup-1', resultId: 'result-1' });
assert.deepEqual(saved, { updated: true });
assert.deepEqual(valid.updates, [{ settlement_status: 'VERIFIED', actual_payout: 12.5, refund_amount: 0, entry_fee: 3 }]);
assert.deepEqual(valid.resultUpdates, [{ roi: (12.5 - 3) / 3 }]);
assert.deepEqual(valid.tables, ['floyd_dfs_contest_results', 'floyd_dfs_entry_links', 'floyd_dfs_portfolio_members', 'floyd_dfs_portfolio_members', 'floyd_dfs_contest_results']);

const mismatched = mockDb({
  result: { generated_lineup_id: 'lineup-1', contest_id: 'contest-1', external_entry_id: 'entry-1', payout: 250, entry_fee: 3, official_outcome: true, reconciliation_status: 'MISMATCH' },
  member: { portfolio_id: 'portfolio-1', lineup_revision: 4 },
});
const rejected = await syncVerifiedPortfolioOutcome(mismatched.db, { tenantId: 'tenant-1', lineupId: 'lineup-1', resultId: 'result-2' });
assert.equal(rejected.updated, true, 'mismatches update dispute status while withholding payout');
assert.equal(mismatched.tables.length, 4);
assert.deepEqual(mismatched.updates, [{ settlement_status: 'DISPUTED' }]);

const unofficial = mockDb({
  result: { generated_lineup_id: 'lineup-1', contest_id: 'contest-1', external_entry_id: 'entry-1', payout: 250, entry_fee: 3, official_outcome: false, reconciliation_status: 'MATCHED' },
  member: { portfolio_id: 'portfolio-1', lineup_revision: 4 },
});
await syncVerifiedPortfolioOutcome(unofficial.db, { tenantId: 'tenant-1', lineupId: 'lineup-1', resultId: 'result-3' });
assert.deepEqual(unofficial.updates, [{ settlement_status: 'RESULTS_PENDING' }]);

const missingRefund = mockDb({
  result: { generated_lineup_id: 'lineup-1', contest_id: 'contest-1', external_entry_id: 'entry-1', payout: 12.5, entry_fee: 3, official_outcome: true, reconciliation_status: 'MATCHED' },
  member: { portfolio_id: 'portfolio-1', lineup_revision: 4, entry_fee: 3 },
});
await syncVerifiedPortfolioOutcome(missingRefund.db, { tenantId: 'tenant-1', lineupId: 'lineup-1', resultId: 'result-missing-refund' });
assert.deepEqual(missingRefund.updates, [{ settlement_status: 'PARTIAL' }], 'missing refund evidence cannot be represented as settled net return');

const pending = mockDb({
  result: { generated_lineup_id: 'lineup-1', contest_id: 'contest-1', external_entry_id: 'entry-1', payout: 250, entry_fee: 3, official_outcome: false, reconciliation_status: 'MATCHED' },
  member: { portfolio_id: 'portfolio-1', lineup_revision: 4 },
});
const pendingResult = await syncVerifiedPortfolioOutcome(pending.db, { tenantId: 'tenant-1', lineupId: 'lineup-1', resultId: 'result-4' });
assert.equal(pendingResult.updated, true);
assert.deepEqual(pending.updates, [{ settlement_status: 'RESULTS_PENDING' }]);

const disputed = mockDb({
  result: { generated_lineup_id: 'lineup-1', contest_id: 'contest-1', external_entry_id: 'entry-1', payout: null, entry_fee: 3, official_outcome: true, reconciliation_status: 'MISMATCH' },
  member: { portfolio_id: 'portfolio-1', lineup_revision: 4 },
});
await syncVerifiedPortfolioOutcome(disputed.db, { tenantId: 'tenant-1', lineupId: 'lineup-1', resultId: 'result-5' });
assert.deepEqual(disputed.updates, [{ settlement_status: 'DISPUTED' }]);

const unlinked = mockDb({ result: { generated_lineup_id: 'lineup-1', contest_id: 'contest-1', external_entry_id: 'entry-missing', payout: 99, refund_amount: 0, entry_fee: 3, official_outcome: true, reconciliation_status: 'MATCHED' }, member: { portfolio_id: 'portfolio-1', lineup_revision: 4, entry_fee: 3 }, linkedLineup: null });
const notSettled = await syncVerifiedPortfolioOutcome(unlinked.db, { tenantId: 'tenant-1', lineupId: 'lineup-1', resultId: 'result-unlinked' });
assert.equal(notSettled.updated, false, 'financial settlement requires an exact saved external DraftKings entry link');

console.log('P5 portfolio result persistence gates passed.');
}

void main();
