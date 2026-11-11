# DraftKings relay

DraftKings answers its public lobby and salary CSV from Vercel, but returns HTTP 403 for the
detailed API on `api.draftkings.com` (draft groups, player pool, roster and scoring rules,
contest detail). Without it, the app uses the salary CSV plus a built-in rules profile.

This relay forwards only those read-only requests from a network DraftKings does not block.
The app sends them to the relay when `DRAFTKINGS_API_BASE_URL` is set; everything else is
unchanged, and a 403 from the relay still falls back to the salary CSV.

## Option A: a computer you control (most likely to work)

Home and office internet connections are rarely blocked.

1. Generate a secret: `openssl rand -hex 32`
2. Start the relay: `RELAY_TOKEN=<secret> PORT=8787 node relay/node-server.mjs`
3. Give it a public https address with a tunnel, for example
   `cloudflared tunnel --url http://localhost:8787`
4. Test it: `curl -H "x-relay-token: <secret>" https://<tunnel-host>/sites/US-DK/sports/v1/sports`
   A JSON list of sports means DraftKings accepts requests from that network.

The relay must be running whenever you generate lineups.

## Option B: Cloudflare Worker (always on, may also be blocked)

1. Create a Worker with `relay/draftkings-relay.mjs` as its entry module.
2. Add a secret named `RELAY_TOKEN`.
3. Run the same `curl` test against the Worker URL. If it returns 403, Cloudflare's network
   is blocked too; use Option A instead.

## Connect the app

In Vercel → Project → Settings → Environment Variables (Production), set:

- `DRAFTKINGS_API_BASE_URL` = the relay's https URL (no trailing path)
- `DRAFTKINGS_RELAY_TOKEN` = the same secret

Redeploy. A run that used the detailed API no longer shows the warning that DraftKings'
detailed endpoints returned HTTP 403.

Automated access to DraftKings may be restricted by its terms of use; review them before relying on this.
