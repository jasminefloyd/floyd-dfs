/** Database ownership map for the FDS transport and persistence boundary.
 * Tenant-specific data is always keyed by tenant_id; service-role queries must still filter
 * tenant_id explicitly. Shared provider metadata is intentionally absent from this manifest.
 */
export const FDS_SCHEMA_MANIFEST = {
  version: 'fds.schema.v1',
  tenant: 'public.tenants.id where slug = floyd-dfs',
  mappings: {
    canonicalPlayerProviderId: { table: 'floyd_dfs_player_provider_mappings', key: ['tenant_id', 'sport', 'provider', 'provider_player_id'], canonical: 'canonical_player_id', providerIdsAreStrings: true },
    slateGame: { table: 'floyd_dfs_slate_games', key: ['tenant_id', 'slate_id', 'canonical_game_id'], providerIds: 'provider_ids jsonb' },
    playerPhoto: { table: 'floyd_dfs_player_photos', key: ['tenant_id', 'canonical_player_id', 'provider', 'content_sha256'], nullableUrl: true },
    sourceObservation: { table: 'floyd_dfs_source_observations', key: ['tenant_id', 'generation_run_id', 'content_sha256'] },
    resolvedFact: { table: 'floyd_dfs_resolved_facts', key: ['tenant_id', 'generation_run_id', 'event_id', 'subject_id', 'fact_type', 'content_sha256'] },
    quantitativeEffect: { table: 'floyd_dfs_quantitative_adjustments', key: ['tenant_id', 'generation_run_id', 'player_id', 'dimension', 'content_sha256'] },
    lineupRevision: { table: 'floyd_dfs_lineup_revisions', key: ['tenant_id', 'lineup_id', 'revision'], immutable: true },
    swapPlan: { table: 'floyd_dfs_swap_plans', key: ['tenant_id', 'plan_key'], optimisticSourceRevision: true, tenantScopedGenerationRun: 'generation_run_id', decisionFields: ['salary_remaining', 'mean_delta', 'median_delta', 'risk_flags'] },
    providerHealth: { table: 'floyd_dfs_provider_health_checks', key: ['tenant_id', 'idempotency_key'] },
    runtimeIncident: { table: 'floyd_dfs_runtime_health_incidents', key: ['tenant_id', 'incident_key'], payloadMustBeRedacted: true },
    runSnapshot: { table: 'floyd_dfs_run_data_snapshots', key: ['tenant_id', 'generation_run_id', 'snapshot_type', 'source', 'content_sha256'], immutable: true },
  },
} as const;
