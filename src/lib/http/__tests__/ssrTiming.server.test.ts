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

import {
  buildDocumentLogLine,
  buildEntryServerTimingValue,
  buildServerTimingValue,
  classifyUserAgent,
  observeBodyEnd,
  parseServerTiming,
  resolveRequestColo,
  sanitizeRay,
  type BodyEndOutcome,
  type DocumentStoreOutcome,
  type NesCacheLayer,
} from "../ssrTiming";
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

// LOG DOKUMENTU DO WORKERS LOGS (audyt 0.1 / F40) - trzecia oś tej telemetrii.
//
// Hosting zdejmuje `Server-Timing` i `x-nes-cache` z odpowiedzi, więc jedyne
// miejsce, w którym rozkład TTFB na fazy przeżywa, to linia `console.log`
// w `src/server.ts`. Jej KSZTAŁT jest tu przypięty jako czysta funkcja: klucze
// stałe, brak metryki = brak klucza (nie zero), bez PII i bez query string.
describe("parseServerTiming", () => {
  it("rozbija nagłówek, który sami wystawiamy, na metryki z dur/desc", () => {
    expect(
      parseServerTiming(
        'nes-edge;desc="MISS", ssr;dur=674.0, db;dur=2697.0;desc="n=19", nes-age;dur=1200, edge-routing;dur=284.2, server-init;dur=0, app;dur=37',
      ),
    ).toEqual([
      { name: "nes-edge", description: "MISS" },
      { name: "ssr", durationMs: 674 },
      { name: "db", durationMs: 2697, description: "n=19" },
      { name: "nes-age", durationMs: 1200 },
      { name: "edge-routing", durationMs: 284.2 },
      { name: "server-init", durationMs: 0 },
      { name: "app", durationMs: 37 },
    ]);
  });

  it("przecinek W cudzysłowie nie rozcina metryki", () => {
    expect(parseServerTiming('x;desc="a, b", y;dur=1')).toEqual([
      { name: "x", description: "a, b" },
      { name: "y", durationMs: 1 },
    ]);
  });

  it.each([null, undefined, "", "   ", ",,,", ";dur=1", "bad name;dur=1"])(
    "nie rzuca i pomija nieczytelne wpisy: %j",
    (header) => {
      expect(parseServerTiming(header)).toEqual([]);
    },
  );

  it("odrzuca `dur`, który nie jest nieujemną liczbą, zachowując nazwę metryki", () => {
    expect(parseServerTiming("ssr;dur=abc, db;dur=-1, ok;dur=2.5")).toEqual([
      { name: "ssr" },
      { name: "db" },
      { name: "ok", durationMs: 2.5 },
    ]);
  });
});

describe("buildDocumentLogLine", () => {
  it("odtwarza pełną linię dla MISS-a z zimnego izolatu (wszystkie fazy)", () => {
    expect(
      buildDocumentLogLine({
        path: "/en/blog",
        status: 200,
        cacheStatus: "MISS",
        serverTiming: buildServerTimingValue("MISS", 674, { count: 19, totalMs: 2697 }, undefined, [
          { name: "edge-routing", durationMs: 284.2 },
        ]),
        serverInitMs: 412,
        appMs: 3105,
      }),
    ).toEqual({
      kind: "doc",
      path: "/en/blog",
      status: 200,
      cache: "MISS",
      revalidation: false,
      serverInitMs: 412,
      appMs: 3105,
      edgeRoutingMs: 284.2,
      ssrMs: 674,
      dbMs: 2697,
      dbCount: 19,
    });
  });

  it("na HIT-cie nie wymyśla zer: brak renderu i bazy = brak kluczy", () => {
    const line = buildDocumentLogLine({
      path: "/",
      status: 200,
      cacheStatus: "HIT",
      serverTiming: buildServerTimingValue("HIT", undefined, null, 1200, [
        { name: "edge-routing", durationMs: 3 },
      ]),
      serverInitMs: 0,
      appMs: 5,
    });
    expect(line).toEqual({
      kind: "doc",
      path: "/",
      status: 200,
      cache: "HIT",
      revalidation: false,
      serverInitMs: 0,
      appMs: 5,
      edgeRoutingMs: 3,
    });
    expect("ssrMs" in line).toBe(false);
    expect("dbMs" in line).toBe(false);
  });

  it("flaguje odświeżenie w tle i toleruje brak nagłówków", () => {
    expect(
      buildDocumentLogLine({
        path: "/blog",
        status: 200,
        cacheStatus: null,
        serverTiming: null,
        serverInitMs: 0,
        appMs: 812,
        revalidation: true,
      }),
    ).toEqual({
      kind: "doc",
      path: "/blog",
      status: 200,
      cache: null,
      revalidation: true,
      serverInitMs: 0,
      appMs: 812,
    });
  });

  it("nie przepuszcza niepoprawnych czasów ani nienumerycznego `n=`", () => {
    const line = buildDocumentLogLine({
      path: "/x",
      status: 500,
      cacheStatus: "",
      serverTiming: 'db;dur=10;desc="n=abc", ssr;dur=NaN',
      serverInitMs: Number.NaN,
      appMs: -5,
    });
    expect(line).toEqual({
      kind: "doc",
      path: "/x",
      status: 500,
      cache: null,
      revalidation: false,
      serverInitMs: 0,
      appMs: 0,
      dbMs: 10,
    });
  });

  it("przycina ścieżkę do 2048 znaków - URL od klienta może mieć kilobajty", () => {
    const line = buildDocumentLogLine({
      path: `/${"a".repeat(5000)}`,
      status: 404,
      cacheStatus: "BYPASS",
      serverTiming: null,
      serverInitMs: 1,
      appMs: 2,
    });
    expect(line.path).toHaveLength(2048);
  });
});

