// PODGLĄD TABELI PRZED ZASTĄPIENIEM DANYCH - wklejka całej tabeli i import pliku.
//
// Do PR2 import wymieniał arkusz natychmiast, w jednym, sztywnym układzie:
// pierwszy wiersz to serie, pierwsza kolumna to kategorie. Tabela Eurostatu
// (kraje w wierszach, lata w kolumnach) wchodziła więc obrócona, a tabela bez
// nagłówka gubiła pierwszy wiersz danych - i redaktor widział to dopiero na
// wykresie, po zapisie.
//
// Teraz każde ZASTĄPIENIE CAŁEJ TABELI (plik, wklejenie w pustą siatkę albo
// w jej pierwszą komórkę, wklejenie na kanwie w zaznaczony blok) przechodzi
// przez ten podgląd:
//   * „pierwszy wiersz to nagłówek" i „serie w wierszach" - położenia
//     początkowe rozpoznaje `analyseTable`, autor może je przestawić;
//   * format liczb - automatyczny albo wymuszony (polski / angielski), bo
//     „1,234" bez kontekstu jest tysiącem albo ułamkiem;
//   * kolumna wartości - tylko w trybie MAPY: tabela „kraj | 2019 | 2020"
//     daje mapę z jednej, wybranej kolumny;
//   * w trybie MAPY także kolumna krajów i obrót („Rok | PL | DE" ma kraje
//     w nagłówku) - położenia początkowe rozpoznaje `initialMapTableLayout`
//     (`mapTableLayout.ts`), a wynik liczy `mapTableValues`, którą po
//     „Zastosuj" woła też edytor mapy.
// Wynik liczą te same funkcje, które zastosuje edytor (`tableToChartData`,
// `tableToMapValues`), więc podgląd nie może pokazać czegoś innego niż zapis.
// Problemy - odczytu (plik, schowek) i układu - stoją razem pod wynikiem.
//
// Wklejenie zakresu W ŚRODEK siatki tego okna NIE otwiera: trafia od komórki
// kotwicy jednym zapisem, jak w arkuszu (`applyPasteAt`).
import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AdminSelect } from "@/components/admin/blocks/AdminSelect";
import {
  columnLetter,
  rectangularTable,
  tableToChartData,
  type CountryIndex,
  type ImportProblem,
  type NumberLocaleChoice,
} from "@/lib/charts/importTable";
import "@/lib/i18n-map-editor";
import { ImportProblemList } from "./ImportProblemList";
import {
  countryColumnOf,
  firstValueColumn,
  initialMapTableLayout,
  mapLayoutForTranspose,
  mapTableValues,
  orientedMapTable,
  type MapTableLayout,
} from "./mapTableLayout";
import {
  PREVIEW_ROWS,
  PREVIEW_SERIES,
  initialTableLayout,
  type TableLayout,
  type TablePreviewMode,
  type TablePreviewSource,
} from "./tableLayout";
import { useChartEditorT, type EditorLang } from "./chartEditorI18n";

const LOCALES: readonly NumberLocaleChoice[] = ["auto", "pl", "en"];

const LOCALE_LABEL_KEYS: Record<NumberLocaleChoice, string> = {
  auto: "chartEditor.preview.locales.auto",
  pl: "chartEditor.preview.locales.pl",
  en: "chartEditor.preview.locales.en",
};

const TITLE_KEYS: Record<TablePreviewSource, string> = {
  paste: "chartEditor.preview.titlePaste",
  file: "chartEditor.preview.titleFile",
};

const DESCRIPTION_KEYS: Record<TablePreviewMode, string> = {
  chart: "chartEditor.preview.descriptionChart",
  map: "chartEditor.preview.descriptionMap",
};

/** Obrót mówi o seriach na wykresie, a o krajach na mapie. */
const TRANSPOSE_KEYS: Record<TablePreviewMode, string> = {
  chart: "chartEditor.preview.transpose",
  map: "mapEditor.preview.transpose",
};

/** Liczba w podglądzie - zapis kanoniczny, ten sam, który trafi do treści. */
function liczba(v: number | null | undefined): string {
  return v === null || v === undefined ? "" : String(v);
}

