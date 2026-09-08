// KANONICZNY ZEGAR TESTOWY. Jedno źródło „teraz" dla całego repozytorium.
//
// PO CO TO ISTNIEJE. Test, który niesie literał kalendarzowy (`"2026-08-30"`)
// i jednocześnie dotyka produkcji czytającej PRAWDZIWY zegar, nie jest
// deterministyczny - jest opóźniony. Odległość literału od „teraz" rośnie z
// każdą dobą i w pewnym momencie przekracza okno, które produkcja liczy z
// `Date.now()`. Test, który przechodził rok, pada w środę o dziesiątej, a diff
// tego dnia jest pusty. Zmierzone na tym repozytorium: plik darowizn trzymał
// dwanaście takich zapalników na JEDNEJ domyślnej dacie fabryki wierszy.
//
// Lekarstwem NIE jest przesunięcie literału „na później" - to przestawia
// zapalnik, nie rozbraja go. Lekarstwem jest odwrócenie zależności: to test
// ustala, która jest godzina, a daty fixture'ów liczy się WZGLĘDEM tej
// godziny. Wtedy odległość „fixture - teraz" jest stała i przebieg za pięć lat
// jest bit w bit tym samym przebiegiem, co dzisiaj.
//
// Bramka `check:clock-freeze` pilnuje, żeby nowych takich plików nie
// przybywało; ten moduł jest drugą połową tej pary - daje wzorzec, do którego
// bramka odsyła.
import { afterEach, beforeEach, vi } from "vitest";

export const SEKUNDA = 1_000;
export const MINUTA = 60 * SEKUNDA;
export const GODZINA = 60 * MINUTA;
export const DZIEN = 24 * GODZINA;
export const TYDZIEN = 7 * DZIEN;

/**
 * Kanoniczne „teraz" testów: 15 czerwca 2099, południe UTC.
 *
 * DLACZEGO W PRZYSZŁOŚCI, a nie „dziś" albo „ostatni okrągły poniedziałek".
 * Data w przyszłości daje własność FAIL-FAST, której data z przeszłości dać nie
 * może. Jeżeli ktoś wyprowadzi fixture z `FIXED_NOW`, ale ZAPOMNI zamrozić
 * zegar, to przy dacie z przeszłości nic się nie stanie - test przejdzie i
 * zacznie gnić po cichu, dokładnie tak jak gniły te, które to repozytorium
 * właśnie rozbraja. Przy 2099 taki plik pada NATYCHMIAST i głośno, bo fixture
 * leży 73 lata od prawdziwego „teraz": pomyłka wychodzi w tym samym PR-ze, w
 * którym ją popełniono, a nie za siedem miesięcy.
 *
 * DLACZEGO POŁUDNIE, 15. DZIEŃ, ŚRODEK ROKU. Południe UTC leży daleko od każdej
 * granicy doby w każdej strefie czasowej, więc test formatujący datę lokalnie
 * nie przeskakuje o dzień w zależności od `TZ` maszyny. 15. dzień miesiąca
 * przeżywa odejmowanie dwóch tygodni bez zmiany miesiąca, a czerwiec - bez
 * zmiany roku i bez wpadania w przesunięcia czasu letniego (2099 nie jest też
 * rokiem przestępnym, więc arytmetyka na dobach nie ma wyjątku).
 *
 * DLACZEGO NIE `Date.now()`. `vi.setSystemTime(Date.now())` NIE zamraża niczego
 * wobec bomby kalendarzowej: kotwiczy zegar na „teraz w chwili przebiegu", więc
 * odległość do literału nadal rośnie z każdą dobą. To jest antywzorzec i
 * bramka `check:clock-freeze` trzyma na nim twarde zero.
 */
export const FIXED_NOW_ISO = "2099-06-15T12:00:00.000Z";
export const FIXED_NOW = new Date(FIXED_NOW_ISO);
export const FIXED_NOW_MS = FIXED_NOW.getTime();

/** Wszystko, co da się podać jako chwila: `Date`, ISO albo milisekundy. */
export type Chwila = Date | string | number;

function msOf(at: Chwila): number {
  const ms = at instanceof Date ? at.getTime() : typeof at === "number" ? at : Date.parse(at);
  if (Number.isNaN(ms)) throw new Error(`freezeClock: nieczytelna chwila "${String(at)}"`);
  return ms;
}

