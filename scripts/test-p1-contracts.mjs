import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const output = mkdtempSync(join(tmpdir(), 'fantasy-ai-p1-contracts-'));
try {
  execFileSync('npx', [
    'tsc', '--ignoreConfig', '--target', 'es2022', '--module', 'commonjs', '--moduleResolution', 'node',
    '--ignoreDeprecations', '6.0', '--types', 'node', '--esModuleInterop', '--skipLibCheck',
    '--outDir', output, 'tests/p1-contracts.test.ts',
  ], { stdio: 'inherit' });
  execFileSync('node', [join(output, 'tests/p1-contracts.test.js')], { stdio: 'inherit' });
} finally {
  rmSync(output, { recursive: true, force: true });
}

const firstMigration = readFileSync('supabase/migrations/20261030010000_street_team_nba_house.sql', 'utf8');
const secondMigration = readFileSync('supabase/migrations/20261030020000_portfolios_model_registry.sql', 'utf8');
const rlsTest = readFileSync('supabase/tests/p1_contracts_rls.sql', 'utf8');
const tables = [
  'floyd_dfs_intel_collection_runs',
  'floyd_dfs_intel_observations',
  'floyd_dfs_intel_snapshots',
  'floyd_dfs_intel_snapshot_observations',
  'floyd_dfs_behavior_signals',
  'floyd_dfs_house_reports',
  'floyd_dfs_lineup_portfolios',
  'floyd_dfs_portfolio_members',
  'floyd_dfs_model_registry',
];
for (const table of tables) {
  assert.match(`${firstMigration}\n${secondMigration}`, new RegExp(`create table if not exists public\\.${table}\\b`, 'i'), `${table} migration missing`);
  assert.match(`${firstMigration}\n${secondMigration}`, new RegExp(`'${table}'`), `${table} missing from RLS enable/grant block`);
  assert.match(rlsTest, new RegExp(`'${table}'`), `${table} missing from RLS catalog test`);
}
for (const migration of [firstMigration, secondMigration]) {
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /as restrictive for all to authenticated/i);
  assert.match(migration, /tenant_id = \(select id from public\.tenants where slug = %L\)/i);
  assert.match(migration, /'floyd-dfs'/i);
  assert.match(migration, /revoke all on public\.%i from public, anon, authenticated/i);
  assert.match(migration, /grant all on public\.%i to service_role/i);
}
assert.match(firstMigration, /before update or delete on public\.floyd_dfs_intel_observations/i);
assert.match(secondMigration, /references public\.floyd_dfs_lineup_revisions\(tenant_id, lineup_id, revision\)/i);
assert.match(secondMigration, /references public\.floyd_dfs_model_evaluations\(id, tenant_id\)/i);
console.log('P1 additive migration and RLS coverage assertions passed.');
