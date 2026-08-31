// Ingest beaconow reklamowych: POST /api/public/ad-event.
//
// PO CO OSOBNY PLIK NA KAZDA DECYZJE. Ten endpoint jest publiczny, bez sesji i
// bez podpisu, a KAZDA jego sciezka konczy sie tym samym `204` i polyka wyjatki
// (`catch {}`). Zapis, odrzucenie i awaria wygladaja z zewnatrz IDENTYCZNIE -
// wiec test sprawdzajacy kod odpowiedzi nie odroznia dzialajacej bramki od
// zdjetej. Dlatego kazda asercja ponizej patrzy na SKUTEK W BAZIE: czy wiersz
// w `ad_events` powstal i z jakim `placement_id` / `tenant_id`.
//
// Sciany, ktorych ten plik pilnuje (szesc decyzji bezpieczenstwa):
//   1. limiter po IP (60 burst, 1/s)
//   2. limit dlugosci ciala (2 000 bajtow)
//   3. biala lista rodzajow zdarzen + regex UUID na `slot_id`
//   4. odrzucenie zadania przy NIEROZPOZNANYM najemcy (zamiast wpadania do
//      najemcy domyslnego)
//   5. weryfikacja WLASNOSCI slotu wzgledem najemcy hosta (przeciw podszywaniu
//      cross-tenant)
//   6. weryfikacja, ze `placement_id` wskazuje TEN slot w TYM najemcy
//
// Plus RODO: `path` przechodzi przez `redactUrl`, a do `ad_events` nie trafia
// nic identyfikujacego osobe.
//
// ATRAPUJEMY WYLACZNIE GRANICE: klienta bazy, rozwiazywanie najemcy i host
// zadania. Limiter, walidacja wejscia i `redactUrl` biegna PRAWDZIWE - to one
// sa przedmiotem dowodu.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { supabaseFromStub, ok } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({
  tenantId: "aaaaaaaa-0000-0000-0000-00000000000a" as string | null,
  tenantThrows: false,
}));

const db = vi.hoisted(
  () =>
    ({ current: null }) as {
      current: ReturnType<typeof import("@/test/supabaseChain").supabaseFromStub> | null;
    },
);

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => db.current!.from(table) },
}));
vi.mock("@/lib/server/tenant.server", () => ({
  resolveTenantIdForHost: async () => {
    if (h.tenantThrows) throw new Error("brak katalogu najemcow");
    return h.tenantId;
  },
}));
vi.mock("@/lib/http/requestHost", () => ({
  currentTenantHost: async () => "redakcja.example.test",
}));

const req = vi.hoisted(() => ({ current: null as Request | null }));
vi.mock("@tanstack/react-start/server", () => ({ getRequest: () => req.current }));

import { routeServerHandlers } from "@/test/routeHarness";
import { Route } from "@/routes/api/public/ad-event";

const handler = routeServerHandlers(Route).POST!;

const TENANT = "aaaaaaaa-0000-0000-0000-00000000000a";
const OTHER_TENANT = "bbbbbbbb-0000-0000-0000-00000000000b";
const SLOT = "11111111-2222-3333-4444-555555555555";
const PLACEMENT = "66666666-7777-8888-9999-000000000000";

/** Kazde zadanie z INNEGO adresu - limiter jest stanem modulu, wspolnym dla pliku. */
let ipCounter = 0;
function beacon(body: unknown, raw?: string): Request {
  ipCounter += 1;
  return new Request("https://redakcja.example.test/api/public/ad-event", {
    method: "POST",
    headers: { "x-forwarded-for": `10.9.${Math.floor(ipCounter / 250)}.${ipCounter % 250}` },
    body: raw ?? JSON.stringify(body),
  });
}

async function post(body: unknown, raw?: string): Promise<Response> {
  req.current = beacon(body, raw);
  return handler({ request: req.current });
}

/** Wiersze, ktore trafily do `ad_events` - jedyny obserwowalny skutek endpointu. */
function inserted(): Record<string, unknown>[] {
  return db
    .current!.chainsFor("ad_events")
    .map((c) => c.argsOf("insert")?.[0])
    .filter((v): v is Record<string, unknown> => !!v && typeof v === "object");
}