// OBSERWOWALNOŚĆ CACHE'U DOKUMENTÓW I TTFB (plan PSI 85/95, P0.4 = SC-1).
//
// Werdykt SC-1 dał trzy poprawki, które te testy przypinają: (a) żadnej
// metryki `stream` w Server-Timing - koniec body idzie WYŁĄCZNIE do logu,
// mierzony owijką strumienia, nie kolektorem tee; (b) flaga zimnego startu
// z licznika żądań izolatu, nie z wieku modułu; (c) `ray` w linii logu jako
// klucz korelacji. Do tego zasada prywatności: z user-agenta tylko klasa,
// zero IP, zero napisów od klienta bez walidacji kształtu.
const LIGHTHOUSE_MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse";
const CHROME_DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const RAY = "8c5a3b2e9f1d4e7a-WAW";

describe("nes-layer w nagłówku Server-Timing", () => {
  it.each<[NesCacheLayer, string]>([
    ["L1", 'nes-edge;desc="HIT", nes-age;dur=1200, edge-routing;dur=3.0, nes-layer;desc="L1"'],
    ["L2", 'nes-edge;desc="HIT", nes-age;dur=1200, edge-routing;dur=3.0, nes-layer;desc="L2"'],
  ])("warstwa %s stoi NA KOŃCU, za fazami - `nes-edge` dalej pierwszy", (layer, expected) => {
    expect(
      buildServerTimingValue(
        "HIT",
        undefined,
        null,
        1200,
        [{ name: "edge-routing", durationMs: 3 }],
        layer,
      ),
    ).toBe(expected);
  });

  it("MISS niesie `render` za kosztem bazy", () => {
    expect(
      buildServerTimingValue("MISS", 674, { count: 19, totalMs: 2697 }, undefined, [], "render"),
    ).toBe(
      'nes-edge;desc="MISS", ssr;dur=674.0, db;dur=2697.0;desc="n=19", nes-layer;desc="render"',
    );
  });

  it("brak warstwy nie zmienia nagłówka ani o bajt (wołający sprzed P0.4)", () => {
    const before = buildServerTimingValue("HIT", undefined, null, 5, [
      { name: "edge-routing", durationMs: 1 },
    ]);
    expect(
      buildServerTimingValue("HIT", undefined, null, 5, [{ name: "edge-routing", durationMs: 1 }]),
    ).toBe(before);
    expect(
      buildServerTimingValue(
        "HIT",
        undefined,
        null,
        5,
        [{ name: "edge-routing", durationMs: 1 }],
        null,
      ),
    ).toBe(before);
  });

  it("wartość spoza słownika warstw nie trafia do nagłówka (zamknięty słownik dla RUM)", () => {
    const bogus: string = "L3";
    expect(
      buildServerTimingValue("HIT", undefined, null, undefined, [], bogus as NesCacheLayer),
    ).toBe('nes-edge;desc="HIT"');
  });

  it("parser oddaje warstwę jako opis metryki - kontrakt dla RUM (P0.6)", () => {
    expect(
      parseServerTiming(buildServerTimingValue("STALE", undefined, null, 0, [], "L2")),
    ).toEqual([
      { name: "nes-edge", description: "STALE" },
      { name: "nes-age", durationMs: 0 },
      { name: "nes-layer", description: "L2" },
    ]);
  });
});

