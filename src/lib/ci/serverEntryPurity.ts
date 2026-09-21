// Bramka CZYSTOŚCI GRAFU SERWERA: ciężka zależność server-only nie może być
// STATYCZNIE importowana w artefakcie Workera - wolno ją wciągać wyłącznie
// przez `import()` z funkcji, która jej naprawdę używa.
//
// ── PRZYCZYNA ŹRÓDŁOWA ──────────────────────────────────────────────────────
// `routeTree.gen.ts` importuje statycznie WSZYSTKIE pliki tras (393, w tym
// `routes/api/public/payments/webhook.ts`), a Rollup wynosi moduł współdzielony
// przez wiele chunków do ich wspólnego przodka. Skutkiem była krawędź
// `_ssr/router-*.mjs -> _libs/stripe.mjs`: chunk, od którego zaczyna się KAŻDY
// render SSR, ciągnął 198 kB SDK operatora płatności. W zimnym izolacie
// `workerd` to czas ewaluacji płacony przez anonimowego czytelnika artykułu,
// który nigdy nie zobaczy checkoutu (audyt CWV F04, §8.1, 2026-09-20).
//
// ── DLACZEGO „ZERO STATYCZNYCH IMPORTERÓW", A NIE „POZA CHUNKIEM STARTOWYM" ─
// Nazwa chunku startowego serwera zależy od presetu Nitro i od hashy, więc
// reguła po nazwie rozjeżdża się przy każdej zmianie adaptera i robi się CICHO
// zielona. Niezmiennik „paczka X nie ma w artefakcie ANI JEDNEJ krawędzi
// statycznej" jest mocniejszy (implikuje nieobecność w każdym domknięciu
// startowym) i nie wymaga zgadywania, który plik jest korzeniem.
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
  /** Nazwa pliku chunku vendorowego w artefakcie, np. `stripe.mjs`. */
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
 * inicjalizacyjnej - ten sam filtr, co w `scripts/check-entry-purity.ts`.
 */
const CHUNK_EDGE_RE =
  /(import\s*\(?\s*|from\s*|export\s*\*\s*from\s*)["'](\.{1,2}\/[^"']+\.mjs)["']/g;

/** Ostatni segment ścieżki - chunki vendorowe rozpoznajemy po nazwie pliku. */
function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

/** Chunki, które importują `chunkName` STATYCZNIE (bez samego siebie). */
export function staticImportersOfChunk(
  chunks: readonly ServerChunk[],
  chunkName: string,
): string[] {
  const out: string[] = [];
  for (const chunk of chunks) {
    if (basename(chunk.path) === chunkName) continue;
    CHUNK_EDGE_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CHUNK_EDGE_RE.exec(chunk.source)) !== null) {
      if (match[1].trimEnd().endsWith("(")) continue;
      if (basename(match[2]) !== chunkName) continue;
      out.push(chunk.path);
      break;
    }
  }
  return out.sort();
}

/** Czy chunk paczki w ogóle jest w artefakcie (inaczej reguła nic nie mierzy). */
export function hasChunk(chunks: readonly ServerChunk[], chunkName: string): boolean {
  return chunks.some((chunk) => basename(chunk.path) === chunkName);
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

  for (const pkg of input.lazyOnlyPackages) {
    if (!hasChunk(input.chunks, pkg.chunk)) {
      missingChunks.push(pkg);
      continue;
    }
    const importers = staticImportersOfChunk(input.chunks, pkg.chunk);
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
      `✗ [server-entry-purity] ${violation.pkg.label} ma ${violation.importers.length} statycznych importerów w artefakcie serwera:`,
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
 * Nazwy chunków biorą się z podziału vendorów w `vite.config.ts` (katalog
 * `_libs/` artefaktu Nitro) - jeden plik na paczkę, więc reguła jest czytelna
 * także w komunikacie bramki.
 */
export const LAZY_ONLY_PACKAGES: readonly LazyOnlyPackage[] = [
  {
    label: "stripe (SDK operatora płatności, 198 kB chunku serwera)",
    chunk: "stripe.mjs",
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
