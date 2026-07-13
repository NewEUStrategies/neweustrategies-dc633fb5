// Parsery tekstowych formatów danych widgetów NES Digital Features.
// Konwencja jak w silniku wykresów (src/lib/charts/csv.ts): wiersz = rekord,
// separator ";" (przyjazny polskiemu przecinkowi dziesiętnemu), komórki
// tekstowe mogą nieść tłumaczenie inline "PL|EN". Puste/niepoprawne wiersze
// są pomijane - widget renderuje to, co da się odczytać, zamiast się wywracać.

import type {
  BiText,
  CompareRow,
  Corridor,
  CorridorMarker,
  NetworkEdge,
  NetworkGroupAssignment,
  RiskItem,
  SankeyFlow,
  SourceEntry,
  TimelineEvent,
} from "./types";

/** Górne limity danych - obrona przed wklejeniem gigantycznego zrzutu. */
export const MAX_FEATURE_ROWS = 200;

const splitLines = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .slice(0, MAX_FEATURE_ROWS);

const splitCells = (line: string): string[] => line.split(";").map((c) => c.trim());

/** "12,5" / "12.5" -> 12.5; pusta/niepoprawna komórka -> null. */
export function parseNumberCell(cell: string): number | null {
  if (cell === "") return null;
  const v = Number(cell.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(v) ? v : null;
}

/** Komórka "PL|EN" -> BiText (en spada do pl; nadmiarowe "|" trafiają do en). */
export function parseBiText(cell: string): BiText {
  const sep = cell.indexOf("|");
  if (sep === -1) {
    const t = cell.trim();
    return { pl: t, en: t };
  }
  const pl = cell.slice(0, sep).trim();
  const en = cell.slice(sep + 1).trim();
  return { pl: pl || en, en: en || pl };
}

const clampInt = (v: number | null, min: number, max: number, dflt: number): number => {
  if (v === null) return dflt;
  return Math.max(min, Math.min(max, Math.round(v)));
};

/** Slot koloru 1..8 lub null (kolor domyślny). */
function parseColorSlot(cell: string | undefined): number | null {
  const v = parseNumberCell(cell ?? "");
  if (v === null) return null;
  const n = Math.round(v);
  return n >= 1 && n <= 8 ? n : null;
}

// ---------- Oś czasu ----------
// "Data; Tytuł|Title; Opis|Description; slot(1-8, opcjonalny)"

export function parseTimelineData(text: string): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const line of splitLines(text)) {
    const [date, title, description, slot] = splitCells(line);
    if (!date || !title) continue;
    out.push({
      date,
      title: parseBiText(title),
      description: parseBiText(description ?? ""),
      colorSlot: parseColorSlot(slot),
    });
  }
  return out;
}

// ---------- Sankey ----------
// "Od|From; Do|To; wartość" - wartości <= 0 pomijane (wstęgi bez pola).

export function parseSankeyData(text: string): SankeyFlow[] {
  const out: SankeyFlow[] = [];
  for (const line of splitLines(text)) {
    const [from, to, value] = splitCells(line);
    if (!from || !to) continue;
    const v = parseNumberCell(value ?? "");
    if (v === null || v <= 0) continue;
    const fromBi = parseBiText(from);
    const toBi = parseBiText(to);
    if (fromBi.pl === toBi.pl) continue; // pętla własna nie ma reprezentacji
    out.push({ from: fromBi, to: toBi, value: v });
  }
  return out;
}

// ---------- Porównywarka państw ----------
// Nagłówek: "; PL; DE; FR" (pierwsza komórka pusta), wiersze:
// "Wskaźnik [jedn.]|Indicator [unit]; 12; 14; 9". Jednostka w "[...]"
// jest wyodrębniana z etykiety (per wiersz - wskaźniki różnią się jednostką).

export interface ParsedCompare {
  columns: BiText[];
  rows: CompareRow[];
}

const UNIT_RE = /\s*\[([^\]]*)\]\s*$/;

function extractUnit(label: BiText): { label: BiText; unit: string } {
  const mPl = label.pl.match(UNIT_RE);
  const mEn = label.en.match(UNIT_RE);
  const unit = (mPl?.[1] ?? mEn?.[1] ?? "").trim();
  return {
    label: {
      pl: label.pl.replace(UNIT_RE, "").trim(),
      en: label.en.replace(UNIT_RE, "").trim(),
    },
    unit,
  };
}

export function parseCompareData(text: string): ParsedCompare {
  const lines = splitLines(text);
  if (lines.length === 0) return { columns: [], rows: [] };
  const header = splitCells(lines[0]);
  const columns = header
    .slice(1)
    .filter((c) => c !== "")
    .map(parseBiText);
  if (columns.length === 0) return { columns: [], rows: [] };
  const rows: CompareRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitCells(line);
    if (!cells[0]) continue;
    const { label, unit } = extractUnit(parseBiText(cells[0]));
    rows.push({
      indicator: label,
      unit,
      values: columns.map((_, i) => parseNumberCell(cells[i + 1] ?? "")),
    });
  }
  return { columns, rows };
}

