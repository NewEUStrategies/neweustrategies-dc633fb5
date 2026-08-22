// Podgląd, który sam wraca do życia - i który NIE przeładowuje strony
// czytelnikowi publicznej witryny.
//
// CO TO DOWODZI. `sessionHeartbeat.ts` to jedyny kod w repo, który sam z siebie
// PRZEŁADOWUJE DOKUMENT na podstawie pulsu z sieci. Miał 19% pokrycia, a jego
// dwie ścieżki mają PRZECIWNE koszty pomyłki:
//   * za mało wskrzeszeń -> iframe podglądu zostaje biały („Updating…") aż
//     ktoś ręcznie kliknie „Reload preview" - to problem, dla którego ten plik
//     w ogóle powstał;
//   * za dużo wskrzeszeń -> PĘTLA przeładowań, czyli podgląd nie do pracy, a
//     przy fałszywym starcie poza podglądem - przeładowania u czytelników
//     produkcyjnej witryny w trakcie czytania.
// Asercje niżej pilnują dokładnie tych granic: licznika przeładowań w
// `sessionStorage`, progu 30 s milczenia, timeoutu sondy, wygaszenia całego
// modułu poza kontekstem podglądu oraz tego, że po sprzątnięciu NIC już nie
// strzela. Dodatkowo pilnują drugiej obietnicy modułu wobec człowieka: po
// wymuszonym przeładowaniu wracasz na swoją trasę i swoją pozycję, a nie na
// górę losowej strony.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//   * `heartbeatMachine.test.ts` - reguły czystego automatu (progi, backoff,
//     budżet prób, cooldown). Tutaj automat jest tylko przejechany PRZEZ
//     runtime i sprawdzamy jego SKUTKI: `fetch`, `sessionStorage`,
//     `postMessage`, `location.replace`, `scrollTo`.
//   * `sessionHeartbeat.test.ts` - `isPreviewContext` jako czysta funkcja oraz
//     trzy stany snapshotu (brak / świeży / przeterminowany). Tutaj widzimy te
//     same rzeczy przez ZACHOWANIE modułu (start albo odmowa startu,
//     przywrócenie pozycji, wygaśnięcie TTL w locie) plus kształty snapshotu,
//     których tamten plik nie rusza.
//   * `src/lib/__tests__/cacheBusting.test.ts` - reload po chunk-load error na
//     domenie publicznej. To ROZŁĄCZNE mechanizmy (tam stary bundel u
//     czytelnika, tu utracony sandbox w podglądzie); wspólna jest tylko
//     konwencja strażnika przeładowań w `sessionStorage`.
//   * gałąź `typeof window === "undefined"` (sessionHeartbeat.ts:182) - jest
//     w `sessionHeartbeatSsr.test.ts`, bo w happy-dom jest nieosiągalna.
//   * nie sprawdzamy trasy `/api/public/version` (ma własne testy) ani
//     `router.invalidate()` (kontrakt frameworka) - wyłącznie DECYZJĘ modułu,
//     czy je wywołać.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  HEALTHY_INTERVAL_MS,
  PROBE_MAX_MS,
  PROBE_MIN_MS,
  RECOVERY_COOLDOWN_MS,
  STUCK_MS,
} from "../heartbeatMachine";
import {
  readPreviewSnapshot,
  startPreviewHeartbeat,
  type PreviewHeartbeatRouter,
} from "../sessionHeartbeat";

// Klucze i progi NIEEKSPORTOWANE z modułu (sessionHeartbeat.ts:41-46) - kopie
// z numerami linii, żeby rozjazd był widoczny w recenzji, a nie ukryty.
const KLUCZ_SNAPSHOTU = "__lov_preview_snapshot";
const KLUCZ_STRAZNIKA = "__lov_preview_reloads";
const TTL_SNAPSHOTU_MS = 10 * 60_000;
const TIMEOUT_SONDY_MS = 5_000;
const MAKS_PRZELADOWAN = 5;
const ADRES_SONDY = "/api/public/version";

/** Chwila zerowa testów; wszystkie znaczniki w asercjach liczone od niej. */
const TERAZ_MS = Date.parse("2026-08-21T10:00:00.000Z");
const HOST_PODGLADU = "id-preview--nes.lovable.app";
const START_URL = `https://${HOST_PODGLADU}/analizy`;
const HOST_PRODUKCYJNY = "neweuropeanstrategies.com";

/** Pierwsza sonda leci po zdrowym odstępie - to chwila PIERWSZEJ porażki. */
const PIERWSZA_PORAZKA_MS = HEALTHY_INTERVAL_MS;
/** Chwila, w której automat uznaje sesję za utraconą (30 s milczenia pulsu). */
const UTRATA_SESJI_MS = PIERWSZA_PORAZKA_MS + STUCK_MS;