describe("resolveRequestColo - kolonia z `request.cf` albo z sufiksu `cf-ray`", () => {
  it("bierze `cf.colo`, gdy runtime je daje (Workers)", () => {
    expect(resolveRequestColo({ colo: "FRA", country: "DE" }, RAY)).toBe("FRA");
  });

  it("normalizuje wielkość liter i białe znaki kodu z `cf`", () => {
    expect(resolveRequestColo({ colo: " waw " }, null)).toBe("WAW");
  });

  it.each([undefined, null, "WAW", 7, {}, { colo: 42 }, { colo: "WARSAW" }, { colo: "" }])(
    "bez użytecznego `cf` (%j) spada na sufiks `cf-ray`",
    (cf) => {
      expect(resolveRequestColo(cf, RAY)).toBe("WAW");
    },
  );

  it.each([
    null,
    undefined,
    "",
    "8c5a3b2e9f1d4e7a",
    "8c5a3b2e9f1d4e7a-",
    "8c5a3b2e9f1d4e7a-WARS",
    'x"-WAW',
    "8c5a3b2e9f1d4e7a-W1W",
  ])("bez `cf` i bez poprawnego ray-a (%j) zwraca null - brak klucza, nie śmieć", (cfRay) => {
    expect(resolveRequestColo(undefined, cfRay)).toBeNull();
  });
});

describe("sanitizeRay", () => {
  it.each([RAY, "8c5a3b2e9f1d4e7a", "0123456789ABCDEF-ams", ` ${RAY} `])(
    "przepuszcza kształt ray-a: %j",
    (value) => {
      expect(sanitizeRay(value)).toBe(value.trim());
    },
  );

  it.each([
    null,
    undefined,
    "",
    "nie-ray",
    "8c5a3b2e9f1d4e7a-WAW; ip=203.0.113.7",
    "g".repeat(16),
    "a".repeat(40),
    "1234567",
  ])("odrzuca wszystko inne: %j", (value) => {
    expect(sanitizeRay(value)).toBeNull();
  });
});

describe("classifyUserAgent - z UA do logu trafia wyłącznie klasa", () => {
  it.each<[string | null | undefined, string]>([
    [LIGHTHOUSE_MOBILE_UA, "lighthouse"],
    ["Mozilla/5.0 (compatible; Google-PageSpeed Insights)", "lighthouse"],
    ["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "bot"],
    ["curl/8.5.0", "bot"],
    ["Mozilla/5.0 HeadlessChrome/141.0.0.0", "bot"],
    ["", "bot"],
    [null, "bot"],
    [undefined, "bot"],
    [CHROME_DESKTOP_UA, "browser"],
  ])("%j -> %s", (ua, expected) => {
    expect(classifyUserAgent(ua)).toBe(expected);
  });
});

describe("buildEntryServerTimingValue - część dopisywana w src/server.ts", () => {
  it("bez kolonii to bajt w bajt dawny napis", () => {
    expect(buildEntryServerTimingValue(0, 37)).toBe("server-init;dur=0, app;dur=37");
    expect(buildEntryServerTimingValue(0, 37, null)).toBe("server-init;dur=0, app;dur=37");
  });

  it("z kolonią dopisuje `colo;desc=` na końcu", () => {
    expect(buildEntryServerTimingValue(412, 3105, "WAW")).toBe(
      'server-init;dur=412, app;dur=3105, colo;desc="WAW"',
    );
  });

  it.each(['WAW", evil;dur=1', "waw", "WARSAW", ""])(
    "kolonia spoza kształtu (%j) nie wchodzi do nagłówka",
    (colo) => {
      expect(buildEntryServerTimingValue(1, 2, colo)).toBe("server-init;dur=1, app;dur=2");
    },
  );

  it("nie ma metryki końca strumienia - nagłówki wychodzą PRZED body (werdykt SC-1 a)", () => {
    const value = buildEntryServerTimingValue(1, 2, "WAW");
    expect(parseServerTiming(value).map((entry) => entry.name)).toEqual([
      "server-init",
      "app",
      "colo",
    ]);
    expect(value).not.toMatch(/stream/);
  });
});

const encoder = new TextEncoder();

/** Źródło sterowane z testu: kolejne chunki, domknięcie albo błąd na żądanie. */
function controlledSource(): {
  stream: ReadableStream<Uint8Array>;
  controller: ReadableStreamDefaultController<Uint8Array>;
  cancelled: unknown[];
} {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const cancelled: unknown[] = [];
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel(reason) {
      cancelled.push(reason);
    },
  });
  if (!controller) throw new Error("ReadableStream nie wywołał start()");
  return { stream, controller, cancelled };
}

