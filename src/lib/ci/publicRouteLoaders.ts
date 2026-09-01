/**
 * SPIS TRAS PUBLICZNYCH I ICH LOADERÓW - narzędzie pomiarowe, nie bramka.
 *
 * PO CO ISTNIEJE. Audyt SSR z 2026-09-01 zapisał ustalenie „59 tras publicznych
 * z SSR bez loadera" i nie podał metody, więc liczby nie dało się ani
 * potwierdzić, ani zaprzeczyć (rozdz. 6 raportu
 * `docs/WDROZENIE_SSR_HYDRATACJA_PIERWSZE_WCZYTANIE_2026-09-01.md`). Sam
 * `grep -L "loader:" src/routes/*.tsx` daje liczbę, która NIC NIE MÓWI, bo
 * w jednym worku trzyma trzy zupełnie różne stany:
 *
 *   1. `/cart`, `/checkout/cancel`, `/cookies`, `/error` - treść stoi w JSX,
 *      loader nie ma czego rozgrzewać (11 tras);
 *   2. `/messages`, `/profile/*`, `/people` - render jest za bramką sesji,
 *      a serwer sesji NIE MA (stan auth siedzi w localStorage - patrz komentarz
 *      przy `ssr: false` w `routes/admin.tsx`), więc loader nie zmieniłby ani
 *      bajtu SSR-owego HTML-a (27 tras);
 *   3. `/tracker/explorer`, `/events/$slug/speakers` - render czyta dane przez
 *      React Query, więc bez loadera serwer oddaje szkielet ładowania, który
 *      wchodzi do NES Edge Cache na do 24 h (24 trasy, klasa defektu z punktu 4
 *      zlecenia).
 *
 * Dopiero trzecia grupa jest defektem. Ten moduł liczy każdą z osobna.
 * ZMIERZONE 2026-09-01 (HEAD `1e3e1a4`): 368 tras w drzewie -> 82 publiczne
 * strony SSR -> 24 bez treści w SSR, z czego 19 wchodzi do cache dokumentów.
 *
 * ---
 *
 * KRYTERIA - każde z nich jest MIERZALNE ze źródeł, bez builda i bez runtime'u.
 *
 * TRASA. Bierzemy `src/routeTree.gen.ts` (generowany przez TanStack Router), a
 * nie listę plików z `readdir`. To jedyne miejsce, które zna prawdziwe
 * odwzorowanie plik -> URL: pliki z prefiksem `-` są wykluczone z drzewa,
 * `__tests__/` też, kropki w nazwie są separatorami segmentów, `[.]` jest
 * literalną kropką, a sufiks `_` zrywa zagnieżdżenie w rodzicu. Ręczna
 * rekonstrukcja tych reguł byłaby drugą, rozjeżdżającą się implementacją
 * generatora.
 *
 * PUBLICZNA = nie panel + nie za bramką sesji. Panel: cała gałąź `/admin`
 * (`routes/admin.tsx` przekierowuje każdego bez `isStaff` na `/login` i ma
 * `ssr: false`). Bramka sesji: trasa renderuje `<AuthGate>` albo nawiguje na
 * `/login` - i DZIEDZICZY się w dół drzewa tras, bo `/profile` opakowuje
 * wszystkie swoje dzieci jednym `<AuthGate>`. Wykrywanie jest tekstowe na
 * źródle bez komentarzy, więc opis bramki w komentarzu jej nie udaje.
 *
 * SSR. Trasa z `ssr: false` (własnym albo odziedziczonym) nie ma SSR-owego
 * HTML-a z definicji, więc nie może być „SSR bez loadera". Trasa bez
 * `component`/`Route` renderującego cokolwiek (czyste `server: { handlers }`,
 * np. `/rss.xml`, `/api/public/track`) nie oddaje HTML-a wcale.
 *
 * ŚCIEŻKA RENDERU. Domknięcie STATYCZNYCH importów z pliku trasy po `src/**`,
 * minus domknięcie POWŁOKI (`routes/__root.tsx`), minus pliki innych tras.
 *   - dlaczego tylko statyczne: `import()` za `React.lazy` renderuje na
 *     serwerze fallback, więc zapytania w leniwym module NIE są częścią
 *     SSR-owego HTML-a tej trasy;
 *   - dlaczego minus powłoka: `components/Footer.tsx:32` woła
 *     `useQuery(siteSettingsQueryOptions)`, a `Header`/menu/ticker tak samo -
 *     i wszystkie są rozgrzewane przez loader `__root.tsx` (FALA 1/FALA 2,
 *     budżet `CHROME_WARM_BUDGET_MS`). Powłoka to 279 modułów; bez ich odjęcia
 *     KAŻDA z 82 tras publicznych wyglądałaby na czytającą dane, więc spis nie
 *     rozróżniałby niczego.
 *
 * ZAPYTANIE = wywołanie czytającego hooka React Query: `useQuery`,
 * `useQueries`, `useSuspenseQuery`, `useSuspenseQueries`, `useInfiniteQuery`,
 * `useSuspenseInfiniteQuery`. `useMutation` i `useQueryClient` nie liczą się -
 * mutacja nie jest treścią pierwszego renderu.
 *
 * LOADER GRZEJE DANE = zapisuje je do CACHE ZAPYTAŃ, z którego czyta render.
 * To nie to samo co „loader coś ściąga": `/qa` i `/qa/$slug` mają loadery,
 * które wołają `fetchPublicQaSessions()` i oddają wynik jako `loaderData` dla
 * `head()` - klucz zapytania zostaje zimny, więc `useQuery` w komponencie
 * startuje w SSR od gałęzi ładowania i HTML nadal wychodzi bez listy. Stąd
 * werdykt „loader trywialny" dla tras, które loader mają. Rozpoznajemy grzanie
 * po wywołaniu w ciele loadera: `ensureQueryData`, `ensureInfiniteQueryData`,
 * `prefetchQuery`, `prefetchInfiniteQuery`, `fetchQuery`, `fetchInfiniteQuery`,
 * `setQueryData` albo `loadResilient` (fail-soft wrapper repo,
 * `lib/ssr/resilientLoad.ts`). Loader, który robi tylko `setCacheControlHeader`,
 * `redirect` albo `notFound`, w SSR nie dowozi ani jednego wiersza treści.
 *
 * ---
 *
 * CZEGO TEN SPIS NIE WIE - i nie udaje, że wie.
 *
 * (a) Analiza jest STATYCZNA. Zapytanie, które w prawdziwym renderze siedzi za
 *     warunkiem (`{open && <Dialog/>}`, gałąź `if (!data) return …`), liczy się
 *     tak samo jak zapytanie w głównej treści. Kierunek błędu jest więc znany:
 *     grupa „SSR bez treści" jest GÓRNYM oszacowaniem.
 *     ZNANY FAŁSZYWY POZYTYW, sprawdzony ręcznie: `/quiz`. Jej treść to
 *     statyczny iframe (`components/quiz/LazyQuizIframe`), a wszystkie 12
 *     zapytań na jej ścieżce renderu przychodzą z nagłówka czytania
 *     (`components/share/ReadingHeader` -> `NotificationsBell`,
 *     `useHeaderProfile`) i z atomu `components/atoms/BrandIcon.tsx:25`.
 *     Zostaje w spisie, bo dowód przy każdej trasie (plik:linia + hop) pozwala
 *     ten przypadek rozpoznać, a ręczna lista wyjątków rozjechałaby się z kodem.
 * (b) Nie sprawdza, czy loader rozgrzewa TE SAME klucze, które czyta render.
 *     Loader grzejący wyłącznie `staticPageSeoQueryOptions` (6 stron
 *     dokumentowych: `/contribute`, `/cookies`, `/polityka-prywatnosci`,
 *     `/regulamin`, `/zatrudniamy`, `/zwroty-i-reklamacje`) liczy się jako
 *     grzejący - i słusznie, bo treść tych stron stoi w JSX, a z bazy schodzi
 *     tylko override SEO.
 * (c) Nie ocenia, czy brak treści w SSR jest KOSZTOWNY. Trasę `noindex` i trasę
 *     spod deny-listy NES Edge Cache raportuje osobno (runner).
 * (d) Jeden URL może wystąpić DWA RAZY: układ (`club.tsx`) i jego dziecko
 *     `index` (`club.index.tsx`) mają tę samą pełną ścieżkę `/club`. To nie
 *     pomyłka - to dwa różne pliki z osobnymi opcjami trasy, więc każdy dostaje
 *     własny werdykt, a raport rozróżnia je kolumną z plikiem.
 *
 * Moduł jest CZYSTY (bez I/O) - pliki wczytuje runner
 * `scripts/report-public-route-loaders.ts` i test w `__tests__`.
 */