/** Kształt odpowiedzi, z którego korzysta `probe` (sessionHeartbeat.ts:163-173). */
interface OdpowiedzWersji {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

/** Opcje, jakie moduł podaje do `fetch` - tylko to, co asertujemy. */
interface OpcjeSondy {
  readonly cache?: string;
  readonly credentials?: string;
  readonly headers?: Record<string, string>;
  readonly signal?: AbortSignal | null;
}

interface AtrapaRoutera {
  readonly router: PreviewHeartbeatRouter;
  readonly subscribe: Mock<(zdarzenie: "onResolved", listener: () => void) => () => void>;
  readonly invalidate: Mock<() => void>;
  /** Emituje „nawigacja rozwiązana" - tylko do NADAL podpiętych listenerów. */
  emitujNawigacje(): void;
  /** Ilu listenerów router jeszcze trzyma (0 = sprzątaczka je odpięła). */
  podpieci(): number;
}

let przywroc: Array<() => void> = [];
let pulsy: Array<{ readonly adres: string; readonly opcje: OpcjeSondy }> = [];
let sygnaly: AbortSignal[] = [];
let przeladowania: Mock<(url: string) => void>;
let stop: () => void;

/**
 * Podmienia właściwość obiektu globalnego na czas jednego testu i rejestruje
 * przywrócenie. `vi.restoreAllMocks()` NIE cofa `defineProperty`, a w happy-dom
 * nie cofa też szpiegów na `sessionStorage` (to Proxy) - dlatego wszystko
 * odkręcamy sami, w kolejności odwrotnej do zakładania.
 */
function podmien(cel: object, nazwa: string, wartosc: unknown): void {
  const oryginal = Object.getOwnPropertyDescriptor(cel, nazwa);
  Object.defineProperty(cel, nazwa, { configurable: true, value: wartosc });
  przywroc.push(() => {
    if (oryginal) Object.defineProperty(cel, nazwa, oryginal);
    else Reflect.deleteProperty(cel, nazwa);
  });
}

/** Ustawia adres dokumentu; `pathname`/`hostname` liczone prawdziwym parserem. */
function ustawLokalizacje(href: string): void {
  const url = new URL(href);
  podmien(window, "location", {
    href,
    pathname: url.pathname,
    hostname: url.hostname,
    replace: przeladowania,
  });
}

/** Adresy, na które moduł kazał przeładować dokument. */
function adresyPrzeladowan(): string[] {
  return przeladowania.mock.calls.map((wywolanie) => wywolanie[0]);
}

/** Pozycja czytelnika w dokumencie. */
function ustawPozycje(y: number): void {
  podmien(window, "scrollY", y);
}

/**
 * Podstawia `fetch`. ZERO prawdziwej sieci w tym pliku: każdy puls przechodzi
 * przez tę atrapę, a jej wywołania (adres + opcje) są asertowane.
 */
function stubujPuls(obsluga: (nr: number, signal: AbortSignal) => Promise<OdpowiedzWersji>) {
  let nr = 0;
  const stub = vi.fn<(adres: unknown, opcje?: OpcjeSondy) => Promise<OdpowiedzWersji>>(
    (adres, opcje) => {
      // Strażnik zamiast rzutowania: sonda MUSI podać sygnał przerwania,
      // bo inaczej timeout 5 s nie ma czego przerwać.
      if (!opcje || !opcje.signal) {
        return Promise.reject(new Error("test: sonda nie podała AbortSignal"));
      }
      pulsy.push({ adres: String(adres), opcje });
      sygnaly.push(opcje.signal);
      return obsluga(nr++, opcje.signal);
    },
  );
  vi.stubGlobal("fetch", stub);
  return stub;
}

const wersja = (v: unknown): OdpowiedzWersji => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve({ v }),
});

/** Kolejne pulsy odpowiadają podanymi wersjami; ostatnia powtarza się. */
function pulsWersji(...wersje: unknown[]) {
  return stubujPuls((nr) => Promise.resolve(wersja(wersje[Math.min(nr, wersje.length - 1)])));
}

/** Każdy puls zgłasza INNY build, czyli każdy żąda przeładowania dokumentu. */
function pulsCiaglychZmianBuilda() {
  return stubujPuls((nr) => Promise.resolve(wersja(`build-${nr}`)));
}

/** Sandbox milczy - każdy puls pada na transporcie. */
function pulsMartwy() {
  return stubujPuls(() => Promise.reject(new Error("Failed to fetch")));
}

interface ZawieszonyPuls {
  readonly obietnica: Promise<OdpowiedzWersji>;
  rozwiaz(odpowiedz: OdpowiedzWersji): void;
}

/** Puls, którym steruje test - do scenariuszy „odpowiedź przyszła za późno". */
function zawieszonyPuls(): ZawieszonyPuls {
  let spelnij: (odpowiedz: OdpowiedzWersji) => void = () => undefined;
  const obietnica = new Promise<OdpowiedzWersji>((res) => {
    spelnij = res;
  });
  return { obietnica, rozwiaz: (odpowiedz) => spelnij(odpowiedz) };
}

function atrapaRoutera(): AtrapaRoutera {
  const listenery = new Set<() => void>();
  // Sygnatury podane jawnie: `vi.fn()` bez nich jest typowane jako wywoływalne
  // ORAZ konstruowalne i nie spełnia wąskiego `PreviewHeartbeatRouter`.
  const invalidate = vi.fn<() => void>();
  const subscribe = vi.fn<(zdarzenie: "onResolved", listener: () => void) => () => void>(
    (_zdarzenie, listener) => {
      listenery.add(listener);
      return () => {
        listenery.delete(listener);
      };
    },
  );
  return {
    router: { subscribe, invalidate },
    subscribe,
    invalidate,
    emitujNawigacje: () => listenery.forEach((listener) => listener()),
    podpieci: () => listenery.size,
  };
}

/**
 * Śledzi zapisy do `sessionStorage` NA INSTANCJI. W happy-dom metody magazynu
 * nie są dziedziczone z `Storage.prototype`, więc podmiana prototypu nie
 * przechwytuje wywołań modułu i test przechodziłby, nie dowodząc niczego.
 */
function sledzZapisy() {
  const szpieg = vi.spyOn(window.sessionStorage, "setItem");
  przywroc.push(() => szpieg.mockRestore());
  return szpieg;
}

/** Magazyn odmawia zapisu - tryb prywatny albo wyczerpany limit. */
function zablokujZapisy(): void {
  const szpieg = vi.spyOn(window.sessionStorage, "setItem").mockImplementation(() => {
    throw new Error("odmowa dostępu do magazynu");
  });
  przywroc.push(() => szpieg.mockRestore());
}

/** Przechwytuje przewijanie; z `nadazaj` udaje stronę, która faktycznie skacze. */
function sledzPrzewijanie(nadazaj = false) {
  const przewijanie = vi.fn<(opcje: ScrollToOptions) => void>((opcje) => {
    if (nadazaj && typeof opcje.top === "number") {
      Object.defineProperty(window, "scrollY", { configurable: true, value: opcje.top });
    }
  });
  podmien(window, "scrollTo", przewijanie);
  return przewijanie;
}

