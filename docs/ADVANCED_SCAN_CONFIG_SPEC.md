# Advanced Scan Config — Specification & Engine Wiring

**Target use case:** DraftKings Showdown primarily, Classic occasionally. 1–5 entries per
contest. Field size varies by contest.

**Verified against:** repository snapshot dated 2026-07-26. Line numbers refer to that
snapshot.

---

## Design Principle

**Have the user describe the contest. Derive the strategy from that description.**

The current model asks for a strategy label (`contestStrategy`) and conflates it with
contest format:

```ts
// generate-pios-lineups/index.ts:390
function defaultContestStrategy(contestType: string, lineupMode: string): string {
  if (contestType === 'showdown') return 'showdown';   // <-- format, not strategy
  ...
}
```

`showdown` is not a strategy. A $5 Showdown 3-max with 300 entries and a $20 Showdown
milly-maker with 80,000 entries need opposite construction, and both are "showdown."
Because `showdown` short-circuits the strategy branch, **neither ever reaches
`large_field_gpp`** — which is the only strategy that activates ownership leverage
(`index.ts:1092`, `index.ts:1437`).

The fix is to make **field size**, **entry count**, and **payout shape** the primary
inputs, and compute the strategy internally. The user knows those three facts from the
DraftKings lobby. They should not have to translate them into a strategy label.

---

## Current State: What's Already Wired vs. What's Hardcoded

Everything below already flows end-to-end through
`piosFunctionClient.ts` → `generate-pios-lineups/index.ts`. It's only the UI that pins it.

```ts
// src/components/MIOS_FantasyScanner.tsx:30 — the entire problem
const HIGHEST_PROJECTION_OPTIONS = {
  riskTolerance: 'balanced',
  lineupMode: 'max_fpts',
  maxPlayerExposure: 1,
  maxTeamExposure: 1,
  minPrimaryStack: 0,
  diversifyLineups: false,
  lateSwapMode: true,
};
// ...and line 80:
const contestStrategy = contestType === 'showdown' ? 'showdown' : 'single_entry';
```

| Field | Plumbed? | Currently |
|-------|----------|-----------|
| `riskTolerance` | ✅ | pinned `balanced` |
| `lineupMode` | ✅ | pinned `max_fpts` |
| `contestStrategy` | ✅ | pinned by contest type |
| `maxPlayerExposure` | ✅ | pinned `1` (no cap) |
| `maxTeamExposure` | ✅ | pinned `1` (no cap) |
| `minPrimaryStack` | ✅ | pinned `0` |
| `diversifyLineups` | ✅ | pinned `false` |
| `lateSwapMode` | ✅ | pinned `true` |
| `excludedPlayers` | ✅ | exposed in UI |
| **`entryCount`** | ❌ | does not exist |
| **`fieldSize`** | ❌ | does not exist |
| **`payoutShape`** | ❌ | does not exist |
| **`maxCaptainExposure`** | ❌ | does not exist |
| **`lockedPlayers`** | ❌ | does not exist |
| **`captainPool`** | ❌ | does not exist |
| **`minSalaryUsed`** | ❌ | does not exist |
| **`maxDuplication`** | ❌ | does not exist |

Roughly half the panel is exposing what's already there. The other half needs building.

---

## The Config Panel

Collapsed by default behind an **Advanced** disclosure, with the preset selector visible
above it. Persist last-used values per `(sport, contestType)` in localStorage.

### Group 1 — Contest Description (drives everything else)

| Field | Type | Default | Range | Notes |
|-------|------|---------|-------|-------|
| `entryCount` | number | 1 | 1–20 | How many lineups to build |
| `fieldSize` | number | — | 2–500,000 | Entrants in the contest. Read from the DK lobby |
| `maxEntriesPerUser` | number | 1 | 1–150 | The contest's own limit (single / 3-max / 20-max / 150-max) |
| `payoutShape` | select | `top_heavy` | `flat` \| `top_heavy` \| `winner_take_all` \| `double_up` | Determines the objective |

**`payoutShape` is the objective selector.** This is what `lineupMode` should have been:

- `double_up` → maximize P(finish in top ~44%). Optimize floor.
- `flat` → maximize P(finish in cash line, roughly top 20%). Balanced.
- `top_heavy` → maximize expected payout, weighted toward P(top 1%). Standard GPP.
- `winner_take_all` → maximize P(finish 1st). Maximum leverage.

### Group 2 — Strategy

