// OKRESY PULPITU ADMINA - model czasu dla wszystkich kafelków i wykresów.
//
// PO CO OSOBNY MODUŁ, SKORO ISTNIEJE `TimeRangeFilter`. Tamten filtr liczy okna
// PRZESUWNE ("ostatnie 30 dni") i to jest właściwa forma dla diagnostyki
// wydajności: interesuje nas ostatnia doba, nie "doba kalendarzowa". Pulpit
// odpowiada na inne pytanie - "jak nam idzie w TYM miesiącu" - a na nie nie da
// się odpowiedzieć oknem przesuwnym: 30 dni wstecz 12 września obejmuje połowę
// sierpnia, więc porównanie z "poprzednimi 30 dniami" miesza dwa miesiące po
// obu stronach i nie znaczy nic.
//
// Dlatego okresy są tu KOTWICZONE KALENDARZOWO (początek doby, tygodnia,
// miesiąca, kwartału, półrocza, roku), a okres poprzedni jest ich
// odpowiednikiem przesuniętym o jedną jednostkę wstecz.
//
// OKRES NIEPEŁNY PORÓWNUJE SIĘ DO RÓWNIE NIEPEŁNEGO. To jest sedno całej
// arytmetyki poniżej. 12 września porównanie "ten miesiąc" do "poprzedni
// miesiąc" liczone jako 12 dni września kontra 31 dni sierpnia pokazałoby
// spadek o 60% na stronie, która rośnie. Okno poprzednie dostaje więc TYLE
// SAMO CZASU, ile upłynęło w bieżącym (12 dni sierpnia), i jest przycięte do
// własnego końca, żeby nigdy nie zachodziło na okres bieżący.
//
// STREFA CZASOWA JEST STREFĄ ADMINA. Granice liczy `Date` przeglądarki, czyli
// zegar osoby, która patrzy na pulpit - "dzisiaj" ma znaczyć jej dzisiaj, a nie
// dobę UTC. Serwer dostaje gotowe znaczniki ISO plus `offsetMinutes`, żeby
// kubełkować po tej samej dobie (patrz `bucket` niżej).
//
// `nowMs` JEST ARGUMENTEM, NIE ODCZYTEM ZEGARA. Cały moduł jest czysty: to samo
// wejście daje to samo wyjście, więc testy okresów nie muszą zamrażać czasu
// globalnie (bramka `check:clock-freeze`), a pulpit może pokazać dowolny
// moment, jeśli kiedyś dojdzie podgląd historyczny.

/**
 * Kolejność zakładek na pulpicie. Rośnie ziarnem: od podglądu na żywo do roku.
 * Tablica jest ŹRÓDŁEM, typ jest z niej wyprowadzony - dopisanie okresu w jednym
 * miejscu rozszerza jednocześnie typ, walidację wejścia serwera i listę zakładek.
 */
export const DASHBOARD_PERIODS = [
  "realtime",
  "today",
  "week",
  "month",
  "prev-month",
  "quarter",
  "half-year",
  "year",
] as const;

export type DashboardPeriodId = (typeof DASHBOARD_PERIODS)[number];

export function isDashboardPeriod(raw: unknown): raw is DashboardPeriodId {
  return typeof raw === "string" && (DASHBOARD_PERIODS as readonly string[]).includes(raw);
}

/**
 * Ziarno szeregu czasowego. Dobiera je okres, a nie panel: wykres roczny
 * w kubełkach dziennych to 365 punktów na 700 pikselach, czyli szum zamiast
 * trendu, a wykres dobowy w kubełkach miesięcznych ma jeden słupek.
 */
export type DashboardBucket = "minute" | "hour" | "day" | "week" | "month";

export interface DashboardWindow {
  /** Dolna granica włącznie, ISO 8601. */
  sinceIso: string;
  /** Górna granica wyłącznie, ISO 8601. */
  untilIso: string;
}

export interface DashboardRange {
  period: DashboardPeriodId;
  bucket: DashboardBucket;
  current: DashboardWindow;
  /**
   * Okres odniesienia. Zawsze istnieje - pulpit bez porównania podaje liczbę,
   * z której nie wynika żadna decyzja ("1200 sesji" to dużo czy mało?).
   */
  previous: DashboardWindow;
  /**
   * Minuty na wschód od UTC w strefie oglądającego. Serwer kubełkuje po dobie
   * LOKALNEJ, więc musi znać przesunięcie - inaczej "wczoraj" na pulpicie
   * w Warszawie kończyłoby się o 2:00 nad ranem.
   */
  offsetMinutes: number;
  /** Czy okno jest domknięte (okres miniony), czy rośnie razem z zegarem. */
  complete: boolean;
}

