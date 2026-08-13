// Inwariant CI: TEKST DLA UŻYTKOWNIKA NIE ROZGAŁĘZIA SIĘ PO JĘZYKU W KODZIE.
//
// TRZY POSTACIE TEGO SAMEGO DŁUGU:
//
//   isPl ? "Zapisz" : "Save"                       // ternary-isPl
//   lang === "pl" ? "Zapisz" : "Save"              // ternary-lang
//   l("Zapisz", "Save")   /  L(...)  /  T(...)     // twin-helper
//
// DLACZEGO TO JEST DŁUG, A NIE STYL. Każda z tych postaci:
//   * omija słownik, więc bramka parytetu PL/EN nie ma czego porównać - tekst
//     istnieje wyłącznie w kodzie i nikt nie wie, że istnieje;
//   * omija bramkę rozjazdu kod<->słownik (`check:i18n-parity`), bo nie ma tu
//     żadnego klucza;
//   * zamyka drogę do trzeciego języka: dodanie go wymaga dotknięcia 1 641
//     miejsc, a nie jednego pliku ze słownikiem;
//   * rozjeżdża się cicho przy edycji - poprawka literówki w jednej gałęzi
//     ternary'ego nie ma jak przypomnieć o drugiej.
//
// STAN ZMIERZONY PRZY WDROŻENIU: 1 641 wystąpień w 166 plikach (894 bliźniaki
// pomocnicze, 621 ternariów po `lang`, 126 po `isPl`). Powierzchnia publiczna
// to 231 z nich - resztę niesie panel.
//
// DLACZEGO RATCHET PER PLIK, A NIE JEDEN LICZNIK. Licznik globalny da się
// skompensować: ktoś ścina dwadzieścia wystąpień w jednym pliku i dopisuje
// dwadzieścia w innym, a bramka jest zielona. Lista per plik wymusza kierunek
// w KAŻDYM pliku osobno, a plik nieobecny na liście musi mieć ZERO - czyli
// nowy kod nie ma jak zacząć od długu.
//
// CZEGO NIE MIERZY - świadomie:
//   * `lang === "pl" ? plWartość : enWartość` na ZMIENNYCH (nie literałach) -
//     to zwykle wybór kolumny z bazy (`title_pl` vs `title_en`), czyli robota
//     `pickLocalized`, a nie tekst w kodzie; osobna klasa, osobna zmiana;
//   * plików testowych - tam dwujęzyczny literał jest danymi testu;
//   * słowników `i18n-*.ts` i `locale/*.ts` - one z definicji trzymają oba
//     języki obok siebie.

import { maskComments } from "@/lib/ci/i18nKeyUsage";

export interface ScannedSource {
  readonly file: string;
  readonly source: string;
}

export type HardcodedKind =
  | "ternary-isPl"
  | "ternary-lang"
  | "twin-helper"
  | "manual-lang-code"
  | "same-both-branches";

export interface HardcodedHit {
  readonly file: string;
  readonly line: number;
  readonly kind: HardcodedKind;
  readonly snippet: string;
}

/**
 * Wzorce w kolejności od najbardziej jednoznacznego. Kolejność ma znaczenie:
 * pierwsze dopasowanie w danym miejscu wygrywa, więc szczególne przypadki
 * (kod języka, identyczne gałęzie) muszą stać PRZED klasą ogólną.
 *
 * DLACZEGO ROZDZIELAMY TRZY RZECZY, KTÓRE WYGLĄDAJĄ JAK JEDNA. Pierwsza wersja
 * tej bramki liczyła każdy `isPl ? "…" : "…"` jako „nieprzetłumaczony tekst"
 * i dawała liczbę, z którą nie da się nic zrobić:
 *   * `isPl ? "pl" : "en"` to KOD JĘZYKA, nie tekst - kanoniczny zapis to
 *     `uiLang(i18n.language)` z `lib/i18n/format.ts`; do słownika nie ma tu
 *     czego przenosić;
 *   * `isPl ? "auto" : "auto"` to IDENTYCZNE gałęzie, czyli sam ternary jest
 *     zbędny - to defekt do usunięcia, nie robota tłumacza;
 *   * `isPl ? row.title_pl : row.title_en` to WYBÓR KOLUMNY - robota
 *     `pickLocalized`, świadomie poza zasięgiem (patrz nagłówek pliku).
 * Zostaje klasa właściwa: literał tekstowy w dwóch językach.
 */
