#!/usr/bin/env node
// Serwer HTTPS obrazów fixture (fixture.invalid) dla lokalnych pomiarów Lighthouse.
// Chrome dostaje --host-resolver-rules="MAP fixture.invalid 127.0.0.1:<port>" --ignore-certificate-errors,
// więc <img src="https://fixture.invalid/cover.jpg"> ląduje tutaj i LCP mierzy obraz hero jak na produkcji.
// Odpowiedzi: .jpg -> e2e/fixtures/first-visit-cover.jpg (112 795 B), inne -> first-visit-cover.svg (279 B),
// z nagłówkami cache jak produkcyjne /media (immutable, rok).
import https from "node:https";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] ?? 8443);
const REPO = process.argv[3] ?? "/home/user/neweustrategies-dc633fb5";
const jpg = readFileSync(resolve(REPO, "e2e/fixtures/first-visit-cover.jpg"));
const svg = readFileSync(resolve(REPO, "e2e/fixtures/first-visit-cover.svg"));
const opts = { key: readFileSync(resolve(here, "fixture-tls/key.pem")), cert: readFileSync(resolve(here, "fixture-tls/cert.pem")) };
https.createServer(opts, (req, res) => {
  const path = new URL(req.url ?? "/", "https://fixture.invalid").pathname;
  const isJpg = /\.jpe?g$/i.test(path);
  const body = isJpg ? jpg : svg;
  res.writeHead(200, {
    "content-type": isJpg ? "image/jpeg" : "image/svg+xml",
    "content-length": body.length,
    "cache-control": "public, max-age=31536000, immutable",
    "access-control-allow-origin": "*",
  });
  res.end(req.method === "HEAD" ? undefined : body);
}).listen(PORT, "127.0.0.1", () => console.log(`fixture images https://127.0.0.1:${PORT} (fixture.invalid)`));
