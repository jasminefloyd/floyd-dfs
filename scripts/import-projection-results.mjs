import { readFile } from 'node:fs/promises';

const filePath = process.argv[2];

if (!filePath) {
  console.error('Usage: npm run import:results -- path/to/results.json');
  process.exit(1);
}

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('SUPABASE_URL/VITE_SUPABASE_URL and SERVICE_ROLE_KEY/SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(1);
}

const raw = await readFile(filePath, 'utf8');
const payload = JSON.parse(raw);
const endpoint = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/fantasy_ai_upsert_projection_results`;

const rows = (payload.results ?? payload.rows ?? []).map((row) => ({
  ...row,
  sport: payload.sport,
  contest_date: payload.contestDate,
  contest_type: payload.contestType,
  contest_id: payload.contestId ?? row.contest_id ?? null,
  source: payload.source ?? row.source ?? 'manual_results_import',
}));

const body = { p_rows: rows };

const response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(body),
});

const text = await response.text();
if (!response.ok) {
  console.error(text);
  process.exit(1);
}

console.log(text);
