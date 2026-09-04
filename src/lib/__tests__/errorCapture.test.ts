// PRZECHWYTNIA BŁĘDÓW SSR (`src/lib/error-capture.ts`) - połowa ZAPISUJĄCA.
//
// PO CO TEN PLIK ISTNIEJE. Moduł istnieje wyłącznie dlatego, że h3 połyka
// wyjątek renderu SSR i zwraca generyczną `Response` 500 z ciałem
// `{"unhandled":true,"message":"HTTPError"}`. Normalizator w `src/server.ts`
// dostaje więc już tylko tę wyplutą odpowiedź - bez `stack`, bez klasy
// wyjątku, bez komunikatu. `error-capture.ts` jest jedynym miejscem, w którym
// oryginalny obiekt błędu da się jeszcze zobaczyć: nasłuchy globalne łapią go
// out-of-band, a `server.ts:97` konsumuje go przy składaniu logu.
//
// Do 04.09.2026 pokryta była wyłącznie połowa ODCZYTUJĄCA
// (`consumeLastCapturedError`, wykonywana ubocznie przez
// `src/__tests__/serverEntryRequestOptions.test.ts`, który importuje
// `../server`): 6/17 linii, 1/4 funkcji, 2/11 gałęzi. Niepokryte było
// dokładnie to, co ZAPISUJE - `record` i oba nasłuchy. Czyli: strona pada,
// a w logu zostaje napis "HTTPError" i nic więcej. Regresja w tej połowie
// (odwrócony `??`, zgubiony nasłuch `unhandledrejection`, wywalona
// rejestracja) przechodziła CI na zielono i była niewidoczna do pierwszej
// prawdziwej awarii produkcyjnej.
//
// REALNA TRUDNOŚĆ TEGO PLIKU - I JAK JEST ROZWIĄZANA. Moduł rejestruje
// nasłuchy PRZY IMPORCIE (efekt uboczny na poziomie modułu) i trzyma jedyny
// przechwycony błąd w zmiennej modułowej `lastCapturedError`, którą `consume`
// CZYŚCI. Jeden import na plik testowy dałby więc stan wspólny dla wszystkich
// przypadków i kolejność testów zaczęłaby decydować o wyniku: test czytający
// po innym teście dostawałby `undefined`, a test dispatchujący zdarzenie
// zapisywałby je do stanu widzianego przez sąsiada. Dlatego KAŻDY przypadek
// bierze WŁASNĄ instancję modułu przez `vi.resetModules()` +
// `await import(...)` (helper `importFreshCapture`). Skutek uboczny jest
// świadomy: kolejne instancje dokładają kolejne nasłuchy do tego samego
// `globalThis`, więc jedno `dispatchEvent` trafia też do nasłuchów instancji
// z poprzednich testów - ale każda z nich zapisuje do SWOJEJ zmiennej
// modułowej, a asercja czyta wyłącznie przez `consume` instancji bieżącej.
// Testy są więc niezależne od kolejności.
//
// Zero sieci, zero sekretów, zero atrap wokół modułu, który jest przedmiotem
// dowodu - podmieniany jest wyłącznie `globalThis.addEventListener` w dwóch
// przypadkach dowodzących odporności na runtime bez nasłuchów.
import { afterEach, describe, expect, it, vi } from "vitest";

/** `TTL_MS` z modułu (nie jest eksportowany, więc powtórzony tu jawnie). */
const TTL_MS = 5_000;

/**
 * Świeża instancja modułu - patrz nagłówek. Bez tego stan modułowy
 * (`lastCapturedError`) przenosiłby się między przypadkami.
 */
async function importFreshCapture() {
  vi.resetModules();
  return await import("../error-capture");
}

/**
 * Zdarzenie `unhandledrejection` bez `PromiseRejectionEvent`: happy-dom NIE
 * implementuje tego konstruktora (zmierzone - `typeof
 * globalThis.PromiseRejectionEvent === "undefined"`), a kod produkcyjny czyta
 * ze zdarzenia wyłącznie pole `reason`. Doklejamy je więc do gołego `Event`
 * przez `defineProperty` - bez `as any`, którego to repozytorium nie dopuszcza.
 */
