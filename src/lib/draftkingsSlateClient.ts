import { listFloydContests, listFloydGameGroups, type FloydGameGroup } from './floydDfsClient';

export type DraftKingsGameGroup = FloydGameGroup;

export async function listDraftKingsGameGroups(
  params: { sport: string; contestType: string },
  signal?: AbortSignal,
): Promise<DraftKingsGameGroup[]> {
  return listFloydGameGroups(params, signal);
}

export interface DraftKingsSlate {
  contest_id: string;
  external_contest_id: string | null;
  sport: string;
  contest_type: string;
  contest_date: string;
  slate_name: string;
  game_ids: string[];
  salary_cap: number;
  field_size?: number;
  status: string | null;
  start_time: string | null;
  salary_count: number;
  data: Record<string, unknown>;
  updated_at: string;
}

export async function listDraftKingsSlates(
  params: { sport: string; contestType: string; draftGroupId?: string },
  signal?: AbortSignal,
): Promise<DraftKingsSlate[]> {
  return listFloydContests(params, signal);
}
