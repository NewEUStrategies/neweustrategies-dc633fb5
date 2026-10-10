// KOLORY, KTÓRE PRÓBNIK SERII OFERUJE AUTOROWI - lista WYLICZONA, nie wpisana.
//
// Paleta ma 27 slotów, ale część z nich to kolory marki zadane z zewnątrz,
// które na płycie wykresu albo znikają (#FFDAB3 ma 1,32:1 na bieli), albo
// leżą w rodzinie pomarańczu i żółci zarezerwowanej dla akcentu - a tej
// rodziny decyzja właściciela nie dopuszcza w żadnym kolorze danych. Do PR2
// edytor oferował wszystkie 27 w niewidocznej liście natywnej, więc autor
// mógł pomalować serię kolorem nieczytelnym albo udającym akcent.
//
// REGUŁA (kontrakt PR2, „Colour picker behaviour" (c)): próbnik oferuje slot
// tylko wtedy, gdy
//   1. kolor serii ma co najmniej 3:1 na płycie (`--card`) W OBU motywach -
//      próg grafiki WCAG 1.4.11, ten sam co w bramkach palety;
//   2. jego odcień w OKLCh leży POZA pasmem 30-110° w OBU motywach - tam
//      mieszkają pomarańcz marki, bursztyn, ochra i żółć. Kolor prawie
//      neutralny (chroma poniżej `PICKER_CHROMA_FLOOR`) odcienia nie ma, więc
//      pasmo go nie dotyczy - tak samo liczą bramki ramp mapy.
// Liczymy to z wartości w `palette.ts` (kopie bramkowe arkusza), więc zmiana
// odcienia slotu sama przesuwa go do albo z próbnika, a bramka
// `__tests__/chartColorSlots.test.ts` przypina wynik.
//
// Moduł jest ADMINOWY - czytelnik strony nie wybiera kolorów.
import {
  CATEGORICAL_SAFE_MAX,
  CHART_PLATE,
  CONTRAST_MIN,
  SLOT_SEQUENCE,
  contrastRatio,
  oklchOf,
  slotAt,
  type PaletteSlot,
} from "@/lib/charts/palette";
import {
  FOCUS_SERIES_MAX,
  seriesPaint,
  seriesRank,
  type ChartPalette,
} from "@/lib/charts/seriesStyle";
import { KIND_CAPS } from "@/lib/charts/kindCaps";
import { defaultChartConfig } from "@/lib/charts/parse";
import { scatterModelFromConfig } from "@/lib/charts/kinds/scatter";
import { smallMultiplesModelFromConfig } from "@/lib/charts/kinds/smallMultiples";
import type { ChartConfig, ChartKind, ChartSeries } from "@/lib/charts/types";
import { cloudPaints, kindSinglePaint } from "@/components/charts/kindPaint";
import type { ChartEditorT } from "./chartEditorI18n";

/** Pasmo odcieni pomarańczu, bursztynu i żółci - poza próbnikiem. */
export const PICKER_HUE_EXCLUDED = { from: 30, to: 110 } as const;

/** Poniżej tej chromy kolor jest praktycznie neutralny i nie ma odcienia do sprawdzania. */
export const PICKER_CHROMA_FLOOR = 0.03;

function wPasmie(hex: string): boolean {
  const { c, h } = oklchOf(hex);
  return c >= PICKER_CHROMA_FLOOR && h >= PICKER_HUE_EXCLUDED.from && h <= PICKER_HUE_EXCLUDED.to;
}

/** Czy slot przechodzi regułę próbnika (kontrast w obu motywach, odcień poza pasmem). */
export function isPickerSlot(slot: PaletteSlot): boolean {
  return (
    contrastRatio(slot.light, CHART_PLATE.light) >= CONTRAST_MIN.graphic &&
    contrastRatio(slot.dark, CHART_PLATE.dark) >= CONTRAST_MIN.graphic &&
    !wPasmie(slot.light) &&
    !wPasmie(slot.dark)
  );
}

/**
 * Sloty próbnika w KOLEJNOŚCI PRZYPISANIA (`SLOT_SEQUENCE`), nie numerów:
 * na początku stoją kolory, które silnik sam daje kolejnym seriom, więc
 * autor wybiera najpierw z tych najlepiej rozdzielnych.
 */
export const PICKER_SLOTS: readonly number[] = SLOT_SEQUENCE.filter((n) => isPickerSlot(slotAt(n)));

/** Grupa „rozdzielne dla daltonizmu": pozycje sekwencji w zestawie bezpiecznym. */
export const PICKER_RECOMMENDED: readonly number[] = PICKER_SLOTS.filter(
  (n) => SLOT_SEQUENCE.indexOf(n) < CATEGORICAL_SAFE_MAX,
);

