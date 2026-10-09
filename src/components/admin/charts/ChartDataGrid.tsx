// ARKUSZ DANYCH WYKRESU - jedna siatka dla bloku CMS i widgetu buildera.
//
// Do PR2 każda powierzchnia miała własną tabelę pól: blok parsował liczbę na
// każdym naciśnięciu klawisza, arkusz buildera trzymał napisy i wysyłał je
// średnikami, żadna nie znała klawiatury arkusza, wklejenia zakresu ani
// wstawiania w środek. Ta siatka składa wspólne klocki (`GridCells`,
// `GridMenu`, `ChartColorPicker`, `PastePreviewDialog`) nad czystym stanem
// `ChartGridValue` - dane, kolory serii i wskaźniki akcentu - i oddaje KAŻDĄ
// zmianę jednym `onChange`, więc jedno działanie autora to jeden krok cofania
// w historii bloku albo buildera.
//
// CO SIATKA WIE O WYKRESIE, A CZEGO NIE. Wie, czy kolor należy do serii,
// czy do kategorii (`KIND_CAPS.colorTarget`) i którą paletę rysunek naprawdę
// stosuje - bo próbka ma pokazywać kolor narysowany. Nie wie nic o zapisie:
// blok i widget przekładają `ChartGridValue` na swoją treść adapterami
// z `chartGridState.ts`.
//
// WKLEJENIE (kontrakt PR2, „DataGrid behaviour" 3): zakres w środku siatki
// trafia od komórki kotwicy jednym zapisem, a problemy (obcięcie do limitów,
// komórki nieliczbowe, flagi) stoją pod siatką. Cała tabela wklejona w pustą
// siatkę albo w jej pierwszą komórkę - gdy rozpoznanie widzi nagłówek -
// otwiera podgląd z przełącznikami układu, bo zastępuje WSZYSTKO.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { ArrowLeftRight, Plus } from "lucide-react";
import { AdminSelect } from "@/components/admin/blocks/AdminSelect";
import { MAX_SERIES, type ChartKind } from "@/lib/charts/types";
import { MAX_CATEGORIES } from "@/lib/charts/parse";
import type { ChartPalette } from "@/lib/charts/seriesStyle";
import type { ClipboardTable } from "@/lib/charts/clipboardTable";
import type { GridAnchor } from "@/lib/charts/gridModel";
import { analyseTable, tableToChartData, type ImportProblem } from "@/lib/charts/importTable";
import { cn } from "@/lib/utils";
import {
  defaultSeriesName,
  gridCanTranspose,
  gridInsertCategory,
  gridInsertSeries,
  gridMoveCategory,
  gridMoveSeries,
  gridPaste,
  gridRemoveCategory,
  gridRemoveSeries,
  gridReplace,
  gridSetAccentCategory,
  gridSetAccentSeries,
  gridSetCategory,
  gridSetSeriesColor,
  gridSetSeriesName,
  gridSetValue,
  gridSort,
  gridTranspose,
  GRID_MIN,
  type ChartGridValue,
  type EditorDocLang,
} from "./chartGridState";
import {
  colorsByCategory,
  colorsBySeries,
  effectivePalette,
  seriesSwatches,
} from "./chartColorSlots";
import { ChartColorPicker, ColorSwatch, SeriesRoleChip } from "./ChartColorPicker";
import { NumberCell, TextCell } from "./GridCells";
import { GridMenu, type GridMenuItem } from "./GridMenu";
import { ImportProblemList } from "./ImportProblemList";
import { PastePreviewDialog } from "./PastePreviewDialog";
import type { TableLayout, TablePreviewSource } from "./tableLayout";
import { CHART_GRID_ATTR, GRID_FLUSH_EVENT } from "./gridKeyboard";
import { useChartEditorT, type EditorLang } from "./chartEditorI18n";

/** Sterowanie siatką z zewnątrz - wklejenie na kanwie i import pliku otwierają ten sam podgląd. */
export interface ChartDataGridHandle {
  openTablePreview: (
    rows: readonly (readonly string[])[],
    readProblems: readonly ImportProblem[],
    source: TablePreviewSource,
  ) => void;
}

