# floyd-dfs — Consolidated Audit & Fix Report (v2)

**Repo:** `jasminefloyd/floyd-dfs` @ `a01773c`
**Supersedes:** `floyd-dfs-audit-phase1.md` (retire it; IDs below are canonical)
**Stated objective:** produce the valid DraftKings lineup with the highest estimated
fantasy-point total, for **Classic and Showdown** across **NBA, WNBA, NFL, MLB**.

This merges two independent reviews — my Phase 1 audit and an external engineering review of
19 items — into one register. Neither was a superset of the other. Overlaps are collapsed;
source attribution is retained per finding.

## Method and evidence standard

Every finding carries a status:

- **`VERIFIED`** — I executed something in this repo that demonstrates it. Repro included.
- **`READ`** — confirmed by direct code inspection at a cited line, not executed.
- **`INHERITED`** — reported by the external review, plausible and consistent with
  surrounding code, but **not independently confirmed by me**. Verify before acting.

I flag `INHERITED` explicitly rather than absorbing those claims as fact. The external review
has been accurate everywhere I checked it — eight of eight — so these are likely true. "Likely"
is not "verified," and this report does not blur the two.

**Baseline (executed):**

| Check | Result |
|---|---|
| `npm run build` | passes, 0 type errors |
| `npm run lint` | 0 errors, 2 warnings (dead MIOS collectors) |
| `deno test supabase/functions` | **27 passed / 3 failed** |

---

## Executive summary

The app does not pursue your goal, and would not reach it even if it did.

Three independent failures stack:

1. **The objective is not selected.** The UI cannot request `max_fpts`. Every lineup ever
   produced was ranked by tournament expected-payout and ownership leverage. (F-01)
2. **The objective is not reachable.** Even inside `max_fpts`, Showdown candidate generation
   orders by leverage, truncates before ranking, collapses distinct captain configurations as
   duplicates, and enforces a salary floor DraftKings does not require. Classic omits a
   mandatory DK legality rule entirely. (F-02 – F-08)
3. **The objective is the wrong quantity.** `projected_points` is populated from a
   DraftKings attribute that is a season average, then adjusted by MIOS, then adjusted again
   by PIOS using signals already baked into the first adjustment — while the field meant to
   preserve raw history is overwritten with model output. (F-09 – F-11)

A correct optimizer maximizing a corrupted input returns a confident wrong answer. That is the
current state.

**All three of your reported symptoms are now explained by specific verified defects:**

| Symptom | Cause |
|---|---|
| "Not winners, not even high scorers" | F-01 — ranked by tournament EV, never by points |
| "More lineups don't alter much" | F-07 — no-good cuts forbid only the exact roster; each lineup is a 1-player swap |
| "Players not playing that night" | F-12 — confirmed-lineup parser returns zero rows; nothing ever knew who was starting |

---

## Severity model

Ranked against the stated objective, not against general code quality.

- **S0** — Prevents returning the highest-projected legal lineup.
- **S1** — Corrupts the projection the optimizer maximizes, or the availability data
  determining who is eligible.
- **S2** — Affects tournament mode only. Real, but does not block the primary goal. Retained
  because you elected to keep `tournament` available.
- **S3** — Signal integrity, hygiene, and test infrastructure.

---

# S0 — Blocks the primary objective

### F-01 · `max_fpts` is unreachable from the application · VERIFIED
*Phase 1 F1 · Review #1*

`MIOS_FantasyScanner.tsx:48` hardcodes `lineupMode: 'tournament'`. `defaultLineupMode()`
(`generate-pios-lineups/index.ts:555`, mirrored at `MIOS_FantasyScanner.tsx:572`) returns only
`safe`, `balanced_ev`, or `tournament` — never `max_fpts`. `grep -rn "max_fpts" src/components/ src/pages/`
returns exactly one hit, a bypass check at `ScanPage.tsx:259`. There is no selector.

Every lineup was therefore ranked by
`expectedPayout × 10_000 + winRate × 100 + ceiling × 2 + leverage` (`:2100`).

