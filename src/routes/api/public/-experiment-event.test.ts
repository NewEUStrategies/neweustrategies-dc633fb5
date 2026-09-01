// Ingest zdarzeń testów A/B: POST /api/public/experiment-event.
//
// PO CO. Publiczny prefix `/api/public/*` omija broker uwierzytelnienia
// platformy, a bezpośredni INSERT do `builder_experiment_events` jest
// zablokowany od migracji 20260730140000 - bo zalogowana sesja mogła zalewać
// tabelę sfabrykowanymi zdarzeniami i dowolnie ustawiać "zwycięzcę" testu A/B.
// Cały ciężar tej decyzji spoczywa więc na TYM handlerze, a do wydania 8
// audytu nie miał ani jednego testu (0/28 linii, 0/3 funkcji).
//
// Cztery zapory, których pilnuje ten plik:
//   1. Zod: uuid eksperymentu, wariant a|b, zdarzenie exposure|conversion,
//      identyfikator gościa w wąskim alfabecie.
//   2. Limiter po `viewer_hash` (sha256 z adresu i user-agenta), wspólny dla
//      wszystkich eksperymentów na stronie.
//   3. Eksperyment MUSI istnieć i mieć status `running` - przywrócony warunek
//      `is_experiment_running` ze zdjętej polityki RLS.
//   4. IZOLACJA NAJEMCY: eksperyment musi należeć do tenanta przeglądanego
//      hosta. Bez tego zdarzenie z witryny A wpada do testu firmy B.
//
// UWAGA NA KSZTAŁT ODPOWIEDZI. Ten endpoint - w odróżnieniu od trzech
// pozostałych beaconów tego modułu - ŚWIADOMIE oddaje kody błędów (400/404/
// 429/500) i 202 na sukces. To jest jego kontrakt, nie usterka: nadawcą jest
// `sendBeacon`, który odpowiedzi nie czyta, ale ten sam adres woła też panel
// podglądu wariantu. Testy niżej ten kontrakt UTRWALAJĄ - zamiana na 204
// byłaby zmianą zachowania, nie naprawą.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  rateLimit: vi.fn(),
  maybeSingle: vi.fn(),
  insert: vi.fn(),
  hostTenantId: "tenant-1" as string | null,
  trustedHost: "redakcja.example.test" as string | null,
  selectedTable: "" as string,
}));

vi.mock("@/lib/server/rate-limit.server", () => ({ rateLimit: h.rateLimit }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      h.selectedTable = table;
      return {
        select: () => ({ eq: () => ({ maybeSingle: h.maybeSingle }) }),
        insert: h.insert,
      };
    },
  },
}));
vi.mock("@/lib/server/tenant.server", () => ({
  resolveTenantIdForHost: async () => h.hostTenantId,
  resolveTrustedRequestHost: async () => h.trustedHost,
}));

import { routeServerHandlers } from "@/test/routeHarness";
import { Route } from "@/routes/api/public/experiment-event";

const handlers = routeServerHandlers(Route);
const POST = handlers.POST!;
const OPTIONS = handlers.OPTIONS!;

const EXPERIMENT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const VISITOR_ID = "9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f";

function body(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    experimentId: EXPERIMENT_ID,
    variant: "a",
    event: "exposure",
    visitorId: VISITOR_ID,
    ...patch,
  };
}

let ipCounter = 0;
function request(payload: unknown, raw?: string, headers?: Record<string, string>): Request {
  ipCounter += 1;
  return new Request("https://redakcja.example.test/api/public/experiment-event", {
    method: "POST",
    headers: {
      "cf-connecting-ip": `10.4.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`,
      ...(headers ?? {}),
    },
    body: raw ?? JSON.stringify(payload),
  });
}

async function post(payload: unknown, raw?: string, headers?: Record<string, string>) {
  const req = request(payload, raw, headers);
  return POST({ request: req });
}

beforeEach(() => {
  h.rateLimit.mockReset().mockResolvedValue(true);
  h.maybeSingle
    .mockReset()
    .mockResolvedValue({ data: { id: EXPERIMENT_ID, status: "running", tenant_id: "tenant-1" }, error: null });
  h.insert.mockReset().mockResolvedValue({ error: null });
  h.hostTenantId = "tenant-1";
  h.trustedHost = "redakcja.example.test";
  h.selectedTable = "";
});

