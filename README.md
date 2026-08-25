# Fantasy AI client

This repository contains the Fantasy AI mobile-first DFS interface and its server runtime. The browser and server handlers use same-origin `/api` routes in production.

## Local Setup

```bash
npm install
npm run dev
```

The Vite app runs locally at `http://127.0.0.1:5177/`.

## Environment

Frontend configuration:

```bash
VITE_FLOYD_DFS_API_URL=
VITE_FLOYD_DFS_DEV_URL=http://127.0.0.1:3000
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

`VITE_FLOYD_DFS_API_URL` should remain unset in production. The Vite `/api` proxy forwards to the local Vercel runtime during development.

Server-only production configuration:

```bash
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
SPORTS_DATA_IO_KEY=...
SPORTS_DATA_IO_BASE_URL=https://api.sportsdata.io/v3
OPENAI_API_KEY=...
OPENAI_MODEL=...
```

The service-role key, SportsDataIO key, and OpenAI key must be configured as Vercel server environment variables and must not use the `VITE_` prefix.

## Verification commands

```bash
npm run build
npm run lint
```

Run the Vite app and local API handlers together:

```bash
npm run dev:full
```
