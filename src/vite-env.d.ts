/// <reference types="vite/client" />

export {};

declare global {
  interface ImportMetaEnv {
    readonly VITE_SUPABASE_URL: string;
    readonly VITE_SUPABASE_ANON_KEY: string;
    readonly VITE_SUPABASE_SCHEMA?: string;
    readonly VITE_DEBUG_SUPABASE?: string;
    readonly VITE_SENTRY_DSN?: string;
    readonly VITE_CLAUDE_API_KEY?: string;
    readonly VITE_OPENAI_API_KEY?: string;
    readonly VITE_REDDIT_CLIENT_ID?: string;
    readonly VITE_REDDIT_CLIENT_SECRET?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}
