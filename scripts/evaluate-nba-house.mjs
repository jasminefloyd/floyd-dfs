import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error('Usage: npm run evaluate:nba-house -- <paired-dataset.json> <evaluation-artifact.json>');
const dataset = JSON.parse(readFileSync(inputPath, 'utf8'));
if (!Array.isArray(dataset.rows) || typeof dataset.validationCutoff !== 'string' || typeof dataset.holdoutCutoff !== 'string') throw new Error('Input must contain { validationCutoff, holdoutCutoff, rows } using the NbaHouseEvaluationRow contract.');
const temporaryOutput = mkdtempSync(join(tmpdir(), 'fantasy-ai-nba-house-eval-'));
try {
  execFileSync('npx', ['tsc', '--ignoreConfig', '--target', 'es2022', '--module', 'commonjs', '--moduleResolution', 'node', '--ignoreDeprecations', '6.0', '--types', 'node', '--skipLibCheck', '--rootDir', '.', '--outDir', temporaryOutput, 'server/houses/nba/evaluation.ts'], { stdio: 'inherit' });
  const module = await import(pathToFileURL(join(temporaryOutput, 'server/houses/nba/evaluation.js')).href);
  const result = module.evaluateNbaHouse(dataset.rows, { validationCutoff: dataset.validationCutoff, holdoutCutoff: dataset.holdoutCutoff }, new Date().toISOString());
  const artifact = { ...result, dataManifest: { source: dataset.source ?? 'USER_SUPPLIED_VERIFIED_EXPORT', rowCount: dataset.rows.length, validationCutoff: dataset.validationCutoff, holdoutCutoff: dataset.holdoutCutoff, actualSourceRequirement: 'Verified official actuals with FINAL or CORRECTED finality', split: 'Chronological by event time; slate/game connected groups stay in one partition' } };
  writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ decision: artifact.decision, eligible: artifact.eligible, holdout: artifact.holdout, excludedRows: artifact.excludedRows, outputPath }, null, 2));
} finally { rmSync(temporaryOutput, { recursive: true, force: true }); }
