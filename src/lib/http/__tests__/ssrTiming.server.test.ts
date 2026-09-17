// @vitest-environment node
//
// Telemetria DB per żądanie SSR: `recordDbRoundTrip` / `readDbTiming`
// (`src/lib/http/ssrTiming.server.ts`) plus składanie nagłówka
// `buildServerTimingValue` (`src/lib/http/ssrTiming.ts`), bo to jedna ścieżka
// produkcyjna: `documentCache.server.ts:603` czyta migawkę i wstawia ją do
// `server-timing` w :375.
//
// DLACZEGO TE DWA PLIKI NIE MIAŁY ANI JEDNEGO TESTU, ZANIM POWSTAŁ TEN. Jedyny
// test, który w ogóle wspominał ten moduł, MOCKOWAŁ GO NA WYLOT:
// `src/integrations/supabase/__tests__/tenantHostFetch.test.ts` robi
// `vi.mock("@/lib/http/ssrTiming.server", () => ({ recordDbRoundTrip: vi.fn() }))`,
// więc nie wykonywała się z niego ani jedna linia. A moduł JEST na gorącej
// ścieżce każdego dokumentu: na artefakcie produkcyjnym zmierzyłem realny
// nagłówek `nes-edge;desc="MISS", ssr;dur=5279.0, db;dur=262.0;desc="n=18"` -
// czyli 18 round-tripów i 262 ms bazy na jeden render strony głównej. To jedyny
// instrument kosztu bazy, jaki to wdrożenie ma.
//
// `getRequest` jest mockowany, bo prawdziwy pochodzi z AsyncLocalStorage
// TanStack Start i poza żądaniem HTTP rzuca - a to jest właśnie jedna
// z testowanych gałęzi (`activeRequest`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildServerTimingValue } from "../ssrTiming";
import {
  readDbTiming,
  readRequestPhases,
  recordDbRoundTrip,
  recordRequestPhase,
} from "../ssrTiming.server";

const ctx = vi.hoisted(() => ({
  /** Co ma zwrócić `getRequest()`. */
  request: null as Request | null,
  /** Gdy ustawione, `getRequest()` rzuca tym błędem (ścieżka dev/vitest). */
  throws: null as Error | null,
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => {
    if (ctx.throws) throw ctx.throws;
    return ctx.request;
  },
}));

/** Nowy, unikalny Request - klucz WeakMapy w module musi być świeży. */
function req(path = "/en"): Request {
  return new Request(`https://nes.test${path}`);
}

beforeEach(() => {
  ctx.request = null;
  ctx.throws = null;
});

afterEach(() => {
  ctx.request = null;
  ctx.throws = null;
});

describe("recordDbRoundTrip - kontekst żądania", () => {
  it("jest cichym no-opem, gdy getRequest() rzuca (dev, vitest, skrypty CLI)", () => {
    const request = req();
    ctx.throws = new Error("No request context available");
    expect(() => recordDbRoundTrip(42)).not.toThrow();
    ctx.throws = null;
    // Nic nie zostało nigdzie zapisane - także pod tym Requestem.
    expect(readDbTiming(request)).toBeNull();
  });

  it("jest cichym no-opem, gdy getRequest() zwraca null", () => {
    ctx.request = null;
    expect(() => recordDbRoundTrip(42)).not.toThrow();
    expect(readDbTiming(req())).toBeNull();
  });

  it("jest cichym no-opem, gdy getRequest() zwraca undefined (`?? null` w activeRequest)", () => {
    // `getRequest()` w mocku zwraca `ctx.request`; ustawiony na undefined
    // przechodzi przez `?? null` i musi dać tę samą, cichą ścieżkę.
    ctx.request = undefined as unknown as Request | null;
    expect(() => recordDbRoundTrip(7)).not.toThrow();
  });
});

