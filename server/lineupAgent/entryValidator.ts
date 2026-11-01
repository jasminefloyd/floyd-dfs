import type { ValidatedSlate } from '../../src/lib/engine/contracts.js';

export const FINAL_LINEUP_VALIDATOR_VERSION = 'draftkings-independent-export-validator.v1';

/** Independent last-mile rules check for the exported/submitted DK roster. */
export function validateFinalLineupIndependently(input: { playerIds: string[]; rosterSlots: Record<string, string>; salaryUsed: number }, slate: ValidatedSlate): string[] {
  const issues: string[] = []; const entries = Object.entries(input.rosterSlots); const rosterRules = slate.rosterRules;
  const expectedCount = Object.values(rosterRules.slots).reduce((sum, rule) => sum + rule.count, 0);
  if (entries.length !== expectedCount || expectedCount !== rosterRules.rosterSize) issues.push('Export does not fill the contest’s required number of roster slots.');
  const assigned = entries.map(([, playerId]) => playerId);
  if (assigned.length !== input.playerIds.length || [...assigned].sort().join('|') !== [...input.playerIds].sort().join('|')) issues.push('Export player IDs do not match its roster slots.');
  if (rosterRules.uniquePlayersRequired && new Set(assigned).size !== assigned.length) issues.push('Export contains a duplicate player.');
  const perSlot = new Map<string, number>(); const teams = new Map<string, number>(); const hitters = new Map<string, number>();
  const byId = new Map(slate.playerPool.map((player) => [player.playerId, player])); let salary = 0;
  for (const [slotName, playerId] of entries) {
    const base = slotName.replace(/_\d+$/, ''); const rule = rosterRules.slots[base]; const player = byId.get(playerId);
    perSlot.set(base, (perSlot.get(base) ?? 0) + 1);
    if (!rule) { issues.push(`Export uses an unknown roster slot (${slotName}).`); continue; }
    if (!player) { issues.push(`Export player ${playerId} is outside the saved contest pool.`); continue; }
    if (!player.eligibility[slotName] && !player.eligibility[base]) issues.push(`${player.playerName} is not eligible for ${slotName}.`);
    const status = player.availability?.status;
    if (['OUT','INACTIVE','NOT_IN_CONFIRMED_LINEUP','NOT_IN_PROVIDER_ROSTER'].includes(String(status)) || /^(IL|IR|injured|out|inactive|scratched|doubtful|suspended)/i.test(String(player.providerStatus ?? '').trim())) issues.push(`${player.playerName} is marked unavailable in the saved contest snapshot.`);
    const isCaptain = /(^|_)(CPT|CAPTAIN|MVP)(_|$)/i.test(base);
    const multiplier = rule.salaryMultiplier ?? 1;
    const slotSalary = isCaptain ? player.captainSalary ?? (rule.salaryMultiplier ? Math.round(player.salary * rule.salaryMultiplier) : undefined) : base.toUpperCase() === 'UTIL' ? player.utilitySalary ?? player.salary : Math.round(player.salary * multiplier);
    if (typeof slotSalary !== 'number' || !Number.isFinite(slotSalary) || slotSalary < 0) issues.push(`${player.playerName} has no valid salary for ${slotName}.`); else salary += slotSalary;
    if (player.team) { teams.set(player.team, (teams.get(player.team) ?? 0) + 1); if (slate.sport === 'MLB' && !['P','SP','RP'].includes(String(player.position ?? '').toUpperCase())) hitters.set(player.team, (hitters.get(player.team) ?? 0) + 1); }
  }
  for (const [base, rule] of Object.entries(rosterRules.slots)) if ((perSlot.get(base) ?? 0) !== rule.count) issues.push(`Export has the wrong number of ${base} slots.`);
  if (!Number.isFinite(input.salaryUsed) || Math.abs(input.salaryUsed - salary) > .01) issues.push(`Export salary ${input.salaryUsed} differs from independent recomputation ${salary}.`);
  if (salary > slate.salaryCap) issues.push(`Export salary ${salary} exceeds cap ${slate.salaryCap}.`);
  if (rosterRules.teamConstraints?.minimumTeams !== undefined && teams.size < rosterRules.teamConstraints.minimumTeams) issues.push('Export fails the minimum team rule.');
  if (rosterRules.teamConstraints?.maximumPlayersPerTeam !== undefined && [...teams.values()].some((count) => count > rosterRules.teamConstraints!.maximumPlayersPerTeam!)) issues.push('Export exceeds the per-team player limit.');
  if (rosterRules.teamConstraints?.maximumHittersPerTeam !== undefined && [...hitters.values()].some((count) => count > rosterRules.teamConstraints!.maximumHittersPerTeam!)) issues.push('Export exceeds the per-team hitter limit.');
  return [...new Set(issues)];
}
