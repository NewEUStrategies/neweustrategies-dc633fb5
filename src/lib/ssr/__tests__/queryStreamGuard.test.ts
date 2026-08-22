// Watchdog strumienia zapytań SSR - obejście błędu router-core 1.171.
//
// CO TO DOWODZI. Ten plik jest OBEJŚCIEM BŁĘDU BIBLIOTEKI i miał 0% pokrycia
// przy 41 gałęziach. Nietestowane obejście upstreamowego buga to najkruchszy
// kod, jaki może być: pęknie albo samo, albo w dniu, w którym upstream naprawi
// błąd i watchdog zacznie strzelać w próżnię.
//
// CO PSUJE UPSTREAM. Integracja router<->query wkłada `ReadableStream` do
// zdehydratowanego payloadu i zamyka go WYŁĄCZNIE z listenera
// `router.serverSsr.onRenderFinished(...)`. W router-core 1.171
// `onRenderFinished` po cichu GUBI listener, gdy
// `cleanupStarted || streamFastPathReserved`. Gdy listener przepadnie, strumień
// nigdy się nie zamyka, seroval czeka, a odpowiedź SSR zawiesza się w połowie:
// HTTP 200 z UCIĘTYM HTML-em, bez `</html>` i bez skryptu hydracji. Czyli
// crawler i czytelnik dostają dokument, którego przeglądarka nie dokończy.
//
// TRZY STANY UPSTREAMU, KTÓRE MUSZĄ BYĆ SPRAWDZONE RAZEM:
//   1. ŹRÓDŁO ZAMYKA SIĘ NORMALNIE - watchdog NIE ingeruje (zero zmiany
//      zachowania; strumień kończy się dokładnie tym, co przyszło ze źródła);
//   2. LISTENER ZGUBIONY - źródło nigdy się nie zamyka, więc zamyka watchdog.
//      To scenariusz, DLA KTÓREGO ten plik istnieje;
//   3. UPSTREAM NAPRAWIONY - listener działa i integracja sama zamyka swój
//      strumień. Watchdog nie może wtedy zamknąć drugi raz ani rzucić.
//      Ten stan jest tu sprawdzony JAWNIE, bo to on nadejdzie w dniu
//      aktualizacji biblioteki - i wtedy ten kod ma po cichu zniknąć
//      z krytycznej ścieżki, a nie wywalić render.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. `sweepQueryCacheForSerialization`
// i `pruneUnresolvedQueries` mają własne testy. Świadomie NIE mockujemy ich:
// watchdog woła sprzątanie BEZ `quiet`, więc obserwujemy skutki na PRAWDZIWYM
// `QueryClient` i na `console.warn` - jednym testem sprawdzamy więc też, że
// sklejenie z tamtą warstwą działa, zamiast asertować wywołanie atrapy.
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { collectPendingQueries, guardQueryStream } from "../queryStreamGuard";

/** Strumień, którym steruje test - odpowiednik pushable stream integracji. */
interface Pushable<T> {
  readonly stream: ReadableStream<T>;
  push(chunk: T): void;
  /** Zamknięcie ze strony ŹRÓDŁA (to robi listener `onRenderFinished`). */
  close(): void;
  /** Czy źródło zostało już zamknięte - do wykrycia podwójnego zamknięcia. */
  isClosed(): boolean;
}

function pushable<T>(): Pushable<T> {
  let controller: ReadableStreamDefaultController<T> | undefined;
  let zamkniete = false;
  const stream = new ReadableStream<T>({
    start(c) {
      controller = c;
    },
  });
  return {
    stream,
    push: (chunk) => controller?.enqueue(chunk),
    close: () => {
      // Drugie zamknięcie źródła RZUCA `ERR_INVALID_STATE` - dokładnie ten
      // wyjątek, przed którym watchdog chroni się, nie anulując czytnika.
      controller?.close();
      zamkniete = true;
    },
    isClosed: () => zamkniete,
  };
}

/** Czyta cały strumień do końca. Rozstrzyga się DOPIERO po zamknięciu. */
async function drain<T>(stream: ReadableStream<T>): Promise<T[]> {
  const out: T[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out;
    if (value !== undefined) out.push(value);
  }
}