**Fix:** add a visible mode selector; default `max_fpts`; retain `tournament`. Both copies of
`defaultLineupMode` must change.

---

### F-02 · Classic never enforces DraftKings' multi-team / multi-game rule · VERIFIED
*Phase 1 F2 · **missed by external review***

`validateLineup` (`:1314`) applies the ≥2-team check **only** to Showdown (`:1329`). Classic
has no equivalent — not in the solver, not in the validator. DK Classic requires players from
at least two teams; NBA and NFL require two distinct **games**.

**Repro output:**
```
projected_points: 480
salary_used: 40000
distinct teams in "optimal" lineup: AAA (count=1)
RESULT: solver returned a one-team lineup -> DraftKings would REJECT this entry.
```

`game_id` is fully plumbed — populated from `draftable.competition.competitionId`
(`draftkings-slates/index.ts:325`), stored and indexed on `draftkings_player_salaries`, with
`game_ids[]` on the slate. It is nullable.

**Fix:** enforce `minDistinctGames = 2` for NBA/NFL and `minDistinctTeams = 2` for MLB/WNBA
**inside the solver**, with a two-team fallback plus warning when `game_id` is null. A
post-filter is not sufficient — filtering after the fact silently returns the second-best
lineup while still calling it optimal.

---

### F-03 · Showdown deduplication collapses distinct captain configurations · VERIFIED
*Review #6*

`lineupSignature` is `players.map(p => p.player_id).sort().join('|')` — no `roster_slot`, no
captain identity. `generateExactShowdownLineups` builds a captain-aware signature internally,
then discards that protection by returning through the generic
`dedupeLineups(...)` at `index.ts:999`.

A at CPT + B at FLEX and B at CPT + A at FLEX contain the same six players but have different
salaries and different totals, because the captain receives 1.5×. The deduper keeps whichever
it encountered first — which, given F-04's leverage ordering, is the higher-leverage one, not
the higher-projection one.

**This is the single most damaging Showdown defect.** Fix: include `roster_slot`/captain ID in
the signature used for Showdown dedup.

---

### F-04 · Showdown candidates ordered by leverage, then truncated · VERIFIED
*Phase 1 F3 · Review #7*

`generateExactShowdownLineups` (`:919`) iterates captains sorted by `captainLeverageScore`
(`:1010`) = `projection ÷ ownership`, prunes with a per-captain `captainKeepCount` (`:952`),
concatenates in captain-map order, and applies `.slice(0, keepCount)` (`:999`) — truncating
**before** PIOS ranks anything.

A highly projected but highly owned captain scores poorly on leverage, enters the pool late,
and is cut before `max_fpts` can compare it.

**Fix:** in `max_fpts`, sort captains by `adjustedProjection` and disable leverage pruning.

---

### F-05 · `max_fpts` still enforces a $49,000 Showdown minimum · VERIFIED
*Review #8*

`:1835` sets `minSalaryUsed = clampNumber(payload.minSalaryUsed, 40_000, 50_000, 49_000)`.
The `max_fpts` early-return block at `:1841` correctly zeroes `ownershipWeight`,
`simulationIterations`, and exposure caps — but passes `minSalaryUsed` through untouched.
`validateLineup:1317` then rejects anything below it.

DraftKings imposes a cap, not a floor. A slate's highest-projection lineup may cost $48,800.
The system will knowingly discard it.

**Fix:** set `minSalaryUsed: 0` in the `max_fpts` block.

---

### F-06 · Showdown has no exact-optimal verification · VERIFIED
*Phase 1 F3 · Review #9*

`exactOptimalStatus` is computed only when `contestType === 'classic'` (`:711`).
`enforceExactOptimalTop` early-returns unchanged when it is undefined (`:874`). Showdown gets
no verification and no promotion — and Showdown is half your stated scope.

Compounding it, the pre-ranking sort (`preSimulationLineupScore`) mixes stack bonuses,
anti-correlation penalties, and late-swap penalties into a pool that is then capped. A lineup
can hold the highest projection and be cut because a rival earned a stack bonus.

**Fix:** implement an exact Showdown solver (captain × 5-of-N is small enough to enumerate
exactly under a cap) and wire it into `enforceExactOptimalTop`.

