import type { SupabaseClient } from "@supabase/supabase-js";
import { createResearchStageHandler, ResearchAgent, createDefaultRssProviders, SportsDataIoClient, SportsDataIoResearchProvider, OpenAiResearchSynthesizer, createResearchPlan, refreshSlateAvailability } from "@sports-engine/research";
import { createSportAdjustmentStageHandler } from "@sports-engine/sport-adjustment";
import { createProjectionStageHandler } from "@sports-engine/projection";
import { createOptimizeStageHandler } from "@sports-engine/optimizer";
import { createSelectionStageHandler } from "@sports-engine/selection";
import { SportsEngineOrchestrator } from "@sports-engine/orchestrator";
import { SupabaseAdjustmentRepository, SupabaseOptimizerRepository, SupabaseOrchestratorRepository, SupabaseProjectionRepository, SupabaseResearchRepository, SupabaseSelectionRepository } from "@sports-engine/database";
import { parseStageOutput, type AdjustmentPackage, type ContestFormat, type OptimizerPackage, type ProjectionPackage, type ResearchPackage, type ResearchSourceProvider, type SelectionPackage, type ValidatedSlate } from "@sports-engine/contracts";

export function createGenerationOrchestrator(client: SupabaseClient) {
  const providers: ResearchSourceProvider[] = [...createDefaultRssProviders()];
  if (process.env.SPORTS_DATA_IO_KEY) providers.push(new SportsDataIoResearchProvider({ client: new SportsDataIoClient({ apiKey: process.env.SPORTS_DATA_IO_KEY, baseUrl: process.env.SPORTS_DATA_IO_BASE_URL }) }));
  const repository = new SupabaseOrchestratorRepository(client);
  const synthesizer = process.env.OPENAI_API_KEY ? new OpenAiResearchSynthesizer({ apiKey: process.env.OPENAI_API_KEY, model: process.env.AI_MODEL ?? process.env.OPENAI_MODEL }) : undefined;
  const stages = ["SLATE", "RESEARCH", "SPORT_ADJUSTMENT", "PROJECTION", "OPTIMIZE", "SELECTION"] as const;
  const sportsDataClient = process.env.SPORTS_DATA_IO_KEY ? new SportsDataIoClient({ apiKey: process.env.SPORTS_DATA_IO_KEY, baseUrl: process.env.SPORTS_DATA_IO_BASE_URL }) : undefined;
  return { repository, orchestrator: new SportsEngineOrchestrator({ repository, handlers: {
    SLATE: async (input) => {
      if (!sportsDataClient) return { status: "COMPLETE", output: input };
      const refreshed = await refreshSlateAvailability(sportsDataClient, input as ValidatedSlate);
      return { status: "COMPLETE", output: refreshed, warnings: refreshed.validation.warnings };
    },
    RESEARCH: createResearchStageHandler(new ResearchAgent({ providers, synthesizer })),
    SPORT_ADJUSTMENT: createSportAdjustmentStageHandler(), PROJECTION: createProjectionStageHandler(), OPTIMIZE: createOptimizeStageHandler(), SELECTION: createSelectionStageHandler(),
  }, contracts: Object.fromEntries(stages.map((stage) => [stage, { parse: (value: unknown) => parseStageOutput(stage, value) }])) as never }) };
}

export async function persistStageArtifacts(client: SupabaseClient, generationRunId: string, tenantId: string, run: { lineage: Partial<Record<string, number>>; createdAt: string }, fallbackSlate: ValidatedSlate) {
  const repository = new SupabaseOrchestratorRepository(client);
  const slate = (await repository.getLatestStageRun(generationRunId, "SLATE"))?.output as ValidatedSlate | undefined ?? fallbackSlate;
  const research = (await repository.getLatestStageRun(generationRunId, "RESEARCH"))?.output as ResearchPackage | undefined;
  const adjustment = (await repository.getLatestStageRun(generationRunId, "SPORT_ADJUSTMENT"))?.output as AdjustmentPackage | undefined;
  const projection = (await repository.getLatestStageRun(generationRunId, "PROJECTION"))?.output as ProjectionPackage | undefined;
  const optimizer = (await repository.getLatestStageRun(generationRunId, "OPTIMIZE"))?.output as OptimizerPackage | undefined;
  const selection = (await repository.getLatestStageRun(generationRunId, "SELECTION"))?.output as SelectionPackage | undefined;
  const createdAt = run.createdAt;
  if (research) await new SupabaseResearchRepository(client).save({ tenantId, generationRunId, version: run.lineage.RESEARCH ?? 1, plan: createResearchPlan(slate, new Date(createdAt)), researchPackage: research, status: research.status, createdAt });
  if (adjustment) await new SupabaseAdjustmentRepository(client).save({ tenantId, generationRunId, version: run.lineage.SPORT_ADJUSTMENT ?? 1, sport: adjustment.sport, adjustmentPackage: adjustment, status: adjustment.status, createdAt });
  if (projection) await new SupabaseProjectionRepository(client).save({ tenantId, generationRunId, version: run.lineage.PROJECTION ?? 1, sport: projection.sport, modelVersion: projection.modelVersion, simulationRuns: projection.simulationRuns, projectionPackage: projection, status: projection.status, createdAt });
  if (optimizer) await new SupabaseOptimizerRepository(client).save({ tenantId, generationRunId, version: run.lineage.OPTIMIZE ?? 1, objectiveProfile: optimizer.objectiveProfile, optimizerPackage: optimizer, status: optimizer.status, createdAt });
  if (selection) {
    await new SupabaseSelectionRepository(client).save({ tenantId, generationRunId, version: run.lineage.SELECTION ?? 1, selectionPackage: selection, status: selection.status, createdAt });
    await client.from("floyd_dfs_generated_lineups").update({
      research_version: run.lineage.RESEARCH ?? 1,
      adjustment_version: run.lineage.SPORT_ADJUSTMENT ?? 1,
      projection_version: run.lineage.PROJECTION ?? 1,
      optimizer_version: run.lineage.OPTIMIZE ?? 1,
      selection_version: run.lineage.SELECTION ?? 1,
      generation_run_id: generationRunId,
    }).eq("tenant_id", tenantId).eq("generation_run_id", generationRunId);
  }
}
