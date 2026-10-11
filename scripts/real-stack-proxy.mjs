// Same-origin reverse proxy for the DISPOSABLE local test stack (scripts/real-stack.sh).
// /storage/v1 -> Storage API, /rest/v1 -> PostgREST, everything else -> the local static preview (npm run dev).
// Imitates the Supabase gateway (Kong) routing; it is NOT used in production.
import http from "node:http";
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS", "access-control-expose-headers": "*" };
const route = (u) => u.startsWith("/storage/v1") ? [5055, u.slice("/storage/v1".length) || "/"] : u.startsWith("/rest/v1") ? [5056, u.slice("/rest/v1".length) || "/"] : [4173, u];
http.createServer((req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  const r = route(req.url);
  const p = http.request({ host: "127.0.0.1", port: r[0], path: r[1], method: req.method, headers: req.headers }, (u) => { res.writeHead(u.statusCode, { ...u.headers, ...cors }); u.pipe(res); });
  p.on("error", () => { res.writeHead(502, cors); res.end(); }); req.pipe(p);
}).listen(5057, "127.0.0.1");