import { stripTsComments } from "../../../scripts/lib/stripComments";

/** Wejście: wygenerowane drzewo tras + całe `src/**` jako mapa ścieżka -> treść. */
export interface PublicRouteLoaderInput {
  /** Zawartość `src/routeTree.gen.ts`. */
  readonly routeTree: string;
  /** Ścieżki POSIX względem korzenia repo (`src/routes/index.tsx`) -> treść. */
  readonly sources: ReadonlyMap<string, string>;
}

/** Powód, dla którego trasa NIE jest publiczną stroną SSR - albo brak powodu. */
export type RouteExclusion =
  "panel-admin" | "bramka-sesji" | "ssr-wylaczony" | "bez-komponentu" | "brak-pliku";

/** Werdykt dla trasy publicznej z SSR. */
export type LoaderVerdict =
  /** Render nie czyta danych - loader nie ma czego rozgrzewać. */
  | "bez-zapytan"
  /** Render czyta dane, loader je rozgrzewa. */
  | "loader-grzeje"
  /** Render czyta dane, loader istnieje, ale nic nie grzeje. */
  | "loader-trywialny"
  /** Render czyta dane, loadera nie ma - SSR oddaje szkielet. */
  | "brak-loadera";

/** Miejsce wywołania czytającego hooka - dowód, który da się sprawdzić w edytorze. */
export interface QuerySite {
  readonly file: string;
  readonly line: number;
  readonly hook: string;
  /** Odległość modułu od pliku trasy w grafie statycznych importów (0 = sam plik trasy). */
  readonly distance: number;
}

