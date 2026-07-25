/**
 * JEDEN kanoniczny resolwer okna czasowego dla wszystkich strumieni.
 *
 * PRZYCZYNA ŹRÓDŁOWA, KTÓRĄ TO USUWA: każdy dashboard budował okno sam.
 * Web Vitals liczył `now - days * 86 400 000` (kroczące milisekundy UTC), GA4
 * wysyłał `"28daysAgo"`/`"today"` (Google interpretuje to jako DNI w strefie
 * czasowej property i dokłada dzisiejszy, jeszcze niedomknięty dzień), a
 * `related_posts_signals` używał `now() - make_interval(days => N)` po stronie
 * Postgresa. Trzy różne przedziały pod tą samą etykietą „28 dni” - i trzy
 * różne liczby w raporcie.
 *
 * Dodatkowo GA4 dostawał okno poprzednie jako `[56daysAgo, 28daysAgo]` przy
 * bieżącym `[28daysAgo, today]`. Oba przedziały są w GA4 DOMKNIĘTE, więc dzień
 * „28 dni temu” wpadał do OBU: baza porównawcza była zawyżona o jeden dzień, a
 * każda delta procentowa na kafelkach KPI - systematycznie zaniżona.
 *
 * Reguły, które ten plik egzekwuje:
 *  1. Okno porównawcze między strumieniami jest PRZYCIĘTE DO PEŁNYCH DNI UTC i
 *     domyślnie NIE zawiera dnia otwartego - inaczej liczba z GA4 (opóźnienie
 *     ingestii) zawsze przegrywa z naszym beaconem czasu rzeczywistego.
 *  2. Zakres dat dla GA4 jest wyprowadzany z TYCH SAMYCH instantów co granice
 *     ISO dla Postgresa - nigdy z osobnego napisu `NdaysAgo`.
 *  3. Okno poprzednie jest ROZŁĄCZNE z bieżącym i ma tę samą długość.
 *  4. Reszta nieusuwalnych różnic (dni w strefie property GA4, RPC liczące
 *     `now() - interval`) jest DEKLAROWANA jako `WindowNote`, żeby raport mógł
 *     je pokazać, zamiast udawać, że ich nie ma.
 */

export type WindowPresetId = "24h" | "7d" | "14d" | "28d" | "30d" | "90d";

/** Ziarno granic okna. */
export type WindowGrain =
  /** Przycięte do pełnych dni UTC - porównywalne z dziennym GA4. */
  | "day"
  /** Kroczące instanty (np. ostatnie 24 h) - dokładne u nas, nieosiągalne w GA4. */
  | "instant";

/**
 * Nieusuwalne zastrzeżenia rozwiązanego okna. Kody są stabilne i tłumaczone w UI
 * (`adminAnalytics.semantic.windowNotes.*`).
 */
export type WindowNote =
  /** GA4 kubkuje dni w strefie property; nasze granice są w UTC. */
  | "ga4_property_timezone"
  /** Okno zawiera dzień jeszcze niedomknięty przez GA4 - ostatni dzień zaniża. */
  | "ga4_open_day"
  /** Okno jest kroczące (nie dobowe) - GA4 nie umie takiego przedziału. */
  | "instant_grain_not_available_in_ga4"
  /** Świadomie pomijamy dzień bieżący, żeby wszystkie strumienie miały pełne dni. */
  | "excludes_open_day"
  /** Starsze RPC (`related_posts_signals`) liczą okno jako `now() - N dni`. */
  | "legacy_rpc_window_ends_now";

export interface Ga4DateRange {
  /** `YYYY-MM-DD`, domknięty od dołu. */
  readonly startDate: string;
  /** `YYYY-MM-DD`, domknięty od góry. */
  readonly endDate: string;
}

export interface CanonicalWindow {
  readonly presetId: WindowPresetId | "custom";
  /** Instant domknięty od dołu (ISO 8601, UTC). */
  readonly sinceIso: string;
  /** Instant domknięty od góry (ISO 8601, UTC). */
  readonly untilIso: string;
  /** Długość okna w dniach - do etykiet i do `windowDays` w agregatach. */
  readonly days: number;
  readonly grain: WindowGrain;
  /**
   * Czy na tym oknie wolno uzgadniać liczby MIĘDZY strumieniami. Fałsz dla okien
   * krocząco-godzinowych (GA4 nie ma takiej rozdzielczości) oraz dla okien z
   * dniem otwartym (GA4 jeszcze go nie domknął).
   */
  readonly crossStreamSafe: boolean;
  /** Zakres dat do wysłania do GA4 Data API - wyprowadzony z granic powyżej. */
  readonly ga4: Ga4DateRange;
  /** Liczba dni dla starszych RPC przyjmujących `_since_days`. */
  readonly rpcDays: number;
  readonly notes: readonly WindowNote[];
}

