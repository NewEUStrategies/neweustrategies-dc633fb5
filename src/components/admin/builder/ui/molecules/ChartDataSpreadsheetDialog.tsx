// Molecule: spreadsheet-style editor for chart data with live preview.
// Renders an Excel-like grid (categories x series) and the actual <Chart/> engine
// side-by-side, keeping edits in local state and serialising back to the
// widget's CSV textarea format ("; Series A; Series B\nRow; 12; 8") only on save.
import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, Sheet as SheetIcon, Undo2, Check, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Chart } from "@/components/charts/Chart";
import type { ChartConfig, ChartKind } from "@/lib/charts/types";
import { MAX_SERIES } from "@/lib/charts/types";
import {
  CHART_HEIGHT_DEFAULT,
  CHART_HEIGHT_MAX,
  CHART_HEIGHT_MIN,
  MAX_CATEGORIES,
  parseChartKind,
} from "@/lib/charts/parse";
import { parseChartData } from "@/lib/charts/csv";
import { asBool, asNumInRange } from "@/lib/builder/contentValue";

interface Props {
  value: string;
  onChange: (next: string) => void;
  kind?: string;
  unit?: string;
  title?: string;
  /**
   * Pełna treść widgetu - podgląd MUSI renderować się tymi samymi
   * ustawieniami co kanwa (legenda, siatka, etykiety wartości, skumulowanie,
   * wysokość). Bez tego arkusz pokazywał inny wykres niż strona.
   */
  content?: Record<string, unknown>;
  lang: "pl" | "en";
}

interface Grid {
  seriesNames: string[];
  categories: string[];
  cells: string[][]; // cells[row][seriesIdx]
}

const L = {
  pl: {
    open: "Otwórz arkusz",
    title: "Arkusz danych wykresu",
    subtitle: "Edytuj komórki jak w Excelu - wykres po prawej odświeża się w czasie rzeczywistym.",
    addRow: "Dodaj wiersz",
    addSeries: "Dodaj serię",
    removeRow: "Usuń wiersz",
    removeSeries: "Usuń serię",
    reset: "Przywróć",
    cancel: "Zamknij",
    save: "Zapisz i zamknij",
    categoryCol: "Kategoria",
    empty: "Brak danych - dodaj wiersz aby zacząć.",
    preview: "Podgląd wykresu",
    limit: (n: number) => `Limit: ${n}`,
    statusIdle: "Zsynchronizowano",
    statusSyncing: "Synchronizacja…",
  },
  en: {
    open: "Open spreadsheet",
    title: "Chart data spreadsheet",
    subtitle: "Edit cells like a spreadsheet - the chart on the right updates in real time.",
    addRow: "Add row",
    addSeries: "Add series",
    removeRow: "Remove row",
    removeSeries: "Remove series",
    reset: "Reset",
    cancel: "Close",
    save: "Save & close",
    categoryCol: "Category",
    empty: "No data - add a row to get started.",
    preview: "Chart preview",
    limit: (n: number) => `Limit: ${n}`,
    statusIdle: "In sync",
    statusSyncing: "Syncing…",
  },
} as const;

/** Convert the widget CSV string into a mutable string grid (values stay as-typed). */
function csvToGrid(text: string): Grid {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\r$/, ""));
  const nonEmpty = lines.filter((l) => l.trim() !== "");
  if (nonEmpty.length === 0) {
    return { seriesNames: ["Seria A"], categories: ["2024"], cells: [[""]] };
  }
  const split = (line: string) => line.split(";").map((c) => c.trim());
  const header = split(nonEmpty[0]);
  const seriesNames = header.slice(1, MAX_SERIES + 1);
  if (seriesNames.length === 0) seriesNames.push("Seria A");

  const rows = nonEmpty.slice(1, MAX_CATEGORIES + 1).map(split);
  const categories = rows.map((r) => r[0] ?? "");
  const cells = rows.map((r) => seriesNames.map((_, si) => (r[si + 1] ?? "").toString()));
  if (categories.length === 0) {
    categories.push("2024");
    cells.push(seriesNames.map(() => ""));
  }
  return { seriesNames, categories, cells };
}

/** Serialize the grid back into the widget CSV format. */
function gridToCsv(g: Grid): string {
  const header = ["", ...g.seriesNames].join("; ");
  const rows = g.categories.map((cat, ri) => [cat, ...g.cells[ri]].join("; "));
  return [header, ...rows].join("\n");
}

