import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const temp = mkdtempSync(join(tmpdir(), 'fantasy-ai-ci-negative-control-'));
try {
  mkdirSync(join(temp, 'scripts'), { recursive: true });
  mkdirSync(join(temp, 'tests/fixtures/contracts'), { recursive: true });
  cpSync('scripts/test-contract-fixtures.mjs', join(temp, 'scripts/test-contract-fixtures.mjs'));
  const fixturePath = join(temp, 'tests/fixtures/contracts/fds-transport-v1.json');
  const fixture = JSON.parse(readFileSync('tests/fixtures/contracts/fds-transport-v1.json', 'utf8'));
  fixture.contractVersion = 'deliberately-invalid';
  writeFileSync(fixturePath, JSON.stringify(fixture));
  let failed = false;
  try {
    execFileSync(process.execPath, [join(temp, 'scripts/test-contract-fixtures.mjs')], { cwd: temp, stdio: 'pipe' });
  } catch (error) {
    failed = Number.isInteger(error?.status) && error.status !== 0;
  }
  assert.equal(failed, true, 'a deliberately broken contract fixture must exit nonzero for CI to reject');
  console.log('G0 negative control passed: broken contract fixture exits nonzero.');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
