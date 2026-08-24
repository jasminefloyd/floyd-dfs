import type { ProjectionInput, ProjectionModel, ProjectionPackage, Sport } from "@sports-engine/contracts";
import { createProjectionModel } from "./models";

export class ProjectionService {
  private readonly models: Record<Sport, ProjectionModel>;
  constructor(models?: Partial<Record<Sport, ProjectionModel>>) { this.models = { NBA: models?.NBA ?? createProjectionModel("NBA"), WNBA: models?.WNBA ?? createProjectionModel("WNBA"), NFL: models?.NFL ?? createProjectionModel("NFL"), MLB: models?.MLB ?? createProjectionModel("MLB"), GOLF: models?.GOLF ?? createProjectionModel("GOLF") }; }
  project(input: ProjectionInput, now = new Date()): ProjectionPackage { return this.models[input.validatedSlate.sport].project(input, now); }
}
