# Floyd DFS environment variable inventory

This is a names-and-purpose inventory. Store values in ignored local `.env` files or the appropriate Vercel environment; never commit values, print secrets, or expose server variables with a `VITE_` prefix.

| Variables | Purpose / handling |
|---|---|
| `VITE_FLOYD_DFS_API_URL`, `VITE_FLOYD_DFS_DEV_URL` | Browser API routing. Production uses same-origin `/api`; the development URL targets local Vercel Functions. |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Public Supabase Auth client configuration. RLS and server authorization still apply. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Server-only Floyd DFS database access. All service-role queries must explicitly filter `tenant_id`; the service key must never reach the browser. |
| `FDS_TENANT_SLUG`, `FDS_OPERATOR_USER_IDS` | Single-tenant pin (`floyd-dfs`) and comma-separated operator UUID allowlist. Configure the minimum authorized identities. |
| `FDS_WORKER_BEARER_SECRET`, `FDS_SCHEDULER_BEARER_SECRET`, `CRON_SECRET` | Independent worker and scheduler credentials. Use generated secrets. `CRON_SECRET` must match the Vercel Cron authorization value; never log either value. |
| `SPORTS_DATA_IO_KEY`, `SPORTS_DATA_IO_BASE_URL`, `SPORTS_DATA_IO_DATA_TIER` | SportsDataIO access, API root, and explicit integrity/entitlement gate. Do not set the tier to production-verified without independent provider evidence. |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Optional server-side research/model providers. Experimental numeric effects remain separately disabled by default. |
| `THE_ODDS_API_KEY`, `ODDS_API_BASE_URL`, `BALLDONTLIE_KEY`, `BALLDONTLIE_BASE_URL`, `SERPAPI_API_KEY`, `FIRECRAWL_API_KEY`, `FIELD_SENTIMENT_URL` | Optional research, odds, injury, and field-sentiment integrations. Use only with approved entitlements and configured request budgets. |
| `ESPN_BASE_URL` | ESPN API root used by game-state/research adapters. |
| `FDS_PLAYER_PHOTO_ALLOWED_HOSTS`, `FDS_PLAYER_PHOTO_CACHE_TTL_DAYS` | Exact HTTPS hostname allowlist and tenant-scoped photo metadata revalidation period. ESPN roster headshots use `a.espncdn.com`; enable only after image rights and attribution are reviewed. |
| `FDS_RESEARCH_QUERY_BUDGET`, `FDS_RESEARCH_BATCH_SIZE`, `FDS_AVAILABILITY_FRESHNESS_MINUTES`, `FDS_CONTEXT_FRESHNESS_MINUTES` | Bounded research fan-out and evidence freshness values. |
| `FDS_SWAP_PLAN_FRESHNESS_MINUTES`, `FDS_OPTIMIZER_MAX_SEARCH_NODES`, `FDS_FIELD_SIMULATIONS`, `FDS_FIELD_SIMULATION_MAX_COMPARISONS` | Swap expiry and bounded optimizer/field-diagnostic workloads. Monitor before increasing. |
| `FDS_ENABLE_EXPERIMENTAL_CONTEXT_EFFECTS` | Numeric context-feature kill switch; keep `false` until scoped P11 evidence and approval exist. |
| `RESEND_API_KEY`, `WEEKLY_LEARNING_REPORT_EMAIL`, `WEEKLY_LEARNING_REPORT_FROM` | Optional weekly report delivery. No guessed operator destination; configure an approved recipient before enabling. |
| `FDS_EXPECTED_SUPABASE_PROJECT_REF`, `FDS_P02_BACKUP_DIR`, `FDS_P02_WRITERS_PAUSED` | Production-migration backup/preflight safeguards. Do not use these to bypass approval or perform a broad push against divergent history. |

The checked-in `.env.example` is the canonical template. Values are deliberately omitted from this document; deployment configuration is managed separately and inspected without revealing values.