/** Powłoka podglądu wokół iframe'a (czyli `window.parent !== window`). */
function podlaczPowloke() {
  const postMessage = vi.fn<(dane: unknown, cel: string) => void>();
  podmien(window, "parent", { postMessage });
  return postMessage;
}

/** Powłoka, która odrzuca wiadomości (obcy origin, martwe okno nadrzędne). */
function podlaczGluchaPowloke() {
  const postMessage = vi.fn<(dane: unknown, cel: string) => void>(() => {
    throw new Error("powłoka nie przyjmuje wiadomości");
  });
  podmien(window, "parent", { postMessage });
  return postMessage;
}

function zapiszSnapshot(snapshot: { href: string; scrollY?: number; atMs: number }): void {
  window.sessionStorage.setItem(KLUCZ_SNAPSHOTU, JSON.stringify(snapshot));
}

function czytajSnapshot(): unknown {
  const surowe = window.sessionStorage.getItem(KLUCZ_SNAPSHOTU);
  return surowe === null ? null : JSON.parse(surowe);
}

beforeEach(() => {
  vi.useFakeTimers();
  // Zero prawdziwego czasu: moduł stempluje snapshoty, liczy 30 s milczenia
  // i buduje omijacz cache z `Date.now()`.
  vi.setSystemTime(new Date(TERAZ_MS));
  przywroc = [];
  pulsy = [];
  sygnaly = [];
  window.sessionStorage.clear();
  przeladowania = vi.fn<(url: string) => void>();
  ustawLokalizacje(START_URL);
  ustawPozycje(0);
  // Domyślnie zdrowy, bezskutkowy puls - żaden test nie może wyjść do sieci
  // nawet wtedy, gdy sam nie interesuje się sondowaniem.
  pulsWersji("build-0");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  stop = () => undefined;
});

