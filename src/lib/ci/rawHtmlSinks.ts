// Inwariant CI: KAŻDE `dangerouslySetInnerHTML` MA WPIS Z PISANYM UZASADNIENIEM.
// Nowe miejsce bez wpisu oblewa bramkę.
//
// ── PRZYCZYNA ŹRÓDŁOWA ──────────────────────────────────────────────────────
// Repo renderuje surowy HTML w 84 miejscach w 56 plikach i do tej pory trzymała
// to WYŁĄCZNIE konwencja. Piętnaście z tych miejsc leży w plikach, w których nie
// pada ANI JEDNA nazwa sanityzatora - czyli otwarcie takiego pliku nie pozwala
// rozstrzygnąć, czy wstawka jest bezpieczna (`<style>` ze stałej modułowej
// wygląda w diffie identycznie jak `<div>` z treścią z bazy). Repo samo opisuje
// tę dyscyplinę prozą - `src/lib/builder/widgetTextFields.ts` każe wprost
// „znajdź jego dangerouslySetInnerHTML, sprawdź NAZWĘ pola" - a to jest
// konwencja z komentarzem, nie bramka.
//
// Jedyną dotychczasową obroną były testy jednostkowe pojedynczych komponentów
// (`liveBlogBlock.test.tsx`, `officeParse.test.ts`, `sanitizeScriptPrefixBypass.
// test.ts`). Każdy z nich pokrywa miejsce, o którym ktoś JUŻ pomyślał - czyli
// dokładnie ten tryb awarii, który bramka ma zamknąć.
//
// ── POMIAR, KTÓRY DOWODZI, ŻE KLASA JEST ŻYWA ──────────────────────────────
// Asymetria siedzi wewnątrz JEDNEGO silnika renderującego bloki:
//   * `renderSpoiler` (blocks/renderer/molecules.tsx) pisze
//     `fnHtml.get(block.id) ?? sanitize(str(block.data, "html"))` i ma przy tym
//     komentarz, że fallback MUSI zostać sanityzowany,
//   * `renderParagraph` i `renderHtml` (blocks/renderer/atoms.tsx) piszą
//     `fnHtml.get(block.id) ?? str(block.data, "html")` - bez sanitizera.
// Drugi wariant jest dziś nieosiągalny tylko dlatego, że pre-pass
// `precomputeFootnotes` ustawia mapę BEZWARUNKOWO dla paragraph/html/spoiler
// i schodzi dokładnie w te kontenery, w które schodzi `renderChild`. To jest
// bezpieczeństwo przez zgodność dwóch rekursji w dwóch plikach, nie przez
// lokalną własność miejsca wstawki. Jeden nowy typ kontenera chodzony przez
// renderer i pominięty w pre-passie zamienia to w trwałe XSS z bazy.
//
// ── DLACZEGO PER PLIK + LICZBA + UZASADNIENIE ──────────────────────────────
// PER LINIĘ odpada z powodu, którego repo nauczyło się dwa razy
// (`UNKNOWN_CAST_BASELINE`, `HARDCODED_LANGUAGE_BASELINE`): lista kluczowana
// linią rozjeżdża się przy każdej edycji POWYŻEJ miejsca, „naprawą" staje się
// przenumerowanie pliku governance, a recenzent uczy się przyklepywać ten diff.
// PER PLIK SAM odpada, bo `blocks/renderer/atoms.tsx` trzyma dziewięć wstawek -
// dziesiąta, niesanityzowana, byłaby niewidzialna. Liczba zamyka tę dziurę
// (ten sam argument, który `unknownCasts.ts` stawia przeciw jednemu licznikowi
// globalnemu, tylko o poziom niżej).
// UZASADNIENIE jest elementem nowym i to ono zamienia ratchet w ALLOWLISTĘ:
// bez niego piętnaście miejsc bez sanityzatora w pliku zostaje policzonych,
// ale nadal nie da się ich zrecenzować. Puste albo zaślepkowe uzasadnienie
// oblewa, więc wpisu nie da się dodać po cichu.
//
// ── CZEGO NIE MIERZY - ŚWIADOMIE ───────────────────────────────────────────
// NIE sprawdza, czy użyty sanityzator jest WŁAŚCIWY dla danego ujścia:
// `hardenStyleCss` na prozie z edytora i `sanitizeHtml` na JSON-LD przejdą tak
// samo. Bramka liczy ujścia i wymaga pisanego powodu; ocena powodu zostaje po
// stronie review. Ta granica jest właśnie tym, dlaczego pole `why` jest
// obowiązkowe, a nie opcjonalne.
import { bezKomentarzy } from "./sourceScan";

