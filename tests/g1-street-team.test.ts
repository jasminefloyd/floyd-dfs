import assert from 'node:assert/strict';
import { meaningfulEvidenceHash } from '../server/streetTeam/changeDetection.js';
import { decideScheduledRefresh, refreshIntervalMs, refreshWindowKey } from '../server/streetTeam/scheduler.js';
import { assessRefreshPolicy, evaluateDailyProviderBudget } from '../server/streetTeam/refreshPolicy.js';
import { scoutWorkUnits } from '../server/streetTeam/scoutAssignments.js';
import { snapshotChanges } from '../server/streetTeam/briefing.js';
import { detectStreetTeamMaterialChanges } from '../server/streetTeam/recheck.js';
import { resolveDraftKingsPoolIds, teamForAsOf } from '../server/streetTeam/entityResolver.js';
import type { NbaStreetTeamObservationInput } from '../server/nbaStreetTeamProvider.js';
import { SportsDataIoClient } from '../src/lib/engine/sportsDataIoProvider.js';
import { applyNbaStreetTeamIdentityGate } from '../server/streetTeam/slateGate.js';
import { replayPlayerTeamAsOf } from '../server/streetTeam/asOfRepository.js';
import { nearLockAlerts } from '../server/streetTeam/health.js';
import { nbaScheduleSyncIntervalMs, normalizeEspnNbaSchedule } from '../server/streetTeam/nbaScheduleRepository.js';
import { mergeStreetTeamRefresh } from '../server/streetTeam/refreshMerge.js';
import type { StreetTeamSnapshot } from '../src/lib/engine/contracts.js';

const now = new Date('2026-10-30T20:00:00.000Z');
assert.equal(refreshIntervalMs('FULL', { scheduled: true, nextLockAt: '2026-10-30T20:30:00Z' }, now), 24 * 60 * 60_000);
assert.equal(refreshIntervalMs('AVAILABILITY', { scheduled: false }, now), 24 * 60 * 60_000);
assert.equal(refreshIntervalMs('TRANSACTIONS', { scheduled: true, nextLockAt: '2026-10-30T23:00:00Z' }, now), 60 * 60_000);
assert.equal(refreshIntervalMs('LINEUPS', { scheduled: true, nextLockAt: '2026-10-30T21:30:00Z' }, now), 10 * 60_000);
assert.match(refreshWindowKey('AVAILABILITY', now, 10 * 60_000), /^AVAILABILITY:/);
assert.equal(decideScheduledRefresh({ now, nextLockAt: '2026-10-30T20:10:00Z', lastAttemptAt: {} }).kind, 'PRE_LOCK_VERIFY');
assert.equal(decideScheduledRefresh({ now, nextLockAt: '2026-10-30T21:00:00Z', lastAttemptAt: {} }).kind, 'LINEUPS');
const discoveredOnlyBySchedule = decideScheduledRefresh({ now, nextGameAt: '2026-10-30T20:30:00Z', nextGameId: 'espn-game-1', lastAttemptAt: {} });
assert.equal(discoveredOnlyBySchedule.kind, 'LINEUPS', 'a discovered NBA game can schedule a refresh without a generation run or contest lock');
assert.equal(discoveredOnlyBySchedule.gameId, 'espn-game-1');
assert.match(discoveredOnlyBySchedule.reason, /no DraftKings lock time is inferred/);
assert.equal(decideScheduledRefresh({ now, nextLockAt: '2026-10-30T21:00:00Z', lastAttemptAt: {}, providerQuotaState: { remaining: 0, resetAt: '2026-10-30T20:30:00Z' } }).kind, undefined);

const scoreboard = { events: [
  { id: 'espn-game-1', date: '2026-11-01T00:30:00Z', season: { year: 2026 }, status: { type: { state: 'pre', name: 'STATUS_SCHEDULED' } }, competitions: [{ competitors: [{ homeAway: 'home', team: { id: '10', abbreviation: 'NYK' } }, { homeAway: 'away', team: { id: '20', abbreviation: 'BOS' } }]}] },
  { id: 'espn-game-2', date: '2026-11-01T01:00:00Z', status: { type: { state: 'post', name: 'STATUS_POSTPONED', description: 'Postponed' } }, competitions: [{ competitors: [{ homeAway: 'home', team: { id: '30', abbreviation: 'LAL' } }, { homeAway: 'away', team: { id: '40', abbreviation: 'GSW' } }]}] },
] };
const normalizedSchedule = normalizeEspnNbaSchedule(scoreboard, '2026-10-31T20:00:00Z');
assert.equal(normalizedSchedule.length, 2, 'all simultaneous games are normalized');
assert.equal(normalizedSchedule[0]?.scheduled_start_at, '2026-11-01T00:30:00.000Z', 'schedule instants are stored in UTC across the DST boundary');
assert.equal(normalizedSchedule[0]?.home_team_id, '10');
assert.equal(normalizedSchedule[1]?.status, 'POSTPONED');
assert.throws(() => normalizeEspnNbaSchedule({ events: [{ id: 'bad', date: 'invalid' }] }, now.toISOString()), /malformed event/);
assert.throws(() => normalizeEspnNbaSchedule({ error: 'not a scoreboard' }, now.toISOString()), /events array/);
assert.equal(nbaScheduleSyncIntervalMs(now, '2026-10-30T20:30:00Z'), 15 * 60_000);
assert.equal(nbaScheduleSyncIntervalMs(now, '2026-11-03T23:00:00Z'), 12 * 60 * 60_000);