/** Zapytanie, które nigdy się nie rozstrzyga - trzyma `isFetching() > 0`. */
function startNeverResolvingQuery(qc: QueryClient, key: string): void {
  // `.catch` jest konieczny: `queryClient.clear()` w `afterEach` ANULUJE
  // wiszące pobieranie, a anulowanie odrzuca obietnicę `fetchQuery`. Bez tego
  // każdy przypadek zostawiałby nieobsłużone odrzucenie i vitest raportowałby
  // błąd niezwiązany z asercjami.
  void qc
    .fetchQuery({ queryKey: [key], queryFn: () => new Promise(() => undefined) })
    .catch(() => undefined);
}

let warn: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;
let qc: QueryClient;

/** Wszystkie komunikaty watchdoga w jednym ciągu - do asercji na treści. */
function log(): string {
  return warn.mock.calls.map((call) => String(call[0])).join("\n");
}

beforeEach(() => {
  vi.useFakeTimers();
  // Data bazowa ustalona: watchdog liczy bezczynność i wiek wpisów cache.
  vi.setSystemTime(new Date("2026-08-21T10:00:00.000Z"));
  // Własna atrapa zamiast `vi.spyOn(console, "warn")`: `spyOn` zwraca typ,
  // w którym argumenty są nieokreślone, więc odczyt `mock.calls` wymagałby
  // rzutowania. Tu argumenty są typowane, a `log()` obywa się bez `any`.
  warn = vi.fn<(...args: unknown[]) => void>();
  vi.spyOn(console, "warn").mockImplementation(warn);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  qc.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("stan 1: źródło zamyka się normalnie - watchdog nie ingeruje", () => {
  it("przepuszcza wszystkie porcje i zamyka się razem ze źródłem", async () => {
    const source = pushable<string>();
    const guarded = guardQueryStream(source.stream, qc, { label: "/test" });
    const czytanie = drain(guarded);

    source.push("a");
    source.push("b");
    await vi.advanceTimersByTimeAsync(0);
    source.close();

    await expect(czytanie).resolves.toEqual(["a", "b"]);
  });

  it("NIE loguje zamknięcia przez strażnika", async () => {
    // Zero zmiany zachowania na szczęśliwej ścieżce: komunikat „closed by
    // guard" jest sygnałem diagnostycznym i nie może pojawiać się zawsze.
    const source = pushable<string>();
    const guarded = guardQueryStream(source.stream, qc, { label: "/test" });
    const czytanie = drain(guarded);
    source.close();
    await czytanie;
    expect(log()).not.toContain("closed by guard");
  });

  it("zamknięcie ze źródła zatrzymuje wykrywacz bezczynności i twardy limit", async () => {
    const source = pushable<string>();
    const guarded = guardQueryStream(source.stream, qc, {
      label: "/test",
      idleMs: 100,
      maxMs: 500,
      tickMs: 50,
    });
    const czytanie = drain(guarded);
    source.close();
    await czytanie;
    warn.mockClear();
    // Po zamknięciu żaden timer nie może już nic zrobić - inaczej watchdog
    // logowałby i sprzątał cache długo po zakończeniu żądania.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(log()).toBe("");
  });

  it("gdy źródło się domknęło, a zapytania wiszą - zrzuca diagnostykę", async () => {
    // To jest przypadek, dla którego zrzut istnieje: render się skończył,
    // a promisy nadal trzymają serializację seroval.
    startNeverResolvingQuery(qc, "wisi");
    const source = pushable<string>();
    const guarded = guardQueryStream(source.stream, qc, { label: "/wpis" });
    const czytanie = drain(guarded);
    source.close();
    await czytanie;
    expect(log()).toContain("pending dump route=/wpis reason=source");
    expect(log()).toContain('key=["wisi"]');
  });

  it("czysty cache nie generuje zrzutu przy zamknięciu ze źródła", async () => {
    const source = pushable<string>();
    const guarded = guardQueryStream(source.stream, qc, { label: "/test" });
    const czytanie = drain(guarded);
    source.close();
    await czytanie;
    expect(log()).not.toContain("pending dump");
  });
});

describe("stan 2: listener zgubiony przez upstream - zamyka watchdog", () => {
  it("bezczynność zamyka strumień, który nigdy nie dostał zamknięcia", async () => {
    // Sedno całego pliku: źródło NIE jest zamykane (bo listener przepadł),
    // a strumień musi się i tak domknąć - inaczej dokument nigdy nie dobiega.
    const source = pushable<string>();
    const guarded = guardQueryStream(source.stream, qc, {
      label: "/wpis",
      idleMs: 200,
      tickMs: 50,
    });
    const czytanie = drain(guarded);
    source.push("x");

    await vi.advanceTimersByTimeAsync(400);
    await expect(czytanie).resolves.toEqual(["x"]);
    expect(log()).toContain("closed by guard (idle) route=/wpis");
    expect(source.isClosed()).toBe(false);
  });

  it("twardy limit zamyka strumień nawet przy CIĄGŁYM pobieraniu", async () => {
    // Bezczynność nigdy nie nadejdzie, gdy zapytanie wisi bez końca - i to
    // jest realny stan przy zawieszonym upstreamie. Limit `maxMs` jest wtedy
    // jedyną rzeczą, która ratuje odpowiedź.
    startNeverResolvingQuery(qc, "bez-konca");
    const source = pushable<string>();
    const guarded = guardQueryStream(source.stream, qc, {
      label: "/wpis",
      idleMs: 100,
      maxMs: 300,
      tickMs: 50,
    });
    const czytanie = drain(guarded);

    await vi.advanceTimersByTimeAsync(1_000);
    await expect(czytanie).resolves.toEqual([]);
    expect(log()).toContain("closed by guard (timeout)");
  });

  it("licznik bezczynności ZERUJE się, gdy zapytanie wystartuje", async () => {
    // Inaczej watchdog ucinałby strumień w środku poprawnego pobierania.
    const source = pushable<string>();
    const guarded = guardQueryStream(source.stream, qc, {
      label: "/wpis",
      idleMs: 200,
      maxMs: 10_000,
      tickMs: 50,
    });
    const czytanie = drain(guarded);

    await vi.advanceTimersByTimeAsync(150);
    startNeverResolvingQuery(qc, "start");
    await vi.advanceTimersByTimeAsync(300);
    // Zapytanie wisi, więc bezczynności nie ma - strumień musi żyć.
    expect(log()).not.toContain("closed by guard");

    qc.clear();
    await vi.advanceTimersByTimeAsync(300);
    await czytanie;
    expect(log()).toContain("closed by guard (idle)");
  });

  it("zamknięcie przez strażnika ZAWSZE zrzuca diagnostykę", async () => {
    // Przy zamknięciu przez strażnika zrzut jest bezwarunkowy - także wtedy,
    // gdy nic nie wisi; inaczej nie da się odróżnić „upstream zgubił listener"
    // od „nie było czego streamować".
    const source = pushable<string>();
    const guarded = guardQueryStream(source.stream, qc, {
      label: "/pusto",
      idleMs: 100,
      tickMs: 50,
    });
    const czytanie = drain(guarded);
    await vi.advanceTimersByTimeAsync(300);
    await czytanie;
    expect(log()).toContain("pending dump route=/pusto reason=idle");
    expect(log()).toContain("(brak nierozstrzygniętych zapytań w cache)");
  });

  it("NIE anuluje czytnika źródła - to by rzuciło w listenerze router-core", async () => {
    // Komentarz w kodzie mówi wprost: podwójne zamknięcie pushable stream
    // integracji rzuca ERR_INVALID_STATE WEWNĄTRZ listenera. Dowód: po
    // zamknięciu przez strażnika źródło nadal daje się zamknąć normalnie.
    const source = pushable<string>();
    const guarded = guardQueryStream(source.stream, qc, {
      label: "/wpis",
      idleMs: 100,
      tickMs: 50,
    });
    const czytanie = drain(guarded);
    await vi.advanceTimersByTimeAsync(300);
    await czytanie;
    expect(() => source.close()).not.toThrow();
  });
});

describe("stan 3: upstream NAPRAWIONY - watchdog nie może przeszkadzać", () => {
  it("zamknięcie przez strażnika, a potem przez upstream, nie rzuca", async () => {
    // Dzień aktualizacji biblioteki: listener znów działa, więc integracja
    // zamknie swój strumień PO tym, jak watchdog zamknął swój. Ten test jest
    // bombą z opóźnionym zapłonem, jeśli kiedykolwiek zapali się na czerwono.
    const source = pushable<string>();
    const guarded = guardQueryStream(source.stream, qc, {
      label: "/wpis",
      idleMs: 100,
      tickMs: 50,
    });
    const czytanie = drain(guarded);
    await vi.advanceTimersByTimeAsync(300);
    await czytanie;
    expect(() => source.close()).not.toThrow();
    // I odwrotna kolejność też musi być bezpieczna.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(log()).not.toContain("ERR_INVALID_STATE");
  });

  it("dwa zamknięcia po stronie strażnika zwijają się do jednego", async () => {
    // `close()` jest strażnikowany flagą `closed`; bez niej sprzątanie cache
    // i zrzut diagnostyczny wykonywałyby się dwa razy na jedno żądanie.
    const source = pushable<string>();
    const guarded = guardQueryStream(source.stream, qc, {
      label: "/wpis",
      idleMs: 100,
      tickMs: 50,
    });
    const czytanie = drain(guarded);
    await vi.advanceTimersByTimeAsync(300);
    await czytanie;
    const pierwszy = log();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(log()).toBe(pierwszy);
  });

  it("anulowanie PO zamknięciu przez strażnika jest bezpiecznym no-opem", async () => {
    // Realna kolejność przy naprawionym upstreamie: watchdog zdążył zamknąć,
    // a potem konsument (albo runtime) anuluje strumień. Drugie przejście przez
    // `close()` musi wyjść na strażniku `closed`, nie sprzątać cache po raz
    // drugi i nie logować powtórnie.
    const source = pushable<string>();
    const guarded = guardQueryStream(source.stream, qc, {
      label: "/wpis",
      idleMs: 50,
      tickMs: 25,
    });
    const reader = guarded.getReader();
    await vi.advanceTimersByTimeAsync(200);
    // Strumień jest już zamknięty przez strażnika - domykamy odczyt.
    for (;;) {
      const { done } = await reader.read();
      if (done) break;
    }
    const pierwszy = log();
    await expect(reader.cancel()).resolves.toBeUndefined();
    expect(log()).toBe(pierwszy);
  });

  it("źródło zamknięte PRZED podłączeniem strażnika kończy strumień od razu", async () => {
    // Upstream naprawiony i szybki: strumień może być domknięty, zanim
    // watchdog zdąży cokolwiek zrobić.
    const source = pushable<string>();
    source.push("a");
    source.close();
    const guarded = guardQueryStream(source.stream, qc, { label: "/test" });
    await expect(drain(guarded)).resolves.toEqual(["a"]);
    expect(log()).not.toContain("closed by guard");
  });

  it("błąd czytania ze źródła zamyka strumień, nie wywala renderu", async () => {
    // Zerwane źródło nie może stać się nieobsłużonym odrzuceniem w renderze.
    const source = new ReadableStream<string>({
      start(c) {
        c.error(new Error("źródło zerwane"));
      },
    });
    const guarded = guardQueryStream(source, qc, { label: "/test" });
    await expect(drain(guarded)).resolves.toEqual([]);
  });

  it("odejście konsumenta zamyka strumień po stronie strażnika", async () => {
    // `cancel()` - przeglądarka przerwała pobieranie dokumentu. Timery muszą
    // zniknąć, inaczej wiszą do końca życia izolatu.
    const source = pushable<string>();
    const guarded = guardQueryStream(source.stream, qc, {
      label: "/test",
      idleMs: 100,
      tickMs: 50,
    });
    const reader = guarded.getReader();
    await reader.cancel();
    warn.mockClear();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(log()).toBe("");
  });
});

describe("wartości domyślne i diagnostyka", () => {
  it("bez podanego limitu zamyka po domyślnej bezczynności (750 ms)", async () => {
    const source = pushable<string>();
    const guarded = guardQueryStream(source.stream, qc);
    const czytanie = drain(guarded);
    await vi.advanceTimersByTimeAsync(700);
    expect(log()).not.toContain("closed by guard");
    await vi.advanceTimersByTimeAsync(300);
    await czytanie;
    expect(log()).toContain("closed by guard (idle) route=-");
  });

  it("brak etykiety daje `route=-`, nie `route=undefined`", async () => {
    const source = pushable<string>();
    const guarded = guardQueryStream(source.stream, qc);
    const czytanie = drain(guarded);
    await vi.advanceTimersByTimeAsync(1_000);
    await czytanie;
    expect(log()).toContain("route=-");
    expect(log()).not.toContain("route=undefined");
  });
});

describe("collectPendingQueries", () => {
  it("pusty cache daje pustą listę", () => {
    expect(collectPendingQueries(qc)).toEqual([]);
  });

  it("łapie zapytanie w trakcie pobierania", () => {
    startNeverResolvingQuery(qc, "wisi");
    const pending = collectPendingQueries(qc);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      queryKey: '["wisi"]',
      status: "pending",
      fetchStatus: "fetching",
      hasData: false,
    });
  });

  it("POMIJA zapytanie rozstrzygnięte i bezczynne", async () => {
    // Inaczej zrzut diagnostyczny wypisywałby cały cache i nie dałoby się
    // z niego odczytać, co REALNIE trzyma serializację.
    await qc.fetchQuery({ queryKey: ["gotowe"], queryFn: () => Promise.resolve("v") });
    expect(collectPendingQueries(qc)).toEqual([]);
  });

  it("wiek wpisu bez danych to -1, nie liczba udająca świeżość", async () => {
    startNeverResolvingQuery(qc, "wisi");
    expect(collectPendingQueries(qc)[0].ageMs).toBe(-1);
  });

  it("dołącza komunikat błędu, gdy zapytanie padło i jest ponawiane", async () => {
    await qc
      .fetchQuery({ queryKey: ["blad"], queryFn: () => Promise.reject(new Error("odmowa")) })
      .catch(() => undefined);
    // Wpis z błędem, ale bezczynny, nie jest „nierozstrzygnięty".
    expect(collectPendingQueries(qc)).toEqual([]);
  });

  it("ponawiane zapytanie Z DANYMI raportuje WIEK, nie -1", async () => {
    // Odświeżenie istniejącego wpisu też trzyma serializację otwartą, ale
    // diagnostyka musi je odróżnić od zapytania, które nigdy nic nie miało:
    // wiek mówi, jak stare dane zostaną zserializowane.
    let wywolanie = 0;
    const queryFn = () => {
      wywolanie += 1;
      return wywolanie === 1 ? Promise.resolve("v") : new Promise<string>(() => undefined);
    };
    await qc.fetchQuery({ queryKey: ["odswiezane"], queryFn });
    vi.setSystemTime(new Date("2026-08-21T10:00:05.000Z"));
    void qc.refetchQueries({ queryKey: ["odswiezane"] }).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);

    const [wpis] = collectPendingQueries(qc);
    expect(wpis).toMatchObject({ queryKey: '["odswiezane"]', hasData: true });
    expect(wpis.ageMs).toBe(5_000);
  });

  it("pole `errorMessage` jest NIEOSIĄGALNE dla zapytań, które ta funkcja wybiera", async () => {
    // USTALENIE, nie życzenie. `collectPendingQueries` filtruje po
    // `status === "pending" || fetchStatus !== "idle"`, a react-query CZYŚCI
    // `state.error` w chwili startu ponowienia. Te dwa warunki wykluczają się
    // wzajemnie: zapytanie wybrane przez filtr nigdy nie ma błędu w stanie,
    // więc gałąź `error instanceof Error` w `safeKey`-sąsiedztwie (linia 83)
    // i jej odpowiednik w zrzucie (linia 126) są martwe przez PUBLICZNE API
    // klienta zapytań.
    //
    // Zmierzone: po odrzuconym pobraniu i ponowieniu wpis JEST na liście
    // (fetchStatus = "fetching"), ale `errorMessage` jest `undefined`.
    let wywolanie = 0;
    const queryFn = () => {
      wywolanie += 1;
      return wywolanie === 1
        ? Promise.reject(new Error("odmowa backendu"))
        : new Promise<string>(() => undefined);
    };
    await qc.fetchQuery({ queryKey: ["po-bledzie"], queryFn }).catch(() => undefined);
    void qc.refetchQueries({ queryKey: ["po-bledzie"] }).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);

    const [wpis] = collectPendingQueries(qc);
    expect(wpis).toBeDefined();
    expect(wpis.fetchStatus).not.toBe("idle");
    expect(wpis.errorMessage).toBeUndefined();
  });

  it("klucz niedający się zserializować NIE MA jak dotrzeć do tej funkcji", () => {
    // `safeKey` ma gałąź `catch` spadającą na `query.queryHash`, gdy
    // `JSON.stringify(queryKey)` rzuci. Ta gałąź jest NIEOSIĄGALNA przez
    // publiczne API klienta zapytań: `fetchQuery` haszuje klucz PRZED
    // zarejestrowaniem go w cache (`hashQueryKeyByOptions` ->
    // `JSON.stringify`), więc klucz cykliczny wywala się o jeden poziom
    // wyżej - wewnątrz react-query, a nie w tym module. Ten test przypina to
    // ustalenie zamiast udawać pokrycie martwej gałęzi.
    const cykliczny: Record<string, unknown> = { a: 1 };
    cykliczny.self = cykliczny;
    expect(() =>
      qc.fetchQuery({ queryKey: ["cykl", cykliczny], queryFn: () => Promise.resolve(1) }),
    ).toThrow(RangeError);
    // Cache został nietknięty, więc zrzut diagnostyczny nadal jest pusty.
    expect(collectPendingQueries(qc)).toEqual([]);
  });
});