export function ChartDataSpreadsheetDialog({
  value,
  onChange,
  kind,
  unit,
  title,
  content,
  lang,
}: Props) {
  const t = L[lang];
  const [open, setOpen] = useState(false);
  const [grid, setGrid] = useState<Grid>(() => csvToGrid(value));
  const initialRef = useRef<string>(value);
  const lastSyncedRef = useRef<string>(value);
  const [syncing, setSyncing] = useState(false);

  // Rehydrate when the dialog opens so external edits are not shadowed.
  useEffect(() => {
    if (open) {
      setGrid(csvToGrid(value));
      initialRef.current = value;
      lastSyncedRef.current = value;
      setSyncing(false);
    }
  }, [open, value]);

  const chartKind: ChartKind = parseChartKind(kind);

  const previewConfig: ChartConfig = useMemo(() => {
    const csv = gridToCsv(grid);
    const parsed = parseChartData(csv);
    // Ustawienia wyglądu czytamy z treści widgetu (te same klucze co
    // ChartWidgetView) - podgląd ma pokazywać wykres, który autor faktycznie
    // publikuje, a nie sztywny wariant demonstracyjny.
    const c = content ?? {};
    return {
      kind: chartKind,
      title: title ?? "",
      description: "",
      categories: parsed.categories,
      series: parsed.series,
      stacked: asBool(c.stacked, false),
      unit: unit ?? "",
      height: asNumInRange(c.height, CHART_HEIGHT_DEFAULT, CHART_HEIGHT_MIN, CHART_HEIGHT_MAX),
      showLegend: asBool(c.showLegend, true),
      showGrid: asBool(c.showGrid, true),
      showValues: asBool(c.showValues, false),
      // Animacja wejścia jest wyłączona TYLKO w podglądzie arkusza: wykres
      // przeskakuje tu przy każdym naciśnięciu klawisza, a odpalanie animacji
      // na każdą zmianę komórki byłoby migotaniem, nie podglądem.
      animate: false,
      source: "",
    };
  }, [grid, chartKind, title, unit, content]);

  // Wykres kołowy rysuje WYŁĄCZNIE pierwszą serię (jedna tarcza = jeden
  // podział całości). Bez tego ostrzeżenia kolejne kolumny znikały po cichu.

  // Live sync: propaguj CSV do parenta natychmiast po edycji, żeby wpisy
  // trafiały do widget-config bez czekania na przycisk "Zapisz". Krótki
  // debounce (150 ms) chroni przed cascadą re-renderów przy szybkim pisaniu;
  // status "Synchronizacja…" znika po zakończeniu propagacji.
  useEffect(() => {
    if (!open) return;
    const nextCsv = gridToCsv(grid);
    if (nextCsv === lastSyncedRef.current) return;
    setSyncing(true);
    const handle = setTimeout(() => {
      lastSyncedRef.current = nextCsv;
      onChange(nextCsv);
      setSyncing(false);
    }, 150);
    return () => clearTimeout(handle);
  }, [grid, open, onChange]);

  const setCell = (row: number, col: number, v: string) => {
    setGrid((g) => {
      const cells = g.cells.map((r) => r.slice());
      cells[row][col] = v;
      return { ...g, cells };
    });
  };

  const setCategory = (row: number, v: string) => {
    setGrid((g) => {
      const categories = g.categories.slice();
      categories[row] = v;
      return { ...g, categories };
    });
  };

  const setSeriesName = (col: number, v: string) => {
    setGrid((g) => {
      const seriesNames = g.seriesNames.slice();
      seriesNames[col] = v;
      return { ...g, seriesNames };
    });
  };

  const addRow = () => {
    setGrid((g) => {
      if (g.categories.length >= MAX_CATEGORIES) return g;
      return {
        ...g,
        categories: [...g.categories, ""],
        cells: [...g.cells, g.seriesNames.map(() => "")],
      };
    });
  };

  const removeRow = (row: number) => {
    setGrid((g) => {
      if (g.categories.length <= 1) return g;
      return {
        ...g,
        categories: g.categories.filter((_, i) => i !== row),
        cells: g.cells.filter((_, i) => i !== row),
      };
    });
  };

  const addSeries = () => {
    setGrid((g) => {
      if (g.seriesNames.length >= MAX_SERIES) return g;
      const nextName = `Seria ${String.fromCharCode(65 + g.seriesNames.length)}`;
      return {
        ...g,
        seriesNames: [...g.seriesNames, nextName],
        cells: g.cells.map((r) => [...r, ""]),
      };
    });
  };

  const removeSeries = (col: number) => {
    setGrid((g) => {
      if (g.seriesNames.length <= 1) return g;
      return {
        ...g,
        seriesNames: g.seriesNames.filter((_, i) => i !== col),
        cells: g.cells.map((r) => r.filter((_, i) => i !== col)),
      };
    });
  };

  const resetToInitial = () => setGrid(csvToGrid(initialRef.current));

  const save = () => {
    // Flush pending debounce od razu, żeby zamknięcie nigdy nie odrzuciło
    // ostatniej edycji (edge case: user klika Zapisz w oknie debounce).
    const nextCsv = gridToCsv(grid);
    if (nextCsv !== lastSyncedRef.current) {
      lastSyncedRef.current = nextCsv;
      onChange(nextCsv);
    }
    setSyncing(false);
    setOpen(false);
  };

  const canAddRow = grid.categories.length < MAX_CATEGORIES;
  const canAddSeries = grid.seriesNames.length < MAX_SERIES;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
                  ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-200"
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
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-[6px] gap-1.5 text-xs"
                onClick={addRow}
                disabled={!canAddRow}
              >
                <Plus className="w-3.5 h-3.5" /> {t.addRow}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-[6px] gap-1.5 text-xs"
                onClick={addSeries}
                disabled={!canAddSeries}
              >
                <Plus className="w-3.5 h-3.5" /> {t.addSeries}
              </Button>
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

            <div className="rounded-[6px] border overflow-auto">
              <table className="w-full border-collapse text-xs">
                <thead className="bg-muted/50 sticky top-0 z-10">
                  <tr>
                    <th className="w-10 border-b border-r p-1 text-[10px] font-medium text-muted-foreground">
                      #
                    </th>
                    <th className="border-b border-r p-1 text-left font-medium text-muted-foreground min-w-[120px]">
                      {t.categoryCol}
                    </th>
                    {grid.seriesNames.map((name, si) => (
                      <th
                        key={si}
                        className="border-b border-r p-1 min-w-[110px] font-medium text-muted-foreground"
                      >
                        <div className="flex items-center gap-1">
                          <Input
                            value={name}
                            onChange={(e) => setSeriesName(si, e.target.value)}
                            className="h-7 text-xs rounded-[4px]"
                          />
                          <button
                            type="button"
                            onClick={() => removeSeries(si)}
                            aria-label={t.removeSeries}
                            className="p-1 text-muted-foreground hover:text-destructive disabled:opacity-30"
                            disabled={grid.seriesNames.length <= 1}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grid.categories.length === 0 && (
                    <tr>
                      <td
                        colSpan={grid.seriesNames.length + 2}
                        className="p-6 text-center text-muted-foreground"
                      >
                        {t.empty}
                      </td>
                    </tr>
                  )}
                  {grid.categories.map((cat, ri) => (
                    <tr key={ri} className="hover:bg-muted/30">
                      <td className="border-b border-r p-1 text-center text-[10px] text-muted-foreground">
                        <div className="flex items-center justify-center gap-0.5">
                          <span>{ri + 1}</span>
                          <button
                            type="button"
                            onClick={() => removeRow(ri)}
                            aria-label={t.removeRow}
                            className="p-0.5 text-muted-foreground hover:text-destructive disabled:opacity-30"
                            disabled={grid.categories.length <= 1}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                      <td className="border-b border-r p-0.5">
                        <Input
                          value={cat}
                          onChange={(e) => setCategory(ri, e.target.value)}
                          className="h-7 text-xs rounded-[4px] border-transparent focus:border-input"
                        />
                      </td>
                      {grid.seriesNames.map((_, si) => (
                        <td key={si} className="border-b border-r p-0.5">
                          <Input
                            value={grid.cells[ri]?.[si] ?? ""}
                            onChange={(e) => setCell(ri, si, e.target.value)}
                            inputMode="decimal"
                            className="h-7 text-xs rounded-[4px] border-transparent focus:border-input text-right font-mono"
                            placeholder="—"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-[10px] text-muted-foreground/70">
              {t.limit(MAX_CATEGORIES)} · {t.limit(MAX_SERIES)}
            </p>
          </div>

          {/* Live preview pane */}
          <div className="overflow-auto p-4 bg-muted/20">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
              {t.preview}
            </div>
            <div className="rounded-[6px] border bg-background p-3">
              <Chart config={previewConfig} lang={lang} className="my-0" />
            </div>
          </div>
        </div>

        <DialogFooter className="px-5 py-3 border-t bg-muted/20">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 rounded-[6px] text-xs"
            onClick={() => setOpen(false)}
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
