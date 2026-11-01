export function resolveAvailabilityStatuses(values: Array<{ rawStatus: string; normalizedStatus: string; observationId: string }>) {
  const statuses = [...new Set(values.map((item) => item.normalizedStatus))];
  const conflicted = statuses.length > 1;
  return {
    state: conflicted ? 'CONFLICT' as const : 'ACCEPTED' as const,
    status: conflicted ? 'UNKNOWN' : statuses[0] ?? 'UNKNOWN',
    rawStatuses: [...new Set(values.map((item) => item.rawStatus))],
    observationIds: [...new Set(values.map((item) => item.observationId))],
  };
}