// ---------------------------------------------------------------------------
describe("zapis zdarzenia", () => {
  it("EKSPOZYCJA prawidłowego eksperymentu zapisuje wiersz i oddaje 202", async () => {
    const res = await post(body({ path: "/cennik" }));

    expect(res.status).toBe(202);
    expect(h.insert).toHaveBeenCalledWith({
      experiment_id: EXPERIMENT_ID,
      variant: "a",
      event: "exposure",
      visitor_id: VISITOR_ID,
      path: "/cennik",
    });
  });

  it("KONWERSJA wariantu B też jest przyjmowana i przypisana do TEGO wariantu", async () => {
    await post(body({ variant: "b", event: "conversion" }));

    expect(h.insert.mock.calls[0]![0]).toMatchObject({ variant: "b", event: "conversion" });
  });

  it("brak `path` zapisuje NULL, a nie pusty napis - raport odróżnia brak od pustej ścieżki", async () => {
    await post(body());

    expect(h.insert.mock.calls[0]![0]).toMatchObject({ path: null });
  });

  it("identyfikator gościa z fallbacku base36 (bez myślników) też przechodzi", async () => {
    // `getVisitorId()` ma dwa źródła: crypto.randomUUID i fallback base36.
    await post(body({ visitorId: "m4k2p9x1q7" }));

    expect(h.insert.mock.calls[0]![0]).toMatchObject({ visitor_id: "m4k2p9x1q7" });
  });

  it("preflight OPTIONS oddaje 204 z nagłówkami CORS - sendBeacon bywa poprzedzony preflightem", async () => {
    const res = await OPTIONS({ request: request(body()) });

    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
  });
});

