// Rozkład aktywności klubu na czternaście dni - czysta projekcja z wierszy
// listy wątków.
//
// PO CO OSOBNY MODUŁ. To jest reguła ODCZYTU danych, nie sposób rysowania
// słupków: gdzie kończy się okno, co robić ze znacznikiem czasu z przyszłości
// (rozjazd zegara serwera), co znaczy „wątek żywy” i „wątek uśpiony”. Reguła
// w komponencie da się sprawdzić tylko przez render i tylko na tyle, na ile
// widać ją w DOM-ie; tutaj dostaje tabelę przypadków bez przeglądarki - dokładnie
// tak, jak `computeThreadPulse`, z którego korzysta.
//
// Świadomie liczymy z ZAŁADOWANEJ strony wątków, nie z całego klubu: to jest
// obraz tego, co użytkownik widzi pod paskiem, a podpis mówi to wprost.
import { computeThreadPulse, type ThreadPulseInput } from "./threadPulse";

const DAY = 86_400_000;

/** Szerokość okna w dniach. Stała, żeby pasek nie zmieniał wysokości. */
export const CLUB_ACTIVITY_SPAN_DAYS = 14;

/** Ile ostatnich dni z okna liczy podpis „w tym tygodniu”. */
export const CLUB_ACTIVITY_WEEK_DAYS = 7;

export interface ClubActivityModel {
  /** Liczba wątków na dzień, od najstarszego dnia okna do dzisiaj. */
  readonly days: readonly number[];
  /** Najwyższy słupek - mianownik dla wysokości. Zero, gdy w oknie cisza. */
  readonly peak: number;
  /** Suma z siedmiu ostatnich dni okna. */
  readonly week: number;
  /** Wątki z pulsem co najmniej „steady” (poziom >= 2). */
  readonly live: number;
  /** Wątki uśpione (poziom 0) - w tym te bez ani jednej odpowiedzi. */
  readonly dormant: number;
}

/**
 * Dwie RÓŻNE miary z jednego przejścia po liście:
 *
 *  1. ROZKŁAD W CZASIE bierze wyłącznie wątki, których ostatnia aktywność
 *     wpada w okno. Wątek starszy niż okno oraz wątek ze znacznikiem czasu
 *     z PRZYSZŁOŚCI (rozjazd zegara) nie mają w nim słupka - i tak ma być,
 *     bo słupek poza osią byłby kłamstwem o dacie.
 *  2. STAN „żywy/uśpiony” bierze WSZYSTKIE wątki, także te sprzed okna:
 *     „siedem uśpionych” to informacja o klubie, nie o ostatnich dwóch
 *     tygodniach.
 *
 * Znacznik czasu, którego nie da się odczytać, wypada z rozkładu, ale nadal
 * przechodzi przez puls - jeden uszkodzony wiersz nie ma prawa wywrócić paska.
 */
export function computeClubActivity(
  threads: readonly ThreadPulseInput[],
  now: number,
): ClubActivityModel {
  const today = Math.floor(now / DAY);
  const days = new Array<number>(CLUB_ACTIVITY_SPAN_DAYS).fill(0);

  let live = 0;
  let dormant = 0;
  for (const thread of threads) {
    const stamp = Date.parse(thread.last_reply_at ?? thread.created_at);
    if (Number.isFinite(stamp)) {
      const index = CLUB_ACTIVITY_SPAN_DAYS - 1 - (today - Math.floor(stamp / DAY));
      if (index >= 0 && index < CLUB_ACTIVITY_SPAN_DAYS) days[index] = (days[index] ?? 0) + 1;
    }
    const pulse = computeThreadPulse(thread, now);
    if (pulse.level >= 2) live += 1;
    if (pulse.level === 0) dormant += 1;
  }

  return {
    days,
    peak: days.reduce((max, value) => Math.max(max, value), 0),
    week: days
      .slice(CLUB_ACTIVITY_SPAN_DAYS - CLUB_ACTIVITY_WEEK_DAYS)
      .reduce((sum, value) => sum + value, 0),
    live,
    dormant,
  };
}

/**
 * Wysokość słupka w procentach. Minimum dwanaście, także dla dnia bez ruchu:
 * słupek zerowej wysokości wygląda jak usterka renderowania, a nie jak cisza.
 */
export function clubActivityBarHeight(count: number, peak: number): number {
  if (peak === 0) return 12;
  return Math.max(12, Math.round((count / peak) * 100));
}
