// Wykres aktywnosci watku - regula, nie rysunek.
//
// PO CO OSOBNY PLIK. `ClubThreadInsightsPanel` rysowal cztery serie slupkow
// i skladal opis zakresu W SRODKU JSX-a: filtr serii zerowych, przelicznik
// wysokosci wobec szczytu i sklejenie dwoch dat w jeden napis. Kazda z tych
// trzech rzeczy jest REGULA (co wchodzi do slupka, wobec czego liczy sie
// wysokosc, jak brzmi zakres pustej serii), a nie ukladem - i kazda ma stan
// brzegowy, ktorego z komponentu nie da sie dosiegnac inaczej niz przypadkiem.
//
// Kolory serii ZOSTAJA w komponencie. Tutaj jest KOLEJNOSC - a ona jest
// decyzja produktowa: ten sam porzadek obowiazuje w legendzie, w slupku i w
// tabeli, bo trzy rozne porzadki dla tych samych danych zmuszalyby do
// czytania wykresu za kazdym razem od nowa.
import type { InsightBar } from "./threadWorkspaceTypes";
import { formatDateShort } from "@/lib/i18n/format";

/** Serie w KOLEJNOSCI legendy, slupka i tabeli. Jedna kolejnosc, jedno miejsce. */
export const INSIGHT_SERIES_KEYS = ["replies", "questions", "documents", "milestones"] as const;
export type InsightSeriesKey = (typeof INSIGHT_SERIES_KEYS)[number];

export interface InsightSegment {
  key: InsightSeriesKey;
  value: number;
}

/**
 * Segmenty jednego slupka. Seria o zerowej wartosci NIE wchodzi do slupka:
 * segment o zerowej wysokosci to wezel, ktory nic nie znaczy, a psuje odstepy
 * miedzy pozostalymi.
 */
export function insightSegments(bar: InsightBar): InsightSegment[] {
  const out: InsightSegment[] = [];
  for (const key of INSIGHT_SERIES_KEYS) {
    const value = bar[key];
    if (value > 0) out.push({ key, value });
  }
  return out;
}

/**
 * Wysokosc segmentu w procentach. Liczona wobec SZCZYTU, nie wobec sumy -
 * slupki maja porownywac sie miedzy soba. Prog trzech procent jest po to, zeby
 * jedna pozycja na sto nie zniknela z wykresu; szczyt <= 0 nie dzieli przez
 * zero, tylko oddaje sam prog.
 */
export function insightBarPercent(value: number, peak: number): number {
  return Math.max(3, Math.round((value / Math.max(1, peak)) * 100));
}

/**
 * Zakres czasu serii jako jeden napis. PUSTA seria nie ma zakresu i oddaje
 * pusty napis - data poczatku bez danych bylaby informacja falszywa.
 */
export function insightRangeLabel(bars: readonly InsightBar[], lang: string): string {
  const first = bars[0];
  const last = bars[bars.length - 1];
  if (first === undefined || last === undefined) return "";
  return `${formatDateShort(first.start, lang)} - ${formatDateShort(last.end, lang)}`;
}