// ---------------------------------------------------------------------------
describe("walidacja wejścia", () => {
  it("ciało niebędące JSON-em kończy się 400, a nie wyjątkiem", async () => {
    const res = await post(null, "to nie jest json");

    expect(res.status).toBe(400);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("IDENTYFIKATOR eksperymentu spoza formatu UUID jest odrzucany", async () => {
    const res = await post(body({ experimentId: "'; drop table builder_experiments; --" }));

    expect(res.status).toBe(400);
    expect(h.maybeSingle).not.toHaveBeenCalled();
  });

  it("WARIANT spoza {a, b} jest odrzucany - trzeci wariant rozsypałby raport testu", async () => {
    const res = await post(body({ variant: "c" }));

    expect(res.status).toBe(400);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("ZDARZENIE spoza {exposure, conversion} jest odrzucane", async () => {
    const res = await post(body({ event: "klikniecie" }));

    expect(res.status).toBe(400);
  });

  it("IDENTYFIKATOR GOŚCIA poza alfabetem [a-z0-9-]{8,64} jest odrzucany", async () => {
    for (const visitorId of ["krotki", "x".repeat(80), "ma spacje w srodku", "<script>"]) {
      h.insert.mockClear();
      const res = await post(body({ visitorId }));
      expect(res.status).toBe(400);
      expect(h.insert).not.toHaveBeenCalled();
    }
  });

  it("ŚCIEŻKA ponad 2 000 znaków jest odrzucana", async () => {
    const res = await post(body({ path: "/" + "p".repeat(2_100) }));

    expect(res.status).toBe(400);
  });

  it("brakujące pole obowiązkowe jest odrzucane", async () => {
    const { variant: _variant, ...withoutVariant } = body();

    const res = await post(withoutVariant);

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe("limiter", () => {
  it("odmowa limitera kończy się 429 i NIE dotyka bazy", async () => {
    h.rateLimit.mockResolvedValue(false);

    const res = await post(body());

    expect(res.status).toBe(429);
    expect(h.maybeSingle).not.toHaveBeenCalled();
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("limiter jest kluczowany HASHEM widza, a nie surowym adresem - w kluczu nie ma IP", async () => {
    // Klucz limitera trafia do tabeli `rate_limit_hit`; gdyby był surowym
    // adresem, tabela techniczna stałaby się rejestrem adresów odwiedzających.
    await post(body(), undefined, { "cf-connecting-ip": "203.0.113.42", "user-agent": "Firefox/1" });

    const args = h.rateLimit.mock.calls[0]![0] as { scope: string; subjectId: string; max: number };
    expect(args.scope).toBe("ab.event");
    expect(args.max).toBe(60);
    expect(args.subjectId).not.toContain("203.0.113.42");
    expect(args.subjectId).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ten sam adres i user-agent dają ten sam hash, inny user-agent - inny", async () => {
    await post(body(), undefined, { "cf-connecting-ip": "203.0.113.9", "user-agent": "A" });
    await post(body(), undefined, { "cf-connecting-ip": "203.0.113.9", "user-agent": "A" });
    await post(body(), undefined, { "cf-connecting-ip": "203.0.113.9", "user-agent": "B" });

    const subject = (i: number) => (h.rateLimit.mock.calls[i]![0] as { subjectId: string }).subjectId;
    expect(subject(0)).toBe(subject(1));
    expect(subject(0)).not.toBe(subject(2));
  });

  it("adres czytany jest kolejno z cf-connecting-ip, x-forwarded-for, x-real-ip", async () => {
    await post(body(), undefined, { "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
    await post(body(), undefined, { "x-real-ip": "203.0.113.8" });
    const req = new Request("https://redakcja.example.test/api/public/experiment-event", {
      method: "POST",
      body: JSON.stringify(body()),
    });
    await POST({ request: req });

    const subject = (i: number) => (h.rateLimit.mock.calls[i]![0] as { subjectId: string }).subjectId;
    // Trzy różne źródła adresu dają trzy różne kubełki; brak adresu ma własny,
    // wspólny kubełek zamiast kanału bez limitu.
    expect(new Set([subject(0), subject(1), subject(2)]).size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
describe("stan eksperymentu", () => {
  it("nieistniejący eksperyment kończy się 404", async () => {
    h.maybeSingle.mockResolvedValue({ data: null, error: null });

    const res = await post(body());

    expect(res.status).toBe(404);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("eksperyment ZATRZYMANY nie przyjmuje zdarzeń - inaczej wynik zamkniętego testu pełzałby dalej", async () => {
    for (const status of ["draft", "paused", "finished"]) {
      h.insert.mockClear();
      h.maybeSingle.mockResolvedValue({
        data: { id: EXPERIMENT_ID, status, tenant_id: "tenant-1" },
        error: null,
      });

      const res = await post(body());

      expect(res.status).toBe(404);
      expect(h.insert).not.toHaveBeenCalled();
    }
  });

  it("błąd odczytu eksperymentu kończy się 404, a nie 500", async () => {
    h.maybeSingle.mockResolvedValue({ data: null, error: { message: "postgrest padl" } });

    const res = await post(body());

    expect(res.status).toBe(404);
  });

  it("odczyt idzie do tabeli eksperymentów, nie do tabeli zdarzeń", async () => {
    await post(body());

    expect(h.selectedTable).toBe("builder_experiment_events");
    // Ostatnie `from()` to insert; pierwsze musiało dotknąć `builder_experiments`.
    expect(h.maybeSingle).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
describe("izolacja najemcy", () => {
  it("eksperyment INNEGO tenanta jest odrzucany - dane firmy A nie wpadają do testu firmy B", async () => {
    h.maybeSingle.mockResolvedValue({
      data: { id: EXPERIMENT_ID, status: "running", tenant_id: "tenant-OBCY" },
      error: null,
    });

    const res = await post(body());

    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Cross-tenant blocked");
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("host nierozwiązywalny do tenanta jest odrzucany - brak tenanta NIE oznacza 'wszystkie'", async () => {
    h.hostTenantId = null;

    const res = await post(body());

    expect(res.status).toBe(400);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("tenant liczony jest z hosta ZWERYFIKOWANEGO przy krawędzi, nie z nagłówka Host", async () => {
    // `resolveTrustedRequestHost` sprawdza host wobec katalogu tenantów -
    // podstawiony X-Forwarded-Host nie ma prawa wskazać obcego tenanta.
    h.trustedHost = null;
    h.hostTenantId = null;

    const res = await post(body(), undefined, { "x-forwarded-host": "obcy.example.test" });

    expect(res.status).toBe(400);
    expect(h.insert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe("odporność", () => {
  it("błąd zapisu kończy się 500 - i to jest kontrakt tego endpointu, nie regres", async () => {
    h.insert.mockResolvedValue({ error: { message: "insert padl" } });

    const res = await post(body());

    expect(res.status).toBe(500);
  });
});
