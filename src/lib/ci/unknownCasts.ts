// Inwariant CI: RZUTOWANIE `as unknown as` MOŻE TYLKO ZNIKAĆ.
//
// CZYM JEST TEN DŁUG. `x as unknown as T` omija kontrolę typów dokładnie tak
// samo skutecznie jak `as any` - z tą różnicą, że nie zapala
// `@typescript-eslint/no-explicit-any`, więc przechodzi przez review jako
// „ostrożny cast". Repo ma 5 ręcznych `as any` i pilnuje ich regułą lintera;
// ta sama klasa pod inną składnią liczyła 362 wystąpienia i nie pilnował jej
// nikt. To jedyna pozycja typowania, która rosła między audytami.
//
// CZEGO POMIAR NAUCZYŁ. Większość tych rzutowań NIE była „granicą bazy", jak
// głosił komentarz przy wielu z nich. Cztery moduły CRM miały wspólną przyczynę
// źródłową w JEDNEJ literówce: własna kopia typu buildera PostgREST deklarowała
// `then` niezgodnie z `PromiseLike`, więc kompilator nie umiał uznać zapytania
// za awaitowalne - i każde `await` obchodzono rzutowaniem. Naprawa typu
// (`lib/supabase/looseQuery.ts`) skasowała 69 rzutowań bez zmiany ani jednej
// linii logiki. Kolejne 35 to ręczne powtórzenia istniejącego pomocnika
// `toJson()`, który powstał właśnie po to, żeby ten cast miał JEDNO audytowane
// miejsce.
//
// DLACZEGO RATCHET PER PLIK, A NIE PRÓG ZERO. Zero jest tu nieosiągalne i
// nieuczciwe: część rzutowań stoi na realnej granicy, gdzie kolumna istnieje
// w bazie, a nie ma jej jeszcze w wygenerowanych typach (`explicit`,
// `episode_type` z migracji 20260725090500). Te są udokumentowane i pilnowane
// od drugiej strony przez `check:types-freshness`. Ratchet per plik wymusza
// kierunek tam, gdzie dług jest przypadkowy, i nie każe kłamać tam, gdzie nie
// jest - a plik nieobecny na liście musi mieć ZERO, więc nowy kod nie ma jak
// zacząć z długiem.
//
// DLACZEGO NIE JEDEN LICZNIK GLOBALNY. Byłby do skompensowania: ścięcie
// dziesięciu rzutowań w jednym pliku „opłacałoby" dopisanie dziesięciu w innym.
// Ta sama lekcja co przy `check:i18n-hardcoded`.
import { maskComments } from "./i18nKeyUsage";

export interface ScannedSource {
  readonly file: string;
  readonly source: string;
}

export interface UnknownCastHit {
  readonly file: string;
  /** 1-indeksowana linia wystąpienia. */
  readonly line: number;
  /** Nazwa typu docelowego - do raportu („na co się rzutuje"). */
  readonly target: string;
}

/**
 * `as unknown as T`. Komentarze są maskowane PRZED skanem, żeby bramka nie
 * liczyła własnej dokumentacji ani komentarzy typu „tu było `as unknown as`".
 *
 * TRZY POSTACIE CELU, bo wszystkie trzy występują w repo:
 *   `as unknown as Widget`                nazwa (z opcjonalnym generykiem),
 *   `as unknown as { id: string }`        literał typu obiektowego,
 *   `as unknown as (fn: string) => void`  TYP FUNKCYJNY.
 *
 * Trzecia postać była pominięta w pierwszej wersji i to była dziura w ratchecie:
 * `supabase.rpc as unknown as (fn: string, args: …) => PromiseLike<…>`
 * (`src/lib/experts/materials.ts`) nie wchodziło do licznika, więc dołożenie
 * kolejnych rzutowań na typ funkcyjny NIE podnosiło progu i bramka zostawała
 * zielona wbrew inwariantowi, którego pilnuje. Zgłoszone w review PR-a #235.
 */
const CAST = /\bas\s+unknown\s+as\s+([A-Za-z_$][\w$.]*(?:<[^<>]*>)?|\{|\()/g;

export function isScannable(file: string): boolean {
  if (!/\.tsx?$/.test(file)) return false;
  if (/\.(test|spec)\.tsx?$/.test(file)) return false;
  if (file.includes("/__tests__/")) return false;
  return true;
}

export function scanUnknownCasts(sources: readonly ScannedSource[]): UnknownCastHit[] {
  const out: UnknownCastHit[] = [];
  for (const { file, source: raw } of sources) {
    const source = maskComments(raw);
    for (const match of source.matchAll(CAST)) {
      const index = match.index ?? 0;
      out.push({
        file,
        line: source.slice(0, index).split("\n").length,
        target: match[1],
      });
    }
  }
  return out;
}

export function countsByFile(hits: readonly UnknownCastHit[]): Map<string, number> {
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
  hits: readonly UnknownCastHit[],
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

/** Bramka pada na NOWYM długu i na WZROŚCIE; poprawa jest tylko podpowiedzią. */
export function ratchetFailed(report: RatchetReport): boolean {
  return report.fresh.length > 0 || report.grown.length > 0;
}

export function renderRatchetReport(report: RatchetReport, baselineFiles: number): string {
  const lines: string[] = [];
  if (report.fresh.length > 0) {
    lines.push(
      `[unknown-casts] ${report.fresh.length} plików z NOWYM rzutowaniem \`as unknown as\`:`,
      ...report.fresh.map((e) => `  - ${e.file}  (${e.count})`),
      "",
      "`as unknown as T` omija kontrolę typów tak samo jak `as any`, tylko nie zapala",
      "reguły lintera. Zanim dopiszesz kolejne, sprawdź trzy najczęstsze przyczyny:",
      "  * builder zapytań spoza wygenerowanych typów -> `lib/supabase/looseQuery.ts`,",
      "  * wartość do kolumny jsonb -> `toJson()` z `lib/builder/types`,",
      "  * kształt wiersza z zewnątrz -> strażnik (`x is T`) albo parser, nie rzutowanie.",
    );
  }
  if (report.grown.length > 0) {
    lines.push(
      `[unknown-casts] ${report.grown.length} plików POWIĘKSZYŁO dług:`,
      ...report.grown.map((e) => `  - ${e.file}: ${e.was} -> ${e.now}`),
    );
  }
  if (lines.length === 0) {
    const head = `[unknown-casts] OK - ${report.total} znanych rzutowań w ${baselineFiles} plikach (ratchet trzyma kierunek).`;
    if (report.improved.length === 0) return head;
    return [
      head,
      `[unknown-casts] ${report.improved.length} plików ma MNIEJ długu niż baseline - zaktualizuj listę w dół:`,
      ...report.improved.slice(0, 20).map((e) => `  - ${e.file}: ${e.was} -> ${e.now}`),
      "Odśwież: bun run check:unknown-casts --print-baseline",
    ].join("\n");
  }
  return lines.join("\n");
}
