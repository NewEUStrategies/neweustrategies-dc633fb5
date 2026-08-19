// Warstwa danych huba członkostwa - 0 z 21 funkcji pokrytych do 18.08.2026,
// mimo że to ŹRÓDŁO PRAWDY o tym, co członek faktycznie ma po zakupie.
//
// Członkostwo jest tu pakietem PRAW, nie odznaką: nadania warstwy poza planem
// (dożywotni VIP eksperta, dostęp z darowizny), darowizny, organizacja
// członkowska z limitem miejsc oraz historia uczestnictwa. Twarde bramki
// egzekwuje baza (RPC SECURITY DEFINER / RLS) - ten moduł decyduje, CO SIĘ
// POKAŻE, a błąd tutaj znaczy, że klient nie widzi uprawnienia, które kupił
// (albo widzi takie, którego nie ma).
//
// Dwie rzeczy pilnowane najmocniej:
//
//   1. REGUŁA „KTÓRE NADANIE DAJE DOSTĘP". Do 18.08.2026 istniała w TRZECH
//      miejscach w trzech kształtach; teraz jest jedna (`activeGrants`)
//      i ma tu pełny zestaw przypadków brzegowych, w tym granicę wygaśnięcia
//      co do milisekundy i datę nieparsowalną.
//   2. IZOLACJA KONT. Każdy odczyt filtruje po użytkowniku z SESJI, nigdy po
//      identyfikatorze podanym z zewnątrz, a brak sesji zwraca pustkę zamiast
//      pytać bazę.
import { describe, expect, it, vi, beforeEach } from "vitest";

import { ok, supabaseFromStub } from "@/test/supabaseChain";
import { membershipGrant } from "@/test/billing/fixtures";

const h = vi.hoisted(() => ({
  uid: { current: "user-me" as string | null },
  rpc: vi.fn(),
  chain: null as ReturnType<typeof import("@/test/supabaseChain").supabaseFromStub> | null,
}));

vi.mock("@/lib/auth/currentUser", () => ({
  currentUserIdFromSession: () => Promise.resolve(h.uid.current),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => h.chain!.from(table),
    rpc: (fn: string, args?: Record<string, unknown>) => h.rpc(fn, args),
  },
}));

import {
  activeGrants,
  fetchMyDonations,
  fetchMyEventParticipation,
  fetchMyGrants,
  fetchMyOrganization,
  fetchMyResourceDownloads,
  fetchOrgSeats,
  isLifetimeGrant,
  primaryGrant,
} from "@/lib/billing/membership";

/** Stabilne „teraz" - reguła dostaje je parametrem, więc test nie czeka. */
const NOW = Date.parse("2026-08-18T12:00:00.000Z");
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

beforeEach(() => {
  h.uid.current = "user-me";
  h.rpc.mockReset();
  h.chain = supabaseFromStub();
});

describe("isLifetimeGrant", () => {
  it("nadanie bez daty końca jest dożywotnie", () => {
    expect(isLifetimeGrant({ expires_at: null })).toBe(true);
    expect(isLifetimeGrant(membershipGrant({ expires_at: null }))).toBe(true);
  });

  it("nadanie z datą końca nie jest dożywotnie, choćby odległą", () => {
    expect(isLifetimeGrant({ expires_at: iso(1000 * 60 * 60 * 24 * 3650) })).toBe(false);
    expect(isLifetimeGrant({ expires_at: iso(1) })).toBe(false);
  });
});