describe("observeBodyEnd - koniec body z owijki strumienia, nie z tee", () => {
  it("przepuszcza TE SAME chunki i zgłasza `done` dokładnie raz, przed domknięciem czytnika", async () => {
    const { stream, controller } = controlledSource();
    const outcomes: BodyEndOutcome[] = [];
    const reader = observeBodyEnd(stream, (outcome) => outcomes.push(outcome)).getReader();

    const first = encoder.encode("<html><body>");
    const second = encoder.encode("</body></html>");
    controller.enqueue(first);
    const read1 = await reader.read();
    expect(read1.value).toBe(first);
    // Strumień trwa - końca jeszcze nie ma, więc i linii logu nie może być.
    expect(outcomes).toEqual([]);

    controller.enqueue(second);
    controller.close();
    const read2 = await reader.read();
    expect(read2.value).toBe(second);
    const end = await reader.read();
    expect(end.done).toBe(true);
    // `flush()` biegnie, zanim czytnik zobaczy `done` - wołający, który
    // doczytał body, ma już linię logu.
    expect(outcomes).toEqual(["done"]);
  });

  it("błąd źródła zgłasza `aborted` i dociera do konsumenta jak dotąd", async () => {
    const { stream, controller } = controlledSource();
    const outcomes: BodyEndOutcome[] = [];
    const reader = observeBodyEnd(stream, (outcome) => outcomes.push(outcome)).getReader();

    controller.error(new Error("render padł"));
    await expect(reader.read()).rejects.toThrow("render padł");
    await vi.waitFor(() => {
      expect(outcomes).toEqual(["aborted"]);
    });
  });

  it("anulowanie przez konsumenta (zerwany klient) dociera do źródła i zgłasza `aborted`", async () => {
    const { stream, controller, cancelled } = controlledSource();
    const outcomes: BodyEndOutcome[] = [];
    const observed = observeBodyEnd(stream, (outcome) => outcomes.push(outcome));
    const reader = observed.getReader();
    controller.enqueue(encoder.encode("<html>"));
    await reader.read();

    await reader.cancel(new Error("klient zniknął"));
    await vi.waitFor(() => {
      expect(outcomes).toEqual(["aborted"]);
    });
    // Strażnik dokumentu i render MUSZĄ dostać sygnał zerwania - inaczej
    // upstream wisiałby z wyczyszczonymi timerami.
    expect(cancelled).toHaveLength(1);
  });

  it("zerwanie zgłasza OD RAZU, nawet gdy anulowanie źródła wisi (gałąź tee kolektora zapisu)", () => {
    // `cancel()` gałęzi `tee()` rozstrzyga się dopiero po anulowaniu drugiej
    // gałęzi albo końcu źródła - a kolektor zapisu czyta swoją do końca
    // renderu. Owijka oparta na `pipeTo` czekałaby na to; ta nie czeka.
    const outcomes: BodyEndOutcome[] = [];
    const hanging = new ReadableStream<Uint8Array>({
      cancel: () => new Promise<void>(() => {}),
    });
    const reader = observeBodyEnd(hanging, (outcome) => outcomes.push(outcome)).getReader();
    void reader.cancel(new Error("klient zniknął"));
    expect(outcomes).toEqual(["aborted"]);
  });

  it("czyta źródło dopiero na żądanie konsumenta (backpressure jak transform tożsamościowy)", async () => {
    let pulls = 0;
    const source = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          controller.enqueue(encoder.encode(`chunk-${pulls}`));
        },
      },
      { highWaterMark: 0 },
    );
    const reader = observeBodyEnd(source, () => {}).getReader();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pulls).toBe(0);
    await reader.read();
    expect(pulls).toBe(1);
    await reader.cancel();
  });

  it("wyjątek z telemetrii nie zrywa dokumentu", async () => {
    const { stream, controller } = controlledSource();
    const observed = observeBodyEnd(stream, () => {
      throw new Error("log padł");
    });
    controller.enqueue(encoder.encode("<html>ok</html>"));
    controller.close();
    expect(await new Response(observed).text()).toBe("<html>ok</html>");
  });
});

