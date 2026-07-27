# Fantasy AI — Remediation & Refactor Checklist

**Primary use case:** DraftKings **Showdown** (NBA), 1–5 entries per contest. Classic
occasionally. Field size varies by contest.

**Scope:** targeted rebuild of the lineup construction, simulation, and projection layers.
The data ingestion, DK scoring, minutes-opportunity model, slate import, and persistence
are sound and should be kept.

**Verified against:** repository snapshot dated 2026-07-26. All line numbers refer to that
snapshot — re-confirm before applying any patch.

**Companion doc:** `ADVANCED_SCAN_CONFIG_SPEC.md` covers the config panel field-by-field.
Phase 3 here references it rather than duplicating it.

**Legend**

| Tag | Meaning |
|-----|---------|
| `P0` | The engine is off or producing invalid output. Fix before entering another contest. |
| `P1` | Core construction quality. The reason lineups don't place. |
| `P2` | Projection accuracy and realism. |
| `P3` | Infrastructure, hygiene, non-primary sports. |
| `EST` | Rough engineering estimate, solo dev. |

---

## Phase 0 — Measure the Right Thing First

You currently cannot tell a good lineup from a lucky one, and the metric you *do* track is
aimed at the wrong target.

- [x] **0.1 `P0` Your scoreboard measures projection accuracy, not results.**
      `supabase/migrations/20260723110000_fantasy_ai_generated_lineups_scoreboard.sql`
      tracks `actual_points`, `optimal_points`, and `pct_of_optimal`. It does **not** track
      contest finish position, payout, field size, or entry fee.

      `pct_of_optimal` answers "did I build a high-scoring lineup." It cannot answer "did I
      win money." Those diverge exactly where your problem lives: you can hit 95% of
      optimal and finish 4,000th because 500 people submitted the same build, or hit 80%
      and cash because you were uniquely positioned. Optimizing `pct_of_optimal` actively
      pushes you toward chalk.
      - [x] Add `field_size`, `entry_fee`, `finish_rank`, `payout`, `entry_count` to
            `generated_lineups`
      - [x] Add manual entry in the UI to record finish + payout after a contest
      - [x] Make **ROI** and **percentile finish** the headline metrics, not `pct_of_optimal`
      `EST: 4h`
- [ ] **0.2 `P0` Freeze a baseline.** Tag current `main` as `v0-baseline`. Export every
      `generated_lineups` row you have with whatever contest results you can reconstruct
      from DK's history export. This is your control group. `EST: 2h`
      Progress: local tag `v0-baseline` exists and `scripts/export-generated-lineups.mjs`
      was added. Live export is blocked because Supabase REST does not expose
      `tenant_fantasy_ai`.
- [x] **0.3 `P0` Define the scorecard.** New file `docs/EVALUATION.md`. Lock these before
      changing anything, so the goalposts can't move:
      - ROI per contest, and cumulative
      - Median and best finish percentile
      - Duplication rate (how many entrants shared your exact lineup — DK shows this)
      - Captain distribution across your entries
      - Rank correlation (Spearman) between projected and actual player points — this is
        the only projection metric that matters for construction, not mean absolute error
      `EST: 2h`
- [x] **0.4 `P1` Build a replay harness.** New file
      `supabase/functions/_shared/eval/replay.ts`. Input: a stored MIOS manifest + config.
      Output: lineups, without hitting live providers. Lets you re-run past slates against
      new settings offline. `EST: 1d`
- [x] **0.5 `P1` Centralize the magic numbers.** New file
      `supabase/functions/generate-pios-lineups/weights.ts`. Move every coefficient out of
      `playerValueScore`, `lineupIntelligenceScore`, and `lineupRankScore` into one
      exported, versioned object with a `weights_version` string. Persist it on every
      `generated_lineups` row. Without this you can never attribute a result change to a
      weight change. `EST: 4h`

---

## Phase 1 — Turn the Engine On `P0`

The tournament apparatus exists and has never executed in production.

### 1.1 `max_fpts` short-circuits four separate systems