const PATTERNS: readonly { readonly kind: HardcodedKind; readonly rx: RegExp }[] = [
  {
    kind: "same-both-branches",
    rx: /\b(?:isPl|lang(?:uage)?\s*===\s*["']pl["'])\s*\?\s*(["'])([^"']*)\1\s*:\s*(["'])\2\3/g,
  },
  {
    kind: "manual-lang-code",
    rx: /\b(?:isPl|lang(?:uage)?\s*===\s*["']pl["'])\s*\?\s*["']pl["']\s*:\s*["']en["']/g,
  },
  { kind: "ternary-isPl", rx: /\bisPl\s*\?\s*["'`]/g },
  { kind: "ternary-lang", rx: /\blang(?:uage)?\s*===\s*["']pl["']\s*\?\s*["'`]/g },
  // Pomocnik-bliźniak: jednoliterowa nazwa i DWA literały tekstowe.
  { kind: "twin-helper", rx: /\b[lLT]\(\s*["'][^"']{2,}["']\s*,\s*["'][^"']{2,}["']\s*\)/g },
];

export function isScannable(file: string): boolean {
  if (!/\.tsx?$/.test(file)) return false;
  if (/\.(test|spec)\.tsx?$/.test(file)) return false;
  if (file.includes("/__tests__/")) return false;
  // Słowniki trzymają oba języki z definicji.
  if (/^src\/lib\/i18n-/.test(file)) return false;
  if (/^src\/lib\/locale\//.test(file)) return false;
  return true;
}

export function scanHardcodedLanguage(sources: readonly ScannedSource[]): HardcodedHit[] {
  const out: HardcodedHit[] = [];
  for (const { file, source: raw } of sources) {
    // Komentarze maskujemy PRZED skanem: bez tego bramka liczy własną
    // dokumentację (opis wzorca `isPl ? "pl" : "en"` w tym pliku) i komentarze
    // typu „ten panel szedł wcześniej przez ręczne ternary". `maskComments`
    // zachowuje długość i podział na linie, więc numery linii zostają prawdziwe.
    const source = maskComments(raw);
    const lines = raw.split("\n");
    // Jedno miejsce = jedno trafienie. Bez tego `isPl ? "pl" : "en"` liczyłby
    // się dwa razy: raz jako kod języka, raz jako klasa ogólna.
    const claimed = new Set<number>();
    for (const { kind, rx } of PATTERNS) {
      for (const match of source.matchAll(rx)) {
        const index = match.index ?? 0;
        if (claimed.has(index)) continue;
        claimed.add(index);
        const line = source.slice(0, index).split("\n").length;
        out.push({ file, line, kind, snippet: (lines[line - 1] ?? "").trim().slice(0, 120) });
      }
    }
  }
  return out;
}

/** Rozkład trafień na klasy - do raportu, bo każda klasa ma inną naprawę. */
export function countsByKind(hits: readonly HardcodedHit[]): Map<HardcodedKind, number> {
  const out = new Map<HardcodedKind, number>();
  for (const hit of hits) out.set(hit.kind, (out.get(hit.kind) ?? 0) + 1);
  return out;
}

/** Liczba trafień per plik - postać wpisu w zamrożonym długu. */
export function countsByFile(hits: readonly HardcodedHit[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const hit of hits) out.set(hit.file, (out.get(hit.file) ?? 0) + 1);
  return out;
}

export interface RatchetReport {
  /** Plik poza baseline'em z niezerowym długiem - nowy kod nie może go mieć. */
  readonly fresh: readonly { readonly file: string; readonly count: number }[];
  /** Plik, który dług POWIĘKSZYŁ. */
  readonly grown: readonly {
    readonly file: string;
    readonly was: number;
    readonly now: number;
  }[];
  /** Plik, który dług zmniejszył - baseline do zaktualizowania (w dół). */
  readonly improved: readonly {
    readonly file: string;
    readonly was: number;
    readonly now: number;
  }[];
  readonly total: number;
}

export function compareWithRatchet(
  hits: readonly HardcodedHit[],
  baseline: ReadonlyMap<string, number>,
): RatchetReport {
  const now = countsByFile(hits);
  const fresh: { file: string; count: number }[] = [];
  const grown: { file: string; was: number; now: number }[] = [];
  const improved: { file: string; was: number; now: number }[] = [];

  for (const [file, count] of now) {
    const was = baseline.get(file);
    if (was === undefined) fresh.push({ file, count });
    else if (count > was) grown.push({ file, was, now: count });
    else if (count < was) improved.push({ file, was, now: count });
  }
  for (const [file, was] of baseline) {
    if (!now.has(file)) improved.push({ file, was, now: 0 });
  }
  return { fresh, grown, improved, total: hits.length };
}

/**
 * Bramka pada na NOWYM długu i na WZROŚCIE. Poprawa (`improved`) nie oblewa -
 * inaczej każde ścięcie kilku wystąpień wymuszałoby edycję baseline'u w tym
 * samym commicie i zniechęcało do drobnych porządków. Runner wypisuje ją jako
 * podpowiedź do odświeżenia listy.
 */
export function ratchetFailed(report: RatchetReport): boolean {
  return report.fresh.length > 0 || report.grown.length > 0;
}

export function renderRatchetReport(report: RatchetReport, baselineFiles: number): string {
  const lines: string[] = [];
  if (report.fresh.length > 0) {
    lines.push(
      `[i18n-hardcoded] ${report.fresh.length} plików z NOWYM dwujęzycznym tekstem w kodzie:`,
      ...report.fresh.map((entry) => `  - ${entry.file}  (${entry.count})`),
      "",
      "Tekst dla użytkownika idzie do słownika (`i18n-*.ts` / `locale/*.ts`) i jest",
      "wołany przez `t(\"klucz\")`. Ternary po języku omija bramkę parytetu PL/EN,",
      "bramkę rozjazdu kod<->słownik i zamyka drogę do trzeciego języka.",
    );
  }
  if (report.grown.length > 0) {
    lines.push(
      `[i18n-hardcoded] ${report.grown.length} plików POWIĘKSZYŁO dług:`,
      ...report.grown.map((entry) => `  - ${entry.file}: ${entry.was} -> ${entry.now}`),
    );
  }
  if (lines.length === 0) {
    const head = `[i18n-hardcoded] OK - ${report.total} znanych wystąpień w ${baselineFiles} plikach (ratchet trzyma kierunek).`;
    if (report.improved.length === 0) return head;
    return [
      head,
      `[i18n-hardcoded] ${report.improved.length} plików ma MNIEJ długu niż baseline - zaktualizuj listę w dół:`,
      ...report.improved
        .slice(0, 20)
        .map((entry) => `  - ${entry.file}: ${entry.was} -> ${entry.now}`),
      "Odśwież: bun run check:i18n-hardcoded --print-baseline",
    ].join("\n");
  }
  return lines.join("\n");
}
