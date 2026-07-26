import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { parseOwnershipRows } from '../parser.ts';

Deno.test('parseOwnershipRows extracts ownership from a DailyFantasyFuel-style table fixture', async () => {
  const fixture = await Deno.readTextFile(new URL('./fixtures/dailyfantasyfuel_table.md', import.meta.url));
  const rows = parseOwnershipRows(fixture);
  assertEquals(rows.length, 11);
  assertEquals(rows[0], { player_name: 'Jalen Brunson', ownership_pct: 28.5 });
  assertEquals(rows.find((row) => row.player_name === 'LaMelo Ball')?.ownership_pct, 17.1);
});

Deno.test('parseOwnershipRows returns no rows for an empty table', () => {
  const rows = parseOwnershipRows('| Player | Own% |\n| --- | --- |\n');
  assertEquals(rows, []);
});
