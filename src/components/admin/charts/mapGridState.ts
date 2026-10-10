// STAN SIATKI DANYCH MAPY - wiersze, ich zapis w bloku i w widgecie, uwagi.
//
// Siatka mapy to lista wierszy „kraj - wartość" (`MapGridRow` z
// `gridModel.ts`). Wiersz bywa NIEDOKOŃCZONY - kraj bez wartości albo
// wartość bez kraju - bo tak wygląda edycja w toku, i siatka musi go
// pokazać po przeładowaniu, a nie zgubić. Rysunek czyta tylko wiersze
// kompletne (`parseMapValues` w bloku, `parseMapData` w widgecie) - tu stoją
// adaptery, które zapisują WSZYSTKIE wiersze, a uwagi mówią autorowi, który
// wiersz rysunek pominie i dlaczego.
//
// PUSTA WARTOŚĆ TO BRAK DANYCH, nie zero: kraj bez liczby nie trafia do
// danych, więc mapa kreskuje go jak każdy inny kraj bez wartości.
//
// Moduł czysty (bez Reacta) - te same reguły czyta blok CMS, arkusz
// widgetu i podgląd uwag, a testy sprawdzają je bez montowania komponentu.
import type { Json } from "@/lib/blocks/types";
import { MAP_GRID_MAX_ROWS, type MapGridRow, type MoveDirection } from "@/lib/charts/gridModel";
import {
  buildCountryIndex,
  resolveCountryLabel,
  safeTextCell,
  type CountryIndex,
} from "@/lib/charts/importTable";
import { CODE_ALIASES, ISO3_TO_ISO2, normaliseCountryName } from "@/lib/charts/countryAliases";

export type { MapGridRow } from "@/lib/charts/gridModel";

const ISO2 = /^[A-Z]{2}$/;

/** Kraj zasobu geometrii z nazwami - wejście skorowidza i nazw w siatce. */
export interface MapCountry {
  id: string;
  pl: string;
  en: string;
}

/**
 * Kody ISO-2 krajów, które zna KTÓRYKOLWIEK zasób geometrii (świat i pięć
 * kontynentów): cele tabeli ISO-3 i aliasów kodów. Rozróżnia „kraj spoza
 * wybranego regionu" (kod istnieje, rysunek go nie ma) od „nieznanego kodu"
 * (literówka) bez wczytywania zasobu świata.
 */
const KNOWN_CODES: ReadonlySet<string> = new Set([
  ...Object.values(ISO3_TO_ISO2),
  ...Object.values(CODE_ALIASES),
]);

/** Kod zapisany w treści: dwie litery wielkimi, reszta tak, jak ją wpisano. */
function storedId(raw: string): string {
  const t = raw.trim();
  return /^[a-z]{2}$/i.test(t) ? t.toUpperCase() : t;
}

/** Ta sama koercja liczby co `num` w `parse.ts` - siatka pokazuje to, co narysuje mapa. */
function storedValue(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && raw.trim() !== "") {
    const v = Number(raw.replace(",", "."));
    return Number.isFinite(v) ? v : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Blok CMS: `data.values` = [{ id, value }]
// ---------------------------------------------------------------------------

/**
 * Wiersze bloku TAKIE, JAKIE SĄ w treści - także niedokończone. Pozycja,
 * która nie jest obiektem, albo identyfikator innego typu niż napis daje
 * wiersz pusty, a nie „[object Object]" w polu kodu.
 */
export function readBlockMapRows(raw: Json | undefined): MapGridRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAP_GRID_MAX_ROWS).map((item) => {
    const o =
      item !== null && typeof item === "object" && !Array.isArray(item)
        ? (item as Record<string, Json>)
        : {};
    return {
      id: typeof o.id === "string" ? storedId(o.id) : "",
      value: storedValue(o.value),
    };
  });
}

/** Wiersze siatki -> `data.values` bloku (wiersze niedokończone zostają). */
export function blockMapValues(rows: readonly MapGridRow[]): Json[] {
  return rows.map((r) => ({ id: r.id, value: r.value }));
}

// ---------------------------------------------------------------------------
// Widget buildera: pole `data` = „ID; wartość" na wiersz (`csv.ts`)
// ---------------------------------------------------------------------------