afterEach(() => {
  // Moduł ma flagę „już wystartowałem" (sessionHeartbeat.ts:175) - bez
  // sprzątaczki następny test dostałby no-op zamiast działającego modułu.
  stop();
  while (przywroc.length > 0) przywroc.pop()?.();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("sesja żyje: puls dochodzi, stan jest zapamiętywany", () => {
  it("zdrowy puls pyta TYLKO o wersję i nie rusza strony", async () => {
    const atrapa = atrapaRoutera();
    const stub = pulsWersji("build-1");
    stop = startPreviewHeartbeat(atrapa.router);

    await vi.advanceTimersByTimeAsync(HEALTHY_INTERVAL_MS);

    expect(stub).toHaveBeenCalledTimes(1);
    // Adres i opcje asertowane jawnie: ten moduł nie ma prawa dotknąć niczego
    // innego w sieci ani wysłać czegokolwiek poza nagłówkiem `accept`.
    expect(pulsy[0].adres).toBe(ADRES_SONDY);
    expect(pulsy[0].opcje.cache).toBe("no-store");
    expect(pulsy[0].opcje.credentials).toBe("same-origin");
    expect(pulsy[0].opcje.headers).toEqual({ accept: "application/json" });
    expect(atrapa.invalidate).not.toHaveBeenCalled();
    expect(adresyPrzeladowan()).toEqual([]);
  });

  it("zdrowa sesja pulsuje rzadko - co 10 s, nie w kółko", async () => {
    const atrapa = atrapaRoutera();
    const stub = pulsWersji("build-1");
    stop = startPreviewHeartbeat(atrapa.router);

    await vi.advanceTimersByTimeAsync(3 * HEALTHY_INTERVAL_MS + 100);

    // Gęstsze sondowanie zdrowej sesji to podatek od każdej otwartej karty.
    expect(stub).toHaveBeenCalledTimes(3);
    expect(atrapa.invalidate).not.toHaveBeenCalled();
  });

  it("każda rozwiązana nawigacja zapisuje trasę i pozycję czytelnika", () => {
    const zapisy = sledzZapisy();
    const atrapa = atrapaRoutera();
    ustawPozycje(640);
    stop = startPreviewHeartbeat(atrapa.router);

    atrapa.emitujNawigacje();

    expect(zapisy).toHaveBeenCalledWith(KLUCZ_SNAPSHOTU, expect.any(String));
    expect(czytajSnapshot()).toEqual({ href: START_URL, scrollY: 640, atMs: TERAZ_MS });
  });

  it("opuszczenie dokumentu zapisuje stan tuż przed wyjściem", () => {
    const atrapa = atrapaRoutera();
    ustawPozycje(120);
    stop = startPreviewHeartbeat(atrapa.router);

    window.dispatchEvent(new Event("pagehide"));

    expect(czytajSnapshot()).toEqual({ href: START_URL, scrollY: 120, atMs: TERAZ_MS });
  });

  it("schowanie zakładki zapisuje stan i NIE sonduje", async () => {
    const atrapa = atrapaRoutera();
    const stub = pulsWersji("build-1");
    ustawPozycje(80);
    stop = startPreviewHeartbeat(atrapa.router);

    podmien(document, "visibilityState", "hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);

    expect(czytajSnapshot()).toEqual({ href: START_URL, scrollY: 80, atMs: TERAZ_MS });
    // Karta w tle nie ma po co odpytywać serwera.
    expect(stub).not.toHaveBeenCalled();
  });

  it("powrót do zakładki sonduje natychmiast i anuluje zaplanowany puls", async () => {
    // Powrót do widoczności to najczęstsza chwila, w której sandbox właśnie
    // wstał - czekanie do końca odstępu byłoby widocznym opóźnieniem.
    const atrapa = atrapaRoutera();
    const stub = pulsWersji("build-1");
    stop = startPreviewHeartbeat(atrapa.router);
    await vi.advanceTimersByTimeAsync(1_000);

    podmien(document, "visibilityState", "visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(stub).toHaveBeenCalledTimes(1);

    // Stary licznik musi być anulowany, inaczej sondy zaczynają się dublować.
    await vi.advanceTimersByTimeAsync(HEALTHY_INTERVAL_MS - 1_000 + 100);
    expect(stub).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(stub).toHaveBeenCalledTimes(2);
  });

  it("odpowiedź bez wersji nie kasuje znanego builda", async () => {
    // Śmieciowa odpowiedź nie może wyglądać ani jak nowy build (przeładowanie
    // bez powodu), ani jak wyzerowanie wiedzy (przeoczony PRAWDZIWY deploy).
    const atrapa = atrapaRoutera();
    pulsWersji("build-1", 7, "build-2");
    stop = startPreviewHeartbeat(atrapa.router);

    await vi.advanceTimersByTimeAsync(2 * HEALTHY_INTERVAL_MS + 100);
    expect(adresyPrzeladowan()).toEqual([]);

    await vi.advanceTimersByTimeAsync(HEALTHY_INTERVAL_MS);
    expect(adresyPrzeladowan()).toHaveLength(1);
  });

  it("puste ciało odpowiedzi nie wywala pulsu", async () => {
    const atrapa = atrapaRoutera();
    const stub = stubujPuls(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(null) }),
    );
    stop = startPreviewHeartbeat(atrapa.router);

    await vi.advanceTimersByTimeAsync(2 * HEALTHY_INTERVAL_MS + 100);

    expect(stub).toHaveBeenCalledTimes(2);
    expect(adresyPrzeladowan()).toEqual([]);
    expect(atrapa.invalidate).not.toHaveBeenCalled();
  });
});

describe("utrata sieci i powrót: stan musi wrócić, a nie zostać zepsuty", () => {
  it("jedna porażka nie panikuje - tylko zagęszcza pulsy", async () => {
    const atrapa = atrapaRoutera();
    const stub = pulsMartwy();
    stop = startPreviewHeartbeat(atrapa.router);

    await vi.advanceTimersByTimeAsync(PIERWSZA_PORAZKA_MS);
    expect(stub).toHaveBeenCalledTimes(1);
    expect(adresyPrzeladowan()).toEqual([]);

    // Odstęp awaryjny (2 s) zamiast zdrowego (10 s) - dowód, że stan zszedł
    // do „degraded", a nie że nic się nie stało.
    await vi.advanceTimersByTimeAsync(PROBE_MIN_MS);
    expect(stub).toHaveBeenCalledTimes(2);
    expect(atrapa.invalidate).not.toHaveBeenCalled();
  });

  it("odpowiedź 5xx liczy się jak brak pulsu", async () => {
    const atrapa = atrapaRoutera();
    const stub = stubujPuls(() =>
      Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) }),
    );
    stop = startPreviewHeartbeat(atrapa.router);

    await vi.advanceTimersByTimeAsync(PIERWSZA_PORAZKA_MS + PROBE_MIN_MS);

    expect(stub).toHaveBeenCalledTimes(2);
    expect(atrapa.invalidate).not.toHaveBeenCalled();
  });

  it("powrót pulsu odświeża dane MIĘKKO, bez mrugania przeładowaniem", async () => {
    const atrapa = atrapaRoutera();
    stubujPuls((nr) =>
      nr === 0 ? Promise.reject(new Error("Failed to fetch")) : Promise.resolve(wersja("build-1")),
    );
    stop = startPreviewHeartbeat(atrapa.router);

    await vi.advanceTimersByTimeAsync(PIERWSZA_PORAZKA_MS + PROBE_MIN_MS);

    expect(atrapa.invalidate).toHaveBeenCalledTimes(1);
    expect(adresyPrzeladowan()).toEqual([]);
  });

  it("po odzyskaniu odstęp wraca do zdrowego - stan nie zostaje w awarii", async () => {
    // To jest właściwa treść „odzyskania": awaria nie może zostawić modułu
    // w trybie awaryjnym na zawsze (sondowanie co 2 s do końca sesji).
    const atrapa = atrapaRoutera();
    const stub = stubujPuls((nr) =>
      nr === 0 ? Promise.reject(new Error("Failed to fetch")) : Promise.resolve(wersja("build-1")),
    );
    stop = startPreviewHeartbeat(atrapa.router);
    await vi.advanceTimersByTimeAsync(PIERWSZA_PORAZKA_MS + PROBE_MIN_MS);
    expect(stub).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(PROBE_MIN_MS + 100);
    expect(stub).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(HEALTHY_INTERVAL_MS);
    expect(stub).toHaveBeenCalledTimes(3);
    // Jeden powrót = jedno odświeżenie, nie odświeżanie w kółko.
    expect(atrapa.invalidate).toHaveBeenCalledTimes(1);
  });

  it("odzyskanie sieci sprawdza sesję natychmiast, bez czekania na odstęp", async () => {
    const atrapa = atrapaRoutera();
    const stub = stubujPuls((nr) =>
      nr === 0 ? Promise.reject(new Error("Failed to fetch")) : Promise.resolve(wersja("build-1")),
    );
    stop = startPreviewHeartbeat(atrapa.router);
    await vi.advanceTimersByTimeAsync(PIERWSZA_PORAZKA_MS);

    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);

    expect(stub).toHaveBeenCalledTimes(2);
    expect(atrapa.invalidate).toHaveBeenCalledTimes(1);
  });

  it("żądanie, które nie wraca, jest ucinane po 5 s i liczy się jak porażka", async () => {
    // Bez tego timeoutu uśpiony sandbox trzymałby sondę otwartą bez końca,
    // a automat nigdy nie dowiedziałby się, że sesja umarła.
    const atrapa = atrapaRoutera();
    const stub = stubujPuls(
      (_nr, signal) =>
        new Promise<OdpowiedzWersji>((_spelnij, odrzuc) => {
          signal.addEventListener("abort", () => odrzuc(new Error("przerwane")));
        }),
    );
    stop = startPreviewHeartbeat(atrapa.router);

    await vi.advanceTimersByTimeAsync(PIERWSZA_PORAZKA_MS);
    expect(sygnaly[0].aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(TIMEOUT_SONDY_MS);
    expect(sygnaly[0].aborted).toBe(true);

    // Ucięta sonda to porażka, więc następny puls leci po odstępie awaryjnym.
    await vi.advanceTimersByTimeAsync(PROBE_MIN_MS);
    expect(stub).toHaveBeenCalledTimes(2);
  });
});