interface Props {
  open: boolean;
  rows: readonly (readonly string[])[];
  mode: TablePreviewMode;
  source: TablePreviewSource;
  /** Problemy ODCZYTU (kodowanie, arkusze, obcięcie schowka) - obok problemów układu. */
  readProblems?: readonly ImportProblem[];
  /** Skorowidz krajów regionu (tryb mapy) - bez niego nazwy krajów nie są rozwiązywane. */
  countryIndex?: CountryIndex;
  /** Język napisów; brak = język panelu. */
  lang?: EditorLang;
  onApply: (layout: TableLayout) => void;
  onCancel: () => void;
}

export function PastePreviewDialog({
  open,
  rows,
  mode,
  source,
  readProblems = [],
  countryIndex,
  lang,
  onApply,
  onCancel,
}: Props) {
  const t = useChartEditorT(lang);
  // Mapa rozpoznaje dodatkowo kolumnę krajów i orientację (`MapTableLayout`).
  const poczatkowy = (r: readonly (readonly string[])[]): MapTableLayout =>
    mode === "map" ? initialMapTableLayout(r, countryIndex) : initialTableLayout(r);
  const [layout, setLayout] = useState<MapTableLayout>(() => poczatkowy(rows));
  // Nowa tabela (kolejne wklejenie, inny plik) - przełączniki wracają do
  // rozpoznania, zamiast nieść ustawienia poprzedniej tabeli.
  const [seen, setSeen] = useState(rows);
  if (seen !== rows) {
    setSeen(rows);
    setLayout(poczatkowy(rows));
  }

  // Tabela w orientacji podglądu (mapa: po obrocie) - z niej kolumny i ich nagłówki.
  const tabela = useMemo(
    () => (mode === "map" ? orientedMapTable(rows, layout.transpose) : rectangularTable(rows)),
    [mode, rows, layout.transpose],
  );
  const width = tabela[0]?.length ?? 0;
  const krajKolumna = countryColumnOf(layout);
  const kolumnyWartosci = Array.from({ length: width }, (_, c) => c).filter(
    (c) => c !== krajKolumna,
  );

  const chart = useMemo(
    () =>
      mode === "chart"
        ? tableToChartData(rows, {
            header: layout.header,
            transpose: layout.transpose,
            locale: layout.locale,
          })
        : null,
    [mode, rows, layout],
  );
  const map = useMemo(
    () => (mode === "map" ? mapTableValues(rows, countryIndex, layout) : null),
    [mode, rows, layout, countryIndex],
  );

  const problems: ImportProblem[] = [...readProblems, ...(chart?.problems ?? map?.problems ?? [])];
  const pusto =
    chart !== null
      ? chart.categories.length === 0 || chart.series.length === 0
      : (map?.values.length ?? 0) === 0;
  const total = chart !== null ? chart.categories.length : (map?.values.length ?? 0);

  const naglowekKolumny = (c: number): string => {
    const tekst = layout.header ? (tabela[0]?.[c] ?? "").trim() : "";
    return tekst !== "" ? `${columnLetter(c)} - ${tekst}` : columnLetter(c);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="max-w-2xl w-[95vw] gap-3">
        <DialogHeader>
          <DialogTitle className="text-base">{t(TITLE_KEYS[source])}</DialogTitle>
          <DialogDescription className="text-xs">{t(DESCRIPTION_KEYS[mode])}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={layout.header}
              onChange={(e) => setLayout((l) => ({ ...l, header: e.target.checked }))}
            />
            {t("chartEditor.preview.header")}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={layout.transpose}
              onChange={(e) => {
                const transpose = e.target.checked;
                // Mapa: obrócona tabela ma inne kolumny - kraj i wartość od nowa.
                setLayout((l) =>
                  mode === "map"
                    ? mapLayoutForTranspose(rows, l, transpose, countryIndex)
                    : { ...l, transpose },
                );
              }}
            />
            {t(TRANSPOSE_KEYS[mode])}
          </label>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">{t("chartEditor.preview.locale")}</span>
            <AdminSelect
              className="h-8 w-48 text-xs"
              value={layout.locale}
              aria-label={t("chartEditor.preview.locale")}
              onChange={(e) => {
                const next = LOCALES.find((l) => l === e.target.value);
                if (next !== undefined) setLayout((l) => ({ ...l, locale: next }));
              }}
            >
              {LOCALES.map((l) => (
                <option key={l} value={l}>
                  {t(LOCALE_LABEL_KEYS[l])}
                </option>
              ))}
            </AdminSelect>
          </div>
          {mode === "map" && width > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">{t("mapEditor.preview.countryColumn")}</span>
              <AdminSelect
                className="h-8 w-48 text-xs"
                value={String(krajKolumna)}
                aria-label={t("mapEditor.preview.countryColumn")}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isInteger(n) || n < 0 || n >= width) return;
                  // Kolumna wartości nie może być kolumną krajów - wtedy
                  // przechodzi na pierwszą kolumnę z liczbami obok.
                  setLayout((l) => ({
                    ...l,
                    countryColumn: n,
                    valueColumn:
                      l.valueColumn === n ? firstValueColumn(tabela, n, l.header) : l.valueColumn,
                  }));
                }}
              >
                {Array.from({ length: width }, (_, c) => c).map((c) => (
                  <option key={c} value={String(c)}>
                    {naglowekKolumny(c)}
                  </option>
                ))}
              </AdminSelect>
            </div>
          )}
          {mode === "map" && kolumnyWartosci.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">{t("chartEditor.preview.valueColumn")}</span>
              <AdminSelect
                className="h-8 w-48 text-xs"
                value={String(layout.valueColumn)}
                aria-label={t("chartEditor.preview.valueColumn")}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (kolumnyWartosci.includes(n)) setLayout((l) => ({ ...l, valueColumn: n }));
                }}
              >
                {kolumnyWartosci.map((c) => (
                  <option key={c} value={String(c)}>
                    {naglowekKolumny(c)}
                  </option>
                ))}
              </AdminSelect>
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <p className="text-[11px] text-muted-foreground" aria-live="polite">
            {pusto
              ? t("chartEditor.preview.empty")
              : chart !== null
                ? t("chartEditor.preview.summaryChart", {
                    categories: chart.categories.length,
                    series: chart.series.length,
                  })
                : t("chartEditor.preview.summaryMap", { count: total })}
          </p>
          {!pusto && chart !== null && (
            <div className="max-h-64 overflow-auto rounded border border-border">
              <table className="w-full border-collapse text-[11px]" data-testid="paste-preview">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="border-b border-r px-2 py-1 text-left font-medium" />
                    {chart.series.slice(0, PREVIEW_SERIES).map((s, i) => (
                      <th key={i} className="border-b border-r px-2 py-1 text-left font-medium">
                        {s.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {chart.categories.slice(0, PREVIEW_ROWS).map((c, ri) => (
                    <tr key={ri}>
                      <td className="border-b border-r px-2 py-1">{c}</td>
                      {chart.series.slice(0, PREVIEW_SERIES).map((s, si) => (
                        <td
                          key={si}
                          className="border-b border-r px-2 py-1 text-right tabular-nums"
                        >
                          {liczba(s.values[ri])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!pusto && map !== null && (
            <div className="max-h-64 overflow-auto rounded border border-border">
              <table className="w-full border-collapse text-[11px]" data-testid="paste-preview">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="border-b border-r px-2 py-1 text-left font-medium">
                      {t("chartEditor.preview.country")}
                    </th>
                    <th className="border-b border-r px-2 py-1 text-left font-medium">
                      {t("chartEditor.preview.value")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {map.values.slice(0, PREVIEW_ROWS).map((d) => (
                    <tr key={d.id}>
                      <td className="border-b border-r px-2 py-1">{d.id}</td>
                      <td className="border-b border-r px-2 py-1 text-right tabular-nums">
                        {liczba(d.value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!pusto && total > PREVIEW_ROWS && (
            <p className="text-[10px] text-muted-foreground">
              {t("chartEditor.preview.shown", { shown: PREVIEW_ROWS, total })}
            </p>
          )}
          <ImportProblemList problems={problems} lang={lang} />
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={onCancel}
          >
            {t("chartEditor.preview.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8 text-xs"
            disabled={pusto}
            onClick={() => onApply(layout)}
          >
            {t("chartEditor.preview.apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
