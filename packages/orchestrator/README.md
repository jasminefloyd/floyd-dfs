# Orchestrator

The Orchestrator owns workflow state and stage boundaries. It does not perform sports analysis, create projections, construct lineups, or override deterministic services.

Implemented responsibilities:

- ordered Slate → Research → Sport Adjustment → Projection → Optimize → Selection execution;
- required handler and output-contract checks;
- durable run/stage artifact boundary through `OrchestratorRepository`;
- stage version lineage;
- `BLOCKED` stop behavior;
- ResearchGap rerouting with a bounded retry count;
- targeted-rerun entry point reserved for persisted package inputs;
- entered-lineup guard before Selection is published.

The current repository is in-memory for tests. Supabase persistence is intentionally a later adapter.