describe("activeGrants - które nadanie FAKTYCZNIE daje dostęp", () => {
  it("nadanie dożywotnie jest aktywne", () => {
    const grants = [membershipGrant({ expires_at: null })];

    expect(activeGrants(grants, NOW)).toHaveLength(1);
    expect(activeGrants(grants, NOW)[0].id).toBe("grant-1");
  });

  it("nadanie terminowe w toku jest aktywne", () => {
    const grants = [membershipGrant({ expires_at: iso(1000 * 60 * 60 * 24) })];

    expect(activeGrants(grants, NOW)).toHaveLength(1);
    expect(activeGrants(grants, NOW)[0].expires_at).toBeTruthy();
  });

  it("NADANIE WYGASŁE nie daje dostępu", () => {
    const grants = [membershipGrant({ expires_at: iso(-1000) })];

    expect(activeGrants(grants, NOW)).toHaveLength(0);
    expect(primaryGrant(grants, NOW)).toBeNull();
  });

  it("granica wygaśnięcia jest ostra: równo „teraz” to już NIE dostęp", () => {
    const exactly = [membershipGrant({ expires_at: new Date(NOW).toISOString() })];
    const oneMsLater = [membershipGrant({ expires_at: iso(1) })];

    expect(activeGrants(exactly, NOW)).toHaveLength(0);
    expect(activeGrants(oneMsLater, NOW)).toHaveLength(1);
  });

  it("NADANIE ODWOŁANE nie daje dostępu, nawet gdy jest dożywotnie", () => {
    const grants = [membershipGrant({ expires_at: null, revoked_at: iso(-1000) })];

    expect(activeGrants(grants, NOW)).toHaveLength(0);
    expect(primaryGrant(grants, NOW)).toBeNull();
  });

  it("DATA NIEPARSOWALNA nie przedłuża dostępu przez NaN w porównaniu", () => {
    const grants = [membershipGrant({ expires_at: "nie-data" })];

    expect(activeGrants(grants, NOW)).toHaveLength(0);
    expect(primaryGrant(grants, NOW)).toBeNull();
  });

  it("z wielu nadań zostają tylko aktywne, w kolejności wejściowej", () => {
    const grants = [
      membershipGrant({ id: "wygasle", expires_at: iso(-1) }),
      membershipGrant({ id: "terminowe", expires_at: iso(1000) }),
      membershipGrant({ id: "odwolane", expires_at: null, revoked_at: iso(-5) }),
      membershipGrant({ id: "dozywotnie", expires_at: null }),
    ];

    expect(activeGrants(grants, NOW).map((g) => g.id)).toEqual(["terminowe", "dozywotnie"]);
    expect(activeGrants(grants, NOW)).toHaveLength(2);
  });

  it("pusta lista nie wywala reguły", () => {
    expect(activeGrants([], NOW)).toEqual([]);
    expect(primaryGrant([], NOW)).toBeNull();
  });
});

describe("primaryGrant - jedno nadanie do pokazania", () => {
  it("DOŻYWOTNIE ma pierwszeństwo nad terminowym, choćby było dalej na liście", () => {
    const grants = [
      membershipGrant({ id: "terminowe", expires_at: iso(1000) }),
      membershipGrant({ id: "dozywotnie", expires_at: null }),
    ];

    expect(primaryGrant(grants, NOW)?.id).toBe("dozywotnie");
    expect(primaryGrant(grants, NOW)?.expires_at).toBeNull();
  });

  it("bez dożywotniego bierze pierwsze aktywne terminowe", () => {
    const grants = [
      membershipGrant({ id: "wygasle", expires_at: iso(-1) }),
      membershipGrant({ id: "pierwsze-aktywne", expires_at: iso(1000) }),
      membershipGrant({ id: "drugie-aktywne", expires_at: iso(2000) }),
    ];

    expect(primaryGrant(grants, NOW)?.id).toBe("pierwsze-aktywne");
    expect(primaryGrant(grants, NOW)).not.toBeNull();
  });

  it("PODWÓJNE NADANIE (upgrade w trakcie) nie gubi mocniejszego uprawnienia", () => {
    // Klient dostał nadanie terminowe, potem dożywotnie - pokazujemy mocniejsze.
    const grants = [
      membershipGrant({ id: "stare-terminowe", tier_key: "member", expires_at: iso(1000) }),
      membershipGrant({ id: "nowe-dozywotnie", tier_key: "pro", expires_at: null }),
    ];

    expect(primaryGrant(grants, NOW)?.tier_key).toBe("pro");
    expect(primaryGrant(grants, NOW)?.id).toBe("nowe-dozywotnie");
  });
});