describe("sesja wygasła: 30 s milczenia pulsu", () => {
  it("krótka usterka NIE jest traktowana jak utrata sesji", async () => {
    const powloka = podlaczPowloke();
    const atrapa = atrapaRoutera();
    pulsMartwy();
    stop = startPreviewHeartbeat(atrapa.router);

    await vi.advanceTimersByTimeAsync(UTRATA_SESJI_MS - PROBE_MAX_MS);

    expect(powloka).not.toHaveBeenCalled();
    expect(adresyPrzeladowan()).toEqual([]);
  });

  it("po 30 s milczenia moduł prosi powłokę podglądu o wznowienie", async () => {
    // Pierwsza próba jest NIEINWAZYJNA: powłoka może przebudować iframe bez
    // gubienia stanu aplikacji, więc dokumentu jeszcze nie ruszamy.
    const powloka = podlaczPowloke();
    const atrapa = atrapaRoutera();
    pulsMartwy();
    stop = startPreviewHeartbeat(atrapa.router);

    await vi.advanceTimersByTimeAsync(UTRATA_SESJI_MS + 100);

    expect(powloka).toHaveBeenCalledTimes(1);
    expect(powloka).toHaveBeenCalledWith(
      { type: "lovable:preview-reconnect", reason: "session-stuck" },
      "*",
    );
    expect(adresyPrzeladowan()).toEqual([]);
  });

  it("gdy prośba nie pomogła, dopiero KOLEJNA próba przeładowuje dokument", async () => {
    const powloka = podlaczPowloke();
    const atrapa = atrapaRoutera();
    pulsMartwy();
    stop = startPreviewHeartbeat(atrapa.router);
    await vi.advanceTimersByTimeAsync(UTRATA_SESJI_MS + 100);

    await vi.advanceTimersByTimeAsync(RECOVERY_COOLDOWN_MS + 2 * PROBE_MAX_MS);

    expect(adresyPrzeladowan()).toHaveLength(1);
    // Eskalacja, nie powtórka: powłokę prosimy dokładnie raz.
    expect(powloka).toHaveBeenCalledTimes(1);
  });

  it("bez powłoki podglądu wygaśnięcie od razu przeładowuje dokument", async () => {
    // `window.parent === window` (podgląd otwarty jako zwykła karta): nie ma
    // kogo poprosić o przebudowę, więc plan B jest jedynym planem.
    const atrapa = atrapaRoutera();
    pulsMartwy();
    stop = startPreviewHeartbeat(atrapa.router);

    await vi.advanceTimersByTimeAsync(UTRATA_SESJI_MS + 100);

    expect(adresyPrzeladowan()).toHaveLength(1);
  });

  it("głucha powłoka nie blokuje odzyskania - moduł przechodzi do planu B", async () => {
    const powloka = podlaczGluchaPowloke();
    const atrapa = atrapaRoutera();
    pulsMartwy();
    stop = startPreviewHeartbeat(atrapa.router);

    await vi.advanceTimersByTimeAsync(UTRATA_SESJI_MS + 100);

    expect(powloka).toHaveBeenCalledTimes(1);
    expect(adresyPrzeladowan()).toHaveLength(1);
  });
});

