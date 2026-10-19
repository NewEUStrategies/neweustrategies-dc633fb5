// OKNO CZASU HUBA „PRZYCHÓD I LEJEK" - jeden model czasu z pulpitem admina.
//
// DLACZEGO DELEGACJA, A NIE WŁASNA ARYTMETYKA. Hub i pulpit pokazują te same
// liczby (sesje, rejestracje, przychód) obok siebie. Dwie implementacje
// „tego miesiąca" rozjechałyby się na pierwszej zmianie czasu albo na 31 marca
// - i admin zobaczyłby dwie różne wartości jednego wskaźnika. Okresy wspólne
// (`week` … `year`) liczy więc WYŁĄCZNIE `resolveDashboardRange`; ten moduł
// dokłada tylko to, czego pulpit nie ma: `ltm` i okres własny.
//
// STREFA = STREFA ADMINA. Granice stoją na LOKALNYCH północach, budowanych
// konstruktorem `new Date(r, m, d)`, nigdy przez `toISOString().slice(0, 10)`
// (AGENTS: daty lokalne - napis UTC przesuwa dzień o przesunięcie strefy).
// Serwer dostaje gotowe znaczniki ISO i `offsetMinutes` do kubełkowania.
//
// `nowMs` JEST ARGUMENTEM. Moduł jest czysty jak `period.ts`: to samo wejście
// daje ten sam wynik, a testy nie muszą zamrażać zegara.
import {
  quantizeNow,
  resolveDashboardRange,
  type DashboardBucket,
  type DashboardPeriodId,
  type DashboardWindow,
} from "@/lib/admin/dashboard/period";
import { isLocalIsoDay, type RevenuePeriod } from "@/lib/revenue/search";

export interface RevenueRange {
  /** Okres faktycznie rozstrzygnięty (zdeformowany `custom` → `month`). */
  period: RevenuePeriod;
  current: DashboardWindow;
  /** Okno porównawcze tej samej długości; `null`, gdy porównanie nie ma sensu. */
  previous: DashboardWindow | null;
  bucket: DashboardBucket;
  /** Minuty na wschód od UTC w strefie admina (jak `DashboardRange`). */
  offsetMinutes: number;
  /** Czy okno jest domknięte (okres miniony), czy rośnie razem z zegarem. */
  complete: boolean;
}

/**
 * Najdłuższy okres własny, dla którego liczymy okno porównawcze. Dłuższe
 * „poprzednie 500 dni" sięga za horyzont danych (retencja zdarzeń 12 mies.,
 * księga MRR od wdrożenia) - lepiej nie pokazać porównania, niż pokazać
 * deltę z przyciętej podstawy.
 */
export const REVENUE_CUSTOM_COMPARE_MAX_DAYS = 400;

const DAY_MS = 86_400_000;

/** Okresy, które liczy pulpit - wspólna część obu list. */
type DashboardDelegated = Extract<RevenuePeriod, DashboardPeriodId>;

function isDelegated(period: RevenuePeriod): period is DashboardDelegated {
  return period !== "ltm" && period !== "custom";
}

function win(sinceMs: number, untilMs: number): DashboardWindow {
  return { sinceIso: new Date(sinceMs).toISOString(), untilIso: new Date(untilMs).toISOString() };
}

function offsetAt(ms: number): number {
  return -new Date(ms).getTimezoneOffset();
}

/** Lokalna północ dnia `YYYY-MM-DD` (już zwalidowanego). */
function localMidnight(day: string, plusDays = 0): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d + plusDays);
}

function fromDashboard(period: DashboardDelegated, nowMs: number): RevenueRange {
  // Kwant z pulpitu: „teraz" wchodzi do klucza zapytania, więc surowy zegar
  // dawałby nowy klucz przy każdym renderze (i zapytanie przy każdym).
  const r = resolveDashboardRange(period, quantizeNow(period, nowMs));
  return {
    period,
    current: r.current,
    previous: r.previous,
    bucket: r.bucket,
    offsetMinutes: r.offsetMinutes,
    complete: r.complete,
  };
}

/**
 * 12 PEŁNYCH miesięcy kalendarzowych kończących się na początku bieżącego
 * miesiąca. Nie okno kroczące 365 dni: wskaźniki roczne (ARR, churn roczny,
 * NRR) liczy się z zamkniętych miesięcy, więc okno z połową bieżącego
 * miesiąca mieszałoby rozliczony okres z nierozliczonym.
 */
function lastTwelveMonths(nowMs: number): RevenueRange {
  const now = new Date(nowMs);
  const y = now.getFullYear();
  const m = now.getMonth();
  const end = new Date(y, m, 1).getTime();
  const start = new Date(y, m - 12, 1).getTime();
  const prevStart = new Date(y, m - 24, 1).getTime();
  return {
    period: "ltm",
    current: win(start, end),
    previous: win(prevStart, start),
    bucket: "month",
    offsetMinutes: offsetAt(start),
    complete: true,
  };
}

/**
 * Kubełek okresu własnego - progi pulpitu: do kwartału doby, do półrocza
 * tygodnie, dłużej miesiące. Okres własny długości kwartału ma wyglądać jak
 * zakładka „Kwartał", a nie mieć 13 słupków zamiast 92.
 */
function customBucket(days: number): DashboardBucket {
  if (days <= 92) return "day";
  if (days <= 184) return "week";
  return "month";
}

function custom(from: string, to: string, nowMs: number): RevenueRange | null {
  const since = localMidnight(from);
  // `to` WŁĄCZNIE: koniec okna to lokalna północ dnia następnego.
  const until = localMidnight(to, 1);
  if (until.getTime() <= since.getTime()) return null;
  // Liczba dób kalendarzowych, nie milisekund: doba zmiany czasu ma 23 albo
  // 25 godzin, a okno porównawcze ma zaczynać się o północy, nie o 23:00.
  const days = Math.round((until.getTime() - since.getTime()) / DAY_MS);
  const prevSince = localMidnight(from, -days).getTime();
  return {
    period: "custom",
    current: win(since.getTime(), until.getTime()),
    previous: days > REVENUE_CUSTOM_COMPARE_MAX_DAYS ? null : win(prevSince, since.getTime()),
    bucket: customBucket(days),
    offsetMinutes: offsetAt(since.getTime()),
    complete: until.getTime() <= nowMs,
  };
}

/**
 * Okno bieżące i porównawcze dla okresu huba.
 *
 * @param period okres z adresu (`?w=`)
 * @param nowMs  „teraz" - podawane, nigdy nie czytane z zegara
 * @param from   `YYYY-MM-DD` (lokalnie, włącznie) - tylko dla `custom`
 * @param to     `YYYY-MM-DD` (lokalnie, włącznie) - tylko dla `custom`
 *
 * Zdeformowany okres własny (brak granic, data spoza kalendarza, `from` po
 * `to`) rozstrzyga się jak `month` i tak się nazywa (`period: "month"`): klucz
 * zapytania i etykieta mówią wtedy prawdę o oknie, które naprawdę policzono.
 */
export function resolveRevenueRange(
  period: RevenuePeriod,
  nowMs: number,
  from?: string,
  to?: string,
): RevenueRange {
  if (isDelegated(period)) return fromDashboard(period, nowMs);
  if (period === "ltm") return lastTwelveMonths(nowMs);
  const range = isLocalIsoDay(from) && isLocalIsoDay(to) ? custom(from, to, nowMs) : null;
  return range ?? fromDashboard("month", nowMs);
}
