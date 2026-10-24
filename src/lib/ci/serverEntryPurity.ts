// Bramka CZYSTOŚCI GRAFU SERWERA: ciężka zależność server-only nie może być
// STATYCZNIE importowana w artefakcie Workera - wolno ją wciągać wyłącznie
// przez `import()` z funkcji, która jej naprawdę używa.
//
// ── PRZYCZYNA ŹRÓDŁOWA ──────────────────────────────────────────────────────
// `routeTree.gen.ts` importuje statycznie WSZYSTKIE pliki tras (393, w tym
// `routes/api/public/payments/webhook.ts`), a bundler (wtedy Rollup Nitro) wyniósł
// moduł współdzielony przez wiele chunków do ich wspólnego przodka. Skutkiem była krawędź
// `_ssr/router-*.mjs -> _libs/stripe.mjs`: chunk, od którego zaczyna się KAŻDY
// render SSR, ciągnął 198 kB SDK operatora płatności. W zimnym izolacie
// `workerd` to czas ewaluacji płacony przez anonimowego czytelnika artykułu,
// który nigdy nie zobaczy checkoutu (audyt CWV F04, §8.1, 2026-09-20).
//
// ── DLACZEGO „ZERO STATYCZNYCH IMPORTERÓW ŁADOWANYCH PRZY STARCIE", A NIE
//    „POZA CHUNKIEM STARTOWYM" ─────────────────────────────────────────────
// Nazwa chunku startowego serwera zależy od presetu Nitro i od hashy, więc
// reguła po nazwie rozjeżdża się przy każdej zmianie adaptera i robi się CICHO
// zielona. Korzeń wyznacza tu sam graf: plik, którego NIKT nie importuje (ani
// statycznie, ani `import()`) - wejście Workera, wejście SSR, plik osierocony
// (ten ostatni liczony na wyrost, w stronę czerwieni). Ładowany przy starcie
// jest każdy plik statycznie osiągalny z korzenia; paczka X nie może mieć ANI
// JEDNEGO statycznego importera z tego zbioru.
//
// Dlaczego nie „zero statycznych importerów w ogóle" (reguła do 2026-10-16):
// Nitro na Rolldownie wystawia `import("stripe")` przez FASADĘ - plik
// `_libs/_13.mjs` z samym `export{...}from"./stripe.mjs"`, ładowany wyłącznie
// przez `import()` z `stripe.server`. Krawędź fasady jest statyczna, ale nie
// startowa. Krawędzie liczymy też po ŚCIEŻCE, nie po nazwie pliku: ten sam
// artefakt ma moduł aplikacji `_chunks/stripe.mjs` (1 KB), którego importery
// (`from"./stripe.mjs"` w `_chunks/`) bramka po nazwie brała za importery SDK.
//
// ── DRUGA KLASA REGUŁ: DŁUG, KTÓREGO NIE DA SIĘ DZIŚ SPŁACIĆ ────────────────
// `node-html-parser` trzymają na ścieżce żądania DWA synchroniczne API, których
// nie da się przepiąć na `import()` bez przepisania konsumentów:
// `lib/ssrSanitizeHtml` (serwerowa połowa `sanitizeHtml`, wołana w trakcie
// renderu Reacta) i `lib/builder/normalizeRichHtml` (wołany synchronicznie
// przez komponenty buildera). Zamiast udawać, że długu nie ma, zamrażamy listę
// modułów, którym wolno importować paczkę statycznie: dług nie znika, ale
// przestaje się rozlewać, a każdy nowy importer wymaga świadomej decyzji.
//
// ── TRZECIA KLASA: JEDNA KOPIA APLIKACJI W ARTEFAKCIE ──────────────────────
// Handler TanStack Start ładuje wejścia aplikacji jednym `Promise.all` z
// `import()` chunku routera i chunku startu (`getEntries` w start-server-core).
// Artefakt ma mieć DOKŁADNIE JEDEN taki loader. Do 2026-10-24 miał dwa:
// specyfikator `@tanstack/react-start/server` podany przez zmienną z
// `@vite-ignore` zostawał w buildzie SSR pakietem zewnętrznym, Nitro dociągał
// drugą kopię Startu, a jej loader rozwiązywał `#tanstack-router-entry` po
// swojemu - do Workera trafiała druga, niepodzielona kopia całej aplikacji
// (`_chunks/router.mjs` 9 MB + 860 chunków, 17 MB z 40 MB). Nikt jej nie
// wykonywał, ale workerd kompiluje każdy moduł skryptu przy starcie izolatu:
// zimny start 1,44 s -> 1,00 s po usunięciu (lokalny workerd, pomiar
// w docs/performance/2026-10-24-zimny-start-workera.md). Zero loaderów to
// defekt skanu (zmieniony kształt kodu frameworka), nie zielone światło.
//
// ── CZWARTA KLASA: KOMPONENTY TRAS RENDEROWANYCH WYŁĄCZNIE PO HYDRATACJI ────
// Podstrony `/admin/*` serwer renderuje tylko jako szkielet (`<Outlet/>` panelu montuje się
// po hydratacji), więc w środowisku `ssr` ich moduły komponentów podmienia zaślepka
// (`scripts/lib/clientOnlyRouteStubPlugin.ts`, −7,2 MB artefaktu). Wtyczka rozpoznaje moduły
// po formacie `?tsr-split=` router-pluginu i po drzewie tras - zmiana któregokolwiek
// wyłączyłaby ją PO CICHU (ostrzeżenie buildu nie zatrzymuje CI). Bramka sprawdza wynik:
// każdy `import()` komponentu trasy `/admin/…` w artefakcie wskazuje plik nie większy niż
// zaślepka; zero sprawdzonych tras to defekt skanu.
//
// Warstwa wykonawcza (odczyt `.output/server` i `src/`, kod wyjścia) żyje
// w `scripts/check-server-entry-purity.ts`; ten moduł jest czysty.