describe("strażnik przeładowań: błąd nie może dać pętli", () => {
  it("przeładowanie wraca na TĘ SAMĄ trasę z omijaczem cache i z pozycją", async () => {
    const atrapa = atrapaRoutera();
    pulsWersji("build-1", "build-2");
    ustawPozycje(640);
    stop = startPreviewHeartbeat(atrapa.router);

    await vi.advanceTimersByTimeAsync(2 * HEALTHY_INTERVAL_MS);

    expect(adresyPrzeladowan()).toHaveLength(1);
    const url = new URL(adresyPrzeladowan()[0]);
    expect(url.origin + url.pathname).toBe(START_URL);
    // Omijacz cache jest funkcją samego zegara - stąd przewidywalna wartość.
    expect(url.searchParams.get("_pv")).toBe((TERAZ_MS + 2 * HEALTHY_INTERVAL_MS).toString(36));
    expect(czytajSnapshot()).toEqual({
      href: START_URL,
      scrollY: 640,
      atMs: TERAZ_MS + 2 * HEALTHY_INTERVAL_MS,
    });
    expect(window.sessionStorage.getItem(KLUCZ_STRAZNIKA)).toBe("1");
  });

  it(`przeładowań jest najwyżej ${MAKS_PRZELADOWAN} na kartę`, async () => {
    // Bez tego sufitu każda powtarzalna przyczyna (zepsuty endpoint wersji,
    // sandbox w pętli restartów) zamienia podgląd w migającą pętlę.
    const atrapa = atrapaRoutera();
    const stub = pulsCiaglychZmianBuilda();
    stop = startPreviewHeartbeat(atrapa.router);

    await vi.advanceTimersByTimeAsync(10 * HEALTHY_INTERVAL_MS + 100);

    expect(stub).toHaveBeenCalledTimes(10);
    expect(adresyPrzeladowan()).toHaveLength(MAKS_PRZELADOWAN);
    expect(window.sessionStorage.getItem(KLUCZ_STRAZNIKA)).toBe(String(MAKS_PRZELADOWAN));
  });

  it("licznik u sufitu blokuje przeładowanie od pierwszego pulsu", async () => {
    window.sessionStorage.setItem(KLUCZ_STRAZNIKA, String(MAKS_PRZELADOWAN));
    const atrapa = atrapaRoutera();
    pulsCiaglychZmianBuilda();
    stop = startPreviewHeartbeat(atrapa.router);

    await vi.advanceTimersByTimeAsync(3 * HEALTHY_INTERVAL_MS + 100);

    expect(adresyPrzeladowan()).toEqual([]);
  });

  it("uszkodzony licznik jest traktowany jak brak licznika", async () => {
    // Inaczej jedna śmieciowa wartość w magazynie odbierałaby podglądowi
    // zdolność do wyjścia z martwej sesji NA STAŁE.
    window.sessionStorage.setItem(KLUCZ_STRAZNIKA, "nie-liczba");
    const atrapa = atrapaRoutera();
    pulsWersji("build-1", "build-2");
    stop = startPreviewHeartbeat(atrapa.router);

    await vi.advanceTimersByTimeAsync(2 * HEALTHY_INTERVAL_MS + 100);

    expect(adresyPrzeladowan()).toHaveLength(1);
    expect(window.sessionStorage.getItem(KLUCZ_STRAZNIKA)).toBe("1");
  });

  it("zablokowany magazyn nie odbiera podglądowi możliwości odzyskania", async () => {
    // Tryb prywatny zabiera strażnika; wtedy lepiej przeładować bez licznika
    // niż zostawić człowieka z martwym podglądem.
    zablokujZapisy();
    const atrapa = atrapaRoutera();
    pulsWersji("build-1", "build-2");
    stop = startPreviewHeartbeat(atrapa.router);

    await vi.advanceTimersByTimeAsync(2 * HEALTHY_INTERVAL_MS + 100);

    expect(adresyPrzeladowan()).toHaveLength(1);
    // Brak snapshotu = przeładowanie na bieżący adres, nie na `undefined`.
    expect(new URL(adresyPrzeladowan()[0]).pathname).toBe("/analizy");
  });

  it("diagnostyka przeładowania podaje powód do konsoli podglądu", async () => {
    const ostrzezenia = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const atrapa = atrapaRoutera();
    pulsWersji("build-1", "build-2");
    stop = startPreviewHeartbeat(atrapa.router);

    await vi.advanceTimersByTimeAsync(2 * HEALTHY_INTERVAL_MS + 100);

    expect(ostrzezenia).toHaveBeenCalledWith("[preview-heartbeat] reload: build-changed");
  });

  it("na buildzie produkcyjnym diagnostyka milczy, ale przeładowanie działa", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const ostrzezenia = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const atrapa = atrapaRoutera();
    pulsWersji("build-1", "build-2");
    stop = startPreviewHeartbeat(atrapa.router);

    await vi.advanceTimersByTimeAsync(2 * HEALTHY_INTERVAL_MS + 100);

    expect(adresyPrzeladowan()).toHaveLength(1);
    expect(ostrzezenia).not.toHaveBeenCalled();
  });
});

describe("snapshot i jego termin ważności", () => {
  it("po przeładowaniu czytelnik wraca na swoją pozycję", async () => {
    zapiszSnapshot({ href: START_URL, scrollY: 640, atMs: TERAZ_MS - 1_000 });
    const przewijanie = sledzPrzewijanie(true);
    const atrapa = atrapaRoutera();
    stop = startPreviewHeartbeat(atrapa.router);

    await vi.advanceTimersByTimeAsync(0);

    expect(przewijanie).toHaveBeenCalledWith({ top: 640, behavior: "auto" });
  });

  it("przywracanie pozycji ponawia próby, gdy układ jeszcze rośnie", async () => {
    // Po hydratacji dokument potrafi urosnąć (obrazy, leniwe widgety), więc
    // jedno `scrollTo` na pustym jeszcze layoucie nic nie daje.
    zapiszSnapshot({ href: START_URL, scrollY: 640, atMs: TERAZ_MS });
    const przewijanie = sledzPrzewijanie();
    const atrapa = atrapaRoutera();
    stop = startPreviewHeartbeat(atrapa.router);

    await vi.advanceTimersByTimeAsync(0);
    expect(przewijanie).toHaveBeenCalledTimes(1);

    // ...ale ponawianie ma sufit - inaczej dokument, który nigdy nie dorośnie,
    // trzymałby czytelnika w pętli skoków.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(przewijanie).toHaveBeenCalledTimes(6);
  });

  it("gdy strona faktycznie dojechała, moduł przestaje przewijać", async () => {
    zapiszSnapshot({ href: START_URL, scrollY: 640, atMs: TERAZ_MS });
    const przewijanie = sledzPrzewijanie(true);
    const atrapa = atrapaRoutera();
    stop = startPreviewHeartbeat(atrapa.router);

    await vi.advanceTimersByTimeAsync(5_000);

    // Jedno skuteczne przewinięcie i koniec - nie walczymy z człowiekiem,
    // który zaraz przewinął gdzie indziej.
    expect(przewijanie).toHaveBeenCalledTimes(1);
  });

  it.each([
    { nazwa: "brak snapshotu", snapshot: null },
    {
      nazwa: "pozycja na początku strony",
      snapshot: { href: START_URL, scrollY: 0, atMs: TERAZ_MS },
    },
    {
      nazwa: "snapshot z INNEJ trasy",
      snapshot: { href: `https://${HOST_PODGLADU}/kontakt`, scrollY: 640, atMs: TERAZ_MS },
    },
    {
      nazwa: "snapshot starszy niż termin ważności",
      snapshot: { href: START_URL, scrollY: 640, atMs: TERAZ_MS - TTL_SNAPSHOTU_MS - 1 },
    },
  ])("nie przewija: $nazwa", async ({ snapshot }) => {
    if (snapshot) zapiszSnapshot(snapshot);
    const przewijanie = sledzPrzewijanie();
    const atrapa = atrapaRoutera();
    stop = startPreviewHeartbeat(atrapa.router);

    await vi.advanceTimersByTimeAsync(5_000);

    expect(przewijanie).not.toHaveBeenCalled();
  });

  it.each([
    { nazwa: "literalne `null`", surowe: "null" },
    { nazwa: "liczba zamiast obiektu", surowe: "42" },
    { nazwa: "brak trasy", surowe: JSON.stringify({ scrollY: 640, atMs: TERAZ_MS }) },
    {
      nazwa: "znacznik czasu nie jest liczbą",
      surowe: JSON.stringify({ href: START_URL, atMs: "wczoraj" }),
    },
  ])("uszkodzony snapshot ($nazwa) nie przewija i nie wywala startu", async ({ surowe }) => {
    window.sessionStorage.setItem(KLUCZ_SNAPSHOTU, surowe);
    const przewijanie = sledzPrzewijanie();
    const atrapa = atrapaRoutera();
    stop = startPreviewHeartbeat(atrapa.router);

    await vi.advanceTimersByTimeAsync(5_000);

    expect(przewijanie).not.toHaveBeenCalled();
    expect(readPreviewSnapshot(TERAZ_MS)).toBeNull();
  });

  it("snapshot bez pozycji czyta się jako początek strony", () => {
    zapiszSnapshot({ href: START_URL, atMs: TERAZ_MS });

    expect(readPreviewSnapshot(TERAZ_MS)).toEqual({
      href: START_URL,
      scrollY: 0,
      atMs: TERAZ_MS,
    });
  });
});

