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
// WARTOŚĆ, KTÓREJ CZYTNIK NIE ODCZYTA, NIE JEST LUKĄ. Napis w treści
// („PL; 12%" w polu widgetu, „abc" w `data.values` bloku) siatka trzyma
// jako `raw`: komórka pokazuje go z uwagą, a zapis INNEGO wiersza oddaje go
// bez zmian. Dawniej odczyt dawał `null`, siatka pokazywała „brak danych",
// a pierwszy zapis czegokolwiek utrwalał lukę - napis autora znikał bez
// słowa. Tak samo pola widgetu za wartością („PL; 5; uwaga") - czytnik je
// pomija, ale zapis siatki ich nie obcina (`rest`).
//
// Moduł czysty (bez Reacta) - te same reguły czyta blok CMS, arkusz
// widgetu i podgląd uwag, a testy sprawdzają je bez montowania komponentu.
import type { Json } from "@/lib/blocks/types";
import type { MapDatum } from "@/lib/charts/types";
import { MAP_GRID_MAX_ROWS, type MapGridRow, type MoveDirection } from "@/lib/charts/gridModel";
import {
  buildCountryIndex,
  resolveCountryLabel,
  safeTextCell,
  type CountryIndex,
} from "@/lib/charts/importTable";
import {
  CODE_ALIASES,
  countryAliasKey,
  ISO3_TO_ISO2,
  normaliseCountryName,
} from "@/lib/charts/countryAliases";
import {
  ASSET_ONLY_COUNTRY_NAMES,
  UNOFFICIAL_COUNTRY_NAMES,
  unofficialCountryName,
} from "./mapCountryNames";

export type { MapGridRow } from "@/lib/charts/gridModel";

/**
 * Wiersz edytora mapy: `MapGridRow` plus to, czego model siatki nie zna,
 * a co nie może zginąć przy zapisie (patrz nagłówek pliku). Pola są
 * opcjonalne, więc każdy `MapGridRow` (wklejenie, import) jest poprawnym
 * wierszem edytora - bez napisów do zachowania.
 */
export interface MapEditorRow extends MapGridRow {
  /** Zapisana wartość, której czytnik mapy nie odczyta jako liczby; zawsze przy `value: null`. */
  raw?: string;
  /** Widget: pola za wartością („PL; 5; uwaga" -> „uwaga"), oddawane bez zmian. */
  rest?: string;
}

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
  // Cypr Północny i Somaliland - kody użytkownika, które zasoby rysują.
  ...Object.keys(UNOFFICIAL_COUNTRY_NAMES),
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
 * wiersz pusty, a nie „[object Object]" w polu kodu. Wartość zapisana
 * napisem, którego parser nie odczyta („abc", „12%"), zostaje jako `raw`.
 */
export function readBlockMapRows(raw: Json | undefined): MapEditorRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAP_GRID_MAX_ROWS).map((item) => {
    const o =
      item !== null && typeof item === "object" && !Array.isArray(item)
        ? (item as Record<string, Json>)
        : {};
    const value = storedValue(o.value);
    const row: MapEditorRow = { id: typeof o.id === "string" ? storedId(o.id) : "", value };
    if (value === null && typeof o.value === "string" && o.value.trim() !== "") row.raw = o.value;
    return row;
  });
}

/**
 * Wiersze siatki -> `data.values` bloku (wiersze niedokończone zostają,
 * napis nieodczytany - też, tak jak stał w treści).
 */