---

### F-07 · Every additional lineup is a one-player swap · VERIFIED — NEW
*Neither review*

`solveOptimalLineupsWithMeta` adds `noGoodCuts.push(lineup.players.map(p => p.player_id))`
after each solve, and `violatesNoGoodCut` rejects a candidate only if it contains **every**
player of a prior cut. That forbids the exact roster and nothing else.

**Repro output (10 lineups, realistic 40-player NBA pool):**
```
#1: pts=315.5  sharedWith#1=8/8
#2: pts=315.5  sharedWith#1=7/8
#3: pts=315.5  sharedWith#1=7/8
#5: pts=315.5  sharedWith#1=6/8
#9: pts=314    sharedWith#1=7/8
```

This is your "lineups don't alter much" symptom, exactly.

**Fix:** this is a product decision, not just a bug. For strict max-points, near-identical
lineups are *correct* — they genuinely are the top N by projection. If you want N *usable*
entries, add an explicit overlap constraint (max shared players between returned lineups) as a
user-facing control, distinct from `tournament` diversification.

---

### F-08 · No deterministic tie-breaking · VERIFIED — NEW
*Surfaced by the F-07 repro*

Eight of ten lineups tied at exactly 315.5. Ordering among ties depends on candidate iteration
order, which depends on input ordering and `Map` insertion order. The same slate can yield a
different "best" lineup between runs.

**Fix:** total ordering on `(projected_points, salary_used ASC, sorted player_id list)`.

---

# S1 — Corrupts the projection or the eligibility data

### F-09 · DraftKings FPPG treated as a forward projection · READ
*Review #2*

`draftkings-slates/index.ts:318`:
```ts
const projectedPoints = Number(draftable.draftStatAttributes?.find(
  (attr) => attr.id === 90 || attr.id === 408)?.value);
```
Attribute 90 is widely documented as FPPG — DraftKings' **average fantasy points per game to
date**, a backward-looking statistic. It is stored as `projected_points`.

**This may be the most consequential item in the report.** Every optimizer fix above is in
service of maximizing this number. If it is a season average, the system is selecting last
month's best players, not tonight's.

**Fix:** confirm attribute semantics against a live draftables payload, then rename the field
to `dk_fppg`, treat it as a *feature* rather than a projection, and require the projection to
come from the modeled path. Do not silently keep the mapping.

---

### F-10 · MIOS overwrites recent-form history with model output · INHERITED
*Review #4 — verify before acting*

`last_5_stats.avg_fantasy_pts` should hold observed performance. Per the review, it is
overwritten at each of: prop blending, confirmed-lineup adjustment, Vegas adjustment,
calibration, news processing, and the opportunity model. PIOS then consumes it as
`last_5_avg_pts`, treating it as independent historical evidence.

If accurate, model output is fed back in as observation. That makes calibration circular,
variance estimates meaningless, and any future backtest invalid — including the
capture-forward work in the fix plan.

**Verify by:** logging `last_5_stats.avg_fantasy_pts` before and after each MIOS stage on one
slate.

**Fix:** make the raw field immutable. Model adjustments write to separate named fields.

---

### F-11 · MIOS adjustments re-applied by PIOS · INHERITED
*Review #5 — verify before acting*

MIOS adjusts `projected_points` for starter status, injuries, props, Vegas, opportunity,
batting order, weather, and calibration. PIOS then runs `applyContextualProjectionEngine`
(`:709`) applying batting-order multipliers, park factors, `context_score`, `news_score`,
injury multipliers, and starter adjustments — to the already-adjusted number.

The review's example: MIOS raises a confirmed starter's projection *and* records the raise in
`context_score`; PIOS reads `context_score` and raises it again. Positive-context players are
systematically over-projected; flagged players multiply-penalized.

**Verify by:** instrumenting one player through both stages and diffing.

**Fix:** define the MIOS→PIOS contract explicitly — which fields are final, which are raw
inputs — and make PIOS adjust only from documented raw fields.

---

