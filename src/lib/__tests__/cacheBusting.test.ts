// Odzyskiwanie po deployu: chunk-load error i wykrycie nowego builda.
//
// CO TO DOWODZI. Ten moduł jest jedyną obroną przed pustą stroną po deployu:
// przeglądarka trzyma stary `index.html`, dynamiczny `import()` celuje w chunk,
// którego już nie ma, i czytelnik dostaje biały ekran albo error boundary.
// Miał 0% pokrycia, a jego dwie ścieżki mają PRZECIWNE koszty pomyłki:
//   * za mało reloadów -> biały ekran po każdym deployu;
//   * za dużo reloadów -> PĘTLA przeładowań, czyli strona nie do użycia.
// Strażnik przeładowania jest tu jedyną rzeczą, która oddziela jedno od
// drugiego - i to jego przede wszystkim sprawdzają asercje niżej. Ma warstwy:
// zatrzask na cały dokument, kotwicę dokumentu urodzonego z reloadu (5 min
// spokoju liczone od startu jego nawigacji), `?_v=` w adresie (bieżącym i tym,
// pod którym załadowano dokument) oraz `sessionStorage`. Pętlę widać dopiero na
// DWÓCH dokumentach, więc testy strażnika symulują przeładowanie: świeży import
// modułu (pamięć modułu znika), adres z `location.replace`, nowy start
// nawigacji (`performance.now()` liczy wiek nowego dokumentu) i to, co przeżywa
// nawigację w tej samej karcie (`sessionStorage`, jeśli działa).
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

import type { SoftRefreshable } from "../cacheBusting";

type CacheBustingModule = typeof import("../cacheBusting");

let startCacheBusting: CacheBustingModule["startCacheBusting"];
let handleChunkLoadFailure: CacheBustingModule["handleChunkLoadFailure"];

/**
 * Świeża instancja modułu = nowy dokument. Moduł pamięta reload wydany
 * w bieżącym dokumencie, więc każdy test (i każde symulowane przeładowanie)
 * dostaje własną instancję.
 */
async function loadModule(): Promise<void> {
  vi.resetModules();
  ({ startCacheBusting, handleChunkLoadFailure } = await import("../cacheBusting"));
}

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
let originalStorage: PropertyDescriptor | undefined;

function setLocation(href: string): void {
  Object.defineProperty(window, "location", { configurable: true, value: { href, replace } });
}

/**
 * Nowy dokument pod adresem `href`: bieżący adres, wpis nawigacji
 * (Performance API), czyli adres, pod którym przeglądarka go załadowała, oraz
 * zegar dokumentu - `performance.now()` liczy od startu jego nawigacji.
 */
function openDocument(href: string, navigationStart = Date.now()): void {
  setLocation(href);
  vi.spyOn(performance, "getEntriesByType").mockImplementation((type) =>
    type === "navigation" ? [{ name: href } as PerformanceEntry] : [],
  );
  vi.spyOn(performance, "now").mockImplementation(() => Date.now() - navigationStart);
}

/** Chrome/Firefox/Safari przy zablokowanych cookies: sam dostęp do magazynu rzuca. */
function blockStorage(): void {
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    get() {
      throw new DOMException("The operation is insecure.", "SecurityError");
    },
  });
}

/**
 * Pełna quota albo prywatne Safari <= 10: odczyt działa (pusto), zapis rzuca.
 * Atrapa całego magazynu, bo happy-dom przypina metody do instancji przy
 * pierwszym użyciu i szpieg na `Storage.prototype` bywa wtedy omijany.
 */
function fullStorage() {
  const setItem = vi.fn<(key: string, value: string) => void>(() => {
    throw new DOMException("Quota exceeded", "QuotaExceededError");
  });
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    value: { getItem: () => null, setItem },
  });
  return setItem;
}

/** Firefox z `dom.storage.enabled=false` i część WebView: `sessionStorage === null`. */
function nullStorage(): void {
  Object.defineProperty(window, "sessionStorage", { configurable: true, value: null });
}

/** Adresy, na które moduł kazał przeładować stronę. */
function reloadedTo(): string[] {
  return replace.mock.calls.map((call) => String(call[0]));
}

/** Adres ostatniego `location.replace`. */
function lastReload(): string {
  return reloadedTo()[reloadedTo().length - 1];
}

