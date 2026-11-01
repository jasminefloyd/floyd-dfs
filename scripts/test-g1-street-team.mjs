import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const output = mkdtempSync(join(tmpdir(), 'fantasy-ai-g1-street-team-'));
try {
  execFileSync('npx', ['tsc', '--ignoreConfig', '--target', 'es2022', '--module', 'commonjs', '--moduleResolution', 'node', '--ignoreDeprecations', '6.0', '--types', 'node', '--esModuleInterop', '--skipLibCheck', '--outDir', output, 'tests/g1-street-team.test.ts'], { stdio: 'inherit' });
  execFileSync('node', [join(output, 'tests/g1-street-team.test.js')], { stdio: 'inherit' });
} finally { rmSync(output, { recursive: true, force: true }); }

const refreshRoute = readFileSync('api/street-team/refresh.ts', 'utf8');
const schedulerRoute = readFileSync('api/street-team/scheduler.ts', 'utf8');
const scheduleRepository = readFileSync('server/streetTeam/nbaScheduleRepository.ts', 'utf8');
const scheduleMigration = readFileSync('supabase/migrations/20261031060000_g1_g2_nba_schedule_and_lineage.sql', 'utf8');
const refreshMigration = readFileSync('supabase/migrations/20261030070000_street_team_g1_refresh.sql', 'utf8');
const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
assert.match(refreshRoute, /tenantContext\(req\)/);
assert.match(refreshRoute, /requireOperator\(context\)/);
assert.match(refreshRoute, /10 \* 60_000/);
assert.match(refreshMigration, /source_count integer/);
assert.match(refreshMigration, /provider_request_id text/);
assert.match(refreshMigration, /normalized_claim text/);
assert.match(schedulerRoute, /syncNbaSchedule\(db/);
assert.match(schedulerRoute, /listUpcomingNbaSchedule\(db/);
assert.match(schedulerRoute, /generation_runs/);
assert.match(schedulerRoute, /nextGameAt:/);
assert.match(scheduleRepository, /ESPN_BASE/);
assert.match(scheduleRepository, /normalizeEspnNbaSchedule/);
assert.match(scheduleRepository, /floyd_dfs_claim_nba_schedule_sync/);
assert.match(scheduleMigration, /unique \(provider, provider_game_id\)/);
assert.match(scheduleMigration, /floyd_dfs_nba_game_schedule_versions/);
assert.match(scheduleMigration, /enable row level security/i);
assert.match(scheduleMigration, /revoke all on public\.%I from public, anon, authenticated/);
assert.match(scheduleMigration, /floyd_dfs_claim_nba_schedule_sync/);
assert.ok(vercel.crons.some((cron) => cron.path === '/api/street-team/scheduler' && cron.schedule === '0 8 * * *'));
console.log('G1 independent NBA schedule, dispatcher lease, shared-table access, refresh telemetry, and retained daily schedule assertions passed.');