describe("recordDbRoundTrip - akumulacja", () => {
  it("pierwszy round-trip zakłada wpis {count: 1, totalMs: dur}", () => {
    const request = req();
    ctx.request = request;
    recordDbRoundTrip(12.5);
    expect(readDbTiming(request)).toEqual({ count: 1, totalMs: 12.5 });
  });

  it("kolejne round-tripy tego samego żądania sumują się", () => {
    const request = req();
    ctx.request = request;
    recordDbRoundTrip(10);
    recordDbRoundTrip(20);
    recordDbRoundTrip(30.5);
    expect(readDbTiming(request)).toEqual({ count: 3, totalMs: 60.5 });
  });

  it("zero milisekund liczy się jako round-trip (koszt to liczba wywołań, nie tylko czas)", () => {
    const request = req();
    ctx.request = request;
    recordDbRoundTrip(0);
    recordDbRoundTrip(0);
    expect(readDbTiming(request)).toEqual({ count: 2, totalMs: 0 });
  });
});

describe("izolacja per żądanie (cały powód istnienia WeakMapy na Request)", () => {
  it("dwa równoległe żądania nie widzą sum siebie nawzajem", () => {
    const a = req("/en");
    const b = req("/blog");

    ctx.request = a;
    recordDbRoundTrip(100);
    ctx.request = b;
    recordDbRoundTrip(1);
    recordDbRoundTrip(2);
    ctx.request = a;
    recordDbRoundTrip(100);

    expect(readDbTiming(a)).toEqual({ count: 2, totalMs: 200 });
    expect(readDbTiming(b)).toEqual({ count: 2, totalMs: 3 });
  });

  it("dwa Requesty o IDENTYCZNYM URL-u to nadal dwa różne konteksty", () => {
    // Klucz to TOŻSAMOŚĆ obiektu, nie URL - inaczej dwa równoległe rendery tej
    // samej ścieżki zlałyby się w jeden licznik.
    const first = new Request("https://nes.test/en");
    const second = new Request("https://nes.test/en");
    ctx.request = first;
    recordDbRoundTrip(5);
    expect(readDbTiming(first)).toEqual({ count: 1, totalMs: 5 });
    expect(readDbTiming(second)).toBeNull();
  });
});

describe("readDbTiming", () => {
  it("zwraca null dla żądania, w którym nic nie zmierzono", () => {
    expect(readDbTiming(req("/nieznane"))).toBeNull();
  });

  it("zwraca MIGAWKĘ, nie żywy wpis - późniejszy round-trip jej nie zmienia", () => {
    // Kontrakt wobec documentCache.server.ts:603: migawka wpisana do nagłówka
    // musi opisywać stan z chwili odczytu, nawet gdy render dopisuje dalej.
    const request = req();
    ctx.request = request;
    recordDbRoundTrip(10);

    const snapshot = readDbTiming(request);
    expect(snapshot).toEqual({ count: 1, totalMs: 10 });

    recordDbRoundTrip(90);
    expect(snapshot).toEqual({ count: 1, totalMs: 10 });
    expect(readDbTiming(request)).toEqual({ count: 2, totalMs: 100 });
  });

  it("mutacja zwróconej migawki nie psuje licznika w module", () => {
    const request = req();
    ctx.request = request;
    recordDbRoundTrip(10);

    const snapshot = readDbTiming(request);
    expect(snapshot).not.toBeNull();
    if (snapshot) {
      snapshot.count = 999;
      snapshot.totalMs = -1;
    }
    expect(readDbTiming(request)).toEqual({ count: 1, totalMs: 10 });
  });
});

