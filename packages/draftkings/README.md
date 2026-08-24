# DraftKings boundary

DraftKings API/RSS provider interfaces belong here. Screenshot ingestion is intentionally deferred.

The Slate service in `src/slate.ts` is deterministic: it normalizes provider records, validates contest integrity, and returns `VALID`, `WARNING`, or `BLOCKED` without making player judgments.

`DraftKingsApiClient` exposes the verified endpoint boundary:

- `listSports()`
- `listContests(sport)`
- `getContest(contestId)`
- `getDraftGroup(draftGroupId)`
- `getGameTypeRules(gameTypeId)`
- `getDraftables(draftGroupId)`
- `getSlateBundleForContest(...)`

Sport codes are supplied by the DraftKings sports-directory response rather than hard-coded. This matters because the live directory did not expose every product sport during validation.
