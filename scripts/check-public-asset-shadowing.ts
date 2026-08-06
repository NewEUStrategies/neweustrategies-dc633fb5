/**
 * Bramka CI: żaden plik z `public/` nie może przesłonić trasy aplikacji.
 *
 * Wdrożenie na Cloudflare wiąże `.output/public/` jako `assets`, a warstwa
 * assetów odpowiada PRZED workerem. Plik statyczny o adresie istniejącej trasy
 * wyłącza więc tę trasę na produkcji - bez żadnego błędu, bez logu i bez
 * czerwonego testu (dev-server serwuje trasę, więc e2e też tego nie łapie).
 *
 * Tak przez miesiące działało `public/robots.txt`: cztery statyczne linie
 * z `Allow: /` przesłaniały trasę, która klasyfikuje hosty, ustawia
 * `X-Robots-Tag` i ogłasza news sitemap (audyt 2026-08-06, MODUŁ 8).
 *
 * Logika jest czysta i otestowana w src/lib/ci/__tests__ - ten skrypt tylko
 * czyta drzewo plików i ustawia kod wyjścia.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { findShadowedAssets, renderShadowingReport } from "../src/lib/ci/publicAssetShadowing";

const PUBLIC_DIR = "public";
const ROUTES_DIR = join("src", "routes");
const ROUTE_TREE = join("src", "routeTree.gen.ts");

function walk(dir: string, root: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, root, out);
    else out.push(relative(root, full).replaceAll("\\", "/"));
  }
  return out;
}

function safeWalk(dir: string): string[] {
  try {
    return walk(dir, dir, []);
  } catch {
    return [];
  }
}

function safeRead(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

const hits = findShadowedAssets({
  assetFiles: safeWalk(PUBLIC_DIR),
  routeFiles: safeWalk(ROUTES_DIR),
  generatedRouteTree: safeRead(ROUTE_TREE),
});

if (hits.length > 0) {
  console.error(renderShadowingReport(hits));
  process.exit(1);
}
console.log(renderShadowingReport(hits));
