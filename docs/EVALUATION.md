# Fantasy AI Evaluation

This scorecard is the control plane for optimizer changes. Do not judge new construction
logic by one winning or losing lineup; judge it by these metrics over completed contests.

## Contest Results

- ROI per contest: `(payout - entry_fee) / entry_fee`
- Cumulative ROI: `(sum(payout) - sum(entry_fee)) / sum(entry_fee)`
- Median finish percentile: `(finish_rank - 1) / (field_size - 1)`
- Best finish percentile across entries in the same contest

## Construction Quality

- Duplication rate: actual duplicate count from DraftKings contest history when available
- Expected duplicates: model estimate, once duplication modeling is implemented
- Captain distribution across entries
- Pairwise lineup overlap for multi-entry Showdown sets

## Projection Signal

- Spearman rank correlation between projected and actual player fantasy points
- Projection error and absolute error remain diagnostic only
- Mean projection bias is not a lineup-construction success metric

## Reporting Cadence

Run this scorecard after the remediation waves called out in
`docs/DFS_REMEDIATION_CHECKLIST.md`: after waves 1, 3, and 4.
