import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const output = mkdtempSync(join(tmpdir(), 'fantasy-ai-g0-'));
try {
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
  const ciRunner = readFileSync('scripts/run-ci-tests.mjs', 'utf8');
  const runtime = readFileSync('.nvmrc', 'utf8').trim();
  const appRoutes = readFileSync('src/App.tsx', 'utf8');
  const requiredCommands = ['npm ci', 'npm run lint', 'npm run build', 'npm run check:server', 'npm run test:all'];
  for (const command of requiredCommands) if (!workflow.includes(`run: ${command}`)) throw new Error(`CI is missing required fail-fast command: ${command}`);
  const orderedCommands = ['npm ci', 'npm run lint', 'npm run check:server', 'npm run build', 'npm run test:all'];
  const commandPositions = orderedCommands.map((command) => workflow.indexOf(`run: ${command}`));
  if (commandPositions.some((position, index) => position < 0 || index > 0 && position <= commandPositions[index - 1])) throw new Error(`CI commands must follow the required order: ${orderedCommands.join(' → ')}`);
  if (/continue-on-error|\|\|\s*true/.test(workflow)) throw new Error('CI must not swallow failures or continue after a failed required check.');
  if (!workflow.includes('node-version-file: .nvmrc')) throw new Error('CI must use the repository-pinned Node version.');
  if (!/^22\.\d+\.\d+$/.test(runtime)) throw new Error(`.nvmrc must pin a specific Node 22 release; found ${runtime || '(empty)'}`);
  if (!packageJson.engines?.node?.includes(runtime)) throw new Error(`Pinned Node ${runtime} does not appear in package.json engines.`);
  if (!workflow.includes('actions/upload-artifact@v4') || !workflow.includes('if: always()') || !workflow.includes('test-results/ci-results.json')) throw new Error('CI must archive the machine-readable test report even after a test failure.');
  if (!/path="\/operations"[\s\S]*?<AdminGuard>[\s\S]*?<OperationsPage\s*\/>/.test(appRoutes)) throw new Error('The Operations page route must be wrapped in the existing operator access guard.');
  const requiredTestScripts = ['test:g0', 'test:g1-street-team', 'test:g2-lineage', 'test:g3-nba-house', 'test:g4-simulation', 'test:g5-contest-portfolio', 'test:g6-learning', 'test:g8-operations', 'test:parity', 'test:fixtures', 'test:contracts', 'test:actual-sources', 'test:auth', 'test:p1-contracts', 'test:p2-street-team', 'test:p5-portfolio'];
  for (const script of requiredTestScripts) {
    if (!packageJson.scripts?.[script]) throw new Error(`package.json is missing ${script}`);
    if (!ciRunner.includes(`'${script}'`)) throw new Error(`CI test runner omits ${script}`);
  }
  for (const path of ['tests/g0-safety.test.ts', 'tests/g1-street-team.test.ts', 'tests/g2-lineage.test.ts', 'tests/g3-nba-house.test.ts', 'tests/g4-simulation.test.ts', 'tests/g5-contest-portfolio.test.ts', 'tests/g6-learning.test.ts', 'tests/fixtures/legacy-output-baselines.json']) readFileSync(path);
  console.log('G0 runtime pin, complete test inventory, fail-fast CI, and report artifact checks passed.');
  execFileSync('npx', [
    'tsc', '--ignoreConfig', '--target', 'es2022', '--module', 'commonjs', '--moduleResolution', 'node',
    '--ignoreDeprecations', '6.0', '--types', 'node', '--esModuleInterop', '--skipLibCheck',
    '--outDir', output, 'tests/g0-safety.test.ts',
  ], { stdio: 'inherit' });
  execFileSync('node', [join(output, 'tests/g0-safety.test.js')], { stdio: 'inherit' });
  execFileSync('node', ['scripts/test-g0-fixture-baselines.mjs'], { stdio: 'inherit' });
  execFileSync('node', ['scripts/test-g0-ci-failure-propagation.mjs'], { stdio: 'inherit' });
} finally {
  rmSync(output, { recursive: true, force: true });
}