describe("round-trip do nagłówka: record -> read -> buildServerTimingValue", () => {
  it("odtwarza nagłówek zmierzony na artefakcie produkcyjnym", () => {
    // Zmierzone na `node .output/server/index.mjs` (build vite.smoke.config.ts),
    // pierwszy dokument /en: 18 round-tripów, 262 ms bazy, render 5279 ms.
    const request = req();
    ctx.request = request;
    for (let i = 0; i < 18; i += 1) recordDbRoundTrip(262 / 18);

    const db = readDbTiming(request);
    expect(db?.count).toBe(18);
    expect(db?.totalMs).toBeCloseTo(262, 6);
    expect(buildServerTimingValue("MISS", 5279, db)).toBe(
      'nes-edge;desc="MISS", ssr;dur=5279.0, db;dur=262.0;desc="n=18"',
    );
  });

  it("pomija `db;dur=` całkowicie, gdy w żądaniu nie było ani jednego round-tripu", () => {
    const db = readDbTiming(req("/bez-bazy"));
    expect(db).toBeNull();
    expect(buildServerTimingValue("HIT", 3.25, db, 900_000)).toBe(
      'nes-edge;desc="HIT", ssr;dur=3.3, nes-age;dur=900000',
    );
  });

  it("pomija `ssr;dur=` dla wartości niefinitywnej i `nes-age;dur=` dla ujemnej", () => {
    expect(buildServerTimingValue("STALE", Number.NaN, null, -1)).toBe('nes-edge;desc="STALE"');
    expect(buildServerTimingValue("STALE", Number.POSITIVE_INFINITY, null, Number.NaN)).toBe(
      'nes-edge;desc="STALE"',
    );
  });

  it("zawsze wystawia `nes-edge;desc=` - nawet bez żadnego innego pomiaru", () => {
    expect(buildServerTimingValue("BYPASS")).toBe('nes-edge;desc="BYPASS"');
  });

  it("zaokrągla wiek wpisu do pełnych milisekund", () => {
    expect(buildServerTimingValue("HIT", undefined, null, 1234.6)).toBe(
      'nes-edge;desc="HIT", nes-age;dur=1235',
    );
  });
});

describe("invalid timing samples do not poison the header", () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1])(
    "ignores an invalid DB sample: %s",
    (sample) => {
      const request = req();
      ctx.request = request;
      recordDbRoundTrip(sample);
      expect(readDbTiming(request)).toBeNull();
      recordDbRoundTrip(10);
      recordDbRoundTrip(sample);
      expect(readDbTiming(request)).toEqual({ count: 1, totalMs: 10 });
      expect(buildServerTimingValue("MISS", 1, readDbTiming(request))).toBe(
        'nes-edge;desc="MISS", ssr;dur=1.0, db;dur=10.0;desc="n=1"',
      );
    },
  );
  it.each([
    { count: 1, totalMs: Number.NaN },
    { count: 1, totalMs: Number.POSITIVE_INFINITY },
    { count: 1, totalMs: -1 },
    { count: Number.POSITIVE_INFINITY, totalMs: 1 },
    { count: 1.5, totalMs: 1 },
    { count: 0, totalMs: 1 },
  ])("omits only the malformed DB segment: %j", (db) => {
    expect(buildServerTimingValue("HIT", 2, db, 3)).toBe(
      'nes-edge;desc="HIT", ssr;dur=2.0, nes-age;dur=3',
    );
  });
  it("omits a negative render duration while retaining valid measurements", () => {
    expect(buildServerTimingValue("HIT", -1, { count: 1, totalMs: 0 }, 0)).toBe(
      'nes-edge;desc="HIT", db;dur=0.0;desc="n=1", nes-age;dur=0',
    );
  });
});

