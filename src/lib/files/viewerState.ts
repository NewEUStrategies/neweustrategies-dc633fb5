// Stan podglądu dokumentu - czysta warstwa decyzji.
//
// DLACZEGO TO WYSZŁO Z KOMPONENTU. `DocumentViewerBody.tsx` miał cztery
// niezależne czytniki (.docx, .xlsx, .pptx, tekst/CSV), a KAŻDY z nich
// podejmował tę samą sekwencję decyzji wewnątrz JSX-a: „stary format?" ->
// „nie udało się pobrać albo sparsować?" -> „jeszcze mielimy?" -> „pusto?" ->
// „pokaż". Ta sama reguła, przepisana trzy razy, w trzech miejscach, z których
// każde wymagało do sprawdzenia pełnego renderu z fetchem i parserem naraz.
// Dlatego funkcjonalność stała na absolutnym zerze pokrycia (audyt 18.08,
// MODUŁ 7: 5 plików, 0 z 72 funkcji): koszt wejścia był nieproporcjonalny do
// tego, co dało się udowodnić.
//
// Tutaj reguła jest JEDNA i jest danymi. Komponent staje się `switch` po
// `panel.kind`, a każda gałąź decyzji ma swój test bez DOM-u.
//
// FUNKCJE ZWRACAJĄ KLUCZ i18n, NIE NAPIS. To zasada repozytorium i ma tu
// konkretny skutek: test reguły nie zmienia się, gdy redakcja przepisze
// komunikat, a zniknięcie klucza ze słownika oblewa test renderu, który używa
// prawdziwego `t`.

import { extensionOf } from "./fileKinds";

/** Klucze komunikatów podglądu - jedno miejsce, wspólne dla czytników. */
export const VIEWER_LABEL_KEYS = {
  legacyFormat: "fileViewer.legacyFormat",
  error: "fileViewer.error",
  protectedHint: "fileViewer.protectedHint",
  parsing: "fileViewer.parsing",
  loading: "fileViewer.loading",
  emptyDocument: "fileViewer.emptyDocument",
  unsupported: "fileViewer.unsupported",
} as const;

/**
 * Co pokazać zamiast treści (albo: pokaż treść). `kind: "ready"` znaczy
 * „reguła nie ma nic do powiedzenia, renderuj dokument".
 */
export type ViewerPanel =
  | { kind: "busy"; labelKey: string }
  | { kind: "failure"; labelKey: string; hintKey: string | null }
  | { kind: "empty"; labelKey: string }
  | { kind: "ready" };

export interface OfficePanelInput {
  /** Nazwa pliku - stąd bierze się rozpoznanie starego formatu Office. */
  fileName: string;
  /** Rozszerzenie sprzed pakietu OOXML, którego ten czytnik NIE otworzy. */
  legacyExtension: "doc" | "xls" | "ppt";
  /** Pobranie zawartości padło (HTTP != 2xx albo błąd sieci). */
  fetchFailed: boolean;
  /** Parser odrzucił zawartość (plik uszkodzony, zaszyfrowany, obcy format). */
  parseFailed: boolean;
  /** Trwa pobieranie. */
  loading: boolean;
  /** Parser już oddał wynik (choćby pusty). */
  hasContent: boolean;
  /** Wynik parsera nie ma nic do pokazania. */
  isEmpty: boolean;
  /**
   * Podpowiedź przy błędzie. Tylko czytnik Worda ją podaje - dla arkusza
   * i prezentacji „plik może być zaszyfrowany lub uszkodzony" byłoby zgadywaniem.
   */
  failureHintKey?: string | null;
}

/**
 * Jedna reguła stanu dla WSZYSTKICH trzech czytników biurowych.
 *
 * Kolejność warunków jest częścią kontraktu, nie stylem zapisu:
 *   1. stary format rozstrzyga się z samej NAZWY - przed pobraniem czegokolwiek,
 *      bo ściąganie kilkunastu megabajtów .doc tylko po to, żeby powiedzieć
 *      „pobierz plik", jest marnowaniem transferu użytkownika;
 *   2. błąd wygrywa z „ładowaniem" - inaczej nieudane pobranie kręciłoby
 *      spinnerem w nieskończoność;
 *   3. „jeszcze nie ma treści" wygrywa z „pusto" - inaczej każdy dokument
 *      mrugałby komunikatem „brak treści", zanim parser skończy.
 */
export function officePanel(input: OfficePanelInput): ViewerPanel {
  if (extensionOf(input.fileName) === input.legacyExtension) {
    return { kind: "failure", labelKey: VIEWER_LABEL_KEYS.legacyFormat, hintKey: null };
  }
  if (input.fetchFailed || input.parseFailed) {
    return {
      kind: "failure",
      labelKey: VIEWER_LABEL_KEYS.error,
      hintKey: input.failureHintKey ?? null,
    };
  }
  if (input.loading || !input.hasContent) {
    return { kind: "busy", labelKey: VIEWER_LABEL_KEYS.parsing };
  }
  if (input.isEmpty) {
    return { kind: "empty", labelKey: VIEWER_LABEL_KEYS.emptyDocument };
  }
  return { kind: "ready" };
}

/**
 * Czytnik tekstu/CSV. Nie ma tu osobnego „parsowania" - treść albo jest,
 * albo jeszcze leci - więc etykieta zajętości jest inna niż w biurowych.
 */
export function textPanel(input: { fetchFailed: boolean; hasText: boolean }): ViewerPanel {
  if (input.fetchFailed) {
    return { kind: "failure", labelKey: VIEWER_LABEL_KEYS.error, hintKey: null };
  }
  if (!input.hasText) return { kind: "busy", labelKey: VIEWER_LABEL_KEYS.loading };
  return { kind: "ready" };
}

/**
 * Który arkusz jest aktywny. Skoroszyt potrafi się SKURCZYĆ między renderami
 * (użytkownik otwiera drugi plik w tym samym popupie), a wtedy zapamiętany
 * indeks wskazuje poza tablicę - `sheets[5]` na trzech arkuszach to `undefined`
 * i wywrotka przy odczycie `.html`.
 */
export function activeSheetIndex(active: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(0, active), count - 1);
}

/** Twardy limit treści tekstowej - przeglądarka nie ma pokazać 50 MB logu. */
export const TEXT_MAX_CHARS = 400_000;

/** Twardy limit wierszy CSV - tabela z milionem wierszy zabija kartę. */
export const CSV_MAX_ROWS = 2000;

export function clampText(value: string): string {
  return value.slice(0, TEXT_MAX_CHARS);
}

/**
 * Podział CSV na komórki. Separator zgadujemy z trzech najczęstszych, bo
 * eksport z Excela w polskiej lokalizacji daje średnik, a nie przecinek -
 * bez tego cały wiersz lądował w jednej komórce.
 */
export function csvRows(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .slice(0, CSV_MAX_ROWS)
    .map((line) => line.split(/[,;\t]/));
}
