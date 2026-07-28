import { parseRotowireLineups } from '../parser.ts';

Deno.test('parseRotowireLineups parses synthetic NBA lineup cards', async () => {
  const html = await Deno.readTextFile(new URL('../__fixtures__/nba-sample.html', import.meta.url));
  const rows = parseRotowireLineups(html, 'nba', '2026-07-23');

  if (rows.length !== 10) throw new Error(`Expected 10 rows, got ${rows.length}`);

  const porzingis = rows.find((row) => row.player_name === 'Kristaps Porzingis');
  if (!porzingis || porzingis.team !== 'BOS' || porzingis.lineup_status !== 'confirmed' || porzingis.injury_tag !== 'OUT') {
    throw new Error(`Unexpected Porzingis row: ${JSON.stringify(porzingis)}`);
  }

  const hart = rows.find((row) => row.player_name === 'Josh Hart');
  if (!hart || hart.team !== 'NYK' || hart.lineup_status !== 'expected' || hart.injury_tag !== 'QUES') {
    throw new Error(`Unexpected Hart row: ${JSON.stringify(hart)}`);
  }
});

Deno.test('parseRotowireLineups does not synthesize MLB batting order from list position', () => {
  const rows = parseRotowireLineups(`
    <section data-team="SF" data-lineup-status="confirmed">
      <li data-player="Rafael Devers" data-batting-order="4">Rafael Devers</li>
      <li data-player="Bench Bat">Bench Bat</li>
    </section>
  `, 'mlb', '2026-07-27');

  const starter = rows.find((row) => row.player_name === 'Rafael Devers');
  const bench = rows.find((row) => row.player_name === 'Bench Bat');

  if (!starter || starter.batting_order !== 4) {
    throw new Error(`Expected explicit MLB batting order to be preserved: ${JSON.stringify(starter)}`);
  }
  if (!bench || bench.batting_order !== null) {
    throw new Error(`Expected missing MLB batting order to stay null: ${JSON.stringify(bench)}`);
  }
});
