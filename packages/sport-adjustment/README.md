# Sport Adjustment

Evidence-only sport adjustment for NBA, WNBA, NFL, MLB, and GOLF. The router consumes `ValidatedSlate` plus `ResearchPackage`, applies explicit current-role/availability evidence, and never calculates fantasy points.

Missing or unresolved evidence becomes a bounded-orchestrator-compatible `ResearchGap`. The Supabase migration stores adjustment packages and normalized player-level adjustments in uniquely prefixed, tenant-scoped tables.
