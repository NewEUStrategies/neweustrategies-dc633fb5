// Inwariant CI: SILNIKI TREŚCI MAJĄ JEDEN KIERUNEK ZALEŻNOŚCI.
//
// ── PRZYCZYNA ŹRÓDŁOWA ──────────────────────────────────────────────────────
// Platforma ma dwa silniki treści - edytor bloków (`lib/blocks`,
// `components/blocks`, `components/admin/blocks`) i builder sekcji/widgetów
// (`lib/builder`, `components/admin/builder`). Przez sześć kolejnych wydań
// audytu (`docs/AUDYT_PLATFORMY_MODULY_FUNKCJE_*`) para `bloki <-> builder`
// była JEDYNYM realnym cyklem w repozytorium - i rosła, zamiast maleć:
//
//     30.07  pierwsza wzmianka (rekomendacja: rozstrzygnąć kierunek)
//     13.08  23 / 17
//     14.08  28 / 16   <- „nadal jedyny realny cykl i nadal rośnie"
//
// Przyczyna była MECHANICZNA, nie koncepcyjna: żaden silnik nie był „niżej",
// więc każdy nowy widget dokładał krawędź w tę stronę, w którą akurat było
// wygodniej. Skrajny przykład: `lib/blocks/wordPaste.ts` importował `toJson`
// z buildera nie dlatego, że potrzebował buildera, tylko dlatego, że tam stała
// jedyna kopia escape-hatcha do JSON-a.
//
// Koszt cyklu rósł liniowo z każdym widgetem i był płacony przy KAŻDEJ zmianie
// w obu silnikach: nie dało się zmienić typu w jednym, nie ruszając drugiego,
// a bundler nie mógł rozdzielić ich na osobne chunki, bo graf się domykał.
//
// ── ROZSTRZYGNIĘCIE, KTÓREGO PILNUJE TA BRAMKA ─────────────────────────────
// Trzy piętra zamiast dwóch splątanych (pełny opis:
// `src/lib/content-model/README.md`):
//
//     content-model        prymitywy modelu treści; NIE ZNA żadnego silnika
//        ^        ^
//        |        |
//     bloki  <-  builder   jeden jawny, dozwolony kierunek
//
//   1. `content-model` NIE importuje z `blocks`, `builder` ani z tras -
//      inaczej nie jest fundamentem, tylko trzecim wierzchołkiem cyklu;
//   2. `blocks` NIE importuje z `builder` - zero wyjątków;
//   3. `builder` MOŻE importować z `blocks`, bo realnie go hostuje: widget
//      `rich-text` renderuje dokument bloków wewnątrz układu buildera.
//
// Bez bramki decyzja przetrwałaby dokładnie do pierwszego widgetu, któremu
// wygodniej byłoby sięgnąć w drugą stronę - dokładnie tak, jak przez poprzednie
// sześć wydań. Bramka zamienia jednorazowy remont w utrzymywany inwariant.
//
// ── CZEGO NIE MIERZY - świadomie ───────────────────────────────────────────
//   * krawędzi `builder -> blocks` - to kierunek dozwolony, raport podaje ich
//     liczbę wyłącznie informacyjnie (sygnał, jak grube jest hostowanie),
//   * warstwy `wp-import` - adapter stoi NAD oboma silnikami i wolno mu znać
//     oba (konwertuje HTML z WordPressa na dokument buildera, czytając blokami),
//   * importów pakietowych (`react`, `@tanstack/*`) - inwariant dotyczy
//     wyłącznie granic wewnątrz `src`.

/** Plik źródłowy poddany skanowi (ścieżka względna do repo + treść). */
export interface ScannedSource {
  readonly file: string;
  readonly source: string;
}

/** Warstwa, do której należy plik. `null` = poza zasięgiem inwariantu. */
export type ContentLayer = "content-model" | "blocks" | "builder" | "routes";

/** Złamanie kierunku zależności. */
export interface LayeringViolation {
  readonly file: string;
  /** Numer linii, 1-indeksowany. */
  readonly line: number;
  readonly from: ContentLayer;
  readonly to: ContentLayer;
  /** Specyfikator dosłownie z importu. */
  readonly specifier: string;
  /** Zdanie mówiące, CO zrobić - raport ma prowadzić do naprawy, nie tylko straszyć. */
  readonly remedy: string;
}

