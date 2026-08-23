import { assert, assertEquals } from '../testAssert.ts';
import { createRequestId, PHASE0_DOSSIER_VERSION, withStage, type Phase0Observability } from '../decisionContracts.ts';

Deno.test('Phase 0 request IDs and dossier version are stable contracts', () => {
  const requestId = createRequestId();
  assert(/^[0-9a-f-]{36}$/i.test(requestId), 'request ID should be a UUID');
  assertEquals(PHASE0_DOSSIER_VERSION, 'dossier-v1');
});

Deno.test('withStage records successful stage timing and metadata', async () => {
  const telemetry: Phase0Observability = {
    request_id: createRequestId(),
    generated_at: new Date().toISOString(),
    stages: [],
    source_counts: {},
    fallbacks: [],
    candidate_counts: {},
    rejection_counts: {},
  };

  const result = await withStage(telemetry, 'fixture_stage', () => 'ok', { input_count: 3, output_count: 2 });
  assertEquals(result, 'ok');
  assertEquals(telemetry.stages.length, 1);
  assertEquals(telemetry.stages[0].stage, 'fixture_stage');
  assertEquals(telemetry.stages[0].input_count, 3);
  assertEquals(telemetry.stages[0].output_count, 2);
  assert(telemetry.stages[0].duration_ms >= 0, 'stage duration should be non-negative');
});

Deno.test('withStage records failed stages before rethrowing', async () => {
  const telemetry: Phase0Observability = {
    request_id: createRequestId(),
    generated_at: new Date().toISOString(),
    stages: [],
    source_counts: {},
    fallbacks: [],
    candidate_counts: {},
    rejection_counts: {},
  };

  let failed = false;
  try {
    await withStage(telemetry, 'failed_stage', () => { throw new Error('fixture failure'); });
  } catch (error) {
    failed = error instanceof Error && error.message === 'fixture failure';
  }
  assert(failed, 'withStage should rethrow the operation error');
  assertEquals(telemetry.stages.length, 1);
  assertEquals(telemetry.stages[0].stage, 'failed_stage');
});
