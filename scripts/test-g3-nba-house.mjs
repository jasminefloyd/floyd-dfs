import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const output = mkdtempSync(join(tmpdir(), 'fantasy-ai-g3-nba-house-'));
try {
  execFileSync('npx', ['tsc', '--ignoreConfig', '--target', 'es2022', '--module', 'commonjs', '--moduleResolution', 'node', '--ignoreDeprecations', '6.0', '--types', 'node', '--esModuleInterop', '--skipLibCheck', '--outDir', output, 'tests/g3-nba-house.test.ts'], { stdio: 'inherit' });
  execFileSync('node', [join(output, 'tests/g3-nba-house.test.js')], { stdio: 'inherit' });
} finally { rmSync(output, { recursive: true, force: true }); }

const runtime = readFileSync('server/runtime.ts', 'utf8');
const resolver = readFileSync('server/houses/nba/modelResolver.ts', 'utf8');
const fixture = JSON.parse(readFileSync('tests/fixtures/nba-house-approved-minutes-cap.json', 'utf8'));
if (fixture.fixtureType !== 'SYNTHETIC_POLICY_PATH_ONLY' || fixture.player.baselineMinutes !== 34 || fixture.player.minutesCap !== 26 || fixture.expected.delta !== -8) throw new Error('The synthetic approved minutes-cap fixture is incomplete or has production-like status.');
if (!runtime.includes('houseModel.driverPolicyVersion') || !runtime.includes('runNbaSimulationBatch({ slate: workingSlate, projection: candidateProjection') || !runtime.includes('optimizeLineups({ validatedSlate: workingSlate, projectionPackage: projection')) throw new Error('NBA House candidate is not version-gated and propagated through simulation and optimization.');
if (!resolver.includes('evaluation.data?.model_version === modelVersion') || !resolver.includes('approvedNbaDriverPolicyVersion')) throw new Error('NBA House registry/evaluation identity and driver-policy gates are missing.');
console.log(`G3 synthetic approved-minutes-cap fixture SHA-256: ${createHash('sha256').update(readFileSync('tests/fixtures/nba-house-approved-minutes-cap.json')).digest('hex')}`);

const cliRoot = mkdtempSync(join(tmpdir(), 'fantasy-ai-g3-eval-cli-'));
try {
  const input = join(cliRoot, 'dataset.json'); const artifact = join(cliRoot, 'evaluation.json');
  writeFileSync(input, JSON.stringify({ validationCutoff: '2025-12-01T00:00:00Z', holdoutCutoff: '2026-01-01T00:00:00Z', rows: [] }));
  execFileSync('node', ['scripts/evaluate-nba-house.mjs', input, artifact], { stdio: 'inherit' });
  const saved = JSON.parse(readFileSync(artifact, 'utf8'));
  if (saved.decision !== 'HOLD' || !/^[0-9a-f]{64}$/.test(saved.evaluationSha256)) throw new Error('Evaluation CLI did not write a checksummed HOLD artifact.');
} finally { rmSync(cliRoot, { recursive: true, force: true }); }
