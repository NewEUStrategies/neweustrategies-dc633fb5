// Bramka anty-przesłonięcia: `public/` kontra trasy aplikacji.
//
// Test jest DWUCZĘŚCIOWY i to jest w nim istotne:
//   1. czysta logika (mapowanie plik -> adres, konwencja nazw tras, raport),
//   2. INWARIANT REPO na prawdziwym drzewie plików - dokładnie ten, którego brak
//      pozwolił `public/robots.txt` unieruchomić dynamiczną trasę /robots.txt na
//      produkcji (audyt 2026-08-06).
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  assetUrlPaths,
  findShadowedAssets,
  knownRoutePaths,
  renderShadowingReport,
  routePathFromRouteFile,
  routePathsFromGeneratedTree,
} from "@/lib/ci/publicAssetShadowing";

const PUBLIC_DIR = join(process.cwd(), "public");
const ROUTES_DIR = join(process.cwd(), "src/routes");
const ROUTE_TREE = join(process.cwd(), "src/routeTree.gen.ts");

function walk(dir: string, root: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, root, out);
    else out.push(relative(root, full).replaceAll("\\", "/"));
  }
  return out;
}

describe("assetUrlPaths", () => {
  it("maps a file to its literal URL", () => {
    expect(assetUrlPaths("robots.txt")).toEqual(["/robots.txt"]);
    expect(assetUrlPaths("geo/world-110m.v1.json")).toEqual(["/geo/world-110m.v1.json"]);
  });

  it("accounts for html_handling: .html also answers the extensionless URL", () => {
    // Domyślne `auto-trailing-slash` w Cloudflare Assets - bez tej reguły
    // public/sitemap.html przesłoniłby trasę /sitemap w pełnej ciszy.
    expect(assetUrlPaths("sitemap.html")).toEqual(["/sitemap.html", "/sitemap"]);
    expect(assetUrlPaths("blog/index.html")).toEqual(["/blog/index.html", "/blog", "/blog/"]);
    expect(assetUrlPaths("index.html")).toEqual(["/index.html", "/"]);
  });
});

describe("routePathFromRouteFile", () => {
  it("resolves the escaped-dot convention used by every machine surface", () => {
    expect(routePathFromRouteFile("robots[.]txt.ts")).toBe("/robots.txt");
    expect(routePathFromRouteFile("llms[.]txt.ts")).toBe("/llms.txt");
    expect(routePathFromRouteFile("news-sitemap[.]xml.ts")).toBe("/news-sitemap.xml");
    expect(routePathFromRouteFile("podcast.rss[.]xml.ts")).toBe("/podcast/rss.xml");
    // Sufiks `_` to rezygnacja z layoutu rodzica, nie segment adresu.
    expect(routePathFromRouteFile("live_.rss[.]xml.ts")).toBe("/live/rss.xml");
  });

  it("resolves nested directories and escaped literal segments", () => {
    expect(routePathFromRouteFile("[.well-known]/gpc[.]json.ts")).toBe("/.well-known/gpc.json");
    expect(routePathFromRouteFile("[.mcp]/list-tools.ts")).toBe("/.mcp/list-tools");
  });

  it("returns null for paths no fixed-name file can shadow", () => {
    expect(routePathFromRouteFile("sitemaps.$section.ts")).toBeNull();
    expect(routePathFromRouteFile("[.mcp]/invoke-tool/$tool.ts")).toBeNull();
    expect(routePathFromRouteFile("__root.tsx")).toBeNull();
    expect(routePathFromRouteFile("-sitemap.xml.test.ts")).toBeNull();
    expect(routePathFromRouteFile("__tests__/helper.ts")).toBeNull();
    expect(routePathFromRouteFile("README.md")).toBeNull();
  });

  it("collapses index routes onto their parent path", () => {
    expect(routePathFromRouteFile("index.tsx")).toBe("/");
    expect(routePathFromRouteFile("admin.crm.index.tsx")).toBe("/admin/crm");
  });
});

