import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: '.env.local' });
const execFileAsync = promisify(execFile);
const projectRoot = resolve(new URL('..', import.meta.url).pathname);
const tenantSlug = process.env.FDS_TENANT_SLUG?.trim();
const expectedProjectRef = process.env.FDS_EXPECTED_SUPABASE_PROJECT_REF?.trim();
const configuredUrl = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim();
const backupDir = resolve(process.env.FDS_P02_BACKUP_DIR?.trim() || join(tmpdir(), `fds-p02-production-${new Date().toISOString().replaceAll(':', '-')}`));

if (tenantSlug !== 'floyd-dfs') throw new Error('Refusing backup: FDS_TENANT_SLUG must be exactly floyd-dfs.');
if (process.env.FDS_P02_WRITERS_PAUSED !== 'true') throw new Error('Pause FDS writers and set FDS_P02_WRITERS_PAUSED=true before creating a consistent export.');
if (!expectedProjectRef || !/^[a-z0-9]{15,30}$/.test(expectedProjectRef)) throw new Error('Set FDS_EXPECTED_SUPABASE_PROJECT_REF in .env.local to the reviewed production project ref.');
if (!configuredUrl) throw new Error('SUPABASE_URL or VITE_SUPABASE_URL is required to verify the intended project.');

const linkedProjectRef = (await readFile(join(projectRoot, 'supabase/.temp/project-ref'), 'utf8')).trim();
const urlProjectRef = new URL(configuredUrl).hostname.split('.')[0];
if (linkedProjectRef !== expectedProjectRef || urlProjectRef !== expectedProjectRef) throw new Error('Refusing backup: .env.local, the Supabase CLI link, and the expected production project ref do not match.');

const tables = [
  'floyd_dfs_source_observations',
  'floyd_dfs_resolved_facts',
  'floyd_dfs_quantitative_adjustments',
  'floyd_dfs_player_projection_components',
  'floyd_dfs_model_evaluations',
  'floyd_dfs_sport_release_gates',
  'floyd_dfs_historical_player_actuals',
  'floyd_dfs_player_actual_revisions',
];

async function query(sql) {
  const { stdout } = await execFileAsync('supabase', ['db', 'query', '--linked', '--output-format', 'json', '--workdir', projectRoot, sql], {
    cwd: projectRoot,
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' },
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

const tenantResult = await query("select id from public.tenants where slug = 'floyd-dfs'");
if (!Array.isArray(tenantResult.rows) || tenantResult.rows.length !== 1 || !/^[0-9a-f-]{36}$/i.test(tenantResult.rows[0].id)) throw new Error('Expected exactly one Floyd DFS tenant; backup stopped.');
const tenantId = tenantResult.rows[0].id;
await mkdir(backupDir, { recursive: false, mode: 0o700 });
await chmod(backupDir, 0o700);

const manifest = { backupVersion: 'fds-p02-tenant-rows.v1', createdAt: new Date().toISOString(), tenantSlug, tenantId, projectRef: expectedProjectRef, tables: [] };
for (const table of tables) {
  const file = join(backupDir, `${table}.jsonl`);
  const hash = createHash('sha256');
  let cursor = '';
  let count = 0;
  for (;;) {
    const safeCursor = cursor ? `'${cursor}'` : "''";
    const sql = `select to_jsonb(t) as record from public.${table} t where t.tenant_id = '${tenantId}'::uuid and t.id::text > ${safeCursor} order by t.id limit 200`;
    const result = await query(sql);
    if (!Array.isArray(result.rows)) throw new Error(`Backup query for ${table} returned an invalid result.`);
    if (!result.rows.length) break;
    const lines = result.rows.map((row) => {
      if (!row.record || row.record.tenant_id !== tenantId || typeof row.record.id !== 'string') throw new Error(`Tenant/identity check failed for a ${table} backup row.`);
      return JSON.stringify(row.record);
    });
    const chunk = `${lines.join('\n')}\n`;
    await appendFile(file, chunk, { mode: 0o600 });
    hash.update(chunk);
    cursor = result.rows.at(-1).record.id;
    count += result.rows.length;
  }
  if (count === 0) await writeFile(file, '', { mode: 0o600 });
  await chmod(file, 0o600);
  manifest.tables.push({ table, file: `${table}.jsonl`, rows: count, sha256: hash.digest('hex') });
}
await writeFile(join(backupDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify({ backupDir, tenantSlug, projectRef: expectedProjectRef, tableCounts: manifest.tables.map(({ table, rows }) => ({ table, rows })) }));
