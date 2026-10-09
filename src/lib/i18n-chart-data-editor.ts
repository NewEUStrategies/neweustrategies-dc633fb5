// EDYTOR DANYCH WYKRESU - nakładka słownika dla AUTORA (`chartEditor.*`).
//
// Napisy arkusza danych, podglądu wklejki, wyboru koloru serii i serii
// wyróżnionej - wspólne dla edytora bloku CMS (`DataVizBlocks.tsx`) i arkusza
// widgetu buildera (`ChartDataSpreadsheetDialog.tsx`). Czytelnik opublikowanej
// strony nie potrzebuje żadnego z nich, więc nakładka jedzie wyłącznie
// z chunkami panelu.
//
// NIE MYLIĆ z `i18n-charts-editor.ts` (`charts.editor.*`, `<rodzaj>.advice.*`):
// tamta nakładka niesie PORADY doboru formy i dyscypliny palety, ta - napisy
// samych kontrolek edycji danych.
//
// Klucze wołane z kodu wypisuj JAWNIE mapą `Record<Unia, string>` (bramka
// `chartDictionaryKeys.test.ts`). Parytet PL/EN i zakaz pauzy w miejscu
// łącznika pilnuje `chartOverlayParity.test.ts`.
import i18n from "@/lib/i18n";

const pl = {
  chartEditor: {
    accent: {
      // Wybór serii malowanej akcentem palety ról (`accentSeries`).
      label: "Seria wyróżniona",
    },
    colors: {
      // Paleta ról nie czyta koloru wybranego przy serii - mówi to autorowi
      // zdanie pod wyborem, zamiast kazać mu szukać zmiany w podglądzie.
      customHint: "Kolory własne działają w palecie kategorialnej",
    },
  },
};

const en: typeof pl = {
  chartEditor: {
    accent: {
      label: "Highlighted series",
    },
    colors: {
      customHint: "Custom colours apply in the categorical palette",
    },
  },
};

let registered = false;
/** Idempotentne: rejestracja odbywa się raz, przy imporcie modułu. */
export function ensureChartDataEditorI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", pl, true, true);
  i18n.addResourceBundle("en", "translation", en, true, true);
}
ensureChartDataEditorI18n();