const base: NbaStreetTeamObservationInput = {
  id: 'id-a', provider: 'SportsDataIO', sourceRecordId: '42', sourceUrl: 'https://api.example/players', subjectKind: 'PLAYER', subjectId: 'nba:player:sdio:42',
  claim: 'Player is questionable.', classification: 'SINGLE_SOURCE_REPORT', confidence: 0.5, observedAt: now.toISOString(), retrievedAt: now.toISOString(), payload: { status: 'QUESTIONABLE' },
};
assert.equal(meaningfulEvidenceHash([base]), meaningfulEvidenceHash([{ ...base, id: 'id-b', observedAt: '2026-10-30T20:01:00.000Z', retrievedAt: '2026-10-30T20:01:00.000Z' }]));
assert.notEqual(meaningfulEvidenceHash([base]), meaningfulEvidenceHash([{ ...base, claim: 'Player is out.' }]));

const ready = assessRefreshPolicy({ kind: 'AVAILABILITY', schedulerAvailable: true, providerQuotaRemaining: 1, lastSuccessAt: now.toISOString(), now, maxAgeMs: 60 * 60_000, identityVerified: true, injuryVerified: true });
assert.equal(ready.readiness, 'READY');
const unavailable = assessRefreshPolicy({ kind: 'AVAILABILITY', schedulerAvailable: false, providerQuotaRemaining: 0, now, maxAgeMs: 60 * 60_000, identityVerified: false, injuryVerified: false });
assert.equal(unavailable.readiness, 'BLOCKED');
assert.equal(unavailable.mayRefresh, false);
assert.deepEqual(evaluateDailyProviderBudget(undefined, 0), { allowed: false, remaining: 0, reason: 'Verified daily provider-call budget is not configured.' });
assert.deepEqual(evaluateDailyProviderBudget(25, 20), { allowed: true, remaining: 5 });
assert.equal(evaluateDailyProviderBudget(25, 25).allowed, false);
assert.equal(evaluateDailyProviderBudget('UNLIMITED', 250, true).allowed, true);
assert.equal(evaluateDailyProviderBudget('UNLIMITED', 0, false).allowed, false);