/**
 * Liczba z pola tekstowego widgetu - KOPIA reguły `parseNumber` z `csv.ts`
 * (tam prywatnej): bez białych znaków, przecinek jako kropka. Musi czytać
 * dokładnie to, co czyta widok widgetu, inaczej arkusz pokazałby liczbę,
 * której mapa nie narysuje; bramka `mapGridState.test.ts` porównuje oba
 * odczyty na tych samych wierszach.
 */
function csvNumber(cell: string): number | null {
  if (cell === "") return null;
  const v = Number(cell.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(v) ? v : null;
}

/** Tekst pola danych mapy -> wiersze siatki (także niedokończone; puste linie odpadają). */
export function readWidgetMapRows(text: string): MapGridRow[] {
  const out: MapGridRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const [idRaw, valueRaw] = line.split(";").map((c) => c.trim());
    out.push({ id: storedId(idRaw ?? ""), value: csvNumber(valueRaw ?? "") });
    if (out.length >= MAP_GRID_MAX_ROWS) break;
  }
  return out;
}

/**
 * Wiersze -> tekst pola danych: „PL; 12.5", kropka dziesiętna, wiersz bez
 * wartości jako „PL;" (czytnik widgetu go pomija, arkusz go odtworzy).
 * Średnik i złamanie wiersza w kodzie rozbiłyby format, więc idą przez
 * `safeTextCell`. Wiersz całkiem pusty nie ma czego zapisać.
 */