describe("granica kontekstu podglądu", () => {
  it("na domenie produkcyjnej moduł NIE startuje: zero pulsu, zero listenerów", async () => {
    // To jest najdroższa granica w tym pliku. Fałszywy start na produkcji
    // znaczyłby: przeładowania dokumentu u czytelników artykułów. Od starego
    // bundla jest tam osobny mechanizm (`cacheBusting.ts`).
    ustawLokalizacje(`https://${HOST_PRODUKCYJNY}/analizy`);
    const zapisy = sledzZapisy();
    const atrapa = atrapaRoutera();
    const stub = pulsWersji("build-1");

    stop = startPreviewHeartbeat(atrapa.router);
    await vi.advanceTimersByTimeAsync(5 * HEALTHY_INTERVAL_MS);
    atrapa.emitujNawigacje();
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("online"));

    expect(stub).not.toHaveBeenCalled();
    expect(atrapa.subscribe).not.toHaveBeenCalled();
    expect(zapisy).not.toHaveBeenCalled();
    expect(adresyPrzeladowan()).toEqual([]);
  });

  it("odmowa startu nie zużywa jednorazowej flagi - podgląd w iframie działa", async () => {
    // Kolejność jak w realnym życiu jednego izolatu: najpierw odmowa, potem
    // ten sam moduł w ramce panelu. Gdyby odmowa zapalała flagę `started`,
    // podgląd na własnej domenie nigdy by już nie wstał.
    ustawLokalizacje(`https://${HOST_PRODUKCYJNY}/analizy`);
    stop = startPreviewHeartbeat(atrapaRoutera().router);
    stop();

    podlaczPowloke();
    const atrapa = atrapaRoutera();
    const stub = pulsWersji("build-1");
    stop = startPreviewHeartbeat(atrapa.router);
    await vi.advanceTimersByTimeAsync(HEALTHY_INTERVAL_MS);

    expect(atrapa.subscribe).toHaveBeenCalledTimes(1);
    expect(stub).toHaveBeenCalledTimes(1);
  });
});