/** Jeden plik artefaktu serwera poddany skanowi. */
export interface ServerChunk {
  /** Ścieżka względem katalogu artefaktu, np. `_ssr/router-C3vwO7CP.mjs`. */
  readonly path: string;
  readonly source: string;
}

/** Jeden plik źródłowy poddany skanowi (komentarze już wymaskowane). */
export interface SourceFile {
  /** Ścieżka względem katalogu repozytorium, np. `src/lib/sanitize.ts`. */
  readonly path: string;
  readonly source: string;
}

/** Paczka, która ma być w artefakcie serwera osiągalna wyłącznie przez `import()`. */
export interface LazyOnlyPackage {
  readonly label: string;
  /**
   * Ścieżka chunku vendorowego względem katalogu artefaktu, np. `_libs/stripe.mjs` - ścieżka,
   * nie sama nazwa pliku (kolizja z modułem aplikacji `_chunks/stripe.mjs`, nagłówek pliku).
   */
  readonly chunk: string;
  readonly remedy: string;
}

/** Paczka, której statyczne importy są zamrożone do wskazanych modułów źródłowych. */
export interface FrozenStaticImporters {
  /** Specyfikator paczki, dokładnie jak w `import ... from "…"`. */
  readonly pkg: string;
  /** Zamrożona lista modułów źródłowych; wolno ją TYLKO skracać. */
  readonly allowed: readonly string[];
  /** Dlaczego tych nie da się dziś przepiąć na `import()`. */
  readonly reason: string;
  readonly remedy: string;
}

/**
 * Krawędź statyczna w module ESM. `import(` NIE tworzy krawędzi
 * inicjalizacyjnej - ten sam filtr, co w `scripts/check-entry-purity.ts`. Worker
 * minifikuje Oxc (Nitro, `minify: true`), który drukuje specyfikator dynamicznego
 * importu w backtickach (``import(`../_libs/stripe.mjs`)``) - wzorzec (tylko
 * cudzysłowy) w ogóle go nie widzi, a filtr `import(` zostaje dla kodu bez
 * minifikacji. Statyczny `import`/`export ... from` gramatyka wymusza w cudzysłowie.
 */
