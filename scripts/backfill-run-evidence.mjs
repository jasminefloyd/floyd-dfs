import { createHash } from 'node:crypto';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

dotenv.config({ path: '.env.local', quiet: true });
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured.');
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: WebSocket } });
const tenantResult = await db.from('tenants').select('id').eq('slug', 'floyd-dfs').single();
if (tenantResult.error) throw tenantResult.error;
const tenantId = tenantResult.data.id;
const runResult = await db.from('generation_runs').select('id,created_at').eq('tenant_id', tenantId).order('created_at').limit(5000);
if (runResult.error) throw runResult.error;
const runIds = (runResult.data ?? []).map((row) => row.id);
const runData = new Map(); const stages = [];
for (let i = 0; i < runIds.length; i += 10) {
  console.log(`Reading run evidence ${i + 1}-${Math.min(i + 10, runIds.length)} of ${runIds.length}`);
  const ids = runIds.slice(i, i + 10);
  const [runRows, stageRows] = await Promise.all([
    db.from('generation_runs').select('id,request_payload,created_at').eq('tenant_id', tenantId).in('id', ids),
    db.from('engine_stage_runs').select('generation_run_id,stage,version,output_payload,created_at').eq('tenant_id', tenantId).in('generation_run_id', ids).in('stage', ['SLATE','RESEARCH','SPORT_ADJUSTMENT','PROJECTION','OPTIMIZE','SELECTION']).order('version', { ascending: false }),
  ]);
  if (runRows.error) throw runRows.error; if (stageRows.error) throw stageRows.error;
  for (const row of runRows.data ?? []) runData.set(row.id, row);
  for (const row of stageRows.data ?? []) stages.push({ ...row, input_payload: null });
}
const stagesByRun = new Map();
for (const row of stages) { const current = stagesByRun.get(row.generation_run_id) ?? {}; if (!current[row.stage]) current[row.stage] = row; stagesByRun.set(row.generation_run_id, current); }
let inserted = 0; let missingSlate = 0;
for (const runRef of runResult.data ?? []) {
  const run = runData.get(runRef.id) ?? runRef;
  const request = record(run.request_payload); const input = record(request.input); const rawSlate = record(input.validatedSlate);
  if (!rawSlate.slateId || !rawSlate.contest) { missingSlate += 1; continue; }
  const stageSet = stagesByRun.get(run.id) ?? {};
  const stageOutput = (name) => stageSet[name]?.output_payload ?? null;
  const stageInput = (name) => stageSet[name]?.input_payload ?? null;
  const slate = record(stageOutput('SLATE'));
  const research = record(stageOutput('RESEARCH'));
  const adjustment = record(stageOutput('SPORT_ADJUSTMENT'));
  const projection = record(stageOutput('PROJECTION'));
  const optimizer = record(stageOutput('OPTIMIZE'));
  const selection = record(stageOutput('SELECTION'));
  const generatedAt = String(projection.generatedAt ?? stageSet.PROJECTION?.created_at ?? run.created_at);
  const contest = record(rawSlate.contest); const lock = Date.parse(String(contest.lockTime ?? ''));
  const playerPool = Array.isArray(slate.playerPool) ? slate.playerPool : Array.isArray(rawSlate.playerPool) ? rawSlate.playerPool : [];
  const missingStages = ['SLATE','RESEARCH','SPORT_ADJUSTMENT','PROJECTION','OPTIMIZE','SELECTION'].filter((name) => !stageSet[name]);
  const payload = { snapshotVersion: 'complete-run-evidence.v1', backfilledAt: new Date().toISOString(), timing: { generatedAt, lockTime: contest.lockTime ?? null, preLock: Number.isFinite(lock) && Date.parse(generatedAt) < lock }, snapshotCompleteness: { status: missingStages.length ? 'PARTIAL_LEGACY' : 'COMPLETE', missingStages }, slateId: rawSlate.slateId, contestIdentity: { draftKingsContestId: contest.draftKingsContestId ?? input.contestId ?? null, name: contest.name ?? null, format: contest.format ?? null, lockTime: contest.lockTime ?? null, objective: contest.objective ?? null, contestKind: contest.contestKind ?? null, contestSize: contest.contestSize ?? null, entryFee: contest.entryFee ?? null, paidPositions: contest.paidPositions ?? null, payoutStructure: contest.payoutStructure ?? null }, rawSlate, enrichedSlate: Object.keys(slate).length ? slate : rawSlate, stageInputs: { slate: stageInput('SLATE'), research: stageInput('RESEARCH'), adjustment: stageInput('SPORT_ADJUSTMENT'), projection: stageInput('PROJECTION'), optimization: stageInput('OPTIMIZE'), selection: stageInput('SELECTION') }, research, adjustment, projection, optimizer, selection, modelVersions: { research: research.version ?? stageSet.RESEARCH?.version ?? null, adjustment: adjustment.version ?? stageSet.SPORT_ADJUSTMENT?.version ?? null, projection: projection.modelVersion ?? null, optimizer: optimizer.version ?? stageSet.OPTIMIZE?.version ?? null, selection: selection.version ?? stageSet.SELECTION?.version ?? null }, sourceTimestamps: { runCreatedAt: run.created_at, slate: rawSlate.receivedAt ?? null, research: research.generatedAt ?? stageSet.RESEARCH?.created_at ?? null, projection: projection.generatedAt ?? null, weather: playerPool.flatMap((player) => player.sportContext?.mlb?.gameWeather?.retrievedAt ? [player.sportContext.mlb.gameWeather.retrievedAt] : []), availability: playerPool.flatMap((player) => player.availability?.retrievedAt ? [player.availability.retrievedAt] : []) } };
  const content_sha256 = createHash('sha256').update(stableJson(payload)).digest('hex');
  const saved = await db.from('floyd_dfs_run_data_snapshots').upsert({ tenant_id: tenantId, generation_run_id: run.id, slate_id: String(rawSlate.slateId), snapshot_type: 'COMPLETE_RUN_EVIDENCE', source: 'ENGINE_BACKFILL', payload, source_retrieved_at: generatedAt, content_sha256 }, { onConflict: 'tenant_id,generation_run_id,snapshot_type,source,content_sha256', ignoreDuplicates: true });
  if (saved.error) throw saved.error;
  inserted += 1;
  if (inserted % 10 === 0) console.log(`Saved ${inserted} run evidence snapshots`);
}
console.log(JSON.stringify({ scannedRuns: runResult.data?.length ?? 0, snapshotsInsertedOrPresent: inserted, missingValidatedSlate: missingSlate, stageRowsRead: stages.length, note: 'Legacy snapshots label missing stages and pre-lock eligibility explicitly; they do not recreate evidence that was never saved.' }, null, 2));
function record(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function stableJson(value) { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`; return `{${Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([key,item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`; }
