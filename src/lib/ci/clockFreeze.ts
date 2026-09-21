// BRAMKA: test z literałem daty NIE MOŻE czytać prawdziwego zegara.
//
// KLASA DEFEKTU. Test niosący literał kalendarzowy (`"2026-08-30"`) i zależny
// od modułu, który czyta `Date.now()`, nie jest deterministyczny - jest
// OPÓŹNIONY. Odległość literału od „teraz" rośnie z każdą dobą i w pewnym
// momencie przekracza okno, które produkcja liczy z zegara. Test przechodzi
// rok, po czym pada w środę o dziesiątej, a diff z tego dnia jest pusty.
//
// ZMIERZONE NA TYM REPOZYTORIUM (2026-09-06). Plik `donationsAdmin.server.test.ts`
// trzymał DWANAŚCIE takich zapalników na jednej domyślnej dacie fabryki wierszy.
// Pierwszy wybuchł 2026-09-05 o 10:00 UTC (jeden czerwony test), reszta miała
// wybuchnąć 2026-09-06 o 10:00 UTC. Nic tego nie zapowiedziało, bo licznik
// czerwieni mierzy dzisiaj, a nie za tydzień.
//
// DLACZEGO DETEKTOR STOI PO STRONIE TESTU, A NIE PRODUKCJI. Od strony produkcji
// tej klasy defektu NIE DA SIĘ znaleźć. Kod produkcyjny ma 61 odczytów
// `Date.now() - X` w 50 plikach, ale X jest policzalne statycznie tylko w
// trzech - reszta to zmienne i parametry funkcji (okno 168 h w darowiznach jest
// PARAMETREM `sinceHours`, nie stałą). Nie da się więc powiedzieć „to okno ma
// siedem dni" bez wykonania kodu. Po stronie testu pytanie jest rozstrzygalne:
// czy plik niesie datę i czy zamroził zegar.
//
// TRZY WARUNKI NARAZ (plik jest bombą, gdy zachodzą wszystkie):
//   1. niesie literał daty `20\d\d-\d\d-\d\d` (poza komentarzami),
//   2. NIE woła `vi.useFakeTimers` ani `vi.setSystemTime`,
//   3. importuje moduł produkcyjny czytający prawdziwy zegar (`Date.now()`
//      albo bezargumentowe `new Date()`), albo czyta go sam.
//
// Warunek 3 patrzy na importy BEZPOŚREDNIE. Świadomie, nie z lenistwa:
// domknięcie przechodnie wciąga przez barrele niemal cały graf modułów (na tym
// repozytorium 212 -> 497 plików), więc bramka przestałaby wskazywać winnego, a
// baseline stałby się spisem wszystkiego. Bezpośredni import jest granicą, którą
// autor testu ŚWIADOMIE przekracza, i to jego decyzję ta bramka pilnuje.
//
// CZEGO BRAMKA NIE ROZSTRZYGA - i nie ma rozstrzygać. Nie odróżnia KIERUNKU
// okna. Literał w przyszłości (`2099-01-15`) jest bezpieczny wobec okna
// wstecznego (`created_at >= now - X`), a niebezpieczny wobec okna w przód
// (terminy, wygaśnięcia). Rozróżnienie wymaga przeczytania produkcji, więc
// należy do człowieka przy triage'u; bramka pilnuje tylko tego, żeby lista nie
// rosła.
import { stripTsComments } from "../../../scripts/lib/stripTsComments";

export interface SourceFile {
  readonly file: string;
  readonly source: string;
}

export interface ClockBomb {
  readonly file: string;
  /** Ile literałów daty niesie plik - to jest liczba trzymana w baseline. */
  readonly literals: number;
  /** Najnowszy literał (ISO, bez strefy) - do porządkowania triage'u. */
  readonly newestLiteral: string | null;
  /** Czy plik czyta zegar SAM, czy przez zaimportowany moduł produkcyjny. */
  readonly via: "self" | "import";
}

/** `vi.setSystemTime(Date.now())` - zamrożenie POZORNE. Twarde zero. */
export interface AntiPatternHit {
  readonly file: string;
  readonly line: number;
}

export interface ClockFreezeScan {
  readonly bombs: readonly ClockBomb[];
  readonly antiPattern: readonly AntiPatternHit[];
  readonly testFiles: number;
  /** Pliki spełniające warunki 1 i 3 (z zamrożeniem i bez). */
  readonly withLiteralAndClock: number;
  /** Z nich te, które zegar zamrażają - czyli bezpieczne. */
  readonly frozen: number;
}