/** Plik źródłowy poddany skanowi (ścieżka względna + treść). */
export interface ScannedSource {
  readonly file: string;
  readonly source: string;
}

/** Jedno miejsce renderujące surowy HTML. */
export interface RawHtmlSink {
  readonly file: string;
  /** 1-indeksowana linia wystąpienia. */
  readonly line: number;
  /** Dosłowna treść linii ze ŹRÓDŁA (przycięta) - żeby log wskazywał kod. */
  readonly snippet: string;
}

/** Wpis allowlisty: ile miejsc w pliku i DLACZEGO wolno im tam być. */
export interface AllowlistEntry {
  readonly sites: number;
  readonly why: string;
}

/**
 * Nazwa ujścia, BEZ `\b` po żadnej stronie.
 *
 * Granica słowa zawęziłaby dopasowanie, a każde zawężenie tej bramki to
 * fałszywy NEGATYW - a więc cicha zieleń, najgroźniejszy tryb awarii skanera
 * tekstowego (patrz `sourceScan.ts`). Nadmiarowe trafienie kosztuje jeden wpis
 * na liście; brakujące kosztuje niezauważone ujście.
 */
const SINK = /dangerouslySetInnerHTML/g;

/** Minimalna długość uzasadnienia - krótsze nie niesie treści, tylko zgodę. */
const MIN_WHY = 20;

/** Zaślepki, które wyglądają jak uzasadnienie, a są obietnicą na później. */
const PLACEHOLDER_WHY = /^(todo|tbd|fixme|xxx|wip|n\/?a|-+|\?+)\b/i;

export function isScannable(file: string): boolean {
  if (!/\.tsx?$/.test(file)) return false;
  if (/\.(test|spec)\.tsx?$/.test(file)) return false;
  if (file.includes("/__tests__/")) return false;
  // Moduł samej bramki: mówi o ujściu prozą i wzorcem, nie używa go.
  // `bezKomentarzy` maskuje komentarze, ale wzorzec i treść raportu to już
  // kod - to samo zabezpieczenie co `staleNeverCasts.ts` stawia na sobie.
  if (file.endsWith("src/lib/ci/rawHtmlSinks.ts")) return false;
  return true;
}

/**
 * Miejsca renderujące surowy HTML, po zamaskowaniu komentarzy.
 *
 * Maskowanie jest tu NOŚNE, a nie kosmetyczne: surowy grep po repo daje 132
 * trafienia, z czego około trzydziestu siedmiu to wzmianki w komentarzach -
 * to repozytorium dokumentuje tę dyscyplinę prozą w kilkunastu modułach naraz.
 * Bramka licząca własną dokumentację żąda wpisów dla plików, które żadnego
 * ujścia nie mają, a „naprawą" staje się skreślenie zdania, które tłumaczyło,
 * czego bramka pilnuje.
 *
 * Napisy zostają NIETKNIĘTE (kontrakt `bezKomentarzy`), więc nazwa ujścia
 * w literale też się liczy - to jest zamierzone: literał trafia do kodu,
 * komentarz nie.
 */
