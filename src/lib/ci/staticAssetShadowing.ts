/**
 * Strażnik precedencji: plik statyczny z `public/` NIE MOŻE przesłaniać trasy.
 *
 * PROBLEM, KTÓRY TO ŁAPIE
 * Warstwa hostingu (Cloudflare Workers Assets) wiąże `.output/public/` jako
 * assety i - bez `run_worker_first` dla danej ścieżki - asset WYGRYWA z workerem.
 * Zacommitowany plik w `public/` czyni więc trasę serwerową o tej samej ścieżce
 * nieosiągalną na produkcji: kod istnieje, testy jednostkowe przechodzą, a
 * użytkownik i crawler dostają czterolinijkowy plik z repozytorium. Tak umarła
 * cała logika `src/routes/robots[.]txt.ts`: klasyfikacja hosta, zakaz dla aliasów
 * hostingu, polityka crawlerów AI i ogłoszenie news sitemap - w produkcji nie
 * działało NIC z tego, bo `public/robots.txt` mówił „Allow: /" każdemu hostowi.
 * Ten sam mechanizm dotyczy dev-servera Vite (statyka z `publicDir` idzie przed
 * SSR), więc regresja jest identyczna lokalnie i na produkcji.
 *
 * INWARIANT
 * Żadna ścieżka URL obsługiwana przez plik z `public/` nie może być zadeklarowana
 * jako trasa (poza jawną listą wyjątków `SHADOWING_ALLOWLIST`).
 *
 * i18n: brak treści dla użytkownika - narzędzie CI.
 */

/** Trasa zadeklarowana w `createFileRoute("…")`. */
export interface DeclaredRoute {
  /** Ścieżka URL, np. "/robots.txt" albo "/sitemaps/$section". */
  path: string;
  /** Plik trasy względem `src/routes` (do komunikatu błędu). */
  file: string;
}

/** Plik statyczny z `public/` wraz z adresem, pod którym go wystawiono. */
export interface StaticAsset {
  /** Ścieżka URL, np. "/robots.txt". */
  path: string;
  /** Plik względem `public/` (do komunikatu błędu). */
  file: string;
}

/** Kolizja: asset i trasa odpowiadają na ten sam adres - wygrywa asset. */
export interface ShadowedRoute {
  /** Adres, pod którym trasa jest nieosiągalna. */
  path: string;
  assetFile: string;
  routePath: string;
  routeFile: string;
}

/**
 * Ścieżki, dla których plik statyczny MA wygrywać z routerem. Wpis tutaj jest
 * świadomą decyzją wdrożeniową, nie obejściem bramki - pusta lista znaczy
 * „żadna trasa nie jest dziś celowo przesłonięta".
 */
export const SHADOWING_ALLOWLIST: readonly string[] = [];

const ROUTE_DECLARATION = /createFileRoute\(\s*["'`]([^"'`]+)["'`]/g;

/** Normalizuje ścieżkę URL: separatory POSIX, wiodący "/", bez końcowego "/". */
function normalizePath(path: string): string {
  const posix = path.replace(/\\/g, "/");
  const withLead = posix.startsWith("/") ? posix : `/${posix}`;
  return withLead.length > 1 ? withLead.replace(/\/+$/, "") : withLead;
}

/**
 * Ścieżki URL, pod którymi warstwa hostingu wystawi dany plik z `public/`.
 * `index.html` odpowiada TAKŻE pod adresem swojego katalogu (Workers Assets i
 * Vite obsługują go jako dokument katalogu) - to najgroźniejszy przypadek
 * przesłonięcia, bo zabija SSR całej strony, nie jednej końcówki.
 */
export function assetUrlPaths(file: string): string[] {
  const path = normalizePath(file);
  if (!path.endsWith("/index.html")) return [path];
  const dir = path.slice(0, -"/index.html".length);
  return [path, dir === "" ? "/" : dir];
}

/** Deklaracje tras znalezione w źródle pliku trasy (zwykle dokładnie jedna). */
export function declaredRoutes(file: string, source: string): DeclaredRoute[] {
  const out: DeclaredRoute[] = [];
  for (const match of source.matchAll(ROUTE_DECLARATION)) {
    out.push({ path: normalizePath(match[1]), file });
  }
  return out;
}

/**
 * Trasa typu catch-all (`/$`, `/blog/$`). Statyczny plik MA wygrywać ze splatem
 * - to jego jedyna sensowna rola (404 z routera nie może zjadać assetów) - więc
 * splat nigdy nie jest liczony jako przesłonięty.
 */
export function isCatchAllRoutePath(path: string): boolean {
  return path === "/$" || path.endsWith("/$");
}

/**
 * Czy trasa odpowiadałaby na adres assetu. Segment parametryczny (`$section`)
 * dopasowuje dokładnie jeden segment - statyczny `public/sitemaps/core.xml`
 * przesłania więc shard `/sitemaps/$section` i to też jest błąd.
 */
export function routeMatchesAssetPath(routePath: string, assetPath: string): boolean {
  if (isCatchAllRoutePath(routePath)) return false;
  const routeSegments = routePath.split("/");
  const assetSegments = assetPath.split("/");
  if (routeSegments.length !== assetSegments.length) return false;
  return routeSegments.every((segment, i) =>
    segment.startsWith("$") ? assetSegments[i].length > 0 : segment === assetSegments[i],
  );
}

/** Wszystkie kolizje asset ↔ trasa, z pominięciem jawnych wyjątków. */
export function findShadowedRoutes(
  assets: readonly StaticAsset[],
  routes: readonly DeclaredRoute[],
  allowlist: readonly string[] = SHADOWING_ALLOWLIST,
): ShadowedRoute[] {
  const allowed = new Set(allowlist.map(normalizePath));
  const out: ShadowedRoute[] = [];
  for (const asset of assets) {
    if (allowed.has(asset.path)) continue;
    for (const route of routes) {
      if (!routeMatchesAssetPath(route.path, asset.path)) continue;
      out.push({
        path: asset.path,
        assetFile: asset.file,
        routePath: route.path,
        routeFile: route.file,
      });
    }
  }
  return out;
}

/** Komunikat bramki - musi od razu mówić, co usunąć i dlaczego. */
export function describeShadowedRoutes(shadowed: readonly ShadowedRoute[]): string {
  return shadowed
    .map(
      (s) =>
        `${s.path}: public/${s.assetFile} przesłania trasę ${s.routePath} ` +
        `(src/routes/${s.routeFile}) - usuń plik statyczny albo dopisz ścieżkę do SHADOWING_ALLOWLIST`,
    )
    .join("\n");
}