- [x] **`src/components/MIOS_FantasyScanner.tsx:30`**
  ```ts
  const HIGHEST_PROJECTION_OPTIONS = {
    riskTolerance: 'balanced',
    lineupMode: 'max_fpts',      // <-- this
    maxPlayerExposure: 1,
    maxTeamExposure: 1,
    minPrimaryStack: 0,
    diversifyLineups: false,     // <-- and this
    lateSwapMode: true,
  };
  ```
  Sent on every scan, with no UI control to change it. Downstream:
  ```ts
  // generate-pios-lineups/index.ts:471 — anti-correlation filtering skipped
  const antiCorrelationFiltered = lineupMode === 'max_fpts' ? strategyCandidates : ...

  // index.ts:483 — Monte Carlo never runs
  const rankedSource = lineupMode === 'max_fpts'
    ? simulationCandidates
    : runMonteCarloSimulations(...);

  // index.ts:1388 — diversification returns immediately
  if (!rules.diversifyLineups || lineupMode === 'safe' || lineupMode === 'max_fpts') return lineups;

  // index.ts:1447 — ranking is raw projected points
  if (lineupMode === 'max_fpts') return projected;
  ```
  - [x] Change the default to `tournament` for GPP contexts
  - [x] Keep `max_fpts` selectable, labeled as a diagnostic
  - [x] Add a UI warning when `max_fpts` is chosen with `fieldSize > 100`
  `EST: 2h` — highest ROI change in the repo

### 1.2 `large_field_gpp` is unreachable, so ownership leverage is always zero

- [x] **`src/components/MIOS_FantasyScanner.tsx:80`**
  ```ts
  const contestStrategy = contestType === 'showdown' ? 'showdown' : 'single_entry';
  ```
  Hardcoded. And `large_field_gpp` is the only branch that activates leverage:
  ```ts
  // index.ts:1437
  const ownershipPenalty = rules.contestStrategy === 'large_field_gpp' ? (lineup.ownership_sum ?? 0) * 9 : 0;
  // index.ts:938
  const tournamentBoost = rules?.contestStrategy === 'large_field_gpp' ? ... - ownership * 6 : 0;
  ```
  - [x] Derive strategy from `fieldSize` + `payoutShape` + `maxEntriesPerUser` (see spec §4.5)
  - [x] Replace the strategy branch with a continuous `ownershipWeight` — a 300-entry and
        an 80,000-entry Showdown belong on the same axis, not in different code paths
  `EST: 4h`

### 1.3 Entry count is hardcoded in two places

- [x] **`index.ts:502-504`**
  ```ts
  if (lineupMode === 'max_fpts') return finalLineups.slice(0, 5);
  if (riskTolerance === 'aggressive' || lineupMode === 'tournament') return finalLineups.slice(0, 5);
  return finalLineups.slice(0, 3);
  ```
- [x] **`index.ts:1390`** — `const targetCount = 5;` inside `diversifyRankedLineups`
  - [x] Thread `entryCount` through the payload to both
  - [x] Because 1.1 skips diversification, today's 5 lineups are the top 5 by projection —
        minor perturbations of one build. For Showdown that is one bet entered five times
  `EST: 3h`

### 1.4 Exposure caps are bypassed for the first two lineups

- [x] **`index.ts:1408`**
  ```ts
  if (exposureFlags.length && nextIndex > 2) continue;
  ```
  Lineups 1 and 2 ignore every exposure cap. **At 2 entries — a 3-max contest — exposure
  limits never apply at all.**
  - [x] Remove the escape, or scale it: `nextIndex > Math.max(1, Math.ceil(entryCount * 0.2))`
  - [x] Return exposure violations in the response instead of silently admitting them
  `EST: 2h`

---

## Phase 2 — Showdown Correctness `P0`

Showdown is your primary format and has the most broken handling.

### 2.1 The simulation cannot see the captain

- [x] **`index.ts:1271-1280`** maps lineup players to roster entries by `player_id`, then
      sums base outcomes:
  ```ts
  for (const index of lineupIndexes.get(lineup) ?? []) total += outcomes[index] ?? 0;
  ```
  The 1.5x multiplier lives on the lineup's player copy (`index.ts:659`), not the roster
  entry. **Two lineups with identical players and different captains simulate to exactly
  the same score.** The single most important Showdown decision is invisible to the model.
  - [x] Carry `roster_slot` / `salary_multiplier` into the simulation lookup; apply
        `outcomes[index] * 1.5` for the CPT slot
  - [x] Same fix in `simulation.ts` field scoring
  - [x] Test: same 6 players, different captains ⇒ different `simulation_ev`
  `EST: 4h` — blocks all captain work

### 2.2 The simulated field ignores the captain multiplier entirely

- [x] **`simulation.ts:213-215`** builds showdown slots but never applies 1.5x:
  ```ts
  const slots = contestType === 'showdown'
    ? Array.from({ length: 6 }, (_, index) => ({ slot: index === 0 ? 'CPT' : `FLEX${index}`, eligible: ... }))
    : slotsBySport[sport] ?? [];
  ```
  And **`simulation.ts:229`** checks `salaryUsed + player.salary > 50_000` using base salary
  for the CPT slot. Field lineups are therefore built against the wrong cap and scored
  without the captain bonus — systematically low.
  - [x] Apply `Math.floor(salary * 1.5)` to the CPT slot in `generateFieldLineups`
  - [x] Apply the 1.5x scoring bonus to the field's CPT slot
  `EST: 3h`

