// Molecule: spreadsheet-style editor for chart data with live preview.
// Renders the shared chart data grid (categories x series, the same one the
// CMS chart block uses) and the actual <Chart/> engine side-by-side, keeping
// edits in local state and syncing them back to the widget content.
//
// ZAPIS (PR2). Siatka trzyma dane, kolory serii i wskaźniki akcentu razem
// (`ChartGridValue`), a do widgetu wracają one JEDNĄ łatką
// (`setContentPatch`: `data` średnikami, pozycyjne `seriesColors`,
// `accentSeries`, `accentCategory`) - jedno działanie autora to jeden krok
// historii buildera, a przesunięcie albo usunięcie serii nie odrywa koloru
// ani wyróżnienia od serii, do której należały. Działanie na strukturze
// (wstawienie, przesunięcie, kolor, akcent, wklejenie, import, zatwierdzona
// liczba) idzie od razu; pisanie nazwy serii albo etykiety - po 150 ms,
// żeby historia nie dostawała kroku na każdą literę.
//
// PODGLĄD czyta ten sam adapter co widget na stronie (`widgetChartConfig`),
// więc pokazuje dokładnie wykres, który zobaczy czytelnik - jedynym
// świadomym wyjątkiem jest wyłączona animacja wejścia.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sheet as SheetIcon, Undo2, Check, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Chart } from "@/components/charts/Chart";
import type { ChartConfig } from "@/lib/charts/types";
import { MAX_SERIES } from "@/lib/charts/types";
import { MAX_CATEGORIES, parseChartKind } from "@/lib/charts/parse";
import { widgetChartConfig } from "@/lib/charts/widgetConfig";
import { isChartPalette } from "@/lib/charts/seriesStyle";
import { needsTextCellFix, safeTextCell, tableToChartData } from "@/lib/charts/importTable";
import { DataImportControl } from "@/components/admin/blocks/DataImportControl";
import { ChartDataGrid } from "@/components/admin/charts/ChartDataGrid";
import {
  gridReplace,
  readWidgetGrid,
  widgetContentSignature,
  widgetGridPatch,
  widgetGridSignature,
  type ChartGridValue,
} from "@/components/admin/charts/chartGridState";
import type { Json } from "@/lib/builder/types";
import type { ContentPatch } from "@/lib/builder/schemas";

interface Props {
  value: string;
  onChange: (next: string) => void;
  kind?: string;
  unit?: string;
  title?: string;
  /**
   * Pełna treść widgetu - podgląd MUSI renderować się tymi samymi
   * ustawieniami co kanwa (legenda, siatka, etykiety wartości, skumulowanie,
   * wysokość, paleta). Bez tego arkusz pokazywał inny wykres niż strona.
   */
  content?: Record<string, unknown>;
  lang: "pl" | "en";
  /**
   * Zapis pojedynczego klucza i zapis WIELU kluczy jako jeden krok historii
   * (`undefined` usuwa klucz) - od P0a podaje je `SchemaFieldControl`, żeby
   * arkusz mógł zapisać dane razem z kolorami i akcentem serii.
   */
  setContent?: (key: string, value: Json) => void;
  setContentPatch?: (patch: ContentPatch) => void;
  /** Klucz pola danych w treści widgetu (schemat wykresu: `data`). */
  dataKey?: string;
}

const L = {
  pl: {
    open: "Otwórz arkusz",
    title: "Arkusz danych wykresu",
    subtitle: "Edytuj komórki jak w Excelu - wykres po prawej odświeża się w czasie rzeczywistym.",
    reset: "Przywróć",
    cancel: "Zamknij",
    save: "Zapisz i zamknij",
    preview: "Podgląd wykresu",
    limit: (n: number) => `Limit: ${n}`,
    statusIdle: "Zsynchronizowano",
    statusSyncing: "Synchronizacja…",
  },
  en: {
    open: "Open spreadsheet",
    title: "Chart data spreadsheet",
    subtitle: "Edit cells like a spreadsheet - the chart on the right updates in real time.",
    reset: "Reset",
    cancel: "Close",
    save: "Save & close",
    preview: "Chart preview",
    limit: (n: number) => `Limit: ${n}`,
    statusIdle: "In sync",
    statusSyncing: "Syncing…",
  },
} as const;

