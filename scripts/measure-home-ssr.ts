// Read-only HTTP probe. No cookies, analytics beacons, cache purge or query
// parameters. A fresh client is not proof of a cold POP: inspect Server-Timing.
// Usage: bun scripts/measure-home-ssr.ts http://localhost:4320
import { parse } from "node-html-parser";

const target = new URL(process.argv[2] ?? "http://localhost:4320");
if (
  !["http:", "https:"].includes(target.protocol) ||
  target.username ||
  target.password ||
  target.search ||
  target.hash
) {
  throw new Error("Use an HTTP(S) origin without credentials, query parameters or a fragment.");
}

for (const path of ["/", "/en"]) {
  for (let sample = 1; sample <= 3; sample += 1) {
    const started = performance.now();
    const response = await fetch(new URL(path, target.origin), {
      headers: { accept: "text/html", "accept-language": path === "/" ? "pl" : "en" },
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
    const ttfbMs = performance.now() - started;
    const html = await response.text();
    const streamCompleteMs = performance.now() - started;
    const root = parse(html);
    const routerScripts = root
      .querySelectorAll("script")
      .filter((script) => /\$_TSR\b/.test(script.textContent));
    console.log(
      JSON.stringify({
        path,
        sample,
        status: response.status,
        ttfbMs: Math.round(ttfbMs),
        streamCompleteMs: Math.round(streamCompleteMs),
        // fetch decodes transport compression. This is NOT transferred bytes.
        htmlDecodedBytes: Buffer.byteLength(html),
        // Proxy only: includes router state, excludes later React stream chunks.
        // Not the exact query payload; never use it to justify dropping queries.
        routerInlineScriptBytesProxy: routerScripts.reduce(
          (sum, script) => sum + Buffer.byteLength(script.textContent),
          0,
        ),
        degradedHome: root.querySelector("[data-home-loading]") !== null,
        cacheControl: response.headers.get("cache-control"),
        serverTiming: response.headers.get("server-timing"),
      }),
    );
  }
}