const CHUNK_EDGE_RE =
  /(import\s*\(?\s*|from\s*|export\s*\*\s*from\s*)["'](\.{1,2}\/[^"']+\.mjs)["']/g;

/** Dynamiczny `import()` - w cudzysłowie albo (po Oxc) w backtickach. */
const DYNAMIC_EDGE_RE = /import\s*\(\s*["'`](\.{1,2}\/[^"'`]+\.mjs)["'`]\s*\)/g;

/** Specyfikator względny rozwiązany od pliku importującego (ścieżki z `/`, bez `..` na brzegu). */
export function resolveChunkPath(importer: string, specifier: string): string {
  const parts = importer.split("/").slice(0, -1);
  for (const segment of specifier.split("/")) {
    if (segment === "..") parts.pop();
    else if (segment !== ".") parts.push(segment);
  }
  return parts.join("/");
}

/** Cele krawędzi statycznych pliku (`import`, `export ... from`), już jako ścieżki. */
function staticTargets(chunk: ServerChunk): string[] {
  const out: string[] = [];
  for (const match of chunk.source.matchAll(CHUNK_EDGE_RE)) {
    if (match[1].trimEnd().endsWith("(")) continue;
    out.push(resolveChunkPath(chunk.path, match[2]));
  }
  return out;
}

/** Chunki, które importują `chunkPath` STATYCZNIE (bez samego siebie). */
export function staticImportersOfChunk(
  chunks: readonly ServerChunk[],
  chunkPath: string,
): string[] {
  return chunks
    .filter((chunk) => chunk.path !== chunkPath && staticTargets(chunk).includes(chunkPath))
    .map((chunk) => chunk.path)
    .sort();
}

/**
 * Pliki ładowane przy starcie: statycznie osiągalne z korzeni, czyli plików, których nikt
 * nie importuje ani statycznie, ani przez `import()` (nagłówek pliku).
 */
export function startupChunks(chunks: readonly ServerChunk[]): Set<string> {
  const known = new Set(chunks.map((chunk) => chunk.path));
  const imported = new Set<string>();
  const edges = new Map<string, string[]>();
  for (const chunk of chunks) {
    const targets = staticTargets(chunk).filter((target) => known.has(target));
    edges.set(chunk.path, targets);
    for (const target of targets) imported.add(target);
    for (const match of chunk.source.matchAll(DYNAMIC_EDGE_RE)) {
      imported.add(resolveChunkPath(chunk.path, match[1]));
    }
  }
  const out = new Set<string>();
  const stack = chunks.map((chunk) => chunk.path).filter((path) => !imported.has(path));
  while (stack.length > 0) {
    const path = stack.pop()!;
    if (out.has(path)) continue;
    out.add(path);
    stack.push(...(edges.get(path) ?? []));
  }
  return out;
}

/**
 * Loader wejść TanStack Start: `import()` chunku routera, a zaraz po nim `import()` chunku
 * startu (`Promise.all([import(router), import(start), …])`). Nazwy chunków to `router.mjs`
 * albo `router-<hash>.mjs` i `start…` - zależnie od tego, czy chunk zbudował Vite (`_ssr/`),
 * czy Nitro (`_chunks/`). Cudzysłów albo backticki Oxc, jak w `DYNAMIC_EDGE_RE`.
 */
const START_ENTRY_LOADER_RE =
  /import\s*\(\s*["'`][^"'`]*\/router(?:-[\w-]+)?\.mjs["'`]\s*\)\s*,\s*import\s*\(\s*["'`][^"'`]*\/start(?:-[\w-]+)?\.mjs["'`]\s*\)/;

/** Pliki artefaktu z loaderem wejść TanStack Start - każdy to osobna kopia aplikacji. */
export function startEntryLoaders(chunks: readonly ServerChunk[]): string[] {
  return chunks
    .filter((chunk) => START_ENTRY_LOADER_RE.test(chunk.source))
    .map((chunk) => chunk.path)
    .sort();
}

/** Prefiksy tras, których komponenty serwer zastępuje zaślepką (nagłówek pliku, czwarta klasa). */
export const CLIENT_ONLY_ROUTE_PREFIXES = ["/admin/"] as const;

/** Największa dopuszczalna zaślepka: `function e(){return null}export{e as component};` ma 48 B. */
export const CLIENT_ONLY_STUB_MAX_BYTES = 256;

/** Definicja trasy po minifikacji: `<alias createFileRoute>(`/ścieżka`)({`. */
const ROUTE_DEFINITION_RE = /\(\s*[`"'](\/[^`"']*)[`"']\s*\)\s*\(\s*\{/g;

/** `lazyRouteComponent(() => import(X), "component")` i pozostałe węzły-komponenty. */
const LAZY_ROUTE_COMPONENT_RE =
  /import\s*\(\s*[`"'](\.{1,2}\/[^`"']+\.mjs)[`"']\s*\)\s*,\s*[`"'](component|pendingComponent|errorComponent|notFoundComponent)[`"']/g;

/** `lazyFn(() => import(X), "loader")` - grupy podziału z loaderem wtyczka zostawia w spokoju. */
const LAZY_ROUTE_LOADER_RE =
  /import\s*\(\s*[`"'](\.{1,2}\/[^`"']+\.mjs)[`"']\s*\)\s*,\s*[`"']loader[`"']/g;

/** Komponent trasy „tylko po hydratacji", który w artefakcie serwera nie jest zaślepką. */
export interface HeavyClientOnlyComponent {
  readonly route: string;
  readonly chunk: string;
  /** Rozmiar pliku; -1 = cel `import()` nie istnieje w artefakcie. */
  readonly bytes: number;
}

export interface ClientOnlyComponentsReport {
  /** Liczba sprawdzonych `import()` komponentów - liczba kontrolna (0 = zepsuty skan). */
  readonly checked: number;
  readonly heavy: readonly HeavyClientOnlyComponent[];
}

/** Komponenty tras spod `prefixes` w artefakcie serwera i te z nich, które nie są zaślepką. */
export function clientOnlyRouteComponents(
  chunks: readonly ServerChunk[],
  prefixes: readonly string[] = CLIENT_ONLY_ROUTE_PREFIXES,
): ClientOnlyComponentsReport {
  const sizes = new Map(chunks.map((chunk) => [chunk.path, chunk.source.length]));
  let checked = 0;
  const heavy: HeavyClientOnlyComponent[] = [];
  for (const chunk of chunks) {
    const definitions = [...chunk.source.matchAll(ROUTE_DEFINITION_RE)];
    definitions.forEach((definition, index) => {
      const route = definition[1];
      if (!prefixes.some((prefix) => route.startsWith(prefix))) return;
      const start = definition.index ?? 0;
      const next = definitions[index + 1]?.index ?? chunk.source.length;
      const body = chunk.source.slice(start, Math.min(next, start + 4_000));
      // Grupa podziału z loaderem (kokpit `/admin/`, `ADMIN_COCKPIT_SPLIT`) to jeden moduł dla
      // `loader` i `component` - loader biegnie na serwerze, więc wtyczka go nie podmienia.
      const loaders = new Set([...body.matchAll(LAZY_ROUTE_LOADER_RE)].map((match) => match[1]));
      for (const lazy of body.matchAll(LAZY_ROUTE_COMPONENT_RE)) {
        if (loaders.has(lazy[1])) continue;
        checked += 1;
        const target = resolveChunkPath(chunk.path, lazy[1]);
        const bytes = sizes.get(target) ?? -1;
        if (bytes < 0 || bytes > CLIENT_ONLY_STUB_MAX_BYTES)
          heavy.push({ route, chunk: target, bytes });
      }
    });
  }
  heavy.sort((a, b) => a.route.localeCompare(b.route) || a.chunk.localeCompare(b.chunk));
  return { checked, heavy };
}

/** Czy chunk paczki w ogóle jest w artefakcie (inaczej reguła nic nie mierzy). */
export function hasChunk(chunks: readonly ServerChunk[], chunkPath: string): boolean {
  return chunks.some((chunk) => chunk.path === chunkPath);
}

/**
 * Moduły źródłowe importujące `pkg` w sposób WARTOŚCIOWY.
 *
 * `import type … from "pkg"` jest wymazywany przez kompilator, więc nie tworzy
 * krawędzi w bundlu i nie liczy się do długu - i o to właśnie chodzi w naprawie
 * (`import type Stripe from "stripe"` zostaje, `import Stripe` znika).
 */
export function valueImportersOfPackage(files: readonly SourceFile[], pkg: string): string[] {
  const specifier = pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `(^|[\\n;])\\s*(?:import|export)(\\s+type\\b)?([^;\\n]*?)from\\s*["']${specifier}["']`,
    "g",
  );
  const out: string[] = [];
  for (const file of files) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(file.source)) !== null) {
      if (match[2] !== undefined) continue;
      out.push(file.path);
      break;
    }
  }
  return out.sort();
}

export interface LazyOnlyViolation {
  readonly pkg: LazyOnlyPackage;
  readonly importers: readonly string[];
}

export interface FrozenViolation {
  readonly rule: FrozenStaticImporters;
  /** Moduły spoza zamrożonej listy. */
  readonly added: readonly string[];
  /** Wpisy listy, których już nie ma - lista ma być tylko skracana świadomie. */
  readonly stale: readonly string[];
}

export interface ServerEntryPurityReport {
  /** Liczba plików artefaktu w skanie - liczba kontrolna (0 = zepsuty skan). */
  readonly scannedChunks: number;
  /** Reguły, których chunku nie ma w artefakcie - też są defektem skanu. */
  readonly missingChunks: readonly LazyOnlyPackage[];
  readonly lazyOnly: readonly LazyOnlyViolation[];
  readonly frozen: readonly FrozenViolation[];
  /** Pliki z loaderem wejść TanStack Start; poprawnie dokładnie jeden (nagłówek pliku). */
  readonly startEntryLoaders: readonly string[];
  /** Komponenty tras renderowanych wyłącznie po hydratacji (czwarta klasa). */
  readonly clientOnlyComponents: ClientOnlyComponentsReport;
}

export function analyzeServerEntryPurity(input: {
  readonly chunks: readonly ServerChunk[];
  readonly sources: readonly SourceFile[];
  readonly lazyOnlyPackages: readonly LazyOnlyPackage[];
  readonly frozenRules: readonly FrozenStaticImporters[];
}): ServerEntryPurityReport {
  const missingChunks: LazyOnlyPackage[] = [];
  const lazyOnly: LazyOnlyViolation[] = [];
  const startup = startupChunks(input.chunks);

  for (const pkg of input.lazyOnlyPackages) {
    if (!hasChunk(input.chunks, pkg.chunk)) {
      missingChunks.push(pkg);
      continue;
    }
    const importers = staticImportersOfChunk(input.chunks, pkg.chunk).filter((path) =>
      startup.has(path),
    );
    if (importers.length > 0) lazyOnly.push({ pkg, importers });
  }

  const frozen: FrozenViolation[] = [];
  for (const rule of input.frozenRules) {
    const actual = valueImportersOfPackage(input.sources, rule.pkg);
    const allowed = new Set(rule.allowed);
    const added = actual.filter((path) => !allowed.has(path));
    const stale = rule.allowed.filter((path) => !actual.includes(path));
    if (added.length > 0 || stale.length > 0) frozen.push({ rule, added, stale });
  }

  return {
    scannedChunks: input.chunks.length,
    missingChunks,
    lazyOnly,
    frozen,
    startEntryLoaders: startEntryLoaders(input.chunks),
    clientOnlyComponents: clientOnlyRouteComponents(input.chunks),
  };
}

export function serverEntryPurityFailed(report: ServerEntryPurityReport): boolean {
  return (
    report.scannedChunks === 0 ||
    report.missingChunks.length > 0 ||
    report.lazyOnly.length > 0 ||
    report.frozen.length > 0 ||
    report.startEntryLoaders.length !== 1 ||
    report.clientOnlyComponents.checked === 0 ||
    report.clientOnlyComponents.heavy.length > 0
  );
}

export function renderServerEntryPurityReport(report: ServerEntryPurityReport): string {
  if (report.scannedChunks === 0) {
    return [
      "✗ [server-entry-purity] artefakt serwera jest pusty.",
      "  To nie jest zielone światło - to brak pomiaru. Najpierw `bun run build`.",
    ].join("\n");
  }

  const lines: string[] = [];

  for (const missing of report.missingChunks) {
    lines.push(
      `✗ [server-entry-purity] nie znaleziono chunku \`${missing.chunk}\` (${missing.label}).`,
      "  Reguła bez chunku niczego nie mierzy: albo splitter vendorów zmienił układ",
      "  artefaktu, albo paczka wypadła z zależności. Zaktualizuj regułę lub ją usuń.",
      "",
    );
  }

  for (const violation of report.lazyOnly) {
    lines.push(
      `✗ [server-entry-purity] ${violation.pkg.label} ma ${violation.importers.length} statycznych importerów ładowanych przy starcie artefaktu serwera:`,
      ...violation.importers.slice(0, 10).map((path) => `    ${path}`),
      ...(violation.importers.length > 10
        ? [`    … i ${violation.importers.length - 10} więcej`]
        : []),
      "",
      "Statyczna krawędź znaczy EWALUACJĘ przy starcie izolatu - na każdym zimnym",
      "żądaniu, także tym, które nigdy nie dotknie tej ścieżki.",
      `  naprawa: ${violation.pkg.remedy}`,
      "",
    );
  }

  for (const violation of report.frozen) {
    if (violation.added.length > 0) {
      lines.push(
        `✗ [server-entry-purity] nowy statyczny importer \`${violation.rule.pkg}\` poza zamrożoną listą:`,
        ...violation.added.map((path) => `    ${path}`),
        "",
        `  dlaczego lista istnieje: ${violation.rule.reason}`,
        `  naprawa: ${violation.rule.remedy}`,
        "",
      );
    }
    if (violation.stale.length > 0) {
      lines.push(
        `✗ [server-entry-purity] zamrożona lista dla \`${violation.rule.pkg}\` wymienia moduły, które już nie importują tej paczki:`,
        ...violation.stale.map((path) => `    ${path}`),
        "",
        "  Dług został spłacony - skróć listę w `src/lib/ci/serverEntryPurity.ts`,",
        "  żeby bramka nadal mierzyła stan faktyczny.",
        "",
      );
    }
  }

  if (report.startEntryLoaders.length === 0) {
    lines.push(
      "✗ [server-entry-purity] nie znaleziono loadera wejść TanStack Start",
      "  (`Promise.all([import(router), import(start), …])`).",
      "  Reguła jednej kopii aplikacji niczego nie mierzy: zmienił się kształt kodu",
      "  frameworka - zaktualizuj `START_ENTRY_LOADER_RE` w `src/lib/ci/serverEntryPurity.ts`.",
      "",
    );
  } else if (report.startEntryLoaders.length > 1) {
    lines.push(
      `✗ [server-entry-purity] artefakt serwera niesie ${report.startEntryLoaders.length} kopie aplikacji (loadery wejść TanStack Start):`,
      ...report.startEntryLoaders.map((path) => `    ${path}`),
      "",
      "Każda kopia to cały graf tras kompilowany przy KAŻDYM zimnym starcie izolatu,",
      "także gdy nikt jej nie wykonuje.",
      '  naprawa: `@tanstack/react-start/server` importuj LITERAŁEM (`await import("@tanstack/react-start/server")`),',
      "  nigdy przez zmienną z `@vite-ignore` - build SSR zostawia taki specyfikator jako",
      "  pakiet zewnętrzny, a Nitro dociąga drugą kopię Startu razem z jego `#tanstack-router-entry`.",
      "",
    );
  }

  const clientOnly = report.clientOnlyComponents;
  if (clientOnly.checked === 0) {
    lines.push(
      `✗ [server-entry-purity] nie znaleziono komponentów tras ${CLIENT_ONLY_ROUTE_PREFIXES.join(", ")} w artefakcie serwera.`,
      "  Reguła zaślepek niczego nie mierzy: zmienił się kształt definicji tras po minifikacji -",
      "  zaktualizuj `ROUTE_DEFINITION_RE`/`LAZY_ROUTE_COMPONENT_RE` w `src/lib/ci/serverEntryPurity.ts`.",
      "",
    );
  } else if (clientOnly.heavy.length > 0) {
    lines.push(
      `✗ [server-entry-purity] ${clientOnly.heavy.length} z ${clientOnly.checked} komponentów tras renderowanych wyłącznie po hydratacji nie są w artefakcie serwera zaślepką (> ${CLIENT_ONLY_STUB_MAX_BYTES} B):`,
      ...clientOnly.heavy
        .slice(0, 10)
        .map(({ route, chunk, bytes }) =>
          bytes < 0 ? `    ${route}: ${chunk} (brak pliku)` : `    ${route}: ${chunk} (${bytes} B)`,
        ),
      ...(clientOnly.heavy.length > 10 ? [`    … i ${clientOnly.heavy.length - 10} więcej`] : []),
      "",
      "Ten kod serwer kompiluje przy KAŻDYM zimnym starcie izolatu, choć nigdy go nie renderuje.",
      "  naprawa: sprawdź `scripts/lib/clientOnlyRouteStubPlugin.ts` (format `?tsr-split=`",
      "  router-pluginu, parser `src/routeTree.gen.ts`, nazwę środowiska `ssr`).",
      "",
    );
  }

  if (lines.length === 0) {
    return `✓ Graf serwera czysty (${report.scannedChunks} plików artefaktu przeskanowanych).`;
  }
  return lines.join("\n").trimEnd();
}

/**
 * Paczki server-only, które wolno wciągać WYŁĄCZNIE przez `import()`.
 *
 * Nazwy chunków nadaje podział vendorów Nitro (grupa `codeSplitting` na
 * `node_modules` i `getChunkName`: katalog `_libs/` artefaktu) - jeden plik na
 * paczkę, więc reguła jest czytelna także w komunikacie bramki. Chunk kilku paczek
 * dostaje nazwę z ich złączenia (`_libs/a+b.mjs`; złączenie dłuższe niż 30 znaków -
 * `<nazwa chunku>+[...].mjs` poza `_libs/`) - wtedy reguła zgłasza brak chunku
 * zamiast milczeć.
 */
export const LAZY_ONLY_PACKAGES: readonly LazyOnlyPackage[] = [
  {
    label: "stripe (SDK operatora płatności, 198 kB chunku serwera)",
    chunk: "_libs/stripe.mjs",
    remedy:
      'SDK ładuj przez `await import("stripe")` w `lib/stripe.server.ts` ' +
      "(`getStripeClient`, leniwy singleton per środowisko); w modułach płatności " +
      'trzymaj wyłącznie `import type Stripe from "stripe"`',
  },
];

/**
 * Dług, którego ta bramka pilnuje, żeby się nie rozlewał.
 *
 * `node-html-parser` zostaje na ścieżce żądania, bo oba jego API są
 * SYNCHRONICZNE i wołane z kodu, który nie może czekać:
 *   - `ssrSanitizeHtml` jest serwerową połową `sanitizeHtml`, wołaną w trakcie
 *     renderu Reacta (przepięcie na `import()` wymaga asynchronicznego API
 *     sanityzatora, czyli zmiany kontraktu bezpieczeństwa);
 *   - `normalizeBuilderRichHtml` wołają synchronicznie komponenty buildera.
 * Dopóki tak jest, lista poniżej ma dokładnie dwa wpisy i wolno ją TYLKO
 * skracać - każdy nowy statyczny importer oblewa bramkę.
 */
export const FROZEN_STATIC_IMPORTERS: readonly FrozenStaticImporters[] = [
  {
    pkg: "node-html-parser",
    allowed: ["src/lib/builder/normalizeRichHtml.ts", "src/lib/ssrSanitizeHtml.ts"],
    reason:
      "oba moduły wystawiają API SYNCHRONICZNE wołane w trakcie renderu, " +
      "więc `await import()` wymagałby zmiany ich kontraktu i konsumentów",
    remedy:
      'nowy konsument parsera HTML ma go ładować przez `await import("node-html-parser")` ' +
      "wewnątrz funkcji, która go używa - nigdy importem statycznym na poziomie modułu",
  },
];
