import { readFile } from 'node:fs/promises';

const filePath = process.argv[2];

if (!filePath) {
  console.error('Usage: npm run import:dk -- path/to/slate.json');
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
const endpoint = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/sync-draftkings-contests`;

const response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(Array.isArray(payload) ? { slates: payload } : payload),
});

const text = await response.text();
if (!response.ok) {
  console.error(text);
  process.exit(1);
}

console.log(text);
