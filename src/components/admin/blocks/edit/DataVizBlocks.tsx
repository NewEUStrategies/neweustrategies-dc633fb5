// Admin edytory bloków wizualizacji danych: "chart" i "data-map".
// Arkusz danych (kategorie x serie) + ustawienia + PODGLĄD NA ŻYWO nad formą -
// autor widzi dokładnie ten sam render, który trafi na stronę publiczną
// (wspólny silnik src/components/charts).
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";
import type { Block, Json } from "@/lib/blocks/types";
// `toJson` zamiast `as unknown as Json` w miejscu użycia: podwójne
// rzutowanie omija kontrolę typów tak samo jak `as any`, tylko nie zapala
// reguły lintera - dlatego repo trzyma ten escape-hatch w JEDNYM
// audytowalnym miejscu, a bramka `check:unknown-casts` pilnuje, żeby nie
// rozsypał się po komponentach.
import { toJson } from "@/lib/content-model/json";
import { Plus, Trash2, TriangleAlert } from "lucide-react";
import { AdminSelect } from "../AdminSelect";
import {
  CHART_HEIGHT_MAX,
  CHART_HEIGHT_MIN,
  MAX_CATEGORIES,
  parseChartConfig,
  parseDataMapConfig,
} from "@/lib/charts/parse";
import {
  CATEGORICAL_SAFE_SERIES,
  MAX_SERIES,
  PIE_MAX_SLICES,
  type ChartKind,
  type MapRegion,
} from "@/lib/charts/types";
import { isForecastMissingBand, seriesOverSafePalette } from "@/lib/charts/honesty";
import { SLOTS_CLASHING_WITH_SIGN } from "@/lib/charts/palette";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-charts";
import { geoAssetQueryOptions } from "@/lib/charts/geoQuery";
import { Chart } from "@/components/charts/Chart";
import { ChoroplethMap } from "@/components/charts/ChoroplethMap";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

const KIND_OPTIONS: ReadonlyArray<{ value: ChartKind; labelKey: string }> = [
  { value: "bar", labelKey: "kinds.bar" },
  { value: "bar-horizontal", labelKey: "kinds.barHorizontal" },
  { value: "line", labelKey: "kinds.line" },
  { value: "area", labelKey: "kinds.area" },
  { value: "pie", labelKey: "kinds.pie" },
  { value: "donut", labelKey: "kinds.donut" },
  // Wodospad jest narzędziem DOMYŚLNYM dla każdego pytania "od czego do
  // czego" - mostek EBITDA rok do roku, dekompozycja zmiany marży. Te same
  // dane słupkami obok siebie zmuszają czytelnika do dodawania w głowie.
  { value: "waterfall", labelKey: "kinds.waterfall" },
];

