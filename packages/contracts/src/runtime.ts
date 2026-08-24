import type { EngineStage } from "./orchestration";

type RecordValue = Record<string, unknown>;

export function parseStageOutput(stage: EngineStage, value: unknown): unknown {
  const record = asRecord(value, stage);
  switch (stage) {
    case "SLATE": return requireKeys(record, stage, ["slateId", "tenantId", "sport", "event", "contest", "playerPool", "salaryCap"]);
    case "RESEARCH": return requireKeys(record, stage, ["slateId", "tenantId", "findings", "availability", "playerEvidence", "status"]);
    case "SPORT_ADJUSTMENT": return requireKeys(record, stage, ["slateId", "tenantId", "sport", "adjustments", "status"]);
    case "PROJECTION": return requireKeys(record, stage, ["slateId", "tenantId", "sport", "players", "status"]);
    case "OPTIMIZE": return requireKeys(record, stage, ["slateId", "tenantId", "candidates", "status"]);
    case "SELECTION": {
      requireKeys(record, stage, ["slateId", "tenantId", "selectedLineups", "status"]);
      if (!Array.isArray(record.selectedLineups)) throw new Error(`${stage}.selectedLineups must be an array.`);
      return record;
    }
    case "LEARNING_LOOP": return record;
  }
}

function asRecord(value: unknown, stage: EngineStage): RecordValue {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${stage} output must be an object.`);
  return value as RecordValue;
}

function requireKeys(record: RecordValue, stage: EngineStage, keys: string[]): RecordValue {
  for (const key of keys) if (!(key in record) || record[key] === undefined || record[key] === null) throw new Error(`${stage} output is missing required field: ${key}.`);
  return record;
}
