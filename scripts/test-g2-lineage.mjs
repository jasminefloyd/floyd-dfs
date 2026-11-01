import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const output = mkdtempSync(join(tmpdir(), 'fantasy-ai-g2-lineage-'));
try {
  execFileSync('npx', ['tsc', '--ignoreConfig', '--target', 'es2022', '--module', 'commonjs', '--moduleResolution', 'node', '--ignoreDeprecations', '6.0', '--types', 'node', '--esModuleInterop', '--skipLibCheck', '--outDir', output, 'tests/g2-lineage.test.ts'], { stdio: 'inherit' });
  execFileSync('node', [join(output, 'tests/g2-lineage.test.js')], { stdio: 'inherit' });
} finally { rmSync(output, { recursive: true, force: true }); }

const migration = readFileSync('supabase/migrations/20261031010000_nba_intelligence_temporal_integrity.sql', 'utf8');
const additiveMigration = readFileSync('supabase/migrations/20261031060000_g1_g2_nba_schedule_and_lineage.sql', 'utf8');
const asOfRepository = readFileSync('server/streetTeam/asOfRepository.ts', 'utf8');
const runtime = readFileSync('server/runtime.ts', 'utf8');
assert.match(migration, /ingested_at/);
assert.match(migration, /floyd_dfs_generation_run_lineage/);
assert.match(migration, /floyd_dfs_run_projection_artifacts/);
assert.match(migration, /enable row level security/i);
assert.match(additiveMigration, /add column if not exists effective_at timestamptz/);
assert.match(additiveMigration, /add column if not exists ingested_at timestamptz/);
assert.match(additiveMigration, /floyd_dfs_resolved_facts_append_only_trg/);
assert.match(additiveMigration, /count\(distinct observation\.effective_at\) = 1/);
assert.match(asOfRepository, /getResolvedFactsAsOf/);
assert.match(asOfRepository, /readAllTemporalPages/);
assert.doesNotMatch(asOfRepository, /limit\(1000\)/);
assert.match(asOfRepository, /fact\.state === 'ACCEPTED'/);
assert.match(runtime, /intelSnapshotPin/);
assert.match(runtime, /buildRunLineageRecord\(/);
assert.match(runtime, /floyd_dfs_generation_run_lineage'\)\.insert\(initialLineage\)/);
assert.match(runtime, /run-pinned NBA intelligence snapshot/);
console.log('G2 migration contract assertions passed.');