/**
 * Przeładowanie: nawigacja rusza w chwili wywołania (tuż po `location.replace`),
 * a przeglądarka otwiera `href` w NOWYM dokumencie po `afterMs`. Pamięć modułu
 * znika (świeży import), zostaje adres i `sessionStorage`, jeśli działa.
 */
async function reloadInto(href: string, afterMs = 3_000): Promise<void> {
  stop();
  stop = () => undefined;
  const navigationStart = Date.now();
  vi.advanceTimersByTime(afterMs);
  openDocument(href, navigationStart);
  await loadModule();
}

beforeEach(async () => {
  vi.useFakeTimers();
  // Data bazowa ustalona: strażnik reloadu porównuje znaczniki czasu, więc
  // `Date.now()` musi być sterowalny, a nie „teraz".
  vi.setSystemTime(new Date("2026-08-21T10:00:00.000Z"));
  replace = vi.fn();
  originalLocation = Object.getOwnPropertyDescriptor(window, "location");
  originalStorage = Object.getOwnPropertyDescriptor(window, "sessionStorage");
  openDocument(START_URL);
  sessionStorage.clear();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  stop = () => undefined;
  await loadModule();
});

afterEach(() => {
  // Moduł ma flagę „już wystartowałem"; sprzątaczka ją zeruje, więc bez tego
  // drugi test w pliku dostawałby no-op zamiast działającego modułu.
  stop();
  if (originalLocation) Object.defineProperty(window, "location", originalLocation);
  if (originalStorage) Object.defineProperty(window, "sessionStorage", originalStorage);
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

  // Objects from another realm must work without instanceof Error; the
  // existing reload guard still prevents repeated refreshes.
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

  it("ten sam dokument przeładowuje najwyżej raz, także gdy nawigacja wisi dłużej niż okienko", () => {
    // Zimny SSR na wolnej sieci potrafi odpowiadać dłużej niż 15 s. Drugi
    // `replace` ze starego dokumentu przerwałby nawigację, która właśnie
    // odzyskuje stronę, i zaczął ją od nowa.
    stop = startCacheBusting(fakeRouter());
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("ChunkLoadError") }));
    vi.advanceTimersByTime(15_001);
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("ChunkLoadError") }));
    expect(reloadedTo()).toHaveLength(1);
  });

  it("kolejny deploy po wygaśnięciu strażnika znów przeładowuje", async () => {
    // Kolejny deploy po kwadransie to nowa sytuacja, nie ta sama pętla.
    stop = startCacheBusting(fakeRouter());
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("ChunkLoadError") }));
    await reloadInto(lastReload());
    vi.advanceTimersByTime(15 * 60_000);
    stop = startCacheBusting(fakeRouter());
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("ChunkLoadError") }));
    expect(reloadedTo()).toHaveLength(2);
  });

  it("zablokowany `sessionStorage` nie blokuje odzyskania strony", () => {
    // Tryb prywatny odbiera magazyn, a pierwszy odzysk po deployu i tak musi
    // się odbyć - strażnik niesie wtedy `_v` w adresie (testy niżej).
    blockStorage();
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

// Pętla przeładowań: trwale niedostępny chunk (adblock, CSP, proxy) wraca po
// każdym reloadzie. Strażnik w `sessionStorage` nie zadziała, gdy magazyn jest
// zablokowany (zablokowane cookies, WebView bez DOM storage) albo pełny
// (odczyt działa, zapis rzuca). Wtedy decyzję musi unieść znacznik, który
// przeżywa `location.replace` bez magazynu: `?_v=` w adresie.
describe("strażnik bez magazynu: przeładowanie najwyżej raz na okienko", () => {
  const CHUNK_ERROR = new TypeError("Failed to fetch dynamically imported module: /assets/x.js");
  const KEY = "__lov_cb_reload";

  it("magazyn zablokowany: ten sam błąd po przeładowaniu już nie przeładowuje", async () => {
    blockStorage();
    handleChunkLoadFailure(CHUNK_ERROR);
    expect(reloadedTo()).toHaveLength(1);

    await reloadInto(lastReload());
    handleChunkLoadFailure(CHUNK_ERROR);
    expect(reloadedTo()).toHaveLength(1);
  });

  it("odczyt działa, zapis rzuca QuotaExceededError: strażnik i tak działa", async () => {
    const setItem = fullStorage();
    handleChunkLoadFailure(CHUNK_ERROR);
    expect(reloadedTo()).toHaveLength(1);
    expect(setItem).toHaveBeenCalled();

    await reloadInto(lastReload());
    handleChunkLoadFailure(CHUNK_ERROR);
    expect(reloadedTo()).toHaveLength(1);
  });

  it("dokument z naszego reloadu nie przeładowuje się przez 5 min życia, potem odzysk wraca", async () => {
    // Kolejny deploy to nowa sytuacja: kotwica jest ograniczona wiekiem
    // dokumentu, więc nie blokuje odzysku na resztę wizyty, choć `_v` zostaje
    // w adresie. Okno liczy się od startu nawigacji, a nie od błędu.
    blockStorage();
    handleChunkLoadFailure(CHUNK_ERROR);
    await reloadInto(lastReload(), 3_000);
    handleChunkLoadFailure(CHUNK_ERROR);
    expect(reloadedTo()).toHaveLength(1);

    vi.advanceTimersByTime(5 * 60_000 - 3_001);
    handleChunkLoadFailure(CHUNK_ERROR);
    expect(reloadedTo()).toHaveLength(1);

    vi.advanceTimersByTime(1);
    handleChunkLoadFailure(CHUNK_ERROR);
    expect(reloadedTo()).toHaveLength(2);

    await reloadInto(lastReload());
    handleChunkLoadFailure(CHUNK_ERROR);
    expect(reloadedTo()).toHaveLength(2);
  });

  it.each([
    { tryb: "działa", przygotuj: () => undefined },
    { tryb: "zablokowany (dostęp rzuca)", przygotuj: blockStorage },
    { tryb: "pełny (zapis rzuca)", przygotuj: () => void fullStorage() },
    { tryb: "wyłączony (`null`)", przygotuj: nullStorage },
  ])(
    "magazyn $tryb: błąd trwały później niż 15 s po reloadzie nie daje powolnej pętli",
    async ({ przygotuj }) => {
      // Żądanie chunku wiszące do timeoutu proxy albo bardzo wolny boot: błąd
      // przychodzi po wygaśnięciu znaczników 15 s. Decyduje kotwica dokumentu.
      przygotuj();
      handleChunkLoadFailure(CHUNK_ERROR);
      expect(reloadedTo()).toHaveLength(1);

      await reloadInto(lastReload(), 16_000);
      handleChunkLoadFailure(CHUNK_ERROR);
      vi.advanceTimersByTime(44_000);
      handleChunkLoadFailure(CHUNK_ERROR);
      vi.advanceTimersByTime(3 * 60_000);
      handleChunkLoadFailure(CHUNK_ERROR);
      expect(reloadedTo()).toHaveLength(1);
    },
  );

  it("magazyn działa, ale jest czyszczony między dokumentami: ten sam błąd już nie przeładowuje", async () => {
    // WebView z nową instancją magazynu per nawigacja albo kod, który go
    // czyści: odczyt i zapis działają, a nowy dokument widzi pusty magazyn.
    handleChunkLoadFailure(CHUNK_ERROR);
    expect(reloadedTo()).toHaveLength(1);
    sessionStorage.clear();

    await reloadInto(lastReload());
    handleChunkLoadFailure(CHUNK_ERROR);
    expect(reloadedTo()).toHaveLength(1);
  });

  it("para `error` + `unhandledrejection` w jednym dokumencie daje jedno `location.replace`", () => {
    blockStorage();
    stop = startCacheBusting(fakeRouter());
    window.dispatchEvent(new ErrorEvent("error", { error: CHUNK_ERROR }));
    const rejection = new Event("unhandledrejection");
    Object.defineProperty(rejection, "reason", { value: CHUNK_ERROR });
    window.dispatchEvent(rejection);
    expect(reloadedTo()).toHaveLength(1);
  });

  it("adres zmieniony w nowym dokumencie bez `_v` (replaceState) - decyduje adres załadowania", async () => {
    // AutoLoadNextPost, ClubHub czy /scanner?t przepisują pasek adresu
    // natywnym `history.replaceState` jeszcze przed błędem.
    blockStorage();
    handleChunkLoadFailure(CHUNK_ERROR);
    await reloadInto(lastReload());
    setLocation(START_URL);
    handleChunkLoadFailure(CHUNK_ERROR);
    expect(reloadedTo()).toHaveLength(1);
  });

  it.each([
    { nazwa: "bez wpisu nawigacji w Performance API (Safari < 15)", wpisy: [] },
    // Wczesne Navigation Timing 2 nazywało wpis „document" zamiast adresu.
    { nazwa: "wpis nawigacji bez adresu (`document`)", wpisy: [{ name: "document" }] },
  ])("$nazwa: decyduje `_v` z bieżącego adresu", async ({ wpisy }) => {
    blockStorage();
    handleChunkLoadFailure(CHUNK_ERROR);
    await reloadInto(lastReload());
    vi.spyOn(performance, "getEntriesByType").mockReturnValue(wpisy as PerformanceEntry[]);
    handleChunkLoadFailure(CHUNK_ERROR);
    expect(reloadedTo()).toHaveLength(1);
  });

  it("bez wpisu nawigacji kotwica czyta `_v` z bieżącego adresu (błąd po 15 s)", async () => {
    blockStorage();
    handleChunkLoadFailure(CHUNK_ERROR);
    await reloadInto(lastReload(), 16_000);
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([]);
    handleChunkLoadFailure(CHUNK_ERROR);
    expect(reloadedTo()).toHaveLength(1);
  });

  const NOW = Date.parse("2026-08-21T10:00:00.000Z");
  it.each([
    { nazwa: "stary (sprzed minuty, zakładka)", v: (NOW - 60_000).toString(36) },
    // Kotwica toleruje 2 s rozjazdu zegarów; cudzy zegar spieszy się bardziej.
    { nazwa: "z przyszłości (cudzy zegar)", v: (NOW + 60_000).toString(36) },
    { nazwa: "śmieciowy", v: "nie-znacznik" },
    // `parseInt` przeczytałby świeży czas z przedrostka - liczy się tylko
    // dokładnie format, który zapisuje reload.
    { nazwa: "świeży czas z doklejonym ogonem", v: `${(NOW - 1_000).toString(36)}-x` },
    { nazwa: "pusty", v: "" },
  ])("$nazwa `_v` nie wstrzymuje odzysku i zostaje zastąpiony świeżym", async ({ v }) => {
    blockStorage();
    openDocument(`${START_URL}?_v=${encodeURIComponent(v)}`);
    handleChunkLoadFailure(CHUNK_ERROR);
    expect(reloadedTo()).toHaveLength(1);
    expect(new URL(lastReload()).searchParams.get("_v")).toBe(NOW.toString(36));

    // Dopiero świeży znacznik z tego reloadu zatrzymuje następny.
    await reloadInto(lastReload());
    handleChunkLoadFailure(CHUNK_ERROR);
    expect(reloadedTo()).toHaveLength(1);
  });

  it("znacznik w magazynie z przyszłości (cofnięty zegar) nie blokuje odzysku", () => {
    sessionStorage.setItem(KEY, String(NOW + 60_000));
    handleChunkLoadFailure(CHUNK_ERROR);
    expect(reloadedTo()).toHaveLength(1);
  });

  it("działający magazyn: decyduje dotychczasowy strażnik (ten sam klucz, format i TTL)", async () => {
    // Bez `_v` w adresie zostaje wyłącznie `sessionStorage` - ścieżka sprzed
    // zmiany.
    handleChunkLoadFailure(CHUNK_ERROR);
    expect(reloadedTo()).toHaveLength(1);
    expect(sessionStorage.getItem(KEY)).toBe(String(NOW));

    await reloadInto(START_URL, 14_000);
    handleChunkLoadFailure(CHUNK_ERROR);
    expect(reloadedTo()).toHaveLength(1);

    // Dokładnie 15 000 ms po zapisie znacznik już nie jest świeży.
    vi.advanceTimersByTime(1_000);
    handleChunkLoadFailure(CHUNK_ERROR);
    expect(reloadedTo()).toHaveLength(2);
  });

  // Szerokość okien jest przypięta co do milisekundy. Szersze okno wstrzymuje
  // odzysk po kolejnym deployu dłużej, niż obiecuje nagłówek modułu. Węższe,
  // albo kotwica bez zapasu na zaokrąglony zegar, przywraca pętlę przeładowań.
  it.each([
    { wiek: 14_999, wynik: "wstrzymuje reload", reloady: 0 },
    { wiek: 15_000, wynik: "już nie wstrzymuje reloadu", reloady: 1 },
  ])(
    "wpis nawigacji bez adresu: `_v` w bieżącym adresie wydany $wiek ms temu $wynik",
    ({ wiek, reloady }) => {
      // Bez adresu załadowania kotwica milczy, więc decyduje samo okno `_v`:
      // 0 <= teraz - `_v` < 15 s.
      blockStorage();
      openDocument(`${START_URL}?_v=${(NOW - wiek).toString(36)}`);
      vi.spyOn(performance, "getEntriesByType").mockReturnValue([
        { name: "document" },
      ] as PerformanceEntry[]);
      handleChunkLoadFailure(CHUNK_ERROR);
      expect(reloadedTo()).toHaveLength(reloady);
    },
  );

  it.each([
    // Zegar zaokrąglony (Firefox z resistFingerprinting): start nawigacji
    // dokumentu z naszego reloadu wypada odrobinę PRZED chwilą zapisaną w `_v`.
    { nazwa: "2 s przed `_v`", odstep: -2_000, wynik: "późny błąd nie przeładowuje", reloady: 0 },
    { nazwa: "2,001 s przed `_v`", odstep: -2_001, wynik: "późny błąd przeładowuje", reloady: 1 },
    { nazwa: "14,999 s po `_v`", odstep: 14_999, wynik: "późny błąd nie przeładowuje", reloady: 0 },
    // Na przykład link z `_v` otwarty w nowej karcie: to już nie jest dokument
    // z naszego reloadu.
    { nazwa: "15 s po `_v`", odstep: 15_000, wynik: "późny błąd przeładowuje", reloady: 1 },
  ])("kotwica: nawigacja ruszyła $nazwa, $wynik", ({ odstep, reloady }) => {
    // Kotwica: -2 s <= start nawigacji - `_v` < 15 s. Błąd przychodzi 2 min po
    // starcie nawigacji, gdy `_v` od dawna nie jest świeży, więc decyduje sama
    // kotwica.
    blockStorage();
    openDocument(`${START_URL}?_v=${(NOW - odstep).toString(36)}`);
    vi.advanceTimersByTime(2 * 60_000);
    handleChunkLoadFailure(CHUNK_ERROR);
    expect(reloadedTo()).toHaveLength(reloady);
  });
});

// P1.3 (TP-4): korzeń buforuje błędy sprzed importu modułu w punkcie ciszy
// i oddaje je tu - ta sama reguła co nasłuch `startCacheBusting`.
describe("błąd sprzed startu modułu (`handleChunkLoadFailure`)", () => {
  it("chunk-load error -> jeden twardy reload z `_v`, inny błąd - nic", () => {
    handleChunkLoadFailure(new Error("Something else"));
    expect(reloadedTo()).toHaveLength(0);
    handleChunkLoadFailure(new TypeError("Failed to fetch dynamically imported module: /x.js"));
    expect(reloadedTo()).toHaveLength(1);
    expect(new URL(reloadedTo()[0]).searchParams.get("_v")).toBeTruthy();
  });

  it("bez `window` (render serwera) jest no-opem", () => {
    vi.stubGlobal("window", undefined);
    try {
      expect(() => handleChunkLoadFailure(new Error("ChunkLoadError"))).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(reloadedTo()).toHaveLength(0);
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

describe("non-Error event payloads", () => {
  it.each([{}, { message: 500 }, { message: "", reason: {} }, { reason: { message: 42 } }])(
    "ignores unrecognizable payload %j",
    (error) => {
      stop = startCacheBusting(fakeRouter());
      window.dispatchEvent(new ErrorEvent("error", { error }));
      expect(reloadedTo()).toEqual([]);
    },
  );
  it("accepts an event-shaped loader failure once", () => {
    stop = startCacheBusting(fakeRouter());
    const error = { reason: { message: "ChunkLoadError" } };
    window.dispatchEvent(new ErrorEvent("error", { error }));
    window.dispatchEvent(new ErrorEvent("error", { error }));
    expect(reloadedTo()).toHaveLength(1);
  });
});
