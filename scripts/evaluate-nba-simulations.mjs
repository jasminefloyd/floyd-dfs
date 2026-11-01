import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error('Usage: npm run evaluate:nba-simulations -- <paired-dataset.json> <evaluation-artifact.json>');
const dataset = JSON.parse(readFileSync(inputPath, 'utf8'));
if (!Array.isArray(dataset.rows) || !Array.isArray(dataset.teamTotals) || !Array.isArray(dataset.lineups)) throw new Error('Input must contain { holdoutCutoff, registeredAt, versions, seed, settings, rows, teamTotals, lineups }.');
const temporaryOutput = mkdtempSync(join(tmpdir(), 'fantasy-ai-nba-simulation-eval-'));
try {
  execFileSync('npx', ['tsc', '--ignoreConfig', '--target', 'es2022', '--module', 'commonjs', '--moduleResolution', 'node', '--ignoreDeprecations', '6.0', '--types', 'node', '--skipLibCheck', '--rootDir', '.', '--outDir', temporaryOutput, 'server/houses/nba/simulationEvaluation.ts'], { stdio: 'inherit' });
  const module = await import(pathToFileURL(join(temporaryOutput, 'server/houses/nba/simulationEvaluation.js')).href);
  const result = module.evaluateNbaSimulation(dataset, new Date().toISOString());
  const sourceFiles = ['server/houses/nba/simulationEvaluation.ts', 'server/houses/nba/simulationService.ts', 'src/lib/engine/gameSimulation.ts', 'tests/g4-simulation.test.ts'];
  const sourceHashes = Object.fromEntries(sourceFiles.map((path) => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]));
  const artifactPayload = { ...result, datasetManifest: { source: dataset.source ?? 'USER_SUPPLIED_VERIFIED_EXPORT', rowCount: dataset.rows.length, teamTotalRows: dataset.teamTotals.length, lineupRows: dataset.lineups.length }, sourceHashes };
  const artifact = { ...artifactPayload, artifactSha256: createHash('sha256').update(stableJson(artifactPayload)).digest('hex') };
  writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ decision: artifact.decision, eligible: artifact.decision === 'ELIGIBLE_FOR_REVIEW', holdout: artifact.holdout, datasetSha256: artifact.datasetSha256, artifactSha256: artifact.artifactSha256, sourceHashes, outputPath }, null, 2));
} finally { rmSync(temporaryOutput, { recursive: true, force: true }); }

function stableJson(value) { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`; return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`; }