### F-12 · Confirmed-lineup parser returns zero rows · VERIFIED
*Phase 1 F4 · **missed by external review***

Test fails: `Expected 10 rows, got 0`.

**Root cause:** `scrape-confirmed-lineups/parser.ts:78` extracts team blocks with
`/<([a-z0-9]+)\b[^>]*\bdata-team=["'][^"']+["'][^>]*>[\s\S]*?<\/\1>/gi`. The lazy quantifier
stops at the **first** closing tag of that name, but the markup nests
`<div class="lineup__abbr">` inside `<div data-team>`. The block truncates to the
abbreviation; the `<li>` player entries fall outside it. Regex cannot parse nested HTML.

**Critical context the external review missed:** `collectConfirmedLineups` **is** wired and
called for all four sports (`mios-fantasy-scan/index.ts:3447`). The pipeline runs and receives
an empty array. Review items #4 and #5 both treat confirmed-lineup adjustment as functioning —
it is not. `isConfirmedNonStarter` (`:1350`) has no data, so the guard can never fire.

**This is the direct cause of your lineups containing players who weren't playing.**

**Fix:** replace with depth-aware extraction or `deno-dom`. Then make empty results a loud
manifest warning rather than a silent empty array.

---

### F-13 · Stored salary rows override fresher live slate data · INHERITED
*Review #3 — verify before acting*

Per the review, for NBA/WNBA/NFL, stored DB rows are preferred whenever any exist; live slate
rows are used only when storage is empty (MLB additionally prefers live when starter signals
are present). No comparison of `updated_at`, matched-player count, status freshness, coverage,
or draft-group version.

A slate selected in the UI can be optimized against stale salaries, statuses, and FPPG.

**Fix:** prefer the source with the newer `updated_at` and better coverage for the *selected
draft group*; surface which source won in diagnostics.

---

### F-14 · Statcast collector exists but is never called · VERIFIED
*Phase 1 F7 · Review #15*

`mios-fantasy-scan/index.ts:3446`:
```ts
Promise.resolve(new Map<string, StatcastQuality>()),
```
Hardcoded empty map in the `Promise.all`. `collectStatcastQuality` (`:2283`) is flagged unused
by oxlint. `applyStatcastQuality` (`:3579`) runs against an always-empty map, and
`sourceStatus.baseball_savant_statcast` resolves to `'unavailable'` permanently.

`collectMlbStatsApiLast5Stats` (`:2877`) is likewise dead.

**Fix:** wire or delete. Dead collectors make MIOS look richer than it operationally is.

---

### F-15 · MLB recent-form enrichment disabled · INHERITED
*Review #14 — verify before acting*

Enrichment cap reportedly set to zero for MLB, so no MLB player receives last-five game-log
enrichment during a live scan; MIOS emits its own warning to that effect. Combined with F-09
and F-14, MLB projections would rest almost entirely on FPPG, props, and multipliers — with no
live recent-performance foundation.

---

### F-16 · Ownership not scoped to slate or contest type · INHERITED
*Review #16 — verify before acting*

Retrieval keyed on sport + contest date only; no contest ID, game ID, draft group, or contest
type. Showdown CPT ownership, Showdown FLEX ownership, and Classic ownership are
slate-specific, so same-date data from another slate can bleed in.

Low priority under `max_fpts` (`ownershipWeight: 0`), material for `tournament`.

---

### F-17 · Ownership parser emits present-but-undefined keys · VERIFIED
*Phase 1 F6 — pairs with F-16*

Test fails; actual and expected print identically because `JSON.stringify` omits undefined:
```
{ player_name: "Jalen Brunson", ownership_pct: 28.5,
  cpt_ownership_pct: undefined, flex_ownership_pct: undefined }
```
The DailyFantasyFuel source never populates the Showdown CPT/FLEX split but emits the keys
anyway, so `expectedDuplicatesFromOwnership` silently falls back to flat ownership for the
captain slot. The field exists, so nothing reports it missing.

---

### F-18 · Calibration blends heterogeneous projection sources · INHERITED
*Review #17 — verify before acting*

