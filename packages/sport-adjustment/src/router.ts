import type { Sport, SportAdjustmentInput, AdjustmentPackage } from "@sports-engine/contracts";
import { createSpecialist, EvidenceSportSpecialist } from "./specialists";

export class SportAdjustmentRouter {
  private readonly specialists: Record<Sport, EvidenceSportSpecialist>;
  constructor(specialists?: Partial<Record<Sport, EvidenceSportSpecialist>>) {
    this.specialists = { NBA: specialists?.NBA ?? createSpecialist("NBA"), WNBA: specialists?.WNBA ?? createSpecialist("WNBA"), NFL: specialists?.NFL ?? createSpecialist("NFL"), MLB: specialists?.MLB ?? createSpecialist("MLB"), GOLF: specialists?.GOLF ?? createSpecialist("GOLF") };
  }
  adjust(input: SportAdjustmentInput, now = new Date()): AdjustmentPackage { return this.specialists[input.validatedSlate.sport].adjust(input, now); }
}