/** Slot nalezy do najemcy `tenant`; placement (opcjonalnie) do slotu `slot`. */
function seed(
  opts: {
    slotTenant?: string | null;
    placementSlot?: string | null;
    placementTenant?: string;
  } = {},
) {
  const stub = supabaseFromStub();
  const slotTenant = opts.slotTenant === undefined ? TENANT : opts.slotTenant;
  const placementSlot = opts.placementSlot === undefined ? SLOT : opts.placementSlot;
  const placementTenant = opts.placementTenant ?? TENANT;

  stub.setResponse("ad_slots", (chain) => {
    const id = chain.calls.find((c) => c.method === "eq" && c.args[0] === "id")?.args[1];
    const tenant = chain.calls.find((c) => c.method === "eq" && c.args[0] === "tenant_id")?.args[1];
    const match = slotTenant !== null && id === SLOT && tenant === slotTenant;
    return ok(match ? { id: SLOT } : null);
  });
  stub.setResponse("ad_placements", (chain) => {
    const id = chain.calls.find((c) => c.method === "eq" && c.args[0] === "id")?.args[1];
    const slot = chain.calls.find((c) => c.method === "eq" && c.args[0] === "slot_id")?.args[1];
    const tenant = chain.calls.find((c) => c.method === "eq" && c.args[0] === "tenant_id")?.args[1];
    const match =
      placementSlot !== null &&
      id === PLACEMENT &&
      slot === placementSlot &&
      tenant === placementTenant;
    return ok(match ? { id: PLACEMENT } : null);
  });
  stub.setResponse("ad_events", ok(null));
  db.current = stub;
}

beforeEach(() => {
  h.tenantId = TENANT;
  h.tenantThrows = false;
  seed();
});

// ---------------------------------------------------------------------------
describe("sciezka szczesliwa - punkt odniesienia dla asercji odmowy", () => {
  it("zapisuje impresje z najemcą hosta i zweryfikowanym placementem", async () => {
    await post({ kind: "impression", slot_id: SLOT, placement_id: PLACEMENT, path: "/analizy/x" });

    expect(inserted()).toEqual([
      {
        slot_id: SLOT,
        placement_id: PLACEMENT,
        kind: "impression",
        path: "/analizy/x",
        tenant_id: TENANT,
      },
    ]);
  });

  it("klikniecie tez jest przyjmowane", async () => {
    await post({ kind: "click", slot_id: SLOT });

    expect(inserted()[0]).toMatchObject({ kind: "click", slot_id: SLOT, placement_id: null });
  });
});

// --- DECYZJA 1: limiter po IP ----------------------------------------------
describe("decyzja 1: limiter po adresie klienta", () => {
  /**
   * CZAS JEST ZAMROZONY. Limiter czyta `Date.now()` przy kazdym zadaniu i
   * dolewa zeton co sekunde - bez zamrozenia liczba przepuszczonych zadan
   * zalezalaby od tego, jak dlugo petla mielila na maszynie CI, czyli test
   * bylby migotliwy dokladnie w tej asercji, ktora ma czegos dowodzic.
   */
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T10:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function sendFrom(ip: string): Promise<void> {
    req.current = new Request("https://redakcja.example.test/api/public/ad-event", {
      method: "POST",
      headers: { "x-forwarded-for": ip },
      body: JSON.stringify({ kind: "impression", slot_id: SLOT }),
    });
    await handler({ request: req.current });
  }

  it("kubelek przepuszcza DOKLADNIE 60 zadan, 61. juz nie tworzy wiersza", async () => {
    const ip = "10.200.0.1";
    for (let i = 0; i < 60; i += 1) await sendFrom(ip);
    expect(inserted()).toHaveLength(60);

    await sendFrom(ip);
    await sendFrom(ip);

    expect(inserted()).toHaveLength(60);
  });

  it("po sekundzie wraca DOKLADNIE jeden zeton (1/s), nie caly kubelek", async () => {
    const ip = "10.200.0.2";
    for (let i = 0; i < 61; i += 1) await sendFrom(ip);
    expect(inserted()).toHaveLength(60);

    vi.setSystemTime(new Date("2026-08-31T10:00:01.000Z"));
    await sendFrom(ip);
    await sendFrom(ip);

    expect(inserted()).toHaveLength(61);
  });

  it("inny adres klienta ma WLASNY kubelek", async () => {
    for (let i = 0; i < 61; i += 1) await sendFrom("10.201.0.1");
    const before = inserted().length;

    await sendFrom("10.201.0.2");

    expect(inserted()).toHaveLength(before + 1);
  });

  it("zadanie BEZ naglowka adresu wpada do jednego wspolnego kubelka, nie omija limitu", async () => {
    for (let i = 0; i < 61; i += 1) {
      req.current = new Request("https://redakcja.example.test/api/public/ad-event", {
        method: "POST",
        body: JSON.stringify({ kind: "impression", slot_id: SLOT }),
      });
      await handler({ request: req.current });
    }

    expect(inserted()).toHaveLength(60);
  });
});

