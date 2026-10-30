import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { syncVerifiedPortfolioOutcome } from '../server/learning/portfolioOutcomes.js';

function mockDb(input: { result: Record<string, unknown> | null; member: Record<string, unknown> | null }) {
  const updates: Array<Record<string, unknown>> = [];
  const tables: string[] = [];
  const db = {
    from(table: string) {
      tables.push(table);
      const query: Record<string, (...args: unknown[]) => unknown> = {};
      for (const method of ['select', 'eq', 'order', 'limit']) query[method] = () => query;
      query.maybeSingle = async () => ({ data: table === 'floyd_dfs_contest_results' ? input.result : input.member, error: null });
      query.update = (values: unknown) => {
        updates.push(values as Record<string, unknown>);
        const updateQuery: Record<string, unknown> = {};
        for (const method of ['eq']) updateQuery[method] = () => updateQuery;
        updateQuery.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve);
        return updateQuery;
      };
      return query;
    },
  };
  return { db: db as unknown as SupabaseClient, updates, tables };
}

async function main() {
const valid = mockDb({
  result: { payout: '12.50', entry_fee: '3', official_outcome: true, reconciliation_status: 'MATCHED' },
  member: { portfolio_id: 'portfolio-1', lineup_revision: 4 },
});
const saved = await syncVerifiedPortfolioOutcome(valid.db, { tenantId: 'tenant-1', lineupId: 'lineup-1', resultId: 'result-1' });
assert.deepEqual(saved, { updated: true });
assert.deepEqual(valid.updates, [{ actual_payout: 12.5, entry_fee: 3 }]);
assert.deepEqual(valid.tables, ['floyd_dfs_contest_results', 'floyd_dfs_portfolio_members', 'floyd_dfs_portfolio_members']);

const mismatched = mockDb({
  result: { payout: 250, entry_fee: 3, official_outcome: true, reconciliation_status: 'MISMATCH' },
  member: { portfolio_id: 'portfolio-1', lineup_revision: 4 },
});
const rejected = await syncVerifiedPortfolioOutcome(mismatched.db, { tenantId: 'tenant-1', lineupId: 'lineup-1', resultId: 'result-2' });
assert.equal(rejected.updated, false);
assert.equal(mismatched.tables.length, 1);
assert.equal(mismatched.updates.length, 0);

const unofficial = mockDb({
  result: { payout: 250, entry_fee: 3, official_outcome: false, reconciliation_status: 'MATCHED' },
  member: { portfolio_id: 'portfolio-1', lineup_revision: 4 },
});
await syncVerifiedPortfolioOutcome(unofficial.db, { tenantId: 'tenant-1', lineupId: 'lineup-1', resultId: 'result-3' });
assert.equal(unofficial.updates.length, 0);

console.log('P5 portfolio result persistence gates passed.');
}

void main();