const DAY_MS = 86_400_000;

const PRESET_DAYS: Record<WindowPresetId, number> = {
  "24h": 1,
  "7d": 7,
  "14d": 14,
  "28d": 28,
  "30d": 30,
  "90d": 90,
};

/** Początek dnia UTC, w którym leży `ms`. */
function utcDayStart(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** `YYYY-MM-DD` w UTC. */
export function utcDateString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Zakres dat GA4 wyprowadzony z granic instantowych okna (te same dni UTC). */
export function ga4RangeFromInstants(sinceMs: number, untilMs: number): Ga4DateRange {
  return { startDate: utcDateString(sinceMs), endDate: utcDateString(untilMs) };
}

export interface ResolveWindowInput {
  readonly presetId: WindowPresetId;
  /** Wstrzykiwane „teraz” - testy są deterministyczne, produkcja podaje Date.now(). */
  readonly nowMs?: number;
  /**
   * Dołącz dzień bieżący (jeszcze niedomknięty). Wygodne dla podglądu na żywo,
   * ale wyłącza uzgadnianie międzystrumieniowe: GA4 nie zamknęło jeszcze doby.
   */
  readonly includeOpenDay?: boolean;
}

/**
 * Kanoniczne okno dla presetu.
 *
 * Preset `24h` zostaje kroczący (instantowy) - to podgląd operacyjny, nie
 * materiał do raportu; jest jawnie oznaczony jako niebezpieczny do porównań.
 * Pozostałe presety obejmują N OSTATNICH PEŁNYCH dni UTC, więc Postgres i GA4
 * pytają o dokładnie te same dni kalendarzowe.
 */
export function resolveWindow(input: ResolveWindowInput): CanonicalWindow {
  const nowMs = input.nowMs ?? Date.now();
  const days = PRESET_DAYS[input.presetId];
  const includeOpenDay = input.includeOpenDay ?? false;

  if (input.presetId === "24h") {
    const sinceMs = nowMs - DAY_MS;
    return {
      presetId: "24h",
      sinceIso: new Date(sinceMs).toISOString(),
      untilIso: new Date(nowMs).toISOString(),
      days: 1,
      grain: "instant",
      crossStreamSafe: false,
      ga4: ga4RangeFromInstants(sinceMs, nowMs),
      rpcDays: 1,
      notes: ["instant_grain_not_available_in_ga4", "ga4_open_day", "ga4_property_timezone"],
    };
  }

  const todayStart = utcDayStart(nowMs);
  // Domyślnie ostatni pełny dzień to wczoraj; z `includeOpenDay` bierzemy dzisiaj.
  const lastDayStart = includeOpenDay ? todayStart : todayStart - DAY_MS;
  const firstDayStart = lastDayStart - (days - 1) * DAY_MS;
  const untilMs = includeOpenDay ? nowMs : lastDayStart + DAY_MS - 1;

  const notes: WindowNote[] = ["ga4_property_timezone"];
  notes.push(includeOpenDay ? "ga4_open_day" : "excludes_open_day");

  return {
    presetId: input.presetId,
    sinceIso: new Date(firstDayStart).toISOString(),
    untilIso: new Date(untilMs).toISOString(),
    days,
    grain: "day",
    crossStreamSafe: !includeOpenDay,
    ga4: ga4RangeFromInstants(firstDayStart, lastDayStart),
    rpcDays: days,
    notes,
  };
}

/**
 * Okno z ręcznie wybranego zakresu (kalendarz w `TimeRangeFilter`). Granice są
 * przycinane do pełnych dni UTC, żeby zakres dat dla GA4 pokrywał się z granicami
 * dla Postgresa. Okno kończące się dzisiaj traci `crossStreamSafe` - GA4 nie
 * domknęło jeszcze tej doby.
 */
export function resolveCustomWindow(
  sinceIso: string,
  untilIso: string,
  nowMs: number = Date.now(),
): CanonicalWindow {
  const rawSince = Date.parse(sinceIso);
  const rawUntil = Date.parse(untilIso);
  if (!Number.isFinite(rawSince) || !Number.isFinite(rawUntil)) {
    throw new Error("resolveCustomWindow: invalid ISO bounds");
  }
  const lo = Math.min(rawSince, rawUntil);
  const hi = Math.max(rawSince, rawUntil);

  const firstDayStart = utcDayStart(lo);
  const lastDayStart = utcDayStart(hi);
  const days = Math.round((lastDayStart - firstDayStart) / DAY_MS) + 1;
  const touchesOpenDay = lastDayStart >= utcDayStart(nowMs);

  const notes: WindowNote[] = ["ga4_property_timezone"];
  notes.push(touchesOpenDay ? "ga4_open_day" : "excludes_open_day");

  return {
    presetId: "custom",
    sinceIso: new Date(firstDayStart).toISOString(),
    untilIso: new Date(lastDayStart + DAY_MS - 1).toISOString(),
    days,
    grain: "day",
    crossStreamSafe: !touchesOpenDay,
    ga4: ga4RangeFromInstants(firstDayStart, lastDayStart),
    rpcDays: days,
    notes,
  };
}

/**
 * Okno poprzednie: ta sama długość, ROZŁĄCZNE z bieżącym.
 *
 * To jest naprawa podwójnego liczenia dnia granicznego: przy `[28daysAgo, today]`
 * i `[56daysAgo, 28daysAgo]` dzień „28 dni temu” wpadał do obu przedziałów, więc
 * baza porównawcza rosła o jeden dzień i każda delta % była zaniżona. Tutaj okno
 * poprzednie kończy się DOKŁADNIE dzień (a instantowo: milisekundę) przed
 * początkiem bieżącego.
 */
export function previousWindow(current: CanonicalWindow): CanonicalWindow {
  const sinceMs = Date.parse(current.sinceIso);
  const untilMs = Date.parse(current.untilIso);
  // Okno dobowe jest domknięte na 23:59:59.999, więc jego długość to (U - S + 1).
  // Okno kroczące ma granice będące dokładnymi instantami, więc długość to (U - S).
  const spanMs = current.grain === "instant" ? untilMs - sinceMs : untilMs - sinceMs + 1;

  // Górna granica okna poprzedniego to milisekunda przed dolną granicą bieżącego:
  // rozłączność jest ważniejsza niż zachowanie długości co do milisekundy.
  const prevUntilMs = sinceMs - 1;
  const prevSinceMs = sinceMs - spanMs;

  if (current.grain === "instant") {
    return {
      ...current,
      sinceIso: new Date(prevSinceMs).toISOString(),
      untilIso: new Date(prevUntilMs).toISOString(),
      ga4: ga4RangeFromInstants(prevSinceMs, prevUntilMs),
    };
  }

  // Dobowo: poprzednie okno kończy się dzień przed pierwszym dniem bieżącego.
  const prevLastDayStart = utcDayStart(sinceMs) - DAY_MS;
  const prevFirstDayStart = prevLastDayStart - (current.days - 1) * DAY_MS;
  return {
    ...current,
    sinceIso: new Date(prevFirstDayStart).toISOString(),
    untilIso: new Date(prevLastDayStart + DAY_MS - 1).toISOString(),
    // Okno poprzednie jest zawsze domknięte, więc dzień otwarty go nie dotyczy.
    crossStreamSafe: true,
    ga4: ga4RangeFromInstants(prevFirstDayStart, prevLastDayStart),
    notes: current.notes.filter((n) => n !== "ga4_open_day"),
  };
}

/** Czy dwa okna mają wspólny choćby milisekundę - detektor podwójnego liczenia. */
export function windowsOverlap(a: CanonicalWindow, b: CanonicalWindow): boolean {
  const aLo = Date.parse(a.sinceIso);
  const aHi = Date.parse(a.untilIso);
  const bLo = Date.parse(b.sinceIso);
  const bHi = Date.parse(b.untilIso);
  return aLo <= bHi && bLo <= aHi;
}

/**
 * Okno dla starszych RPC przyjmujących `_since_days` (np. `related_posts_signals`).
 * Ich przedział ZAWSZE kończy się w `now()`, więc dla okna pomijającego dzień
 * bieżący nie da się go odtworzyć dokładnie - zwracamy liczbę dni i dokładamy
 * notę, żeby rozjazd był widoczny, a nie domyślny.
 */
export function legacyRpcWindow(current: CanonicalWindow): {
  days: number;
  notes: readonly WindowNote[];
} {
  const nowAligned = current.notes.includes("ga4_open_day");
  return {
    days: current.rpcDays,
    notes: nowAligned ? current.notes : [...current.notes, "legacy_rpc_window_ends_now"],
  };
}
