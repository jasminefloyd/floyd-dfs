# P02 production-only migration runbook

**Status: approved and applied October 22, 2026.** This runbook records the production-only migration for the linked `floyd-dfs` tenant. The owner approved `P02_Schema_and_Contracts.md` before execution. Never use `supabase db push` for this project: its remote/local migration histories diverge.

## Before execution

1. The owner approved the P02 schema/API draft and migration `20261021040000_fds_p02_contract_schema.sql`.
2. `.env.local` was configured with `FDS_TENANT_SLUG=floyd-dfs`, the linked project ref, and the project URL. No secrets were printed.
3. Verified the CLI project reference and configured URL matched. The backup script refuses a mismatch.
4. Verified there were no current FDS processing jobs; old `running` and `queued` records had last activity October 1 and August 27 respectively. The weekly Vercel cron was not scheduled during this operation.
5. `npm run backup:p02:production` exported only the eight affected tables for `floyd-dfs`: 34,706 rows total. Directory mode is `0700`; files are `0600`; each table has a SHA-256 hash. The command printed counts only, not row contents. The backup remains in the protected temp directory created by the script; never commit it.
6. The read-only preflight passed, confirming one target tenant and the expected prior definitions for all seven sport checks.

The exact preflight command was:

   ```sh
   SUPABASE_TELEMETRY_DISABLED=1 supabase db query --linked --file supabase/operations/p02-production-preflight.sql --output-format json
   ```

   The output confirmed the target and prior constraint definitions matched the reviewed project.

## Apply and verify

1. Applied only the reviewed migration file:

   ```sh
   SUPABASE_TELEMETRY_DISABLED=1 supabase db query --linked --file supabase/migrations/20261021040000_fds_p02_contract_schema.sql
   ```

   This uses the Management API query path and does not require Docker. Do not execute other pending migrations in the same operation.
2. The read-only postflight passed. It verified all seven six-sport constraints, the new columns/tables, restrictive fixed-tenant RLS policies, and absence of browser SELECT grants.

   ```sh
   SUPABASE_TELEMETRY_DISABLED=1 supabase db query --linked --file supabase/operations/p02-production-postflight.sql --output-format json
   ```

3. Recorded only this migration in remote history after postflight passed:

   ```sh
   SUPABASE_TELEMETRY_DISABLED=1 supabase migration repair --status applied --linked --yes 20261021040000
   ```

   The targeted repair succeeded and final migration listing shows `20261021040000` applied. Unrelated remote history was not changed. No new-schema application deployment or live data-path test was performed.

## Rollback

Rollback is for a failed migration before downstream code writes P02 data. Keep writers paused. If migration history was recorded, mark only `20261021040000` reverted after the schema rollback succeeds. First retain any new P02 rows in the same FDS-only manner if any writer has run. Then execute `supabase/operations/p02-production-rollback.sql` against the same verified linked project. It drops only P02-created tables/columns/index and restores the exact prior seven sport checks. Run preflight again and verify the old constraint names/definitions. If any P02 data exists, do not drop tables/columns until that tenant-only data has been retained and the owner approves the loss of the live copies.

The normal Supabase CLI dump requires Docker Desktop, which is unavailable in this environment. The tenant-filtered row backup avoided exporting other tenants from the shared Supabase project. Production schema migration is complete; application-level NBA insertion, tenant-isolation, and stale-revision tests remain for a later live-testing pass.
