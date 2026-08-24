# Fantasy AI client

This repository preserves the Fantasy AI mobile-first DFS interface. Its backend and lineup logic are provided by the Floyd DFS agentic system in the sibling `floyd-dfs` project.

## Local Setup

```bash
npm install
npm run dev
```

The Vite app runs locally at `http://127.0.0.1:5177/`.

## Environment

Frontend and API clients expect:

```bash
VITE_FLOYD_DFS_API_URL=https://dfs-engine-kappa.vercel.app
VITE_FLOYD_DFS_DEV_URL=https://dfs-engine-kappa.vercel.app
```

`VITE_FLOYD_DFS_API_URL` is the deployed Floyd DFS web URL. The Vite `/api` proxy also forwards requests to `VITE_FLOYD_DFS_DEV_URL` during local development.

## Verification commands

```bash
npm run build
npm run lint
```

Start both applications locally:

```bash
cd ../floyd-dfs
corepack pnpm dev

cd ../fantasy-ai
npm run dev
```
