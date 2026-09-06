// Odzyskiwanie po deployu: chunk-load error i wykrycie nowego builda.
//
// CO TO DOWODZI. Ten moduł jest jedyną obroną przed pustą stroną po deployu:
// przeglądarka trzyma stary `index.html`, dynamiczny `import()` celuje w chunk,
// którego już nie ma, i czytelnik dostaje biały ekran albo error boundary.
// Miał 0% pokrycia, a jego dwie ścieżki mają PRZECIWNE koszty pomyłki:
//   * za mało reloadów -> biały ekran po każdym deployu;
//   * za dużo reloadów -> PĘTLA przeładowań, czyli strona nie do użycia.
// Strażnik w `sessionStorage` jest tu jedyną rzeczą, która oddziela jedno od
// drugiego - i to jego przede wszystkim sprawdzają asercje niżej.
//
// USTALENIE, KTÓRE ZMIENIA ZAKRES TESTU. Zadanie opisywało ten plik jako
// „czystą funkcję: ta sama wersja daje ten sam odcisk, zmiana zasobu zmienia
// odcisk, brak manifestu nie wywala buildu". W pliku NIE MA ani manifestu, ani
// odcisku - jest globalny listener błędów, sondowanie `/api/public/version`
// i twardy reload z `?_v=<ts>`. Testujemy więc to, co plik robi.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Nie sprawdzamy `/api/public/version` (własna
// trasa) ani `router.invalidate()` (kontrakt frameworka) - tylko DECYZJĘ, czy
// je wołać. Gałąź `typeof window === "undefined"` (SSR) nie jest osiągalna
// w środowisku jsdom; jej rolę opisuje komentarz w kodzie.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startCacheBusting, type SoftRefreshable } from "../cacheBusting";

/** Router w kształcie, którego ten moduł faktycznie używa - bez rzutowań. */
function fakeRouter() {
  // Sygnatura podana jawnie: `vi.fn()` bez niej jest typowane jako wywoływalne
  // ORAZ konstruowalne, co nie spełnia `SoftRefreshable.invalidate`.
  const invalidate = vi.fn<() => void>();
  const router: SoftRefreshable = { invalidate };
  return { ...router, invalidate };
}

const START_URL = "https://przyklad.test/analizy";

let replace: ReturnType<typeof vi.fn>;
let stop: () => void;
let originalLocation: PropertyDescriptor | undefined;

/** Adresy, na które moduł kazał przeładować stronę. */
function reloadedTo(): string[] {
  return replace.mock.calls.map((call) => String(call[0]));
}

beforeEach(() => {
  vi.useFakeTimers();
  // Data bazowa ustalona: strażnik reloadu porównuje znaczniki czasu, więc
  // `Date.now()` musi być sterowalny, a nie „teraz".
  vi.setSystemTime(new Date("2026-08-21T10:00:00.000Z"));
  replace = vi.fn();
  originalLocation = Object.getOwnPropertyDescriptor(window, "location");
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { href: START_URL, replace },
  });
  sessionStorage.clear();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  stop = () => undefined;
});