assert.deepEqual(scoutWorkUnits('SportsDataIO', '/nba/projections/json/InjuredPlayers', 'Player injury status questionable.'), ['INJURY']);
assert.ok(scoutWorkUnits('ESPN NBA', '/rss', 'Player returns to former team').includes('FORMER_TEAM'));
const previousSnapshot = { resolvedFacts: [
  { id: 'a', subject: { kind: 'PLAYER', id: 'player-1' }, factType: 'availability.injury_status', value: { normalizedStatus: 'QUESTIONABLE' }, observationIds: ['obs-old'], state: 'ACCEPTED' },
  { id: 'b', subject: { kind: 'PLAYER', id: 'player-2' }, factType: 'roster.membership', value: { team: 'BOS' }, observationIds: ['obs-prior-roster'], state: 'ACCEPTED' },
] } as unknown as StreetTeamSnapshot;
const currentSnapshot = { resolvedFacts: [
  { id: 'c', subject: { kind: 'PLAYER', id: 'player-1' }, factType: 'availability.injury_status', value: { normalizedStatus: 'OUT' }, observationIds: ['obs-new'], state: 'ACCEPTED' },
] } as unknown as StreetTeamSnapshot;
const briefingChanges = snapshotChanges(currentSnapshot, previousSnapshot);
assert.equal(briefingChanges.length, 2);
assert.equal(briefingChanges.find((item) => item.subjectId === 'player-1')?.actionable, true);
assert.deepEqual(briefingChanges.find((item) => item.subjectId === 'player-1')?.observationIds, ['obs-new']);
assert.equal(briefingChanges.find((item) => item.subjectId === 'player-2')?.after, null);
const priorAvailabilitySnapshot = { availability: [{ playerId: 'nba:player:sportsdataio:42', status: 'QUESTIONABLE', observedAt: now.toISOString(), evidenceIds: ['obs-questionable'] }], rosterState: [{ playerId: 'nba:player:sportsdataio:42', teamId: 'nba:team:BOS', status: 'Active', validFrom: now.toISOString(), evidenceIds: ['obs-bos'] }] } as unknown as StreetTeamSnapshot;
const nextAvailabilitySnapshot = { availability: [{ playerId: 'nba:player:sportsdataio:42', status: 'OUT', observedAt: now.toISOString(), evidenceIds: ['obs-out'] }], rosterState: [{ playerId: 'nba:player:sportsdataio:42', teamId: 'nba:team:NY', status: 'Active', validFrom: now.toISOString(), evidenceIds: ['obs-ny'] }] } as unknown as StreetTeamSnapshot;
const materialChanges = detectStreetTeamMaterialChanges(nextAvailabilitySnapshot, priorAvailabilitySnapshot);
assert.deepEqual(materialChanges.map((item) => item.eventType).sort(), ['AVAILABILITY_CHANGE', 'ROSTER_CHANGE']);
assert.deepEqual(resolveDraftKingsPoolIds([{ playerId: 'dk-42', identity: { sportsDataIoId: '42' } }], '42'), { playerIds: ['dk-42'], unresolved: false });
assert.deepEqual(resolveDraftKingsPoolIds([{ playerId: 'dk-43' }], '42'), { playerIds: [], unresolved: true });
assert.equal(teamForAsOf([
  { asOf: '2026-10-29T12:00:00Z', rosterState: [{ playerId: 'nba:player:sportsdataio:42', teamId: 'BOS' }] },
  { asOf: '2026-10-30T12:00:00Z', rosterState: [{ playerId: 'nba:player:sportsdataio:42', teamId: 'NY' }] },
], 'nba:player:sportsdataio:42', '2026-10-29T20:00:00Z'), 'BOS');
const quotaClient = new SportsDataIoClient({ apiKey: 'fixture', requestBudget: 1, fetcher: async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json', 'x-ratelimit-limit': '100', 'x-ratelimit-remaining': '7' } }) });
const quotaAssertion = quotaClient.get('NBA', 'scores', 'Players').then(async () => {
  assert.equal(quotaClient.latestQuotaState?.limit, 100);
  assert.equal(quotaClient.latestQuotaState?.remaining, 7);
  assert.equal(quotaClient.latestQuotaState?.rateLimited, false);
  await assert.rejects(() => quotaClient.get('NBA', 'scores', 'Players'), /request budget exhausted/);
  assert.equal(quotaClient.requestsMade, 1);
}).catch((error: unknown) => { console.error(error); process.exitCode = 1; });
let limitCalls = 0;
const limitClient = new SportsDataIoClient({ apiKey: 'fixture', maxAttempts: 1, fetcher: async () => ++limitCalls === 1
  ? new Response('limited', { status: 429, headers: { 'retry-after': '60' } })
  : new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }) });
