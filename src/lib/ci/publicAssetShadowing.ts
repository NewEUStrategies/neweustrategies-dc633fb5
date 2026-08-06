// Czysta logika bramki: ŻADEN plik z `public/` nie może przesłonić trasy.
//
// PRZYCZYNA (audyt 2026-08-06): `public/robots.txt` - cztery linie zacommitowane
// "na chwilę" - trafiał do `.output/public/`, a wygenerowany `wrangler.json`
// wiąże ten katalog jako `assets`. Warstwa assetów Cloudflare odpowiada PRZED
// workerem, więc dynamiczna trasa `/robots.txt` (klasyfikacja hosta, polityka
// crawlerów AI, ogłoszenie news sitemap, `X-Robots-Tag`) nigdy nie wykonała się
// na produkcji: wyszukiwarki dostawały `Allow: /` dla KAŻDEGO hosta, łącznie z
// aliasami warstwy hostingu. Awaria była całkowicie niewidoczna - testy
// jednostkowe sprawdzały builder, e2e sprawdzał dev-server (gdzie assetów z
// `public/` nie ma przed routerem), a `llms.txt` uratował wyłącznie przypadek.
//
// Ta bramka zamyka klasę błędu, nie jeden plik: porównuje adresy, pod którymi
// warstwa assetów odpowie, z adresami tras aplikacji.

/** Rozszerzenia, dla których Cloudflare Assets serwuje też adres bez rozszerzenia. */
const HTML_EXTENSION = ".html";

export interface PublicAsset {
  /** Ścieżka pliku względem `public/` (separatory POSIX). */
  readonly file: string;
}

export interface ShadowedAsset {
  /** Plik z `public/`, który przesłania trasę. */
  readonly file: string;
  /** Adres, pod którym asset odpowie przed workerem. */
  readonly urlPath: string;
}

export interface ShadowingInput {
  /** Pliki z `public/` (ścieżki relatywne, POSIX). */
  readonly assetFiles: readonly string[];
  /** Pliki tras względem `src/routes` (POSIX) - druga, niezależna wyrocznia. */
  readonly routeFiles?: readonly string[];
  /** Zawartość `src/routeTree.gen.ts` - pełne ścieżki rozstrzygnięte przez router. */
  readonly generatedRouteTree?: string;
}

/**
 * Adresy, pod którymi warstwa assetów odpowie dla danego pliku.
 *
 * Poza adresem dosłownym liczy się `html_handling: auto-trailing-slash`
 * (domyślne dla Cloudflare Assets): `foo.html` odpowiada też pod `/foo`, a
 * `foo/index.html` pod `/foo` i `/foo/`. Bez tej reguły bramka przepuściłaby
 * `public/sitemap.html` przesłaniający trasę `/sitemap`.
 */
export function assetUrlPaths(file: string): string[] {
  const clean = file.replace(/^\/+/, "");
  const literal = `/${clean}`;
  if (!clean.toLowerCase().endsWith(HTML_EXTENSION)) return [literal];
  const withoutExt = literal.slice(0, -HTML_EXTENSION.length);
  if (withoutExt.endsWith("/index")) {
    const dir = withoutExt.slice(0, -"/index".length);
    return dir === "" ? [literal, "/"] : [literal, dir, `${dir}/`];
  }
  return [literal, withoutExt];
}

/**
 * Pełne ścieżki tras z wygenerowanego drzewa routera - wyrocznia rozstrzygająca
 * całą konwencję nazw (segmenty zagnieżdżone, `[.]`, layouty, aliasy).
 */
export function routePathsFromGeneratedTree(source: string): string[] {
  const block = source.match(/export interface FileRoutesByFullPath \{([\s\S]*?)\n\}/);
  if (!block) return [];
  return [...block[1].matchAll(/^\s*'([^']+)':/gm)].map((match) => match[1]);
}

/**
 * Ścieżka trasy wyprowadzona z NAZWY pliku - niezależnie od wygenerowanego
 * drzewa, żeby nieodświeżony `routeTree.gen.ts` nie ukrył nowej trasy.
 * `null` oznacza "to nie jest statyczny adres" (trasa dynamiczna, layout,
 * plik pomocniczy) - taki nie da się przesłonić plikiem o stałej nazwie.
 */