describe("routePathsFromGeneratedTree", () => {
  const source = [
    "export interface FileRoutesByFullPath {",
    "  '/': typeof IndexRoute",
    "  '/$': typeof SplatRoute",
    "  '/robots.txt': typeof RobotsDottxtRoute",
    "  '/.well-known/gpc.json': typeof GpcRoute",
    "}",
    "export interface FileRoutesByTo {",
    "  '/never-read': typeof Other",
    "}",
  ].join("\n");

  it("reads the full paths the router actually resolved", () => {
    expect(routePathsFromGeneratedTree(source)).toEqual([
      "/",
      "/$",
      "/robots.txt",
      "/.well-known/gpc.json",
    ]);
  });

  it("returns nothing when the generated tree is missing", () => {
    expect(routePathsFromGeneratedTree("")).toEqual([]);
  });

  it("drops parameterised paths from the shadowable set", () => {
    expect(knownRoutePaths({ assetFiles: [], generatedRouteTree: source })).not.toContain("/$");
  });
});

describe("findShadowedAssets", () => {
  const generatedRouteTree = [
    "export interface FileRoutesByFullPath {",
    "  '/robots.txt': typeof RobotsDottxtRoute",
    "  '/sitemap': typeof SitemapRoute",
    "}",
  ].join("\n");

  it("catches the exact regression: a static robots.txt over the dynamic route", () => {
    const hits = findShadowedAssets({
      assetFiles: ["favicon.ico", "robots.txt"],
      generatedRouteTree,
    });
    expect(hits).toEqual([{ file: "robots.txt", urlPath: "/robots.txt" }]);
    expect(renderShadowingReport(hits)).toContain("przesłania trasę /robots.txt");
  });

  it("catches an html asset shadowing an extensionless route", () => {
    const hits = findShadowedAssets({ assetFiles: ["sitemap.html"], generatedRouteTree });
    expect(hits.map((hit) => hit.urlPath)).toEqual(["/sitemap"]);
  });

  it("passes clean assets and reports success", () => {
    const hits = findShadowedAssets({
      assetFiles: ["favicon.ico", "og-default.jpg", "geo/world-110m.v1.json"],
      generatedRouteTree,
    });
    expect(hits).toEqual([]);
    expect(renderShadowingReport(hits)).toContain("OK");
  });

  it("sees a route the generated tree has not caught up with yet", () => {
    // Druga wyrocznia: nowa trasa dopisana bez regeneracji routeTree.gen.ts.
    const hits = findShadowedAssets({
      assetFiles: ["ads.txt"],
      routeFiles: ["ads[.]txt.ts"],
      generatedRouteTree: "",
    });
    expect(hits).toEqual([{ file: "ads.txt", urlPath: "/ads.txt" }]);
  });
});

describe("repository invariant", () => {
  it("has no file in public/ that shadows an application route", () => {
    const hits = findShadowedAssets({
      assetFiles: walk(PUBLIC_DIR, PUBLIC_DIR),
      routeFiles: walk(ROUTES_DIR, ROUTES_DIR),
      generatedRouteTree: readFileSync(ROUTE_TREE, "utf8"),
    });
    expect(hits, renderShadowingReport(hits)).toEqual([]);
  });

  it("keeps /robots.txt served by the route, never by a static file", () => {
    // Regresja imienna: dokładnie ten plik unieruchomił trasę na produkcji.
    const assets = walk(PUBLIC_DIR, PUBLIC_DIR);
    expect(assets).not.toContain("robots.txt");
    const routes = knownRoutePaths({
      assetFiles: [],
      routeFiles: walk(ROUTES_DIR, ROUTES_DIR),
      generatedRouteTree: readFileSync(ROUTE_TREE, "utf8"),
    });
    expect(routes.has("/robots.txt"), "trasa /robots.txt musi istnieć").toBe(true);
  });
});
