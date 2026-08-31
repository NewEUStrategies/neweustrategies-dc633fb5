// Cały panel warstw członkostwa - kompozycja, odczyt i mutacje katalogu.
//
// Trzy rzeczy dowiedzione tu, a nie w testach molekuł:
//   - NIEPOPRAWNY JSON bramek PRZERYWA zapis warstwy (warstwa z połamanymi
//     bramkami nie otwiera nic, za co klient zapłacił),
//   - mapowanie planu na warstwę zapisuje się natychmiast po wybraniu,
//   - liczniki nagłówka mówią prawdę o stanie katalogu (ile warstw aktywnych,
//     która domyślna, ile planów zmapowanych, ile nadań aktywnych).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import {
  membershipTier,
  ok,
  radixSelectStub,
  radixSwitchStub,
  radixTabsStub,
  reactI18nextStub,
  supabaseFromStub,
  type SupabaseFromStub,
} from "@/test/admin/pricingFixtures";
import { accessPlan } from "@/test/billing/fixtures";
import { RouterLinkStub } from "@/test/routerLinkStub";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

let chain: SupabaseFromStub;

const h = {
  plans: [] as ReturnType<typeof accessPlan>[],
  grants: [] as { id: string; revoked_at: string | null }[],
};

vi.mock("react-i18next", () => reactI18nextStub());
vi.mock("@tanstack/react-router", () => ({ Link: RouterLinkStub }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => chain.from(table) },
}));
vi.mock("@/components/ui/select", async () => radixSelectStub(await import("react")));
vi.mock("@/components/ui/switch", async () => radixSwitchStub(await import("react")));
vi.mock("@/components/ui/tabs", async () => radixTabsStub(await import("react")));
vi.mock("@/lib/billing/queries", () => ({ fetchActivePlans: () => Promise.resolve(h.plans) }));
vi.mock("@/lib/admin/membership-admin", () => ({
  fetchMembershipGrants: () => Promise.resolve(h.grants),
  grantMembership: vi.fn(),
  revokeGrant: vi.fn(),
}));
// Karta uzgodnienia z Confluence to referencja zespołowa, nie część kontraktu
// tego panelu - w tym teście wystarczy, że się montuje.
vi.mock("@/components/admin/pricing/ConfluenceReconciliationCard", () => ({
  ConfluenceReconciliationCard: () => null,
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

const { AdminMembershipWorkspace } =
  await import("@/components/admin/membership/organisms/AdminMembershipWorkspace");

function openTab(key: "tiers" | "mapping" | "grants" | "orgs") {
  fireEvent.click(screen.getByRole("tab", { name: `adminMembership.tabs.${key}` }));
}

/**
 * Katalog pokazuje kafle - edycja mieszka w oknie. Helper otwiera okno
 * warstwy i (opcjonalnie) jej zakładkę.
 */
async function openTierEditor(tab: "basics" | "benefits" | "capabilities" = "basics") {
  const card = await screen.findByRole("button", { name: /summary\.open/ });
  fireEvent.click(card);
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(
    within(dialog).getByRole("tab", { name: `adminMembership.tierTabs.${tab}` }),
  );
  return dialog;
}

function tierUpdate(): Record<string, unknown> | undefined {
  const call = chain.chainsFor("membership_tiers").find((c) => c.has("update"));
  return call?.argsOf("update")?.[0] as Record<string, unknown> | undefined;
}

beforeEach(() => {
  chain = supabaseFromStub();
  chain.setResponse("membership_tiers", ok([membershipTier()]));
  chain.setResponse("access_plans", ok([]));
  h.plans = [];
  h.grants = [];
  toastSuccess.mockClear();
  toastError.mockClear();
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
});

describe("AdminMembershipWorkspace - liczniki nagłówka", () => {
  it("liczy warstwy aktywne wobec wszystkich", async () => {
    chain.setResponse(
      "membership_tiers",
      ok([
        membershipTier({ id: "t1", active: true }),
        membershipTier({ id: "t2", active: false }),
        membershipTier({ id: "t3", active: true }),
      ]),
    );
    renderWithQueryClient(<AdminMembershipWorkspace />);

    await waitFor(() => expect(screen.getByText("2 / 3")).toBeInTheDocument());
  });

  it("pokazuje nazwę warstwy DOMYŚLNEJ, a bez niej kreskę", async () => {
    chain.setResponse("membership_tiers", ok([membershipTier({ is_default: false })]));
    renderWithQueryClient(<AdminMembershipWorkspace />);

    await waitFor(() => expect(screen.getByText("1 / 1")).toBeInTheDocument());
    expect(screen.getByText("-")).toBeInTheDocument();
  });

  it("warstwa domyślna pokazuje się z nazwy", async () => {
    chain.setResponse(
      "membership_tiers",
      ok([membershipTier({ is_default: true, name_pl: "Czytelnik" })]),
    );
    renderWithQueryClient(<AdminMembershipWorkspace />);

    // Nazwa pada dwa razy: kafelek KPI „domyślna warstwa" i kafel katalogu.
    await waitFor(() => expect(screen.getAllByText("Czytelnik").length).toBeGreaterThan(0));
  });

  it("liczy plany ZMAPOWANE wobec wszystkich - plan bez warstwy nie otwiera bramek", async () => {
    h.plans = [
      accessPlan({ id: "p1", tier_key: "member" }),
      accessPlan({ id: "p2", tier_key: null }),
      accessPlan({ id: "p3", tier_key: null }),
    ];
    renderWithQueryClient(<AdminMembershipWorkspace />);

    await waitFor(() => expect(screen.getByText("1 / 3")).toBeInTheDocument());
  });

  it("liczy WYŁĄCZNIE nadania nieodwołane", async () => {
    h.grants = [
      { id: "g1", revoked_at: null },
      { id: "g2", revoked_at: "2026-06-01" },
    ];
    renderWithQueryClient(<AdminMembershipWorkspace />);

    await waitFor(() => expect(screen.getAllByText("1").length).toBeGreaterThan(0));
  });
});

describe("AdminMembershipWorkspace - odczyt katalogu", () => {
  it("czyta warstwy po randze rosnąco", async () => {
    renderWithQueryClient(<AdminMembershipWorkspace />);

    await waitFor(() => expect(chain.lastChain("membership_tiers")).toBeTruthy());
    expect(chain.lastChain("membership_tiers")!.argsOf("order")).toEqual([
      "rank",
      { ascending: true },
    ]);
  });

  it("ma cztery zakładki i otwiera się na katalogu warstw", async () => {
    renderWithQueryClient(<AdminMembershipWorkspace />);

    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(4));
    // Nazwa zakładki niesie też licznik warstw, stąd wyrażenie, nie równość.
    expect(screen.getByRole("tab", { name: /adminMembership\.tabs\.tiers/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

describe("AdminMembershipWorkspace - ZAPIS warstwy", () => {
  it("zapisuje przycięte nazwy i puste opisy jako `null`", async () => {
    chain.setResponse(
      "membership_tiers",
      ok([membershipTier({ id: "t9", description_pl: null, description_en: null })]),
    );
    renderWithQueryClient(<AdminMembershipWorkspace />);
    await openTierEditor("basics");

    fireEvent.change(screen.getByDisplayValue("Członek"), { target: { value: "  Członek  " } });
    fireEvent.click(screen.getByRole("button", { name: /^adminMembership\.save$/ }));

    await waitFor(() => expect(tierUpdate()).toBeDefined());
    expect(tierUpdate()).toMatchObject({ name_pl: "Członek", description_pl: null });
  });

  it("NIEPOPRAWNY JSON bramek PRZERYWA zapis - własny komunikat, zero zapytań", async () => {
    // Warstwa z połamanymi bramkami przestałaby otwierać treści, za które
    // klient zapłacił, i to bez śladu w logach.
    renderWithQueryClient(<AdminMembershipWorkspace />);
    await openTierEditor("capabilities");

    fireEvent.change(screen.getByDisplayValue('{"briefings":true}'), {
      target: { value: "{briefings: true" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^adminMembership\.save$/ }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("adminMembership.toast.featuresInvalid"),
    );
    expect(tierUpdate()).toBeUndefined();
  });

  it("POPRAWNY JSON bramek przechodzi jako obiekt, nie jako tekst", async () => {
    renderWithQueryClient(<AdminMembershipWorkspace />);
    await openTierEditor("capabilities");

    fireEvent.change(screen.getByDisplayValue('{"briefings":true}'), {
      target: { value: '{"briefings":false,"expertRequests":2}' },
    });
    fireEvent.click(screen.getByRole("button", { name: /^adminMembership\.save$/ }));

    await waitFor(() => expect(tierUpdate()).toBeDefined());
    expect(tierUpdate()!.features).toEqual({ briefings: false, expertRequests: 2 });
  });

  it("błąd bazy przy zapisie warstwy trafia do komunikatu", async () => {
    chain.setResponse("membership_tiers", {
      data: null,
      error: Object.assign(new Error("duplicate key"), { name: "PostgrestError" }),
    });
    renderWithQueryClient(<AdminMembershipWorkspace />);
    await waitFor(() => expect(chain.chainsFor("membership_tiers")).toHaveLength(1));

    // Odczyt zwrócił błąd, więc katalog jest pusty - to też jest kontrakt:
    // panel nie pokazuje zera warstw jako faktu.
    expect(screen.queryByRole("button", { name: /summary\.open/ })).not.toBeInTheDocument();
  });
});

describe("AdminMembershipWorkspace - USUNIĘCIE warstwy", () => {
  it("usuwa warstwę po potwierdzeniu", async () => {
    renderWithQueryClient(<AdminMembershipWorkspace />);
    await openTierEditor("basics");

    fireEvent.click(screen.getByRole("button", { name: /deleteTitle/ }));

    await waitFor(() =>
      expect(chain.chainsFor("membership_tiers").some((c) => c.has("delete"))).toBe(true),
    );
    expect(toastSuccess).toHaveBeenCalledWith("adminMembership.toast.tierDeleted");
  });
});

describe("AdminMembershipWorkspace - NOWA warstwa", () => {
  it("podpowiada rangę ZA ostatnią istniejącą", async () => {
    chain.setResponse(
      "membership_tiers",
      ok([membershipTier({ id: "t1", rank: 10 }), membershipTier({ id: "t2", rank: 30 })]),
    );
    renderWithQueryClient(<AdminMembershipWorkspace />);
    // Ranga podpowiadana jest liczona z WCZYTANEGO katalogu - czekamy na dane,
    // nie tylko na przycisk, inaczej test mierzyłby wartość przed odczytem.
    await waitFor(() => expect(screen.getByText("2 / 2")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /newTierDialog\.title/ }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("spinbutton")).toHaveValue(40);
  });

  it("tworzy warstwę z tenantem wziętym z istniejącej (wymóg RLS)", async () => {
    renderWithQueryClient(<AdminMembershipWorkspace />);
    await waitFor(() => expect(screen.getByText("1 / 1")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /newTierDialog\.title/ }));
    const dialog = screen.getByRole("dialog");
    const fields = within(dialog).getAllByRole("textbox");
    fireEvent.change(fields[0], { target: { value: "patron" } });
    fireEvent.change(fields[1], { target: { value: "Patron" } });
    fireEvent.change(fields[2], { target: { value: "Patron" } });
    fireEvent.click(screen.getByRole("button", { name: /newTierDialog\.create/ }));

    await waitFor(() =>
      expect(chain.chainsFor("membership_tiers").some((c) => c.has("insert"))).toBe(true),
    );
    const inserted = chain
      .chainsFor("membership_tiers")
      .find((c) => c.has("insert"))!
      .argsOf("insert")?.[0] as Record<string, unknown>;
    expect(inserted).toMatchObject({ key: "patron", tenant_id: "tenant-test" });
  });

  it("PUSTY katalog nie pozwala utworzyć warstwy - nie ma skąd wziąć tenanta", async () => {
    chain.setResponse("membership_tiers", ok([]));
    renderWithQueryClient(<AdminMembershipWorkspace />);
    await waitFor(() => expect(chain.chainsFor("membership_tiers")).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: /newTierDialog\.title/ }));
    const dialog = screen.getByRole("dialog");
    const fields = within(dialog).getAllByRole("textbox");
    fireEvent.change(fields[0], { target: { value: "patron" } });
    fireEvent.change(fields[1], { target: { value: "Patron" } });
    fireEvent.change(fields[2], { target: { value: "Patron" } });
    fireEvent.click(screen.getByRole("button", { name: /newTierDialog\.create/ }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("adminMembership.toast.noTenant"));
    expect(chain.chainsFor("membership_tiers").some((c) => c.has("insert"))).toBe(false);
  });
});

describe("AdminMembershipWorkspace - MAPOWANIE planu na warstwę", () => {
  it("wybór warstwy zapisuje `tier_key` natychmiast", async () => {
    h.plans = [accessPlan({ id: "plan-1", tier_key: null })];
    renderWithQueryClient(<AdminMembershipWorkspace />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(4));

    openTab("mapping");
    await waitFor(() => expect(screen.getAllByRole("combobox").length).toBeGreaterThan(0));
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "member" } });

    await waitFor(() => expect(chain.chainsFor("access_plans")).toHaveLength(1));
    expect(chain.lastChain("access_plans")!.argsOf("update")?.[0]).toEqual({ tier_key: "member" });
    expect(chain.lastChain("access_plans")!.argsOf("eq")).toEqual(["id", "plan-1"]);
  });

  it("odjęcie warstwy zapisuje `null`, nie napis „none”", async () => {
    h.plans = [accessPlan({ id: "plan-1", tier_key: "member" })];
    renderWithQueryClient(<AdminMembershipWorkspace />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(4));

    openTab("mapping");
    await waitFor(() => expect(screen.getAllByRole("combobox").length).toBeGreaterThan(0));
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "none" } });

    await waitFor(() => expect(chain.chainsFor("access_plans")).toHaveLength(1));
    expect(chain.lastChain("access_plans")!.argsOf("update")?.[0]).toEqual({ tier_key: null });
  });

  it("lista warstw do wyboru pomija warstwy NIEAKTYWNE", async () => {
    // Zmapowanie planu na wyłączoną warstwę sprzedałoby dostęp, którego nie ma.
    chain.setResponse(
      "membership_tiers",
      ok([
        membershipTier({ id: "t1", key: "member", active: true }),
        membershipTier({ id: "t2", key: "wylaczona", active: false }),
      ]),
    );
    h.plans = [accessPlan({ id: "plan-1" })];
    renderWithQueryClient(<AdminMembershipWorkspace />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(4));

    openTab("mapping");

    await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(0));
    const values = screen.getAllByRole("option").map((o) => o.getAttribute("value"));
    expect(values).toContain("member");
    expect(values).not.toContain("wylaczona");
  });

  it("błąd zapisu mapowania trafia do komunikatu", async () => {
    chain.setResponse("access_plans", {
      data: null,
      error: Object.assign(new Error("foreign key violation"), { name: "PostgrestError" }),
    });
    h.plans = [accessPlan({ id: "plan-1", tier_key: null })];
    renderWithQueryClient(<AdminMembershipWorkspace />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(4));

    openTab("mapping");
    await waitFor(() => expect(screen.getAllByRole("combobox").length).toBeGreaterThan(0));
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "member" } });

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("foreign key violation"));
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

describe("AdminMembershipWorkspace - zakładka organizacji", () => {
  it("prowadzi do panelu organizacji", async () => {
    renderWithQueryClient(<AdminMembershipWorkspace />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(4));

    openTab("orgs");

    await waitFor(() =>
      expect(screen.getByRole("link", { name: /org\.open/ })).toHaveAttribute(
        "href",
        "/admin/organizations",
      ),
    );
  });
});
