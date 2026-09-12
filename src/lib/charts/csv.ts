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
import { slotForSeries } from "@/lib/charts/palette";

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
    colorSlot: slotForSeries(si),
  }));
  return { categories, series };
}

/**
 * Parsuje textarea mapy danych: `"PL; 12,5"` albo `"PL; 12,5; #3366cc"`.
 *
 * TRZECIA KOLUMNA JEST OPCJONALNA i czyta ją wyłącznie tryb ręczny - wiersz
 * bez niej znaczy „kraj bez przypisanej barwy", a nie „biały". Zapis spoza
 * `#rrggbb` odpada po cichu razem z barwą, ale WIERSZ ZOSTAJE: autor, który
 * wpisze `PL; 12,5; niebieski`, ma stracić kolor, a nie dane - inaczej jedna
 * literówka w trzeciej kolumnie kasuje kraj z mapy i nikt nie wie dlaczego.
 */
export function parseMapData(text: string): MapDatum[] {
  const out: MapDatum[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const [idRaw, valueRaw, colorRaw] = splitLine(line);
    const id = (idRaw ?? "").toUpperCase();
    const value = parseNumber(valueRaw ?? "");
    const colorRawTrim = (colorRaw ?? "").trim().toLowerCase();
    const color = /^#[0-9a-f]{6}$/.test(colorRawTrim) ? colorRawTrim : undefined;
    if (!/^[A-Z]{2}$/.test(id) || seen.has(id)) continue;
    // Sama barwa wystarczy: "PL; ; #3366cc" to poprawna pozycja mapy
    // politycznej. Wiersz bez liczby I bez barwy nie niesie niczego.
    if (value === null && color === undefined) continue;
    seen.add(id);
    out.push(color === undefined ? { id, value } : { id, value, color });
  }
  return out;
}