const DATE_LITERAL = /20\d\d-\d\d-\d\d/g;
/**
 * Zamrożenie zegara. Obok surowego `vi.useFakeTimers`/`vi.setSystemTime` liczy
 * się TAKŻE `freezeClock(...)` z `@/test/time`.
 *
 * Bez tego drugiego członu bramka karałaby dokładnie tę naprawę, którą sama
 * zaleca: plik zamrożony kanonicznym helperem nie wołałby `vi.*` wprost, więc
 * zostawałby na liście bomb na zawsze. Zmierzone na `donationsAdmin.server.test.ts`
 * - po rozbrojeniu nadal był liczony jako bomba, dopóki nie doszedł ten wzorzec.
 *
 * Liczy się też `vi.spyOn(Date, "now")`. To NIE jest egzotyka: zamraża zegar
 * skuteczniej niż `useFakeTimers` (nie rusza `setTimeout`, więc `waitFor` i
 * debounce'y działają), więc pliki mierzące TTL sięgają po nie świadomie -
 * `useSaveArticle.test.tsx:150` uzasadnia ten wybór wprost w komentarzu.
 * Bez tego członu bramka pokazywałaby poprawnie zamrożone pliki jako bomby.
 */
const FREEZE =
  /\bvi\s*\.\s*(?:useFakeTimers|setSystemTime)\s*\(|\bfreezeClock\s*\(|\bspyOn\s*\(\s*Date\s*,\s*["']now["']\s*\)/;
const CLOCK = /\bDate\s*\.\s*now\s*\(\s*\)|\bnew\s+Date\s*\(\s*\)/;
/**
 * ANTYWZORZEC. `vi.setSystemTime(Date.now())` kotwiczy zegar na „teraz w chwili
 * przebiegu", więc odległość do literału NADAL rośnie z każdą dobą. To nie jest
 * dług do zamrożenia - to jest błąd, i dlatego ma osobne, twarde zero.
 * Kanoniczny `advanceClock()` z `@/test/time` popycha zamrożony zegar bez tego
 * odczytu.
 */
const ANTI_PATTERN = /\bvi\s*\.\s*setSystemTime\s*\(\s*Date\s*\.\s*now\s*\(\s*\)/;

/**
 * WYŁĄCZENIE JEDNEGO PLIKU - własnych kontroli negatywnych tej bramki.
 *
 * Kontrola negatywna dowodzi, że bramka jest CZERWONA na złym wejściu, więc
 * MUSI to złe wejście zawierać: w nazwie przypadku i w syntetycznym źródle
 * podawanym skanerowi jako napis. Bez tego wyłączenia bramka zapalałaby się na
 * własnym dowodzie, że działa - a to uczy tylko jednego: nie pisać kontroli
 * negatywnych. Ten sam problem i to samo rozwiązanie opisuje nagłówek
 * `scripts/lib/stripComments.ts` („bramka, która czerwieni CI za opis defektu").
 *
 * Wyłączenie jest IMIENNE i jednoplikowe - nie katalogowe - żeby nie dało się
 * pod nie schować prawdziwego długu. Sam ten plik nie jest bombą: nie importuje
 * niczego, co czyta zegar.
 */
const SELF_TEST_FILE = "src/lib/ci/__tests__/clockFreeze.test.ts";

const IMPORT_SPECIFIER =
  /(?:^|\n)\s*(?:import|export)[\s\S]{0,400}?from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

const RESOLVE_SUFFIXES = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"];

export function isTestFile(file: string): boolean {
  return /\.(test|spec)\.(ts|tsx)$/.test(file);
}

/**
 * Moduł INFRASTRUKTURY TESTOWEJ (`src/test/**`): fabryki, atrapy, uprzęże.
 *
 * Traktujemy go jak CZĘŚĆ pliku testowego, który go importuje - jego literały
 * dat i jego zależność od zegara doliczają się do tego pliku, rekurencyjnie.
 *
 * DLACZEGO, na dwóch zmierzonych przykładach. Obie bomby, które faktycznie
 * padły przy CLOCK_SHIFT=1y, były dla wersji „tylko plik testowy" NIEWIDZIALNE:
 *
 *   * `RetentionTab.test.tsx` nie ma ANI JEDNEGO literału daty - kotwica
 *     `ADMIN_NOW = Date.parse("2026-08-18T10:00:00.000Z")` siedzi w
 *     `src/test/admin/pricingFixtures.ts:46` i karmi kilkanaście plików naraz;
 *   * `-api.public.newsletter.confirm.handler.test.ts` ma literały, ale kod
 *     produkcyjny wciąga przez uprząż `src/test/routeHarness`, więc BEZPOŚREDNI
 *     import produkcji z niego nie wychodzi.
 *
 * Jeden literał w takiej fabryce jest groźniejszy niż dziesięć w jednym teście,
 * bo tyka pod wszystkimi jej konsumentami naraz. Rozszerzenie jest OGRANICZONE
 * do `src/test/**` - dla modułów produkcyjnych nadal patrzymy wyłącznie na
 * import bezpośredni.
 */
export function isTestHelper(file: string): boolean {
  return file.startsWith("src/test/") && !isTestFile(file);
}

/** Plik brany pod uwagę w ogóle (test albo moduł, który test może zaimportować). */
export function isScannable(file: string): boolean {
  return /\.(ts|tsx)$/.test(file) && !file.endsWith(".d.ts");
}

function importSpecifiers(source: string): string[] {
  const out: string[] = [];
  IMPORT_SPECIFIER.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IMPORT_SPECIFIER.exec(source)) !== null) {
    const spec = match[1] ?? match[2] ?? match[3];
    if (spec) out.push(spec);
  }
  return out;
}

/** Normalizuje `a/b/../c` do `a/c`; ścieżki są zawsze POSIX-owe. */
function normalize(path: string): string {
  const parts: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}

function resolveSpecifier(
  spec: string,
  fromFile: string,
  known: ReadonlySet<string>,
): string | null {
  let base: string;
  if (spec.startsWith("@/")) {
    base = `src/${spec.slice(2)}`;
  } else if (spec.startsWith(".")) {
    const dir = fromFile.slice(0, fromFile.lastIndexOf("/"));
    base = normalize(`${dir}/${spec}`);
  } else {
    return null; // pakiet z node_modules - nie nasz kod
  }
  const stem = base.replace(/\.(ts|tsx|js|jsx)$/, "");
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = `${stem}${suffix}`;
    if (known.has(candidate)) return candidate;
  }
  return null;
}

function newestLiteralOf(source: string): string | null {
  const re = /(20\d\d-\d\d-\d\d)(?:[T ](\d\d:\d\d(?::\d\d)?))?/g;
  let best: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const value = match[2] ? `${match[1]}T${match[2]}` : match[1]!;
    if (best === null || value > best) best = value;
  }
  return best;
}

function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (source[i] === "\n") line += 1;
  return line;
}