const SYNC_DEBOUNCE_MS = 150;

/**
 * Etykieta wpisywana w siatce - bez średnika i złamania wiersza, których
 * format średnikowy nie uniesie. Bez przycinania spacji: autor jest w trakcie
 * pisania, a spacja na końcu to zwykle początek następnego słowa.
 */
function bezSrednika(raw: string): string {
  return raw.replace(/;/g, ",").replace(/[\n\r]+/g, " ");
}

/**
 * Zmiana WYŁĄCZNIE nazw serii albo etykiet kategorii - jedyna, którą arkusz
 * odkłada (debounce). Wszystko inne zmienia wykres skokowo i idzie od razu.
 */
function tylkoEtykiety(prev: ChartGridValue, next: ChartGridValue): boolean {
  const a = prev.model;
  const b = next.model;
  return (
    prev.accentSeries === next.accentSeries &&
    prev.accentCategory === next.accentCategory &&
    a.categories.length === b.categories.length &&
    a.series.length === b.series.length &&
    a.series.every((s, i) => {
      const n = b.series[i];
      return (
        n !== undefined &&
        n.colorSlot === s.colorSlot &&
        n.values.length === s.values.length &&
        n.values.every((v, r) => v === s.values[r])
      );
    })
  );
}

export function ChartDataSpreadsheetDialog({
  value,
  onChange,
  kind,
  unit,
  title,
  content,
  lang,
  setContent,
  setContentPatch,
  dataKey = "data",
}: Props) {
  const t = L[lang];
  const c = useMemo(() => content ?? {}, [content]);
  const [open, setOpen] = useState(false);
  const [grid, setGrid] = useState<ChartGridValue>(() => readWidgetGrid(value, c, lang));
  const gridRef = useRef(grid);
  gridRef.current = grid;
  // Stan z chwili OTWARCIA - punkt „Przywróć". Echo własnej synchronizacji
  // go nie przesuwa (do PR2 przesuwało, więc po pierwszej zsynchronizowanej
  // edycji „Przywróć" nie robił praktycznie nic).
  const initialRef = useRef<ChartGridValue>(grid);
  // Podpis stanu ostatnio wysłanego (albo wczytanego) - rozpoznaje echo.
  const lastSyncedRef = useRef<string>(widgetGridSignature(grid));
  const [syncing, setSyncing] = useState(false);

  // Najświeższe wejście dla efektu rehydracji - efekt zależy tylko od
  // podpisu, a czyta resztę z referencji.
  const incoming = widgetContentSignature(value, c);
  const wejscie = useRef({ value, c, lang });
  wejscie.current = { value, c, lang };

  // Rehydrate when the dialog opens so external edits are not shadowed.
  //
  // ECHO WŁASNEJ SYNCHRONIZACJI NIE NADPISUJE ARKUSZA. Rodzic dostaje łatkę
  // i oddaje ją jako treść; jeśli autor zdążył w tym czasie wpisać kolejną
  // komórkę, ponowne wczytanie cofałoby arkusz do stanu sprzed tej edycji
  // i wpis ginął bez śladu. Arkusz przebudowuje więc otwarcie dialogu albo
  // treść zmieniona Z ZEWNĄTRZ (podpis inny niż ostatnio wysłany) - na
  // przykład cofnięcie w historii buildera.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    const justOpened = !wasOpenRef.current;
    wasOpenRef.current = true;
    if (!justOpened && incoming === lastSyncedRef.current) return;
    const w = wejscie.current;
    const next = readWidgetGrid(w.value, w.c, w.lang);
    setGrid(next);
    if (justOpened) initialRef.current = next;
    lastSyncedRef.current = widgetGridSignature(next);
    setSyncing(false);
  }, [open, incoming]);

  // Kanały zapisu z NAJŚWIEŻSZEGO renderu. Rodzic podaje nowe funkcje przy
  // każdym renderze; gdyby zapis od nich zależał, każde echo restartowałoby
  // odłożoną synchronizację.
  const kanaly = useRef({ onChange, setContent, setContentPatch, dataKey });
  kanaly.current = { onChange, setContent, setContentPatch, dataKey };

  /** Zapis stanu do treści widgetu - jedna łatka, jeden krok historii. */
  const zapisz = useCallback((g: ChartGridValue) => {
    const sig = widgetGridSignature(g);
    if (sig === lastSyncedRef.current) return;
    lastSyncedRef.current = sig;
    const k = kanaly.current;
    const patch = widgetGridPatch(g, k.dataKey);
    if (k.setContentPatch) {
      k.setContentPatch(patch);
      return;
    }
    // Wołający bez historii (testy, edytory niestandardowe): dane przez
    // `onChange`, reszta kluczy przez `setContent`, jeśli jest.
    k.onChange(String(patch[k.dataKey] ?? ""));
    if (k.setContent) {
      for (const key of ["seriesColors", "accentSeries", "accentCategory"] as const) {
        const v = patch[key] ?? null;
        if ((wejscie.current.c[key] ?? null) !== v) k.setContent(key, v);
      }
    }
  }, []);

  // Live sync: odłożony zapis zmian samych etykiet (patrz `tylkoEtykiety`).
  // Status „Synchronizacja…" znika po zakończeniu propagacji.
  useEffect(() => {
    if (!open) return;
    if (widgetGridSignature(grid) === lastSyncedRef.current) {
      setSyncing(false);
      return;
    }
    setSyncing(true);
    const handle = setTimeout(() => {
      zapisz(gridRef.current);
      setSyncing(false);
    }, SYNC_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [grid, open, zapisz]);

  const onGridChange = (next: ChartGridValue) => {
    const debounce = tylkoEtykiety(gridRef.current, next);
    gridRef.current = next;
    setGrid(next);
    if (!debounce) zapisz(next);
  };

  /** Ctrl+Z w siatce: odłożony zapis idzie PRZED cofnięciem historii buildera. */
  const flushNow = () => {
    zapisz(gridRef.current);
    setSyncing(false);
  };

  const chartKind = parseChartKind(
    typeof kind === "string" ? kind : typeof c.kind === "string" ? c.kind : undefined,
  );

  // Podgląd liczony WYŁĄCZNIE przy otwartym arkuszu: składa się z całej treści
  // widgetu (`{...c}`), a panel z zamkniętym dialogiem nie może czytać treści
  // hurtem - bramka zgodności ustawień liczy odczyty panelu klucz po kluczu.
  const previewConfig: ChartConfig | null = useMemo(() => {
    if (!open) return null;
    // Ten sam adapter co widget na stronie - treść widgetu z danymi, kolorami
    // i akcentem z siatki (siatka wyprzedza zapis o debounce).
    const merged: Record<string, unknown> = {
      ...c,
      ...(kind !== undefined ? { kind } : {}),
      ...(unit !== undefined ? { unit } : {}),
      ...(title !== undefined ? { [`title_${lang}`]: title } : {}),
      ...widgetGridPatch(grid, "data"),
    };
    // Animacja wejścia jest wyłączona TYLKO w podglądzie arkusza: wykres
    // przeskakuje tu przy każdej zmianie, a odpalanie animacji na każdą
    // komórkę byłoby migotaniem, nie podglądem.
    return { ...widgetChartConfig(merged, lang), animate: false };
  }, [open, grid, c, kind, unit, title, lang]);

  const resetToInitial = () => onGridChange(initialRef.current);

  // Zamknięcie W KAŻDY sposób (Zapisz, Zamknij, Escape, klik poza oknem)
  // wysyła odłożony zapis od razu, żeby nigdy nie odrzuciło ostatniej edycji
  // (edge case: user zamyka w oknie debounce).
  const zmienOtwarcie = (next: boolean) => {
    if (!next) flushNow();
    setOpen(next);
  };

  const save = () => zmienOtwarcie(false);

  return (
    <Dialog open={open} onOpenChange={zmienOtwarcie}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 rounded-[6px] gap-1.5 text-xs"
        >
          <SheetIcon className="w-3.5 h-3.5" />
          {t.open}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-6xl w-[95vw] p-0 gap-0 rounded-[6px] overflow-hidden">
        <DialogHeader className="px-5 py-4 border-b">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="text-base font-semibold">{t.title}</DialogTitle>
              <p className="text-xs text-muted-foreground">{t.subtitle}</p>
            </div>
            <div
              role="status"
              aria-live="polite"
              className={
                "inline-flex items-center gap-1.5 rounded-[6px] border px-2 py-1 text-[11px] font-medium shrink-0 " +
                (syncing
                  ? "border-brand/35 bg-brand/10 text-brand-ink dark:border-brand/40 dark:bg-brand/10 dark:text-brand"
                  : "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-400/40 dark:bg-emerald-500/10 dark:text-emerald-200")
              }
            >
              {syncing ? (
                <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="w-3 h-3" aria-hidden="true" />
              )}
              <span>{syncing ? t.statusSyncing : t.statusIdle}</span>
            </div>
          </div>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-0 max-h-[70vh]">
          {/* Spreadsheet pane */}
          <div className="border-r overflow-auto p-4 space-y-3">
            {/* IMPORT WYMIENIA CAŁĄ SIATKĘ, więc siedzi nad nią. Przed
                zapisem pokazuje podgląd układu (nagłówek, obrót, format
                liczb); po „Zastosuj" dane trafiają do widgetu od razu -
                drogą powrotną jest Ctrl+Z albo „Przywróć". */}
            <DataImportControl
              preview="chart"
              onRows={(rows, layout) => {
                const dane = tableToChartData(
                  rows,
                  layout === undefined
                    ? undefined
                    : { header: layout.header, transpose: layout.transpose, locale: layout.locale },
                );
                // ETYKIETY MUSZĄ PRZEŻYĆ FORMAT ŚREDNIKOWY. Kategoria
                // „Kraków; Polska" rozpadłaby się na dwie kolumny i przesunęła
                // wszystkie wartości w wierszu. Podmiana zmienia etykietę,
                // więc jest policzona i zgłoszona, a nie cicha.
                const poprawione = [...dane.series.map((s) => s.name), ...dane.categories].filter(
                  needsTextCellFix,
                ).length;
                onGridChange(
                  gridReplace(gridRef.current, {
                    categories: dane.categories.map(safeTextCell),
                    series: dane.series.map((s) => ({ ...s, name: safeTextCell(s.name) })),
                  }),
                );
                return poprawione > 0
                  ? [...dane.problems, { code: "labelsAdjusted" as const, count: poprawione }]
                  : dane.problems;
              }}
            />

            <ChartDataGrid
              value={grid}
              onChange={onGridChange}
              kind={chartKind}
              palette={isChartPalette(c.palette) ? c.palette : "focus"}
              docLang={lang}
              lang={lang}
              sanitizeLabel={bezSrednika}
              onFlush={flushNow}
            />

            <div className="flex items-center gap-2">
              <p className="text-[10px] text-muted-foreground/70">
                {t.limit(MAX_CATEGORIES)} · {t.limit(MAX_SERIES)}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 rounded-[6px] gap-1.5 text-xs ml-auto"
                onClick={resetToInitial}
              >
                <Undo2 className="w-3.5 h-3.5" /> {t.reset}
              </Button>
            </div>
          </div>

          {/* Live preview pane */}
          <div className="overflow-auto p-4 bg-muted/20">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
              {t.preview}
            </div>
            <div className="rounded-[6px] border bg-background p-3">
              {previewConfig !== null && (
                <Chart config={previewConfig} lang={lang} className="my-0" />
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="px-5 py-3 border-t bg-muted/20">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 rounded-[6px] text-xs"
            onClick={() => zmienOtwarcie(false)}
          >
            {t.cancel}
          </Button>
          <Button type="button" size="sm" className="h-8 rounded-[6px] text-xs" onClick={save}>
            {t.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
