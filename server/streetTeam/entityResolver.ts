export interface DraftKingsIdentity { playerId: string; identity?: { sportsDataIoId?: string; draftKingsId?: string }; draftKingsSlotIds?: Record<string, string> }

/** Only exact provider IDs bind Street Team evidence to the actual DraftKings slate pool. */
export function resolveDraftKingsPoolIds(players: DraftKingsIdentity[], providerPlayerId: string): { playerIds: string[]; unresolved: boolean } {
  const playerIds = players.filter((player) => player.identity?.sportsDataIoId === providerPlayerId)
    .flatMap((player) => [player.playerId, ...(player.draftKingsSlotIds ? Object.values(player.draftKingsSlotIds) : [])]);
  const uniqueIds = [...new Set(playerIds)];
  return { playerIds: uniqueIds, unresolved: uniqueIds.length === 0 };
}

export function teamForAsOf(snapshots: Array<{ asOf: string; rosterState: Array<{ playerId: string; teamId: string }> }>, playerId: string, asOf: string): string | undefined {
  const cutoff = Date.parse(asOf);
  if (!Number.isFinite(cutoff)) throw new Error('An ISO as-of timestamp is required for roster history lookup.');
  const eligible = snapshots.filter((snapshot) => Date.parse(snapshot.asOf) <= cutoff).sort((a, b) => Date.parse(b.asOf) - Date.parse(a.asOf));
  return eligible[0]?.rosterState.find((item) => item.playerId === playerId)?.teamId;
}
