export const FEATURE_FLAG_NAMES = [
  'STREET_TEAM_V2',
  'NBA_HOUSE_V1',
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