describe("fetchMyGrants - izolacja konta", () => {
  it("BEZ SESJI zwraca pustkę i NIE pyta bazy", async () => {
    h.uid.current = null;

    expect(await fetchMyGrants()).toEqual([]);
    expect(h.chain!.chains).toHaveLength(0);
  });

  it("filtruje po użytkowniku z sesji i odsiewa odwołane po stronie bazy", async () => {
    h.chain!.setResponse("membership_grants", ok([membershipGrant()]));

    const rows = await fetchMyGrants();

    expect(rows).toHaveLength(1);
    const chain = h.chain!.lastChain("membership_grants")!;
    expect(chain.argsOf("eq")).toEqual(["user_id", "user-me"]);
    expect(chain.argsOf("is")).toEqual(["revoked_at", null]);
  });

  it("najnowsze nadania idą pierwsze", async () => {
    h.chain!.setResponse("membership_grants", ok([]));

    await fetchMyGrants();

    expect(h.chain!.lastChain("membership_grants")!.argsOf("order")).toEqual([
      "created_at",
      { ascending: false },
    ]);
  });

  it("błąd odczytu jest ZGŁASZANY, nie zamieniany na pustą listę", async () => {
    h.chain!.setResponse("membership_grants", {
      data: null,
      error: Object.assign(new Error("permission denied"), { name: "PostgrestError" }),
    });

    await expect(fetchMyGrants()).rejects.toThrow("permission denied");
  });

  it("brak wierszy daje pustą tablicę, nie `null`", async () => {
    h.chain!.setResponse("membership_grants", ok(null));

    expect(await fetchMyGrants()).toEqual([]);
  });
});

describe("fetchMyDonations", () => {
  it("bez sesji zwraca pustkę bez zapytania", async () => {
    h.uid.current = null;

    expect(await fetchMyDonations()).toEqual([]);
    expect(h.chain!.chains).toHaveLength(0);
  });

  it("czyta własne darowizny z limitem i sortowaniem malejącym", async () => {
    h.chain!.setResponse(
      "donations",
      ok([{ id: "d1", amount_cents: 10000, currency: "PLN", status: "paid", created_at: "x" }]),
    );

    const rows = await fetchMyDonations();

    expect(rows).toHaveLength(1);
    const chain = h.chain!.lastChain("donations")!;
    expect(chain.argsOf("eq")).toEqual(["user_id", "user-me"]);
    expect(chain.argsOf("limit")).toEqual([50]);
  });

  it("błąd odczytu jest zgłaszany", async () => {
    h.chain!.setResponse("donations", {
      data: null,
      error: Object.assign(new Error("boom"), { name: "PostgrestError" }),
    });

    await expect(fetchMyDonations()).rejects.toThrow("boom");
  });
});

describe("fetchMyOrganization - członkostwo zespołowe", () => {
  it("bez sesji zwraca null bez wołania RPC", async () => {
    h.uid.current = null;

    expect(await fetchMyOrganization()).toBeNull();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("czyta organizację przez RPC, nie zapytaniem na tabeli", async () => {
    h.rpc.mockResolvedValue({
      data: [{ org_id: "org-1", name: "NES", seats_limit: 10, seats_used: 3 }],
      error: null,
    });

    const org = await fetchMyOrganization();

    expect(org).toMatchObject({ org_id: "org-1", seats_limit: 10 });
    expect(h.rpc).toHaveBeenCalledWith("my_organization", undefined);
  });

  it("RPC zwracające POJEDYNCZY OBIEKT (nie tablicę) też jest obsłużone", async () => {
    h.rpc.mockResolvedValue({ data: { org_id: "org-2", name: "Solo" }, error: null });

    const org = await fetchMyOrganization();

    expect(org).toMatchObject({ org_id: "org-2" });
    expect(Array.isArray(org)).toBe(false);
  });

  it("BRAK ORGANIZACJI (członkostwo indywidualne) to null, nie wyjątek", async () => {
    h.rpc.mockResolvedValue({ data: [], error: null });

    expect(await fetchMyOrganization()).toBeNull();
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });

  it("brak rekordu zwrócony jako null też daje null", async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });

    expect(await fetchMyOrganization()).toBeNull();
  });

  it("błąd RPC jest zgłaszany", async () => {
    h.rpc.mockResolvedValue({ data: null, error: new Error("rpc padł") });

    await expect(fetchMyOrganization()).rejects.toThrow("rpc padł");
  });
});

