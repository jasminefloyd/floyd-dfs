import { DraftKingsApiClient, extractContestMetadata } from "@sports-engine/draftkings";
import { authErrorResponse, publicTenantContext } from "../../../../lib/server-auth";

export async function GET(request: Request, { params }: { params: Promise<{ contestId: string }> }) {
  try {
    await publicTenantContext();
    const { contestId } = await params;
    if (!contestId) return Response.json({ error: "contestId is required." }, { status: 400 });
    const client = new DraftKingsApiClient({ sportCodes: {} });
    const response = await client.getContest(contestId);
    return Response.json({ contest: { id: contestId, ...extractContestMetadata(response.data) }, retrievedAt: response.retrievedAt });
  } catch (error) {
    return authErrorResponse(error);
  }
}
