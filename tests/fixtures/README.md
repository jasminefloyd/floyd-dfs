# Replay fixtures

`replay-cases.mjs` contains deterministic, synthetic fixtures for baseline and regression tests. The player IDs, provider IDs, teams, schedules, projections, availability observations, and salaries are fabricated; no user contest data or paid-provider response is included.

Coverage includes NBA Classic across multiple games, NBA Showdown, WNBA, MLB, NFL, CFB, Golf Classic, and Golf Showdown. Each fixture has a small roster template, salary cap, scoring placeholder, player/game identity, projection timestamp, availability, news timestamps, and an expected legal lineup.

The roster and scoring profiles are deliberately reduced test profiles, not verified DraftKings rules. P03 must replace or supplement them with approved, versioned contest profiles before they can support release claims. P02 should add adapters from this fixture shape to the versioned shared replay contracts.

Run `npm run test:fixtures` to validate fixture completeness, identity links, timestamps, slot eligibility, salary arithmetic, uniqueness, and expected legality. Tests are offline and require no credentials.