interface Props {
  value: ChartGridValue;
  onChange: (next: ChartGridValue) => void;
  kind: ChartKind;
  /** Paleta zapisana w treści (rysunek może stosować inną - `effectivePalette`). */
  palette: ChartPalette;
  /** Język DOKUMENTU: nazwy domyślne serii i zapis liczb w komórkach. */
  docLang: EditorDocLang;
  /** Język napisów siatki; brak = język panelu. */
  lang?: EditorLang;
  /** Filtr etykiet (arkusz widgetu: format średnikowy nie uniesie średnika). */
  sanitizeLabel?: (raw: string) => string;
  /** Opróżnienie odłożonego zapisu tuż przed cofnięciem (`GRID_FLUSH_EVENT`). */
  onFlush?: () => void;
  className?: string;
}

interface Podglad {
  rows: readonly (readonly string[])[];
  problems: readonly ImportProblem[];
  source: TablePreviewSource;
}

/** Stała pustka dla zamkniętego podglądu - nowa tablica w każdym renderze zerowałaby jego układ. */
const BEZ_WIERSZY: readonly (readonly string[])[] = [];

/** Siatka bez ani jednej liczby - wklejka tabeli z etykietami ją ZASTĘPUJE, a nie wypełnia. */
function bezLiczb(v: ChartGridValue): boolean {
  return v.model.series.every((s) => s.values.every((x) => x === null || x === undefined));
}