const limitAssertion = limitClient.get('NBA', 'scores', 'Players').catch(() => undefined).then(async () => {
  await limitClient.get('NBA', 'scores', 'Players');
  assert.equal(limitClient.latestQuotaState?.rateLimited, true);
}).catch((error: unknown) => { console.error(error); process.exitCode = 1; });
void quotaAssertion;
void limitAssertion;
const gateSlate = { sport: 'NBA', tenantId: 'tenant', playerPool: [
  { playerId: 'dk-42', playerName: 'Mapped Player', team: 'BOS', identity: { draftKingsId: '42', sportsDataIoId: '42', confidence: 'EXACT', matchedBy: 'PROVIDER_ID' } },
  { playerId: 'dk-99', playerName: 'Unmapped Player', team: 'NY', identity: { draftKingsId: '99', confidence: 'LOW', matchedBy: 'UNMAPPED' } },
] } as unknown as import('../src/lib/engine/contracts.js').ValidatedSlate;
const gateSnapshot = { sport: 'NBA', tenantId: 'tenant', asOf: now.toISOString(), resolvedFacts: [{ id: 'rf-1', subject: { kind: 'PLAYER', id: 'nba:player:sportsdataio:42' }, factType: 'roster.membership', value: { providerPlayerId: '42', draftKingsPlayerId: '42', team: 'BOS' }, state: 'ACCEPTED' }] } as unknown as StreetTeamSnapshot;
const gated = applyNbaStreetTeamIdentityGate(gateSlate, gateSnapshot, now);
assert.deepEqual(gated.slate.playerPool.map((player) => player.playerId), ['dk-42']);
assert.equal(gated.excluded[0]?.reason.includes('exact DraftKings-to-SportsDataIO'), true);
const fact = (id: string, factType: string, value: unknown) => ({ id, tenantId: 'tenant', sport: 'NBA' as const, subject: { kind: 'PLAYER' as const, id: 'nba:player:sportsdataio:42' }, factType, value, observationIds: [`obs-${id}`], state: 'ACCEPTED' as const, confidence: 0.8, resolvedAt: now.toISOString(), ruleVersion: 'test.v1' });
const priorMergeSnapshot = { observations: [], resolvedFacts: [fact('prior-roster', 'roster.membership', { teamId: 'BOS', team: 'BOS', providerStatus: 'Active', providerPlayerId: '42', draftKingsPlayerId: '42' }), fact('prior-injury', 'availability.injury_status', { normalizedStatus: 'QUESTIONABLE' }), fact('prior-trade', 'transaction.record', { transactionType: 'Trade', fromTeamId: 'BOS', toTeamId: 'NY' }), fact('prior-lineup', 'lineup.status', { teamId: 'BOS', status: 'STARTER' })], rosterState: [], availability: [], transactions: [], providerDiagnostics: [], unknowns: [] } as unknown as StreetTeamSnapshot;
const incrementalMerge = mergeStreetTeamRefresh(priorMergeSnapshot, { rosterAvailable: true, observations: [], providerDiagnostics: [], unknowns: [], rosterState: [], availability: [{ playerId: 'nba:player:sportsdataio:42', status: 'OUT', observedAt: now.toISOString(), evidenceIds: ['obs-new'] }], transactions: [], resolvedFacts: [fact('new-roster', 'roster.membership', { teamId: 'BOS', team: 'BOS', providerStatus: 'Active', providerPlayerId: '42', draftKingsPlayerId: '42' }), fact('new-injury', 'availability.injury_status', { normalizedStatus: 'OUT' })] }, 'AVAILABILITY', now);
assert.deepEqual(incrementalMerge.resolvedFacts.map((item) => item.factType).sort(), ['availability.injury_status', 'lineup.status', 'roster.membership', 'transaction.record']);
const mergedInjuryFact = incrementalMerge.resolvedFacts.find((item) => item.factType === 'availability.injury_status');
assert.ok(mergedInjuryFact);
assert.equal((mergedInjuryFact.value as { normalizedStatus: string }).normalizedStatus, 'OUT');
const transactionFact = { id: 'trade-1', subject: { kind: 'PLAYER', id: 'nba:player:sportsdataio:42' }, factType: 'transaction.record', value: { fromTeamId: 'BOS', toTeamId: 'NY' }, effectiveAt: '2026-10-29T00:00:00Z', resolvedAt: '2026-10-30T12:00:00Z', state: 'ACCEPTED' } as unknown as import('../src/lib/engine/contracts.js').StreetTeamResolvedFact;
const rosterHistory = [
  { asOf: '2026-10-28T12:00:00Z', rosterState: [{ playerId: 'nba:player:sportsdataio:42', teamId: 'BOS' }], resolvedFacts: [] },
  { asOf: '2026-10-30T12:00:00Z', rosterState: [{ playerId: 'nba:player:sportsdataio:42', teamId: 'NY' }], resolvedFacts: [transactionFact] },
];
assert.equal(replayPlayerTeamAsOf(rosterHistory, 'nba:player:sportsdataio:42', '2026-10-28T12:00:00Z', '2026-10-31T00:00:00Z'), 'BOS');
assert.equal(replayPlayerTeamAsOf(rosterHistory, 'nba:player:sportsdataio:42', '2026-10-30T12:00:00Z', '2026-10-31T00:00:00Z'), 'NY');
assert.equal(replayPlayerTeamAsOf(rosterHistory, 'nba:player:sportsdataio:42', '2026-10-28T11:00:00Z', '2026-10-28T11:00:00Z'), undefined);
assert.ok(nearLockAlerts('2026-10-30T20:30:00Z', gateSnapshot, { status: 'FAILED', finished_at: now.toISOString(), result: { providerDiagnostics: [] } }, now).length > 0);
console.log('G1 scheduler defaults, state hashing, policy gates, and scout work classification passed.');