export function blockMapValues(rows: readonly MapEditorRow[]): Json[] {
  return rows.map((r) => ({
    id: r.id,
    value: r.value === null && r.raw !== undefined ? r.raw : r.value,
  }));
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

/**
 * Tekst pola danych mapy -> wiersze siatki (także niedokończone; puste linie
 * odpadają). Wartość, której czytnik widgetu nie odczyta, zostaje jako
 * `raw`, a pola za wartością - jako `rest`.
 */
export function readWidgetMapRows(text: string): MapEditorRow[] {
  const out: MapEditorRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const [idRaw = "", valueRaw = "", ...dalej] = line.split(";").map((c) => c.trim());
    const value = csvNumber(valueRaw);
    const row: MapEditorRow = { id: storedId(idRaw), value };
    if (value === null && valueRaw !== "") row.raw = valueRaw;
    const rest = dalej.join("; ");
    if (rest.replace(/[;\s]/g, "") !== "") row.rest = rest;
    out.push(row);
    if (out.length >= MAP_GRID_MAX_ROWS) break;
  }
  return out;
}

/**
 * Wiersze -> tekst pola danych: „PL; 12.5", kropka dziesiętna, wiersz bez
 * wartości jako „PL;" (czytnik widgetu go pomija, arkusz go odtworzy).
 * Średnik i złamanie wiersza w kodzie rozbiłyby format, więc idą przez
 * `safeTextCell`. Napis nieodczytany (`raw`) i pola za wartością (`rest`)
 * wracają bez zmian. Wiersz całkiem pusty nie ma czego zapisać.
 */
export function widgetMapText(rows: readonly MapEditorRow[]): string {
  return rows
    .filter((r) => r.id.trim() !== "" || r.value !== null || r.raw !== undefined)
    .map((r) => {
      const id = safeTextCell(r.id);
      const value = r.value !== null ? String(r.value) : safeTextCell(r.raw ?? "");
      // „PL; 5", „PL;", a z polami za wartością „PL; 5; uwaga" albo „PL;; uwaga".
      const line = value === "" ? `${id};` : `${id}; ${value}`;
      if (r.rest === undefined) return line;
      return `${line}; ${r.rest.replace(/[\n\r]+/g, " ")}`;
    })
    .join("\n");
}

/**
 * Kraje wklejone do pola widgetu DOŁOŻONE do jego wierszy (wklejenie arkusza
 * w niepuste pole, `MapDataField`). Kraj, który pole już ma, dostaje nową
 * wartość w swoim PIERWSZYM wierszu (tym, który czyta mapa; pola za
 * wartością zostają), nowy kraj dochodzi na końcu. Każda inna linia zostaje
 * DOKŁADNIE taka, jaka była - także niedokończona albo z napisem spoza
 * liczb. Dawniej wklejenie zastępowało całe pole: jeden wiersz skopiowany
 * z arkusza kasował wszystkie pozostałe kraje.
 */
export function mergeWidgetMapText(text: string, values: readonly MapDatum[]): string {
  const nowe = new Map(values.map((v) => [v.id, v.value]));
  const linie = text.split(/\r?\n/).map((line) => {
    const [row] = readWidgetMapRows(line);
    const value = row === undefined ? undefined : nowe.get(row.id);
    if (row === undefined || value === undefined) return line;
    nowe.delete(row.id);
    return widgetMapText([{ id: row.id, value, rest: row.rest }]);
  });
  const dopisane = values.filter((v) => nowe.has(v.id));
  if (dopisane.length === 0) return linie.join("\n");
  // Puste linie na końcu pola nie rozdzielają nowych krajów od reszty.
  while (linie.length > 0 && linie[linie.length - 1].trim() === "") linie.pop();
  return [...linie, widgetMapText(dopisane)].join("\n");
}

// ---------------------------------------------------------------------------
// Operacje na wierszach - niezmienne; brak zmiany oddaje TEN SAM obiekt
// ---------------------------------------------------------------------------

export const EMPTY_MAP_ROW: MapGridRow = { id: "", value: null };

export function mapInsertRow<R extends MapGridRow>(rows: readonly R[], at: number): readonly R[] {
  if (rows.length >= MAP_GRID_MAX_ROWS) return rows;
  const i = Math.max(0, Math.min(rows.length, at));
  return [...rows.slice(0, i), { ...EMPTY_MAP_ROW } as R, ...rows.slice(i)];
}

