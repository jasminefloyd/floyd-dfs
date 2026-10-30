import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const output = mkdtempSync(join(tmpdir(), 'fantasy-ai-p2-street-team-'));
try {
  execFileSync('npx', [
    'tsc', '--ignoreConfig', '--target', 'es2022', '--module', 'commonjs', '--moduleResolution', 'node',
    '--ignoreDeprecations', '6.0', '--types', 'node', '--esModuleInterop', '--skipLibCheck',
    '--outDir', output, 'tests/p2-street-team.test.ts',
  ], { stdio: 'inherit' });
  execFileSync('node', [join(output, 'tests/p2-street-team.test.js')], { stdio: 'inherit' });
} finally {
  rmSync(output, { recursive: true, force: true });
}

const runtimeMigration = readFileSync('supabase/migrations/20261030030000_street_team_collection_runtime.sql', 'utf8');
const rlsTest = readFileSync('supabase/tests/p2_street_team_immutability.sql', 'utf8');
const collectRoute = readFileSync('api/street-team/collect.ts', 'utf8');
const streetTeamService = readFileSync('server/streetTeam.ts', 'utf8');
const briefingRoute = readFileSync('api/street-team/briefings.ts', 'utf8');
const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
for (const table of ['floyd_dfs_intel_snapshots', 'floyd_dfs_intel_snapshot_observations']) {
  assert.match(runtimeMigration, new RegExp(`before update or delete on public\\.${table}`, 'i'));
}
assert.match(runtimeMigration, /lease_expires_at timestamptz/i);
assert.match(runtimeMigration, /snapshot_payload jsonb/i);
assert.match(runtimeMigration, /floyd_dfs_create_intel_snapshot_with_evidence/i);
assert.match(rlsTest, /append-only snapshot trigger/i);
assert.match(collectRoute, /schedulerContext\(req\)/);
assert.match(collectRoute, /requireOperator\(context\)/);
assert.match(collectRoute, /isFeatureEnabled\('STREET_TEAM_V2'\)/);
assert.match(collectRoute, /dataTier: process\.env\.SPORTS_DATA_IO_DATA_TIER/);
assert.match(streetTeamService, /isSportsDataIoProductionVerifiedDataTier\(options\.dataTier\)/);
assert.match(streetTeamService, /no provider request was made/);
assert.match(streetTeamService, /floyd_dfs_behavior_signals/);
assert.match(streetTeamService, /onConflict: 'id', ignoreDuplicates: true/);
assert.match(briefingRoute, /tenantContext\(req\)/);
assert.match(briefingRoute, /snapshot: null/);
assert.match(briefingRoute, /latestCollectionRun/);
assert.ok(vercel.crons.some((cron) => cron.path === '/api/street-team/collect' && cron.schedule === '0 8 * * *'));
console.log('P2 persistence, route authorization, feature flag, and daily schedule assertions passed.');