| Field | Type | Default | Range | Notes |
|-------|------|---------|-------|-------|
| `lineupMode` | select | derived | `max_fpts` \| `balanced_ev` \| `tournament` \| `safe` | Keep as an override; default derived from `payoutShape` |
| `riskTolerance` | select | `balanced` | `conservative` \| `balanced` \| `aggressive` | See fix in §4.6 — currently mostly controls sim iterations |
| `ownershipWeight` | slider | derived | 0.0–2.0 | Multiplier on the leverage term. NEW |
| `correlationWeight` | slider | derived | 0.0–2.0 | Multiplier on stack/game-script bonuses. NEW |

`lineupMode` should default from `payoutShape` (`double_up` → `safe`, `top_heavy` →
`tournament`, etc.) but stay user-overridable. **It must never default to `max_fpts` in
any tournament context** — see §4.1.

### Group 3 — Construction Constraints

| Field | Type | Default | Range | Notes |
|-------|------|---------|-------|-------|
| `maxPlayerExposure` | slider | see presets | 0.2–1.0 | Fraction of your lineups any one player may appear in |
| `maxTeamExposure` | slider | 1.0 | 0.2–1.0 | Meaningless in Showdown (only 2 teams) — hide it there |
| `minSalaryUsed` | number | 49,000 | 40,000–50,000 | NEW. Leaving salary on the table is a real leak |
| `lockedPlayers` | multi-select | `[]` | — | NEW. Force into every lineup |
| `excludedPlayers` | multi-select | `[]` | — | Already exists; upgrade from comma-string to picker |
| `minPrimaryStack` | number | 0 | 0–5 | Classic only. Hide in Showdown |

### Group 4 — Showdown-Specific (show only when `contestType === 'showdown'`)

| Field | Type | Default | Range | Notes |
|-------|------|---------|-------|-------|
| `maxCaptainExposure` | slider | 0.4 | 0.2–1.0 | **The most important setting on this panel.** Fraction of lineups sharing a captain |
| `captainPool` | multi-select | all | — | Restrict which players are CPT-eligible |
| `minPerTeam` | number | 1 | 1–3 | DK requires ≥1. Setting 2 forces genuine game-script exposure |
| `forceUniqueCaptains` | boolean | `true` when `entryCount ≤ 5` | — | Every lineup gets a different captain |

**Why `maxCaptainExposure` matters more than anything else here:** the captain is a 1.5x
multiplier on points and salary, and it's the single largest source of differentiation in
a ~25-player pool. Captain selection is currently sorted by raw projection
(`index.ts:650`), which means you are captaining the chalk on every entry.

With 1–5 entries, `forceUniqueCaptains: true` is close to a hard requirement. Five lineups
sharing a captain is one bet entered five times.

### Group 5 — Advanced / Diagnostics

| Field | Type | Default | Range | Notes |
|-------|------|---------|-------|-------|
| `simulationIterations` | select | derived | 5k / 25k / 100k | Decouple from `riskTolerance` — see §4.6 |
| `fieldSimulationSize` | number | derived from `fieldSize` | 1,000–20,000 | Currently pinned at 240 |
| `maxDuplication` | number | derived | 1–500 | Reject lineups projected to be entered more than N times. NEW |
| `showDiagnostics` | boolean | `false` | — | Surface win rate, duplication estimate, leverage per lineup |

---

## §4 — Engine Changes Required

Exposing the config is not enough. Several settings currently have no effect, or the wrong
one. Ordered by how much they block everything else.

### 4.1 `max_fpts` short-circuits the entire engine `P0`

Four separate bypasses fire when `lineupMode === 'max_fpts'`, which is what the UI always
sends:

```ts
// index.ts:471 — anti-correlation filtering skipped
const antiCorrelationFiltered = lineupMode === 'max_fpts' ? strategyCandidates : ...

// index.ts:483 — Monte Carlo never runs
const rankedSource = lineupMode === 'max_fpts'
  ? simulationCandidates
  : runMonteCarloSimulations(...);

// index.ts:1388 — diversification returns early
if (!rules.diversifyLineups || lineupMode === 'safe' || lineupMode === 'max_fpts') return lineups;

// index.ts:1447 — ranking is raw projection
if (lineupMode === 'max_fpts') return projected;
```

- [ ] Keep `max_fpts` as an explicit user choice, but never as a default
- [ ] Default `lineupMode` from `payoutShape`
- [ ] Add a UI warning when `max_fpts` is selected with `fieldSize > 100`: *"Max-projection
      builds are the most duplicated lineups in large fields."*

### 4.2 Entry count is hardcoded `P0`

```ts
// index.ts:502-504
if (lineupMode === 'max_fpts') return finalLineups.slice(0, 5);
if (riskTolerance === 'aggressive' || lineupMode === 'tournament') return finalLineups.slice(0, 5);
return finalLineups.slice(0, 3);

// index.ts:1390
const targetCount = 5;   // inside diversifyRankedLineups
```

