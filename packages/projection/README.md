# Projection Service

Deterministic sport models for NBA, WNBA, NFL, MLB, and GOLF. Every projected player must provide explicit `projectionInputs`; missing opportunity inputs create a `CRITICAL` projection gap and no player projection is emitted.

The service applies the `AdjustmentPackage`, maps components through the slate’s DraftKings scoring rules, produces deterministic seeded P20/P50/P90 simulation outcomes, and persists tenant-scoped projection artifacts.

Model outputs are not production-calibrated until sport-specific opportunity inputs and historical validation data are supplied.