export function scanRawHtmlSinks(sources: readonly ScannedSource[]): RawHtmlSink[] {
  const out: RawHtmlSink[] = [];
  for (const { file, source: raw } of sources) {
    const masked = bezKomentarzy(raw);
    const lines = raw.split("\n");
    for (const match of masked.matchAll(SINK)) {
      const index = match.index ?? 0;
      const line = masked.slice(0, index).split("\n").length;
      out.push({
        file,
        line,
        // Fragment z SUROWEGO źródła - zamaskowana linia pokazałaby spacje.
        snippet: (lines[line - 1] ?? "").trim().slice(0, 120),
      });
    }
  }
  return out;
}

export function countsByFile(hits: readonly RawHtmlSink[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const hit of hits) out.set(hit.file, (out.get(hit.file) ?? 0) + 1);
  return out;
}

export interface RawHtmlReport {
  /** Plik z ujściem, którego nie ma na liście - nowy kod nie może tak zacząć. */
  readonly fresh: readonly { readonly file: string; readonly count: number }[];
  /** Plik, w którym ujść PRZYBYŁO ponad wpis. */
  readonly grown: readonly {
    readonly file: string;
    readonly was: number;
    readonly now: number;
  }[];
  /** Plik z ujściami, którego wpis nie niesie uzasadnienia. */
  readonly unjustified: readonly string[];
  /** Plik, w którym ujść UBYŁO - lista do zaktualizowania w dół (ostrzeżenie). */
  readonly improved: readonly {
    readonly file: string;
    readonly was: number;
    readonly now: number;
  }[];
  /** Wpis na plik, który nie ma już ani jednego ujścia (ostrzeżenie). */
  readonly stale: readonly string[];
  readonly total: number;
}

/** Uzasadnienie puste, za krótkie albo zaślepkowe nie jest uzasadnieniem. */
function brakUzasadnienia(why: string): boolean {
  const trimmed = why.trim();
  return trimmed.length < MIN_WHY || PLACEHOLDER_WHY.test(trimmed);
}

/**
 * Porównanie stanu ze zmierzoną allowlistą.
 *
 * Uzasadnienia sprawdzamy tylko dla wpisów, które COŚ dziś pokrywają: wpis na
 * plik bez ujść jest `stale` (sprzątanie), a nie naruszeniem - inaczej bramka
 * karałaby za usunięcie ujścia, czyli za dokładnie ten ruch, którego oczekuje.
 */
export function compareWithAllowlist(
  hits: readonly RawHtmlSink[],
  allowlist: ReadonlyMap<string, AllowlistEntry>,
): RawHtmlReport {
  const now = countsByFile(hits);
  const fresh: { file: string; count: number }[] = [];
  const grown: { file: string; was: number; now: number }[] = [];
  const improved: { file: string; was: number; now: number }[] = [];
  const unjustified: string[] = [];

  for (const [file, count] of now) {
    const entry = allowlist.get(file);
    if (entry === undefined) {
      fresh.push({ file, count });
      continue;
    }
    if (brakUzasadnienia(entry.why)) unjustified.push(file);
    if (count > entry.sites) grown.push({ file, was: entry.sites, now: count });
    else if (count < entry.sites) improved.push({ file, was: entry.sites, now: count });
  }
  const stale: string[] = [];
  for (const [file, entry] of allowlist) {
    if (now.has(file)) continue;
    improved.push({ file, was: entry.sites, now: 0 });
    stale.push(file);
  }

  return { fresh, grown, unjustified, improved, stale, total: hits.length };
}

/**
 * Oblewa też na `total === 0`.
 *
 * Skaner, który przestał widzieć osiemdziesiąt cztery znane ujścia, wygląda
 * w logu identycznie jak czyste repozytorium - a jest zepsuty. Ta sama reguła
 * co `gateCoverageFailed` na `totalGates === 0`: brak trafień w bramce
 * tekstowej to awaria, nie sukces.
 */
export function rawHtmlFailed(report: RawHtmlReport): boolean {
  return (
    report.total === 0 ||
    report.fresh.length > 0 ||
    report.grown.length > 0 ||
    report.unjustified.length > 0
  );
}