### 2.3 Captain selection is a plain projection sort

- [x] **`index.ts:650`**
  ```ts
  const captains = [...players].sort((a, b) => adjustedProjection(b) - adjustedProjection(a));
  ```
  The captain is where nearly all Showdown differentiation lives, and you are captaining
  the chalk on every entry.
  - [x] Sort by projection **per unit of captain ownership**, not projection
  - [x] Honor a `captainPool` config when provided
  - [x] Enforce `maxCaptainExposure` and `forceUniqueCaptains` in `diversifyRankedLineups`
  `EST: 6h`

### 2.4 CPT-slot ownership is not modeled

- [x] DK reports captain ownership separately from FLEX ownership for the same player, and
      they diverge sharply. `scrape-ownership/parser.ts` produces one number per player.
  - [x] Extend the parser and `ownership_projections` schema to carry `cpt_ownership_pct`
        and `flex_ownership_pct`
  - [x] Fall back to a modeled split when only one number is available (captain ownership
        is roughly proportional to projection rank, more concentrated than FLEX)
  - [x] This is what makes the standard leverage play expressible: fade a player as
        captain while still rostering him in FLEX. The current model cannot represent it
  `EST: 1d`

### 2.5 The showdown search prunes away the entire leverage space

- [x] **`index.ts:645-715`** — `generateExactShowdownLineups` is a correct branch-and-bound
      exhaustive search. But both the pruning bound and `insertTopLineup` (`index.ts:635`)
      sort on `projected_points`, keeping the top 140 (`MAX_CANDIDATE_LINEUPS`).

      With ~25 players that's roughly a million legal lineups reduced to the 140 highest
      projections. Every lineup reaching the ranking stage is chalk by construction.
  - [x] Keep a diverse pool: stratify by captain, then keep the top N per captain
  - [x] Add a secondary pool sampled by leverage (projection ÷ ownership)
  - [x] Raise `SIMULATION_LINEUP_CAP` (currently 36) well above `entryCount * 20`
  `EST: 1d`

### 2.6 No duplication modeling

- [x] With ~25 players and 6 slots, the max-projection lineup is entered many times. In a
      top-heavy Showdown, being one of 400 identical entries is most of why you don't place.
  - [x] Estimate `P(lineup)` as the product of slot-level ownership (using CPT ownership
        for the captain slot), then `expectedDuplicates ≈ P(lineup) * fieldSize`
  - [x] Add `maxDuplication` as a rejection threshold
  - [x] Display expected duplicates per lineup — for a 1–5 entry player this is the most
        actionable number on the results screen
  `EST: 1d`

### 2.7 Showdown validation gaps

- [x] `index.ts:977` correctly enforces DK's both-teams rule. Good — keep it.
- [x] No salary **floor** exists for showdown (`index.ts:648` caps only). Leaving $3k
      unspent is a real leak.
  - [x] Add `minSalaryUsed` to `validateLineup` (`index.ts:969`), default ~49,000
- [x] `showdownRosterSize` (`index.ts:728`) reads `slate.data.roster_size` and falls back
      to 6. Verify the import populates it; a wrong roster size silently produces invalid
      lineups DK will reject
  `EST: 3h`

---

## Phase 3 — Config Surface `P1`

Full field-by-field spec in **`ADVANCED_SCAN_CONFIG_SPEC.md`**. Summary of build order:

- [x] **3.1** Add `entryCount`, `fieldSize`, `maxEntriesPerUser`, `payoutShape` to the
      payload, `PiosLineupRequest`, and `validatePayload` (`index.ts:380`)
- [x] **3.2** Replace `HIGHEST_PROJECTION_OPTIONS` with real form state
- [x] **3.3** Build the Advanced disclosure panel, grouped per spec §3
      Note: player list controls are normalized comma-separated multi-entry inputs because
      the scanner does not have a roster before MIOS runs.
- [x] **3.4** Add Showdown-only group: `maxCaptainExposure`, `captainPool`, `minPerTeam`,
      `forceUniqueCaptains`
- [x] **3.5** Add presets (spec §5) — Showdown Single / 3-Max / 5-Max / Cash
- [x] **3.6** Persist last-used config per `(sport, contestType)` in localStorage
- [x] **3.7** Extend `src/lib/validation.ts` per spec §7, and mirror server-side
- [x] **3.8** Hide irrelevant fields by format: `maxTeamExposure` and `minPrimaryStack` are
      meaningless in Showdown (two teams, always stacked)
- [x] **3.9** Persist the resolved config on `generated_lineups` so results are attributable
      `EST: 3d`

---