// Recenzja P0.4, MAJOR 1 i MINOR 9: linia logu nie może zależeć od tego, czy
// runtime wykona JS `cancel()` po zerwaniu klienta (Workers tego nie
// gwarantuje). Bezpiecznik zgłasza `aborted` sam, raz, i nie dotyka strumienia.
describe("observeBodyEnd - bezpiecznik telemetrii (fuseMs)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("body nieczytane i nieanulowane: `aborted` dokładnie po fuseMs, a strumień płynie dalej nietknięty", async () => {
    vi.useFakeTimers();
    const { stream, controller, cancelled } = controlledSource();
    const outcomes: BodyEndOutcome[] = [];
    const observed = observeBodyEnd(stream, (outcome) => outcomes.push(outcome), {
      fuseMs: 22_000,
    });
    const first = encoder.encode("<html><body>");
    controller.enqueue(first);

    vi.advanceTimersByTime(21_999);
    expect(outcomes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(outcomes).toEqual(["aborted"]);
    // Bezpiecznik zamyka TELEMETRIĘ, nie dokument: źródło nie zostało
    // anulowane, a późny czytelnik dostaje te same chunki do końca.
    expect(cancelled).toEqual([]);
    controller.enqueue(encoder.encode("</body></html>"));
    controller.close();
    const reader = observed.getReader();
    expect((await reader.read()).value).toBe(first);
    expect((await reader.read()).done).toBe(false);
    expect((await reader.read()).done).toBe(true);
    // Koniec po bezpieczniku nie daje drugiej linii.
    expect(outcomes).toEqual(["aborted"]);
  });

  it("normalny koniec przed bezpiecznikiem zdejmuje timer - żadnego późnego `aborted`", async () => {
    vi.useFakeTimers();
    const { stream, controller } = controlledSource();
    const outcomes: BodyEndOutcome[] = [];
    const observed = observeBodyEnd(stream, (outcome) => outcomes.push(outcome), {
      fuseMs: 22_000,
    });
    expect(vi.getTimerCount()).toBe(1);
    controller.enqueue(encoder.encode("<html>ok</html>"));
    controller.close();
    expect(await new Response(observed).text()).toBe("<html>ok</html>");
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(outcomes).toEqual(["done"]);
  });

  it("zerwanie przed bezpiecznikiem zdejmuje timer - jedno `aborted`, nie dwa", async () => {
    vi.useFakeTimers();
    const { stream } = controlledSource();
    const outcomes: BodyEndOutcome[] = [];
    const reader = observeBodyEnd(stream, (outcome) => outcomes.push(outcome), {
      fuseMs: 22_000,
    }).getReader();
    await reader.cancel(new Error("klient zniknął"));
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(outcomes).toEqual(["aborted"]);
  });

  it.each([undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "fuseMs=%s nie uzbraja bezpiecznika (zachowanie sprzed poprawki)",
    (fuseMs) => {
      vi.useFakeTimers();
      const { stream } = controlledSource();
      const outcomes: BodyEndOutcome[] = [];
      observeBodyEnd(stream, (outcome) => outcomes.push(outcome), { fuseMs });
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(60_000);
      expect(outcomes).toEqual([]);
    },
  );
});

