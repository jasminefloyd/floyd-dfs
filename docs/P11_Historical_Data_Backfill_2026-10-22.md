# P11 official actual backfill report — October 22, 2026

**Tenant:** `floyd-dfs` only. **Execution:** `npm run backfill:player-actuals`, existing official-source backfill. **Result:** completed successfully against the linked Floyd DFS production database. The tool was permitted network access after the sandbox could not resolve the configured Supabase hostname. This was a requested historical-data import, not a manual UI/contest test.

The importer read saved Floyd DFS projection runs and pulled final official MLB, NBA, and WNBA player statistics only for eligible pre-lock snapshots. It persisted source/hash/scoring provenance and immutable revision records using tenant-scoped idempotent upserts. It then reconciled already saved DraftKings result rows. It did not fetch DraftKings account history, submit entries, or reconstruct projections that were never saved.

## Results

| Measure | Count |
|---|---:|
| Eligible historical projection runs | 179 |
| Actual rows written/upserted | 4,535 |
| Source-verified rows | 4,535 |
| Quarantined rows | 0 |
| Unmatched player observations | 3,160 |
| Official feed failures for eligible supported runs | 0 |
| Runs blocked because SportsDataIO production entitlement was not verified | 34 |
| Unsupported format runs | 6 |
| Unsupported CFB scoring runs | 11 |
| Existing contest result rows reconciled | 5 |
| Reconciled as MATCHED | 0 |
| Score mismatches retained as excluded | 3 |
| Unavailable due to incomplete actual coverage | 2 |

Imported rows by sport:

| Sport | Rows | Notes |
|---|---:|---|
| MLB | 4,440 | Official final MLB Stats API box scores |
| WNBA | 95 | Official final WNBA stats |
| NBA | 0 | No eligible pre-lock NBA projection run was included in this backfill |

The backfill also found 46 MLB and 54 WNBA provider matches without scorable stat values, and 3,941 MLB plus 306 WNBA projection players without a matching saved projection row. These are not counted as actuals. The 3,160 unmatched player observations are not used in model evaluation.

## Interpretation and follow-up

- Successful official player actual ingestion does not establish historical projection quality or financial performance.
- Three saved result rows have score disagreements and remain excluded from evaluation; two lack sufficient actual coverage. Review their source entries before any future gate change.
- The local SportsDataIO tier is `UNKNOWN`, so NFL/Golf/other SportsDataIO data were not imported. Do not change the tier based only on successful HTTP responses; the provider's data integrity/entitlement must be independently verified.
- DraftKings account Entry History and full contest standings are separate official sources. The owner must download/import those files from the authenticated DraftKings account; they were not available in the repository or imported in this operation.
- The calibration, probability, and ROI release gates remain HOLD. The backfill does not resolve missing entry fees, payouts, complete standings, or chronological holdout sufficiency.