You currently receive 5 lineups when you asked for nothing, and because §4.1 skips
diversification, those 5 are the top 5 by projection — minor perturbations of the same
build. For Showdown that is one bet entered five times.

- [ ] Thread `entryCount` through the payload into both call sites
- [ ] Replace all three `slice()` calls with `slice(0, entryCount)`
- [ ] Replace `targetCount = 5` with the same value

### 4.3 Exposure caps are bypassed for the first two lineups `P0`

```ts
// index.ts:1408
if (exposureFlags.length && nextIndex > 2) continue;
```

Lineups 1 and 2 ignore every exposure cap. At `entryCount = 2` — a 3-max contest, which
you play — **exposure limits never apply at all.**

- [ ] Remove the `nextIndex > 2` escape, or make it `nextIndex > Math.ceil(entryCount * 0.2)`
- [ ] Surface exposure violations in the response rather than silently admitting them

### 4.4 The simulation cannot see the captain `P0`

`runMonteCarloSimulations` maps lineup players back to roster entries by `player_id`
(`index.ts:1271-1280`) and sums base outcomes:

```ts
for (const index of lineupIndexes.get(lineup) ?? []) total += outcomes[index] ?? 0;
```

The 1.5x captain multiplier lives on the lineup's player copy (`index.ts:659`), not the
roster entry. **Two lineups with identical players but different captains simulate to
exactly the same score.** The field generator has the same gap — `simulation.ts:229`
applies base salary to the CPT slot.

- [ ] Carry `salary_multiplier` / `roster_slot` into the simulation lookup and apply
      `outcomes[index] * 1.5` for the CPT slot
- [ ] Apply `Math.floor(salary * 1.5)` to the CPT slot in `generateFieldLineups`
- [ ] Add a test: same 6 players, different captains ⇒ different `simulation_ev`

Nothing about captain optimization works until this is fixed.

### 4.5 Ownership leverage is unreachable `P0`

```ts
// index.ts:1437
const ownershipPenalty = rules.contestStrategy === 'large_field_gpp' ? (lineup.ownership_sum ?? 0) * 9 : 0;
// index.ts:938
const tournamentBoost = rules?.contestStrategy === 'large_field_gpp' ? ... - ownership * 6 : 0;
```

`contestStrategy` is pinned to `showdown` or `single_entry` by the UI, so both terms are
always zero.

- [ ] Derive `contestStrategy` from `fieldSize` + `payoutShape` + `maxEntriesPerUser`,
      not from `contestType`
- [ ] Make ownership weighting continuous via `ownershipWeight` rather than a strategy
      branch — a 300-entry Showdown and an 80,000-entry Showdown should sit at different
      points on the same axis, not in different code paths

Suggested derivation:

```ts
function deriveStrategy(fieldSize: number, payoutShape: string, maxEntries: number) {
  if (payoutShape === 'double_up') return 'cash';
  if (fieldSize <= 100) return 'single_entry';
  if (fieldSize <= 2_000) return 'small_field';
  return 'large_field_gpp';
}
// ownershipWeight scales roughly with log10(fieldSize)
```

### 4.6 `riskTolerance` mostly controls simulation iterations `P1`

```ts
// index.ts:1292
const iterations = riskTolerance === 'conservative' ? 450
  : riskTolerance === 'aggressive' ? 800 : 600;
```

Simulation precision is a compute decision, not a risk preference. Asking for aggressive
lineups should not silently buy you 33% more iterations, and asking for conservative ones
should not degrade your estimates.

- [ ] Separate `simulationIterations` into its own config
- [ ] Raise the floor substantially — 600 iterations cannot estimate a top-1% tail; you'll
      see roughly 6 hits at `beaten >= 0.99`, which is noise
- [ ] Keep `riskTolerance` as a pure objective-shaping knob (`index.ts:1451-1452`)

### 4.7 Field simulation is 240 lineups `P1`

```ts
const FIELD_LINEUP_CAP = 240;    // index.ts:197
```

- [ ] Drive from `fieldSize`: `min(fieldSize, 20_000)`
- [ ] Fix the mislabeled metric — `top_10_rate` currently counts `beaten >= 0.9`, i.e. the
      top **decile**, not the top 10 places (`index.ts:1318`). Rename to
      `top_decile_rate` and add a true `top_n_rate` driven by `fieldSize`
- [ ] Build the simulated field to resemble a real one: a mix of chalk-optimal, ownership-
      weighted random, and leverage builds — not purely ownership-weighted draws
      (`simulation.ts:238`)

### 4.8 Captain selection ignores everything but projection `P1`

