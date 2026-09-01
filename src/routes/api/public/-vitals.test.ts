// Ingest Core Web Vitals (RUM): POST /api/public/vitals.
//
// PO CO. Ostatnia z czterech publicznych, niepodpisanych ścieżek zapisu tego
// modułu. Przeglądarka beaconuje tu metryki wydajności (`src/lib/webVitals.ts`),
// a endpoint wstawia wiersze klientem service_role. Do wydania 8 audytu stał na
// 0/22 linii.
//
// DWA KSZTAŁTY CIAŁA, OBA NA STAŁE. Po naprawie N2 klient batchuje i wysyła
// `{metrics:[...]}`, ale strona zbuforowana przed tą zmianą - albo otwarta w
// karcie w tle od wczoraj - nadal wyśle pojedynczy obiekt `{name,value,...}`
// przy `pagehide`. Endpoint musi przyjmować oba, bo inaczej wdrożenie zjada
// dane każdego, kto nie przeładował strony. Rozdział "zgodność wsteczna"
// niżej jest o tym.
//
// Reszta kontraktu jak w każdym beaconie: nieznana metryka rozsypuje raport,
// body bez limitu zapycha pamięć workera, query string bywa nośnikiem tokenów,
// a KAŻDA ścieżka oddaje 204 i połyka błąd (wzorzec: `-popup-event.test.ts`).
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  insert: vi.fn(),
  tenantId: "tenant-1" as string | null,
  tenantThrows: false,
  tenantCalls: 0,
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: () => ({ insert: h.insert }) },
}));
vi.mock("@/lib/server/tenant.server", () => ({
  resolveTenantIdForHost: async () => {
    h.tenantCalls += 1;
    if (h.tenantThrows) throw new Error("brak katalogu tenantów");
    return h.tenantId;
  },
}));
vi.mock("@/lib/http/requestHost", () => ({
  currentTenantHost: async () => "redakcja.example.test",
}));

const req = vi.hoisted(() => ({ current: null as Request | null }));
vi.mock("@tanstack/react-start/server", () => ({ getRequest: () => req.current }));

import { routeServerHandlers } from "@/test/routeHarness";
import { Route } from "@/routes/api/public/vitals";

const handler = routeServerHandlers(Route).POST!;