// FAZY POTOKU (`edge-routing`) - druga, niezależna oś tej telemetrii.
//
// PO CO ISTNIEJE, skoro `db;dur` już jest. `db;dur` mierzy KOSZT planu anon
// (suma czasów round-tripów) i wyłącznie w trakcie renderu. Odcinek PRZED
// routerem - katalog tenantów i indeks przekierowań, oba planem service-role,
// oba SZEREGOWO i oba PRZED konsultacją NES Edge Cache - nie wchodzi tam
// w ogóle. Na produkcji z TTFB p75 = 2,5-3,2 s to jest właśnie ten odcinek,
// o którym nagłówek dotąd milczał: mieścił się w różnicy `app;dur - ssr;dur`
// razem z siecią i całą resztą middleware.
describe("recordRequestPhase / readRequestPhases", () => {
  it("zapisuje fazę i oddaje ją migawką", () => {
    const request = req("/faza");
    recordRequestPhase(request, "edge-routing", 12.5);
    expect(readRequestPhases(request)).toEqual([{ name: "edge-routing", durationMs: 12.5 }]);
  });

  it("powtórzone wywołanie tej samej fazy SUMUJE - faza może biec w odcinkach", () => {
    const request = req("/suma");
    recordRequestPhase(request, "edge-routing", 10);
    recordRequestPhase(request, "edge-routing", 5);
    expect(readRequestPhases(request)).toEqual([{ name: "edge-routing", durationMs: 15 }]);
  });

  it("dwa żądania nie widzą faz siebie nawzajem", () => {
    const a = req("/a");
    const b = req("/b");
    recordRequestPhase(a, "edge-routing", 40);
    expect(readRequestPhases(b)).toEqual([]);
    expect(readRequestPhases(a)).toEqual([{ name: "edge-routing", durationMs: 40 }]);
  });

  it("zwraca MIGAWKĘ - mutacja wyniku nie psuje licznika w module", () => {
    const request = req("/migawka");
    recordRequestPhase(request, "edge-routing", 7);
    const snapshot = readRequestPhases(request);
    snapshot[0]!.durationMs = 9999;
    expect(readRequestPhases(request)).toEqual([{ name: "edge-routing", durationMs: 7 }]);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
    "odrzuca próbkę nie do użycia: %s",
    (sample) => {
      const request = req("/zla-probka");
      recordRequestPhase(request, "edge-routing", sample);
      expect(readRequestPhases(request)).toEqual([]);
    },
  );

  it("limit faz per żądanie chroni przed pętlą w wołającym", () => {
    const request = req("/limit");
    for (let i = 0; i < 40; i += 1) recordRequestPhase(request, `faza-${i}`, 1);
    expect(readRequestPhases(request).length).toBeLessThanOrEqual(8);
  });
});

describe("fazy w nagłówku Server-Timing", () => {
  it("dopisują się NA KOŃCU, za istniejącymi metrykami", () => {
    expect(
      buildServerTimingValue("MISS", 674, { count: 19, totalMs: 2697 }, undefined, [
        { name: "edge-routing", durationMs: 284.2 },
      ]),
    ).toBe(
      'nes-edge;desc="MISS", ssr;dur=674.0, db;dur=2697.0;desc="n=19", edge-routing;dur=284.2',
    );
  });

  it("trafiają też na HIT - routing krawędziowy biegnie PRZED cache'em dokumentów", () => {
    // To jest cały powód, dla którego ta metryka istnieje: gorące trafienie
    // w cache NIE omija odczytu routingu, więc nagłówek pokazujący ją tylko
    // na MISS-ie mówiłby nieprawdę o koszcie HIT-a.
    expect(
      buildServerTimingValue("HIT", undefined, null, 1200, [
        { name: "edge-routing", durationMs: 3 },
      ]),
    ).toBe('nes-edge;desc="HIT", nes-age;dur=1200, edge-routing;dur=3.0');
  });

  it("brak faz nie zmienia nagłówka ani o bajt (zgodność wsteczna)", () => {
    expect(buildServerTimingValue("MISS", 10, null, undefined, [])).toBe(
      buildServerTimingValue("MISS", 10, null),
    );
    expect(buildServerTimingValue("MISS", 10, null, undefined, null)).toBe(
      buildServerTimingValue("MISS", 10, null),
    );
  });

  it.each(["edge routing", "edge;routing", 'edge"routing', "", "a".repeat(33)])(
    "nazwa spoza tokenu jest POMIJANA, nie wypuszczana (%s psułoby parsowanie całego nagłówka)",
    (name) => {
      expect(
        buildServerTimingValue("MISS", undefined, null, undefined, [{ name, durationMs: 5 }]),
      ).toBe('nes-edge;desc="MISS"');
    },
  );

  it("odrzuca czas fazy nie do użycia", () => {
    expect(
      buildServerTimingValue("MISS", undefined, null, undefined, [
        { name: "edge-routing", durationMs: Number.NaN },
        { name: "inna-faza", durationMs: -1 },
      ]),
    ).toBe('nes-edge;desc="MISS"');
  });
});
