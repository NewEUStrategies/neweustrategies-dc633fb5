// Admin edytory bloków wizualizacji danych: "chart" i "data-map".
// Arkusz danych (kategorie x serie) + ustawienia + PODGLĄD NA ŻYWO nad formą -
// autor widzi dokładnie ten sam render, który trafi na stronę publiczną
// (wspólny silnik src/components/charts).
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Block, Json } from "@/lib/blocks/types";
import { Plus, Trash2 } from "lucide-react";
import { AdminSelect } from "../AdminSelect";
import {
  CHART_HEIGHT_MAX,
  CHART_HEIGHT_MIN,
  MAX_CATEGORIES,
  parseChartConfig,
  parseDataMapConfig,
} from "@/lib/charts/parse";
import {
  GEO_ASSET_URL,
  MAX_SERIES,
  type ChartKind,
  type GeoAsset,
  type MapRegion,
} from "@/lib/charts/types";
import { Chart } from "@/components/charts/Chart";
import { ChoroplethMap } from "@/components/charts/ChoroplethMap";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

const KIND_OPTIONS: ReadonlyArray<{ value: ChartKind; label: string }> = [
  { value: "bar", label: "Kolumny" },
  { value: "bar-horizontal", label: "Słupki poziome" },
  { value: "line", label: "Linia" },
  { value: "area", label: "Pole (area)" },
  { value: "pie", label: "Kołowy" },
  { value: "donut", label: "Pierścień (donut)" },
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
  const categories = (Array.isArray(block.data.categories) ? block.data.categories : []).map((c) =>
    String(c ?? ""),
  );
  const series = readSeries(block.data.series, categories.length);
  const kind = String(block.data.variant ?? block.data.kind ?? "bar");
  const previewConfig = useMemo(() => parseChartConfig(block.data), [block.data]);

  const patch = (data: Record<string, Json>) =>
    onChange({ ...block, data: { ...block.data, ...data } });

  const setCategories = (next: string[], nextSeries?: SeriesDraft[]) =>
    patch({
      categories: next,
      series: seriesToJson(nextSeries ?? series),
    });

  const setSeries = (next: SeriesDraft[]) => patch({ series: seriesToJson(next) });

  return (
    <Shell label="Wykres">
      {/* Podgląd na żywo - dokładnie ten sam silnik, co strona publiczna. */}
      <div className="pointer-events-none">
        <Chart config={{ ...previewConfig, animate: false }} lang="pl" className="my-0" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <AdminSelect
          className={inputCls}
          value={kind}
          onChange={(e) => patch({ kind: e.target.value, variant: e.target.value })}
        >
          {KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </AdminSelect>
        <input
          className={inputCls}
          value={String(block.data.unit ?? "")}
          placeholder="Jednostka (np. %, mld EUR)"
          onChange={(e) => patch({ unit: e.target.value })}
        />
      </div>
      <input
        className={inputCls}
        value={String(block.data.title ?? "")}
        placeholder="Tytuł wykresu"
        onChange={(e) => patch({ title: e.target.value })}
      />
      <input
        className={inputCls}
        value={String(block.data.description ?? "")}
        placeholder="Opis (podtytuł)"
        onChange={(e) => patch({ description: e.target.value })}
      />

      {/* Arkusz danych: wiersz = kategoria, kolumny = serie. */}
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-1">
          <thead>
            <tr>
              <th className="text-left text-[10px] uppercase tracking-wide text-muted-foreground px-1">
                Kategoria
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
                      placeholder={`Seria ${si + 1}`}
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
                      aria-label={`Usuń serię ${s.name || si + 1}`}
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
                    aria-label="Dodaj serię"
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
                    placeholder={`Kategoria ${ci + 1}`}
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
                    aria-label={`Usuń kategorię ${cat || ci + 1}`}
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
          <Plus className="w-3.5 h-3.5" /> Dodaj kategorię
        </button>
      )}

      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={block.data.stacked === true}
            onChange={(e) => patch({ stacked: e.target.checked })}
          />
          Skumulowany (stacked)
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={block.data.showLegend !== false}
            onChange={(e) => patch({ showLegend: e.target.checked })}
          />
          Legenda
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={block.data.showGrid !== false}
            onChange={(e) => patch({ showGrid: e.target.checked })}
          />
          Siatka
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={block.data.showValues === true}
            onChange={(e) => patch({ showValues: e.target.checked })}
          />
          Etykiety wartości
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={block.data.animate !== false}
            onChange={(e) => patch({ animate: e.target.checked })}
          />
          Animacja wejścia
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
          aria-label="Wysokość wykresu"
        />
        <span className="text-xs tabular-nums text-muted-foreground w-14 text-right">
          {Number(block.data.height ?? 320)}px
        </span>
      </div>
      <input
        className={inputCls}
        value={String(block.data.source ?? "")}
        placeholder="Źródło danych (np. Źródło: Eurostat 2026)"
        onChange={(e) => patch({ source: e.target.value })}
      />
    </Shell>
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
  const region: MapRegion = String(block.data.region ?? "europe") === "world" ? "world" : "europe";
  const rows = readMapValues(block.data.values);
  const previewConfig = useMemo(() => parseDataMapConfig(block.data), [block.data]);

  // Lista krajów z tego samego statycznego zasobu, który rysuje mapę -
  // zero dodatkowych danych w bundlu, opcje zawsze zgodne z geometrią.
  const geo = useQuery({
    queryKey: ["public", "geo", region] as const,
    queryFn: async (): Promise<GeoAsset> => {
      const res = await fetch(GEO_ASSET_URL[region]);
      if (!res.ok) throw new Error(`geo asset ${region}: HTTP ${res.status}`);
      return (await res.json()) as GeoAsset;
    },
    staleTime: Infinity,
    gcTime: 24 * 60 * 60 * 1000,
  });
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
    <Shell label="Mapa danych">
      <div className="pointer-events-none">
        <ChoroplethMap config={{ ...previewConfig, animate: false }} lang="pl" className="my-0" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <AdminSelect
          className={inputCls}
          value={region}
          onChange={(e) => patch({ region: e.target.value })}
        >
          <option value="europe">Europa</option>
          <option value="world">Świat</option>
        </AdminSelect>
        <input
          className={inputCls}
          value={String(block.data.unit ?? "")}
          placeholder="Jednostka (np. %, mln)"
          onChange={(e) => patch({ unit: e.target.value })}
        />
      </div>
      <input
        className={inputCls}
        value={String(block.data.title ?? "")}
        placeholder="Tytuł mapy"
        onChange={(e) => patch({ title: e.target.value })}
      />
      <input
        className={inputCls}
        value={String(block.data.description ?? "")}
        placeholder="Opis (podtytuł)"
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
              <option value="">- wybierz kraj -</option>
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
              placeholder="Wartość"
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
              aria-label={`Usuń wiersz ${row.id || ri + 1}`}
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
          <Plus className="w-3.5 h-3.5" /> Dodaj kraj
        </button>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={block.data.showLegend !== false}
            onChange={(e) => patch({ showLegend: e.target.checked })}
          />
          Legenda
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={block.data.animate !== false}
            onChange={(e) => patch({ animate: e.target.checked })}
          />
          Animacja wejścia
        </label>
      </div>
      <input
        className={inputCls}
        value={String(block.data.source ?? "")}
        placeholder="Źródło danych"
        onChange={(e) => patch({ source: e.target.value })}
      />
    </Shell>
  );
}