function rejectionEvent(reason: unknown): Event {
  const event = new Event("unhandledrejection");
  Object.defineProperty(event, "reason", { value: reason, configurable: true });
  return event;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("error-capture: nasłuch `error`", () => {
  it("zapisuje OBIEKT błędu z ErrorEvent.error, a `consume` zwraca dokładnie ten obiekt", async () => {
    // TO JEST GŁÓWNY POWÓD ISTNIENIA MODUŁU: przedmiotem dowodu jest
    // TOŻSAMOŚĆ (`toBe`), nie sam fakt niepustości. Gdyby przechwytnia
    // zapisywała np. `String(error)` albo `event`, log dalej dostawałby napis
    // bez `stack` - czyli dokładnie to, przed czym ten moduł ma chronić.
    const capture = await importFreshCapture();
    const boom = new TypeError("Cannot read properties of undefined (reading 'slug')");

    globalThis.dispatchEvent(new ErrorEvent("error", { error: boom }));

    const captured = capture.consumeLastCapturedError();
    expect(captured).toBe(boom);
    expect(captured).toBeInstanceOf(TypeError);
    expect((captured as Error).stack).toBeTruthy();
  });

  it("bez `error` spada na `message` - pierwsze ogniwo łańcucha `??`", async () => {
    // Runtime'y, które nie dowożą obiektu błędu (starsze Workers, część
    // przypadków `window.onerror`), dają tylko komunikat. Pusty log jest tu
    // gorszy od samego napisu, dlatego `?? message` NIE jest ozdobą.
    // UWAGA POMIAROWA: happy-dom ustawia `ErrorEvent.error` na `null`, nie
    // `undefined` - `??` łapie oba, więc gałąź jest wykonywana tak samo jak
    // w przeglądarce.
    const capture = await importFreshCapture();

    globalThis.dispatchEvent(new ErrorEvent("error", { message: "HTTPError: 500" }));

    expect(capture.consumeLastCapturedError()).toBe("HTTPError: 500");
  });

  it("bez `error` i bez `message` zapisuje samo zdarzenie - ostatnie ogniwo `??`", async () => {
    // Goły `Event("error")` (bez pól `ErrorEvent`) to najgorszy przypadek:
    // nie ma czego zalogować poza samym zdarzeniem. Kontrakt mówi, że wtedy
    // przechwytnia zapisuje zdarzenie, a nie `undefined` - bo `undefined`
    // jest w `server.ts` nieodróżnialne od "nic nie przechwycono" i log
    // straciłby informację, że wyjątek W OGÓLE był.
    const capture = await importFreshCapture();
    const bare = new Event("error");

    globalThis.dispatchEvent(bare);

    expect(capture.consumeLastCapturedError()).toBe(bare);
  });
});

describe("error-capture: nasłuch `unhandledrejection`", () => {
  it("zapisuje `reason` odrzuconej obietnicy", async () => {
    // Odrzucona obietnica jest w SSR częstsza niż wyjątek synchroniczny
    // (każdy nieobsłużony `await` na zapytaniu do bazy), a h3 pakuje ją
    // w tę samą generyczną 500. Bez tego nasłuchu połowa realnych awarii
    // nie zostawiałaby żadnego śladu.
    const capture = await importFreshCapture();
    const rejected = new Error("supabase: connection reset");

    globalThis.dispatchEvent(rejectionEvent(rejected));

    expect(capture.consumeLastCapturedError()).toBe(rejected);
  });

  it("bez `reason` zapisuje samo zdarzenie - gałąź `?? event`", async () => {
    const capture = await importFreshCapture();
    // Goły `Event`, bez doklejonego `reason` - dokładnie to, co dostajemy
    // z runtime'u, który zgłasza odrzucenie, ale nie dowozi powodu.
    const bare = new Event("unhandledrejection");

    globalThis.dispatchEvent(bare);

    expect(capture.consumeLastCapturedError()).toBe(bare);
  });
});

describe("error-capture: cykl życia stanu", () => {
  it("`consume` jest JEDNORAZOWE - drugie wywołanie zwraca `undefined`", async () => {
    // Jednorazowość jest wymogiem POPRAWNOŚCI, nie oszczędnością. Ten sam
    // izolat Workera obsługuje wiele żądań po kolei; błąd, który już trafił
    // do logu żądania A, nie może zostać doklejony do logu żądania B jako
    // jego przyczyna. Diagnostyka wskazywałaby wtedy nie ten request.
    const capture = await importFreshCapture();
    const boom = new Error("render failed");

    globalThis.dispatchEvent(new ErrorEvent("error", { error: boom }));

    expect(capture.consumeLastCapturedError()).toBe(boom);
    expect(capture.consumeLastCapturedError()).toBeUndefined();
  });

  it("bez żadnego przechwycenia `consume` zwraca `undefined`", async () => {
    const capture = await importFreshCapture();
    expect(capture.consumeLastCapturedError()).toBeUndefined();
  });

  it("TUŻ PRZED granicą TTL błąd jest jeszcze wydawany (dokładnie `TTL_MS`)", async () => {
    // Granica jest ostra (`> TTL_MS`, nie `>=`). Test stoi na niej celowo:
    // przesunięcie porównania o jeden oczko w tę stronę gubiłoby ślady
    // przy każdym wolniejszym renderze SSR - a te są właśnie tymi, które
    // padają najczęściej.
    const capture = await importFreshCapture();
    vi.useFakeTimers();
    const boom = new Error("slow render blew up");

    globalThis.dispatchEvent(new ErrorEvent("error", { error: boom }));
    vi.advanceTimersByTime(TTL_MS);

    expect(capture.consumeLastCapturedError()).toBe(boom);
  });

  it("PO TTL `consume` zwraca `undefined` I CZYŚCI stan - zabezpieczenie PRYWATNOŚCIOWE", async () => {
    // TO NIE JEST OPTYMALIZACJA PAMIĘCI. Izolat Workera żyje dłużej niż jedno
    // żądanie i obsługuje żądania RÓŻNYCH użytkowników. Bez wygaśnięcia błąd
    // przechwycony przy żądaniu użytkownika A (a `stack` i `message` niosą
    // dane wrażliwe: identyfikatory, fragmenty zapytań, e-maile w argumentach)
    // zostałby wydany normalizatorowi obsługującemu żądanie użytkownika B
    // i wylądował w JEGO logu. Krótkie TTL jest granicą korelacji między
    // NIEPOWIĄZANYMI żądaniami - komentarz :4-5 w module mówi o tym wprost.
    const capture = await importFreshCapture();
    vi.useFakeTimers();

    globalThis.dispatchEvent(new ErrorEvent("error", { error: new Error("stale secret-ish") }));
    const recordedAt = Date.now();
    vi.advanceTimersByTime(TTL_MS + 1);

    expect(capture.consumeLastCapturedError()).toBeUndefined();

    // DOWÓD CZYSZCZENIA, nie samego wygaśnięcia. Cofamy zegar dokładnie na
    // moment zapisu: gdyby przeterminowany wpis został w zmiennej modułowej,
    // różnica `Date.now() - at` znów wyniosłaby zero i przechwytnia wydałaby
    // ten sam obiekt - czyli wyciek przetrwałby wygaśnięcie i wystarczyłby
    // jeden skok zegara (albo drugie żądanie w tej samej milisekundzie), żeby
    // go odzyskać.
    vi.setSystemTime(recordedAt);
    expect(capture.consumeLastCapturedError()).toBeUndefined();
  });
});

describe("error-capture: runtime bez nasłuchów globalnych", () => {
  it("brak `globalThis.addEventListener` NIE wywraca importu i nie rejestruje nasłuchów", async () => {
    // Moduł jest importowany BEZWARUNKOWO przez `src/server.ts:21`, więc
    // wyjątek przy jego wczytaniu położyłby CAŁY serwer - każdą trasę, nie
    // tylko diagnostykę. Straż `typeof ... === "function"` kupuje dokładnie
    // to: w runtime bez nasłuchów globalnych aplikacja startuje, a
    // normalizator w `server.ts` loguje samą `Response` (degradacja
    // diagnostyki, nie awaria serwisu).
    vi.stubGlobal("addEventListener", undefined);

    const capture = await importFreshCapture();

    expect(typeof capture.consumeLastCapturedError).toBe("function");
    expect(capture.consumeLastCapturedError()).toBeUndefined();

    // Nasłuch NIE został podpięty, więc zdarzenie nie ma czego zapisać. Uwaga:
    // instancje modułu z poprzednich testów wciąż mają swoje nasłuchy na tym
    // `globalThis` i one zdarzenie zobaczą - ale zapiszą je do SWOICH zmiennych
    // modułowych, których ta asercja nie czyta (patrz nagłówek pliku).
    vi.unstubAllGlobals();
    globalThis.dispatchEvent(new ErrorEvent("error", { error: new Error("nobody listens") }));

    expect(capture.consumeLastCapturedError()).toBeUndefined();
  });

  it("`addEventListener`, który RZUCA, jest połknięty przez `catch` - import nadal się udaje", async () => {
    // Osobna gałąź od powyższej: tu metoda ISTNIEJE (straż `typeof` przepuszcza),
    // ale wywołanie wybucha - tak zachowują się runtime'y, które udają API
    // przeglądarki tylko częściowo. Bez `catch` byłby to wyjątek na poziomie
    // modułu, czyli znowu położony cały `src/server.ts`.
    const calls: string[] = [];
    vi.stubGlobal("addEventListener", (type: string) => {
      calls.push(type);
      throw new Error("listeners not supported in this runtime");
    });

    const capture = await importFreshCapture();

    // Rejestracja została PODJĘTA (więc gałąź `typeof` poszła w `true`)
    // i przerwana na PIERWSZYM nasłuchu - drugiego już nie próbowano.
    expect(calls).toEqual(["error"]);
    expect(capture.consumeLastCapturedError()).toBeUndefined();
  });
});
