# P13 Acceptance, release, and handoff

**Release decision (October 22, 2026):** software deployment is approved for the Floyd DFS tenant with conservative model gates. Numerical experimental effects, calibrated win/cash probabilities, realized ROI claims, and DraftKings submission remain disabled. P10/P11 data and manual acceptance gates are not waived by a successful build or deployment. No other tenant is in scope.

## Technical decisions

- Keep one Floyd DFS tenant boundary on every API, database write, migration, cron job, actual import, evaluation, and operator grant.
- Use official, final league actuals only when they can be joined to an existing pre-lock Floyd DFS projection snapshot. Do not manufacture historical forecasts from later data.
- Treat the DraftKings contest response's explicit late-swap boolean as the only machine-readable permission for that contest. Missing or contradictory data blocks swap plans. DraftKings documents that late swap is not available in every contest and that each replacement lineup must satisfy the contest requirements.
- Treat DraftKings upload templates as slate-specific, dynamic inputs. Do not generate an upload-format file until an authentic template/entries CSV for that exact slate can be used to preserve its columns and IDs.
- Keep calibration/evaluation results on HOLD until a chronological, independently reviewed, sufficiently powered holdout exists. Report unmatched actuals and score disagreements; do not convert them to zero or include them in ROI.
- Use manual, user-confirmed DraftKings upload only. No credentials, cookies, automated submissions, or contest-entry mutations are enabled.
- A production cron declaration is not proof of a registered/running cron. Require a visible deployed cron record and an independent missed-run alert before calling P12 operationally accepted.

## Verification commands

Offline/repeatable checks (Node 22.12+):

```sh
npm ci
npm run build
npm run check:server
npm run lint
npm run test:actual-sources
npm run test:engine
npm run test:fixtures
npm run test:contracts
npm run test:auth
git diff --check
```

`.github/workflows/ci.yml` runs this deterministic suite on pull requests and pushes to `main`. Provider requests, Supabase production writes, browser accessibility/device flows, and a live DraftKings audit are not CI tests.

## Current release evidence

| Area | Evidence | Decision |
|---|---|---|
| Type/build/parity/fixtures/source scoring/contracts/auth | Commands above; execution details recorded in the engineering checklist | Software foundation passes deterministic checks |
| Tenant schema | Only the reviewed P10/P11/P12 migration files were applied to the linked Floyd DFS database; do not run broad `supabase db push` while historical drift remains | New schema is present; older migration-history drift remains unchanged |
| Production code | Deployment `dpl_CTtaS8g4AkKHBDQhcn1Bj1uazVJ9`, alias `https://floyd-dfs.vercel.app`, status READY | Deployed; no live audit or entry action was run |
| DraftKings cron | Vercel cron metadata lists `/api/maintenance/draftkings-audit` at `0 14 1 * *`, enabled, with no undeployed/modified rows | Schedule is registered; execution/heartbeat are not manually validated |
| Actual-data backfill | See [P11 historical backfill report](P11_Historical_Data_Backfill_2026-10-22.md) | Official import completed for available matching FDS snapshots; exclusions/mismatches are retained |
| Model and financial claims | No adequate, reviewed out-of-sample evidence; P11 release gate remains HOLD | Disabled |

## Acceptance evidence boundary

`docs/FDS_Engineering_Implementation_Checklist.md` A01–A28 is the scenario inventory. Existing engine parity, source, auth, contract, and replay fixtures cover deterministic subcases. A unit fixture alone does not pass the route-to-UI cases. The following still need staging/manual evidence before general release: production API tenant-denial proof, a four-plus-team generation-to-persistence path, concurrent/stale swap confirmation, error/retry recovery, browser/device/accessibility coverage, provider failure classifications, and an intentionally induced audit failure/recovery.

The live DraftKings canary is metadata-only and must not submit an entry. It has not been manually executed as part of this rollout. That staging check is intentionally left for the operator's ordinary acceptance window.

## Rollback

1. Immediately disable the affected feature/route or roll back the Vercel deployment for authorization leaks, illegal/locked swap exposure, scoring contract failure, loss/corruption of saved revisions, or critical provider identity errors.
2. Preserve tenant data and append-only evidence; do not delete evaluation/actual history to hide a failed rollout.
3. Keep additive schema in place during application rollback unless a separately reviewed migration rollback is required. Do not run a global migration repair or rollback unrelated history.
4. Re-enable the prior compatible app path only after the affected tenant scope and data integrity are verified.
5. Keep projection/model release gates, cash-line calibration, and ROI reporting disabled through software rollback/redeploy.

## Operations runbooks

- **Player scratch / late swap:** refresh the tenant-owned lineup plan, inspect the affected player's current status and each game lock, and use only a current server-validated alternative. If contest eligibility, lock state, identity, projection freshness, or salary/rules cannot be verified, do not act; keep the saved lineup and resolve in DraftKings manually. Confirmation in Floyd DFS records a local revision; it is not an entry submission.
- **Provider failure:** inspect the sanitized provider health record and adapter route/version. Preserve the HTTP category and response-shape evidence; do not treat 403 as a moved route or 429 as schema drift. Block generation when identity/rules are uncertain. Use only the configured, explicitly approved fallback and keep its degraded status visible.
- **Monthly audit failure or missed run:** inspect the operator panel, Vercel deployment/cron metadata, secret configuration, and tenant scheduler lease. Retry only after checking the lease/retry state. A manual audit still probes DraftKings metadata, so perform it only in an approved staging window. The independent 48-hour heartbeat is not configured yet; until then, an absent cron may be silent.
- **Actual correction:** rerun the tenant-scoped idempotent official-source backfill after confirming the provider's final/corrected status. Preserve each content hash and revision. Reconciliation mismatches or incomplete player coverage remain excluded and require review; never overwrite an actual with zero or mark a result official from a live standings snapshot.
- **Model rollback:** disable the affected sport/format or experimental effect, preserve immutable projection/actual/evaluation records, and restore the last compatible app release. Keep probability/calibration/payout gates closed until a reviewer evaluates a new chronological holdout.

## Monitoring and release blockers

Before general P13 acceptance, record staging evidence for unauthorized/cross-tenant requests, write retry/idempotency, scan validation/degraded states, late-swap lock/contest gates, and UI accessibility. Cron registration and runtime limits are confirmed in Vercel metadata/docs; set up an independent heartbeat that alerts if the monthly audit has not succeeded within 48 hours after its due time. Configure an approved notification destination before sending outbound incidents.

P10 remains partially closed because the exact dynamic DraftKings upload CSV has not been downloaded for a target slate and the manual presentation matrix is outstanding. P11 remains data/reviewer gated. P12 remains operationally gated on the independent heartbeat and staging failure/recovery evidence. These are explicit disabled-capability gates, not approvals inferred from CI.