let ipCounter = 0;
function uniqueIp(): string {
  ipCounter += 1;
  return `10.5.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}

function sample(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { name: "LCP", value: 2100, rating: "good", id: "v-1", url: "/wpis/x", ts: 1, ...patch };
}

async function post(body: unknown, raw?: string | Blob) {
  req.current = new Request("https://redakcja.example.test/api/public/vitals", {
    method: "POST",
    headers: { "x-forwarded-for": uniqueIp() },
    body: raw ?? JSON.stringify(body),
  });
  return handler({ request: req.current });
}

/** Wiersze przekazane do `insert` w PIERWSZYM wywołaniu (batch = jedna tablica). */
function rows(): Record<string, unknown>[] {
  const arg = h.insert.mock.calls[0]?.[0];
  return (Array.isArray(arg) ? arg : arg ? [arg] : []) as Record<string, unknown>[];
}

beforeEach(() => {
  h.insert.mockReset();
  h.insert.mockResolvedValue({ error: null });
  h.tenantId = "tenant-1";
  h.tenantThrows = false;
  h.tenantCalls = 0;
});

// ---------------------------------------------------------------------------
describe("zapis batcha", () => {
  it("pięć metryk jednego wczytania idzie JEDNYM wielowierszowym insertem", async () => {
    // To jest cały cel naprawy N2: pierwsze wczytanie kosztowało pięć żądań
    // HTTP i pięć osobnych round-tripów INSERT.
    const res = await post({
      metrics: [
        sample({ name: "FCP", value: 900 }),
        sample({ name: "TTFB", value: 210 }),
        sample({ name: "LCP", value: 2100 }),
        sample({ name: "CLS", value: 0.03 }),
        sample({ name: "INP", value: 150 }),
      ],
    });

    expect(res.status).toBe(204);
    expect(h.insert).toHaveBeenCalledTimes(1);
    expect(rows()).toHaveLength(5);
    expect(rows().map((r) => r.metric)).toEqual(["FCP", "TTFB", "LCP", "CLS", "INP"]);
  });

  it("tenant rozwiązywany jest RAZ na batch, nie raz na próbkę", async () => {
    await post({ metrics: [sample(), sample({ name: "CLS", value: 0 }), sample({ name: "INP", value: 90 })] });

    expect(h.tenantCalls).toBe(1);
    for (const row of rows()) expect(row).toMatchObject({ tenant_id: "tenant-1" });
  });

  it("mapowanie próbki na kolumny jest pełne", async () => {
    await post({ metrics: [sample({ name: "CLS", value: 0.12, rating: "needs-improvement" })] });

    expect(rows()[0]).toMatchObject({
      metric: "CLS",
      value: 0.12,
      rating: "needs-improvement",
      path: "/wpis/x",
      tenant_id: "tenant-1",
    });
  });

  it("BRAK tenanta zostawia kolumnę pustą - domyślna wartość kolumny wchodzi w grę", async () => {
    h.tenantId = null;

    await post({ metrics: [sample()] });

    expect(Object.keys(rows()[0]!)).not.toContain("tenant_id");
    expect(rows()).toHaveLength(1);
  });

  it("AWARIA rozwiązania tenanta nie blokuje zapisu", async () => {
    h.tenantThrows = true;

    const res = await post({ metrics: [sample()] });

    expect(res.status).toBe(204);
    expect(rows()).toHaveLength(1);
  });

  it("odpowiedź NIE JEST cachowana", async () => {
    const res = await post({ metrics: [sample()] });

    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.status).toBe(204);
  });
});

// ---------------------------------------------------------------------------
describe("zgodność wsteczna kształtu ciała", () => {
  it("POJEDYNCZY obiekt (klient sprzed batchowania) jest przyjmowany jako batch jednoelementowy", async () => {
    const res = await post(sample({ name: "TTFB", value: 300 }));

    expect(res.status).toBe(204);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ metric: "TTFB", value: 300 });
  });

  it("goła TABLICA na najwyższym poziomie też jest przyjmowana", async () => {
    await post([sample({ name: "FCP", value: 800 }), sample({ name: "LCP", value: 1900 })]);

    expect(rows().map((r) => r.metric)).toEqual(["FCP", "LCP"]);
  });

  it("ciało wysłane jako BLOB `application/json` jest czytane tak samo jak napis", async () => {
    // `sendBeaconPayload` pakuje ładunek w Blob (ujednolicony transport N3);
    // endpoint czyta `req.text()`, więc oba kształty muszą działać - inaczej
    // ujednolicenie transportu zabiłoby ingest RUM w ciszy.
    const res = await post(
      null,
      new Blob([JSON.stringify({ metrics: [sample()] })], { type: "application/json" }),
    );

    expect(res.status).toBe(204);
    expect(rows()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe("walidacja wejścia", () => {
  it("wszystkie sześć znanych metryk jest przyjmowanych", async () => {
    await post({
      metrics: ["LCP", "CLS", "INP", "FCP", "TTFB", "FID"].map((name) => sample({ name })),
    });

    expect(rows()).toHaveLength(6);
  });

  it("nieznana METRYKA jest pomijana, a reszta batcha zapisana", async () => {
    // Wiersza, którego panel nie umie policzyć, nikt potem nie odczyści -
    // ale jedna zła próbka nie ma prawa zabrać ze sobą czterech dobrych.
    await post({
      metrics: [sample({ name: "WYMYSLONA" }), sample({ name: "LCP" })],
    });

    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ metric: "LCP" });
  });

  it("wartość NIESKOŃCZONA i NaN są pomijane", async () => {
    await post({
      metrics: [
        sample({ value: "Infinity" }),
        sample({ value: "nie-liczba" }),
        sample({ value: 1200 }),
      ],
    });

    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ value: 1200 });
  });

  it("wartość PUSTA (null, pusty napis, false, tablica) NIE staje się zerem z oceną „good”", async () => {
    // `Number(null)` to 0, więc naiwna koercja zapisywała LCP = 0 ms z oceną
    // „good". Kilkanaście takich wierszy realnie POPRAWIA p75 na panelu.
    await post({
      metrics: [
        sample({ value: null }),
        sample({ value: "" }),
        sample({ value: "   " }),
        sample({ value: false }),
        sample({ value: [] }),
        sample({ value: {} }),
      ],
    });

    expect(h.insert).not.toHaveBeenCalled();
  });

  it("ZERO jest legalną wartością CLS - strona bez przesunięć nadal się liczy", async () => {
    // Rozróżnienie idzie po TYPIE, nie po wartości: zmierzone zero zostaje,
    // brak pomiaru odpada.
    await post({ metrics: [sample({ name: "CLS", value: 0 })] });

    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ metric: "CLS", value: 0 });
  });

  it("wartość UJEMNA jest odrzucana - żadna z sześciu metryk nie może być poniżej zera", async () => {
    await post({ metrics: [sample({ value: -50 }), sample({ name: "CLS", value: 0.2 })] });

    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ metric: "CLS" });
  });

  it("liczba w cudzysłowie z zewnętrznego kolektora jest przyjmowana", async () => {
    await post({ metrics: [sample({ value: "1800" })] });

    expect(rows()[0]).toMatchObject({ value: 1800 });
  });

  it("batch złożony WYŁĄCZNIE ze śmieci nie dotyka ani katalogu tenantów, ani bazy", async () => {
    const res = await post({ metrics: [sample({ name: "X" }), sample({ name: "Y" })] });

    expect(res.status).toBe(204);
    expect(h.tenantCalls).toBe(0);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("PUSTA tablica metryk nie dotyka bazy", async () => {
    await post({ metrics: [] });

    expect(h.insert).not.toHaveBeenCalled();
  });

  it("batch ponad MAX_METRICS = 8 jest PRZYCINANY do ośmiu", async () => {
    await post({ metrics: Array.from({ length: 20 }, () => sample()) });

    expect(rows()).toHaveLength(8);
  });

  it("ciało ponad MAX_BODY = 8 000 znaków jest odrzucane BEZ parsowania", async () => {
    const raw = JSON.stringify({ metrics: [sample({ url: "/" + "p".repeat(9_000) })] });
    expect(raw.length).toBeGreaterThan(8_000);

    const res = await post(null, raw);

    expect(res.status).toBe(204);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("OCENA innego typu niż napis staje się nullem, a zbyt długa jest przycinana", async () => {
    await post({ metrics: [sample({ rating: 5 }), sample({ rating: "g".repeat(60) })] });

    expect(rows()[0]).toMatchObject({ rating: null });
    expect((rows()[1]!.rating as string).length).toBe(32);
  });

  it("brak adresu w próbce zapisuje NULL zamiast pustego napisu", async () => {
    await post({ metrics: [sample({ url: undefined })] });

    expect(rows()[0]).toMatchObject({ path: null });
  });

  it("PUSTE body nie wywala endpointu", async () => {
    const res = await post(null, "");

    expect(res.status).toBe(204);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("body, które nie jest JSON-em, nie wywala endpointu", async () => {
    const res = await post(null, "to nie jest json");

    expect(res.status).toBe(204);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("body będące gołym napisem JSON (nie obiektem) nie wywala endpointu", async () => {
    const res = await post(null, '"LCP"');

    expect(res.status).toBe(204);
    expect(h.insert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe("RODO: redakcja adresów", () => {
  it("QUERY STRING jest wycinany - w kolumnie nie ma oryginału", async () => {
    await post({
      metrics: [sample({ url: "/konto?token=abcdef0123456789abcdef01&email=jan@example.org" })],
    });

    const path = rows()[0]!.path as string;
    expect(path).not.toContain("abcdef0123456789abcdef01");
    expect(path).not.toContain("jan@example.org");
    expect(path.startsWith("/konto")).toBe(true);
  });

  it("adres e-mail wprost w ścieżce też znika", async () => {
    await post({ metrics: [sample({ url: "/autor/jan.kowalski@example.com" })] });

    const path = rows()[0]!.path as string;
    expect(path).not.toContain("jan.kowalski@example.com");
    expect(path).toContain("[redacted-email]");
  });

  it("redakcja obejmuje KAŻDĄ próbkę batcha, nie tylko pierwszą", async () => {
    await post({
      metrics: [
        sample({ url: "/a?code=aaaaaaaaaaaaaaaaaaaaaaaa" }),
        sample({ name: "CLS", value: 0.1, url: "/b?email=ktos@example.org" }),
      ],
    });

    const serialized = JSON.stringify(rows());
    expect(serialized).not.toContain("aaaaaaaaaaaaaaaaaaaaaaaa");
    expect(serialized).not.toContain("ktos@example.org");
  });
});

// ---------------------------------------------------------------------------
describe("odporność", () => {
  it("AWARIA zapisu nadal oddaje 204", async () => {
    h.insert.mockRejectedValue(new Error("baza padla"));

    const res = await post({ metrics: [sample()] });

    expect(res.status).toBe(204);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("LIMITER (20 żetonów, 0,2/s) wycisza zalew z jednego adresu, nie zwracając błędu", async () => {
    // Nastawa przeliczona po zbatchowaniu klienta: budżet liczony jest w
    // WIERSZACH, nie w żądaniach, bo jedno żądanie wstawia teraz do ośmiu.
    const statuses: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      req.current = new Request("https://redakcja.example.test/api/public/vitals", {
        method: "POST",
        headers: { "x-forwarded-for": "10.6.6.6" },
        body: JSON.stringify({ metrics: [sample()] }),
      });
      statuses.push((await handler({ request: req.current })).status);
    }

    expect(new Set(statuses)).toEqual(new Set([204]));
    expect(h.insert.mock.calls.length).toBeLessThan(30);
  });

  it("limiter NIE karze innego adresu", async () => {
    for (let i = 0; i < 30; i += 1) {
      req.current = new Request("https://redakcja.example.test/api/public/vitals", {
        method: "POST",
        headers: { "x-forwarded-for": "10.6.7.7" },
        body: JSON.stringify({ metrics: [sample()] }),
      });
      await handler({ request: req.current });
    }
    h.insert.mockClear();

    await post({ metrics: [sample()] });

    expect(h.insert).toHaveBeenCalledTimes(1);
  });
});