export function mapRemoveRow<R extends MapGridRow>(
  rows: readonly R[],
  index: number,
): readonly R[] {
  if (index < 0 || index >= rows.length) return rows;
  return rows.filter((_, i) => i !== index);
}

export function mapMoveRow<R extends MapGridRow>(
  rows: readonly R[],
  index: number,
  dir: MoveDirection,
): readonly R[] {
  const j = index + dir;
  if (index < 0 || index >= rows.length || j < 0 || j >= rows.length) return rows;
  const next = [...rows];
  [next[index], next[j]] = [next[j], next[index]];
  return next;
}

/**
 * Zapis jednej komórki. Indeks równy długości dopisuje wiersz - tak siatka
 * bez wierszy (świeży blok) przyjmuje pierwszy wpis w wierszu-zachęcie.
 * Zapis WARTOŚCI zdejmuje nieodczytany napis (`raw`) - autor właśnie go
 * poprawił albo wyczyścił, także wtedy, gdy wynik to dalej luka.
 */
export function mapSetCell<R extends MapEditorRow>(
  rows: readonly R[],
  index: number,
  patch: Partial<MapGridRow>,
): readonly R[] {
  if (index < 0 || index > rows.length || index >= MAP_GRID_MAX_ROWS) return rows;
  const prev: MapEditorRow = rows[index] ?? EMPTY_MAP_ROW;
  const next: MapEditorRow = { ...prev, ...patch };
  if ("value" in patch) delete next.raw;
  if (
    index < rows.length &&
    next.id === prev.id &&
    next.value === prev.value &&
    next.raw === prev.raw
  ) {
    return rows;
  }
  const out = [...rows];
  out[index] = next as R;
  return out;
}

/** Siatka bez jednej wpisanej rzeczy - wklejenie całej tabeli otwiera wtedy podgląd. */
export function mapGridIsBlank(rows: readonly MapEditorRow[]): boolean {
  return rows.every((r) => r.id.trim() === "" && r.value === null && r.raw === undefined);
}

/** Podpis stanu - porównanie „czy to wciąż dane, które dało wklejenie" (z napisami do zachowania). */
export function mapRowsSignature(rows: readonly MapEditorRow[]): string {
  return JSON.stringify(rows.map((r) => [r.id, r.value, r.raw ?? null, r.rest ?? null]));
}

// ---------------------------------------------------------------------------
// Kraj wpisany w komórkę kodu
// ---------------------------------------------------------------------------

/**
 * Wpis komórki kodu -> zapis. Kod ISO-2, nazwa PL/EN z zasobu regionu,
 * ISO-3, kod Eurostatu („EL", „UK") i nazwa zastępcza („Holandia") dają kod
 * ISO-2 - tymi samymi regułami co import pliku (`resolveCountryLabel`).
 * Gdy skorowidz regionu kraju nie zna, druga próba idzie bez niego, a trzecia
 * przez nazwy CLDR i nazwy samych zasobów (`worldIndex`):
 * „Japonia" na mapie Europy i „Czech Republic" na mapie Azji albo przed
 * wczytaniem zasobu dają kod i uwagę „poza regionem", zamiast „nieznany
 * kraj". Wpis, którego nic nie rozpoznaje, zostaje jak jest - wiersz pokaże
 * uwagę „nieznany kod albo nazwa".
 */
export function resolveCountryEntry(text: string, index?: CountryIndex): string {
  const t = text.trim();
  if (t === "") return "";
  const hit = resolveCountryLabel(t, index) ?? resolveCountryLabel(t);
  if (hit !== null) return hit.id;
  const zapas = worldIndex().byName;
  return zapas.get(normaliseCountryName(t)) ?? zapas.get(countryAliasKey(t)) ?? storedId(t);
}

// ---------------------------------------------------------------------------
// Uwagi wierszy
// ---------------------------------------------------------------------------

