import type { SupabaseClient } from '@supabase/supabase-js';
import { promotionEvidence, type StoredEvaluation } from '../../learning/promotion.js';
import { isFeatureEnabled } from '../../featureFlags.js';
import type { NbaHouseMode } from './runtimeAdapter.js';
import { NBA_HOUSE_DRIVER_POLICY_VERSION } from './driverPolicy.js';

export interface ResolvedNbaHouseModel { mode: NbaHouseMode; killSwitch: boolean; approved: boolean; modelVersion?: string; driverPolicyVersion?: string; canaryPercent?: number; registryId?: string; evaluationId?: string; reason: string; }

/** Resolve a tenant's reviewed registry record; failures always remain on legacy runtime. */
export async function resolveNbaHouseModel(db: SupabaseClient, tenantId: string, frozen?: Record<string, unknown>): Promise<ResolvedNbaHouseModel> {
  if (frozen && isFeatureEnabled('NBA_HOUSE_KILL_SWITCH_V1')) return { mode: 'LEGACY', killSwitch: true, approved: false, reason: 'NBA House kill switch is enabled; the pinned candidate is disabled for safety.' };
  if (frozen && typeof frozen.assignedMode === 'string') {
    const mode = ['LEGACY', 'SHADOW', 'CANARY', 'ACTIVE'].includes(frozen.requestedMode as string) ? frozen.requestedMode as NbaHouseMode : frozen.assignedMode as NbaHouseMode;
    if (!['LEGACY', 'SHADOW', 'CANARY', 'ACTIVE'].includes(mode)) return { mode: 'LEGACY', killSwitch: false, approved: false, reason: 'Saved NBA House assignment has an invalid mode; legacy retained.' };
    if (typeof frozen.registryId === 'string' && typeof frozen.evaluationId === 'string') {
      const registry = await db.from('floyd_dfs_model_registry').select('id,model_version,status,config,evaluation_id').eq('tenant_id', tenantId).eq('id', frozen.registryId).maybeSingle();
      if (registry.error || !registry.data || registry.data.evaluation_id !== frozen.evaluationId) return { mode, killSwitch: false, approved: false, reason: 'Pinned NBA House registry record is unavailable or changed.' };
      const evaluation = await db.from('floyd_dfs_model_evaluations').select('id,tenant_id,sport,component,model_version,gate_decision,reviewed_by,reviewed_at,review_note,sample_count,metrics,data_manifest').eq('tenant_id', tenantId).eq('id', frozen.evaluationId).maybeSingle();
      const gate = evaluation.data ? promotionEvidence(evaluation.data as StoredEvaluation) : { eligible: false, reasons: ['Pinned evaluation is unavailable.'], independentSlates: 0, playerRows: 0 };
      const config = isRecord(registry.data.config) ? registry.data.config : {};
      const modelVersion = String(registry.data.model_version);
      const evaluationMatches = !evaluation.error && evaluation.data?.sport === 'NBA' && evaluation.data?.component === 'PROJECTION' && evaluation.data?.model_version === modelVersion;
      const registryMatches = registry.data.status === mode;
      const approved = Boolean(evaluationMatches && registryMatches && gate.eligible);
      const driverPolicyVersion = approvedNbaDriverPolicyVersion(config.driverPolicyVersion, approved);
      return { mode, killSwitch: false, approved, modelVersion, driverPolicyVersion, registryId: String(registry.data.id), evaluationId: String(frozen.evaluationId), canaryPercent: typeof frozen.canaryPercent === 'number' ? frozen.canaryPercent : undefined, reason: approved ? 'Pinned run assignment restored from its matching reviewed registry and evaluation.' : 'Pinned registry status, model identity, or linked review is no longer eligible.' };
    }
    return { mode, killSwitch: false, approved: false, reason: 'Pinned legacy/shadow assignment restored for this retry.' };
  }
  const flags = { shadow: isFeatureEnabled('NBA_HOUSE_V1') || isFeatureEnabled('NBA_HOUSE_SHADOW_V1'), canary: isFeatureEnabled('NBA_HOUSE_CANARY_V1'), active: isFeatureEnabled('NBA_HOUSE_ACTIVE_V1'), kill: isFeatureEnabled('NBA_HOUSE_KILL_SWITCH_V1') };
  const mode: NbaHouseMode = flags.active ? 'ACTIVE' : flags.canary ? 'CANARY' : flags.shadow ? 'SHADOW' : 'LEGACY';
  if (flags.kill) return { mode: 'LEGACY', killSwitch: true, approved: false, reason: 'NBA House kill switch is enabled.' };
  if (mode === 'LEGACY' || mode === 'SHADOW') return { mode, killSwitch: false, approved: false, reason: mode === 'SHADOW' ? 'Shadow mode leaves optimizer projections on legacy.' : 'NBA House flags are disabled.' };
  const registry = await db.from('floyd_dfs_model_registry').select('id,model_version,status,config,evaluation_id').eq('tenant_id', tenantId).eq('sport', 'NBA').eq('component', 'PROJECTION').eq('status', mode).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (registry.error) return { mode: 'LEGACY', killSwitch: false, approved: false, reason: `Model registry lookup failed; legacy retained (${registry.error.message}).` };
  if (!registry.data?.evaluation_id) return { mode: 'LEGACY', killSwitch: false, approved: false, reason: 'No matching reviewed NBA projection registry record; legacy retained.' };
  const evaluation = await db.from('floyd_dfs_model_evaluations').select('id,tenant_id,sport,component,model_version,gate_decision,reviewed_by,reviewed_at,review_note,sample_count,metrics,data_manifest').eq('tenant_id', tenantId).eq('id', registry.data.evaluation_id).maybeSingle();
  if (evaluation.error || !evaluation.data) return { mode: 'LEGACY', killSwitch: false, approved: false, reason: 'Linked evaluation is unavailable; legacy retained.' };
  if (evaluation.data.sport !== 'NBA' || evaluation.data.component !== 'PROJECTION' || evaluation.data.model_version !== registry.data.model_version) return { mode: 'LEGACY', killSwitch: false, approved: false, reason: 'Linked evaluation identity does not match the NBA projection registry model; legacy retained.' };
  const gate = promotionEvidence(evaluation.data as StoredEvaluation);
  const config = isRecord(registry.data.config) ? registry.data.config : {};
  const canaryPercent = typeof config.canaryPercent === 'number' ? config.canaryPercent : undefined;
  if (!gate.eligible) return { mode: 'LEGACY', killSwitch: false, approved: false, reason: `Linked NBA evaluation is not approved: ${gate.reasons.join(' ')}` };
  const driverPolicyVersion = approvedNbaDriverPolicyVersion(config.driverPolicyVersion, true);
  return { mode, killSwitch: false, approved: true, modelVersion: String(registry.data.model_version), driverPolicyVersion, canaryPercent, registryId: String(registry.data.id), evaluationId: String(registry.data.evaluation_id), reason: 'Registry status is linked to a reviewed evaluation that passed the promotion gate.' };
}
export function approvedNbaDriverPolicyVersion(configuredVersion: unknown, evaluationApproved: boolean): string | undefined {
  return evaluationApproved && configuredVersion === NBA_HOUSE_DRIVER_POLICY_VERSION ? NBA_HOUSE_DRIVER_POLICY_VERSION : undefined;
}
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