function ChartDataGridInner(
  { value, onChange, kind, palette, docLang, lang, sanitizeLabel, onFlush, className }: Props,
  ref: Ref<ChartDataGridHandle>,
) {
  const t = useChartEditorT(lang);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [kolor, setKolor] = useState<number | null>(null);
  const [podglad, setPodglad] = useState<Podglad | null>(null);
  const [wynik, setWynik] = useState<{ problems: readonly ImportProblem[] } | null>(null);

  const { categories, series } = value.model;
  const eff = effectivePalette(kind, palette);
  const probkiSerii = colorsBySeries(kind) ? seriesSwatches(series, value.accentSeries, eff) : null;
  const akcentSerii = colorsBySeries(kind) && eff === "focus";
  const akcentKategorii = colorsByCategory(kind);

  // Opróżnienie odłożonego zapisu: skróty buildera wysyłają zdarzenie NA
  // korzeń siatki przed Ctrl+Z. Wołający ze stanu lokalnego (arkusz widgetu)
  // podaje `onFlush`; edytor bloku zapisuje od razu i go nie potrzebuje.
  const flushRef = useRef(onFlush);
  flushRef.current = onFlush;
  useEffect(() => {
    const el = rootRef.current;
    if (el === null) return;
    const h = () => flushRef.current?.();
    el.addEventListener(GRID_FLUSH_EVENT, h);
    return () => el.removeEventListener(GRID_FLUSH_EVENT, h);
  }, []);

  const otworzPodglad = (
    rows: readonly (readonly string[])[],
    problems: readonly ImportProblem[],
    source: TablePreviewSource,
  ) => setPodglad({ rows, problems, source });

  useImperativeHandle(ref, () => ({ openTablePreview: otworzPodglad }), []);

  const zmien = (next: ChartGridValue) => {
    if (next !== value) onChange(next);
  };

  const wklej = (table: ClipboardTable, anchor: GridAnchor) => {
    const readProblems: ImportProblem[] = table.truncated ? [{ code: "pasteTruncated" }] : [];
    const szerokosc = table.rows[0]?.length ?? 0;
    const pierwszaKomorka = anchor.row <= 0 && anchor.col <= 0;
    const calaTabela =
      szerokosc >= 2 &&
      (bezLiczb(value) || (pierwszaKomorka && analyseTable(table.rows).headerRow));
    if (calaTabela) {
      otworzPodglad(table.rows, readProblems, "paste");
      return;
    }
    const { value: next, problems } = gridPaste(value, table.rows, anchor, docLang);
    zmien(next);
    setWynik({ problems: [...readProblems, ...problems] });
  };

  const zastosujPodglad = (layout: TableLayout) => {
    if (podglad === null) return;
    const dane = tableToChartData(podglad.rows, {
      header: layout.header,
      transpose: layout.transpose,
      locale: layout.locale,
    });
    zmien(gridReplace(value, dane));
    setWynik({ problems: [...podglad.problems, ...dane.problems] });
    setPodglad(null);
  };

  const nazwaSerii = (i: number) => series[i]?.name || t("chartEditor.grid.seriesN", { n: i + 1 });
  const nazwaKategorii = (i: number) =>
    categories[i] || t("chartEditor.grid.categoryN", { n: i + 1 });

  const pelneKategorie = categories.length >= MAX_CATEGORIES;
  const pelneSerie = series.length >= MAX_SERIES;
  const moznaObrocic = gridCanTranspose(value);

  const menuKategorii = (ci: number): GridMenuItem[] => [
    {
      id: "insertAbove",
      label: t("chartEditor.menu.insertAbove"),
      unavailable: pelneKategorie,
      onSelect: () => zmien(gridInsertCategory(value, ci)),
    },
    {
      id: "insertBelow",
      label: t("chartEditor.menu.insertBelow"),
      unavailable: pelneKategorie,
      onSelect: () => zmien(gridInsertCategory(value, ci + 1)),
    },
    {
      id: "moveUp",
      label: t("chartEditor.menu.moveUp"),
      unavailable: ci === 0,
      onSelect: () => zmien(gridMoveCategory(value, ci, -1)),
    },
    {
      id: "moveDown",
      label: t("chartEditor.menu.moveDown"),
      unavailable: ci === categories.length - 1,
      onSelect: () => zmien(gridMoveCategory(value, ci, 1)),
    },
    ...(akcentKategorii
      ? [
          {
            id: "accentCategory",
            label: t("chartEditor.menu.accentCategory"),
            unavailable: value.accentCategory === ci,
            onSelect: () => zmien(gridSetAccentCategory(value, ci)),
          },
        ]
      : []),
    {
      id: "removeCategory",
      label: t("chartEditor.menu.removeCategory"),
      unavailable: categories.length <= GRID_MIN.categories,
      destructive: true,
      onSelect: () => zmien(gridRemoveCategory(value, ci)),
    },
  ];

  const menuSerii = (si: number): GridMenuItem[] => [
    {
      id: "insertBefore",
      label: t("chartEditor.menu.insertBefore"),
      unavailable: pelneSerie,
      onSelect: () => zmien(gridInsertSeries(value, si, defaultSeriesName(series.length, docLang))),
    },
    {
      id: "insertAfter",
      label: t("chartEditor.menu.insertAfter"),
      unavailable: pelneSerie,
      onSelect: () =>
        zmien(gridInsertSeries(value, si + 1, defaultSeriesName(series.length, docLang))),
    },
    {
      id: "moveLeft",
      label: t("chartEditor.menu.moveLeft"),
      unavailable: si === 0,
      onSelect: () => zmien(gridMoveSeries(value, si, -1)),
    },
    {
      id: "moveRight",
      label: t("chartEditor.menu.moveRight"),
      unavailable: si === series.length - 1,
      onSelect: () => zmien(gridMoveSeries(value, si, 1)),
    },
    {
      id: "sortAsc",
      label: t("chartEditor.menu.sortAsc"),
      onSelect: () => zmien(gridSort(value, si, "asc")),
    },
    {
      id: "sortDesc",
      label: t("chartEditor.menu.sortDesc"),
      onSelect: () => zmien(gridSort(value, si, "desc")),
    },
    ...(akcentSerii
      ? [
          {
            id: "accentSeries",
            label: t("chartEditor.menu.accentSeries"),
            unavailable: value.accentSeries === si,
            onSelect: () => zmien(gridSetAccentSeries(value, si)),
          },
        ]
      : []),
    ...(probkiSerii !== null && probkiSerii[si]?.role === null
      ? [
          {
            id: "color",
            label: t("chartEditor.menu.color"),
            // Próbnik otwiera się PO zamknięciu menu - dwa okna naraz
            // walczyłyby o fokus.
            onSelect: () => window.setTimeout(() => setKolor(si), 0),
          },
        ]
      : []),
    {
      id: "removeSeries",
      label: t("chartEditor.menu.removeSeries"),
      unavailable: series.length <= GRID_MIN.series,
      destructive: true,
      onSelect: () => zmien(gridRemoveSeries(value, si)),
    },
  ];

  const przycisk =
    "inline-flex items-center gap-1.5 rounded border border-border px-2 py-1.5 text-xs hover:border-foreground/50 disabled:cursor-default disabled:opacity-40 disabled:hover:border-border";

  return (
    <div ref={rootRef} {...{ [CHART_GRID_ATTR]: "" }} className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={przycisk}
          disabled={pelneKategorie}
          onClick={() => zmien(gridInsertCategory(value, categories.length))}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden /> {t("chartEditor.grid.addCategory")}
        </button>
        <button
          type="button"
          className={przycisk}
          disabled={pelneSerie}
          onClick={() =>
            zmien(gridInsertSeries(value, series.length, defaultSeriesName(series.length, docLang)))
          }
        >
          <Plus className="h-3.5 w-3.5" aria-hidden /> {t("chartEditor.grid.addSeries")}
        </button>
        <button
          type="button"
          className={przycisk}
          disabled={!moznaObrocic}
          title={moznaObrocic ? undefined : t("chartEditor.grid.transposeBlocked")}
          onClick={() => zmien(gridTranspose(value))}
        >
          <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden /> {t("chartEditor.grid.transpose")}
        </button>
        {akcentSerii && series.length > 1 && (
          <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            {t("chartEditor.accent.label")}
            <AdminSelect
              className="h-8 w-44 text-xs"
              value={String(value.accentSeries)}
              aria-label={t("chartEditor.accent.label")}
              onChange={(e) => zmien(gridSetAccentSeries(value, Number(e.target.value)))}
            >
              {series.map((_, i) => (
                <option key={i} value={String(i)}>
                  {nazwaSerii(i)}
                </option>
              ))}
            </AdminSelect>
          </label>
        )}
        {akcentKategorii && (
          <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            {t("chartEditor.accent.categoryLabel")}
            <AdminSelect
              className="h-8 w-48 text-xs"
              value={value.accentCategory === null ? "" : String(value.accentCategory)}
              aria-label={t("chartEditor.accent.categoryLabel")}
              onChange={(e) =>
                zmien(
                  gridSetAccentCategory(
                    value,
                    e.target.value === "" ? null : Number(e.target.value),
                  ),
                )
              }
            >
              <option value="">{t("chartEditor.accent.categoryAuto")}</option>
              {categories.map((_, i) => (
                <option key={i} value={String(i)}>
                  {nazwaKategorii(i)}
                </option>
              ))}
            </AdminSelect>
          </label>
        )}
      </div>

      <div className="overflow-x-auto">
        <table
          className="w-full border-separate border-spacing-1"
          aria-label={t("chartEditor.grid.label")}
        >
          <thead>
            <tr>
              <th className="w-10 px-0 text-[10px] font-medium text-muted-foreground">#</th>
              <th className="px-1 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                {t("chartEditor.grid.corner")}
              </th>
              {series.map((s, si) => {
                const probka = probkiSerii?.[si];
                return (
                  <th key={si} className="min-w-[128px] px-0 align-top font-normal">
                    <div className="flex items-center gap-1">
                      {probka !== undefined &&
                        (probka.role !== null ? (
                          <ColorSwatch color={probka.color} />
                        ) : (
                          <ChartColorPicker
                            slot={s.colorSlot}
                            paint={probka.color}
                            label={t("chartEditor.colors.pickerLabel", { name: nazwaSerii(si) })}
                            open={kolor === si}
                            onOpenChange={(o) => setKolor(o ? si : null)}
                            onChange={(slot) => zmien(gridSetSeriesColor(value, si, slot))}
                            lang={lang}
                            triggerTabIndex={-1}
                          />
                        ))}
                      <TextCell
                        row={-1}
                        col={si}
                        value={s.name}
                        placeholder={t("chartEditor.grid.seriesN", { n: si + 1 })}
                        label={t("chartEditor.grid.seriesName", { n: si + 1 })}
                        sanitize={sanitizeLabel}
                        onChange={(name) => zmien(gridSetSeriesName(value, si, name))}
                        onTablePaste={wklej}
                        onOpenMenu={() => setMenu(`s${si}`)}
                      />
                      <GridMenu
                        label={t("chartEditor.grid.menuSeries", { name: nazwaSerii(si) })}
                        items={menuSerii(si)}
                        open={menu === `s${si}`}
                        onOpenChange={(o) => setMenu(o ? `s${si}` : null)}
                      />
                    </div>
                    {probka !== undefined && probka.role !== null && (
                      <div className="mt-0.5 text-left">
                        <SeriesRoleChip role={probka.role} lang={lang} />
                      </div>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {categories.map((cat, ci) => (
              <tr key={ci}>
                <td className="px-0 text-center text-[10px] text-muted-foreground">
                  <div className="flex items-center justify-center gap-0.5">
                    <span className="tabular-nums">{ci + 1}</span>
                    <GridMenu
                      label={t("chartEditor.grid.menuCategory", { name: nazwaKategorii(ci) })}
                      items={menuKategorii(ci)}
                      open={menu === `c${ci}`}
                      onOpenChange={(o) => setMenu(o ? `c${ci}` : null)}
                    />
                  </div>
                </td>
                <td className="align-top">
                  <TextCell
                    row={ci}
                    col={-1}
                    value={cat}
                    placeholder={t("chartEditor.grid.categoryN", { n: ci + 1 })}
                    label={t("chartEditor.grid.categoryName", { n: ci + 1 })}
                    sanitize={sanitizeLabel}
                    onChange={(label) => zmien(gridSetCategory(value, ci, label))}
                    onTablePaste={wklej}
                    onOpenMenu={() => setMenu(`c${ci}`)}
                  />
                </td>
                {series.map((s, si) => (
                  <td key={si} className="align-top">
                    <NumberCell
                      row={ci}
                      col={si}
                      value={s.values[ci] ?? null}
                      lang={docLang}
                      label={t("chartEditor.grid.cell", {
                        category: nazwaKategorii(ci),
                        series: nazwaSerii(si),
                      })}
                      invalidText={t("chartEditor.grid.invalidNumber")}
                      onCommit={(v) => zmien(gridSetValue(value, ci, si, v))}
                      onTablePaste={wklej}
                      onOpenMenu={() => setMenu(`c${ci}`)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pelneKategorie && (
        <p className="text-[10px] text-muted-foreground">
          {t("chartEditor.grid.limitCategories", { max: MAX_CATEGORIES })}
        </p>
      )}
      {pelneSerie && (
        <p className="text-[10px] text-muted-foreground">
          {t("chartEditor.grid.limitSeries", { max: MAX_SERIES })}
        </p>
      )}
      {probkiSerii !== null && eff === "focus" && (
        <p className="text-[10px] text-muted-foreground">
          {t("chartEditor.colors.focusRoles")} {t("chartEditor.colors.customHint")}.
        </p>
      )}
      <p className="text-[10px] text-muted-foreground">{t("chartEditor.grid.pasteHint")}</p>
      {wynik !== null && (
        <div aria-live="polite" className="space-y-1">
          <p className="text-[11px] text-muted-foreground">{t("chartEditor.grid.pasted")}</p>
          <ImportProblemList problems={wynik.problems} lang={lang} />
        </div>
      )}

      <PastePreviewDialog
        open={podglad !== null}
        rows={podglad?.rows ?? BEZ_WIERSZY}
        mode="chart"
        source={podglad?.source ?? "paste"}
        readProblems={podglad?.problems}
        lang={lang}
        onApply={zastosujPodglad}
        onCancel={() => setPodglad(null)}
      />
    </div>
  );
}

export const ChartDataGrid = forwardRef(ChartDataGridInner);