// --- DECYZJA 2: limit ciala -------------------------------------------------
describe("decyzja 2: limit dlugosci ciala (2 000 bajtow)", () => {
  it("cialo ponad limit NIE tworzy wiersza", async () => {
    const fat = JSON.stringify({
      kind: "impression",
      slot_id: SLOT,
      path: "/a".repeat(1_200),
    });
    expect(fat.length).toBeGreaterThan(2_000);

    await post(null, fat);

    expect(inserted()).toEqual([]);
  });

  it("puste cialo NIE tworzy wiersza", async () => {
    await post(null, "");

    expect(inserted()).toEqual([]);
  });

  it("cialo TUZ pod limitem nadal przechodzi - limit nie jest przypadkowo zanizony", async () => {
    const body = { kind: "impression", slot_id: SLOT, path: "/x".repeat(900) };
    expect(JSON.stringify(body).length).toBeLessThan(2_000);

    await post(body);

    expect(inserted()).toHaveLength(1);
  });
});

// --- DECYZJA 3: biala lista rodzajow + UUID slotu ---------------------------
describe("decyzja 3: biala lista rodzajow zdarzen i regex UUID slotu", () => {
  it.each(["view", "conversion", "IMPRESSION", "", "impression "])(
    "rodzaj %j NIE tworzy wiersza",
    async (kind) => {
      await post({ kind, slot_id: SLOT });

      expect(inserted()).toEqual([]);
    },
  );

  it.each([
    ["nie-uuid", "slot-1"],
    ["puste", ""],
    ["prawie uuid", "11111111-2222-3333-4444-55555555555"],
    ["wstrzykniecie SQL", "11111111-2222-3333-4444-555555555555' OR '1'='1"],
  ])("slot_id %s NIE tworzy wiersza", async (_label, slotId) => {
    await post({ kind: "impression", slot_id: slotId });

    expect(inserted()).toEqual([]);
  });

  it("slot_id innego typu niz string NIE tworzy wiersza", async () => {
    await post({ kind: "impression", slot_id: 42 });

    expect(inserted()).toEqual([]);
  });

  it("cialo, ktore nie jest JSON-em, NIE tworzy wiersza", async () => {
    await post(null, "{to nie jest json");

    expect(inserted()).toEqual([]);
  });
});

// --- DECYZJA 4: nierozpoznany najemca ---------------------------------------
describe("decyzja 4: nierozpoznany najemca jest ODRZUCANY, nie podstawiany", () => {
  it("brak najemcy hosta NIE tworzy wiersza (zamiast wpasc do najemcy domyslnego)", async () => {
    h.tenantId = null;

    await post({ kind: "impression", slot_id: SLOT });

    expect(inserted()).toEqual([]);
  });

  it("awaria katalogu najemcow tez NIE tworzy wiersza", async () => {
    h.tenantThrows = true;

    await post({ kind: "impression", slot_id: SLOT });

    expect(inserted()).toEqual([]);
  });

  it("gdy najemca sie rozwiazuje, tenant_id wiersza to TEN najemca", async () => {
    h.tenantId = OTHER_TENANT;
    seed({ slotTenant: OTHER_TENANT });

    await post({ kind: "impression", slot_id: SLOT });

    expect(inserted()[0]).toMatchObject({ tenant_id: OTHER_TENANT });
  });
});

// --- DECYZJA 5: wlasnosc slotu ----------------------------------------------
describe("decyzja 5: slot musi nalezec do najemcy hosta", () => {
  it("slot NIEISTNIEJACY nie tworzy wiersza", async () => {
    seed({ slotTenant: null });

    await post({ kind: "impression", slot_id: SLOT });

    expect(inserted()).toEqual([]);
  });

  it("slot CUDZEGO najemcy nie tworzy wiersza - podszycie cross-tenant odrzucone", async () => {
    // Slot istnieje, ale nalezy do innego najemcy niz host zadania.
    seed({ slotTenant: OTHER_TENANT });

    await post({ kind: "impression", slot_id: SLOT });

    expect(inserted()).toEqual([]);
  });

  it("zapytanie o slot filtruje PO OBU kolumnach naraz", async () => {
    await post({ kind: "impression", slot_id: SLOT });

    const chain = db.current!.lastChain("ad_slots")!;
    const eqs = chain.calls.filter((c) => c.method === "eq").map((c) => [c.args[0], c.args[1]]);
    expect(eqs).toEqual(
      expect.arrayContaining([
        ["id", SLOT],
        ["tenant_id", TENANT],
      ]),
    );
  });
});