/** Moduł z zapytaniem + w ilu trasach publicznych stoi na ścieżce renderu. */
export interface QueryModuleStat {
  readonly module: string;
  readonly routeCount: number;
  readonly querySiteCount: number;
}

export interface RouteFacts {
  /** URL trasy złożony z segmentów rodziców (`/events/$slug/speakers`). */
  readonly fullPath: string;
  /** Plik źródłowy trasy względem korzenia repo. */
  readonly file: string;
  /** `null` = trasa jest publiczną stroną SSR i ma werdykt. */
  readonly exclusion: RouteExclusion | null;
  /** Trasa, od której odziedziczono wykluczenie (dla `/profile/*` to `/profile`). */
  readonly exclusionFrom: string | null;
  readonly verdict: LoaderVerdict | null;
  readonly hasLoader: boolean;
  readonly loaderWarms: boolean;
  /** `<meta name="robots" content="noindex">` w `head()` trasy. */
  readonly noindex: boolean;
  /** Ile modułów wchodzi do ścieżki renderu po odjęciu powłoki. */
  readonly renderModuleCount: number;
  /** Liczba wywołań czytającego hooka na ścieżce renderu (po odjęciu powłoki). */
  readonly queryCount: number;
  /** Czy dane czyta SAM PLIK TRASY (hop 0) - fakt, nie heurystyka. */
  readonly queriesInRouteFile: boolean;
  /** Do trzech NAJBLIŻSZYCH wywołań (sort po odległości) - dowód dla werdyktu. */
  readonly querySites: readonly QuerySite[];
}

export interface PublicRouteLoaderReport {
  /** Wszystkie trasy z `routeTree.gen.ts`, w kolejności alfabetycznej po URL-u. */
  readonly routes: readonly RouteFacts[];
  /** Liczba modułów w domknięciu powłoki (`__root.tsx`) - odjęta od każdej trasy. */
  readonly shellModuleCount: number;
  /** Moduły z zapytaniem o największym zasięgu - diagnostyka metody, nie defekty. */
  readonly topQueryModules: readonly QueryModuleStat[];
  /** Ile modułów na ścieżkach renderu tras publicznych zawiera zapytanie. */
  readonly queryModuleCount: number;
}

// --- parser drzewa tras -----------------------------------------------------