export function scanClockFreeze(sources: readonly SourceFile[]): ClockFreezeScan {
  // Komentarze wygaszone RAZ: to repozytorium komentuje obficie i cytuje w
  // komentarzach daty awarii („Awaria z 2026-08-27"). Bez tego kroku bramka
  // liczyłaby własną dokumentację jako fixture'y - zmierzone: 255 plików
  // zamiast 212.
  const stripped = new Map<string, string>();
  for (const { file, source } of sources) stripped.set(file, stripTsComments(source));
  const known = new Set(stripped.keys());

  const readsClock = (file: string): boolean => CLOCK.test(stripped.get(file) ?? "");

  const bombs: ClockBomb[] = [];
  const antiPattern: AntiPatternHit[] = [];
  let testFiles = 0;
  let withLiteralAndClock = 0;
  let frozen = 0;

  // Domknięcie po infrastrukturze testowej: `src/test/**` liczy się jak część
  // pliku, który ją importuje (patrz `isTestHelper`).
  const helperClosure = new Map<string, string[]>();
  const closureOf = (start: string): string[] => {
    const cached = helperClosure.get(start);
    if (cached) return cached;
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const spec of importSpecifiers(stripped.get(current) ?? "")) {
        const target = resolveSpecifier(spec, current, known);
        if (target === null || seen.has(target) || !isTestHelper(target)) continue;
        seen.add(target);
        stack.push(target);
      }
    }
    const list = [...seen];
    helperClosure.set(start, list);
    return list;
  };

  for (const { file } of sources) {
    if (!isTestFile(file)) continue;
    testFiles += 1;
    const own = stripped.get(file)!;
    const helpers = closureOf(file);
    // LITERAŁY liczymy z SAMEGO pliku, ZALEŻNOŚĆ OD ZEGARA - także z uprzęży.
    // Uzasadnienie asymetrii w nagłówku `isTestHelper` i w opisie PR-a.
    const code = own;

    if (file !== SELF_TEST_FILE) {
      // Antywzorca szukamy w SAMYM pliku - `lineOf` musi wskazywać jego linię.
      const anti = ANTI_PATTERN.exec(own);
      if (anti) antiPattern.push({ file, line: lineOf(own, anti.index) });
    }

    DATE_LITERAL.lastIndex = 0;
    const literals = code.match(DATE_LITERAL)?.length ?? 0;
    if (literals === 0) continue;

    // Zegar: czytany przez sam plik, przez jego uprzęże, albo przez moduł
    // produkcyjny zaimportowany BEZPOŚREDNIO przez plik lub przez uprząż.
    const self = CLOCK.test(code);
    const viaImport =
      !self &&
      [file, ...helpers].some((from) =>
        importSpecifiers(stripped.get(from) ?? "").some((spec) => {
          const target = resolveSpecifier(spec, from, known);
          return (
            target !== null && !isTestFile(target) && !isTestHelper(target) && readsClock(target)
          );
        }),
      );
    if (!self && !viaImport) continue;

    withLiteralAndClock += 1;
    if (FREEZE.test(code)) {
      frozen += 1;
      continue;
    }
    bombs.push({
      file,
      literals,
      newestLiteral: newestLiteralOf(code),
      via: self ? "self" : "import",
    });
  }

  bombs.sort((a, b) => a.file.localeCompare(b.file));
  return { bombs, antiPattern, testFiles, withLiteralAndClock, frozen };
}

