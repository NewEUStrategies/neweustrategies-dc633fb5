// WSKAZANIE NA WYKRESIE - jeden kształt dla wszystkich rodzajów.
//
// PO CO. Panele analityczne otwierają po kliknięciu okno szczegółów („który
// dzień", „która strona", „która seria"). Dopóki rysowały je ECharts, robił to
// jego własny `params` - obiekt o innym kształcie dla każdego typu serii,
// z polami, których TypeScript nie widzi. Przy przejściu na własny silnik
// kształt musi być JEDEN i typowany, inaczej każdy dashboard wymyśliłby swój.
//
// CZEGO TU ŚWIADOMIE NIE MA: pikseli, zdarzenia myszy ani węzła DOM. Wskazanie
// jest faktem o DANYCH, nie o rysunku - wywołujący ma dostać to, co czytelnik
// wskazał, a nie to, gdzie kliknął. Dzięki temu ta sama obsługa działa dla
// kliknięcia i dla klawisza Enter, a testy nie muszą symulować geometrii.
import type { ChartKind } from "./types";

export interface ChartSelection {
  /** Rodzaj wykresu, na którym padło wskazanie. */
  kind: ChartKind;
  /**
   * Indeks kategorii na osi; `null` = rodzaj nie ma osi kategorii (rozrzut,
   * rozkład jednej serii).
   */
  categoryIndex: number | null;
  /** Etykieta kategorii, dokładnie ta z osi. */
  category: string | null;
  /**
   * Indeks serii; `null` = wskazanie NIE ROZSTRZYGA serii.
   *
   * Tak jest przy wykresie wielo-seryjnym o wspólnej strefie trafienia: pas
   * kategorii obejmuje wszystkie serie naraz, więc podanie którejkolwiek
   * byłoby zgadywaniem. Przy JEDNEJ serii dwuznaczności nie ma i indeks
   * jedzie - bo wtedy „kliknąłem słupek" znaczy dokładnie jedno.
   */
  seriesIndex: number | null;
  /** Nazwa serii, gdy wskazanie ją rozstrzyga. */
  seriesName: string | null;
  /** Wartość pod wskazaniem, gdy wskazanie ją rozstrzyga. */
  value: number | null;
}

/** Obsługa wskazania. Wywoływana kliknięciem ORAZ klawiszem Enter i spacją. */
export type ChartSelectHandler = (selection: ChartSelection) => void;

/** Czy klawisz oznacza „wybieram to, co wskazane". */
export function isSelectKey(key: string): boolean {
  return key === "Enter" || key === " " || key === "Spacebar";
}

/**
 * Wskazanie na osi kategorii.
 *
 * Seria jedzie TYLKO przy jednej serii w zestawie - patrz `seriesIndex`.
 * Funkcja jest wspólna, bo inaczej każdy render rozstrzygałby tę
 * dwuznaczność po swojemu i panel dostawałby raz `null`, raz zero.
 */
export function categorySelection(
  kind: ChartKind,
  categories: readonly string[],
  series: readonly { name: string; values: readonly (number | null)[] }[],
  index: number,
): ChartSelection {
  const jedna = series.length === 1 ? series[0] : null;
  return {
    kind,
    categoryIndex: index,
    category: categories[index] ?? null,
    seriesIndex: jedna === null ? null : 0,
    seriesName: jedna === null ? null : jedna.name,
    value: jedna === null ? null : (jedna.values[index] ?? null),
  };
}

/**
 * Rodzaje, które wskazania NIE ODDAJĄ, każdy z powodem.
 *
 * Tabela jest tu po to, żeby brak był DECYZJĄ, a nie przeoczeniem: bez niej
 * następny czytelnik kodu widzi wyłącznie ciszę i nie wie, czy rodzaj czegoś
 * nie umie, czy czegoś nie chce.
 *
 * Wspólny powód wszystkich trzech: ich „wskazany element" nie jest wierszem
 * danych. W histogramie to PRZEDZIAŁ (zbiór obserwacji, nie obserwacja),
 * w pudełku - PIĘCIOLICZBOWE PODSUMOWANIE serii, w roju - pojedyncza kropka
 * bez tożsamości poza własną wartością. Podanie tam `categoryIndex` byłoby
 * wskazaniem na coś, czego w arkuszu autora nie ma.
 */
const BEZ_WSKAZANIA: Partial<Record<ChartKind, string>> = {
  histogram: "wskazany element to PRZEDZIAŁ, czyli zbiór obserwacji, a nie wiersz danych",
  boxplot: "wskazany element to pięcioliczbowe PODSUMOWANIE serii, a nie wiersz danych",
  beeswarm: "kropka nie ma tożsamości poza własną wartością - nie ma czego oddać",
};

/** Czy rodzaj oddaje wskazanie. Czytane przez bramkę `everyKindRenders`. */
export function oddajeWskazanie(kind: ChartKind): boolean {
  return !(kind in BEZ_WSKAZANIA);
}
