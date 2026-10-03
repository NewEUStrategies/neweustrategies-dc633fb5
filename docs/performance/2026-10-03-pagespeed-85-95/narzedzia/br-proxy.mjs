#!/usr/bin/env node
// Brotli/gzip compressing reverse proxy for local Lighthouse runs.
// Nitro's node-server preset does not compress responses; production
// (Cloudflare) does. Without this, Lighthouse's network simulator sees
// uncompressed byte counts and FCP/LCP are wildly pessimistic.
//
// Usage: node br-proxy.mjs [listenPort=4174] [upstreamPort=4173]
import http from "node:http";
import zlib from "node:zlib";

const LISTEN = Number(process.argv[2] ?? 4174);
const UPSTREAM = Number(process.argv[3] ?? 4173);
const COMPRESSIBLE = /^(text\/|application\/(javascript|json|xml|ld\+json|rss\+xml|manifest\+json)|image\/svg\+xml)/i;

http
  .createServer((req, res) => {
    const headers = { ...req.headers, host: `127.0.0.1:${UPSTREAM}` };
    // Ask upstream for identity so we control compression.
    delete headers["accept-encoding"];
    const up = http.request(
      { host: "127.0.0.1", port: UPSTREAM, method: req.method, path: req.url, headers },
      (ur) => {
        const ct = String(ur.headers["content-type"] ?? "");
        const accept = String(req.headers["accept-encoding"] ?? "");
        const wantBr = /\bbr\b/.test(accept);
        const wantGz = /\bgzip\b/.test(accept);
        const canCompress = COMPRESSIBLE.test(ct) && !ur.headers["content-encoding"] && (wantBr || wantGz);
        const out = { ...ur.headers };
        if (canCompress) {
          delete out["content-length"];
          out["content-encoding"] = wantBr ? "br" : "gzip";
          out["vary"] = [out["vary"], "Accept-Encoding"].filter(Boolean).join(", ");
          res.writeHead(ur.statusCode ?? 200, out);
          const enc = wantBr
            ? zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } })
            : zlib.createGzip({ level: 6 });
          ur.pipe(enc).pipe(res);
        } else {
          res.writeHead(ur.statusCode ?? 200, out);
          ur.pipe(res);
        }
      },
    );
    up.on("error", (e) => {
      res.writeHead(502, { "content-type": "text/plain" });
      res.end(`upstream error: ${e.message}`);
    });
    req.pipe(up);
  })
  .listen(LISTEN, "127.0.0.1", () => {
    console.log(`br-proxy listening on http://127.0.0.1:${LISTEN} -> http://127.0.0.1:${UPSTREAM}`);
  });
