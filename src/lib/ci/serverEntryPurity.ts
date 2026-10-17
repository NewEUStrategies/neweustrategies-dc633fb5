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

  return { scannedChunks: input.chunks.length, missingChunks, lazyOnly, frozen };
}

export function serverEntryPurityFailed(report: ServerEntryPurityReport): boolean {
  return (
    report.scannedChunks === 0 ||
    report.missingChunks.length > 0 ||
    report.lazyOnly.length > 0 ||
    report.frozen.length > 0
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