export interface FreezeClockOptions {
  /**
   * Zamrozić także `setTimeout`/`setInterval`/`queueMicrotask`? DOMYŚLNIE NIE.
   *
   * Rozbrojenie bomby zegarowej wymaga wyłącznie stałego `Date` - i tylko tyle
   * ten helper domyślnie robi (`toFake: ["Date"]`). Zamrożenie licznika czasu
   * to osobna, DUŻO bardziej inwazyjna decyzja: `vi.useFakeTimers()` w pełnym
   * zakresie zatrzymuje też `setTimeout`, na którym stoją `waitFor` z
   * @testing-library i wszystkie debounce'y - test przestaje wtedy czekać na
   * cokolwiek i wisi do timeoutu. Kto naprawdę steruje upływem czasu (jak
   * `jobsTickRun` czy `-community-cron`), włącza to jawnie i bierze
   * odpowiedzialność za popychanie zegara.
   */
  timers?: boolean;
}

/**
 * Zamraża zegar NA CAŁY PLIK testowy. Wołać RAZ, na poziomie modułu (albo na
 * początku `describe`), a nie w pojedynczym teście:
 *
 *   import { DZIEN, freezeClock, relativeIso } from "@/test/time";
 *   freezeClock();
 *   // ...
 *   created_at: relativeIso(-2 * DZIEN)
 *
 * Sam rejestruje `beforeEach`/`afterEach`, więc „porządkuje po sobie": każdy
 * test dostaje zegar ustawiony na tę samą chwilę, a po teście wraca zegar
 * prawdziwy. Rejestracja na poziomie modułu ustawia go PRZED hookami pliku,
 * więc fabryki fixture'ów wołane w `beforeEach` widzą już zamrożony czas.
 *
 * Zamrożenie NALEŻY DO PLIKU TESTOWEGO. Nie wolno go wpinać w
 * `vitest.config.ts` ani w globalny setup: zamrożony zegar procesu wywraca
 * testy mierzące czas trwania (`Date.now() - startedAt`), a tych jest w tym
 * repozytorium kilkadziesiąt.
 */
export function freezeClock(at: Chwila = FIXED_NOW, options: FreezeClockOptions = {}): void {
  const when = msOf(at);
  const toFake: ("Date" | "setTimeout" | "setInterval" | "clearTimeout" | "clearInterval")[] =
    options.timers
      ? ["Date", "setTimeout", "setInterval", "clearTimeout", "clearInterval"]
      : ["Date"];

  beforeEach(() => {
    vi.useFakeTimers({ toFake });
    vi.setSystemTime(when);
  });

  afterEach(() => {
    vi.useRealTimers();
  });
}

/**
 * Data względem zamrożonego „teraz", jako `Date`. Ujemny offset to przeszłość.
 *
 *   relativeDate(-2 * DZIEN)   // dwa dni temu
 *   relativeDate(30 * MINUTA)  // za pół godziny
 *
 * Bazę podaje się jawnie tylko wtedy, gdy plik zamroził zegar na czymś innym
 * niż `FIXED_NOW`.
 */
export function relativeDate(offsetMs: number, base: Chwila = FIXED_NOW): Date {
  return new Date(msOf(base) + offsetMs);
}

/** To samo, ale w ISO - do fixture'ów, które trzymają daty jako tekst. */
export function relativeIso(offsetMs: number, base: Chwila = FIXED_NOW): string {
  return relativeDate(offsetMs, base).toISOString();
}

/**
 * Popycha ZAMROŻONY zegar o `ms` do przodu, nie uruchamiając przy tym timerów.
 *
 * Zastępuje wzorzec `vi.setSystemTime(Date.now() + ms)`, który wygląda
 * niewinnie, ale czyta `Date.now()` w miejscu, gdzie czytelnik nie widzi, czy
 * pod spodem jest zegar prawdziwy, czy fałszywy - a od tego zależy, czy plik
 * jest bombą. Tutaj odczyt jest jeden, w jednym miejscu, obok zamrożenia.
 *
 * To NIE jest `vi.advanceTimersByTime`: tamto DODATKOWO odpala zaplanowane
 * `setTimeout`-y. Jeśli test chce jednego i drugiego, ma zawołać oba jawnie.
 */
export function advanceClock(ms: number): void {
  vi.setSystemTime(new Date(Date.now() + ms));
}