// Recenzja P0.4, MAJOR 2 + kontrakt harnessu pomiaru: linia czeka na decyzję
// magazynu, a czytelnik, który doczytał body, ma ją już w logu.
describe("observeBodyEnd - obietnica z `onEnd` dla `done`", () => {
  it("wstrzymuje `done` czytelnika do swojego rozstrzygnięcia", async () => {
    const { stream, controller } = controlledSource();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const events: string[] = [];
    const reader = observeBodyEnd(stream, (outcome) => {
      events.push(`onEnd:${outcome}`);
      return gate.then(() => {
        events.push("linia");
      });
    }).getReader();
    controller.close();
    const end = reader.read().then((result) => {
      events.push(`czytelnik:${String(result.done)}`);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual(["onEnd:done"]);
    release();
    await end;
    expect(events).toEqual(["onEnd:done", "linia", "czytelnik:true"]);
  });

  it("odrzucona obietnica nie zrywa dokumentu", async () => {
    const { stream, controller } = controlledSource();
    const observed = observeBodyEnd(stream, () => Promise.reject(new Error("log padł")));
    controller.enqueue(encoder.encode("<html>ok</html>"));
    controller.close();
    expect(await new Response(observed).text()).toBe("<html>ok</html>");
  });

  it("`aborted` nigdy nie czeka na obietnicę z `onEnd`", async () => {
    const { stream, cancelled } = controlledSource();
    const outcomes: BodyEndOutcome[] = [];
    const reader = observeBodyEnd(stream, (outcome) => {
      outcomes.push(outcome);
      return new Promise<void>(() => {});
    }).getReader();
    await reader.cancel(new Error("klient zniknął"));
    expect(outcomes).toEqual(["aborted"]);
    expect(cancelled).toHaveLength(1);
  });

  it("anulowanie w trakcie czekania na linię nie rzuca i nie daje drugiego zgłoszenia", async () => {
    const { stream, controller } = controlledSource();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const outcomes: BodyEndOutcome[] = [];
    const reader = observeBodyEnd(stream, (outcome) => {
      outcomes.push(outcome);
      return gate;
    }).getReader();
    controller.close();
    const pendingRead = reader.read();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await reader.cancel(new Error("klient zniknął"));
    expect((await pendingRead).done).toBe(true);
    // `controller.close()` po anulowaniu jest połykane - bez nieobsłużonego
    // odrzucenia (vitest zgłosiłby je jako błąd przebiegu).
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(outcomes).toEqual(["done"]);
  });
});

describe("buildDocumentLogLine - pola P0.4", () => {
  it("odtwarza pełną linię MISS-a z zimnego izolatu: kolonia, warstwa, ray, klasa UA, streamMs", () => {
    expect(
      buildDocumentLogLine({
        path: "/",
        status: 200,
        cacheStatus: "MISS",
        serverTiming: buildServerTimingValue(
          "MISS",
          674,
          { count: 19, totalMs: 2697 },
          undefined,
          [{ name: "edge-routing", durationMs: 284.2 }],
          "render",
        ),
        serverInitMs: 412,
        appMs: 3105,
        streamMs: 3140,
        streamEnd: "done",
        colo: "WAW",
        isolate: { isoReq: 1, isoAgeS: 0 },
        userAgent: LIGHTHOUSE_MOBILE_UA,
        cfRay: RAY,
        degraded: false,
      }),
    ).toEqual({
      kind: "doc",
      path: "/",
      status: 200,
      cache: "MISS",
      revalidation: false,
      serverInitMs: 412,
      appMs: 3105,
      streamMs: 3140,
      layer: "render",
      colo: "WAW",
      isoReq: 1,
      isoAgeS: 0,
      uaClass: "lighthouse",
      ray: RAY,
      degraded: false,
      edgeRoutingMs: 284.2,
      ssrMs: 674,
      dbMs: 2697,
      dbCount: 19,
    });
  });

  it("prywatność: ani napis UA, ani nic spoza kształtu ray-a nie trafia do linii", () => {
    const line = JSON.stringify(
      buildDocumentLogLine({
        path: "/en/blog",
        status: 200,
        cacheStatus: "HIT",
        serverTiming: buildServerTimingValue("HIT", undefined, null, 10, [], "L1"),
        serverInitMs: 0,
        appMs: 4,
        userAgent: CHROME_DESKTOP_UA,
        cfRay: "8c5a3b2e9f1d4e7a-WAW; ip=203.0.113.7",
      }),
    );
    expect(line).not.toContain("Windows");
    expect(line).not.toContain("Chrome/");
    expect(line).not.toContain("203.0.113.7");
    expect(JSON.parse(line)).toMatchObject({ uaClass: "browser", layer: "L1" });
    expect(JSON.parse(line)).not.toHaveProperty("ray");
  });

  it("zerwany strumień jest oznaczony; normalny koniec nie dokłada klucza", () => {
    const base = {
      path: "/x",
      status: 200,
      cacheStatus: "HIT",
      serverTiming: null,
      serverInitMs: 0,
      appMs: 1,
      streamMs: 9,
    };
    expect(buildDocumentLogLine({ ...base, streamEnd: "aborted" })).toMatchObject({
      streamMs: 9,
      streamEnd: "aborted",
    });
    expect(buildDocumentLogLine({ ...base, streamEnd: "done" })).not.toHaveProperty("streamEnd");
  });

  it("brak źródła = brak klucza: rewalidacja bez licznika izolatu, kolonii i ray-a", () => {
    const line = buildDocumentLogLine({
      path: "/blog",
      status: 200,
      cacheStatus: "MISS",
      serverTiming: 'nes-edge;desc="MISS", ssr;dur=12.0, nes-layer;desc="render"',
      serverInitMs: 0,
      appMs: 812,
      revalidation: true,
    });
    for (const key of [
      "isoReq",
      "isoAgeS",
      "coldEntry",
      "colo",
      "ray",
      "uaClass",
      "streamMs",
      "degraded",
      "store",
    ]) {
      expect(line).not.toHaveProperty(key);
    }
    expect(line.layer).toBe("render");
  });

  it.each([
    { isoReq: 0, isoAgeS: 0 },
    { isoReq: -1, isoAgeS: 0 },
    { isoReq: 1.5, isoAgeS: 0 },
    { isoReq: Number.NaN, isoAgeS: 0 },
  ])("odrzuca licznik izolatu nie do użycia: %j", (isolate) => {
    const line = buildDocumentLogLine({
      path: "/",
      status: 200,
      cacheStatus: "HIT",
      serverTiming: null,
      serverInitMs: 0,
      appMs: 0,
      isolate,
    });
    expect(line).not.toHaveProperty("isoReq");
    expect(line).not.toHaveProperty("isoAgeS");
  });

  it("niepoprawny wiek izolatu i streamMs spadają do zera, a warstwa spoza słownika odpada", () => {
    expect(
      buildDocumentLogLine({
        path: "/",
        status: 200,
        cacheStatus: "HIT",
        serverTiming: 'nes-layer;desc="L9", colo;desc="WAW"',
        serverInitMs: 0,
        appMs: 0,
        streamMs: Number.NaN,
        colo: "nie-kolonia",
        isolate: { isoReq: 4, isoAgeS: -3 },
      }),
    ).toEqual({
      kind: "doc",
      path: "/",
      status: 200,
      cache: "HIT",
      revalidation: false,
      serverInitMs: 0,
      appMs: 0,
      streamMs: 0,
      isoReq: 4,
      isoAgeS: 0,
    });
  });
});

describe("buildDocumentLogLine - poprawki po recenzji P0.4", () => {
  const base = {
    path: "/",
    status: 200,
    cacheStatus: "MISS",
    serverTiming: null,
    serverInitMs: 0,
    appMs: 5,
  };

  it("`coldEntry` jedzie z próbką izolatu, w obu wartościach (MINOR 4)", () => {
    expect(
      buildDocumentLogLine({ ...base, isolate: { isoReq: 2, isoAgeS: 0, coldEntry: true } }),
    ).toMatchObject({ isoReq: 2, isoAgeS: 0, coldEntry: true });
    expect(
      buildDocumentLogLine({ ...base, isolate: { isoReq: 3, isoAgeS: 1, coldEntry: false } }),
    ).toMatchObject({ isoReq: 3, coldEntry: false });
  });

  it("`coldEntry` odpada razem z licznikiem nie do użycia i bez próbki", () => {
    expect(
      buildDocumentLogLine({ ...base, isolate: { isoReq: 0, isoAgeS: 0, coldEntry: true } }),
    ).not.toHaveProperty("coldEntry");
    expect(
      buildDocumentLogLine({ ...base, isolate: { isoReq: 1, isoAgeS: 0 } }),
    ).not.toHaveProperty("coldEntry");
  });

  it.each<DocumentStoreOutcome>(["stored", "degraded", "oversize", "failed"])(
    "wynik zapisu `%s` trafia do linii jako `store` (MAJOR 2)",
    (storeOutcome) => {
      expect(buildDocumentLogLine({ ...base, storeOutcome })).toMatchObject({
        store: storeOutcome,
      });
    },
  );

  it("wynik spoza słownika i brak wyniku = brak klucza `store`", () => {
    const bogus = "pending" as unknown as DocumentStoreOutcome;
    expect(buildDocumentLogLine({ ...base, storeOutcome: bogus })).not.toHaveProperty("store");
    expect(buildDocumentLogLine({ ...base, storeOutcome: null })).not.toHaveProperty("store");
    expect(buildDocumentLogLine(base)).not.toHaveProperty("store");
  });
});
