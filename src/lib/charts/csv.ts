// Tekstowy format danych dla widgetów buildera (Elementor-style textarea).
// Separator ";" - przyjazny polskiemu przecinkowi dziesiętnemu.
//
//   ; Eksport; Import          <- wiersz nagłówka: nazwy serii
//   2021; 120; 80              <- kategoria; wartości kolejnych serii
//   2022; 150,5; 95
//
// Mapa danych: jeden wiersz na kraj - "PL; 12,5".

import { MAX_SERIES, type ChartSeries, type MapDatum } from "./types";
import { MAX_CATEGORIES } from "./parse";

export interface ParsedChartData {
  categories: string[];
  series: ChartSeries[];
}

function splitLine(line: string): string[] {
  return line.split(";").map((c) => c.trim());
}

function parseNumber(cell: string): number | null {
  if (cell === "") return null;
  const v = Number(cell.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(v) ? v : null;
}

/** Parsuje textarea widgetu wykresu. Puste/niepoprawne komórki -> luka (null). */
export function parseChartData(text: string): ParsedChartData {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
  if (lines.length === 0) return { categories: [], series: [] };

  const header = splitLine(lines[0]);
  const seriesNames = header.slice(1, MAX_SERIES + 1);
  const rows = lines.slice(1, MAX_CATEGORIES + 1).map(splitLine);

  const categories = rows.map((r) => r[0] ?? "");
  const series: ChartSeries[] = seriesNames.map((name, si) => ({
    name,
    values: rows.map((r) => parseNumber(r[si + 1] ?? "")),
    colorSlot: si + 1,
  }));
  return { categories, series };
}

/** Parsuje textarea mapy danych: "PL; 12,5" per wiersz. */
export function parseMapData(text: string): MapDatum[] {
  const out: MapDatum[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const [idRaw, valueRaw] = splitLine(line);
    const id = (idRaw ?? "").toUpperCase();
    const value = parseNumber(valueRaw ?? "");
    if (!/^[A-Z]{2}$/.test(id) || value === null || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, value });
  }
  return out;
}
