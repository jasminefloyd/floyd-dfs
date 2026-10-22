export function parseBearer(value: string | string[] | undefined): string | undefined;
export function tenantHeaderAllowed(configuredTenantId: string, requestedId: string | string[] | undefined): boolean;
export function secretMatches(provided: string | undefined, expected: string): boolean;
export function isOperator(userId: string, configuredIds: string | undefined): boolean;