export function routePathFromRouteFile(file: string): string | null {
  if (!/\.(ts|tsx)$/.test(file)) return null;
  // Te same wykluczenia, co `routeFileIgnorePattern` generatora tras.
  if (/(^|\/)(__tests__|__snapshots__)\//.test(file)) return null;
  if (/\.(test|spec)\.(ts|tsx)$/.test(file)) return null;
  const withoutExt = file.replace(/\.(ts|tsx)$/, "");
  if (withoutExt === "") return null;

  const parts = withoutExt.split("/");
  const flatName = parts.pop() ?? "";
  const dirs = parts.map(unescapeSegment);

  // `[.]` chroni kropkę w NAZWIE adresu (robots[.]txt -> robots.txt); pozostałe
  // kropki rozdzielają segmenty trasy (live_.rss[.]xml -> /live/rss.xml).
  const ESCAPED_DOT = "\u0000";
  const flatSegments = flatName
    .replaceAll("[.]", ESCAPED_DOT)
    .split(".")
    .map((segment) => unescapeSegment(segment.replaceAll(ESCAPED_DOT, ".")));

  const segments: string[] = [];
  for (const raw of [...dirs, ...flatSegments]) {
    if (raw === "") continue;
    // Pliki pomocnicze i testowe (prefiks "-"), korzeń oraz trasy dynamiczne.
    if (raw.startsWith("-") || raw.startsWith("__") || raw.includes("$")) return null;
    // Layout bez własnego segmentu URL (`_layout`); sufiks `_` to tylko rezygnacja
    // z zagnieżdżenia w layoucie rodzica i segmentu nie zmienia.
    if (raw.startsWith("_")) continue;
    const segment = raw.replace(/_$/, "");
    if (segment === "" || segment === "route") continue;
    if (segment === "index") continue;
    segments.push(segment);
  }
  return `/${segments.join("/")}`;
}

/** Zdejmuje nawiasy escape'ujące literał (`[.well-known]` -> `.well-known`). */
function unescapeSegment(segment: string): string {
  return segment.startsWith("[") && segment.endsWith("]") ? segment.slice(1, -1) : segment;
}

/** Wszystkie statyczne adresy tras, z obu wyroczni. */
export function knownRoutePaths(input: ShadowingInput): Set<string> {
  const paths = new Set<string>();
  for (const path of routePathsFromGeneratedTree(input.generatedRouteTree ?? "")) {
    if (!path.includes("$")) paths.add(path);
  }
  for (const file of input.routeFiles ?? []) {
    const path = routePathFromRouteFile(file);
    if (path) paths.add(path);
  }
  return paths;
}

/**
 * Assety przesłaniające trasy. Wynik posortowany po adresie - komunikat bramki
 * musi być deterministyczny (diff w CI, nie losowa kolejność katalogu).
 */
export function findShadowedAssets(input: ShadowingInput): ShadowedAsset[] {
  const routes = knownRoutePaths(input);
  const hits: ShadowedAsset[] = [];
  for (const file of input.assetFiles) {
    for (const urlPath of assetUrlPaths(file)) {
      if (routes.has(urlPath)) hits.push({ file, urlPath });
    }
  }
  return hits.sort((a, b) => a.urlPath.localeCompare(b.urlPath) || a.file.localeCompare(b.file));
}

/** Komunikat bramki (ten sam w teście i w skrypcie CI). */
export function renderShadowingReport(hits: readonly ShadowedAsset[]): string {
  if (hits.length === 0) return "public/: brak plików przesłaniających trasy - OK.";
  return [
    `public/: ${hits.length} plik(ów) przesłania trasy aplikacji.`,
    "Warstwa assetów (wrangler `assets`) odpowiada PRZED workerem, więc trasa nigdy się nie wykona.",
    "Usuń plik z public/ albo dopisz jego adres do `assets.run_worker_first` w vite.config.ts.",
    ...hits.map((hit) => `  public/${hit.file}  ->  przesłania trasę ${hit.urlPath}`),
  ].join("\n");
}