export function widgetMapText(rows: readonly MapGridRow[]): string {
  return rows
    .filter((r) => r.id.trim() !== "" || r.value !== null)
    .map((r) => {
      const id = safeTextCell(r.id);
      return r.value === null ? `${id};` : `${id}; ${r.value}`;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Operacje na wierszach - niezmienne; brak zmiany oddaje TEN SAM obiekt
// ---------------------------------------------------------------------------

export const EMPTY_MAP_ROW: MapGridRow = { id: "", value: null };

export function mapInsertRow(rows: readonly MapGridRow[], at: number): readonly MapGridRow[] {
  if (rows.length >= MAP_GRID_MAX_ROWS) return rows;
  const i = Math.max(0, Math.min(rows.length, at));
  return [...rows.slice(0, i), { ...EMPTY_MAP_ROW }, ...rows.slice(i)];
}

export function mapRemoveRow(rows: readonly MapGridRow[], index: number): readonly MapGridRow[] {
  if (index < 0 || index >= rows.length) return rows;
  return rows.filter((_, i) => i !== index);
}

export function mapMoveRow(
  rows: readonly MapGridRow[],
  index: number,
  dir: MoveDirection,
): readonly MapGridRow[] {
  const j = index + dir;
  if (index < 0 || index >= rows.length || j < 0 || j >= rows.length) return rows;
  const next = [...rows];
  [next[index], next[j]] = [next[j], next[index]];
  return next;
}

/**
 * Zapis jednej komórki. Indeks równy długości dopisuje wiersz - tak siatka
 * bez wierszy (świeży blok) przyjmuje pierwszy wpis w wierszu-zachęcie.
 */
export function mapSetCell(
  rows: readonly MapGridRow[],
  index: number,
  patch: Partial<MapGridRow>,
): readonly MapGridRow[] {
  if (index < 0 || index > rows.length || index >= MAP_GRID_MAX_ROWS) return rows;
  const prev = rows[index] ?? EMPTY_MAP_ROW;
  const next = { ...prev, ...patch };
  if (index < rows.length && next.id === prev.id && next.value === prev.value) {
    return rows;
  }
  const out = [...rows];
  out[index] = next;
  return out;
}

/** Siatka bez jednej wpisanej rzeczy - wklejenie całej tabeli otwiera wtedy podgląd. */
export function mapGridIsBlank(rows: readonly MapGridRow[]): boolean {
  return rows.every((r) => r.id.trim() === "" && r.value === null);
}

/** Podpis stanu - porównanie „czy to wciąż dane, które dało wklejenie". */
export function mapRowsSignature(rows: readonly MapGridRow[]): string {
  return JSON.stringify(rows.map((r) => [r.id, r.value]));
}

// ---------------------------------------------------------------------------
// Kraj wpisany w komórkę kodu
// ---------------------------------------------------------------------------

/**
 * Wpis komórki kodu -> zapis. Kod ISO-2, nazwa PL/EN z zasobu regionu,
 * ISO-3, kod Eurostatu („EL", „UK") i nazwa zastępcza („Czech Republic",
 * „Holandia") dają kod ISO-2 - tymi samymi regułami co import pliku
 * (`resolveCountryLabel`). Gdy skorowidz regionu kraju nie zna, druga próba
 * idzie bez niego: „Japonia" na mapie Europy daje JP i uwagę „poza
 * regionem", zamiast „nieznany kraj". Wpis, którego nic nie rozpoznaje,
 * zostaje jak jest - wiersz pokaże uwagę „nieznany kod albo nazwa".
 */
export function resolveCountryEntry(text: string, index?: CountryIndex): string {
  const t = text.trim();
  if (t === "") return "";
  const hit = resolveCountryLabel(t, index) ?? resolveCountryLabel(t);
  if (hit !== null) return hit.id;
  return intlCountryIndex().get(normaliseCountryName(t)) ?? storedId(t);
}

let intlIndex: ReadonlyMap<string, string> | null = null;

/**
 * Ostatnia próba: nazwy krajów z `Intl` (CLDR) po polsku i po angielsku.
 * Działa, zanim zasób regionu się wczyta (autor wpisuje „Czechy" w świeżym
 * bloku), i dla krajów spoza regionu, których nazwy tabela aliasów nie zna
 * („Japonia" na mapie Europy). Budowana raz, leniwie.
 */
function intlCountryIndex(): ReadonlyMap<string, string> {
  if (intlIndex !== null) return intlIndex;
  const m = new Map<string, string>();
  for (const lang of ["pl", "en"] as const) {
    for (const code of KNOWN_CODES) {
      const key = normaliseCountryName(intlName(code, lang));
      if (key !== "" && !m.has(key)) m.set(key, code);
    }
  }
  intlIndex = m;
  return m;
}

// ---------------------------------------------------------------------------
// Uwagi wierszy
// ---------------------------------------------------------------------------

/**
 * Uwaga wiersza - DLACZEGO rysunek go pominie albo pokaże inaczej, niż
 * autor może się spodziewać. Kolejność rozstrzygania jest ta sama, co
 * w parserze bloku (`parseMapValues`): kraj nieznany odpada pierwszy, potem
 * kraj powtórzony (wygrywa PIERWSZY wiersz z wartością), potem brak wartości,
 * na końcu region.
 */
export type MapRowStatus =
  | { kind: "ok" }
  | { kind: "empty" }
  | { kind: "noCountry" }
  | { kind: "unknown" }
  | { kind: "duplicate"; row: number }
  | { kind: "noValue" }
  | { kind: "outside" };

export type MapRowStatusKind = MapRowStatus["kind"];

/**
 * Uwagi dla wszystkich wierszy. `regionIds` to kraje zasobu regionu; `null`,
 * dopóki zasób się nie wczytał - wtedy nie wiadomo, co leży poza regionem,
 * więc ta uwaga milczy (zamiast ostrzegać na zapas o każdym kraju).
 * `row` w uwadze o powtórzeniu liczy wiersze od jednego, jak etykieta.
 */
export function mapRowStatuses(
  rows: readonly MapGridRow[],
  regionIds: ReadonlySet<string> | null,
): MapRowStatus[] {
  // Wiersz, który parser bierze dla kraju: pierwszy z kodem i wartością.
  const claimant = new Map<string, number>();
  rows.forEach((r, i) => {
    if (ISO2.test(r.id) && r.value !== null && !claimant.has(r.id)) claimant.set(r.id, i);
  });
  return rows.map((r, i): MapRowStatus => {
    const id = r.id.trim();
    if (id === "") return { kind: r.value === null ? "empty" : "noCountry" };
    if (!ISO2.test(id)) return { kind: "unknown" };
    const known = regionIds?.has(id) === true || KNOWN_CODES.has(id);
    if (!known) return { kind: "unknown" };
    const owner = claimant.get(id);
    if (owner !== undefined && owner !== i) return { kind: "duplicate", row: owner + 1 };
    if (r.value === null) return { kind: "noValue" };
    if (regionIds !== null && !regionIds.has(id)) return { kind: "outside" };
    return { kind: "ok" };
  });
}

// ---------------------------------------------------------------------------
// Nazwy krajów i dane narysowane
// ---------------------------------------------------------------------------

const displayNames = new Map<string, Intl.DisplayNames | null>();

/** Nazwa regionu z `Intl` - zapas dla krajów spoza zasobu i przed jego wczytaniem. */
function intlName(id: string, lang: "pl" | "en"): string {
  if (!displayNames.has(lang)) {
    try {
      displayNames.set(lang, new Intl.DisplayNames([lang], { type: "region", fallback: "none" }));
    } catch {
      displayNames.set(lang, null);
    }
  }
  const dn = displayNames.get(lang);
  if (dn === null || dn === undefined) return "";
  try {
    return dn.of(id) ?? "";
  } catch {
    return "";
  }
}

/** Skorowidz i nazwy krajów regionu (zasób geometrii) - jedna paczka dla siatki. */
export interface MapCountryLookup {
  index: CountryIndex;
  /** Kraje zasobu; `null`, dopóki zasób się nie wczytał. */
  ids: ReadonlySet<string> | null;
  names: ReadonlyMap<string, MapCountry>;
}

/**
 * Paczka skorowidza dla siatki, wklejki i importu. Dopóki zasób regionu się
 * nie wczytał (albo gdy jego pobranie padło), skorowidz jest ŚWIATOWY:
 * kody wszystkich zasobów i ich nazwy z `Intl` (CLDR, PL i EN). Bez tego
 * tabela z nazwami („Polska", „Czechy") wklejona w świeżo wstawiony blok
 * dawała same „nierozpoznane kraje", choć po ułamku sekundy zasób by je znał.
 * Region nie jest wtedy znany (`ids: null`), więc kraj spoza niego wchodzi
 * do danych - i dostaje uwagę „poza regionem", gdy zasób dojedzie.
 */
export function mapCountryLookup(countries: readonly MapCountry[] | undefined): MapCountryLookup {
  const list = countries ?? [];
  return {
    index: buildCountryIndex(countries === undefined ? worldCountries() : list),
    ids: countries === undefined ? null : new Set(list.map((c) => c.id.toUpperCase())),
    names: new Map(list.map((c) => [c.id.toUpperCase(), c])),
  };
}

let world: readonly MapCountry[] | null = null;

/** Wszystkie kody zasobów z nazwami z `Intl` - skorowidz zastępczy (patrz wyżej). */
function worldCountries(): readonly MapCountry[] {
  if (world === null) {
    world = [...KNOWN_CODES].map((id) => ({
      id,
      pl: intlName(id, "pl"),
      en: intlName(id, "en"),
    }));
  }
  return world;
}

/**
 * Nazwa kraju w JĘZYKU DOKUMENTU: z zasobu regionu (te same nazwy, które
 * czytelnik zobaczy w tooltipie mapy), a dla kraju spoza zasobu - z `Intl`.
 * Pusty napis, gdy kod niczego nie wskazuje.
 */
export function countryNameOf(
  id: string,
  lang: "pl" | "en",
  names: ReadonlyMap<string, MapCountry>,
): string {
  if (!ISO2.test(id)) return "";
  const c = names.get(id);
  if (c !== undefined) return (lang === "en" ? c.en || c.pl : c.pl || c.en) || id;
  return KNOWN_CODES.has(id) ? intlName(id, lang) : "";
}

/**
 * Wartości, które mapa NARYSUJE - domena legendy w wyborze skali. Ta sama
 * reguła co rysunek: wiersz kompletny, pierwszy kraj wygrywa, a gdy zasób
 * jest wczytany - tylko kraje regionu (`ChoroplethMap` liczy domenę z krajów
 * narysowanych).
 */
export function drawnMapValues(
  values: readonly { id: string; value: number }[],
  regionIds: ReadonlySet<string> | null,
): number[] {
  return values.filter((v) => regionIds === null || regionIds.has(v.id)).map((v) => v.value);
}