/** Pozostałe sloty próbnika - widoczne, ale bez gwarancji rozdzielności. */
export const PICKER_OTHER: readonly number[] = PICKER_SLOTS.filter(
  (n) => !PICKER_RECOMMENDED.includes(n),
);

/**
 * Nazwy odcieni próbnika - klucz to nazwa slotu z `palette.ts`. Mapa JAWNA:
 * bramka sprawdza, że każdy slot z `PICKER_SLOTS` ma tu wpis i że wpis ma
 * treść w obu językach.
 */
export const SLOT_NAME_KEYS: Readonly<Record<string, string>> = {
  granat: "chartEditor.colors.slots.granat",
  szalwia: "chartEditor.colors.slots.szalwia",
  sliwka: "chartEditor.colors.slots.sliwka",
  indygo: "chartEditor.colors.slots.indygo",
  oliwka: "chartEditor.colors.slots.oliwka",
  morski: "chartEditor.colors.slots.morski",
  grafit: "chartEditor.colors.slots.grafit",
  czerwien: "chartEditor.colors.slots.czerwien",
  atrament: "chartEditor.colors.slots.atrament",
  ametyst: "chartEditor.colors.slots.ametyst",
  bordo: "chartEditor.colors.slots.bordo",
  mech: "chartEditor.colors.slots.mech",
  fuksja: "chartEditor.colors.slots.fuksja",
  malina: "chartEditor.colors.slots.malina",
};

/** Klucz nazwy slotu albo `null`, gdy slot jest spoza próbnika (zapis sprzed PR2). */
export function slotNameKey(slot: number): string | null {
  if (!PICKER_SLOTS.includes(slot)) return null;
  return SLOT_NAME_KEYS[slotAt(slot).key] ?? null;
}

/** Nazwa slotu dla czytnika ekranu i podpowiedzi. */
export function slotLabel(slot: number, t: ChartEditorT): string {
  const key = slotNameKey(slot);
  return key === null ? t("chartEditor.colors.legacySlot", { n: slot }) : t(key);
}

/**
 * Etykiety RANG palety ról (`seriesRank`): 0 to seria wyróżniona, kolejne -
 * tło porównania. Długość tablicy to `FOCUS_SERIES_MAX`: od tej rangi seria
 * bierze własny slot i próbnik znów działa.
 */
export const FOCUS_ROLE_KEYS: readonly string[] = [
  "chartEditor.colors.roles.accent",
  "chartEditor.colors.roles.context1",
  "chartEditor.colors.roles.context2",
  "chartEditor.colors.roles.context3",
  "chartEditor.colors.roles.context4",
].slice(0, FOCUS_SERIES_MAX);

// ---------------------------------------------------------------------------
// Próbka koloru serii - kolor NARYSOWANY, nie zapisany
// ---------------------------------------------------------------------------

/**
 * Paleta, którą rysunek naprawdę stosuje: rodzaj, w którym wybór palety nic
 * nie zmienia (`KIND_CAPS.palette` = false), maluje sloty serii - tak jak
 * paleta kategorialna. Próbka i próbnik muszą mówić to samo co rysunek.
 */
export function effectivePalette(kind: ChartKind, palette: ChartPalette): ChartPalette {
  return KIND_CAPS[kind].palette ? palette : "categorical";
}

/** Czy kolor na rysunku należy do serii (albo panelu) - tylko wtedy arkusz pokazuje próbki. */
export function colorsBySeries(kind: ChartKind): boolean {
  const target = KIND_CAPS[kind].colorTarget;
  return target === "series" || target === "panels";
}

/** Czy kolor ma kategoria (wycinki tarczy) - wtedy wyróżnia się wycinek, nie serię. */
export function colorsByCategory(kind: ChartKind): boolean {
  return KIND_CAPS[kind].colorTarget === "category";
}

export interface SeriesSwatch {
  /** Kolor narysowany (wyrażenie CSS z tokenami) - ten sam, który zwraca `seriesPaint`. */
  color: string;
  /** Ranga palety ról, gdy kolor nadaje rola; `null`, gdy seria maluje własny slot. */
  role: number | null;
}

/**
 * Próbki serii w kolejności arkusza. Kolor liczy `seriesPaint` z RANGĄ
 * (`seriesRank`), czyli dokładnie tak, jak rysownik - próbka przy serii
 * wyróżnionej jest więc akcentem, nawet gdy w treści seria ma inny slot.
 * To droga rodzajów, które malują serię po jej pozycji (`CartesianChart`,
 * `kindSeriesPaint`); rodzaje z własną drogą liczy `drawnSeriesSwatches`.
 */
