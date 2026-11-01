# Fantasy AI Operations Runbook (G8)

**Status:** Operational code and local deterministic checks are present. This is not a staging acceptance or production rollout record.

## Operator dashboard

1. Sign in with an account assigned the application `operator` role.
2. Open `/operations` or use **Operations** in the application navigation.
3. Refresh the page to load a new tenant-scoped snapshot from `GET /api/operations/health`.
4. Treat `Unavailable`, `Not instrumented`, and an empty data window as unknown. Do not interpret them as zero failures or healthy status.
5. Inspect the Schedule and Street Team pages for source details, next schedule sync, upcoming games, and near-lock alerts. The dashboard API limits each window; its response includes sample limits.

## Alert response

| Alert | Operator action |
|---|---|
| `PROVIDER_BUDGET_UNKNOWN` | Keep automatic NBA collection paused. Confirm the SportsDataIO account's verified daily allowance and configure `SPORTS_DATA_IO_NBA_DAILY_CALL_BUDGET`. A verified account can use `UNLIMITED` only where the scheduler accepts the verified production tier. |
| `PROVIDER_BUDGET_NEAR_LIMIT` / `PROVIDER_BUDGET_EXHAUSTED` | Stop manual refreshes; inspect provider calls and reset time. Do not raise the limit based on absent quota headers. |
| `COLLECTION_FAILURES` | Inspect the latest collection status, error code, provider diagnostics, and Street Team snapshot. Retry only after resolving the stated provider or environment fault. |
| `NBA_SCHEDULE_STALE` / `STALE_SCHEDULE_ROWS` | Inspect schedule sync status and error. The schedule cache is sourced from ESPN; compare its upcoming game list and last observation time before relying on it. |
| `OPEN_RUNTIME_INCIDENTS` | Review the redacted incident summary and owning component. Close an incident only after the fault is resolved and a subsequent check succeeds. |
| `SETTLEMENT_RECONCILIATION` | Reconcile exact contest and external-entry identities against official results. Do not enter or adjust ROI while the result remains unresolved. |

Near-lock provider alerts currently appear in the Street Team UI while the page is open. Independent push/email/pager delivery is **not configured or verified**; the operations dashboard is an authenticated polling surface, not a guaranteed alert channel.

No named on-call owner or escalation contact was found in the checked-in configuration. Assign one in the deployment's incident process before treating the alert table as an owned escalation policy.

## Rollout and rollback controls

- Server feature flags are case-insensitive booleans and default to `false` when unset.
- `STREET_TEAM_V2` gates the NBA collection/scheduler endpoints. Keep scheduling disabled until the provider call ceiling and required secrets are configured and verified.
- `NBA_HOUSE_V1` is retained as a shadow-mode alias; `NBA_HOUSE_SHADOW_V1` enables shadow reporting. `NBA_HOUSE_CANARY_V1` and `NBA_HOUSE_ACTIVE_V1` are separate runtime selections and must not both be enabled. A selected candidate still requires matching reviewed registry/evaluation evidence.
- `NBA_HOUSE_KILL_SWITCH_V1=true` forces pinned NBA House runs back to legacy. After setting it in the deployment environment, verify the next run reports legacy selection before considering rollback complete.
- `LEARNING_V2` gates evaluation/proposal/registry writes; disabling it stops those writes without changing the legacy generation route.
- `PORTFOLIO_EV_V1` is declared but is not currently a switch that can authorize EV: calibrated field scenarios and complete contest terms are still required by the optimizer.
- Do not promote candidates from this dashboard. Review and runtime rollout are separate actions. The agreed rollout remains shadow-only until NBA holdout validation passes.

## Scheduler and provider recovery

1. Check Vercel's daily `/api/street-team/scheduler` cron and Supabase's 10-minute dispatcher job. Code/configuration is not proof that either job ran.
2. Check `floyd_dfs_intel_collection_runs` and schedule sync state for the latest attempts, status, call counts, provider quota state, and next due time.
3. Confirm `CRON_SECRET`, `FDS_SCHEDULER_BEARER_SECRET`, `FDS_WORKER_BEARER_SECRET`, Supabase service credentials, and provider credentials in the deployment environment without copying secret values into logs.
4. After restoring a provider or cron fault, verify a successful collection and current canonical snapshot. Confirm the next scheduler decision is recorded before treating recovery as complete.

For a manual operator refresh, use the authenticated **Retry source refresh** action on `/street-team`. For a scheduler diagnostic, invoke the configured cron endpoint through the deployment's authorized scheduler mechanism; do not put bearer values into shell history, tickets, or CI logs.

## Migration recovery

From a reviewed project checkout:

```bash
supabase migration list --linked
supabase db push --linked --dry-run
supabase db push --linked
supabase migration list --linked
```

Stop if local/remote histories diverge or the dry run contains an unexpected migration. Preserve the database backup and migration output with the release record. Never repair history with `migration repair` without a reviewed recovery plan.

## Result correction and historical replay

- Use the contest results import path for official, versioned result revisions; link each result to its exact generated lineup, contest, and external entry ID.
- Re-imports are revisioned/idempotent by source identity. A corrected result should be imported as a correction, not by mutating an old audit record directly.
- Confirm actual score reconciliation and required payout, refund, and fee values before reviewing realized net return or ROI. An unentered lineup is never a financial result.
- Use the saved run ID and pinned lineage/snapshot to replay. Do not substitute current roster, contest, or model inputs into an older run.

## Current instrumentation limits and release gate

The dashboard reports observed collection, schedule, House report/evaluation, lineup, settlement, and incident data. Current storage does not establish simulation runtime error rate, candidate fallback rate, lineup legality failure rate, per-generation provider cost, or independent external alert delivery; these are explicitly shown as unavailable. Some dashboard queries are capped, and returned sample limits identify those caps.

G8 acceptance still requires a fixture-backed or staging end-to-end trace, two successive scheduled dispatches, alert delivery evidence, a provider-failure recovery, an operator rollback drill, and reviewer sign-off. Staging was previously declined, so none of those execution records are claimed by this runbook.