afterEach(() => {
  // Moduł ma flagę „już wystartowałem"; sprzątaczka ją zeruje, więc bez tego
  // drugi test w pliku dostawałby no-op zamiast działającego modułu.
  stop();
  if (originalLocation) Object.defineProperty(window, "location", originalLocation);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("chunk-load error -> twardy reload", () => {
  const CHUNK_MESSAGES = [
    "ChunkLoadError: Loading chunk 42 failed",
    "Loading chunk vendor-abc failed",
    "Failed to fetch dynamically imported module: /assets/x.js",
    "Importing a module script failed",
    "error loading dynamically imported module",
  ] as const;

  it.each(CHUNK_MESSAGES)("rozpoznaje komunikat: %s", (message) => {
    stop = startCacheBusting(fakeRouter());
    window.dispatchEvent(new ErrorEvent("error", { error: new Error(message) }));
    expect(reloadedTo()).toHaveLength(1);
  });

  it("dokłada do adresu parametr `_v`, żeby ominąć cache przeglądarki", () => {
    stop = startCacheBusting(fakeRouter());
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("ChunkLoadError") }));
    const url = new URL(reloadedTo()[0]);
    expect(url.searchParams.get("_v")).toBeTruthy();
    expect(url.pathname).toBe("/analizy");
  });

  it("czyta też `event.message`, gdy zdarzenie nie niesie obiektu błędu", () => {
    stop = startCacheBusting(fakeRouter());
    window.dispatchEvent(new ErrorEvent("error", { message: "ChunkLoadError: boom" }));
    expect(reloadedTo()).toHaveLength(1);
  });

  it("rozpoznaje odrzuconą obietnicę, gdy powodem jest obiekt Error", () => {
    stop = startCacheBusting(fakeRouter());
    const event = new Event("unhandledrejection");
    Object.defineProperty(event, "reason", {
      value: new Error("Failed to fetch dynamically imported module"),
    });
    window.dispatchEvent(event);
    expect(reloadedTo()).toHaveLength(1);
  });

  it("rozpoznaje odrzuconą obietnicę, gdy powodem jest tekst", () => {
    stop = startCacheBusting(fakeRouter());
    const event = new Event("unhandledrejection");
    Object.defineProperty(event, "reason", { value: "ChunkLoadError: boom" });
    window.dispatchEvent(event);
    expect(reloadedTo()).toHaveLength(1);
  });

  // DEFEKT ZGŁOSZONY, NIE NAPRAWIONY. `looksLikeChunkLoadError`
  // (src/lib/cacheBusting.ts:31-45) ma trzy sposoby wyciągnięcia komunikatu:
  // `err instanceof Error && err.message`, `typeof err === "string"`, oraz
  // `err.reason?.message`. Trzeci NIE JEST OSIĄGALNY z uchwytu odrzuconych
  // obietnic (linia 108), bo ten podaje już `event.reason` - żeby gałąź
  // zadziałała, powód musiałby mieć `powód.reason.message`, czyli być
  // zdarzeniem w zdarzeniu. Wygląda na pozostałość po wersji, która
  // przekazywała całe zdarzenie.
  //
  // KONSEKWENCJA: powód, który NIE JEST instancją `Error` ani tekstem, a ma
  // `message` - czyli zwykły obiekt błędu - nie zostaje rozpoznany i czytelnik
  // zostaje na białym ekranie. To realny kształt: `Error` z innego realmu
  // (iframe, worker) oblewa `instanceof`, a część błędów ładowania modułów
  // dociera jako zwykły obiekt.
  //
  // Naprawa to zmiana zachowania produkcyjnego (poszerzenie rozpoznawania
  // reloadu, a więc ryzyko pętli przeładowań) - decyzja dla człowieka.
  it("powód odrzucenia z samym `message` (nie Error) jest rozpoznawany", () => {
    stop = startCacheBusting(fakeRouter());
    const event = new Event("unhandledrejection");
    Object.defineProperty(event, "reason", {
      value: { message: "Failed to fetch dynamically imported module" },
    });
    window.dispatchEvent(event);
    expect(reloadedTo()).toHaveLength(1);
  });

  it("NIE przeładowuje na zwykłym błędzie aplikacji", () => {
    // To jest droższa połowa kontraktu: reload na każdym błędzie zamieniłby
    // pojedynczy wyjątek w pętlę przeładowań.
    stop = startCacheBusting(fakeRouter());
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("Cannot read x of null") }));
    window.dispatchEvent(new ErrorEvent("error", { message: "" }));
    const empty = new Event("unhandledrejection");
    Object.defineProperty(empty, "reason", { value: null });
    window.dispatchEvent(empty);
    expect(reloadedTo()).toEqual([]);
  });

  it("przeładowuje RAZ - drugi błąd w okienku strażnika nic nie robi", () => {
    // Bez tego strażnika błąd, który NIE wynika ze starego bundla, dawałby
    // nieskończoną pętlę reloadów.
    stop = startCacheBusting(fakeRouter());
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("ChunkLoadError") }));
    vi.advanceTimersByTime(14_000);
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("ChunkLoadError") }));
    expect(reloadedTo()).toHaveLength(1);
  });

  it("po wygaśnięciu okienka strażnika przeładowuje ponownie", () => {
    // Kolejny deploy po kwadransie to nowa sytuacja, nie ta sama pętla.
    stop = startCacheBusting(fakeRouter());
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("ChunkLoadError") }));
    vi.advanceTimersByTime(15_001);
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("ChunkLoadError") }));
    expect(reloadedTo()).toHaveLength(2);
  });

  it("zablokowany `sessionStorage` nie blokuje odzyskania strony", () => {
    // Tryb prywatny odbiera magazyn; wtedy lepiej przeładować bez strażnika
    // niż zostawić czytelnika z białym ekranem.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("odmowa dostępu");
    });
    stop = startCacheBusting(fakeRouter());
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("ChunkLoadError") }));
    expect(reloadedTo()).toHaveLength(1);
  });

  it("uszkodzony znacznik strażnika jest traktowany jak brak znacznika", () => {
    sessionStorage.setItem("__lov_cb_reload", "nie-liczba");
    stop = startCacheBusting(fakeRouter());
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("ChunkLoadError") }));
    expect(reloadedTo()).toHaveLength(1);
  });
});

