// One-time local helper: obtains the Google refresh token (scope drive.file only) for the account that owns the Drive.
//   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node scripts/drive-auth.mjs
// Opens nothing by itself: open the printed URL, accept, and the token is PRINTED here (never written to disk).
// Then: npx wrangler pages secret put GOOGLE_REFRESH_TOKEN --project-name thomas-aziliz-mariage
import http from "node:http";
import { randomBytes } from "node:crypto";

const { GOOGLE_CLIENT_ID: id, GOOGLE_CLIENT_SECRET: secret } = process.env;
if (!id || !secret) throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required (see GUIDE_DRIVE.md)");
const state = randomBytes(16).toString("hex");
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname !== "/callback") return res.writeHead(404).end();
  if (url.searchParams.get("state") !== state || !url.searchParams.get("code")) return res.writeHead(400).end("Invalid state");
  const redirect = `http://127.0.0.1:${server.address().port}/callback`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code: url.searchParams.get("code"), client_id: id, client_secret: secret, redirect_uri: redirect, grant_type: "authorization_code" }),
  });
  const data = await response.json();
  res.end("Terminé, vous pouvez fermer cet onglet.");
  server.close();
  if (!data.refresh_token) throw new Error(`No refresh token received: ${data.error || "retry with prompt=consent"}`);
  console.log("\nGOOGLE_REFRESH_TOKEN (à coller dans wrangler pages secret put, ne jamais le committer) :\n" + data.refresh_token);
});
server.listen(0, "127.0.0.1", () => {
  const redirect = `http://127.0.0.1:${server.address().port}/callback`;
  const params = new URLSearchParams({ client_id: id, redirect_uri: redirect, response_type: "code", scope: "https://www.googleapis.com/auth/drive.file", access_type: "offline", prompt: "consent", state });
  console.log("Ouvrez cette adresse dans votre navigateur :\n\nhttps://accounts.google.com/o/oauth2/v2/auth?" + params);
});