export function renderRawHtmlSinkReport(report: RawHtmlReport, allowlistFiles: number): string {
  if (report.total === 0) {
    return [
      "✗ [raw-html-sinks] skan nie znalazł ANI JEDNEGO miejsca renderującego surowy HTML.",
      "  To nie jest zielone światło - to zepsuty skan albo przeniesiony katalog źródeł.",
    ].join("\n");
  }

  const lines: string[] = [];

  if (report.fresh.length > 0) {
    lines.push(
      `✗ [raw-html-sinks] ${report.fresh.length} plików renderuje surowy HTML BEZ wpisu na liście:`,
      ...report.fresh.map((e) => `    ${e.file}  (${e.count})`),
      "",
      "Zanim dopiszesz wpis, sprawdź, do której z czterech kategorii należy miejsce:",
      "  * treść od użytkownika/z bazy -> `sanitizeHtml` / `sanitizeMarkdownHtml` z `@/lib/sanitize`,",
      "  * CSS wstrzykiwany w `<style>` -> `hardenStyleCss` z `@/lib/sanitizePure`",
      "    (element raw-text: encje NIE działają, liczy się ucięcie `</style>`),",
      '  * JSON-LD w `<script type="application/ld+json">` -> `safeJsonLd` z `@/lib/seo/jsonld`,',
      "  * zwykły tekst, nie HTML -> wstaw jako węzeł Reacta, bez ujścia w ogóle",
      "    (wzorce: `ClubInlineText.tsx`, `SearchSnippet.tsx`).",
      "Dopiero gdy żadna nie pasuje, dopisz plik do `scripts/lib/rawHtmlSinkBaseline.ts`",
      "razem z powodem - wpis bez powodu oblewa tak samo jak brak wpisu.",
    );
  }

  if (report.grown.length > 0) {
    lines.push(
      `✗ [raw-html-sinks] ${report.grown.length} plików ma WIĘCEJ ujść, niż uzasadnia wpis:`,
      ...report.grown.map((e) => `    ${e.file}: ${e.was} -> ${e.now}`),
      "",
      "Liczba jest w liście po to, żeby dziesiąta wstawka w pliku, który ma już",
      "dziewięć uzasadnionych, nie była niewidzialna. Uzasadnij nową i podnieś liczbę.",
    );
  }

  if (report.unjustified.length > 0) {
    lines.push(
      `✗ [raw-html-sinks] ${report.unjustified.length} wpisów nie niesie uzasadnienia:`,
      ...report.unjustified.map((file) => `    ${file}`),
      "",
      `Pole \`why\` musi mieć co najmniej ${MIN_WHY} znaków i nie może zaczynać się od`,
      "zaślepki (`TODO`, `TBD`, `FIXME`). Napisz, CO trafia do ujścia i CO to czyści -",
      "bez tego lista jest ratchetem, a nie allowlistą, i nie da się jej zrecenzować.",
    );
  }

  if (lines.length > 0) return lines.join("\n");

  const head = `✓ [raw-html-sinks] OK - ${report.total} uzasadnionych miejsc w ${allowlistFiles} plikach.`;
  const tail: string[] = [];
  if (report.improved.length > 0) {
    tail.push(
      `⚠ [raw-html-sinks] ${report.improved.length} plików ma MNIEJ ujść niż lista - zaktualizuj ją w dół:`,
      ...report.improved.slice(0, 20).map((e) => `    ${e.file}: ${e.was} -> ${e.now}`),
    );
  }
  if (report.stale.length > 0) {
    tail.push(
      `⚠ [raw-html-sinks] ${report.stale.length} wpisów bez ani jednego ujścia (do usunięcia): ${report.stale.join(", ")}`,
    );
  }
  if (tail.length > 0) tail.push("Odśwież: bun run check:raw-html-sinks --print-baseline");
  return [head, ...tail].join("\n");
}