/** Odświeżanie zapytań w milisekundach - podgląd na żywo goni, reszta nie. */
export function refetchIntervalFor(period: DashboardPeriodId): number | false {
  return period === "realtime" ? 15_000 : false;
}

/**
 * Ziarno, do którego zaokrąglamy "teraz" przy liczeniu okna.
 *
 * PO CO KWANTOWAĆ. Okno kończy się "teraz", więc liczone z surowego zegara
 * jest INNE przy każdym renderze - a że wchodzi do klucza zapytania, pulpit
 * odpytywałby bazę w kółko i nigdy nie trafiał w cache. Kwant sprowadza "teraz"
 * do wspólnego stopnia, więc klucz jest stabilny między odświeżeniami.
 *
 * DLACZEGO RÓŻNY PER OKRES, a nie jedna stała. Kwant jest tu ceną świeżości:
 * przy podglądzie na żywo piętnaście sekund to sens istnienia zakładki, a przy
 * roku piętnaście minut nie zmienia ani jednego piksela wykresu miesięcznego.
 * Jedna stała musiałaby wybrać między odświeżaniem roku co piętnaście sekund
 * a zamrożeniem podglądu na kwadrans.
 */
export function rangeQuantumMs(period: DashboardPeriodId): number {
  switch (period) {
    case "realtime":
      return 15_000;
    case "today":
      return 60_000;
    case "week":
    case "month":
      return 5 * 60_000;
    default:
      return 15 * 60_000;
  }
}

/** "Teraz" sprowadzone do kwantu okresu - patrz `rangeQuantumMs`. */
export function quantizeNow(period: DashboardPeriodId, nowMs: number): number {
  const q = rangeQuantumMs(period);
  return Math.floor(nowMs / q) * q;
}

/** Ile minut wstecz sięga podgląd na żywo. */
export const REALTIME_WINDOW_MINUTES = 30;

/**
 * Ile minut bezczynności jeszcze liczy sesję jako żywą. Krócej niż okno
 * podglądu: kafelek "teraz na stronie" ma mówić o TERAZ, a kreska obok pokazuje
 * ostatnie pół godziny, żeby było widać, czy ruch rośnie, czy właśnie opadł.
 */
export const REALTIME_ACTIVE_MINUTES = 5;

/* ---------------------------------------------------------------- pomocnicze */

const MINUTE_MS = 60_000;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/**
 * Początek tygodnia W PONIEDZIAŁEK. `getDay()` zwraca 0 dla niedzieli, więc
 * zwykłe odjęcie `getDay()` cofa niedzielę o zero dni i robi z niej pierwszy
 * dzień tygodnia - w Polsce (i w ISO 8601) niedziela jest dniem ostatnim.
 */
function startOfWeek(d: Date): Date {
  const day = (d.getDay() + 6) % 7;
  const monday = startOfDay(d);
  monday.setDate(monday.getDate() - day);
  return monday;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function startOfQuarter(d: Date): Date {
  return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1, 0, 0, 0, 0);
}

function startOfHalf(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() < 6 ? 0 : 6, 1, 0, 0, 0, 0);
}

function startOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1, 0, 0, 0, 0);
}

/** Ten sam punkt kalendarza `months` miesięcy wcześniej. */
function minusMonths(d: Date, months: number): Date {
  return new Date(d.getFullYear(), d.getMonth() - months, 1, 0, 0, 0, 0);
}

function win(sinceMs: number, untilMs: number): DashboardWindow {
  return { sinceIso: new Date(sinceMs).toISOString(), untilIso: new Date(untilMs).toISOString() };
}

/**
 * Okres poprzedni dla okna, które jeszcze trwa.
 *
 * Dostaje tyle samo czasu, ile upłynęło w bieżącym, i jest PRZYCIĘTY do
 * własnego końca (= początku okresu bieżącego). Przycięcie ma znaczenie tam,
 * gdzie okresy mają różną długość: 31 marca "ten miesiąc" ma za sobą 31 dni,
 * a luty tyle nie ma - bez przycięcia okno odniesienia sięgnęłoby w marzec
 * i policzyło ten sam ruch po obu stronach porównania.
 */
