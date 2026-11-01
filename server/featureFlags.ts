export const FEATURE_FLAG_NAMES = [
  'STREET_TEAM_V2',
  'NBA_HOUSE_V1',
  'NBA_HOUSE_READ_V1',
  'NBA_HOUSE_SHADOW_V1',
  'NBA_HOUSE_CANARY_V1',
  'NBA_HOUSE_ACTIVE_V1',
  'NBA_HOUSE_KILL_SWITCH_V1',
  'PORTFOLIO_EV_V1',
  'LEARNING_V2',
] as const;

export type FeatureFlagName = (typeof FEATURE_FLAG_NAMES)[number];
export type FeatureFlagSet = Record<FeatureFlagName, boolean>;

/** Server-only flags default off; only a case-insensitive "true" value enables a feature. */
export function readFeatureFlags(env: NodeJS.ProcessEnv = process.env): FeatureFlagSet {
  return Object.fromEntries(FEATURE_FLAG_NAMES.map((name) => [name, env[name]?.trim().toLowerCase() === 'true'])) as FeatureFlagSet;
}

export function isFeatureEnabled(name: FeatureFlagName, env: NodeJS.ProcessEnv = process.env): boolean {
  return readFeatureFlags(env)[name];
}

/** Preserve the historical NBA_HOUSE_V1 switch as a shadow-report alias. */
export function isNbaHouseShadowEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flags = readFeatureFlags(env);
  return flags.NBA_HOUSE_V1 || flags.NBA_HOUSE_SHADOW_V1;
}