## Phase 4 — Projection Layer `P2`

### 4.1 Player variance is a constant

- [x] **`index.ts:918-924`**
  ```ts
  let volatility = sport === 'mlb' ? 0.34 : 0.24;
  volatility += (1 - confidence) * 0.22;
  volatility += Math.max(0, (runFactor ?? 1) - 1) * (isPitcher(player) ? 0.1 : 0.35);
  volatility += (player.ownership_projection ?? 0.12) < 0.1 ? 0.04 : 0;
  ```
  Feeds `playerStdDev` (`index.ts:1201`). Every NBA player gets roughly the same
  coefficient of variation, so lineup ceiling becomes a near-monotonic function of lineup
  mean — the Monte Carlo reproduces the projection ranking.

  Real per-game fantasy points are **already computed and stored** at
  `mios-fantasy-scan/index.ts:2757`. The standard deviation is never calculated.
  - [x] Compute σ from the last N game scores, shrunk toward a positional prior:
        `σ = σ_observed * (n/(n+4)) + σ_position_prior * (4/(n+4))`
  - [x] Scale σ by projected minutes uncertainty — a player with a confirmed 34-minute
        role is far more predictable than one whose minutes depend on a game-time decision
  - [x] Store `stdev_fantasy_pts` on the last-5 stats payload so PIOS doesn't recompute
  - [x] **Remove ownership from the volatility formula.** Low ownership does not make a
        player more volatile; it makes him more *leveraged*. Conflating the two double-counts
  `EST: 1d` — the highest-value projection change

### 4.2 No matchup layer at all

- [ ] Repo-wide search finds no defense-vs-position, no opponent defensive rating, no
      positional matchup data of any kind. The only opponent-aware signal for NBA is the
      Vegas team implied total (`index.ts:2011-2032`), which captures game environment,
      not "this guard draws the league's worst perimeter defense."
  - [ ] Add opponent DvP by position from a free source; apply as a multiplier bounded
        ~0.90–1.10
  - [ ] Weight by sample size — early-season DvP is noise
  - [ ] In Showdown this matters doubly: with only two teams, matchup is one of the few
        remaining sources of differentiation between the ~25 available players
      Not implemented yet: this requires selecting and validating a free DvP/source feed.

### 4.3 `pace_metric` is declared but never computed or read

- [ ] Present in four type definitions (`MIOS_FantasyAgents.ts:76`,
      `PIOS_FantasyGenerator.ts:33`, `generate-pios-lineups/index.ts:38` and `:79`) and
      copied through two pass-throughs (`piosFunctionClient.ts:86`,
      `generate-pios-lineups/index.ts:429`). Always `undefined`.
  - [ ] Populate from team possessions per 48, or delete the field
      Not implemented yet: no verified possessions-per-48 source is wired into this repo.

### 4.4 No rest, back-to-back, or travel factors

- [ ] Home/away is tracked only to assign Vegas implied totals (`index.ts:788`). Home court
      enters indirectly through the spread; B2B fatigue — one of the more reliable NBA DFS
      angles — is absent entirely.
  - [ ] Add `days_rest` and `is_back_to_back` from the schedule
  - [ ] Apply a minutes reduction on the second night of a B2B, especially for veterans
  - [ ] Add an explicit small home/away term so it's auditable rather than buried in the spread
      Not implemented yet: this requires schedule/history data not currently validated in the app.

### 4.5 News handling

- [x] **`index.ts:3307`** — `newsInjuryStatus` joins *all* matched news into one string and
      tests patterns in fixed priority order with `out` first. A stale "ruled out" from last
      week beats a fresh "expected to play" today. **There is no recency ordering.**
  - [x] Sort news items by timestamp descending; resolve from the most recent item only
  - [x] Discard injury signals older than ~48h
- [x] **`index.ts:3304`** — `matchingNewsItems` requires the full normalized name as a
      substring, so "LeBron ruled out" fails against `lebronjames`
  - [x] Match on last name plus team, and maintain a nickname alias table
- [x] **`index.ts:3318`** — `applyPlayerNewsSignals` caps news impact at 0.92–1.08, and
      `negativeNews` matches `questionable|doubtful|out`, which `newsInjuryStatus` already
      handles — injury designations are counted twice
  - [x] Separate injury-status news from performance/role news; stop double-counting
  - [x] Add negation handling: "not starting" currently matches the `starting` positive pattern
- [x] Reddit `sentimentScore` is fetched and read (`index.ts:3321`) but only used in a
      display string — it never reaches the projection
  - [x] Either wire it in with a small weight, or remove the fetch and its rate-limit cost
  `EST: 1d`

### 4.6 Projection ceiling is capped by DK's own numbers

