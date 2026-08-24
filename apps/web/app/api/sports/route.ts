import { authErrorResponse, publicTenantContext } from "../../../lib/server-auth";
import { DraftKingsApiClient } from "@sports-engine/draftkings";
export async function GET(request: Request) {
  try { await publicTenantContext(); const sports = await new DraftKingsApiClient({ sportCodes: {} }).listSports(); return Response.json({ sports }); }
  catch (error) { return authErrorResponse(error); }
}