/** Podsumowanie liczbowe - także dla przebiegu zielonego. */
export interface LayeringStats {
  readonly scannedFiles: number;
  /** Krawędzie w kierunku DOZWOLONYM (`builder -> blocks`). */
  readonly allowedBuilderToBlocks: number;
}

/** Wynik skanu. */
export interface LayeringReport {
  readonly violations: readonly LayeringViolation[];
  readonly stats: LayeringStats;
}

/**
 * Wzorce warstw - PIERWSZY TRAFIONY WYGRYWA, więc kolejność ma znaczenie:
 * `components/admin/builder/` musi być sprawdzone przed `components/admin/`,
 * a `lib/content-model/` przed czymkolwiek innym.
 */
const LAYER_PATTERNS: ReadonlyArray<readonly [ContentLayer, RegExp]> = [
  ["content-model", /^src\/lib\/content-model\//],
  ["builder", /^src\/(?:lib\/builder\/|components\/admin\/builder\/)/],
  ["blocks", /^src\/(?:lib\/blocks\/|components\/blocks\/|components\/admin\/blocks\/)/],
  ["routes", /^src\/routes\//],
];

/** Warstwa pliku albo `null`, gdy plik jest poza zasięgiem inwariantu. */
export function layerOf(file: string): ContentLayer | null {
  const path = file.replaceAll("\\", "/");
  for (const [layer, pattern] of LAYER_PATTERNS) if (pattern.test(path)) return layer;
  return null;
}

/**
 * Zakazane krawędzie: warstwa -> zbiór warstw, których NIE wolno jej importować.
 *
 * `content-model` nie może znać ŻADNEGO silnika ani tras. `blocks` nie może
 * znać buildera. Kierunek `builder -> blocks` jest celowo nieobecny - jest
 * dozwolony.
 */
const FORBIDDEN: ReadonlyMap<ContentLayer, ReadonlySet<ContentLayer>> = new Map([
  ["content-model", new Set<ContentLayer>(["blocks", "builder", "routes"])],
  ["blocks", new Set<ContentLayer>(["builder"])],
]);

const REMEDY: ReadonlyMap<string, string> = new Map([
  [
    "content-model->blocks",
    "Warstwa wspólna nie może znać silnika. Przenieś użyty byt do `content-model` (jeśli jest wspólny) albo moduł do silnika (jeśli nie jest).",
  ],
  [
    "content-model->builder",
    "Warstwa wspólna nie może znać silnika. Przenieś użyty byt do `content-model` (jeśli jest wspólny) albo moduł do silnika (jeśli nie jest).",
  ],
  [
    "content-model->routes",
    "Warstwa wspólna nie może zależeć od tras - to odwrócenie kierunku aplikacji. Przekaż potrzebną wartość propsem albo kontekstem.",
  ],
  [
    "blocks->builder",
    "Bloki nie importują z buildera. Prymitywy wspólne (`Json`, `toJson`, `newId`) bierz z `@/lib/content-model/json`; moduł, który PRODUKUJE dokument buildera, należy do `lib/wp-import` albo do samego buildera.",
  ],
]);

/**
 * Rozwiązuje specyfikator do ścieżki względnej repo. Zwraca `null` dla
 * importów pakietowych. Parser jest tekstowy (bez TypeScript-compilera),
 * bo bramka ma być natychmiastowa - a do rozstrzygnięcia warstwy wystarczy
 * PREFIKS ścieżki, nie realne rozszerzenie pliku.
 */
export function resolveSpecifier(specifier: string, fromFile: string): string | null {
  if (specifier.startsWith("@/")) return `src/${specifier.slice(2)}`;
  if (!specifier.startsWith(".")) return null;

  const segments = fromFile.replaceAll("\\", "/").split("/").slice(0, -1);
  for (const part of specifier.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  return segments.join("/");
}

/** Katalogi i pliki poza zasięgiem bramki. */
export function isScannable(file: string): boolean {
  if (!/\.tsx?$/.test(file)) return false;
  if (file.includes("/__tests__/")) return false;
  if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) return false;
  // Moduł samej bramki mówi o zakazanych ścieżkach, nie importuje ich.
  if (file.endsWith("src/lib/ci/contentLayering.ts")) return false;
  return true;
}

/**
 * Wszystkie formy sprowadzające moduł: `import … from`, `import "…"`,
 * `import("…")` oraz `export … from`. Grupa ze ścieżką jest zawsze ostatnią
 * niepustą w trafieniu.
 */
const MODULE_SPECIFIER_RE =
  /(?:^|[\s;}])(?:import|export)\s[\s\S]*?\sfrom\s*["']([^"']+)["']|(?:^|[\s;}])import\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

