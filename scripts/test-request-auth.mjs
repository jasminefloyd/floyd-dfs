import assert from 'node:assert/strict';
import { isOperator, parseBearer, secretMatches, tenantHeaderAllowed } from '../server/authPolicy.mjs';

assert.equal(parseBearer(undefined), undefined, 'missing bearer is denied');
assert.equal(parseBearer('Basic abc'), undefined, 'wrong auth scheme is denied');
assert.equal(parseBearer('Bearer token'), 'token');
assert.equal(tenantHeaderAllowed('tenant-a', undefined), true);
assert.equal(tenantHeaderAllowed('tenant-a', 'tenant-a'), true);
assert.equal(tenantHeaderAllowed('tenant-a', 'tenant-b'), false, 'cross-tenant header is denied');
assert.equal(secretMatches('correct-secret', 'correct-secret'), true);
assert.equal(secretMatches('incorrect-secret', 'correct-secret'), false, 'incorrect scheduler/worker secret is denied');
assert.equal(secretMatches(undefined, 'correct-secret'), false, 'missing scheduler/worker secret is denied');
assert.equal(isOperator('user-a', 'user-a,user-b'), true);
assert.equal(isOperator('user-c', 'user-a,user-b'), false, 'unlisted users have no operator privilege');
console.log('Request authorization policy checks passed.');
