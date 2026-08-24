/// <reference types="vite/client" />

export {};

declare global {
  interface ImportMetaEnv {
    readonly VITE_FLOYD_DFS_API_URL?: string;
    readonly VITE_FLOYD_DFS_DEV_URL?: string;
    readonly VITE_SENTRY_DSN?: string;
    readonly VITE_CLAUDE_API_KEY?: string;
    readonly VITE_OPENAI_API_KEY?: string;
    readonly VITE_REDDIT_CLIENT_ID?: string;
    readonly VITE_REDDIT_CLIENT_SECRET?: string;
    readonly VITE_ODDS_API_BASE_URL?: string;
    readonly VITE_BALLDONTLIE_API_KEY?: string;
    readonly VITE_BALLDONTLIE_KEY?: string;
    readonly VITE_BALLDONTLIE_BASE_URL?: string;
    readonly VITE_SPORTSDATAIO_API_KEY?: string;
    readonly VITE_SPORTS_DATA_IO_KEY?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}