// ---------------------------------------------------------------------------
// ZAPADKA JEDNOKIERUNKOWA
// ---------------------------------------------------------------------------

export interface ClockFreezeReport {
  /** Plik spoza baseline'u z literałem i bez zamrożenia - NOWA bomba. */
  readonly fresh: readonly { readonly file: string; readonly literals: number }[];
  /** Plik, który dorobił literałów - zapadka nie puszcza w górę. */
  readonly grown: readonly {
    readonly file: string;
    readonly was: number;
    readonly now: number;
  }[];
  /** Plik rozbrojony albo odchudzony - baseline do zaktualizowania W DÓŁ. */
  readonly improved: readonly {
    readonly file: string;
    readonly was: number;
    readonly now: number;
  }[];
  /** Antywzorzec `setSystemTime(Date.now())` - twarde zero, bez baseline'u. */
  readonly antiPattern: readonly AntiPatternHit[];
  /**
   * Wpis baseline'u o pliku, którego w repozytorium NIE MA.
   *
   * Też jest czerwienią, i to nie z pedanterii: baseline jest spisem długu, a
   * wpis wskazujący nieistniejący plik jest o tym repozytorium nieprawdą.
   * Martwe wpisy zawyżają licznik („mamy 205 bomb"), przez co zapadka wygląda
   * na luźniejszą, niż jest, i ukrywają fakt, że ktoś skasował test zamiast go
   * rozbroić. Uwaga: plik ROZBROJONY nadal istnieje, więc trafia do
   * `improved`, a nie tutaj.
   */
  readonly stale: readonly { readonly file: string; readonly was: number }[];
  readonly bombFiles: number;
}

export function compareWithRatchet(
  scan: ClockFreezeScan,
  baseline: ReadonlyMap<string, number>,
  /** Wszystkie ZESKANOWANE pliki testowe - do wykrycia martwych wpisów. */
  knownTestFiles: ReadonlySet<string> = new Set(),
): ClockFreezeReport {
  const now = new Map(scan.bombs.map((b) => [b.file, b.literals] as const));
  const fresh: { file: string; literals: number }[] = [];
  const grown: { file: string; was: number; now: number }[] = [];
  const improved: { file: string; was: number; now: number }[] = [];

  for (const [file, literals] of now) {
    const was = baseline.get(file);
    if (was === undefined) fresh.push({ file, literals });
    else if (literals > was) grown.push({ file, was, now: literals });
    else if (literals < was) improved.push({ file, was, now: literals });
  }
  const stale: { file: string; was: number }[] = [];
  for (const [file, was] of baseline) {
    if (now.has(file)) continue;
    // Rozbrojony (plik istnieje, ale nie jest już bombą) -> poprawa.
    // Nieistniejący -> martwy wpis, do usunięcia z listy.
    if (knownTestFiles.size > 0 && !knownTestFiles.has(file)) stale.push({ file, was });
    else improved.push({ file, was, now: 0 });
  }

  return {
    fresh,
    grown,
    improved,
    antiPattern: scan.antiPattern,
    stale,
    bombFiles: now.size,
  };
}

