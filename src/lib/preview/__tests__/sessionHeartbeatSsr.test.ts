// @vitest-environment node
//
// Heartbeat podglądu poza przeglądarką: nic nie startuje, nic nie rzuca.
//
// CO TO DOWODZI. Ten moduł ma dwa wejścia, które mogą zostać zawołane bez
// DOM-u: `startPreviewHeartbeat` (dziś ładowany dynamicznie z efektu w
// `src/routes/__root.tsx:534`, ale jedno przeniesienie wyżej wystarczy, żeby
// wszedł do grafu SSR) i `readPreviewSnapshot`, które importuje się jak zwykły
// odczyt stanu. Bez strażników pierwsze dotknięcie `window`/`sessionStorage`
// na serwerze to ReferenceError W RENDERZE, czyli 500 na stronie - a nie
// zdegradowany podgląd. Ten plik dowodzi, że oba wejścia są bezpieczne, i to
// bez DOM-u, więc nie da się ich przypadkiem „naprawić" testem w happy-dom.
//
// PO CO OSOBNY PLIK ZE ŚRODOWISKIEM `node`. Gałąź `typeof window === "undefined"`
// (`sessionHeartbeat.ts:182`) jest w happy-dom NIEOSIĄGALNA - okno istnieje
// zawsze. W pliku obok stałaby jako jedyna niepokryta gałąź i wyglądała na
// dług, którym nie jest. Wzorzec z `src/lib/__tests__/smoothAnchorScrollSsr.test.ts`.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Zachowania w przeglądarce - to
// `previewSessionRecovery.test.ts`. Czystej funkcji `isPreviewContext` i
// odczytu świeżego/przeterminowanego snapshotu - to `sessionHeartbeat.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { readPreviewSnapshot, startPreviewHeartbeat } from "../sessionHeartbeat";

interface AtrapaRoutera {
  readonly subscribe: Mock<(zdarzenie: "onResolved", listener: () => void) => () => void>;
  readonly invalidate: Mock<() => void>;
}

function atrapaRoutera(): AtrapaRoutera {
  return {
    // Sygnatury jawne: `vi.fn()` bez nich jest typowane jako wywoływalne ORAZ
    // konstruowalne i nie spełnia wąskiego `PreviewHeartbeatRouter`.
    subscribe: vi.fn<(zdarzenie: "onResolved", listener: () => void) => () => void>(() => () => {}),
    invalidate: vi.fn<() => void>(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-21T10:00:00.000Z"));
  // Zero sieci także tutaj: gdyby strażnik `window` przepuścił, chcemy to
  // zobaczyć jako nieoczekiwane wywołanie sondy, a nie jako prawdziwy ruch.
  vi.stubGlobal("fetch", vi.fn<() => Promise<never>>());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("bez przeglądarki", () => {
  it("kanarek środowiska: nie ma ani `window`, ani `sessionStorage`", () => {
    // Bez tego cały plik mógłby przejść w happy-dom, nie dowodząc niczego.
    expect(typeof window).toBe("undefined");
    expect(typeof sessionStorage).toBe("undefined");
  });

  it("start heartbeatu jest no-opem: bez subskrypcji, bez sondy, bez wyjątku", async () => {
    const atrapa = atrapaRoutera();

    const sprzataczka = startPreviewHeartbeat(atrapa);
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(atrapa.subscribe).not.toHaveBeenCalled();
    expect(atrapa.invalidate).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(sprzataczka).toBeTypeOf("function");
    // Wywołanie zwróconej sprzątaczki jest równie bezpieczne - `__root.tsx`
    // woła ją bezwarunkowo w funkcji czyszczącej efektu.
    expect(() => sprzataczka()).not.toThrow();
  });

  it("odczyt snapshotu bez magazynu zwraca brak stanu, a nie wyjątek", () => {
    // `sessionStorage` na serwerze nie istnieje w ogóle (ReferenceError, nie
    // `undefined`), więc strażnikiem może być tylko `try/catch`.
    expect(readPreviewSnapshot()).toBeNull();
    expect(readPreviewSnapshot(Date.now())).toBeNull();
  });
});
