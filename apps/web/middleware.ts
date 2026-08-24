import { NextResponse, type NextRequest } from "next/server";

const allowedOrigins = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  process.env.FANTASY_AI_ORIGIN ?? "",
]);

export function middleware(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith("/api/")) return NextResponse.next();
  if (request.method === "OPTIONS") return corsResponse(new NextResponse(null, { status: 204 }), request);
  return corsResponse(NextResponse.next(), request);
}

function corsResponse(response: NextResponse, request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && allowedOrigins.has(origin)) response.headers.set("access-control-allow-origin", origin);
  response.headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  response.headers.set("access-control-allow-headers", "content-type");
  response.headers.set("vary", "Origin");
  return response;
}

export const config = { matcher: ["/api/:path*"] };