- [x] `opportunity.ts` clamps the blended projection to ±35% of `baseProjection`, which is
      the DK-imported number every other entrant also has. Your best original signal — the
      minutes cascade — can only move a player 35% from consensus.
  - [x] Widen the clamp when the minutes cascade is driven by a **confirmed** inactive
        (high confidence), keep it tight when driven by a questionable tag
  - [x] Track how often the clamp binds; if it binds frequently the band is too narrow

### 4.7 Calibration is mean-bias only

- [x] **`migrations/20260720090000_fantasy_ai_projection_calibration.sql:352-360`**
  ```sql
  AVG(results.actual_points) / AVG(results.projected_points) AS projection_bias_multiplier
  ```
  A ratio of averages, dominated by high-projection players, with no minimum sample guard.
  It corrects mean bias — which is second-order. What matters for construction is **rank
  accuracy** and **variance calibration**.
  - [x] Add a minimum sample size before any multiplier is applied
  - [x] Use average of ratios, or median ratio, so cheap players are visible
  - [x] Add Spearman correlation between projected and actual as a tracked metric
  - [x] Add variance calibration: is realized σ close to modeled σ? If modeled σ is too
        low, every ceiling estimate is wrong
  `EST: 6h`

---

## Phase 5 — Simulation Realism `P1`

### 5.1 The field is 240 lineups and iterations are 600

- [ ] **`index.ts:192-197`**
  ```ts
  const MONTE_CARLO_ITERATIONS = 600;
  const AGGRESSIVE_MONTE_CARLO_ITERATIONS = 800;
  const CONSERVATIVE_MONTE_CARLO_ITERATIONS = 450;
  const MAX_CANDIDATE_LINEUPS = 140;
  const SIMULATION_LINEUP_CAP = 36;
  const FIELD_LINEUP_CAP = 240;
  ```
  At 600 iterations, `win_rate` (`beaten >= 0.99`) produces ~6 hits — noise. `p99_score` is
  the 6th-highest of 600 samples.
  - [x] Drive field size from `fieldSize`: `min(fieldSize, 20_000)`
  - [x] Raise iterations to 10k–100k, configurable, decoupled from `riskTolerance`
  - [ ] Move the simulation off the request path if latency becomes a problem
      Progress: request-path simulation now supports configurable 5k–100k iterations and
      configurable field simulation size capped at 20k. Async/off-path execution remains open.

### 5.2 `top_10_rate` measures the top decile

- [x] **`index.ts:1318`** — `if (beaten >= 0.9) top10s.set(...)`. That's the top **10
      percent** of a 240-lineup field, presented under a name that reads as top 10 places.
      In a 5,000-entry Showdown those differ by two orders of magnitude.
  - [x] Rename to `top_decile_rate`
  - [x] Add a true `top_n_rate` computed from `fieldSize` and the payout curve

### 5.3 The simulated field is softer than a real field

- [ ] **`simulation.ts:238`** builds the field by ownership-weighted random draws
      (`ownership ** 1.15`). Real Showdown fields are full of optimizer output clustered on
      the same chalk builds.
  - [x] Compose the field: ~40% near-optimal chalk, ~40% ownership-weighted random,
        ~20% leverage builds
  - [ ] Validate against a real contest — DK's export shows the actual field's score
        distribution
      Progress: field composition is implemented; real-contest validation remains blocked
      until an actual DK contest export/baseline is available.

### 5.4 NBA correlation is too weak, and anti-correlation is missing

- [x] **`simulation.ts:91-124`** — team pulse σ=0.06, game pulse σ=0.05. Then the
      "regression toward team mean deviation" step (0.9/0.1 weights) *increases* positive
      correlation. NBA usage is close to zero-sum within a team; nothing models that.
- [x] **`antiCorrelation.ts:39`** — `detectAntiCorrelation` has MLB and NFL branches and
      returns `[]` for basketball.
  - [x] Add negative same-team usage correlation for NBA
  - [x] Raise the game pulse for Showdown specifically — a single-game slate is dominated
        by one game script (blowout vs. overtime), which is the strongest correlation in
        the format
  - [x] Add an NBA branch to `detectAntiCorrelation` covering blowout risk
  `EST: 1d`

### 5.5 NBA is stacked like it's MLB

- [x] **`index.ts:1034-1050`** — `stackQualityScore` is sport-agnostic and awards
      `stack.size * 2.1` in GPP mode to basketball. `lineupRankScore` (`index.ts:1440`) adds
      another `primary_stack_size * 4`. For a 3-man NBA stack that's about +12, roughly
      equal to the entire ownership penalty.
  - [x] Make stack weights sport-specific; NBA correlation is real but far weaker than MLB
  - [x] In Showdown, "stacking" is meaningless — every lineup is one game. Replace with a
        **game-script** concept: does this lineup win in a blowout, a shootout, or overtime?

