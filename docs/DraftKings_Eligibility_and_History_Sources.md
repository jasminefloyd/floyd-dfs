# DraftKings eligibility, upload, and history sources

**Scope:** Floyd DFS only. This document records the verified source-of-truth decisions for P09, P10, and P11. It does not authorize account automation or DraftKings entry submission.

## Contest and player eligibility

DraftKings' official late-swap help states that late swap is unavailable in some contests, eligible players have an unlocked padlock, and a replacement lineup still must satisfy the contest's overall requirements. The endpoint-level implementation therefore treats late swap as enabled only when the exact DraftKings contest response contains a consistent explicit boolean. Missing or conflicting values mean unknown and block actionable swap plans; a general help page or sport/format guess cannot enable a specific contest.

For a lineup, use the exact contest/draft-group player pool and roster rules returned by the DraftKings adapter. Player IDs, eligibility, salary, and slot-specific identifiers must stay bound to that draft group. Eligibility may not be synthesized from a broad position label when the provider omitted its eligible-slot data. The documented universal golf roster slot is the only special case supported by the existing verified provider fixture/evidence. A public lobby or salary-CSV fallback that lacks verified rules is discovery-only and cannot produce an entry-ready lineup.

Official references:

- [DraftKings: How do I late swap a player?](https://support.draftkings.com/dk/en-us/how-do-i-late-swap-a-player?id=kb_article_view&sysparm_article=KB0010830) — late swap is contest-dependent; player locks are game-specific; replacement lineups must meet overall requirements.
- [DraftKings: How to play Daily Fantasy Sports](https://www.draftkings.com/how-to-play) — salary-cap lineups use eligible players from the Player Pool and sport-specific roster positions.

## Upload template contract

DraftKings' official CSV guide requires choosing the exact sport, contest format, and start time before downloading a template. Each file is limited to 500 lineups and one template; player IDs are slate-specific. For edits, DraftKings instructs users to download the existing entries file from Edit Entries and upload changes there.

That is a dynamic, authenticated, slate-specific template, not a universal public CSV schema. The actual template file and its slot headers/IDs cannot be retrieved from public documentation or safely fabricated from a salary CSV. Accordingly:

- Do not export a purported DraftKings upload file from Floyd DFS until a real downloaded DraftKings template/entries file is available for the exact target slate.
- When that template is supplied, preserve its original columns, row IDs, entry identifiers, and slate-specific slot IDs; validate the complete lineup against the corresponding current DraftKings slate before filling rows.
- Keep current Floyd DFS CSV/copy output explicitly labeled as local lineup details, not an upload file.
- Do not submit an entry. The user confirms any eventual upload in DraftKings.

Official reference: [DraftKings: How do I upload or edit multiple lineups at once?](https://support.draftkings.com/dk/en-us/how-do-i-upload-or-edit-multiple-lineups-at-once?id=kb_article_view&sysparm_article=KB0010800). The help page also states that the CSV upload is desktop-only and uploaded lineups must be assigned to entries separately.

## Historical data sources

There are three different history sets; they must not be conflated:

1. **Floyd DFS forecast history:** persisted `floyd_dfs_projection_runs`, stage/run snapshots, and saved lineups. This is the only legitimate source for reconstructing what Floyd DFS knew before a past lock. It is not a complete DraftKings account history.
2. **Official player actuals:** the project backfill uses official MLB, NBA, and WNBA final box-score sources for matching stored pre-lock projections. Other SportsDataIO-backed sports are skipped unless `SPORTS_DATA_IO_DATA_TIER=PRODUCTION_VERIFIED`; CFB scoring is unsupported. Imports are tenant-scoped, idempotent, provenance/hash/revision-bearing, and do not imply historical forecast quality.
3. **DraftKings realized contest outcomes:** the account owner can download their own past entry history from DraftKings History; DraftKings documents that records older than 30 days are available via “Download Entry History.” For contest standings, DraftKings provides “Export Lineups to CSV” for started/locked contests; its help page documents a 10-day post-contest download window. These account/contest files are not in the project unless the owner imports them. Final ROI requires linked entry IDs, final standings, entry fees, payouts, complete field data, and compatible scoring.

Official references:

- [DraftKings: How do I see the contests I’ve entered?](https://support.draftkings.com/dk/en-us/how-do-i-see-the-contests-ive-entered?id=kb_article_view&sysparm_article=KB0010685)
- [DraftKings: Download GameCenter standings CSV](https://support.draftkings.com/dk/en-us/how-do-i-download-a-csv-to-see-gamecenter-standings-for-a-contest?id=kb_article_view&sysparm_article=KB0010448)

Historical source limits: the GameCenter CSV can contain current live standings and is explicitly not final until the contest is completed and statistics are confirmed. Only completed contest results qualify as official outcomes. Public documentation does not provide a general bulk archive of all historical account entries/contest fields. Third-party scrapers and datasets are not treated as authoritative actuals or payout truth.

## Current Floyd DFS behavior

- `src/lib/engine/draftKings.ts` binds contest, draft group, game rules, draftables, and salary CSV fallback to typed route definitions and rejects malformed/inconsistent identity data.
- `src/lib/engine/draftKingsSlate.ts` maps the bound provider payload into the validated slate and blocks missing contest identity, unverified fallback rules, and incomplete/conflicting scoring.
- `api/lineups/[lineupId]/swap-plans.ts` fails closed if the linked DraftKings contest has no explicit late-swap boolean.
- `scripts/backfill-player-actuals.mjs` fetches official player actuals only for saved FDS projections; it does not fetch arbitrary full-season player histories or reconstruct forecasts.
- `src/pages/HistoryPage.tsx` accepts user-provided DraftKings result/standings CSVs; imports stay in the single Floyd DFS tenant.

No DraftKings login credentials, cookies, or submission tokens are stored or used by this project.