describe("nowy build -> MIĘKKIE odświeżenie", () => {
  function respondVersions(...versions: Array<string | null | number>): void {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        const v = versions[Math.min(call++, versions.length - 1)];
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ v }) });
      }),
    );
  }

  /** Przewija do pierwszego sondowania i pozwala dobiec obietnicom. */
  async function firstProbe(): Promise<void> {
    await vi.advanceTimersByTimeAsync(8_000);
  }

  it("pierwsze sondowanie tylko zapamiętuje wersję - bez odświeżania", async () => {
    // Inaczej KAŻDE wejście na stronę kończyłoby się unieważnieniem cache.
    respondVersions("build-1");
    const router = fakeRouter();
    stop = startCacheBusting(router);
    await firstProbe();
    expect(router.invalidate).not.toHaveBeenCalled();
  });

  it("zmiana wersji odświeża dane w tle, nie przeładowuje strony", async () => {
    // Twardy reload zostaje wyłącznie dla chunk-load errors - w podglądzie
    // BUILD_ID zmienia się per-isolate, więc reload mrugałby po każdej nawigacji.
    respondVersions("build-1", "build-2");
    const router = fakeRouter();
    stop = startCacheBusting(router);
    await firstProbe();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(router.invalidate).toHaveBeenCalledTimes(1);
    expect(reloadedTo()).toEqual([]);
  });

  it("ta sama wersja nie odświeża nic", async () => {
    respondVersions("build-1", "build-1", "build-1");
    const router = fakeRouter();
    stop = startCacheBusting(router);
    await firstProbe();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(router.invalidate).not.toHaveBeenCalled();
  });

  it("powrót do zakładki wywołuje sondowanie poza harmonogramem", async () => {
    respondVersions("build-1", "build-2");
    const router = fakeRouter();
    stop = startCacheBusting(router);
    await firstProbe();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(router.invalidate).toHaveBeenCalledTimes(1);
  });

  it("zakładka schowana nie sonduje", async () => {
    respondVersions("build-1", "build-2");
    const router = fakeRouter();
    stop = startCacheBusting(router);
    await firstProbe();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(router.invalidate).not.toHaveBeenCalled();
  });

  it.each([
    { nazwa: "odpowiedź nie-ok", odpowiedz: { ok: false, json: () => Promise.resolve({}) } },
    {
      nazwa: "wersja nie jest tekstem",
      odpowiedz: { ok: true, json: () => Promise.resolve({ v: 7 }) },
    },
    { nazwa: "brak pola wersji", odpowiedz: { ok: true, json: () => Promise.resolve({}) } },
  ])("$nazwa nie ustawia punktu odniesienia ani nie odświeża", async ({ odpowiedz }) => {
    // Awaria sondy nie może wyglądać jak nowy build - to by unieważniało cache
    // przy każdej usterce sieci.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(odpowiedz)),
    );
    const router = fakeRouter();
    stop = startCacheBusting(router);
    await firstProbe();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(router.invalidate).not.toHaveBeenCalled();
  });

  it("odrzucony fetch nie wywala modułu", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    const router = fakeRouter();
    stop = startCacheBusting(router);
    await firstProbe();
    expect(router.invalidate).not.toHaveBeenCalled();
  });
});

describe("cykl życia", () => {
  it("drugie uruchomienie jest no-opem - listenery nie mnożą się", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false, json: () => ({}) })),
    );
    stop = startCacheBusting(fakeRouter());
    const second = startCacheBusting(fakeRouter());
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("ChunkLoadError") }));
    // Dwa zestawy listenerów oznaczałyby dwa reloady na jeden błąd.
    expect(reloadedTo()).toHaveLength(1);
    second();
  });

  it("sprzątaczka odpina listenery i zatrzymuje sondowanie", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ v: "b" }) }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const cleanup = startCacheBusting(fakeRouter());
    cleanup();
    stop = () => undefined;
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("ChunkLoadError") }));
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(reloadedTo()).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("po sprzątnięciu moduł da się uruchomić ponownie", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false, json: () => ({}) })),
    );
    startCacheBusting(fakeRouter())();
    stop = startCacheBusting(fakeRouter());
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("ChunkLoadError") }));
    expect(reloadedTo()).toHaveLength(1);
  });
});