### 5.6 The objective is a hand-weighted heuristic, not expected value

- [ ] **`index.ts:1447-1453`**
  ```ts
  if (lineupMode === 'tournament') return ceiling * 100 + leverage * 10 + winRate * 30 + ev + strategyAdjustment;
  ```
  `ceiling * 100` is ~30,000 for an NBA lineup; `winRate * 30` at a 1% win rate is 0.3. The
  simulation's most valuable output is weighted at roughly one hundred-thousandth of the score.
  - [x] Rank by expected payout: `Σ P(finish in bracket) * payout(bracket)`, using the
        payout curve from `payoutShape`
  - [x] Keep the heuristic terms only as tiebreakers, at weights that reflect that
  - [ ] Verify: with a flat payout the ranking should approach EV-maximizing; with
        winner-take-all it should approach P(1st)-maximizing
      Progress: ranking now uses expected payout as the primary term. The flat/winner-take-all
      behavior has not been test-verified because Deno is not installed locally.
  `EST: 1d`

### 5.7 `estimateOwnership` derives ownership from projection

- [x] **`index.ts:1193-1199`** — when the scraper hasn't run, ownership is computed from
      projection and salary. It then carries zero independent information, and subtracting
      it just discounts the projection you already have. A model that derives ownership
      from value can never find leverage.
  - [x] Treat missing ownership as **missing**, not estimated
  - [x] Warn loudly in the UI when generating tournament lineups without real ownership
  - [x] Add a scraper health check with slate-level coverage percentage

---

## Phase 6 — Portfolio Construction for 1–5 Entries `P1`

Low-volume multi-entry is its own problem. You can't rely on portfolio effects — each
lineup must be individually strong *and* meaningfully different.

- [x] **6.1** Enforce unique captains across entries when `entryCount <= 5` (Showdown)
- [x] **6.2** Add a minimum pairwise difference constraint — no two of your lineups should
      share more than N of 6 players
- [x] **6.3** Optimize the **set**, not each lineup independently. Five lineups each
      maximizing P(top 1%) individually will converge; the set should maximize
      P(*at least one* finishes top 1%), which naturally spreads across game scripts
- [x] **6.4** Present the set with its rationale: which game script each lineup wins in,
      and expected duplication for each
- [x] **6.5** Add a correlation view — if all five lineups need the same team to blow out,
      that's one bet, and the UI should say so
      Note: Showdown portfolios with `entryCount <= 5` now use a default max overlap of
      4 of 6 players, i.e. at least two different players per lineup pair.
  `EST: 2d`

---

## Phase 7 — Data Quality & Ingestion `P2`

- [x] **7.1** `normalizeName` (`mios-fantasy-scan/index.ts:504`) strips all non-alphanumerics.
      Cross-source player matching (DK ↔ ESPN ↔ ownership scrape ↔ news) depends on it.
      - [x] Build a canonical player ID map with alias handling (Jr./Sr./III, hyphens,
            accents, "Nic" vs "Nicolas")
      - [x] Log unmatched names per scan — silent match failures are invisible today
- [ ] **7.2** Confirmed-lineup scraping (`scrape-confirmed-lineups/`) is the highest-value
      NBA signal near lock. Verify it runs close enough to tip-off to matter, and surface
      staleness in the UI
      Progress: confirmed-lineup `scraped_at` staleness is surfaced in scan warnings.
      Not verified complete: repo comments state cron/pg_cron wiring is documented but not
      implemented locally, so close-to-tip scraping cadence has not been verified.
- [x] **7.3** Ownership scrape timing — ownership shifts sharply in the last hour. Record
      `scraped_at` and show it
- [x] **7.4** `dkScoring.ts` exists in two identical copies (`src/lib/` and
      `supabase/functions/_shared/`) with a "KEEP IN SYNC" comment. Extract to a shared
      package or generate one from the other
- [x] **7.5** `dkMlbPitcherFantasyPoints` falls back to the generic `hits` / `walks` keys
      for hits-allowed and walks-allowed. Ambiguous stat lines could double-count
- [x] **7.6** Vegas totals: `VEGAS_LEAGUE_AVERAGES` (`index.ts:1967`) hardcodes NBA at 114.
      League pace drifts season to season
      - [x] Compute the baseline from the current season's slate averages
- [x] **7.7** Add data-completeness gating: refuse to generate tournament lineups when
      ownership coverage is under ~70% of the slate, rather than silently estimating
  `EST: 2d`

---

## Phase 8 — Schema `P2`