Calibration segments by sport, position group, and salary tier, applying one multiplier across
projections that may originate from FPPG, last-five averages, props, opportunity models, prior
calibration, or DK import. A bias learned from one methodology is applied to another.

Interacts badly with F-10: if history is overwritten with model output, calibration is
learning from its own predictions.

---

# S2 — Tournament mode only

Retained because you elected to keep `tournament`. **None of these affect `max_fpts`**, which
sets `simulationIterations: 0` and bypasses Monte Carlo entirely. Deprioritized relative to the
external review's ordering for that reason.

### F-19 · Simulated field capped at 360 vs. real field size · VERIFIED
*Review #10* — `MAX_FIELD_LINEUP_CAP = 360` (`:274`). Finish rank is computed against the
simulated field but evaluated against the real one. In a 100k-entry contest the worst possible
simulated finish is ~361st while the top-1% cutoff is 1,000th — so nearly every candidate
reads as top-1%. `expected_payout` inherits the same scaling error.

### F-20 · `win_rate` is not win probability · READ
*Review #11* — a "win" is beating ~99% of a few-hundred-lineup simulated field, i.e. roughly a
top-3 finish, surfaced to the UI as `win_rate`.

### F-21 · Simulated Showdown field contains illegal lineups · INHERITED
*Review #12* — field generator selects six players by salary and weighted randomness without
the two-team requirement the real validator enforces. Candidates are scored against a field
containing entries DraftKings would reject.

### F-22 · Arbitrary $42,500 field salary floor · VERIFIED
*Review #13* — `simulation.ts:290` discards any simulated lineup under $42,500. Not derived
from contest, historical field construction, or duplication data; concentrates the opponent
model into high-salary builds and distorts percentile and leverage estimates.

### F-23 · Exposure guard double-counts within a lineup · VERIFIED
*Phase 1 F5* — test 9.4 fails (expects 4, gets 5). `maxPlayerExposureCount` counts appearances,
not lineups containing a player. The test fixture is also malformed: `showdownLineup('b1')`
places `b1` at both CPT and FLEX, which `isValidShowdownLineup` would reject. Fix both.

---

# S3 — Signal integrity and infrastructure

### F-24 · "Confidence" partly measures salary utilization · VERIFIED
*Review #18* — `calculateLineupConfidence` (`:1543`):
```ts
const efficiencyBoost = Math.min((lineup.salary_used / 50_000) * 0.1, 0.1);
return Math.min(Math.max(avgConfidence + efficiencyBoost - injuryPenalty, 0), 1);
```
Spending more salary does not make the underlying data more certain. Up to 10% of a number the
user reads as certainty is a spend metric.

### F-25 · Emergency scan cache has no freshness limit · INHERITED
*Review #19* — on live-scan failure, an in-memory manifest is returned with no maximum age
check. Near lock, this can serve outdated starters, injuries, and salaries as if current.
Given F-12, this compounds: stale *and* starter-blind.

### F-26 · Core logic is monolithic and untested · VERIFIED
*Phase 1 F8* — `mios-fantasy-scan/index.ts` is 3,762 lines; `generate-pios-lineups/index.ts` is
2,242. Neither has direct tests. Existing tests cover only extracted sibling helpers. `src/`
has no test runner at all. This is why F-01 through F-08 survived.

### F-27 · Test suite depends on network reachability · VERIFIED
Tests import `std@0.224.0/assert` from `deno.land`. I vendored a shim and used an import map to
run them. Pin via `deno.json` or vendor, so CI does not depend on deno.land being up.

---

# Fix plan

**Phase A — make the objective selectable and reachable (S0)**

| # | Action | Findings |
|---|---|---|
| A1 | Add mode selector; default `max_fpts`; keep `tournament`. Update both `defaultLineupMode` copies. | F-01 |
| A2 | Enforce distinct-games (NBA/NFL) / distinct-teams (MLB/WNBA) **inside** the solver; fallback + warning on null `game_id`. | F-02 |
| A3 | Include captain identity in the Showdown dedup signature. | F-03 |
| A4 | Projection-ordered captains in `max_fpts`; disable leverage pruning. | F-04 |
| A5 | Set `minSalaryUsed: 0` in the `max_fpts` block. | F-05 |
| A6 | Exact Showdown solver; wire into `enforceExactOptimalTop`. | F-06 |
| A7 | Deterministic total ordering on ties. | F-08 |
| A8 | Explicit max-overlap control for multi-lineup output. | F-07 |

