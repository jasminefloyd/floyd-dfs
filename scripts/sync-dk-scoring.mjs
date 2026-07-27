import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const canonical = resolve(root, 'supabase/functions/_shared/dkScoring.ts');
const browserCopy = resolve(root, 'src/lib/dkScoring.ts');

copyFileSync(canonical, browserCopy);

const contents = readFileSync(browserCopy, 'utf8')
  .replace(
    '// KEEP IN SYNC — canonical copy in supabase/functions/_shared/dkScoring.ts',
    '// GENERATED from supabase/functions/_shared/dkScoring.ts by scripts/sync-dk-scoring.mjs',
  );

writeFileSync(browserCopy, contents);