- [x] **8.1 `..._contest_results.sql`** — add to `generated_lineups`: `field_size`,
      `entry_fee`, `max_entries_per_user`, `finish_rank`, `payout`, `entry_count`,
      `expected_duplicates`, `actual_duplicates`, `weights_version`, `config` (jsonb)
- [x] **8.2 `..._player_variance.sql`** — add `stdev_fantasy_pts`, `games_sample_size`,
      `minutes_stdev` to the last-5 stats table
- [x] **8.3 `..._cpt_ownership.sql`** — split `ownership_projections` into
      `cpt_ownership_pct` / `flex_ownership_pct`, add `scraped_at`
- [x] **8.4 `..._matchup_context.sql`** — new table for opponent DvP by position, team pace,
      days rest, B2B flag
- [x] **8.5 `..._player_aliases.sql`** — canonical player ID with source-specific aliases
- [x] **8.6** Mirror existing RLS patterns on every new table — the tenant model depends on it
  `EST: 1d`

---

## Phase 9 — Testing `P2`

Existing coverage: `dkScoring`, `simulation`, `opportunity`, `injuryStatus`, `enrichment`,
`antiCorrelation`, `classicSolver`, and two scraper parsers. Notably **no test for the
showdown solver** and none for the objective function.

- [x] **9.1** Showdown solver: valid lineups only (6 players, both teams, ≤$50k with 1.5x CPT)
- [x] **9.2** Captain multiplier: same 6 players, different captains ⇒ different sim EV
      *(this test fails today — see 2.1)*
- [x] **9.3** Entry count: request N ⇒ receive exactly N
- [x] **9.4** Exposure: with `maxPlayerExposure = 0.5` and 4 entries, no player appears more
      than twice *(fails today — see 1.4)*
- [x] **9.5** Unique captains: 5 entries with `forceUniqueCaptains` ⇒ 5 distinct captains
- [x] **9.6** Variance: two players with identical means and different game-log spread ⇒
      different σ *(fails today — see 4.1)*
- [x] **9.7** Objective: with a flat payout curve, ranking approaches EV order; with
      winner-take-all, approaches P(1st) order
- [x] **9.8** News recency: stale "out" + fresh "expected to play" ⇒ active *(fails today)*
- [x] **9.9** Name matching: "LeBron ruled out" matches LeBron James *(fails today)*
- [x] **9.10** Duplication: a chalk lineup in a 50k field returns a high expected-duplicate count
- [ ] **9.11** Integration: replay 20 past slates, assert the scorecard doesn't regress
      Progress: Phase 9 Deno test coverage was added for 9.1-9.10. Test execution is not
      locally verified because `deno` is not installed. The 20-slate replay remains open
      because no local past-slate fixture set is available.
  `EST: 2d`

---

## Phase 10 — Ops & Hygiene `P3`

- [x] **10.1** `README.md` is still the stock Vite template. Replace with actual setup,
      env vars, and deploy steps
- [x] **10.2** `riskTolerance` currently controls Monte Carlo iteration count
      (`index.ts:1292`). Simulation precision is a compute decision, not a risk preference —
      separate them
- [x] **10.3** Add structured logging per stage: candidates generated, candidates after
      filtering, simulation iterations, wall time
- [x] **10.4** Surface `data_warnings` prominently — missing ownership or stale confirmed
      lineups should block tournament generation, not warn quietly
- [ ] **10.5** Results ingestion runs daily at 11:00 UTC (`vercel.json`). Confirm West-coast
      NBA finals are settled by then; add a retry for late-settling stat corrections
      Progress: added a 15:00 UTC retry cron. Not verified complete: actual West-coast
      settlement timing was not validated against live production results.
- [x] **10.6** NFL/MLB/F1 paths are partially built. Either finish them or hide them —
      half-working sports produce silent garbage
      Progress: NBA, WNBA, MLB, and NFL are the supported product sports for Showdown and
      Classic. F1 was removed from product constants, validation, slate discovery, news,
      and fallback generator paths instead of remaining as a partial sport.
- [x] **10.7** Add a per-user rate limit on scan generation if `api/mios-fantasy/rate-limiter.ts`
      isn't already covering the PIOS path
  `EST: 1d`

---

## Suggested Sequencing

| Wave | Contents | Why this order |
|------|----------|----------------|
| **1** | 0.1–0.3, 1.1–1.4 | Measure ROI not `pct_of_optimal`; turn the engine on |
| **2** | 2.1, 2.2 | Captain multiplier in sim — blocks all Showdown work |
| **3** | 2.3, 2.5, 2.6, 6.1–6.2 | Captain leverage, pool diversity, duplication |
| **4** | 4.1, 5.1, 5.2 | Real variance + a real field — makes the sim meaningful |
| **5** | 3.1–3.9 | The config panel |
| **6** | 5.6, 1.2, 2.4 | EV objective, strategy derivation, CPT ownership |
| **7** | 4.2–4.7, 5.3–5.5 | Projection accuracy and correlation |
| **8** | 6.3–6.5, Phases 7–10 | Portfolio optimization, data, tests, hygiene |

