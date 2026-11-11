// Run the DraftKings relay on any computer with Node 18+:
//   RELAY_TOKEN=<long random secret> PORT=8787 node relay/node-server.mjs
// Expose it with a tunnel (for example Cloudflare Tunnel) and set DRAFTKINGS_API_BASE_URL in
// Vercel to the tunnel's https URL. See relay/README.md.
import { createServer } from 'node:http';
import { handleRelayRequest } from './draftkings-relay.mjs';

const token = process.env.RELAY_TOKEN;
const port = Number(process.env.PORT ?? 8787);

createServer(async (req, res) => {
  try {
    const request = new Request(`http://localhost${req.url}`, { method: req.method, headers: req.headers });
    const response = await handleRelayRequest(request, token);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  } catch (error) {
    res.writeHead(502, { 'content-type': 'text/plain' });
    res.end(`Relay error: ${error instanceof Error ? error.message : 'request failed'}`);
  }
}).listen(port, () => console.log(`DraftKings relay listening on http://localhost:${port}`));
