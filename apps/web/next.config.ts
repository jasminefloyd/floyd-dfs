import path from "node:path";
import fs from "node:fs";
import type { NextConfig } from "next";

const rootEnv = path.resolve(__dirname, "../../.env.local");
const publicEnv = fs.existsSync(rootEnv) ? readPublicEnvironment(fs.readFileSync(rootEnv, "utf8")) : {};

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  },
};

export default nextConfig;

function readPublicEnvironment(contents: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_ANON_KEY)=(.*)$/);
    if (match) result[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  return result;
}
