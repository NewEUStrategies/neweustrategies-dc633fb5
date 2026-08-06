// BRAMKA WDROŻENIOWA: plik statyczny z `public/` nie może przesłaniać trasy.
//
// Finding, który to zamyka (2026-08-06): `public/robots.txt` (4 linie, `Allow: /`
// dla każdego hosta) był kopiowany do `.output/public/` i - jako asset warstwy
// hostingu - wygrywał z workerem. Cała trasa `src/routes/robots[.]txt.ts` była na
// produkcji nieosiągalna: aliasy hostingu były zaproszone do indeksowania, news
// sitemap nigdzie nie ogłoszona, polityka crawlerów AI martwa. Testy jednostkowe
// trasy przechodziły, bo testowały kod, którego nikt nie wykonywał.
//
// Bramka jest GENERYCZNA (nie „o robots.txt"): pilnuje każdej trasy, także tych,
// które powstaną później, i uruchamia się w tym samym kroku CI co kontrakty SEO.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  assetUrlPaths,
  declaredRoutes,
  describeShadowedRoutes,
  findShadowedRoutes,
  isCatchAllRoutePath,
  routeMatchesAssetPath,
  type DeclaredRoute,
  type StaticAsset,
} from "@/lib/ci/staticAssetShadowing";
import { MACHINE_SURFACES } from "@/lib/seo/machineSurfaces";

const PUBLIC_DIR = resolve(process.cwd(), "public");
const ROUTES_DIR = resolve(process.cwd(), "src/routes");

/** Wszystkie pliki katalogu, rekurencyjnie, jako ścieżki względne. */
function walk(dir: string, root: string = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, root));
    else if (entry.isFile()) out.push(relative(root, full));
  }
  return out;
}

function publicAssets(): StaticAsset[] {
  return walk(PUBLIC_DIR).flatMap((file) =>
    assetUrlPaths(file).map((path): StaticAsset => ({ path, file })),
  );
}

function appRoutes(): DeclaredRoute[] {
  return (
    walk(ROUTES_DIR)
      .filter((file) => /\.tsx?$/.test(file))
      // Pliki pomocnicze/testowe tras zaczynają się od "-" i nie są trasami.
      .filter((file) => !file.split(/[/\\]/).some((segment) => segment.startsWith("-")))
      .flatMap((file) => declaredRoutes(file, readFileSync(join(ROUTES_DIR, file), "utf8")))
  );
}

describe("assetUrlPaths", () => {
  it("maps a file to its served URL path", () => {
    expect(assetUrlPaths("robots.txt")).toEqual(["/robots.txt"]);
    expect(assetUrlPaths("geo/world-110m.v1.json")).toEqual(["/geo/world-110m.v1.json"]);
  });

  it("also claims the directory path for index.html (kills SSR of a whole page)", () => {
    expect(assetUrlPaths("index.html")).toEqual(["/index.html", "/"]);
    expect(assetUrlPaths("blog/index.html")).toEqual(["/blog/index.html", "/blog"]);
  });

  it("also claims the extensionless path of any other .html document", () => {
    // `html_handling: auto-trailing-slash` (domyślne w Workers Assets i w Vite):
    // `public/sitemap.html` odpowiada TAKŻE pod /sitemap, czyli przesłania trasę
    // HTML-owej mapy strony - adresu, którego w nazwie pliku nie widać.
    expect(assetUrlPaths("sitemap.html")).toEqual(["/sitemap.html", "/sitemap"]);
    expect(assetUrlPaths("docs/handbook.HTML")).toEqual(["/docs/handbook.HTML", "/docs/handbook"]);
  });

  it("catches an html asset shadowing an extensionless route", () => {
    const assets = assetUrlPaths("sitemap.html").map(
      (path): StaticAsset => ({ path, file: "sitemap.html" }),
    );
    const hits = findShadowedRoutes(assets, [{ path: "/sitemap", file: "sitemap.tsx" }]);
    expect(hits.map((hit) => hit.path)).toEqual(["/sitemap"]);
  });
});

describe("declaredRoutes", () => {
  it("reads the path out of createFileRoute, escapes included", () => {
    expect(declaredRoutes("robots[.]txt.ts", 'createFileRoute("/robots.txt")({})')).toEqual([
      { path: "/robots.txt", file: "robots[.]txt.ts" },
    ]);
    expect(declaredRoutes("gpc.ts", `createFileRoute('/.well-known/gpc.json')({})`)[0].path).toBe(
      "/.well-known/gpc.json",
    );
  });

  it("returns nothing for a module that declares no route", () => {
    expect(declaredRoutes("helper.ts", "export const x = 1;")).toEqual([]);
  });
});

describe("routeMatchesAssetPath", () => {
  it("matches an exact path", () => {
    expect(routeMatchesAssetPath("/robots.txt", "/robots.txt")).toBe(true);
    expect(routeMatchesAssetPath("/robots.txt", "/robots.txt.bak")).toBe(false);
  });

  it("matches a parametric segment (a static shard would win over the route)", () => {
    expect(routeMatchesAssetPath("/sitemaps/$section", "/sitemaps/core.xml")).toBe(true);
    expect(routeMatchesAssetPath("/sitemaps/$section", "/sitemaps/deep/core.xml")).toBe(false);
  });

  it("never counts a catch-all splat as shadowed - assets SHOULD beat the 404 route", () => {
    expect(isCatchAllRoutePath("/$")).toBe(true);
    expect(routeMatchesAssetPath("/$", "/favicon.ico")).toBe(false);
  });
});

describe("findShadowedRoutes", () => {
  const route: DeclaredRoute = { path: "/robots.txt", file: "robots[.]txt.ts" };

  it("reports the collision that this gate exists for", () => {
    const shadowed = findShadowedRoutes([{ path: "/robots.txt", file: "robots.txt" }], [route]);
    expect(shadowed).toHaveLength(1);
    expect(describeShadowedRoutes(shadowed)).toContain("public/robots.txt");
  });

  it("honours an explicit allowlist entry", () => {
    expect(
      findShadowedRoutes([{ path: "/robots.txt", file: "robots.txt" }], [route], ["/robots.txt"]),
    ).toEqual([]);
  });

  it("leaves unrelated assets alone", () => {
    expect(findShadowedRoutes([{ path: "/favicon.ico", file: "favicon.ico" }], [route])).toEqual(
      [],
    );
  });
});

describe("repository invariant", () => {
  it("has no static file in public/ shadowing an app route", () => {
    const shadowed = findShadowedRoutes(publicAssets(), appRoutes());
    expect(shadowed, describeShadowedRoutes(shadowed)).toEqual([]);
  });

  it("keeps every machine-readable surface served by its route", () => {
    // Powierzchnie crawlerowe (robots.txt, sitemapy, feedy, llms.txt) są
    // wymienione wprost: to one najbardziej wyglądają na „zwykły plik statyczny",
    // a ich przesłonięcie jest niewidoczne w testach jednostkowych.
    const assets = new Set(publicAssets().map((asset) => asset.path));
    for (const surface of MACHINE_SURFACES) {
      expect(assets.has(surface.path), `public/ przesłania ${surface.path}`).toBe(false);
    }
  });

  it("actually sees the routes it is guarding (the walk is not silently empty)", () => {
    const paths = appRoutes().map((route) => route.path);
    expect(paths).toContain("/robots.txt");
    expect(paths).toContain("/sitemap.xml");
    expect(paths.length).toBeGreaterThan(100);
  });
});
