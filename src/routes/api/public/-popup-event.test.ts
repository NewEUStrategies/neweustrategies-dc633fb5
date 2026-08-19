// Ingest beaconów popupu buildera: GET/POST /api/public/popup-event.
//
// PO CO. `PopupHost` woła ten endpoint przez `navigator.sendBeacon` przy każdym
// pokazaniu i konwersji, więc trafia tu ruch KAŻDEGO odwiedzającego - także boty
// i skanery. Endpoint jest publiczny, bez sesji i bez podpisu, dlatego jego cała
// obrona to walidacja wejścia i limiter:
//   * dowolny `popup_id` bez sprawdzenia formatu to gotowy wektor wpisywania
//     śmieci do tabeli statystyk, której nikt potem nie odczyści;
//   * dowolny `kind` rozsypałby raport na zawsze - wiersze, których panel nie
//     umie policzyć, zostają;
//   * body bez limitu długości to zapchanie pamięci workera jednym żądaniem.
//
// Druga reguła: KAŻDA ścieżka oddaje 204 i połyka błędy. Beacon nie ma jak
// obsłużyć odpowiedzi, a błąd w odpowiedzi na `sendBeacon` w niektórych
// przeglądarkach loguje się do konsoli odwiedzającego.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  insert: vi.fn(),
  tenantId: "tenant-1" as string | null,
  tenantThrows: false,
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: () => ({ insert: h.insert }) },
}));
vi.mock("@/lib/server/tenant.server", () => ({
  resolveTenantIdForHost: async () => {
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
import { Route } from "@/routes/api/public/popup-event";

const handler = routeServerHandlers(Route).POST!;
const POPUP_ID = "11111111-2222-3333-4444-555555555555";

/** Żądanie z unikalnym adresem klienta - limiter jest wspólny dla modułu. */
let ipCounter = 0;
function beacon(body: unknown, raw?: string): Request {
  ipCounter += 1;
  return new Request("https://redakcja.example.test/api/public/popup-event", {
    method: "POST",
    headers: { "x-forwarded-for": `10.1.${Math.floor(ipCounter / 250)}.${ipCounter % 250}` },
    body: raw ?? JSON.stringify(body),
  });
}

async function post(body: unknown, raw?: string) {
  req.current = beacon(body, raw);
  return handler({ request: req.current });
}

beforeEach(() => {
  h.insert.mockReset();
  h.insert.mockResolvedValue({ error: null });
  h.tenantId = "tenant-1";
  h.tenantThrows = false;
});

// ---------------------------------------------------------------------------
describe("zapis beaconu", () => {
  it("prawidłowy beacon WYŚWIETLENIA zapisuje wiersz z tenantem", async () => {
    const res = await post({ kind: "view", popup_id: POPUP_ID });

    expect(res.status).toBe(204);
    expect(h.insert).toHaveBeenCalledWith({
      popup_id: POPUP_ID,
      kind: "view",
      tenant_id: "tenant-1",
    });
  });

  it("beacon KONWERSJI też jest przyjmowany", async () => {
    await post({ kind: "conversion", popup_id: POPUP_ID });

    expect(h.insert.mock.calls[0]![0]).toMatchObject({ kind: "conversion" });
    // Konwersja jest przypisana do TEGO popupu, nie do pierwszego z bazy.
    expect(h.insert.mock.calls[0]![0]).toMatchObject({ popup_id: POPUP_ID });
  });

  it("BRAK tenanta zostawia kolumnę pustą - domyślna wartość kolumny wchodzi w grę", async () => {
    // Wiersz bez tenanta nadal jest policzalny; wiersz z ZŁYM tenantem zatruwa
    // raport obcej instalacji.
    h.tenantId = null;

    await post({ kind: "view", popup_id: POPUP_ID });

    expect(Object.keys(h.insert.mock.calls[0]![0] as object)).not.toContain("tenant_id");
    // Wiersz JEST zapisywany - brak tenanta nie gubi zdarzenia.
    expect(h.insert).toHaveBeenCalledTimes(1);
  });

  it("AWARIA rozwiązania tenanta nie blokuje zapisu", async () => {
    h.tenantThrows = true;

    const res = await post({ kind: "view", popup_id: POPUP_ID });

    expect(res.status).toBe(204);
    expect(h.insert).toHaveBeenCalled();
  });

  it("odpowiedź NIE JEST cachowana - beacon musi dojść za każdym razem", async () => {
    const res = await post({ kind: "view", popup_id: POPUP_ID });

    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.status).toBe(204);
  });
});

// ---------------------------------------------------------------------------
describe("walidacja wejścia", () => {
  it("RODZAJ spoza dwóch dozwolonych jest odrzucany", async () => {
    // Dowolny napis w kolumnie `kind` rozsypałby raport na zawsze.
    const res = await post({ kind: "cokolwiek", popup_id: POPUP_ID });

    expect(res.status).toBe(204);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("IDENTYFIKATOR nie-UUID jest odrzucany", async () => {
    // Bez sprawdzenia formatu tabela statystyk zbiera śmieci, których nikt potem
    // nie odczyści.
    const res = await post({ kind: "view", popup_id: "'; drop table popups; --" });

    expect(res.status).toBe(204);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("brak identyfikatora jest odrzucany", async () => {
    const res = await post({ kind: "view" });

    expect(h.insert).not.toHaveBeenCalled();
    // Beacon nie może dostać błędu 5xx - przeglądarka ponawiałaby wysyłkę.
    expect(res.status).toBeLessThan(500);
  });

  it("identyfikator innego typu niż napis jest odrzucany", async () => {
    const res = await post({ kind: "view", popup_id: 12345 });

    expect(h.insert).not.toHaveBeenCalled();
    expect(res.status).toBeLessThan(500);
  });

  it("PUSTE body nie wywala endpointu", async () => {
    const res = await post(null, "");

    expect(res.status).toBe(204);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("body PONAD limitem długości jest odrzucane bez parsowania", async () => {
    // Bez limitu jedno żądanie zapycha pamięć workera.
    const res = await post(null, JSON.stringify({ kind: "view", pad: "x".repeat(2000) }));

    expect(res.status).toBe(204);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("body, które nie jest JSON-em, nie wywala endpointu", async () => {
    const res = await post(null, "to nie jest json");

    expect(res.status).toBe(204);
    expect(h.insert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe("odporność", () => {
  it("AWARIA zapisu nadal oddaje 204 - beacon nie ma jak obsłużyć błędu", async () => {
    h.insert.mockRejectedValue(new Error("baza padla"));

    const res = await post({ kind: "view", popup_id: POPUP_ID });

    expect(res.status).toBe(204);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("LIMITER wycisza zalew z jednego adresu, nie zwracając błędu", async () => {
    // 30 żetonów z uzupełnianiem 0,5/s - po serii żądań z tego samego adresu
    // kolejne muszą przestać zapisywać, ale nadal oddawać 204.
    req.current = null;
    const stableIp = { "x-forwarded-for": "10.9.9.9" };
    const send = () =>
      handler({
        request: new Request("https://redakcja.example.test/api/public/popup-event", {
          method: "POST",
          headers: stableIp,
          body: JSON.stringify({ kind: "view", popup_id: POPUP_ID }),
        }),
      });

    const statuses: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      req.current = new Request("https://redakcja.example.test/api/public/popup-event", {
        method: "POST",
        headers: stableIp,
        body: JSON.stringify({ kind: "view", popup_id: POPUP_ID }),
      });
      statuses.push((await send()).status);
    }

    expect(new Set(statuses)).toEqual(new Set([204]));
    expect(h.insert.mock.calls.length).toBeLessThan(40);
  });
});