function trailingPrevious(prevStartMs: number, curStartMs: number, elapsedMs: number) {
  return win(prevStartMs, Math.min(prevStartMs + elapsedMs, curStartMs));
}

/* -------------------------------------------------------------------- model */

/**
 * Okna bieżące i odniesienia dla zakładki pulpitu.
 *
 * @param period zakładka
 * @param nowMs  "teraz" w milisekundach - podawane, nigdy nie czytane z zegara
 */
export function resolveDashboardRange(period: DashboardPeriodId, nowMs: number): DashboardRange {
  const now = new Date(nowMs);
  const offsetMinutes = -now.getTimezoneOffset();
  const base = { period, offsetMinutes } as const;

  switch (period) {
    case "realtime": {
      const span = REALTIME_WINDOW_MINUTES * MINUTE_MS;
      return {
        ...base,
        bucket: "minute",
        current: win(nowMs - span, nowMs),
        previous: win(nowMs - 2 * span, nowMs - span),
        complete: false,
      };
    }

    case "today": {
      const start = startOfDay(now).getTime();
      const elapsed = nowMs - start;
      const prevStart = new Date(start - 1).setHours(0, 0, 0, 0);
      return {
        ...base,
        bucket: "hour",
        current: win(start, nowMs),
        previous: trailingPrevious(prevStart, start, elapsed),
        complete: false,
      };
    }

    case "week": {
      const start = startOfWeek(now).getTime();
      const elapsed = nowMs - start;
      const prevStart = startOfWeek(new Date(start - 1)).getTime();
      return {
        ...base,
        bucket: "day",
        current: win(start, nowMs),
        previous: trailingPrevious(prevStart, start, elapsed),
        complete: false,
      };
    }

    case "month": {
      const start = startOfMonth(now).getTime();
      const elapsed = nowMs - start;
      const prevStart = minusMonths(now, 1).getTime();
      return {
        ...base,
        bucket: "day",
        current: win(start, nowMs),
        previous: trailingPrevious(prevStart, start, elapsed),
        complete: false,
      };
    }

    // JEDYNY OKRES DOMKNIĘTY PO OBU STRONACH. Miesiąc miniony jest zamkniętym
    // rozliczeniem, więc porównuje się go do CAŁEGO miesiąca przed nim, a nie
    // do jego wycinka - tu obie strony są pełne i przycinanie nie ma czego
    // ratować.
    case "prev-month": {
      const curStart = minusMonths(now, 1).getTime();
      const curEnd = startOfMonth(now).getTime();
      const prevStart = minusMonths(now, 2).getTime();
      return {
        ...base,
        bucket: "day",
        current: win(curStart, curEnd),
        previous: win(prevStart, curStart),
        complete: true,
      };
    }

    case "quarter": {
      const start = startOfQuarter(now).getTime();
      const elapsed = nowMs - start;
      const prevStart = minusMonths(new Date(start), 3).getTime();
      return {
        ...base,
        bucket: "day",
        current: win(start, nowMs),
        previous: trailingPrevious(prevStart, start, elapsed),
        complete: false,
      };
    }

    case "half-year": {
      const start = startOfHalf(now).getTime();
      const elapsed = nowMs - start;
      const prevStart = minusMonths(new Date(start), 6).getTime();
      return {
        ...base,
        bucket: "week",
        current: win(start, nowMs),
        previous: trailingPrevious(prevStart, start, elapsed),
        complete: false,
      };
    }

    case "year": {
      const start = startOfYear(now).getTime();
      const elapsed = nowMs - start;
      const prevStart = minusMonths(new Date(start), 12).getTime();
      return {
        ...base,
        bucket: "month",
        current: win(start, nowMs),
        previous: trailingPrevious(prevStart, start, elapsed),
        complete: false,
      };
    }
  }
}

/** Długość okna w dniach (zaokrąglona w górę, minimum 1) - do podpisów. */
export function windowDays(w: DashboardWindow): number {
  const ms = Date.parse(w.untilIso) - Date.parse(w.sinceIso);
  return Math.max(1, Math.ceil(ms / 86_400_000));
}

/** Klucz i18n etykiety zakładki. */
export function periodLabelKey(period: DashboardPeriodId): string {
  return `adminDashboard.period.${period}`;
}

/** Klucz i18n opisu okresu odniesienia ("wobec ..."). */
export function comparisonLabelKey(period: DashboardPeriodId): string {
  return `adminDashboard.comparison.${period}`;
}