export function seriesSwatches(
  series: readonly { colorSlot: number }[],
  accentSeries: number,
  palette: ChartPalette,
): SeriesSwatch[] {
  return series.map((s, i) => {
    const rank = seriesRank(i, accentSeries);
    const paint = seriesPaint(s.colorSlot, rank, palette);
    return {
      color: paint.color,
      role: palette === "focus" && rank < FOCUS_SERIES_MAX ? rank : null,
    };
  });
}

/** Próbka serii NA RYSUNKU danego rodzaju. */
export interface DrawnSwatch extends SeriesSwatch {
  /** Czy slot wybrany przy serii zmienia rysunek - tylko wtedy przy próbce stoi próbnik. */
  pickable: boolean;
}

/** Kolory ról palety `focus` w kolejności rang - z tej samej funkcji, która maluje serie. */
const KOLORY_ROL: readonly string[] = FOCUS_ROLE_KEYS.map(
  (_, rank) => seriesPaint(1, rank, "focus").color,
);

/** Ranga roli, którą kolor jest (pod paletą ról), albo `null` - kolor slotu. */
function rolaKoloru(color: string, palette: ChartPalette): number | null {
  if (palette !== "focus") return null;
  const rank = KOLORY_ROL.indexOf(color);
  return rank === -1 ? null : rank;
}

/**
 * Czy rodzaj rysuje SERIĘ WYRÓŻNIONĄ (`accentSeries`) - tylko wtedy edytor
 * pokazuje jej wybór. Kolor musi należeć do serii, a rodzaj stosować paletę;
 * małe panele (`colorTarget: "panels"`) malują każdy panel jedną farbą
 * (`kindSinglePaint`) i serii wyróżnionej nie czytają wcale.
 */
export function seriesAccentDrawn(kind: ChartKind): boolean {
  return KIND_CAPS[kind].colorTarget === "series" && KIND_CAPS[kind].palette;
}

/**
 * Próbki serii DOKŁADNIE TAKIE, JAK RYSUJE JE RODZAJ - z tej samej funkcji
 * farby, której używa rysownik (kontrakt PR2, „Colour picker behaviour" (a)):
 *   * wykres punktowy: `cloudPaints` nad chmurami modelu - kolumna osi X
 *     (tryb `series`) chmurą nie jest, więc nie ma próbki (`null`), a akcent
 *     i role idą po chmurach, nie po kolumnach arkusza;
 *   * małe panele: `kindSinglePaint` ze slotem panelu z modelu - jedna farba
 *     na panel, bez ról i bez próbnika (slot serii panelu nie zmienia);
 *   * pozostałe rodzaje z kolorem serii: `seriesPaint` z rangą
 *     (`seriesSwatches`), tak jak `CartesianChart` i `kindSeriesPaint`.
 * `null` w miejscu wyniku: rodzaj nie koloruje serii (`colorsBySeries`).
 * Do przeglądu końcowego PR2 edytor liczył wszystko trzecią drogą, więc przy
 * panelach i chmurach próbki, etykiety ról i wybór serii wyróżnionej mówiły
 * co innego niż rysunek.
 */
export function drawnSeriesSwatches(
  kind: ChartKind,
  data: { categories: readonly string[]; series: readonly ChartSeries[] },
  accentSeries: number,
  palette: ChartPalette,
): (DrawnSwatch | null)[] | null {
  if (!colorsBySeries(kind)) return null;
  const eff = effectivePalette(kind, palette);
  const config: ChartConfig = {
    ...defaultChartConfig(),
    kind,
    categories: [...data.categories],
    series: data.series.map((s) => ({ ...s, values: [...s.values] })),
    palette: eff,
    accentSeries,
  };
  if (KIND_CAPS[kind].colorTarget === "panels") {
    const slotPanelu = new Map(
      smallMultiplesModelFromConfig(config).panels.map((p) => [p.index, p.colorSlot]),
    );
    return data.series.map((_, i) => {
      const slot = slotPanelu.get(i);
      if (slot === undefined) return null;
      return { color: kindSinglePaint({ palette: eff }, slot).color, role: null, pickable: false };
    });
  }
  if (kind === "scatter") {
    const clouds = scatterModelFromConfig(config).clouds;
    const paints = cloudPaints(config, clouds);
    const out: (DrawnSwatch | null)[] = data.series.map(() => null);
    clouds.forEach((c, ci) => {
      const color = paints[ci].color;
      const role = rolaKoloru(color, eff);
      out[c.seriesIndex] = { color, role, pickable: role === null };
    });
    return out;
  }
  return seriesSwatches(data.series, accentSeries, eff).map((s) => ({
    ...s,
    pickable: s.role === null,
  }));
}