*Exit criterion: on a fixture slate, the returned lineup is provably the highest-projected
legal combination for all four sports × both contest types.*

## Phase A implementation progress — 2026-07-29

Implemented in the working tree:

- [x] **A1** — Added a visible objective selector, defaulting to `max_fpts`; retained
  `tournament`, `balanced_ev`, and `safe`.
- [x] **A2** — Added solver-level Classic legality constraints: NBA/NFL use two distinct games
  when game IDs are complete, otherwise fall back to two distinct teams with a strategy note;
  MLB/WNBA require two distinct teams. The validator also rejects violations.
- [x] **A3** — Showdown signatures now include captain/FLEX roster-slot identity.
- [x] **A4** — The `max_fpts` Showdown path orders captains by adjusted projection and disables
  leverage-based pruning.
- [x] **A5** — `max_fpts` forces `minSalaryUsed` to zero in UI-derived and backend strategy
  rules; backend validation permits zero for this mode.
- [x] **A6** — The `max_fpts` Showdown path enumerates captain-plus-FLEX combinations, ranks
  candidates by projected points, and wires the top candidate into exact-optimal promotion.
- [x] **A7** — Solver and final ranking tie-break by projected points, lower salary, and lineup
  signature.
- [x] **A8** — Added a separate optional user-facing `Max Shared Players` control. Blank means
  no overlap constraint; a supplied value is carried through the request and enforced between
  returned lineups. It is separate from `maxDuplication`.

Validation status:

- [x] `npm run build` passes. Vite reports the existing Node-version and chunk-size warnings.
- [x] `npm run lint` passes with the two pre-existing unused MIOS collector warnings (F-14).
- [x] `git diff --check` passes.
- [ ] Solver fixtures were added at
  `supabase/functions/_shared/__tests__/lineupSolver.test.ts`, but could not be executed because
  `deno` is not installed in the current environment.
- [ ] The Phase A exit criterion remains pending runtime proof on fixture slates across all four
  sports and both contest types.

## Phase B implementation progress — 2026-07-29

Implemented in the working tree:

- [x] **B1 / F-12** — Replaced the confirmed-lineup team-block regex with balanced-tag
  extraction that handles nested markup, and added a loud warning when the collector returns
  zero rows.
- [x] **B2 / F-09** — DraftKings attribute 90 is now retained as explicitly labeled `dk_fppg`
  and is no longer written to `projected_points`; the modeled projection remains the source
  used by MIOS/PIOS. Live DraftKings payload confirmation could not be executed because the
  endpoint was unreachable from this environment, so that specific evidence item remains open.
- [x] **B3 / F-10, F-11** — MIOS keeps `last_5_stats.avg_fantasy_pts` as observed history and
  writes model output to `projected_points`/`model_adjusted_fantasy_pts`. PIOS now consumes the
  MIOS modeled projection without reapplying park, role, news, or injury multipliers.
- [x] **B4 / F-13** — Salary-source selection now compares live-slate and stored-row coverage
  and freshness, and emits the winning source/reason in diagnostics. Stored salary RPC output
  now includes provenance timestamps.
- [x] **B5 / F-14, F-15** — Statcast collection is wired for MLB scans; MLB last-five enrichment
  now calls the Stats API with a bounded live roster cap instead of being hard-disabled.
- [x] **B6 / F-16, F-17** — Added scoped ownership retrieval/upsert fields for contest type,
  contest ID, draft group, and game; the scraper carries those fields. Ownership parser output
  no longer emits present-but-undefined captain/FLEX keys.
- [x] **B7 / F-18** — Added projection-source persistence and source-specific calibration cells;
  calibration no longer applies a heterogeneous cell multiplier across projection methods.

Validation status:

