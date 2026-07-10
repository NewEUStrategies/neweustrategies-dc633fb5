// Defensywne parsowanie konfiguracji wykresów/map z Json (bloki CMS i widgety
// buildera). Ten sam wzorzec co parseItems w InteractiveViews: String()/Number()
// koercja, twarde klamry, zero any.

import type { Json } from "@/lib/blocks/types";
import {
  CHART_KINDS,
  MAX_SERIES,
  type ChartConfig,
  type ChartKind,
  type ChartSeries,
  type DataMapConfig,
  type MapDatum,
  type MapRegion,
} from "./types";

export const CHART_HEIGHT_MIN = 160;
export const CHART_HEIGHT_MAX = 640;
export const CHART_HEIGHT_DEFAULT = 320;
/** Twardy limit kategorii - edytor CMS, nie hurtownia danych. */
export const MAX_CATEGORIES = 60;

function asRecord(raw: Json | undefined): Record<string, Json> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

function num(raw: Json | undefined): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && raw.trim() !== "") {
    const v = Number(raw.replace(",", "."));
    return Number.isFinite(v) ? v : null;
  }
  return null;
}

export function parseChartKind(raw: Json | undefined): ChartKind {
  const s = String(raw ?? "");
  return (CHART_KINDS as readonly string[]).includes(s) ? (s as ChartKind) : "bar";
}

export function parseChartSeries(raw: Json | undefined, categoriesCount: number): ChartSeries[] {
  if (!Array.isArray(raw)) return [];
  const out: ChartSeries[] = [];
  for (const item of raw.slice(0, MAX_SERIES)) {
    const o = asRecord(item);
    const valuesRaw = Array.isArray(o.values) ? o.values : [];
    const values: (number | null)[] = Array.from({ length: categoriesCount }, (_, i) =>
      num(valuesRaw[i]),
    );
    const slotRaw = num(o.colorSlot);
    out.push({
      name: String(o.name ?? ""),
      values,
      colorSlot:
        slotRaw !== null && slotRaw >= 1 && slotRaw <= MAX_SERIES
          ? Math.round(slotRaw)
          : out.length + 1,
    });
  }
  return out;
}

export function parseChartConfig(data: Record<string, Json>): ChartConfig {
  const categories = (Array.isArray(data.categories) ? data.categories : [])
    .slice(0, MAX_CATEGORIES)
    .map((c) => String(c ?? ""));
  const heightRaw = num(data.height);
  // `variant` (toolbar szybkiego przełączania w edytorze bloków) ma
  // pierwszeństwo nad `kind`; edytor utrzymuje oba klucze spójnie.
  const kindSource =
    typeof data.variant === "string" && data.variant !== "" ? data.variant : data.kind;
  return {
    kind: parseChartKind(kindSource),
    title: String(data.title ?? ""),
    description: String(data.description ?? ""),
    categories,
    series: parseChartSeries(data.series, categories.length),
    stacked: data.stacked === true,
    unit: String(data.unit ?? ""),
    height: Math.max(
      CHART_HEIGHT_MIN,
      Math.min(CHART_HEIGHT_MAX, heightRaw ?? CHART_HEIGHT_DEFAULT),
    ),
    showLegend: data.showLegend !== false,
    showGrid: data.showGrid !== false,
    showValues: data.showValues === true,
    animate: data.animate !== false,
    source: String(data.source ?? ""),
  };
}

const ISO2_RE = /^[A-Z]{2}$/;

export function parseMapValues(raw: Json | undefined): MapDatum[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: MapDatum[] = [];
  for (const item of raw) {
    const o = asRecord(item);
    const id = String(o.id ?? "").toUpperCase();
    const value = num(o.value);
    if (!ISO2_RE.test(id) || value === null || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, value });
  }
  return out;
}

export function parseDataMapConfig(data: Record<string, Json>): DataMapConfig {
  const regionRaw = String(data.region ?? "");
  const region: MapRegion = regionRaw === "world" ? "world" : "europe";
  return {
    region,
    title: String(data.title ?? ""),
    description: String(data.description ?? ""),
    unit: String(data.unit ?? ""),
    values: parseMapValues(data.values),
    showLegend: data.showLegend !== false,
    animate: data.animate !== false,
    source: String(data.source ?? ""),
  };
}
