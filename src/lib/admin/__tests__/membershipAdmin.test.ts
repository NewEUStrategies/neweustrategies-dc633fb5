// PANEL CZŁONKOSTWA - WARSTWA DANYCH (`src/lib/admin/membership-admin.ts`).
// 155 linii, 11 funkcji, ZERO pokrycia przed tym plikiem.
//
// CO TEN PLIK DOWODZI. Nadania warstwy (`membership_grants`) i miejsca
// w organizacjach członkowskich to DRUGA, bezpłatna droga do praw premium -
// obok subskrypcji Stripe'a. Rozstrzyga je potem `current_membership_tier()`,
// więc błąd kształtu zapytania w tej warstwie nie „psuje listy", a rozdaje albo
// odbiera dostęp do treści płatnych. Dowodzimy:
//
//   1. KTO PISZE CZYM. Nadanie warstwy i dodanie miejsca idą przez RPC
//      (`admin_grant_membership`, `org_add_seat`) - limit miejsc i rola są
//      egzekwowane serwerowo. Odwołanie nadania i skasowanie miejsca idą
//      zapytaniem tabelowym pod RLS. Ten podział jest przedmiotem asercji:
//      przemycenie nadania przez INSERT z klienta ominęłoby walidację limitu.
//   2. KSZTAŁT: filtry `eq`, `limit`, `order`, kolejność ogniw łańcucha.
//   3. `?? undefined` W PARAMETRACH RPC: `null` z formularza (bezterminowo,
//      brak noty) MUSI zniknąć z argumentów, żeby baza użyła DOMYŚLNEJ
//      wartości parametru. Zero i pusty napis to wartości PRAWIDŁOWE i muszą
//      przejść - stąd pełna tabela ramion.
//   4. ODWOŁANIE NADANIA to UPDATE ze stemplem czasu, nie DELETE - ślad musi
//      zostać. Test pilnuje ustalonej daty bazowej, nie „jakiejś” daty.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - AUTORYTETU BAZY: czy `admin_grant_membership` sprawdza rolę i najemcę,
//   czy `org_add_seat` odmawia po przekroczeniu limitu miejsc, czy RLS na
//   `membership_grants` przepuszcza tylko administratora - `rls_tenant_isolation_test.sql`,
//   `security_definer_tenant_scope_test.sql`, `tenant_isolation_three_tenants_test.sql`,
//   `metering_paywall_test.sql`.
// - INTERFEJSU PANELU: `src/components/admin/membership/organisms/__tests__/*`.
//
// RODO: adresy wyłącznie w domenie `example.com`, identyfikatory umowne.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordedChain, SupabaseFromStub, SupabaseResult } from "@/test/supabaseChain";

const BASE_NOW = new Date("2026-03-15T12:00:00.000Z");

const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  rpcCalls: [] as { fn: string; args: unknown }[],
  rpcResults: new Map<string, SupabaseResult>(),
  sessionUserId: null as string | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (!h.db) throw new Error("test: atrapa bazy nieustawiona");
      return h.db.from(table);
    },
    rpc: (fn: string, args?: unknown) => {
      h.rpcCalls.push({ fn, args });
      const planned = h.rpcResults.get(fn);
      if (!planned) {
        return Promise.resolve({
          data: null,
          error: new Error(`test: brak zaplanowanej odpowiedzi RPC "${fn}"`),
        });
      }
      return Promise.resolve(planned);
    },
  },
}));
vi.mock("@/lib/auth/currentUser", () => ({
  currentUserIdFromSession: () => Promise.resolve(h.sessionUserId),
}));

import { fail, ok, supabaseFromStub } from "@/test/supabaseChain";
import {
  addOrgSeat,
  createOrganization,
  deleteOrganization,
  fetchAdminOrgSeats,
  fetchMembershipGrants,
  fetchOrganizationById,
  fetchOrganizations,
  grantMembership,
  removeOrgSeat,
  revokeGrant,
  updateOrganization,
} from "@/lib/admin/membership-admin";