export function ratchetFailed(report: ClockFreezeReport): boolean {
  return (
    report.fresh.length > 0 ||
    report.grown.length > 0 ||
    report.antiPattern.length > 0 ||
    report.stale.length > 0
  );
}

export function renderReport(report: ClockFreezeReport, baselineFiles: number): string {
  const lines: string[] = [];

  if (report.antiPattern.length > 0) {
    lines.push(
      `[clock-freeze] TWARDE ZERO NARUSZONE - ${report.antiPattern.length} x \`vi.setSystemTime(Date.now())\`:`,
      ...report.antiPattern.map((hit) => `  - ${hit.file}:${hit.line}`),
      "",
      "To NIE zamraża zegara wobec bomby kalendarzowej: kotwiczy go na „teraz w",
      'chwili przebiegu", więc odległość do literału nadal rośnie z każdą dobą.',
      "Zamroź na stałej: `freezeClock()` z `@/test/time`. Jeśli chodziło o",
      "POPCHNIĘCIE już zamrożonego zegara - `advanceClock(ms)` z tego samego modułu.",
      "",
    );
  }

  if (report.fresh.length > 0) {
    lines.push(
      `[clock-freeze] ${report.fresh.length} NOWYCH plików z literałem daty i bez zamrożenia zegara:`,
      ...report.fresh.map((e) => `  - ${e.file}  (${e.literals} literałów)`),
      "",
      "Taki test nie jest deterministyczny, tylko OPÓŹNIONY: przejdzie dziś,",
      "a padnie w dniu, w którym literał wypadnie z okna liczonego z `Date.now()`.",
      'Napraw, NIE przesuwając literału „na później" - to przestawia zapalnik:',
      "  freezeClock();                       // raz, na poziomie pliku",
      '  created_at: relativeIso(-2 * DZIEN)  // data WZGLĘDEM zamrożonego „teraz"',
      "Jeśli literał jest wejściem konwersji albo etykietą (kierunek okna go nie",
      "dotyczy) - dopisz plik do `scripts/lib/clockFreezeBaseline.ts` z krótkim",
      "uzasadnieniem. Baseline może tylko maleć.",
      "",
    );
  }

  if (report.grown.length > 0) {
    lines.push(
      `[clock-freeze] ${report.grown.length} plików DOŁOŻYŁO literałów (zapadka jest jednokierunkowa):`,
      ...report.grown.map((e) => `  - ${e.file}: ${e.was} -> ${e.now}`),
      "",
    );
  }

  if (report.stale.length > 0) {
    lines.push(
      `[clock-freeze] ${report.stale.length} MARTWYCH wpisów baseline'u - takich plików nie ma:`,
      ...report.stale.map((e) => `  - ${e.file}  (${e.was})`),
      "",
      "Baseline jest spisem długu, więc wpis o nieistniejącym pliku jest o tym",
      "repozytorium nieprawdą - i zawyża licznik, przez co zapadka wygląda na",
      "luźniejszą, niż jest. Usuń wpis: bun run check:clock-freeze --print-baseline",
      "",
    );
  }

  if (lines.length > 0) return lines.join("\n");

  const head = `[clock-freeze] OK - ${report.bombFiles} znanych plików z literałem bez zamrożenia (baseline: ${baselineFiles}), zero \`setSystemTime(Date.now())\`.`;
  if (report.improved.length === 0) return head;
  return [
    head,
    `[clock-freeze] ${report.improved.length} plików rozbrojonych albo odchudzonych - zaktualizuj baseline W DÓŁ:`,
    ...report.improved.slice(0, 20).map((e) => `  - ${e.file}: ${e.was} -> ${e.now}`),
    "Odśwież: bun run check:clock-freeze --print-baseline",
  ].join("\n");
}
