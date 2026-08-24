# Research Agent

This package implements the architecture’s seven-bucket Research Agent boundary.

- `createResearchPlan` creates a slate- and sport-aware plan.
- `RssResearchProvider` retrieves and parses RSS without making projection or lineup decisions.
- `ResearchAgent` normalizes evidence, records source tiers and freshness, preserves conflicts, and emits unknowns/watch items.
- `createResearchStageHandler` adapts the agent to the Orchestrator’s `RESEARCH` stage.
- `createDefaultRssProviders` configures the DraftKings Network, DK Daily Bets, ESPN, and RotoWire feeds supplied for this build.

The package does not claim a source is authoritative merely because it is configured. Live feed availability, response shape, and article contents must be validated at runtime.
