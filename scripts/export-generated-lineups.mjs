import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const schema = process.env.VITE_SUPABASE_SCHEMA ?? 'tenant_fantasy_ai';

if (!supabaseUrl || !serviceRoleKey) {
  console.error('SUPABASE_URL/VITE_SUPABASE_URL and SERVICE_ROLE_KEY/SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(1);
}

const outputDir = join(process.cwd(), 'docs', 'baseline-exports');
const outputPath = join(outputDir, `generated-lineups-${new Date().toISOString().slice(0, 10)}.json`);
const endpoint = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/generated_lineups?select=*&order=contest_date.desc,created_at.desc`;

const response = await fetch(endpoint, {
  headers: {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    Accept: 'application/json',
    'Accept-Profile': schema,
  },
});

if (!response.ok) {
  const body = await response.text();
  throw new Error(`generated_lineups export failed: ${response.status} ${body}`);
}

const rows = await response.json();
await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, JSON.stringify({
  exported_at: new Date().toISOString(),
  schema,
  row_count: Array.isArray(rows) ? rows.length : 0,
  rows,
}, null, 2));

console.log(outputPath);