- [x] `npm run build` passes. Vite reports the existing Node-version and chunk-size warnings.
- [x] `npm run lint` passes.
- [x] `git diff --check` passes.
- [ ] Deno parser/MIOS fixtures were not executable because `deno` is not installed.
- [ ] Supabase migrations/RPCs were not executed because no database connection is configured in
  this environment.
- [ ] Live DraftKings payload semantics remain unverified due endpoint DNS/network failure.

## Phase C implementation progress — 2026-07-29

Implemented in the working tree:

- [x] **C1 / F-19** — Tournament Monte Carlo ranks are now mapped from the bounded simulated
  field onto the requested real contest field before top-N rates and payout units are calculated.
  First and last simulated ranks remain first and last in the mapped field.
- [x] **C2 / F-20** — `win_rate` now counts first-place simulation finishes only. The prior
  top-percentile signal remains available as `top_decile_rate`/`top_10_rate`.
- [x] **C3 / F-21** — Simulated Showdown field lineups now require six unique players and at
  least two teams, matching the existing Showdown legality guard.
- [x] **C4 / F-22** — Removed the arbitrary `$42,500` simulated-field salary floor and the
  associated salary-target weighting. The simulated field retains only the verified DraftKings
  `$50,000` salary ceiling.
- [x] **C5 / F-23** — Exposure counting now counts each player at most once per lineup, even if
  a malformed fixture repeats that player in multiple slots. Corrected the malformed exposure
  fixture and added regression coverage.
- [x] Added focused regression coverage for rank scaling, low-salary Showdown field generation,
  two-team Showdown legality, and per-lineup exposure counting.

Validation status:

- [ ] Deno simulation/guard tests were not executable because `deno` is not installed in the
  current environment.
- [x] `npm run build` passes after the Phase C edits. Vite reports the existing Node-version and
  chunk-size warnings.
- [x] `npm run lint` passes after the Phase C edits.
- [x] `git diff --check` passes.
- [ ] Live tournament runtime proof remains pending; no Supabase database/runtime connection is
  configured in this environment.

## Phase D implementation progress — 2026-07-29

Implemented in the working tree:

- [x] **D1 / F-24** — Removed salary utilization from both PIOS confidence calculations.
  Confidence now reflects player confidence scores and injury penalties only; the shared policy
  is covered by direct tests.
- [x] **D2 / F-25** — Added a two-hour maximum age for emergency manifest-cache fallback in both
  the Supabase Edge scan and the legacy Vercel scan. Expired entries are deleted and no longer
  returned as current data. The two-hour boundary matches the existing confirmed-lineup stale
  warning already used by MIOS.
- [x] **D3 / F-26** — Extracted the confidence and emergency-cache policies from the monolithic
  handlers into independently testable shared modules, with direct regression tests. Existing
  solver, scoring, validation, parser, enrichment, and signal tests remain in place for the
  previously identified high-risk logic.
- [x] **D4 / F-27** — Replaced the remaining `deno.land` assertion import with a local test shim
  and added `deno.json` test/lint scope. The test suite no longer requires network access for
  its assertion dependency.
- [x] Durability coverage includes DraftKings scoring, solver salary/eligibility and game/team
  constraints, captain signatures/multipliers, Showdown roster validation, rank scaling, cache
  freshness, confidence, parser behavior, injury/news guards, and S0 regression fixtures.

Validation status:

- [x] `npm run build` passes after the Phase D edits. Vite reports the existing Node-version and
  chunk-size warnings.
- [x] `npm run lint` passes after the Phase D edits.
- [x] `git diff --check` passes.
- [x] No `https://deno.land` imports remain in the repository test suite.
- [ ] Deno tests were not executable because `deno` is not installed in the current environment.
- [ ] Supabase Edge/Vercel fallback behavior was not executed against a live runtime; runtime and
  database connectivity remain unavailable in this environment.

**Phase B — repair the inputs (S1)**

