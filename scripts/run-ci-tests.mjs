import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const testScripts = [
  'test:g0',
  'test:g1-street-team',
  'test:g2-lineage',
  'test:g3-nba-house',
  'test:g4-simulation',
  'test:g5-contest-portfolio',
  'test:g6-learning',
  'test:g8-operations',
  'test:parity',
  'test:fixtures',
  'test:contracts',
  'test:actual-sources',
  'test:auth',
  'test:p1-contracts',
  'test:p2-street-team',
  'test:p5-portfolio',
];

const resultPath = resolve(process.env.CI_RESULTS_PATH ?? 'test-results/ci-results.json');
const report = {
  schemaVersion: 'fantasy-ai.ci-test-results.v1',
  startedAt: new Date().toISOString(),
  nodeVersion: process.version,
  npmVersion: spawnSync('npm', ['--version'], { encoding: 'utf8' }).stdout?.trim() ?? null,
  typescriptVersion: JSON.parse(readFileSync(resolve('node_modules/typescript/package.json'), 'utf8')).version,
  gitCommitSha: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout?.trim() || null,
  workingTreeDirty: Boolean(spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).stdout?.trim()),
  ciRunUrl: process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null,
  results: [],
};

mkdirSync(dirname(resultPath), { recursive: true });
const writeReport = () => {
  report.completedAt = new Date().toISOString();
  report.status = report.results.length === testScripts.length && report.results.every((result) => result.status === 'PASSED') ? 'PASSED' : 'FAILED';
  writeFileSync(resultPath, `${JSON.stringify(report, null, 2)}\n`);
};

writeReport();
for (const script of testScripts) {
  const startedAt = Date.now();
  console.log(`\n=== npm run ${script} ===`);
  const result = spawnSync('npm', ['run', script], { stdio: 'inherit', env: process.env });
  const testResult = {
    script,
    status: result.status === 0 ? 'PASSED' : 'FAILED',
    exitCode: result.status,
    signal: result.signal ?? null,
    durationMs: Date.now() - startedAt,
  };
  report.results.push(testResult);
  writeReport();
  if (testResult.status === 'FAILED') console.error(`CI test failed: ${script} (exit ${result.status ?? result.signal ?? 'unknown'})`);
}

const failures = report.results.filter((result) => result.status !== 'PASSED');
console.log(`\nCI test report: ${report.status} (${report.results.length - failures.length}/${testScripts.length} passed); ${resultPath}`);
if (failures.length) process.exitCode = 1;