// --- DECYZJA 6: placement musi wskazywac ten slot w tym najemcy --------------
describe("decyzja 6: placement musi wskazywac TEN slot w TYM najemcy", () => {
  it("placement z CUDZEGO slotu -> wiersz powstaje, ale BEZ placementu", async () => {
    seed({ placementSlot: "99999999-9999-9999-9999-999999999999" });

    await post({ kind: "impression", slot_id: SLOT, placement_id: PLACEMENT });

    // Zdarzenie nie ginie - ginie tylko NIEZWERYFIKOWANE przypisanie.
    expect(inserted()).toHaveLength(1);
    expect(inserted()[0]).toMatchObject({ slot_id: SLOT, placement_id: null });
  });

  it("placement z CUDZEGO najemcy -> wiersz BEZ placementu", async () => {
    seed({ placementTenant: OTHER_TENANT });

    await post({ kind: "impression", slot_id: SLOT, placement_id: PLACEMENT });

    expect(inserted()[0]).toMatchObject({ placement_id: null });
  });

  it("placement_id, ktory nie jest UUID-em, jest ignorowany - a zdarzenie zapisane", async () => {
    await post({ kind: "impression", slot_id: SLOT, placement_id: "nie-uuid" });

    expect(inserted()[0]).toMatchObject({ placement_id: null });
    // Bez zapytania o placement w ogole - wartosc klienta nie doszla do bazy.
    expect(db.current!.chainsFor("ad_placements")).toHaveLength(0);
  });

  it("zapytanie o placement filtruje po id, slot_id ORAZ tenant_id", async () => {
    await post({ kind: "impression", slot_id: SLOT, placement_id: PLACEMENT });

    const chain = db.current!.lastChain("ad_placements")!;
    const eqs = chain.calls.filter((c) => c.method === "eq").map((c) => [c.args[0], c.args[1]]);
    expect(eqs).toEqual(
      expect.arrayContaining([
        ["id", PLACEMENT],
        ["slot_id", SLOT],
        ["tenant_id", TENANT],
      ]),
    );
  });
});

// --- RODO -------------------------------------------------------------------
describe("RODO: sciezka przechodzi przez redactUrl, wiersz nie niesie danych osoby", () => {
  it("query string jest zdejmowany w calosci", async () => {
    await post({
      kind: "impression",
      slot_id: SLOT,
      path: "/analizy/raport?utm_source=nl&token=sekret",
    });

    const path = String(inserted()[0]!["path"]);
    expect(path).toBe("/analizy/raport?[redacted]");
    expect(path).not.toContain("sekret");
    expect(path).not.toContain("utm_source");
  });

  it("adres e-mail w sciezce jest redagowany", async () => {
    await post({ kind: "impression", slot_id: SLOT, path: "/konto/jan.kowalski@example.com" });

    const path = String(inserted()[0]!["path"]);
    expect(path).not.toContain("jan.kowalski@example.com");
    expect(path).toContain("[redacted-email]");
  });

  it("adres IP w sciezce jest redagowany", async () => {
    await post({ kind: "impression", slot_id: SLOT, path: "/log/192.168.13.7" });

    const path = String(inserted()[0]!["path"]);
    expect(path).not.toContain("192.168.13.7");
  });

  it("wiersz niesie WYLACZNIE piec pol - zadnego IP, user agenta ani identyfikatora osoby", async () => {
    await post({ kind: "impression", slot_id: SLOT, placement_id: PLACEMENT, path: "/x" });

    expect(Object.keys(inserted()[0]!).sort()).toEqual([
      "kind",
      "path",
      "placement_id",
      "slot_id",
      "tenant_id",
    ]);
  });

  it("brak sciezki zapisuje NULL, nie pusty string", async () => {
    await post({ kind: "impression", slot_id: SLOT });

    expect(inserted()[0]).toMatchObject({ path: null });
  });

  it("sciezka jest przycinana do 512 znakow PRZED redakcja", async () => {
    await post({ kind: "impression", slot_id: SLOT, path: "/" + "a".repeat(900) });

    expect(String(inserted()[0]!["path"]).length).toBeLessThanOrEqual(512);
  });
});

// --- kontrakt odpowiedzi ----------------------------------------------------
describe("kontrakt beaconu", () => {
  it("KAZDA sciezka oddaje 204 bez tresci - takze odmowa", async () => {
    const okRes = await post({ kind: "impression", slot_id: SLOT });
    h.tenantId = null;
    const deniedRes = await post({ kind: "impression", slot_id: SLOT });

    expect(okRes.status).toBe(204);
    expect(deniedRes.status).toBe(204);
    expect(okRes.headers.get("Cache-Control")).toBe("no-store");
  });
});