describe("cykl życia modułu", () => {
  it("drugie uruchomienie jest no-opem - pulsy i listenery nie mnożą się", async () => {
    const pierwszy = atrapaRoutera();
    const drugi = atrapaRoutera();
    const stub = pulsWersji("build-1");
    stop = startPreviewHeartbeat(pierwszy.router);

    const sprzataczkaNoOp = startPreviewHeartbeat(drugi.router);
    await vi.advanceTimersByTimeAsync(HEALTHY_INTERVAL_MS + 100);

    expect(drugi.subscribe).not.toHaveBeenCalled();
    expect(stub).toHaveBeenCalledTimes(1);

    // Sprzątaczka-atrapa z drugiego wywołania nie może zabić pierwszej
    // instancji - inaczej podwójne wywołanie efektu w Reactcie ubijałoby
    // działający heartbeat.
    sprzataczkaNoOp();
    expect(pierwszy.podpieci()).toBe(1);
    await vi.advanceTimersByTimeAsync(HEALTHY_INTERVAL_MS);
    expect(stub).toHaveBeenCalledTimes(2);
  });

  it("po sprzątnięciu nie zostaje ŻADNE wejście do sondowania", async () => {
    // Trzy wejścia do `run()`: licznik, `online`, `visibilitychange`. Ten test
    // zamyka wszystkie trzy naraz - i dlatego USTALA, że strażnik
    // `if (disposed) return` na wejściu `run()` (sessionHeartbeat.ts:214) jest
    // NIEOSIĄGALNY: po sprzątnięciu nie ma już czym do niego wejść. Realną
    // luką jest brak takiego strażnika PO `await` (patrz `it.fails` niżej).
    const zapisy = sledzZapisy();
    const atrapa = atrapaRoutera();
    const stub = pulsWersji("build-1");
    const sprzataczka = startPreviewHeartbeat(atrapa.router);

    sprzataczka();
    atrapa.emitujNawigacje();
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("online"));
    podmien(document, "visibilityState", "visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(20 * HEALTHY_INTERVAL_MS);

    // Niezdjęty licznik wisiałby do końca życia izolatu.
    expect(stub).not.toHaveBeenCalled();
    expect(atrapa.podpieci()).toBe(0);
    expect(zapisy).not.toHaveBeenCalled();
    expect(adresyPrzeladowan()).toEqual([]);
  });

  it("po sprzątnięciu moduł da się uruchomić ponownie", async () => {
    startPreviewHeartbeat(atrapaRoutera().router)();

    const atrapa = atrapaRoutera();
    const stub = pulsWersji("build-1");
    stop = startPreviewHeartbeat(atrapa.router);
    await vi.advanceTimersByTimeAsync(HEALTHY_INTERVAL_MS + 100);

    expect(atrapa.subscribe).toHaveBeenCalledTimes(1);
    expect(stub).toHaveBeenCalledTimes(1);
  });

  it("późna odpowiedź nie wznawia harmonogramu pulsu", async () => {
    const zawieszony = zawieszonyPuls();
    const atrapa = atrapaRoutera();
    const stub = stubujPuls((nr) =>
      nr === 0 ? Promise.resolve(wersja("build-1")) : zawieszony.obietnica,
    );
    const sprzataczka = startPreviewHeartbeat(atrapa.router);

    await vi.advanceTimersByTimeAsync(HEALTHY_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(HEALTHY_INTERVAL_MS);
    expect(stub).toHaveBeenCalledTimes(2);

    sprzataczka();
    zawieszony.rozwiaz(wersja("build-1"));
    await vi.advanceTimersByTimeAsync(20 * HEALTHY_INTERVAL_MS);

    // Sprzątaczka wygrywa z harmonogramem: żadnego trzeciego pulsu.
    expect(stub).toHaveBeenCalledTimes(2);
    expect(adresyPrzeladowan()).toEqual([]);
  });

  // DEFEKT ZGŁOSZONY, NIE NAPRAWIONY. `run()` w `sessionHeartbeat.ts:213-230`
  // sprawdza `disposed` na WEJŚCIU (linia 214) i w `schedule()` (linia 209),
  // ale NIE po `await probe(...)` (linia 218). Skutek: sonda, która była już
  // w drodze w chwili sprzątania, po powrocie nadal mutuje `state` i wykonuje
  // swój efekt - włącznie z `reload`.
  //
  // KONSEKWENCJA DLA CZŁOWIEKA: `__root.tsx:534-541` sprząta heartbeat w
  // funkcji czyszczącej efektu, czyli przy każdej zmianie tożsamości routera
  // i przy podwójnym wywołaniu efektu w trybie deweloperskim. Jeśli w tym
  // okienku wróci puls z innym `buildId`, moduł PRZEŁADOWUJE dokument, choć
  // został wyłączony - w środku pracy w podglądzie, bez powodu widocznego dla
  // człowieka (i zużywa jeden z pięciu żetonów strażnika).
  //
  // DLACZEGO TO DECYZJA DLA CZŁOWIEKA: naprawa (dodanie `if (disposed) return`
  // po `await`) zmienia zachowanie produkcyjne w ścieżce, która sama decyduje
  // o przeładowaniach - a wariant „sprzątnięto, ale odpowiedź niesie NOWY
  // build" ma dwa sensowne rozwiązania (zignorować albo przeładować mimo
  // sprzątnięcia, bo stary dokument i tak jest martwy) i wybór między nimi
  // jest decyzją o produkcie, nie o teście.
  it.fails("sprzątaczka ucina też skutki pulsu, który jest już w drodze", async () => {
    const zawieszony = zawieszonyPuls();
    const atrapa = atrapaRoutera();
    stubujPuls((nr) => (nr === 0 ? Promise.resolve(wersja("build-1")) : zawieszony.obietnica));
    const sprzataczka = startPreviewHeartbeat(atrapa.router);

    await vi.advanceTimersByTimeAsync(HEALTHY_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(HEALTHY_INTERVAL_MS);

    sprzataczka();
    zawieszony.rozwiaz(wersja("build-2"));
    await vi.advanceTimersByTimeAsync(0);

    expect(adresyPrzeladowan()).toEqual([]);
  });

  // DEFEKT ZGŁOSZONY, NIE NAPRAWIONY (ta sama rodzina, mniejsza szkoda).
  // `restoreScroll` (`sessionHeartbeat.ts:146-161`) planuje do sześciu tików
  // po 250 ms przez `window.setTimeout` i NIE zapisuje ich nigdzie, więc
  // sprzątaczka (linie 256-264) nie ma czego anulować.
  //
  // KONSEKWENCJA DLA CZŁOWIEKA: gdy heartbeat zostanie sprzątnięty w ciągu
  // pierwszej ~1,25 s po starcie (podwójne wywołanie efektu w dev, szybka
  // zmiana routera), wygaszony moduł nadal szarpie widok do zapamiętanej
  // pozycji - czyli walczy z człowiekiem, który właśnie zaczął przewijać.
  //
  // DLACZEGO TO DECYZJA DLA CZŁOWIEKA: `restoreScroll` jest funkcją MODUŁOWĄ,
  // wołaną przed powstaniem domknięcia z `disposed` (linia 190). Naprawa
  // wymaga przeniesienia jej do domknięcia albo dorobienia rejestru timerów -
  // czyli zmiany kształtu produkcyjnego modułu.
  it.fails("sprzątaczka zatrzymuje też ponawianie przewijania", async () => {
    zapiszSnapshot({ href: START_URL, scrollY: 640, atMs: TERAZ_MS });
    const przewijanie = sledzPrzewijanie();
    const atrapa = atrapaRoutera();
    const sprzataczka = startPreviewHeartbeat(atrapa.router);

    await vi.advanceTimersByTimeAsync(0);
    sprzataczka();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(przewijanie).toHaveBeenCalledTimes(1);
  });
});