Run the Phase 0 scorecard after waves 1, 3, and 4. Waves 1–3 are roughly a week and will
change your output more than everything after them combined.

Rough total: **4–6 weeks** of focused solo work.

---

## Bug Index

| # | File:Line | Defect | Severity |
|---|-----------|--------|----------|
| 1 | `MIOS_FantasyScanner.tsx:30` | `lineupMode: 'max_fpts'` hardcoded; disables sim, diversification, anti-correlation, and EV ranking | P0 |
| 2 | `MIOS_FantasyScanner.tsx:80` | `contestStrategy` hardcoded; `large_field_gpp` unreachable ⇒ ownership weight always 0 | P0 |
| 3 | `generate-pios-lineups/index.ts:1271-1280` | Simulation ignores the 1.5x captain multiplier; captain choice invisible | P0 |
| 4 | `simulation.ts:229` | Field generator uses base salary for the CPT slot | P0 |
| 5 | `index.ts:502-504`, `:1390` | Entry count hardcoded in two places | P0 |
| 6 | `index.ts:1408` | Exposure caps bypassed for the first 2 lineups | P0 |
| 7 | `index.ts:650` | Captain selection sorted by raw projection | P1 |
| 8 | `index.ts:635`, `:645-715` | Showdown search prunes to top 140 by projection | P1 |
| 9 | `index.ts:918-924`, `:1201` | Player variance is a constant; ceiling ≈ f(mean) | P1 |
| 10 | `index.ts:1447` | `ceiling * 100` swamps `winRate * 30` by ~5 orders of magnitude | P1 |
| 11 | `index.ts:192-197` | 600 iterations, 240-lineup field — cannot estimate tails | P1 |
| 12 | `index.ts:1318` | `top_10_rate` is actually top-decile rate | P1 |
| 13 | `index.ts:1193-1199` | `estimateOwnership` derives ownership from projection | P1 |
| 14 | `antiCorrelation.ts:39` | No NBA branch; returns `[]` for basketball | P1 |
| 15 | `simulation.ts:91-124` | NBA correlation too weak; no negative usage correlation | P1 |
| 16 | `index.ts:1034-1050`, `:1440` | NBA stacked at MLB weights | P1 |
| 17 | — | No CPT-slot ownership anywhere | P1 |
| 18 | — | No duplication modeling | P1 |
| 19 | `migrations/20260723110000...sql` | Scoreboard tracks `pct_of_optimal`, not ROI or finish | P1 |
| 20 | `mios-fantasy-scan/index.ts:3307` | Stale injury news overrides fresh; no recency ordering | P2 |
| 21 | `mios-fantasy-scan/index.ts:3304` | Full-name substring match; nicknames and last-name refs fail | P2 |
| 22 | `mios-fantasy-scan/index.ts:3318` | Injury designations double-counted; no negation handling | P2 |
| 23 | `mios-fantasy-scan/index.ts:3321` | Reddit sentiment computed, never used in projection | P2 |
| 24 | — | No DvP, opponent rating, pace, rest, or B2B anywhere | P2 |
| 25 | `PIOS_FantasyGenerator.ts:33` et al. | `pace_metric` declared in 4 files, never computed or read | P2 |
| 26 | `migrations/20260720090000...sql:352` | Calibration is ratio-of-averages with no sample guard | P2 |
| 27 | `index.ts:648`, `:969` | No salary floor for showdown | P2 |
| 28 | `index.ts:1292` | `riskTolerance` controls simulation iteration count | P3 |
| 29 | `src/lib/dkScoring.ts` | Duplicated file kept in sync by comment | P3 |
| 30 | `README.md` | Stock Vite template | P3 |

---

## One Thing to Decide Before Starting

Everything above makes the optimizer **correct** — it will stop building the same lineup
five times, stop captaining the chalk by default, stop reporting a top-decile rate as if it
were top-10, and start optimizing the objective you actually care about.

It will not make DFS profitable on its own. Large-field Showdown is negative-sum after
rake, and the players taking money out of those contests run similar models on paid
projection sources with better ownership data. A correct optimizer moves your distribution;
it doesn't guarantee placement.

The realistic goal is: stop losing to construction errors, then find out whether your
projection edge is real. Phase 0 is what tells you the answer — which is why it comes
first, and why `pct_of_optimal` has to be replaced with ROI before anything else changes.

This is engineering guidance, not betting advice.