const IMPORT_RE = /import\s*\{\s*Route as (\w+)\s*\}\s*from\s*'\.\/([^']+)'/g;
// `=\s*` jest wymagane: prettier łamie długie deklaracje po znaku równości
// (79 z 368 wpisów, np. `Char91DotwellKnownChar93…`), a regex bez `\s*`
// przeoczał je w milczeniu - spis pokazywał 289 tras zamiast 368.
const DECL_RE =
  /const (\w+) =\s*(\w+)\.update\(\{\s*id: '([^']*)',\s*path: '([^']*)',\s*getParentRoute: \(\) => (\w+),/g;
const ROUTE_DIR = "src/";
/** Rozszerzenia, w których generator szuka pliku trasy. */
const MODULE_SUFFIXES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"] as const;

interface RawNode {
  readonly ident: string;
  readonly importIdent: string;
  readonly path: string;
  readonly parent: string;
}

function resolveInSources(base: string, sources: ReadonlyMap<string, string>): string | null {
  for (const suffix of MODULE_SUFFIXES) {
    const candidate = `${base}${suffix}`;
    if (sources.has(candidate)) return candidate;
  }
  return null;
}

function joinRoutePath(parent: string, own: string): string {
  if (own === "/") return parent === "" ? "/" : parent;
  const merged = `${parent}${own.startsWith("/") ? own : `/${own}`}`.replace(/\/{2,}/g, "/");
  return merged === "" ? "/" : merged;
}

// --- skanery źródła ---------------------------------------------------------

/**
 * Statyczne krawędzie importu. Dynamiczne `import()` są POMINIĘTE celowo:
 * moduł za `React.lazy` renderuje na serwerze fallback, więc jego zapytania nie
 * są częścią SSR-owego HTML-a. `import type`/`export type` są wymazywane przez
 * kompilator, więc nie tworzą krawędzi runtime'u.
 */
export function staticImportSpecifiers(source: string): string[] {
  const clean = stripTsComments(source);
  const out = new Set<string>();
  const withFrom = /^[ \t]*(?:import|export)\s+([\s\S]*?)\s*from\s*["']([^"']+)["']/gm;
  for (const match of clean.matchAll(withFrom)) {
    const clause = match[1];
    // `import type { X } from` i `export type { X } from` nie istnieją w runtime.
    if (/^type\s/.test(clause)) continue;
    out.add(match[2]);
  }
  const sideEffect = /^[ \t]*import\s*["']([^"']+)["']/gm;
  for (const match of clean.matchAll(sideEffect)) out.add(match[1]);
  return [...out];
}

/** Zamienia specyfikator na ścieżkę w `src/**` albo `null` (pakiet, asset, brak). */
export function resolveSpecifier(
  specifier: string,
  fromFile: string,
  sources: ReadonlyMap<string, string>,
): string | null {
  const bare = specifier.split("?")[0];
  if (/\.(css|svg|png|jpe?g|webp|avif|woff2?|json|txt|md|wasm)$/i.test(bare)) return null;

  let base: string;
  if (bare.startsWith("@/")) {
    base = `${ROUTE_DIR}${bare.slice(2)}`;
  } else if (bare.startsWith("./") || bare.startsWith("../")) {
    const dir = fromFile.slice(0, fromFile.lastIndexOf("/"));
    const parts = `${dir}/${bare}`.split("/");
    const stack: string[] = [];
    for (const part of parts) {
      if (part === "." || part === "") continue;
      if (part === "..") stack.pop();
      else stack.push(part);
    }
    base = stack.join("/");
  } else {
    return null; // pakiet z node_modules albo alias, którego nie obsługujemy
  }
  return resolveInSources(base, sources);
}

/**
 * Domknięcie statycznych importów po `src/**` z ODLEGŁOŚCIĄ od pliku startowego
 * (BFS). Odległość służy do sortowania dowodów: przy trasie
 * `/events/$slug/agenda` interesuje nas zapytanie z komponentu agendy
 * (odległość 1-2), a nie z `BrandIcon` (atom obecny na każdej stronie).
 * Plik startowy ma odległość 0.
 */
export function staticImportClosure(
  entry: string,
  sources: ReadonlyMap<string, string>,
): Map<string, number> {
  const depth = new Map<string, number>([[entry, 0]]);
  let frontier = [entry];
  let distance = 0;
  while (frontier.length > 0) {
    distance += 1;
    const next: string[] = [];
    for (const file of frontier) {
      const source = sources.get(file);
      if (source === undefined) continue;
      for (const specifier of staticImportSpecifiers(source)) {
        const resolved = resolveSpecifier(specifier, file, sources);
        if (resolved === null || depth.has(resolved)) continue;
        depth.set(resolved, distance);
        next.push(resolved);
      }
    }
    frontier = next;
  }
  return depth;
}

/**
 * Czytające hooki React Query. `useQueryClient(` i `useMutation(` nie pasują -
 * pierwszy nie czyta, drugi nie jest treścią pierwszego renderu.
 */
const QUERY_HOOK_RE = /\buse(?:Suspense)?(?:Infinite)?(Query|Queries)\s*\(/g;

export function findQuerySites(file: string, source: string, distance = 0): QuerySite[] {
  const clean = stripTsComments(source);
  const out: QuerySite[] = [];
  const lines = clean.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    for (const match of lines[i].matchAll(QUERY_HOOK_RE)) {
      out.push({ file, line: i + 1, hook: match[0].replace(/\s*\($/, ""), distance });
    }
  }
  return out;
}

/** Wywołania, po których poznajemy, że loader ROZGRZEWA cache zapytań. */
const WARMING_CALLS = [
  "ensureQueryData",
  "ensureInfiniteQueryData",
  "prefetchQuery",
  "prefetchInfiniteQuery",
  "fetchQuery",
  "fetchInfiniteQuery",
  "setQueryData",
  "loadResilient",
] as const;

/**
 * Obiekt opcji z `createFileRoute("/x")({ … })` - z dopasowaniem nawiasów.
 *
 * DLACZEGO NIE REGEX PO WCIĘCIU. Pierwsza wersja szukała opcji wzorcem
 * `/^\s{2}component:/m` i przeoczyła 11 plików tras, w których prettier
 * zmieścił całą definicję w jednej linii (`createFileRoute("/events")({
 * component: EventsLayout })`). Skutek był cichy i dokładnie odwrotny do
 * zamierzonego: `/events` i dziesięć innych układów trafiało do kubełka
 * „bez komponentu", czyli wypadało ze spisu tras publicznych.
 */
export function routeOptionsBlock(source: string): string | null {
  const clean = stripTsComments(source);
  // Kotwicą jest WYWOŁANIE `createFileRoute("/x")({`, nie samo słowo: pierwsze
  // wystąpienie identyfikatora w pliku to jego IMPORT, a pierwsza klamra po
  // nim otwiera następny import - stąd pusty blok i 143 tras „bez komponentu"
  // w wersji, która szukała `indexOf("createFileRoute")`.
  const call = /createFileRoute\s*\([^)]*\)\s*\(\s*\{/.exec(clean);
  if (call === null) return null;
  const open = call.index + call[0].length - 1;
  let depth = 0;
  for (let i = open; i < clean.length; i += 1) {
    const ch = clean[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return clean.slice(open + 1, i);
    }
  }
  return null;
}

/**
 * Wartość opcji `name:` z NAJWYŻSZEGO poziomu obiektu opcji trasy. Poziom jest
 * istotny: `ensureQueryData` w `beforeLoad` albo w komponencie NIE jest
 * loaderem, a `component:` w zagnieżdżonej konfiguracji widgetu nie jest
 * komponentem trasy.
 */
export function topLevelOption(block: string, name: string): string | null {
  const pattern = new RegExp(`(^|[\\s,;])${name}\\s*:`, "g");
  for (const match of block.matchAll(pattern)) {
    const at = (match.index ?? 0) + match[0].length;
    let depth = 0;
    let inside = false;
    for (let i = 0; i < at; i += 1) {
      const ch = block[i];
      if (ch === "{" || ch === "(" || ch === "[") depth += 1;
      else if (ch === "}" || ch === ")" || ch === "]") depth -= 1;
    }
    if (depth !== 0) continue; // opcja z zagnieżdżonego obiektu - nie nasza
    let value = "";
    depth = 0;
    for (let i = at; i < block.length; i += 1) {
      const ch = block[i];
      if (ch === "{" || ch === "(" || ch === "[") depth += 1;
      else if (ch === "}" || ch === ")" || ch === "]") {
        if (depth === 0) break;
        depth -= 1;
      } else if (ch === "," && depth === 0) break;
      value += ch;
      inside = true;
    }
    if (inside) return value;
  }
  return null;
}

export interface LoaderFacts {
  readonly hasLoader: boolean;
  readonly warms: boolean;
}

export function readLoaderFacts(source: string): LoaderFacts {
  const block = routeOptionsBlock(source);
  if (block === null) return { hasLoader: false, warms: false };
  const body = topLevelOption(block, "loader");
  if (body === null) return { hasLoader: false, warms: false };
  return { hasLoader: true, warms: WARMING_CALLS.some((call) => body.includes(call)) };
}

/** `ssr: false` na definicji trasy - trasa nie ma SSR-owego HTML-a. */
export function hasSsrDisabled(source: string): boolean {
  const block = routeOptionsBlock(source);
  if (block === null) return false;
  return topLevelOption(block, "ssr")?.trim() === "false";
}

/**
 * Bramka sesji na poziomie trasy: render zwraca CTA logowania (`<AuthGate>`)
 * albo nawiguje na `/login`. Serwer nie ma sesji, więc taka trasa oddaje w SSR
 * zaproszenie do logowania niezależnie od tego, czy ma loader.
 */
export function hasSessionGate(source: string): boolean {
  const clean = stripTsComments(source);
  return /<AuthGate[\s/>]/.test(clean) || /(navigate|redirect)\(\{\s*to:\s*"\/login"/.test(clean);
}

/** Czy trasa oddaje HTML - ma `component` albo komponent brzegowy. */
export function rendersHtml(source: string): boolean {
  const block = routeOptionsBlock(source);
  if (block === null) return false;
  return (
    topLevelOption(block, "component") !== null ||
    topLevelOption(block, "notFoundComponent") !== null ||
    topLevelOption(block, "errorComponent") !== null
  );
}

export function hasNoindex(source: string): boolean {
  return /noindex/.test(stripTsComments(source));
}

// --- złożenie raportu -------------------------------------------------------

const MAX_QUERY_EVIDENCE = 3;
const SHELL_ENTRY = "src/routes/__root.tsx";
const ADMIN_PATH_PREFIX = "/admin";
const TOP_QUERY_MODULES = 15;

/** Kandydat na trasę publiczną z SSR - wynik pierwszego przebiegu. */
interface Candidate {
  readonly ident: string;
  readonly path: string;
  readonly file: string;
  readonly source: string;
  readonly loader: LoaderFacts;
  readonly noindex: boolean;
  /** Moduł -> odległość od pliku trasy, po odjęciu powłoki i tras rodzeństwa. */
  readonly renderModules: ReadonlyMap<string, number>;
}

function verdictFor(queryCount: number, loader: LoaderFacts): LoaderVerdict {
  if (queryCount === 0) return "bez-zapytan";
  if (loader.warms) return "loader-grzeje";
  return loader.hasLoader ? "loader-trywialny" : "brak-loadera";
}

export function analysePublicRouteLoaders(input: PublicRouteLoaderInput): PublicRouteLoaderReport {
  const { routeTree, sources } = input;

  const fileByImportIdent = new Map<string, string>();
  for (const match of routeTree.matchAll(IMPORT_RE)) {
    const resolved = resolveInSources(`${ROUTE_DIR}${match[2]}`, sources);
    if (resolved !== null) fileByImportIdent.set(match[1], resolved);
  }

  const nodes = new Map<string, RawNode>();
  for (const match of routeTree.matchAll(DECL_RE)) {
    nodes.set(match[1], {
      ident: match[1],
      importIdent: match[2],
      path: match[4],
      parent: match[5].replace(/WithChildren$/, ""),
    });
  }

  // Domknięcie powłoki: wszystko, co render KAŻDEJ trasy dostaje z `__root.tsx`
  // (chrome, dostawcy, style motywu) i co rozgrzewa loader korzenia.
  const shell = staticImportClosure(SHELL_ENTRY, sources);
  const routeFiles = new Set([...fileByImportIdent.values(), SHELL_ENTRY]);

  const fullPathOf = new Map<string, string>();
  function fullPath(ident: string): string {
    const cached = fullPathOf.get(ident);
    if (cached !== undefined) return cached;
    const node = nodes.get(ident);
    if (node === undefined) return "";
    // Cykl w drzewie tras jest niemożliwy (generator), ale wpis-znacznik chroni
    // przed nieskończoną rekurencją na uszkodzonym pliku.
    fullPathOf.set(ident, node.path);
    const value = joinRoutePath(fullPath(node.parent), node.path);
    fullPathOf.set(ident, value);
    return value;
  }

  // Dziedziczenie po drzewie tras: `ssr: false` i bramka sesji na rodzicu
  // obowiązują wszystkie dzieci (`/profile` opakowuje je jednym `<AuthGate>`).
  const ownGate = new Map<string, boolean>();
  const ownSsrOff = new Map<string, boolean>();
  for (const node of nodes.values()) {
    const file = fileByImportIdent.get(node.importIdent);
    const source = file === undefined ? undefined : sources.get(file);
    ownGate.set(node.ident, source !== undefined && hasSessionGate(source));
    ownSsrOff.set(node.ident, source !== undefined && hasSsrDisabled(source));
  }
  function inheritedFrom(ident: string, flags: Map<string, boolean>): string | null {
    let cursor: string | undefined = ident;
    while (cursor !== undefined && nodes.has(cursor)) {
      if (flags.get(cursor) === true) return cursor;
      cursor = nodes.get(cursor)?.parent;
    }
    return null;
  }

  // --- PRZEBIEG 1: wyklucz, co nie jest publiczną stroną SSR ---------------
  const excluded: RouteFacts[] = [];
  const candidates: Candidate[] = [];

  for (const node of nodes.values()) {
    const path = fullPath(node.ident);
    const file = fileByImportIdent.get(node.importIdent) ?? null;
    const source = file === null ? null : (sources.get(file) ?? null);
    const base = {
      fullPath: path,
      file: file ?? "(nierozwiązany import)",
      noindex: source !== null && hasNoindex(source),
      hasLoader: false,
      loaderWarms: false,
      renderModuleCount: 0,
      queryCount: 0,
      queriesInRouteFile: false,
      querySites: [] as readonly QuerySite[],
      verdict: null,
    };

    if (file === null || source === null) {
      excluded.push({ ...base, exclusion: "brak-pliku", exclusionFrom: null });
      continue;
    }
    const loader = readLoaderFacts(source);
    const withLoader = { ...base, hasLoader: loader.hasLoader, loaderWarms: loader.warms };

    if (path === ADMIN_PATH_PREFIX || path.startsWith(`${ADMIN_PATH_PREFIX}/`)) {
      excluded.push({ ...withLoader, exclusion: "panel-admin", exclusionFrom: null });
      continue;
    }
    const ssrOffAt = inheritedFrom(node.ident, ownSsrOff);
    if (ssrOffAt !== null) {
      excluded.push({
        ...withLoader,
        exclusion: "ssr-wylaczony",
        exclusionFrom: ssrOffAt === node.ident ? null : fullPath(ssrOffAt),
      });
      continue;
    }
    const gateAt = inheritedFrom(node.ident, ownGate);
    if (gateAt !== null) {
      excluded.push({
        ...withLoader,
        exclusion: "bramka-sesji",
        exclusionFrom: gateAt === node.ident ? null : fullPath(gateAt),
      });
      continue;
    }
    if (!rendersHtml(source)) {
      excluded.push({ ...withLoader, exclusion: "bez-komponentu", exclusionFrom: null });
      continue;
    }

    // Ścieżka renderu tej trasy: domknięcie statyczne minus powłoka minus
    // pliki innych tras (trasa nie odpowiada za zapytania rodzeństwa).
    const closure = staticImportClosure(file, sources);
    const renderModules = new Map<string, number>();
    for (const [module, distance] of closure) {
      if (module === file || (!shell.has(module) && !routeFiles.has(module))) {
        renderModules.set(module, distance);
      }
    }
    candidates.push({
      ident: node.ident,
      path,
      file,
      source,
      loader,
      noindex: withLoader.noindex,
      renderModules,
    });
  }

  // --- PRZEBIEG 2: zasięg modułów z zapytaniem ------------------------------
  //
  // Liczony RAZ na moduł (nie raz na trasę): 81 tras publicznych ma po ~26
  // modułów mediany ścieżki renderu, więc bez tej mapy skanowalibyśmy te same
  // pliki kilkadziesiąt razy. Zasięg jest jednocześnie diagnostyką metody:
  // moduł stojący na ścieżce renderu wielu tras to wspólny element strony,
  // a jego naprawa to JEDNA rozgrzewka, nie loader w każdej z tych tras.
  const sitesByModule = new Map<string, readonly QuerySite[]>();
  const routeCountByModule = new Map<string, number>();
  for (const candidate of candidates) {
    for (const module of candidate.renderModules.keys()) {
      let sites = sitesByModule.get(module);
      if (sites === undefined) {
        const source = sources.get(module);
        sites = source === undefined ? [] : findQuerySites(module, source);
        sitesByModule.set(module, sites);
      }
      if (sites.length === 0) continue;
      routeCountByModule.set(module, (routeCountByModule.get(module) ?? 0) + 1);
    }
  }

  const stats: QueryModuleStat[] = [...routeCountByModule]
    .map(([module, routeCount]) => ({
      module,
      routeCount,
      querySiteCount: sitesByModule.get(module)?.length ?? 0,
    }))
    .sort((a, b) => b.routeCount - a.routeCount || a.module.localeCompare(b.module));

  // --- PRZEBIEG 3: werdykty -------------------------------------------------
  const classified: RouteFacts[] = candidates.map((candidate) => {
    const sites: QuerySite[] = [];
    for (const [module, distance] of candidate.renderModules) {
      for (const site of sitesByModule.get(module) ?? []) sites.push({ ...site, distance });
    }
    // Sort po ODLEGŁOŚCI: przy `/events/$slug/agenda` dowodem ma być komponent
    // agendy (hop 1), a nie `BrandIcon` (hop 1, ale wspólny atom) ani pierwszy
    // moduł alfabetycznie - poprzednia wersja sortowała po nazwie pliku i dowód
    // dla każdej trasy zaczynał się od `components/atoms/BrandIcon.tsx`.
    sites.sort(
      (a, b) => a.distance - b.distance || a.file.localeCompare(b.file) || a.line - b.line,
    );

    return {
      fullPath: candidate.path,
      file: candidate.file,
      exclusion: null,
      exclusionFrom: null,
      verdict: verdictFor(sites.length, candidate.loader),
      hasLoader: candidate.loader.hasLoader,
      loaderWarms: candidate.loader.warms,
      noindex: candidate.noindex,
      renderModuleCount: candidate.renderModules.size,
      queryCount: sites.length,
      queriesInRouteFile: sites.some((site) => site.distance === 0),
      querySites: sites.slice(0, MAX_QUERY_EVIDENCE),
    };
  });

  const routes = [...excluded, ...classified].sort((a, b) => a.fullPath.localeCompare(b.fullPath));
  return {
    routes,
    shellModuleCount: shell.size,
    topQueryModules: stats.slice(0, TOP_QUERY_MODULES),
    queryModuleCount: stats.length,
  };
}

// --- render raportu ---------------------------------------------------------

const EXCLUSION_LABEL: Record<RouteExclusion, string> = {
  "panel-admin": "panel /admin (ssr: false + redirect bez isStaff)",
  "bramka-sesji": "za bramką sesji (serwer nie ma sesji, SSR oddaje CTA logowania)",
  "ssr-wylaczony": "ssr: false (brak SSR-owego HTML-a)",
  "bez-komponentu": "bez komponentu (server: { handlers } - nie oddaje HTML-a)",
  "brak-pliku": "nierozwiązany plik trasy",
};

const VERDICT_LABEL: Record<LoaderVerdict, string> = {
  "bez-zapytan": "LOADER ZBĘDNY - render nie czyta danych",
  "loader-grzeje": "OK - render czyta dane, loader je rozgrzewa",
  "loader-trywialny": "SSR BEZ TREŚCI - loader jest, ale nic nie grzeje",
  "brak-loadera": "SSR BEZ TREŚCI - render czyta dane, loadera nie ma",
};

const VERDICT_ORDER: readonly LoaderVerdict[] = [
  "brak-loadera",
  "loader-trywialny",
  "loader-grzeje",
  "bez-zapytan",
];

const EXCLUSION_ORDER: readonly RouteExclusion[] = [
  "bramka-sesji",
  "ssr-wylaczony",
  "bez-komponentu",
  "panel-admin",
  "brak-pliku",
];

/** Trasy, które NAPRAWDĘ potrzebują loadera i go nie mają (lista do roboty). */
export function routesMissingWarmedLoader(report: PublicRouteLoaderReport): readonly RouteFacts[] {
  return report.routes.filter(
    (route) => route.verdict === "brak-loadera" || route.verdict === "loader-trywialny",
  );
}

function pad(value: number, width: number): string {
  return String(value).padStart(width);
}

export function renderPublicRouteLoaderReport(report: PublicRouteLoaderReport): string {
  const lines: string[] = [];
  const publicSsr = report.routes.filter((route) => route.exclusion === null);

  lines.push("SPIS TRAS PUBLICZNYCH I ICH LOADERÓW (źródła, bez builda)");
  lines.push("");
  lines.push(`  tras w routeTree.gen.ts            ${pad(report.routes.length, 5)}`);
  for (const exclusion of EXCLUSION_ORDER) {
    const count = report.routes.filter((route) => route.exclusion === exclusion).length;
    if (count === 0) continue;
    lines.push(`  - ${EXCLUSION_LABEL[exclusion].padEnd(62)} ${pad(count, 5)}`);
  }
  lines.push(`  = PUBLICZNE STRONY SSR              ${pad(publicSsr.length, 5)}`);
  lines.push("");
  lines.push(
    `  domknięcie powłoki (__root.tsx): ${report.shellModuleCount} modułów - odjęte od ścieżki renderu każdej trasy`,
  );
  lines.push(
    `  modułów z zapytaniem na ścieżkach renderu tras publicznych: ${report.queryModuleCount}`,
  );
  lines.push("");

  for (const verdict of VERDICT_ORDER) {
    const rows = publicSsr.filter((route) => route.verdict === verdict);
    lines.push(`  ${VERDICT_LABEL[verdict].padEnd(62)} ${pad(rows.length, 5)}`);
  }
  lines.push("");

  for (const verdict of VERDICT_ORDER) {
    const rows = publicSsr.filter((route) => route.verdict === verdict);
    if (rows.length === 0) continue;
    lines.push("-".repeat(78));
    lines.push(`${VERDICT_LABEL[verdict]}  (${rows.length})`);
    lines.push("");
    for (const route of rows) {
      const flags: string[] = [];
      if (route.noindex) flags.push("noindex");
      if (route.hasLoader && !route.loaderWarms) flags.push("loader nic nie grzeje");
      const suffix = flags.length > 0 ? `  [${flags.join(", ")}]` : "";
      lines.push(`  ${route.fullPath.padEnd(44)} ${route.file}${suffix}`);
      if (verdict === "brak-loadera" || verdict === "loader-trywialny") {
        for (const site of route.querySites) {
          lines.push(`      ${site.hook} <- ${site.file}:${site.line} (hop ${site.distance})`);
        }
        if (route.queryCount > route.querySites.length) {
          lines.push(`      … i ${route.queryCount - route.querySites.length} dalszych wywołań`);
        }
      }
    }
    lines.push("");
  }

  lines.push("-".repeat(78));
  lines.push(
    `MODUŁY Z ZAPYTANIEM O NAJWIĘKSZYM ZASIĘGU (top ${report.topQueryModules.length} ` +
      `z ${report.queryModuleCount}) - DIAGNOSTYKA METODY, NIE LISTA DEFEKTÓW.`,
  );
  lines.push(
    "Moduł stojący na ścieżce renderu wielu tras to wspólny element strony (ikony, cenniki,",
  );
  lines.push(
    "ustawienia newslettera), a nie treść żadnej z nich: jego naprawa to JEDNA rozgrzewka",
  );
  lines.push("w loaderze __root.tsx, nie loader dopisany do każdej z tych tras.");
  lines.push("");
  for (const stat of report.topQueryModules) {
    lines.push(
      `  ${pad(stat.routeCount, 4)} tras  ${pad(stat.querySiteCount, 3)} zapytań  ${stat.module}`,
    );
  }
  lines.push("");

  const missing = routesMissingWarmedLoader(report);
  const own = missing.filter((route) => route.queriesInRouteFile);
  const indexed = missing.filter((route) => !route.noindex);
  lines.push("-".repeat(78));
  lines.push(
    `DO ROBOTY: ${missing.length} z ${publicSsr.length} tras publicznych z SSR oddaje HTML ` +
      "bez treści.",
  );
  lines.push(
    `  indeksowanych (koszt w SEO):            ${pad(indexed.length, 3)}   ` +
      `noindex (koszt tylko dla czytelnika): ${pad(missing.length - indexed.length, 3)}`,
  );
  lines.push(
    `  zapytanie w SAMYM PLIKU TRASY (hop 0):  ${pad(own.length, 3)}   ` +
      `tylko przez importowane moduły:       ${pad(missing.length - own.length, 3)}`,
  );
  lines.push("");
  lines.push("Uwaga na kierunek błędu: analiza jest statyczna, więc zapytanie za warunkiem");
  lines.push("(`{open && <Dialog/>}`) liczy się jak zapytanie w treści - ta lista jest GÓRNYM");
  lines.push("oszacowaniem. Dowód przy każdej trasie (plik:linia + hop) pozwala to rozstrzygnąć");
  lines.push("bez ponownego przeszukiwania repozytorium.");

  return lines.join("\n");
}