function Shell({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-3 space-y-2 bg-muted/20">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

const inputCls = "w-full text-xs bg-background border border-border rounded px-2 py-2 h-9";
const cellCls =
  "w-full min-w-[72px] text-xs bg-background border border-border rounded px-2 py-1.5 h-8 tabular-nums";

// ===== Chart =====

interface SeriesDraft {
  name: string;
  values: (number | null)[];
  colorSlot: number;
}

function readSeries(raw: Json | undefined, rows: number): SeriesDraft[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_SERIES).map((item, si) => {
    const o = (item ?? {}) as Record<string, Json>;
    const values = Array.isArray(o.values) ? o.values : [];
    return {
      name: String(o.name ?? ""),
      values: Array.from({ length: rows }, (_, i) => {
        const v = values[i];
        if (typeof v === "number" && Number.isFinite(v)) return v;
        if (typeof v === "string" && v.trim() !== "") {
          const n = Number(v.replace(",", "."));
          return Number.isFinite(n) ? n : null;
        }
        return null;
      }),
      colorSlot:
        typeof o.colorSlot === "number" && o.colorSlot >= 1 && o.colorSlot <= MAX_SERIES
          ? Math.round(o.colorSlot)
          : si + 1,
    };
  });
}

function seriesToJson(series: SeriesDraft[]): Json[] {
  return series.map((s) => ({
    name: s.name,
    values: s.values.map((v) => (v === null ? null : v)),
    colorSlot: s.colorSlot,
  }));
}

export function ChartBlock({ block, onChange }: Props) {
  const bt = useBlocksI18n();
  const categories = (Array.isArray(block.data.categories) ? block.data.categories : []).map((c) =>
    String(c ?? ""),
  );
  const series = readSeries(block.data.series, categories.length);
  const kind = String(block.data.variant ?? block.data.kind ?? "bar");
  const previewConfig = useMemo(() => parseChartConfig(block.data), [block.data]);
  // `keyPrefix` haka, nie sklejanie szablonem - inaczej bramka rozjazdu
  // kod<->słownik nie sprawdzi tych kluczy wcale.
  const { t: ct } = useTranslation("translation", { keyPrefix: "charts" });

  const patch = (data: Record<string, Json>) =>
    onChange({ ...block, data: { ...block.data, ...data } });

  const smoothing =
    typeof block.data.smoothing === "number"
      ? Math.max(0, Math.min(1, block.data.smoothing))
      : 0.55;

  const metricRaw = (block.data.metric ?? {}) as Record<string, Json>;
  const metric = {
    name: String(metricRaw.name ?? ""),
    expansion: String(metricRaw.expansion ?? ""),
    formula: String(metricRaw.formula ?? ""),
    measures: String(metricRaw.measures ?? ""),
    reading: String(metricRaw.reading ?? ""),
    levers: String(metricRaw.levers ?? ""),
    caution: String(metricRaw.caution ?? ""),
  };
  const patchMetric = (next: Partial<typeof metric>) =>
    patch({ metric: toJson({ ...metric, ...next }) });

  // ---- OSTRZEŻENIA DYSCYPLINY ----
  // Reguły doboru formy i palety, których kod NIE MOŻE wymusić, bo mają
  // wyjątki - ale których milczenie kosztuje czytelność. Liczone z tego samego
  // configu, który idzie do podglądu, więc autor widzi ostrzeżenie obok
  // wykresu, którego ono dotyczy.
  const overSafePalette = seriesOverSafePalette(previewConfig, CATEGORICAL_SAFE_SERIES);
  const usedSlots = series.map((s) => s.colorSlot);
  const isPie = kind === "pie" || kind === "donut";
  const isWaterfall = kind === "waterfall";
  const sliceOverflow = isPie ? Math.max(0, categories.length - PIE_MAX_SLICES) : 0;
  // Terakota wypada z palety TYLKO na wykresie, który koduje znak czerwienią -
  // czyli na mostku. Na zwykłych kolumnach reguła nie obowiązuje i krzyczenie
  // o niej byłoby szumem.
  const signClash =
    isWaterfall && usedSlots.some((slot) => SLOTS_CLASHING_WITH_SIGN.includes(slot));
  // OCHRA WOBEC AKCENTU NIE JEST TU OSTRZEŻENIEM, i to jest decyzja, nie
  // przeoczenie. Kolizja ochry z pomarańczowym akcentem marki (przy
  // deuteranopii dystans 1,6, czyli praktycznie ten sam kolor) jest FAKTEM
  // PALETY i pilnuje jej bramka `__tests__/palette.test.ts`. Autor nie ma
  // jednak żadnego pola, którym wprowadza akcent do wykresu: w silniku
  // `--chart-accent` występuje wyłącznie jako obwódka fokusu, czyli stan
  // przelotny i sterowany klawiaturą, nigdy jako kolor danych. Ostrzeżenie
  // odpalało się więc zawsze, gdy użyto slotu 2 - a slot 2 jest domyślnym
  // kolorem DRUGIEJ SERII, czyli komunikat wisiał nad niemal każdym wykresem
  // o dwóch seriach. Ostrzeżenie, które widać zawsze, uczy ignorowania
  // wszystkich ostrzeżeń, w tym tych o realnej kolizji znaku (`signClash`).

  const setCategories = (next: string[], nextSeries?: SeriesDraft[]) =>
    patch({
      categories: next,
      series: seriesToJson(nextSeries ?? series),
    });

  const setSeries = (next: SeriesDraft[]) => patch({ series: seriesToJson(next) });

  return (
    <Shell label={bt.editor("chart", "shellLabel")}>
      {/* Podgląd na żywo - dokładnie ten sam silnik, co strona publiczna. */}
      <div className="pointer-events-none">
        <Chart config={{ ...previewConfig, animate: false }} lang="pl" className="my-0" />
      </div>

      {overSafePalette > 0 && (
        <Warning text={ct("editor.tooManySeries", { max: CATEGORICAL_SAFE_SERIES })} />
      )}
      {sliceOverflow > 0 && <Warning text={ct("editor.tooManySlices", { max: PIE_MAX_SLICES })} />}
      {signClash && <Warning text={ct("editor.signClashesWithTerracotta")} />}

      <div className="grid grid-cols-2 gap-2">
        <AdminSelect
          className={inputCls}
          value={kind}
          onChange={(e) => patch({ kind: e.target.value, variant: e.target.value })}
        >
          {KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {bt.editor("chart", o.labelKey)}
            </option>
          ))}
        </AdminSelect>
        <input
          className={inputCls}
          value={String(block.data.unit ?? "")}
          placeholder={bt.editor("chart", "unit")}
          onChange={(e) => patch({ unit: e.target.value })}
        />
      </div>
      <input
        className={inputCls}
        value={String(block.data.title ?? "")}
        placeholder={bt.editor("chart", "title")}
        onChange={(e) => patch({ title: e.target.value })}
      />
      <input
        className={inputCls}
        value={String(block.data.description ?? "")}
        placeholder={bt.editor("common", "subtitle")}
        onChange={(e) => patch({ description: e.target.value })}
      />

      {/* Arkusz danych: wiersz = kategoria, kolumny = serie. */}
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-1">
          <thead>
            <tr>
              <th className="text-left text-[10px] uppercase tracking-wide text-muted-foreground px-1">
                {bt.editor("chart", "category")}
              </th>
              {series.map((s, si) => (
                <th key={si} className="min-w-[96px] px-0">
                  <div className="flex items-center gap-1">
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                      style={{ background: `var(--chart-${s.colorSlot})` }}
                    />
                    <input
                      className={cellCls}
                      value={s.name}
                      placeholder={bt.editor("chart", "series", { n: si + 1 })}
                      onChange={(e) => {
                        const next = series.map((x, i) =>
                          i === si ? { ...x, name: e.target.value } : x,
                        );
                        setSeries(next);
                      }}
                    />
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={bt.editor("chart", "removeSeries", { name: s.name || si + 1 })}
                      onClick={() => setSeries(series.filter((_, i) => i !== si))}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </th>
              ))}
              <th className="w-8">
                {series.length < MAX_SERIES && (
                  <button
                    type="button"
                    className="inline-flex items-center justify-center w-7 h-7 rounded border border-border hover:border-foreground/50"
                    aria-label={bt.editor("chart", "addSeries")}
                    onClick={() =>
                      setSeries([
                        ...series,
                        {
                          name: "",
                          values: categories.map(() => null),
                          colorSlot: series.length + 1,
                        },
                      ])
                    }
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {categories.map((cat, ci) => (
              <tr key={ci}>
                <td>
                  <input
                    className={cellCls}
                    value={cat}
                    placeholder={bt.editor("chart", "categoryN", { n: ci + 1 })}
                    onChange={(e) =>
                      setCategories(categories.map((c, i) => (i === ci ? e.target.value : c)))
                    }
                  />
                </td>
                {series.map((s, si) => (
                  <td key={si}>
                    <input
                      className={cellCls}
                      inputMode="decimal"
                      value={s.values[ci] === null ? "" : String(s.values[ci])}
                      placeholder="-"
                      onChange={(e) => {
                        const raw = e.target.value.trim().replace(",", ".");
                        const v = raw === "" ? null : Number(raw);
                        const next = series.map((x, i) =>
                          i === si
                            ? {
                                ...x,
                                values: x.values.map((old, vi) =>
                                  vi === ci ? (v === null || !Number.isFinite(v) ? null : v) : old,
                                ),
                              }
                            : x,
                        );
                        setSeries(next);
                      }}
                    />
                  </td>
                ))}
                <td>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={bt.editor("chart", "removeCategory", { name: cat || ci + 1 })}
                    onClick={() =>
                      setCategories(
                        categories.filter((_, i) => i !== ci),
                        series.map((s) => ({
                          ...s,
                          values: s.values.filter((_, i) => i !== ci),
                        })),
                      )
                    }
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {categories.length < MAX_CATEGORIES && (
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-xs px-2 py-1.5 rounded border border-border hover:border-foreground/50"
          onClick={() =>
            setCategories(
              [...categories, ""],
              series.map((s) => ({ ...s, values: [...s.values, null] })),
            )
          }
        >
          <Plus className="w-3.5 h-3.5" /> {bt.editor("chart", "addCategory")}
        </button>
      )}

      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={block.data.stacked === true}
            onChange={(e) => patch({ stacked: e.target.checked })}
          />
          {bt.editor("chart", "stacked")}
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={block.data.showLegend !== false}
            onChange={(e) => patch({ showLegend: e.target.checked })}
          />
          {bt.editor("common", "legend")}
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={block.data.showGrid !== false}
            onChange={(e) => patch({ showGrid: e.target.checked })}
          />
          {bt.editor("chart", "grid")}
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={block.data.showValues === true}
            onChange={(e) => patch({ showValues: e.target.checked })}
          />
          {bt.editor("chart", "showValues")}
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={block.data.animate !== false}
            onChange={(e) => patch({ animate: e.target.checked })}
          />
          {bt.editor("common", "animate")}
        </label>
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
        <input
          type="range"
          min={CHART_HEIGHT_MIN}
          max={CHART_HEIGHT_MAX}
          step={10}
          value={Number(block.data.height ?? 320)}
          onChange={(e) => patch({ height: Number(e.target.value) })}
          aria-label={bt.editor("chart", "height")}
        />
        <span className="text-xs tabular-nums text-muted-foreground w-14 text-right">
          {Number(block.data.height ?? 320)}px
        </span>
      </div>
      {/* ---- PODPIS UCZCIWOŚCIOWY ----
          Jednostka, źródło, DATA DANYCH, `n` i trzy zdania. Cztery z tych pól
          autor pominąłby, gdyby ich nie było w formie - a wykres bez nich
          wygląda dokładnie tak samo i znaczy co innego. */}
      <FieldGroup label={bt.editor("chart", "honestyLabel")}>
        <input
          className={inputCls}
          value={String(block.data.source ?? "")}
          placeholder={bt.editor("chart", "source")}
          onChange={(e) => patch({ source: e.target.value })}
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            className={inputCls}
            value={String(block.data.sourceDate ?? "")}
            placeholder={bt.editor("chart", "sourceDate")}
            onChange={(e) => patch({ sourceDate: e.target.value })}
          />
          <input
            className={inputCls}
            inputMode="numeric"
            value={block.data.sampleSize == null ? "" : String(block.data.sampleSize)}
            placeholder={bt.editor("chart", "sampleSize")}
            onChange={(e) => {
              const raw = e.target.value.trim();
              patch({ sampleSize: raw === "" ? null : Number(raw) });
            }}
          />
        </div>
        <input
          className={inputCls}
          value={String(block.data.notesShows ?? "")}
          placeholder={bt.editor("chart", "notesShows")}
          onChange={(e) => patch({ notesShows: e.target.value })}
        />
        <input
          className={inputCls}
          value={String(block.data.notesSurprising ?? "")}
          placeholder={bt.editor("chart", "notesSurprising")}
          onChange={(e) => patch({ notesSurprising: e.target.value })}
        />
        <input
          className={inputCls}
          value={String(block.data.notesHidden ?? "")}
          placeholder={bt.editor("chart", "notesHidden")}
          onChange={(e) => patch({ notesHidden: e.target.value })}
        />
        {!String(block.data.notesHidden ?? "").trim() && (
          <Warning text={ct("editor.missingNotes")} />
        )}
      </FieldGroup>

      {/* ---- KSZTAŁT I PROGNOZA ---- */}
      <FieldGroup label={bt.editor("chart", "shapeLabel")}>
        <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(smoothing * 100)}
            onChange={(e) => patch({ smoothing: Number(e.target.value) / 100 })}
            aria-label={bt.editor("chart", "smoothing")}
          />
          <span className="text-xs tabular-nums text-muted-foreground w-14 text-right">
            {Math.round(smoothing * 100)}%
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground">{bt.editor("chart", "smoothingHint")}</p>
        <div className="grid grid-cols-2 gap-2">
          <input
            className={inputCls}
            inputMode="numeric"
            value={block.data.forecastFrom == null ? "" : String(block.data.forecastFrom)}
            placeholder={bt.editor("chart", "forecastFrom")}
            onChange={(e) => {
              const raw = e.target.value.trim();
              patch({ forecastFrom: raw === "" ? null : Number(raw) });
            }}
          />
          <input
            className={inputCls}
            inputMode="numeric"
            value={block.data.forecastBandPct == null ? "" : String(block.data.forecastBandPct)}
            placeholder={bt.editor("chart", "forecastBandPct")}
            onChange={(e) => {
              const raw = e.target.value.trim();
              patch({ forecastBandPct: raw === "" ? 0 : Number(raw) });
            }}
          />
        </div>
        <p className="text-[10px] text-muted-foreground">
          {bt.editor("chart", "forecastFromHint")}
        </p>
        {isForecastMissingBand(previewConfig) && (
          <Warning text={ct("editor.forecastWithoutBand")} />
        )}
      </FieldGroup>

      {/* ---- WYJAŚNIENIE WSKAŹNIKA ----
          Tooltip o STAŁYCH pięciu polach. Pozostałe pola pokazują się dopiero
          po podaniu skrótu, bo bez nazwy nie ma czego zaczepić ikony. */}
      <FieldGroup label={bt.editor("chart", "metricLabel")}>
        <input
          className={inputCls}
          value={metric.name}
          placeholder={bt.editor("chart", "metricName")}
          onChange={(e) => patchMetric({ name: e.target.value })}
        />
        {metric.name.trim() !== "" && (
          <>
            <input
              className={inputCls}
              value={metric.expansion}
              placeholder={bt.editor("chart", "metricExpansion")}
              onChange={(e) => patchMetric({ expansion: e.target.value })}
            />
            <input
              className={inputCls}
              value={metric.formula}
              placeholder={bt.editor("chart", "metricFormula")}
              onChange={(e) => patchMetric({ formula: e.target.value })}
            />
            <input
              className={inputCls}
              value={metric.measures}
              placeholder={bt.editor("chart", "metricMeasures")}
              onChange={(e) => patchMetric({ measures: e.target.value })}
            />
            <input
              className={inputCls}
              value={metric.reading}
              placeholder={bt.editor("chart", "metricReading")}
              onChange={(e) => patchMetric({ reading: e.target.value })}
            />
            <input
              className={inputCls}
              value={metric.levers}
              placeholder={bt.editor("chart", "metricLevers")}
              onChange={(e) => patchMetric({ levers: e.target.value })}
            />
            <input
              className={inputCls}
              value={metric.caution}
              placeholder={bt.editor("chart", "metricCaution")}
              onChange={(e) => patchMetric({ caution: e.target.value })}
            />
          </>
        )}
      </FieldGroup>
    </Shell>
  );
}

/** Sekcja formy z podpisem - grupuje pola, których autor inaczej nie znajdzie. */
function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 rounded-md border border-border/60 p-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

/**
 * Ostrzeżenie dyscypliny. NIE BLOKUJE zapisu - mówi, co się psuje, i zostawia
 * decyzję autorowi. Blokada byłaby tu gorsza: reguły doboru formy mają
 * wyjątki, których kod nie zna, a zablokowany autor obchodzi walidację
 * zamiast czytać powód.
 */
function Warning({ text }: { text: string }) {
  return (
    <p
      className="flex items-start gap-1.5 text-[11px] leading-snug"
      style={{ color: "var(--chart-negative-text)" }}
    >
      <TriangleAlert className="mt-px h-3 w-3 shrink-0" aria-hidden />
      <span>{text}</span>
    </p>
  );
}

// ===== Data map =====

interface MapRowDraft {
  id: string;
  value: number | null;
}

function readMapValues(raw: Json | undefined): MapRowDraft[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const o = (item ?? {}) as Record<string, Json>;
    const v = o.value;
    return {
      id: String(o.id ?? "").toUpperCase(),
      value: typeof v === "number" && Number.isFinite(v) ? v : null,
    };
  });
}

export function DataMapBlock({ block, onChange }: Props) {
  const bt = useBlocksI18n();
  const region: MapRegion = String(block.data.region ?? "europe") === "world" ? "world" : "europe";
  const rows = readMapValues(block.data.values);
  const previewConfig = useMemo(() => parseDataMapConfig(block.data), [block.data]);

  // Lista krajów z tego samego statycznego zasobu, który rysuje mapę -
  // zero dodatkowych danych w bundlu, opcje zawsze zgodne z geometrią.
  const geo = useQuery(geoAssetQueryOptions(region));
  const countryOptions = useMemo(
    () =>
      (geo.data?.countries ?? [])
        .map((c) => ({ id: c.id, label: `${c.pl} (${c.id})` }))
        .sort((a, b) => a.label.localeCompare(b.label, "pl")),
    [geo.data],
  );

  const patch = (data: Record<string, Json>) =>
    onChange({ ...block, data: { ...block.data, ...data } });

  const setRows = (next: MapRowDraft[]) =>
    patch({ values: next.map((r) => ({ id: r.id, value: r.value })) });

  return (
    <Shell label={bt.editor("dataMap", "shellLabel")}>
      <div className="pointer-events-none">
        <ChoroplethMap config={{ ...previewConfig, animate: false }} lang="pl" className="my-0" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <AdminSelect
          className={inputCls}
          value={region}
          onChange={(e) => patch({ region: e.target.value })}
        >
          <option value="europe">{bt.editor("dataMap", "europe")}</option>
          <option value="world">{bt.editor("dataMap", "world")}</option>
        </AdminSelect>
        <input
          className={inputCls}
          value={String(block.data.unit ?? "")}
          placeholder={bt.editor("dataMap", "unit")}
          onChange={(e) => patch({ unit: e.target.value })}
        />
      </div>
      <input
        className={inputCls}
        value={String(block.data.title ?? "")}
        placeholder={bt.editor("dataMap", "title")}
        onChange={(e) => patch({ title: e.target.value })}
      />
      <input
        className={inputCls}
        value={String(block.data.description ?? "")}
        placeholder={bt.editor("common", "subtitle")}
        onChange={(e) => patch({ description: e.target.value })}
      />

      <div className="space-y-1.5">
        {rows.map((row, ri) => (
          <div key={ri} className="flex items-center gap-2">
            <AdminSelect
              className={`${inputCls} flex-1`}
              value={row.id}
              onChange={(e) =>
                setRows(rows.map((r, i) => (i === ri ? { ...r, id: e.target.value } : r)))
              }
            >
              <option value="">{bt.editor("dataMap", "selectCountry")}</option>
              {countryOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
              {/* Zachowaj kod spoza listy (np. zanim zasób się wczyta). */}
              {row.id && !countryOptions.some((o) => o.id === row.id) && (
                <option value={row.id}>{row.id}</option>
              )}
            </AdminSelect>
            <input
              className={`${cellCls} w-28`}
              inputMode="decimal"
              value={row.value === null ? "" : String(row.value)}
              placeholder={bt.editor("dataMap", "value")}
              onChange={(e) => {
                const raw = e.target.value.trim().replace(",", ".");
                const v = raw === "" ? null : Number(raw);
                setRows(
                  rows.map((r, i) =>
                    i === ri ? { ...r, value: v === null || !Number.isFinite(v) ? null : v } : r,
                  ),
                );
              }}
            />
            <button
              type="button"
              className="text-muted-foreground hover:text-destructive"
              aria-label={bt.editor("dataMap", "removeRow", { name: row.id || ri + 1 })}
              onClick={() => setRows(rows.filter((_, i) => i !== ri))}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-xs px-2 py-1.5 rounded border border-border hover:border-foreground/50"
          onClick={() => setRows([...rows, { id: "", value: null }])}
        >
          <Plus className="w-3.5 h-3.5" /> {bt.editor("dataMap", "addCountry")}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={block.data.showLegend !== false}
            onChange={(e) => patch({ showLegend: e.target.checked })}
          />
          {bt.editor("common", "legend")}
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={block.data.animate !== false}
            onChange={(e) => patch({ animate: e.target.checked })}
          />
          {bt.editor("common", "animate")}
        </label>
      </div>
      <input
        className={inputCls}
        value={String(block.data.source ?? "")}
        placeholder={bt.editor("dataMap", "source")}
        onChange={(e) => patch({ source: e.target.value })}
      />
    </Shell>
  );
}