| # | Action | Findings |
|---|---|---|
| B1 | Rewrite confirmed-lineup extraction without regex; loud warning on empty. | F-12 |
| B2 | Confirm DK attribute semantics; rename to `dk_fppg`; demote to feature. | F-09 |
| B3 | Instrument and verify F-10/F-11; make raw history immutable; define the MIOS→PIOS contract. | F-10, F-11 |
| B4 | Freshness-based salary source selection with surfaced provenance. | F-13 |
| B5 | Wire or delete Statcast and MLB last-5 collectors. | F-14, F-15 |
| B6 | Scope ownership to draft group + contest type; drop undefined keys. | F-16, F-17 |
| B7 | Segment calibration by projection source. | F-18 |

**Phase C — tournament mode (S2)** — F-19 through F-23. Only if `tournament` stays.

**Phase D — durability (S3)** — F-24 through F-27, plus:
- Unit tests: DK scoring, salary, eligibility, captain multipliers, roster validation, the
  multi-game rule, and every S0 fix.
- **Capture-forward instrumentation.** You have no historical data, so backtesting cannot run
  today. Verify `ingest-actual-results` and the calibration tables are recording now, so
  MAE/RMSE/optimal-lineup-capture becomes possible in ~30 days. This is blocked by F-10: if
  history is overwritten with model output, the captured data will be worthless.

---

# Open decisions

1. **F-07 is a product question, not a bug.** Under strict max-points, near-identical lineups
   are the correct answer. How many lineups do you want, and what maximum overlap between
   them? This determines whether A8 is a constraint or a no-op.
2. **F-09 disposition.** If FPPG is confirmed as a season average, do we demote it to a feature
   and require a modeled projection — or keep it as the projection with clear labeling? The
   first is correct; the second is faster.
3. **Showdown roster sizes.** `showdownRosterSize` defaults to 6 for every sport unless the
   slate overrides. Verify MLB and WNBA Showdown against live DK rosters before A6.
4. **Late swap.** `lateSwapMode` defaults true in `max_fpts`. Confirm intended, since it
   interacts with F-12 once confirmed lineups actually return data.

---

# Appendix — reproductions

```bash
git clone https://github.com/jasminefloyd/floyd-dfs.git && cd floyd-dfs
npm install
npm run build          # passes
npm run lint           # 2 dead-collector warnings  (F-14)
deno test --allow-all supabase/functions   # 27 pass / 3 fail  (F-12, F-17, F-23)
```

**F-02 — illegal single-team Classic lineup:**
```ts
import { solveOptimalLineups, type SolverPlayer } from './supabase/functions/_shared/lineupSolver.ts';
const positions = ['PG','SG','SF','PF','C','PG','SF','C'];
const pool: SolverPlayer[] = [];
positions.forEach((pos, i) => {
  pool.push({ player_id:`aaa${i}`, name:`AAA ${i}`, team:'AAA', position:pos, salary:5000, projected_points:60 });
  pool.push({ player_id:`bbb${i}`, name:`BBB ${i}`, team:'BBB', position:pos, salary:5000, projected_points:10 });
});
console.log([...new Set(solveOptimalLineups(pool,'nba',1)[0].players.map(p => p.team))]); // ['AAA']
```

**F-07 / F-08 — one-player-swap lineups and ties:**
```ts
import { solveOptimalLineups, type SolverPlayer } from './supabase/functions/_shared/lineupSolver.ts';
const pool: SolverPlayer[] = [];
let n = 0;
for (const pos of ['PG','SG','SF','PF','C']) for (let i = 0; i < 8; i++) {
  n++;
  pool.push({ player_id:`p${n}`, name:`${pos}${i}`, team: i % 2 ? 'AAA':'BBB', position:pos,
    salary: 4000 + i*900, projected_points: 40 - i*2.5 + (i%3) });
}
const ls = solveOptimalLineups(pool, 'nba', 10);
const first = new Set(ls[0].players.map(p => p.player_id));
ls.forEach((l,i) => console.log(`#${i+1}: pts=${l.projected_points} shared=${
  l.players.filter(p => first.has(p.player_id)).length}/8`));
```

Note on running the suite: `deno.land` may be unreachable in restricted environments. Vendor a
local `std/assert` shim and redirect via `--import-map` rather than skipping tests (F-27).
