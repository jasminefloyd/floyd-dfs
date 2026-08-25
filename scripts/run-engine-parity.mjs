import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const output = mkdtempSync(join(tmpdir(), 'fantasy-ai-parity-'));
try {
  execFileSync('npx', ['tsc', '--ignoreConfig', '--target', 'es2022', '--module', 'commonjs', '--moduleResolution', 'node', '--ignoreDeprecations', '6.0', '--types', 'node', '--esModuleInterop', '--skipLibCheck', '--outDir', output, 'tests/engine-parity.test.ts'], { stdio: 'inherit' });
  execFileSync('node', [join(output, 'tests/engine-parity.test.js')], { stdio: 'inherit' });
} finally { rmSync(output, { recursive: true, force: true }); }
