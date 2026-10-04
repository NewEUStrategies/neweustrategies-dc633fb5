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

import { readFileSync } from "node:fs";
import { routeServerHandlers } from "@/test/routeHarness";
import { Route } from "@/routes/api/public/vitals";
// Słowniki ładunku z REPORTERA - w teście jako wartości. Trasa wiąże je
// wyłącznie typem (`import type`), więc to tutaj zachowanie ingestu jest
// porównywane z jedynym źródłem słowników (blok P0.6 niżej).
import {
  EDGE_CACHE_STATUSES,
  EDGE_LAYERS,
  INP_EVENT_VALUES,
  MAX_SINCE_LOAD_MS,
} from "@/lib/webVitals";

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
  return rowsAt(0);
}

/** Wiersze z n-tego wywołania `insert` (stopnie awaryjnego ponowienia to wywołania nr 2 i 3). */
function rowsAt(call: number): Record<string, unknown>[] {
  const arg = h.insert.mock.calls[call]?.[0];
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
    await post({
      metrics: [sample(), sample({ name: "CLS", value: 0 }), sample({ name: "INP", value: 90 })],
    });

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

// ---------------------------------------------------------------------------
// KONTEKST NAWIGACJI (audyt CWV 2026-09-20, F40 / wiersz 0.3 „Fali 0").
//
// Pięć pól opisowych, dzięki którym p75 da się policzyć OSOBNO dla zimnego
// pierwszego wejścia i osobno dla miękkich nawigacji tej samej odsłony. Cała
// klasa ryzyka jest tu jedna i ta sama co przy `metricValue`: to publiczna,
// NIEPODPISANA ścieżka zapisu, więc każde pole musi mieć własną odpowiedź na
// pytanie „co, jeśli nadawca wpisze tu cokolwiek".
describe("kontekst nawigacji", () => {
  const context = {
    sinceNav: 2456,
    navigationType: "back_forward",
    deviceMemory: 4,
    effectiveType: "3g",
    coldStart: true,
  };

  it("pełny kontekst ląduje w kolumnach wiersza", async () => {
    await post({ metrics: [sample(context)] });

    expect(rows()[0]).toMatchObject({
      metric: "LCP",
      since_nav_ms: 2456,
      navigation_type: "back_forward",
      device_memory: 4,
      effective_type: "3g",
      cold_start: true,
    });
  });

  it("próbka BEZ kontekstu zapisuje się z pięcioma NULL-ami", async () => {
    // Zgodność wsteczna nie jest opcją: strona zbuforowana przed tym
    // wdrożeniem beaconuje stary kształt tygodniami. Brak kontekstu ma
    // kosztować kontekst, a nie pomiar.
    await post({ metrics: [sample()] });

    expect(rows()[0]).toMatchObject({
      metric: "LCP",
      value: 2100,
      since_nav_ms: null,
      navigation_type: null,
      device_memory: null,
      effective_type: null,
      cold_start: null,
    });
  });

  it("`coldStart: false` to POMIAR, a nie brak pomiaru - nie może zejść na NULL", async () => {
    // Odwrotność defektu z `metricValue`: gdyby walidator szedł przez
    // `Boolean(raw)` albo `raw || null`, „ciepłe wejście" zniknęłoby z bazy
    // i populacja zimnych wejść byłaby JEDYNĄ, jaką widać.
    await post({ metrics: [sample({ coldStart: false })] });

    expect(rows()[0]?.cold_start).toBe(false);
  });

  it("`sinceNav: 0` jest legalne (metryka zgłoszona w chwili startu nawigacji)", async () => {
    await post({ metrics: [sample({ sinceNav: 0 })] });

    expect(rows()[0]?.since_nav_ms).toBe(0);
  });

  describe("wartości spoza kontraktu schodzą na NULL, nie kasują próbki", () => {
    const cases: Array<[string, Record<string, unknown>, string]> = [
      [
        "typ nawigacji spoza czterech ze specyfikacji",
        { navigationType: "teleport" },
        "navigation_type",
      ],
      ["typ nawigacji jako liczba", { navigationType: 3 }, "navigation_type"],
      ["klasa łącza spoza specyfikacji", { effectiveType: "5g" }, "effective_type"],
      ["pamięć urządzenia poza progami 1/2/4/8", { deviceMemory: 3 }, "device_memory"],
      ["pamięć urządzenia jako napis", { deviceMemory: "4" }, "device_memory"],
      ["pamięć urządzenia poza zakresem specyfikacji", { deviceMemory: 256 }, "device_memory"],
      ["`sinceNav` ujemne", { sinceNav: -1 }, "since_nav_ms"],
      ["`sinceNav` ponad dobę", { sinceNav: 86_400_001 }, "since_nav_ms"],
      [
        "`sinceNav` jako null (klasyczna śmieciówka `Number(null) === 0`)",
        { sinceNav: null },
        "since_nav_ms",
      ],
      ["`sinceNav` jako pusty napis", { sinceNav: "" }, "since_nav_ms"],
      ["`sinceNav` jako NaN po konwersji", { sinceNav: "brak" }, "since_nav_ms"],
      [
        '`coldStart` jako napis `"true"` (Boolean("false") === true)',
        { coldStart: "true" },
        "cold_start",
      ],
      ["`coldStart` jako liczba", { coldStart: 1 }, "cold_start"],
    ];

    for (const [label, patch, column] of cases) {
      it(label, async () => {
        await post({ metrics: [sample({ ...context, ...patch })] });

        const row = rows()[0];
        // Próbka ZOSTAJE - odrzucenie kontekstu nie może kosztować metryki.
        expect(row).toMatchObject({ metric: "LCP", value: 2100 });
        expect(row?.[column]).toBeNull();
      });
    }
  });

  it("`sinceNav` z zewnętrznego kolektora (liczba w cudzysłowie) jest przyjmowane i zaokrąglane", async () => {
    // Ta sama furtka co w `metricValue`: `VITE_OBSERVABILITY_ENDPOINT`
    // wskazujący tunel bywa źródłem liczb jako napisów.
    await post({ metrics: [sample({ sinceNav: "1500.6" })] });

    expect(rows()[0]?.since_nav_ms).toBe(1501);
  });

  it("NIEZNANE POLA nie mają jak dojechać do wiersza", async () => {
    // Wiersz jest składany z jawnej białej listy, więc nadawca nie podłoży ani
    // własnej kolumny, ani `tenant_id` (izolacja najemcy), ani `created_at`.
    await post({
      metrics: [
        sample({
          ...context,
          evil: "wstrzyknięte",
          tenant_id: "tenant-2",
          created_at: "1999-01-01T00:00:00Z",
          id: "podstawione-id",
        }),
      ],
    });

    const row = rows()[0]!;
    expect(Object.keys(row).sort()).toEqual(
      [
        "cold_start",
        "colo",
        "device_memory",
        "edge_cache",
        "edge_layer",
        "effective_type",
        "inp_event",
        "inp_first",
        "inp_pre_hydration",
        "inp_since_load_ms",
        "metric",
        "navigation_type",
        "path",
        "rating",
        "since_nav_ms",
        "tenant_id",
        "value",
      ].sort(),
    );
    // `tenant_id` pochodzi z rozwiązania hosta, nie z ciała żądania.
    expect(row.tenant_id).toBe("tenant-1");
    expect(JSON.stringify(row)).not.toContain("wstrzyknięte");
  });

  describe("okno między wdrożeniem kodu a migracją", () => {
    // Ponowienie jest DWUSTOPNIOWE (P1.0b): pierwszy stopień zrzuca wyłącznie
    // siedem kolumn P0.6 i ZACHOWUJE ten kontekst; dopiero drugi brak kolumny
    // schodzi do samego rdzenia. Oba stopnie z kompletem pól - w bloku P0.6.
    it("brak kolumny (PGRST204) ponawia zapis, zamiast gubić cały RUM - kontekst nawigacji zostaje", async () => {
      h.insert.mockResolvedValueOnce({ error: { code: "PGRST204" } });
      h.insert.mockResolvedValueOnce({ error: null });

      const res = await post({ metrics: [sample(context)] });

      expect(res.status).toBe(204);
      expect(h.insert).toHaveBeenCalledTimes(2);
      expect(rowsAt(1)[0]).toMatchObject({
        metric: "LCP",
        value: 2100,
        tenant_id: "tenant-1",
        since_nav_ms: 2456,
        cold_start: true,
      });
    });

    it("drugi brak kolumny ponawia zapis BEZ kontekstu nawigacji (sam rdzeń)", async () => {
      h.insert.mockResolvedValueOnce({ error: { code: "PGRST204" } });
      h.insert.mockResolvedValueOnce({ error: { code: "PGRST204" } });
      h.insert.mockResolvedValueOnce({ error: null });

      const res = await post({ metrics: [sample(context)] });

      expect(res.status).toBe(204);
      expect(h.insert).toHaveBeenCalledTimes(3);
      const retried = rowsAt(2)[0]!;
      expect(retried).toMatchObject({ metric: "LCP", value: 2100, tenant_id: "tenant-1" });
      expect(Object.keys(retried)).not.toContain("since_nav_ms");
      expect(Object.keys(retried)).not.toContain("cold_start");
    });

    it("`42703` (undefined_column) z Postgresa ponawia tak samo", async () => {
      h.insert.mockResolvedValueOnce({ error: { code: "42703" } });
      h.insert.mockResolvedValueOnce({ error: null });

      await post({ metrics: [sample(context)] });

      expect(h.insert).toHaveBeenCalledTimes(2);
    });

    it("KAŻDY INNY błąd nie kosztuje drugiego round-tripu", async () => {
      // Ponowienie jest wąską furtką na jedną, nazwaną przyczynę. Awaria
      // sieci albo RLS-u ma zostać awarią, a nie podwojonym ruchem do bazy.
      h.insert.mockResolvedValue({ error: { code: "53300", message: "too many connections" } });

      const res = await post({ metrics: [sample(context)] });

      expect(res.status).toBe(204);
      expect(h.insert).toHaveBeenCalledTimes(1);
    });
  });
});

// ---------------------------------------------------------------------------
// STAN CACHE DOKUMENTU, COLO I ATRYBUCJA INP (plan PSI 85/95: P0.6 -> P1.0b).
//
// Siedem pól, które reporter wysyła od P0.6, a ingest do tej pory po cichu
// gubił (biała lista kolumn). Kontrakt jest ten sam co dla kontekstu
// nawigacji - pole spoza słownika schodzi na NULL, próbka zostaje - plus dwie
// rzeczy nowe: słowniki mają JEDNO źródło w reporterze (trasa wiąże je typem,
// ten blok - zachowaniem), a ponowienie po braku kolumny jest dwustopniowe.
// Test kontraktu Server-Timing (nagłówek z `ssrTiming.ts` czytany przez
// `readNavigationContext()`) żyje w `src/lib/__tests__/webVitals.test.ts`
// i nie jest tu dublowany.
describe("stan cache dokumentu, colo i atrybucja INP (P0.6)", () => {
  const ROUTE_FILE = "src/routes/api/public/vitals.ts";
  const MIGRATION_FILE = "supabase/migrations/20261004140000_web_vitals_edge_inp.sql";

  const navigation = {
    sinceNav: 2456,
    navigationType: "navigate",
    deviceMemory: 4,
    effectiveType: "4g",
    coldStart: true,
  };
  const edge = { edgeCache: "MISS", edgeLayer: "render", colo: "WAW" };
  const inp = {
    inpEvent: "pointerup",
    inpPreHydration: true,
    inpSinceLoad: -350,
    inpFirst: true,
  };

  /** Najcięższa próbka, jaką wysyła reporter: INP pierwszej trasy z kompletem pól. */
  function fullInp(patch: Record<string, unknown> = {}): Record<string, unknown> {
    return sample({ name: "INP", value: 312, ...navigation, ...edge, ...inp, ...patch });
  }

  const P06_COLUMNS = [
    "edge_cache",
    "edge_layer",
    "colo",
    "inp_event",
    "inp_pre_hydration",
    "inp_since_load_ms",
    "inp_first",
  ] as const;

  describe("zapis kompletnej próbki", () => {
    it("próbka INP z kompletem pól: każde pole ląduje w SWOJEJ kolumnie", async () => {
      await post({ metrics: [fullInp()] });

      expect(rows()[0]).toEqual({
        metric: "INP",
        value: 312,
        rating: "good",
        path: "/wpis/x",
        tenant_id: "tenant-1",
        since_nav_ms: 2456,
        navigation_type: "navigate",
        device_memory: 4,
        effective_type: "4g",
        cold_start: true,
        edge_cache: "MISS",
        edge_layer: "render",
        colo: "WAW",
        inp_event: "pointerup",
        inp_pre_hydration: true,
        inp_since_load_ms: -350,
        inp_first: true,
      });
    });

    it("batch pierwszej trasy: stan cache na KAŻDEJ próbce, atrybucja wyłącznie na INP", async () => {
      // Kształt z reportera: pola `edge*`/`colo` niesie każda próbka pierwszej
      // trasy, pola `inp*` - tylko próbka INP.
      await post({
        metrics: [
          sample({ name: "LCP", value: 2100, ...navigation, ...edge }),
          sample({ name: "CLS", value: 0.02, ...navigation, ...edge }),
          fullInp(),
        ],
      });

      const [lcp, cls, inpRow] = rows();
      for (const row of [lcp, cls, inpRow]) {
        expect(row).toMatchObject({ edge_cache: "MISS", edge_layer: "render", colo: "WAW" });
      }
      for (const row of [lcp, cls]) {
        expect(row).toMatchObject({
          inp_event: null,
          inp_pre_hydration: null,
          inp_since_load_ms: null,
          inp_first: null,
        });
      }
      expect(inpRow).toMatchObject({ inp_event: "pointerup", inp_first: true });
    });

    it("próbka BEZ pól P0.6 (klient sprzed P0.6) zapisuje siedem NULL-i, kontekst nawigacji bez zmian", async () => {
      await post({ metrics: [sample({ name: "INP", value: 180, ...navigation })] });

      const row = rows()[0]!;
      expect(row).toMatchObject({
        metric: "INP",
        value: 180,
        since_nav_ms: 2456,
        cold_start: true,
      });
      for (const column of P06_COLUMNS) expect(row[column]).toBeNull();
    });

    it("`inpPreHydration: false` to POMIAR (interakcja na wyspie uwodnionej), nie brak pomiaru", async () => {
      await post({ metrics: [fullInp({ inpPreHydration: false })] });

      expect(rows()[0]?.inp_pre_hydration).toBe(false);
    });

    it("brak `inpFirst` (interakcja późniejsza albo nieznana) zapisuje NULL", async () => {
      const withoutFirst = fullInp();
      delete withoutFirst.inpFirst;

      await post({ metrics: [withoutFirst] });

      expect(rows()[0]?.inp_first).toBeNull();
    });
  });

  describe("słowniki z reportera (`src/lib/webVitals.ts`)", () => {
    it("KAŻDY status cache z `EDGE_CACHE_STATUSES` przechodzi bez zmian", async () => {
      await post({ metrics: EDGE_CACHE_STATUSES.map((edgeCache) => sample({ edgeCache })) });

      expect(rows().map((row) => row.edge_cache)).toEqual([...EDGE_CACHE_STATUSES]);
    });

    it("KAŻDA warstwa z `EDGE_LAYERS` przechodzi bez zmian - i nie ma wśród nich `L3`", async () => {
      await post({ metrics: EDGE_LAYERS.map((edgeLayer) => sample({ edgeLayer })) });

      expect(rows().map((row) => row.edge_layer)).toEqual([...EDGE_LAYERS]);
      // Serwer (`NesCacheLayer`) emituje L1/L2/render; `L3` w słowniku
      // utrwalałoby w CHECK-u wartość, której nikt nie wysyła.
      expect(EDGE_LAYERS).not.toContain("L3");
    });

    it("KAŻDE z sześciu zdarzeń `INP_EVENT_VALUES` przechodzi bez zmian", async () => {
      expect(INP_EVENT_VALUES).toHaveLength(6);

      await post({ metrics: INP_EVENT_VALUES.map((inpEvent) => fullInp({ inpEvent })) });

      expect(rows().map((row) => row.inp_event)).toEqual([...INP_EVENT_VALUES]);
    });

    it("granica `MAX_SINCE_LOAD_MS` reportera przechodzi w OBIE strony, o 1 ms dalej już nie", async () => {
      // Reporter typuje granicę jako `number`, więc tę równość wiąże wyłącznie
      // ten test: wartość graniczna przechodzi, następna liczba całkowita - nie.
      await post({
        metrics: [
          fullInp({ inpSinceLoad: MAX_SINCE_LOAD_MS }),
          fullInp({ inpSinceLoad: -MAX_SINCE_LOAD_MS }),
          fullInp({ inpSinceLoad: 0 }),
          fullInp({ inpSinceLoad: MAX_SINCE_LOAD_MS + 1 }),
          fullInp({ inpSinceLoad: -MAX_SINCE_LOAD_MS - 1 }),
        ],
      });

      expect(rows().map((row) => row.inp_since_load_ms)).toEqual([
        MAX_SINCE_LOAD_MS,
        -MAX_SINCE_LOAD_MS,
        0,
        null,
        null,
      ]);
    });

    it("CHECK-i migracji powtarzają DOKŁADNIE słowniki reportera", () => {
      // SQL nie zaimportuje słowników, więc migracja je przepisuje - a ten test
      // pilnuje, że przepisała wiernie (druga bramka nie może być węższa ani
      // szersza od pierwszej). Zmiana słownika = nowa migracja i nowy plik tutaj.
      const sql = readFileSync(MIGRATION_FILE, "utf8");
      const inList = (column: string): string[] => {
        const match = new RegExp(`${column}\\s+IN\\s*\\(([^)]*)\\)`).exec(sql);
        return (match?.[1] ?? "").split(",").map((item) => item.trim().replace(/^'|'$/g, ""));
      };

      expect(inList("edge_cache")).toEqual([...EDGE_CACHE_STATUSES]);
      expect(inList("edge_layer")).toEqual([...EDGE_LAYERS]);
      expect(inList("inp_event")).toEqual([...INP_EVENT_VALUES]);
      expect(sql).toContain(`inp_since_load_ms >= -${MAX_SINCE_LOAD_MS}`);
      expect(sql).toContain(`inp_since_load_ms <= ${MAX_SINCE_LOAD_MS}`);
      expect(sql).toContain("colo ~ '^[A-Z]{3}$'");
    });

    it("trasa importuje słowniki reportera WYŁĄCZNIE jako typy", () => {
      // Import WARTOŚCI z `@/lib/webVitals` scaliłby leniwy reporter z chunkiem
      // routera Workera (moduł jest też celem `import()` z `__root.tsx`, więc
      // Rollup go nie wytrząśnie). Typ daje to samo wiązanie za zero bajtów.
      const source = readFileSync(ROUTE_FILE, "utf8");
      const imports = [
        ...source.matchAll(/import\s+(type\s+)?[^;]*?from\s+["']@\/lib\/webVitals["']/g),
      ];

      expect(imports.length).toBeGreaterThan(0);
      for (const found of imports) expect(found[1]).toBe("type ");
      expect(source).not.toMatch(/import\(\s*["']@\/lib\/webVitals["']\s*\)/);
    });
  });

  describe("wartości spoza kontraktu schodzą na NULL, nie kasują próbki", () => {
    const cases: Array<[string, Record<string, unknown>, (typeof P06_COLUMNS)[number]]> = [
      ["status cache małymi literami (bez normalizacji)", { edgeCache: "hit" }, "edge_cache"],
      ["status cache spoza słownika", { edgeCache: "EXPIRED" }, "edge_cache"],
      ["status cache jako liczba", { edgeCache: 1 }, "edge_cache"],
      ["warstwa `L3` (serwer jej nie emituje)", { edgeLayer: "L3" }, "edge_layer"],
      ["warstwa małymi literami", { edgeLayer: "l1" }, "edge_layer"],
      ["warstwa jako obiekt", { edgeLayer: { layer: "L1" } }, "edge_layer"],
      ["kolonia małymi literami", { colo: "waw" }, "colo"],
      ["kolonia z czterech liter", { colo: "WAWA" }, "colo"],
      ["kolonia z dwóch liter", { colo: "WA" }, "colo"],
      ["kolonia z cyfrą", { colo: "W1W" }, "colo"],
      ["kolonia ze spacją", { colo: " WAW" }, "colo"],
      ["kolonia z diakrytykiem", { colo: "ŁÓD" }, "colo"],
      ["kolonia jako liczba", { colo: 123 }, "colo"],
      ["zdarzenie spoza sześciu", { inpEvent: "scroll" }, "inp_event"],
      ["zdarzenie wielką literą", { inpEvent: "Click" }, "inp_event"],
      ["zdarzenie jako liczba", { inpEvent: 5 }, "inp_event"],
      ['`inpPreHydration` jako napis `"true"`', { inpPreHydration: "true" }, "inp_pre_hydration"],
      ["`inpPreHydration` jako liczba", { inpPreHydration: 1 }, "inp_pre_hydration"],
      ["`inpPreHydration` jako null", { inpPreHydration: null }, "inp_pre_hydration"],
      ["`inpSinceLoad` ułamkowe", { inpSinceLoad: 12.5 }, "inp_since_load_ms"],
      ["`inpSinceLoad` w cudzysłowie", { inpSinceLoad: "100" }, "inp_since_load_ms"],
      ["`inpSinceLoad` jako null", { inpSinceLoad: null }, "inp_since_load_ms"],
      ["`inpSinceLoad` jako boolean", { inpSinceLoad: true }, "inp_since_load_ms"],
      ["`inpFirst: false` (reporter go nie wysyła)", { inpFirst: false }, "inp_first"],
      ['`inpFirst` jako napis `"true"`', { inpFirst: "true" }, "inp_first"],
      ["`inpFirst` jako liczba", { inpFirst: 1 }, "inp_first"],
    ];

    for (const [label, patch, column] of cases) {
      it(label, async () => {
        await post({ metrics: [fullInp(patch)] });

        const row = rows()[0]!;
        // Próbka ZOSTAJE, a złe pole kosztuje wyłącznie siebie: reszta pól
        // P0.6 i kontekst nawigacji są zapisane jak w kompletnej próbce.
        expect(row).toMatchObject({ metric: "INP", value: 312, since_nav_ms: 2456 });
        expect(row[column]).toBeNull();
        for (const other of P06_COLUMNS) {
          if (other !== column) expect(row[other]).not.toBeNull();
        }
      });
    }

    it("atrybucja INP na próbce INNEJ niż INP jest zerowana, stan cache zostaje", async () => {
      // Atrybucja opisuje interakcję wyznaczającą INP; na wierszu LCP byłaby
      // fałszywa (to samo pilnuje CHECK `web_vitals_inp_attribution_only_inp`).
      await post({ metrics: [sample({ name: "LCP", value: 2100, ...edge, ...inp })] });

      expect(rows()[0]).toMatchObject({
        metric: "LCP",
        edge_cache: "MISS",
        colo: "WAW",
        inp_event: null,
        inp_pre_hydration: null,
        inp_since_load_ms: null,
        inp_first: null,
      });
    });
  });

  describe("dwustopniowe ponowienie po braku kolumny", () => {
    const NAVIGATION_COLUMNS = [
      "since_nav_ms",
      "navigation_type",
      "device_memory",
      "effective_type",
      "cold_start",
    ];
    const CORE_COLUMNS = ["metric", "value", "rating", "path", "tenant_id"];

    it("stopień 1: brak kolumny P0.6 zrzuca WYŁĄCZNIE siedem kolumn P0.6, kontekst nawigacji zostaje", async () => {
      h.insert.mockResolvedValueOnce({ error: { code: "PGRST204" } });
      h.insert.mockResolvedValueOnce({ error: null });

      const res = await post({ metrics: [fullInp()] });

      expect(res.status).toBe(204);
      expect(h.insert).toHaveBeenCalledTimes(2);
      const retried = rowsAt(1)[0]!;
      expect(Object.keys(retried).sort()).toEqual([...CORE_COLUMNS, ...NAVIGATION_COLUMNS].sort());
      expect(retried).toEqual({
        metric: "INP",
        value: 312,
        rating: "good",
        path: "/wpis/x",
        tenant_id: "tenant-1",
        since_nav_ms: 2456,
        navigation_type: "navigate",
        device_memory: 4,
        effective_type: "4g",
        cold_start: true,
      });
    });

    it("stopień 2: drugi brak kolumny (42703) schodzi do samego rdzenia", async () => {
      h.insert.mockResolvedValueOnce({ error: { code: "PGRST204" } });
      h.insert.mockResolvedValueOnce({ error: { code: "42703" } });
      h.insert.mockResolvedValueOnce({ error: null });

      const res = await post({ metrics: [fullInp()] });

      expect(res.status).toBe(204);
      expect(h.insert).toHaveBeenCalledTimes(3);
      expect(rowsAt(2)[0]).toEqual({
        metric: "INP",
        value: 312,
        rating: "good",
        path: "/wpis/x",
        tenant_id: "tenant-1",
      });
    });

    it("stopnie nie mnożą się: trzeci brak kolumny nie daje czwartego zapisu", async () => {
      h.insert.mockResolvedValue({ error: { code: "PGRST204" } });

      const res = await post({ metrics: [fullInp()] });

      expect(res.status).toBe(204);
      expect(h.insert).toHaveBeenCalledTimes(3);
    });

    it("INNY błąd na stopniu 1 kończy ponawianie - bez stopnia 2", async () => {
      h.insert.mockResolvedValueOnce({ error: { code: "PGRST204" } });
      h.insert.mockResolvedValueOnce({ error: { code: "53300", message: "too many connections" } });

      const res = await post({ metrics: [fullInp()] });

      expect(res.status).toBe(204);
      expect(h.insert).toHaveBeenCalledTimes(2);
    });

    it("oba stopnie niosą CAŁY batch, każdy wiersz z tenantem", async () => {
      h.insert.mockResolvedValueOnce({ error: { code: "PGRST204" } });
      h.insert.mockResolvedValueOnce({ error: { code: "PGRST204" } });
      h.insert.mockResolvedValueOnce({ error: null });

      await post({
        metrics: [
          sample({ name: "LCP", ...navigation, ...edge }),
          fullInp(),
          sample({ name: "CLS", value: 0.1 }),
        ],
      });

      for (const call of [1, 2]) {
        expect(rowsAt(call).map((row) => row.metric)).toEqual(["LCP", "INP", "CLS"]);
        for (const row of rowsAt(call)) expect(row.tenant_id).toBe("tenant-1");
      }
    });

    it("bez tenanta stopnie ponowienia też nie wymyślają kolumny `tenant_id`", async () => {
      h.tenantId = null;
      h.insert.mockResolvedValueOnce({ error: { code: "PGRST204" } });
      h.insert.mockResolvedValueOnce({ error: { code: "PGRST204" } });
      h.insert.mockResolvedValueOnce({ error: null });

      await post({ metrics: [fullInp()] });

      expect(Object.keys(rowsAt(1)[0]!)).not.toContain("tenant_id");
      expect(Object.keys(rowsAt(2)[0]!)).not.toContain("tenant_id");
    });
  });
});
