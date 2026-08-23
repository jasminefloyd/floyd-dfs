import { mapWithConcurrency } from '../enrichment.ts';

Deno.test('mapWithConcurrency never exceeds the configured limit', async () => {
  let active = 0;
  let maxActive = 0;
  const limit = 3;

  const results = await mapWithConcurrency(
    Array.from({ length: 12 }, (_, index) => index),
    limit,
    async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return value * 2;
    },
  );

  if (maxActive > limit) {
    throw new Error(`Expected max concurrency <= ${limit}, got ${maxActive}`);
  }
  if (results.join(',') !== '0,2,4,6,8,10,12,14,16,18,20,22') {
    throw new Error(`Results were not returned in input order: ${results.join(',')}`);
  }
});