/** Znajduje krawędzie łamiące kierunek + liczy krawędzie dozwolone. */
export function scanContentLayering(sources: readonly ScannedSource[]): LayeringReport {
  const violations: LayeringViolation[] = [];
  let allowedBuilderToBlocks = 0;

  for (const { file, source } of sources) {
    const from = layerOf(file);
    if (from === null) continue;

    const lineStarts: number[] = [0];
    for (let i = 0; i < source.length; i++) if (source[i] === "\n") lineStarts.push(i + 1);
    const lineOf = (index: number): number => {
      let low = 0;
      let high = lineStarts.length - 1;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if ((lineStarts[mid] ?? 0) <= index) low = mid;
        else high = mid - 1;
      }
      return low + 1;
    };

    MODULE_SPECIFIER_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = MODULE_SPECIFIER_RE.exec(source)) !== null) {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (specifier === undefined) continue;

      const target = resolveSpecifier(specifier, file);
      if (target === null) continue;

      const to = layerOf(target);
      if (to === null || to === from) continue;

      if (from === "builder" && to === "blocks") {
        allowedBuilderToBlocks += 1;
        continue;
      }
      if (FORBIDDEN.get(from)?.has(to) !== true) continue;

      // Wzorzec zaczyna się od separatora (`\s`, `;`, `}`), który przy imporcie
      // w kolejnej linii JEST znakiem nowej linii tej poprzedniej - bez tego
      // przesunięcia raport wskazywałby linię wcześniej i prowadził w złe miejsce.
      const leading = /^[\s;}]*/.exec(match[0])?.[0].length ?? 0;

      violations.push({
        file,
        line: lineOf(match.index + leading),
        from,
        to,
        specifier,
        remedy: REMEDY.get(`${from}->${to}`) ?? "Odwróć kierunek albo wydziel warstwę wspólną.",
      });
    }
  }

  violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { violations, stats: { scannedFiles: sources.length, allowedBuilderToBlocks } };
}

/** Log bramki - zielony podaje zasięg, czerwony prowadzi do naprawy. */
export function renderContentLayeringReport(report: LayeringReport): string {
  const { violations, stats } = report;
  const scope = `${stats.scannedFiles} plików, ${stats.allowedBuilderToBlocks} krawędzi w dozwolonym kierunku builder -> bloki`;

  if (violations.length === 0) {
    return [
      `✓ Warstwowość silników treści OK (${scope}).`,
      "  bloki -> builder: 0 · content-model -> silniki: 0",
    ].join("\n");
  }

  const grouped = new Map<string, LayeringViolation[]>();
  for (const violation of violations) {
    const key = `${violation.from} -> ${violation.to}`;
    const bucket = grouped.get(key);
    if (bucket === undefined) grouped.set(key, [violation]);
    else bucket.push(violation);
  }

  const body: string[] = [];
  for (const [edge, items] of grouped) {
    body.push(`  ${edge} (${items.length}):`);
    for (const item of items) body.push(`    ${item.file}:${item.line} -> ${item.specifier}`);
    body.push(`    → ${items[0]?.remedy ?? ""}`);
    body.push("");
  }

  return [
    `✗ ${violations.length} krawędzi łamiących warstwowość silników treści (${scope}).`,
    "",
    ...body,
    "Kierunek został rozstrzygnięty po sześciu wydaniach audytu, w których cykl",
    "`bloki <-> builder` rósł (30.07 -> 13.08: 23/17 -> 14.08: 28/16). Reguły i pełne",
    "uzasadnienie: src/lib/content-model/README.md",
  ].join("\n");
}