```ts
// index.ts:650
const captains = [...players].sort((a, b) => adjustedProjection(b) - adjustedProjection(a));
```

- [ ] Sort by projection **per unit of captain ownership**, not projection
- [ ] Respect `captainPool` when provided
- [ ] Enforce `maxCaptainExposure` and `forceUniqueCaptains` in `diversifyRankedLineups`
- [ ] Source CPT-slot ownership separately from FLEX ownership — DK reports them
      separately and they diverge sharply. The scraper (`scrape-ownership/parser.ts`)
      currently produces one number per player

### 4.9 New: duplication estimate `P2`

With ~25 players and 6 slots, the top-projection lineup is entered many times. Nothing in
the codebase models this.

- [ ] Estimate `P(lineup)` as the product of slot-level ownership, then
      `expectedDuplicates ≈ P(lineup) * fieldSize`
- [ ] Reject or penalize lineups exceeding `maxDuplication`
- [ ] Display expected duplicates per lineup — for a 1–5 entry player this is the single
      most actionable number on the results screen

### 4.10 New: locked players and min salary `P2`

- [ ] `lockedPlayers`: filter the candidate search to lineups containing all locks
- [ ] `minSalaryUsed`: add to `validateLineup` (`index.ts:969`). The showdown generator has
      no salary floor at all — only a cap (`index.ts:648`)

---

## §5 — Presets

Preset buttons above the Advanced disclosure. Each writes the full config; the user can
then adjust anything.

| Preset | entryCount | payoutShape | maxPlayerExp | maxCaptainExp | ownershipWeight | lineupMode |
|--------|-----------|-------------|--------------|---------------|-----------------|------------|
| **Showdown Single-Entry** | 1 | `top_heavy` | 1.0 | 1.0 | 1.0 | `tournament` |
| **Showdown 3-Max** | 3 | `top_heavy` | 0.67 | 0.34 | 1.2 | `tournament` |
| **Showdown 5-Max** | 5 | `top_heavy` | 0.60 | 0.20 | 1.3 | `tournament` |
| **Showdown Cash / Double-Up** | 1–3 | `double_up` | 1.0 | 1.0 | 0.2 | `safe` |
| **Classic Single-Entry GPP** | 1 | `top_heavy` | 1.0 | — | 1.0 | `tournament` |
| **Classic Small-Field** | 3 | `flat` | 0.67 | — | 0.7 | `balanced_ev` |
| **Max Projection (diagnostic)** | 1 | — | 1.0 | 1.0 | 0.0 | `max_fpts` |

Note `maxCaptainExposure` at 3 and 5 entries: 0.34 and 0.20 both resolve to **one lineup
per captain**. That is deliberate. With five entries in a Showdown you want five different
game-script bets, not five variations on one.

Keep the last row as a labeled diagnostic so you can compare a leverage build against the
raw chalk optimal — but it should never be the default.

---

## §6 — Implementation Order

| Wave | Work | Why first |
|------|------|-----------|
| **1** | §4.1, §4.2 — unpin `lineupMode`, thread `entryCount` | Nothing else runs until the engine stops short-circuiting |
| **2** | §4.4 — captain multiplier in simulation | Captain optimization is impossible without it |
| **3** | §4.3, §4.8 — exposure caps, captain diversity | Turns 5 duplicate lineups into 5 distinct bets |
| **4** | §4.5, §4.7 — strategy derivation, field sizing | Makes ownership leverage real |
| **5** | Build the UI panel + presets | The config surface itself |
| **6** | §4.6, §4.9, §4.10 | Refinements |

Waves 1–3 are roughly two days and will change your output more than everything else
combined. The UI panel can come after — you can test with hardcoded values first by
editing `HIGHEST_PROJECTION_OPTIONS` directly.

---

## §7 — Validation

Extend `src/lib/validation.ts` (currently checks only sport, contest type, date, risk
tolerance, lineup mode):

- [ ] `entryCount` ≤ `maxEntriesPerUser`, warn when `entryCount > 1` and `maxEntriesPerUser === 1`
- [ ] `fieldSize` ≥ 2, warn if unset in tournament modes — the objective is undefined without it
- [ ] `maxCaptainExposure * entryCount >= 1` (otherwise unsatisfiable)
- [ ] `lockedPlayers` fit under the salary cap together, and CPT-eligible if `captainPool` set
- [ ] `lockedPlayers` and `excludedPlayers` don't intersect
- [ ] `minPerTeam * 2 <= rosterSize`
- [ ] Warn when `minSalaryUsed` is unreachable given locks

Mirror these server-side in `validatePayload` (`index.ts:380`) — the edge function is
callable directly and should not trust the client.