describe("fetchOrgSeats - miejsca w organizacji", () => {
  it("czyta miejsca wskazanej organizacji, rosnąco po dacie", async () => {
    h.chain!.setResponse(
      "organization_seats",
      ok([{ id: "s1", invited_email: "kto@example.test", role: "member" }]),
    );

    const seats = await fetchOrgSeats("org-1");

    expect(seats).toHaveLength(1);
    const chain = h.chain!.lastChain("organization_seats")!;
    expect(chain.argsOf("eq")).toEqual(["org_id", "org-1"]);
    expect(chain.argsOf("order")).toEqual(["created_at", { ascending: true }]);
  });

  it("brak miejsc daje pustą tablicę", async () => {
    h.chain!.setResponse("organization_seats", ok(null));

    expect(await fetchOrgSeats("org-1")).toEqual([]);
  });

  it("błąd odczytu jest zgłaszany (RLS: tylko właściciel widzi miejsca)", async () => {
    h.chain!.setResponse("organization_seats", {
      data: null,
      error: Object.assign(new Error("permission denied"), { name: "PostgrestError" }),
    });

    await expect(fetchOrgSeats("org-obcy")).rejects.toThrow("permission denied");
  });
});

describe("historia uczestnictwa", () => {
  it("udział w wydarzeniach: bez sesji pustka, z sesją RPC", async () => {
    h.uid.current = null;
    expect(await fetchMyEventParticipation()).toEqual([]);
    expect(h.rpc).not.toHaveBeenCalled();

    h.uid.current = "user-me";
    h.rpc.mockResolvedValue({ data: [{ event_id: "e1", slug: "lab" }], error: null });
    expect(await fetchMyEventParticipation()).toHaveLength(1);
  });

  it("udział w wydarzeniach: brak danych daje pustą tablicę", async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });

    expect(await fetchMyEventParticipation()).toEqual([]);
    expect(h.rpc).toHaveBeenCalledWith("my_event_participation", undefined);
  });

  it("udział w wydarzeniach: błąd RPC jest zgłaszany", async () => {
    h.rpc.mockResolvedValue({ data: null, error: new Error("rpc padł") });

    await expect(fetchMyEventParticipation()).rejects.toThrow("rpc padł");
  });

  it("pobrania z biblioteki: bez sesji pustka, z sesją RPC", async () => {
    h.uid.current = null;
    expect(await fetchMyResourceDownloads()).toEqual([]);

    h.uid.current = "user-me";
    h.rpc.mockResolvedValue({ data: [{ resource_id: "r1" }], error: null });
    expect(await fetchMyResourceDownloads()).toHaveLength(1);
  });

  it("pobrania z biblioteki: brak danych daje pustą tablicę", async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });

    expect(await fetchMyResourceDownloads()).toEqual([]);
    expect(h.rpc).toHaveBeenCalledWith("my_resource_downloads", undefined);
  });

  it("pobrania z biblioteki: błąd RPC jest zgłaszany", async () => {
    h.rpc.mockResolvedValue({ data: null, error: new Error("rpc padł") });

    await expect(fetchMyResourceDownloads()).rejects.toThrow("rpc padł");
  });
});
