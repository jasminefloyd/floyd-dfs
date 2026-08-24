import { GET as getRun } from "../../../runs/[runId]/route";
export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const response = await getRun(request, { params });
  const payload = await response.json();
  return Response.json({ lineups: payload.lineups ?? [], run: payload.run }, { status: response.status });
}