function db(): SupabaseFromStub {
  const value = h.db;
  if (!value) throw new Error("test: atrapa bazy nieustawiona");
  return value;
}

function chain(table: string): RecordedChain {
  const last = db().lastChain(table);
  if (!last) throw new Error(`test: brak zapytania do tabeli "${table}"`);
  return last;
}

function links(table: string): string[] {
  return chain(table).calls.map((call) => call.method);
}

function rpcArgs(fn: string): unknown {
  const call = h.rpcCalls.filter((entry) => entry.fn === fn).at(-1);
  if (!call) throw new Error(`test: RPC "${fn}" nie zostało wywołane`);
  return call.args;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(BASE_NOW);
  h.db = supabaseFromStub();
  h.rpcCalls.length = 0;
  h.rpcResults.clear();
  h.sessionUserId = "22222222-2222-4222-8222-222222222222";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("fetchMembershipGrants", () => {
  it("czyta listę nadań jednym RPC, bez zapytania tabelowego", async () => {
    const row = {
      id: "grant-1",
      user_id: "22222222-2222-4222-8222-222222222222",
      email: "czlonek@example.com",
      display_name: null,
      tier_key: "pro",
      source: "manual",
      note: null,
      starts_at: "2026-01-01T00:00:00.000Z",
      expires_at: null,
      revoked_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
    };
    h.rpcResults.set("admin_list_membership_grants", ok([row]));
    await expect(fetchMembershipGrants()).resolves.toEqual([row]);
    expect(h.rpcCalls.map((call) => call.fn)).toEqual(["admin_list_membership_grants"]);
    expect(db().chains).toEqual([]);
  });

  it("data: null daje pustą listę", async () => {
    h.rpcResults.set("admin_list_membership_grants", ok(null));
    await expect(fetchMembershipGrants()).resolves.toEqual([]);
  });

  it("błąd podnosi wyjątek", async () => {
    h.rpcResults.set("admin_list_membership_grants", fail("grants denied", "42501"));
    await expect(fetchMembershipGrants()).rejects.toThrow("grants denied");
  });
});

describe("grantMembership", () => {
  beforeEach(() => {
    h.rpcResults.set("admin_grant_membership", ok("grant-new"));
  });

  it("nadaje warstwę po adresie e-mail i oddaje identyfikator nadania", async () => {
    await expect(
      grantMembership({
        email: "czlonek@example.com",
        tierKey: "vip",
        months: 12,
        note: "Decyzja zarządu",
      }),
    ).resolves.toBe("grant-new");
    expect(rpcArgs("admin_grant_membership")).toEqual({
      p_email: "czlonek@example.com",
      p_tier_key: "vip",
      p_months: 12,
      p_note: "Decyzja zarządu",
    });
    // Nadanie NIE MOŻE iść insertem z klienta - RPC waliduje adres i rolę.
    expect(db().chains).toEqual([]);
  });

  it("bezterminowo (months: null) i brak noty znikają z argumentów RPC", async () => {
    await grantMembership({
      email: "czlonek@example.com",
      tierKey: "pro",
      months: null,
      note: null,
    });
    // `undefined` znaczy „użyj wartości domyślnej parametru", a `null`
    // przesłałby bazie jawny NULL - to dwa różne zachowania funkcji.
    expect(rpcArgs("admin_grant_membership")).toEqual({
      p_email: "czlonek@example.com",
      p_tier_key: "pro",
      p_months: undefined,
      p_note: undefined,
    });
  });

  it("ZERO miesięcy i PUSTA nota przechodzą (to wartości, nie braki)", async () => {
    await grantMembership({ email: "czlonek@example.com", tierKey: "pro", months: 0, note: "" });
    expect(rpcArgs("admin_grant_membership")).toEqual({
      p_email: "czlonek@example.com",
      p_tier_key: "pro",
      p_months: 0,
      p_note: "",
    });
  });

  it("błąd podnosi wyjątek", async () => {
    h.rpcResults.set("admin_grant_membership", fail("grant denied", "42501"));
    await expect(
      grantMembership({ email: "czlonek@example.com", tierKey: "pro", months: null, note: null }),
    ).rejects.toThrow("grant denied");
  });
});

describe("revokeGrant", () => {
  it("STEMPLUJE odwołanie, a nie kasuje wiersza (ślad musi zostać)", async () => {
    db().setResponse("membership_grants", ok(null));
    await revokeGrant("grant-1");
    expect(links("membership_grants")).toEqual(["update", "eq"]);
    expect(chain("membership_grants").argsOf("update")).toEqual([
      { revoked_at: BASE_NOW.toISOString() },
    ]);
    expect(chain("membership_grants").argsOf("eq")).toEqual(["id", "grant-1"]);
    expect(chain("membership_grants").has("delete")).toBe(false);
  });

  it("błąd podnosi wyjątek", async () => {
    db().setResponse("membership_grants", fail("revoke denied", "42501"));
    await expect(revokeGrant("grant-1")).rejects.toThrow("revoke denied");
  });
});

describe("organizacje członkowskie - odczyt", () => {
  it("lista: najnowsze pierwsze, limit 200", async () => {
    db().setResponse("member_organizations", ok([{ id: "org-1" }]));
    await expect(fetchOrganizations()).resolves.toEqual([{ id: "org-1" }]);
    expect(links("member_organizations")).toEqual(["select", "order", "limit"]);
    expect(chain("member_organizations").argsOf("order")).toEqual([
      "created_at",
      { ascending: false },
    ]);
    expect(chain("member_organizations").argsOf("limit")).toEqual([200]);
  });

  it("lista: data: null daje []", async () => {
    db().setResponse("member_organizations", ok(null));
    await expect(fetchOrganizations()).resolves.toEqual([]);
  });

  it("pojedyncza organizacja: maybeSingle po id, brak wiersza => null", async () => {
    db().setResponse("member_organizations", ok(null));
    await expect(fetchOrganizationById("org-1")).resolves.toBeNull();
    expect(links("member_organizations")).toEqual(["select", "eq", "maybeSingle"]);
    expect(chain("member_organizations").argsOf("eq")).toEqual(["id", "org-1"]);
  });

  it("pojedyncza organizacja: oddaje wiersz", async () => {
    db().setResponse("member_organizations", ok({ id: "org-1", name: "Instytut" }));
    await expect(fetchOrganizationById("org-1")).resolves.toEqual({
      id: "org-1",
      name: "Instytut",
    });
  });

  it.each([
    ["fetchOrganizations", () => fetchOrganizations()],
    ["fetchOrganizationById", () => fetchOrganizationById("org-1")],
  ])("%s: błąd podnosi wyjątek", async (_label, run) => {
    db().setResponse("member_organizations", fail("orgs denied", "42501"));
    await expect(run()).rejects.toThrow("orgs denied");
  });
});

describe("organizacje członkowskie - zapis", () => {
  const INPUT = {
    name: "Instytut Spraw Europejskich",
    tier_key: "corporate",
    seats_limit: 10,
    contact_email: "kontakt@example.com",
    note: null,
  };

  it("tworzy organizację z autorem z sesji i oddaje zapisany wiersz", async () => {
    db().setResponse("member_organizations", ok({ id: "org-new" }));
    await expect(createOrganization(INPUT)).resolves.toEqual({ id: "org-new" });
    expect(links("member_organizations")).toEqual(["insert", "select", "single"]);
    expect(chain("member_organizations").argsOf("insert")).toEqual([
      { ...INPUT, created_by: "22222222-2222-4222-8222-222222222222" },
    ]);
  });

  it("BRAK SESJI nie blokuje zapisu - autor zostaje puste (RLS i tak zdecyduje)", async () => {
    h.sessionUserId = null;
    db().setResponse("member_organizations", ok({ id: "org-new" }));
    await createOrganization(INPUT);
    expect(chain("member_organizations").argsOf("insert")).toEqual([
      { ...INPUT, created_by: null },
    ]);
  });

  it("aktualizacja przekazuje łatkę po id (także wartości zerujące)", async () => {
    db().setResponse("member_organizations", ok(null));
    await updateOrganization("org-1", { seats_limit: 0, note: null, name: "" });
    expect(links("member_organizations")).toEqual(["update", "eq"]);
    expect(chain("member_organizations").argsOf("update")).toEqual([
      { seats_limit: 0, note: null, name: "" },
    ]);
    expect(chain("member_organizations").argsOf("eq")).toEqual(["id", "org-1"]);
  });

  it("kasowanie po id", async () => {
    db().setResponse("member_organizations", ok(null));
    await deleteOrganization("org-1");
    expect(links("member_organizations")).toEqual(["delete", "eq"]);
    expect(chain("member_organizations").argsOf("eq")).toEqual(["id", "org-1"]);
  });

  it.each([
    ["createOrganization", () => createOrganization(INPUT)],
    ["updateOrganization", () => updateOrganization("org-1", { name: "x" })],
    ["deleteOrganization", () => deleteOrganization("org-1")],
  ])("%s: błąd podnosi wyjątek", async (_label, run) => {
    db().setResponse("member_organizations", fail("orgs write denied", "42501"));
    await expect(run()).rejects.toThrow("orgs write denied");
  });
});

describe("miejsca w organizacji", () => {
  it("lista miejsc jednej organizacji, najstarsze pierwsze", async () => {
    db().setResponse("organization_seats", ok([{ id: "seat-1" }]));
    await expect(fetchAdminOrgSeats("org-1")).resolves.toEqual([{ id: "seat-1" }]);
    expect(links("organization_seats")).toEqual(["select", "eq", "order"]);
    // Bez `eq` panel jednej organizacji pokazałby miejsca WSZYSTKICH organizacji.
    expect(chain("organization_seats").argsOf("eq")).toEqual(["org_id", "org-1"]);
    expect(chain("organization_seats").argsOf("order")).toEqual([
      "created_at",
      { ascending: true },
    ]);
  });

  it("lista miejsc: data: null daje []", async () => {
    db().setResponse("organization_seats", ok(null));
    await expect(fetchAdminOrgSeats("org-1")).resolves.toEqual([]);
  });

  it("dodanie miejsca idzie przez RPC (limit i rola są sprawdzane serwerowo)", async () => {
    h.rpcResults.set("org_add_seat", ok("seat-new"));
    await expect(addOrgSeat("org-1", "nowy@example.com", "member")).resolves.toBe("seat-new");
    expect(rpcArgs("org_add_seat")).toEqual({
      p_org: "org-1",
      p_email: "nowy@example.com",
      p_role: "member",
    });
    expect(db().chains).toEqual([]);
  });

  it("rola właściciela przechodzi bez zmiany", async () => {
    h.rpcResults.set("org_add_seat", ok("seat-new"));
    await addOrgSeat("org-1", "wlasciciel@example.com", "owner");
    expect(rpcArgs("org_add_seat")).toMatchObject({ p_role: "owner" });
  });

  it("usunięcie miejsca kasuje wiersz po id", async () => {
    db().setResponse("organization_seats", ok(null));
    await removeOrgSeat("seat-1");
    expect(links("organization_seats")).toEqual(["delete", "eq"]);
    expect(chain("organization_seats").argsOf("eq")).toEqual(["id", "seat-1"]);
  });

  it.each([
    ["fetchAdminOrgSeats", () => fetchAdminOrgSeats("org-1")],
    ["removeOrgSeat", () => removeOrgSeat("seat-1")],
  ])("%s: błąd podnosi wyjątek", async (_label, run) => {
    db().setResponse("organization_seats", fail("seats denied", "42501"));
    await expect(run()).rejects.toThrow("seats denied");
  });

  it("addOrgSeat: błąd RPC podnosi wyjątek", async () => {
    h.rpcResults.set("org_add_seat", fail("seat limit reached", "P0001"));
    await expect(addOrgSeat("org-1", "nowy@example.com", "member")).rejects.toThrow(
      "seat limit reached",
    );
  });
});
