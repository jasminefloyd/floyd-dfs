import { DraftKingsApiClient, DraftKingsSlateMappingError, buildSlateFromApiBundle } from "@sports-engine/draftkings";
import { SupabaseOrchestratorRepository } from "@sports-engine/database";
import type { ContestFormat, Sport } from "@sports-engine/contracts";
import { authErrorResponse, publicTenantContext } from "../../../lib/server-auth";

export async function POST(request: Request) {
  try {
    const context = await publicTenantContext();
    const body = await request.json() as Record<string, unknown>;
    const sport = String(body.sport ?? "NBA").toUpperCase() as Sport;
    const contestFormat = String(body.contestFormat ?? "CLASSIC").toUpperCase() as ContestFormat;
    const contestId = String(body.contestId ?? "");
    const contestName = typeof body.contestName === "string" ? body.contestName : undefined;
    const contestLockTime = typeof body.contestLockTime === "string" ? body.contestLockTime : undefined;
    const entries = Math.max(1, Number(body.entries ?? 1));
    const fieldSize = body.fieldSize === undefined ? undefined : Number(body.fieldSize);
    if (fieldSize !== undefined && (!Number.isInteger(fieldSize) || fieldSize < 2 || fieldSize > 500_000)) return Response.json({ error: "fieldSize must be an integer between 2 and 500000." }, { status: 400 });
    if (!contestId || !["NBA", "WNBA", "NFL", "MLB", "GOLF"].includes(sport) || !["CLASSIC", "SHOWDOWN"].includes(contestFormat)) return Response.json({ error: "contestId, supported sport, and contestFormat are required." }, { status: 400 });

    const discovery = new DraftKingsApiClient({ sportCodes: {} });
    const sports = await discovery.listSports();
    const match = sports.find((item) => item.abbreviatedName.toUpperCase() === sport);
    const fallback = sport === "WNBA" ? sports.find((item) => item.abbreviatedName.toUpperCase() === "NBA") : undefined;
    const lobbySport = match ?? fallback;
    if (!lobbySport) return Response.json({ error: `DraftKings did not return ${sport} in the live sports response.` }, { status: 422 });
    const client = new DraftKingsApiClient({ sportCodes: { [lobbySport.abbreviatedName as Sport]: lobbySport.abbreviatedName } as Partial<Record<Sport, string>> });
    const bundle = await client.getSlateBundleForContest({ contestId });
    const built = buildSlateFromApiBundle(bundle, { tenantId: context.tenantId, userId: context.actorUserId, requestId: crypto.randomUUID(), sport, league: sport, contestId, contestName, contestLockTime, draftGroupId: bundle.reference.draftGroupId, gameTypeId: bundle.reference.gameTypeId, contestFormat, userEntryCount: entries, contestSizeOverride: fieldSize });
    const repository = new SupabaseOrchestratorRepository(context.client);
    const run = await repository.createRun({ tenantId: context.tenantId, userId: context.actorUserId, requestId: built.slateInput.requestId, requestedEntryCount: entries, input: built.validatedSlate }, new Date().toISOString());
    const { error: jobError } = await context.client.from("engine_jobs").insert({ tenant_id: context.tenantId, generation_run_id: run.id, stage: "SLATE", status: "queued", input_payload: { slate: built.validatedSlate }, max_attempts: 3 });
    if (jobError) throw jobError;
    return Response.json({ run, queued: true, slate: built.validatedSlate }, { status: 202 });
  } catch (error) {
    if (error instanceof DraftKingsSlateMappingError) {
      return Response.json({ error: error.message, stage: "SLATE", blocked: true }, { status: 422 });
    }
    return authErrorResponse(error);
  }
}
