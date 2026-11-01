import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const output = mkdtempSync(join(tmpdir(), 'fantasy-ai-g4-simulation-'));
try {
  execFileSync('npx', ['tsc', '--ignoreConfig', '--target', 'es2022', '--module', 'commonjs', '--moduleResolution', 'node', '--ignoreDeprecations', '6.0', '--types', 'node', '--esModuleInterop', '--skipLibCheck', '--rootDir', '.', '--outDir', output, 'tests/g4-simulation.test.ts'], { stdio: 'inherit' });
  execFileSync('node', [join(output, 'tests/g4-simulation.test.js')], { stdio: 'inherit' });
} finally { rmSync(output, { recursive: true, force: true }); }

const cliRoot = mkdtempSync(join(tmpdir(), 'fantasy-ai-g4-eval-cli-'));
try {
  const input = join(cliRoot, 'dataset.json'); const artifact = join(cliRoot, 'evaluation.json');
  writeFileSync(input, JSON.stringify({ holdoutCutoff: '2025-12-01T00:00:00Z', registeredAt: '2025-11-01T00:00:00Z', simulationVersion: 'fixture-sim.v1', projectionVersion: 'fixture-projection.v1', seed: 'fixture-seed', gameScenarioCount: 128, fieldSimulationCount: 64, rows: [], teamTotals: [], lineups: [] }));
  execFileSync('node', ['scripts/evaluate-nba-simulations.mjs', input, artifact], { stdio: 'inherit' });
  const saved = JSON.parse(readFileSync(artifact, 'utf8'));
  if (saved.decision !== 'HOLD' || !/^[0-9a-f]{64}$/.test(saved.evaluationSha256) || !/^[0-9a-f]{64}$/.test(saved.artifactSha256) || !/^[0-9a-f]{64}$/.test(saved.sourceHashes?.['src/lib/engine/gameSimulation.ts'] ?? '')) throw new Error('Simulation evaluation CLI failed its checksummed HOLD artifact and source-manifest assertion.');
} finally { rmSync(cliRoot, { recursive: true, force: true }); }