/**
 * Uwaga wiersza - DLACZEGO rysunek go pominie albo pokaże inaczej, niż
 * autor może się spodziewać. Kolejność rozstrzygania jest ta sama, co
 * w parserze bloku (`parseMapValues`): kraj nieznany odpada pierwszy, potem
 * kraj powtórzony (wygrywa PIERWSZY wiersz z wartością). Dalej REGION przed
 * brakiem wartości: kraju spoza regionu nie ma na rysunku, więc nie będzie
 * też kreskowany - z wartością trafi do noty pod mapą (`outside`), bez
 * wartości nie trafi nigdzie (`outsideNoValue`). Na końcu wartość: napis,
 * którego czytnik nie odczyta (`invalidValue`), albo jej brak (`noValue` -
 * kreskowanie jak brak danych).
 */
export type MapRowStatus =
  | { kind: "ok" }
  | { kind: "empty" }
  | { kind: "noCountry" }
  | { kind: "unknown" }
  | { kind: "duplicate"; row: number }
  | { kind: "noValue" }
  | { kind: "invalidValue" }
  | { kind: "outside" }
  | { kind: "outsideNoValue" };

export type MapRowStatusKind = MapRowStatus["kind"];

/**
 * Uwagi dla wszystkich wierszy. `regionIds` to kraje zasobu regionu; `null`,
 * dopóki zasób się nie wczytał - wtedy nie wiadomo, co leży poza regionem,
 * więc ta uwaga milczy (zamiast ostrzegać na zapas o każdym kraju).
 * `row` w uwadze o powtórzeniu liczy wiersze od jednego, jak etykieta.
 */
export function mapRowStatuses(
  rows: readonly MapEditorRow[],
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
    if (regionIds !== null && !regionIds.has(id)) {
      return { kind: r.value === null ? "outsideNoValue" : "outside" };
    }
    if (r.value === null) return { kind: r.raw !== undefined ? "invalidValue" : "noValue" };
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
    index: countries === undefined ? worldIndex() : buildCountryIndex(list),
    ids: countries === undefined ? null : new Set(list.map((c) => c.id.toUpperCase())),
    names: new Map(list.map((c) => [c.id.toUpperCase(), c])),
  };
}

let world: readonly MapCountry[] | null = null;
let worldIdx: CountryIndex | null = null;

/**
 * Wszystkie kody zasobów z nazwami z `Intl` (a Cypr Północny i Somaliland -
 * z `mapCountryNames.ts`) plus nazwy samych zasobów, których CLDR nie zna -
 * skorowidz zastępczy (patrz wyżej). Kraj z nazwą zasobu wchodzi drugi raz
 * tym samym kodem; skorowidz trzyma kody w zbiorze, więc nic się nie dubluje.
 */
function worldCountries(): readonly MapCountry[] {
  if (world === null) {
    world = [
      ...[...KNOWN_CODES].map((id) => ({
        id,
        pl: intlName(id, "pl") || unofficialCountryName(id, "pl"),
        en: intlName(id, "en") || unofficialCountryName(id, "en"),
      })),
      ...ASSET_ONLY_COUNTRY_NAMES.map(([name, id]) => ({ id, pl: name, en: name })),
    ];
  }
  return world;
}

/**
 * Skorowidz zastępczy: nazwy CLDR (PL i EN) wszystkich kodów zasobów plus
 * nazwy zasobów, których CLDR nie zna (`mapCountryNames.ts`). Każda nazwa
 * stoi pod kluczem `normaliseCountryName` ORAZ kluczem aliasu („&" jako
 * „and": CLDR pisze „Bosnia & Herzegovina", zasób „Bosnia and
 * Herzegovina"). Ostatnia próba komórki kodu i skorowidz wklejki do czasu
 * wczytania zasobu regionu. Budowany raz, leniwie.
 */
function worldIndex(): CountryIndex {
  if (worldIdx === null) worldIdx = buildCountryIndex(worldCountries());
  return worldIdx;
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
  if (!KNOWN_CODES.has(id)) return "";
  return intlName(id, lang) || unofficialCountryName(id, lang);
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