// ---------- Macierz ryzyka ----------
// "Nazwa|Name; prawdopodobieństwo 1-5; wpływ 1-5; opis|desc (opcjonalny)"

export function parseRiskData(text: string): RiskItem[] {
  const out: RiskItem[] = [];
  for (const line of splitLines(text)) {
    const [name, likelihood, impact, description] = splitCells(line);
    if (!name) continue;
    const l = parseNumberCell(likelihood ?? "");
    const i = parseNumberCell(impact ?? "");
    if (l === null || i === null) continue;
    out.push({
      name: parseBiText(name),
      description: parseBiText(description ?? ""),
      likelihood: clampInt(l, 1, 5, 3),
      impact: clampInt(i, 1, 5, 3),
    });
  }
  return out;
}

// ---------- Karta wskaźnika ----------
// Sparkline: liczby rozdzielone ";" lub nowymi liniami.

export function parseSparkData(text: string): number[] {
  return text
    .split(/[;\n]/)
    .map((c) => parseNumberCell(c.trim()))
    .filter((v): v is number => v !== null)
    .slice(0, 60);
}

// ---------- Sieć powiązań ----------
// Krawędzie: "A|A_en; B|B_en; siła 1-5 (opc.); etykieta|label (opc.)"
// Grupy:     "Węzeł|Node; grupa|group"

export function parseNetworkEdges(text: string): NetworkEdge[] {
  const out: NetworkEdge[] = [];
  for (const line of splitLines(text)) {
    const [a, b, strength, label] = splitCells(line);
    if (!a || !b) continue;
    const aBi = parseBiText(a);
    const bBi = parseBiText(b);
    if (aBi.pl === bBi.pl) continue;
    out.push({
      a: aBi,
      b: bBi,
      strength: clampInt(parseNumberCell(strength ?? ""), 1, 5, 2),
      label: parseBiText(label ?? ""),
    });
  }
  return out;
}

export function parseNetworkGroups(text: string): NetworkGroupAssignment[] {
  const out: NetworkGroupAssignment[] = [];
  for (const line of splitLines(text)) {
    const [node, group] = splitCells(line);
    if (!node || !group) continue;
    out.push({ node: parseBiText(node), group: parseBiText(group) });
  }
  return out;
}

// ---------- Mapa korytarzy ----------
// Korytarz: "Nazwa|Name; slot 1-8; lat,lon > lat,lon > lat,lon"
// Marker:   "lat,lon; Etykieta|Label"

function parseLatLon(token: string): { lat: number; lon: number } | null {
  const [latRaw, lonRaw] = token.split(",").map((c) => c.trim());
  // Współrzędne wymagają kropki dziesiętnej (przecinek rozdziela lat od lon).
  const lat = latRaw !== undefined && /^-?\d+(\.\d+)?$/.test(latRaw) ? Number(latRaw) : null;
  const lon = lonRaw !== undefined && /^-?\d+(\.\d+)?$/.test(lonRaw) ? Number(lonRaw) : null;
  if (lat === null || lon === null) return null;
  if (lat < -85 || lat > 85 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

export function parseCorridors(text: string): Corridor[] {
  const out: Corridor[] = [];
  for (const line of splitLines(text)) {
    const [name, slot, pointsCell] = splitCells(line);
    if (!name || !pointsCell) continue;
    const points = pointsCell
      .split(">")
      .map((t) => parseLatLon(t.trim()))
      .filter((p): p is { lat: number; lon: number } => p !== null);
    if (points.length < 2) continue;
    out.push({
      name: parseBiText(name),
      colorSlot: clampInt(parseNumberCell(slot ?? ""), 1, 8, (out.length % 8) + 1),
      points,
    });
  }
  return out;
}

export function parseCorridorMarkers(text: string): CorridorMarker[] {
  const out: CorridorMarker[] = [];
  for (const line of splitLines(text)) {
    const [coords, label] = splitCells(line);
    if (!coords || !label) continue;
    const p = parseLatLon(coords);
    if (!p) continue;
    out.push({ ...p, label: parseBiText(label) });
  }
  return out;
}

/** "PL; DE; AT" -> ["PL","DE","AT"] (tylko poprawne kody ISO-2, bez duplikatów). */
export function parseCountryCodes(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const cell of text.split(/[;,\n]/)) {
    const id = cell.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

// ---------- Biblioteka źródeł ----------
// "Typ|Type; Rok; Tytuł|Title; Wydawca|Publisher; URL"

export function parseSourceEntries(text: string): SourceEntry[] {
  const out: SourceEntry[] = [];
  for (const line of splitLines(text)) {
    const [kind, year, title, publisher, url] = splitCells(line);
    if (!title) continue;
    out.push({
      kind: parseBiText(kind ?? ""),
      year: (year ?? "").trim(),
      title: parseBiText(title),
      publisher: parseBiText(publisher ?? ""),
      url: (url ?? "").trim(),
    });
  }
  return out;
}
