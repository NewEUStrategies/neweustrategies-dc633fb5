// Cały panel warstw członkostwa - kompozycja, odczyt i mutacje katalogu.
//
// Rzeczy dowiedzione tu, a nie w testach molekuł:
//   - NIEPOPRAWNY JSON bramek PRZERYWA zapis warstwy (warstwa z połamanymi
//     bramkami nie otwiera nic, za co klient zapłacił),
//   - zapis warstwy niesie WYŁĄCZNIE rdzeń (S1 def. 11) z surowym tokenem
//     `updated_at`, a cudzy zapis po naszym odczycie to konflikt z akcją
//     „Wczytaj aktualne" (szkic zostaje),
//   - mapowanie planu na warstwę zapisuje się natychmiast po wybraniu, patchem
//     `tier_key` z tokenem planu - druga karta z tym samym tokenem dostaje
//     konflikt zamiast cichego „lost update" (kryterium SPEC §8.3 S1),
//   - liczniki nagłówka mówią prawdę o stanie katalogu (ile warstw aktywnych,
//     która domyślna, ile planów zmapowanych, ile nadań aktywnych),
//   - adres prowadzi panel: zakładka i otwarta warstwa (`?tab=`, `?tier=`).
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

/** Token z mikrosekundami - przechodzi do zapytania jako surowy napis. */
const TOKEN = "2026-10-19T10:00:00.123456+00:00";

type PlanRow = ReturnType<typeof accessPlan> & { updated_at: string };

const h = {
  plans: [] as PlanRow[],
  grants: [] as { id: string; revoked_at: string | null }[],
};

function planRow(overrides: Partial<PlanRow> = {}): PlanRow {
  return { ...accessPlan(), updated_at: TOKEN, ...overrides };
}

vi.mock("react-i18next", () => reactI18nextStub());
vi.mock("@tanstack/react-router", () => ({ Link: RouterLinkStub }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => chain.from(table) },
}));
vi.mock("@/components/ui/select", async () => radixSelectStub(await import("react")));
vi.mock("@/components/ui/switch", async () => radixSwitchStub(await import("react")));
vi.mock("@/components/ui/tabs", async () => radixTabsStub(await import("react")));
vi.mock("@/lib/admin/membership-admin", () => ({
  fetchMembershipGrants: () => Promise.resolve(h.grants),
  findTenantMemberByEmail: vi.fn(),
  setMembershipGrant: vi.fn(),
  revokeMembershipGrant: vi.fn(),
}));
// Najemca z SESJI (S1 def. 13) - nie z pierwszego wiersza katalogu.
vi.mock("@/lib/tenant", () => ({ useCurrentTenantId: () => "tenant-test" }));
// Błędy zapisu idą wspólnym kanałem (bez surowego komunikatu bazy w UI).
const toastErrorKind = vi.fn();
vi.mock("@/lib/toastError", () => ({ toastError: toastErrorKind }));
// Karta uzgodnienia z Confluence to referencja zespołowa, nie część kontraktu
// tego panelu - w tym teście wystarczy, że się montuje.
vi.mock("@/components/admin/pricing/ConfluenceReconciliationCard", () => ({
  ConfluenceReconciliationCard: () => null,
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastInfo = vi.fn();
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError, info: toastInfo } }));

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
  fireEvent.click(within(dialog).getByRole("tab", { name: `adminMembership.tierTabs.${tab}` }));
  return dialog;
}

function tierUpdate(): Record<string, unknown> | undefined {
  const call = chain.chainsFor("membership_tiers").find((c) => c.has("update"));
  return call?.argsOf("update")?.[0] as Record<string, unknown> | undefined;
}

/** Filtr `.eq(kolumna, …)` łańcucha - identyfikator i token współbieżności. */
function eqOf(c: { calls: { method: string; args: readonly unknown[] }[] }, column: string) {
  return c.calls.find((call) => call.method === "eq" && call.args[0] === column)?.args[1];
}

/**
 * Tabela z wersją wiersza jak Postgres: UPDATE trafia wyłącznie przy tokenie
 * równym `updated_at` wiersza (i podbija wersję), inaczej 0 wierszy.
 */
function versionedTable<T extends { id: string; updated_at: string }>(
  table: string,
  read: () => T[],
  write: (rows: T[]) => void,
) {
  chain.setResponse(table, (c) => {
    if (!c.has("update")) return ok(read());
    const row = read().find((r) => r.id === eqOf(c, "id"));
    if (!row || row.updated_at !== eqOf(c, "updated_at")) return ok([]);
    const next = {
      ...row,
      ...(c.argsOf("update")?.[0] as object),
      updated_at: `${row.updated_at}+1`,
    };
    write(read().map((r) => (r.id === row.id ? next : r)));
    return ok([next]);
  });
}

function planUpdates() {
  return chain.chainsFor("access_plans").filter((c) => c.has("update"));
}

beforeEach(() => {
  chain = supabaseFromStub();
  chain.setResponse("membership_tiers", ok([membershipTier()]));
  h.plans = [];
  h.grants = [];
  versionedTable(
    "access_plans",
    () => h.plans,
    (rows) => (h.plans = rows),
  );
  toastSuccess.mockClear();
  toastError.mockClear();
  toastInfo.mockClear();
  toastErrorKind.mockClear();
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
      planRow({ id: "p1", tier_key: "member" }),
      planRow({ id: "p2", tier_key: null }),
      // Plan wycofany nadal liczy się do mapowania - jego subskrybenci
      // dostają warstwę (S1: lista obejmuje wszystkie plany).
      planRow({ id: "p3", tier_key: null, active: false }),
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

describe("AdminMembershipWorkspace - ZAPIS warstwy (rdzeń, S1 def. 11)", () => {
  function rankField(dialog: HTMLElement): HTMLElement {
    const status = within(dialog).getByRole("group", { name: /groups\.status/ });
    return within(status).getByRole("spinbutton");
  }

  it("ZMIANA ZAMIERZONA: zapis niesie TYLKO zmienione kolumny rdzenia z surowym tokenem", async () => {
    // Charakteryzacja przypinała zapis CAŁEJ warstwy (nazwy, opisy, benefity,
    // ranga, bramki) przy każdym kliknięciu - to cofało benefity z Cennika.
    let rows = [membershipTier({ id: "t9", rank: 10, updated_at: TOKEN })];
    versionedTable(
      "membership_tiers",
      () => rows,
      (next) => (rows = next),
    );
    renderWithQueryClient(<AdminMembershipWorkspace />);
    const dialog = await openTierEditor("basics");

    fireEvent.change(rankField(dialog), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: /^adminMembership\.save$/ }));

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("adminMembership.toast.tierSaved"),
    );
    expect(tierUpdate()).toEqual({ rank: 25 });
    const write = chain.chainsFor("membership_tiers").find((c) => c.has("update"))!;
    expect(eqOf(write, "id")).toBe("t9");
    // Mikrosekundy zostają - `new Date()` zgubiłby je i każdy zapis byłby konfliktem.
    expect(eqOf(write, "updated_at")).toBe(TOKEN);
  });

  it("nietknięta warstwa nie ma czego zapisać - przycisk jest wyłączony", async () => {
    renderWithQueryClient(<AdminMembershipWorkspace />);
    await openTierEditor("basics");

    expect(screen.getByRole("button", { name: /^adminMembership\.save$/ })).toBeDisabled();
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
    expect(tierUpdate()).toEqual({ features: { briefings: false, expertRequests: 2 } });
  });

  it("cudzy zapis po naszym odczycie = konflikt; „Wczytaj aktualne” nakłada szkic na świeży wiersz", async () => {
    let rows = [membershipTier({ id: "t1", rank: 10, active: true, updated_at: TOKEN })];
    versionedTable(
      "membership_tiers",
      () => rows,
      (next) => (rows = next),
    );
    renderWithQueryClient(<AdminMembershipWorkspace />);
    const dialog = await openTierEditor("basics");
    fireEvent.change(rankField(dialog), { target: { value: "25" } });
    // Druga karta wyłącza warstwę - inne pole, nowy token.
    rows = rows.map((r) => ({ ...r, active: false, updated_at: `${TOKEN}#other` }));

    fireEvent.click(screen.getByRole("button", { name: /^adminMembership\.save$/ }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "adminPaywall.sync.staleWrite",
        expect.objectContaining({
          action: expect.objectContaining({ onClick: expect.any(Function) }),
        }),
      ),
    );
    expect(rankField(screen.getByRole("dialog"))).toHaveValue(25);

    const [, options] = toastError.mock.calls[0] as [string, { action: { onClick: () => void } }];
    options.action.onClick();
    await waitFor(() => expect(toastInfo).toHaveBeenCalledWith("adminPaywall.sync.reloaded"));
    fireEvent.click(screen.getByRole("button", { name: /^adminMembership\.save$/ }));

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("adminMembership.toast.tierSaved"),
    );
    const writes = chain.chainsFor("membership_tiers").filter((c) => c.has("update"));
    // Ponowny zapis: nowy token i WYŁĄCZNIE nasza kolumna - cudze `active` zostaje.
    expect(eqOf(writes.at(-1)!, "updated_at")).toBe(`${TOKEN}#other`);
    expect(writes.at(-1)!.argsOf("update")?.[0]).toEqual({ rank: 25 });
    expect(rows[0]).toMatchObject({ rank: 25, active: false });
  });

  it("błąd ODCZYTU katalogu nie udaje zera warstw", async () => {
    chain.setResponse("membership_tiers", {
      data: null,
      error: Object.assign(new Error("duplicate key"), { name: "PostgrestError" }),
    });
    renderWithQueryClient(<AdminMembershipWorkspace />);
    await waitFor(() => expect(chain.chainsFor("membership_tiers")).toHaveLength(1));

    expect(screen.queryByRole("button", { name: /summary\.open/ })).not.toBeInTheDocument();
  });
});

describe("AdminMembershipWorkspace - adres prowadzi panel (SPEC §2.6)", () => {
  it("`?tier=<key>` otwiera edytor tej warstwy od pierwszego renderu", async () => {
    chain.setResponse(
      "membership_tiers",
      ok([membershipTier({ key: "patron", name_pl: "Patron PL", name_en: "Patron EN" })]),
    );
    renderWithQueryClient(<AdminMembershipWorkspace tierKey="patron" onTierKeyChange={vi.fn()} />);

    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(within(dialog).getByText(/editDialog\.title.*Patron PL/)).toBeInTheDocument(),
    );
  });

  it("klucz spoza katalogu daje jawny komunikat w oknie, a nie ciche nieotwarcie", async () => {
    renderWithQueryClient(
      <AdminMembershipWorkspace tierKey="usunieta" onTierKeyChange={vi.fn()} />,
    );

    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(within(dialog).getByRole("alert")).toHaveTextContent(
        "adminMembership.editDialog.notFound",
      ),
    );
  });

  it("otwarcie i zamknięcie warstwy zgłasza klucz do trasy", async () => {
    const onTierKeyChange = vi.fn();
    renderWithQueryClient(
      <AdminMembershipWorkspace tierKey={null} onTierKeyChange={onTierKeyChange} />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /summary\.open/ }));
    expect(onTierKeyChange).toHaveBeenLastCalledWith("member");

    fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(onTierKeyChange).toHaveBeenLastCalledWith(null));
  });

  it("zakładka podana przez trasę jest otwarta, a wybór wraca do trasy", async () => {
    const onTabChange = vi.fn();
    renderWithQueryClient(<AdminMembershipWorkspace tab="grants" onTabChange={onTabChange} />);

    expect(screen.getByRole("tab", { name: /adminMembership\.tabs\.grants/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    openTab("mapping");
    expect(onTabChange).toHaveBeenCalledWith("mapping");
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

  it("tworzy warstwę z najemcą z SESJI (wymóg RLS, S1 def. 13)", async () => {
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

  it("ZMIANA ZAMIERZONA: PUSTY katalog pozwala utworzyć PIERWSZĄ warstwę (najemca z sesji)", async () => {
    // Charakteryzacja przypinała blokadę: najemcę brano z pierwszej warstwy,
    // więc organizacja bez warstw nie mogła utworzyć żadnej.
    chain.setResponse("membership_tiers", (c) =>
      c.has("insert") ? ok({ ...membershipTier(), key: "patron" }) : ok([]),
    );
    renderWithQueryClient(<AdminMembershipWorkspace />);
    await waitFor(() => expect(chain.chainsFor("membership_tiers")).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: /newTierDialog\.title/ }));
    const dialog = screen.getByRole("dialog");
    const fields = within(dialog).getAllByRole("textbox");
    fireEvent.change(fields[0], { target: { value: "patron" } });
    fireEvent.change(fields[1], { target: { value: "Patron" } });
    fireEvent.change(fields[2], { target: { value: "Patron" } });
    fireEvent.click(screen.getByRole("button", { name: /newTierDialog\.create/ }));

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("adminMembership.toast.tierCreated"),
    );
    const inserted = chain
      .chainsFor("membership_tiers")
      .find((c) => c.has("insert"))!
      .argsOf("insert")?.[0] as Record<string, unknown>;
    expect(inserted).toMatchObject({ key: "patron", tenant_id: "tenant-test" });
  });
});

describe("AdminMembershipWorkspace - MAPOWANIE planu na warstwę", () => {
  it("wybór warstwy zapisuje `tier_key` natychmiast - patchem z tokenem planu", async () => {
    h.plans = [planRow({ id: "plan-1", tier_key: null })];
    renderWithQueryClient(<AdminMembershipWorkspace />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(4));

    openTab("mapping");
    await waitFor(() => expect(screen.getAllByRole("combobox").length).toBeGreaterThan(0));
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "member" } });

    await waitFor(() => expect(planUpdates()).toHaveLength(1));
    // Tylko `tier_key` - cena i sprzedaż należą do Paywalla (S1 def. 3).
    expect(planUpdates()[0].argsOf("update")?.[0]).toEqual({ tier_key: "member" });
    expect(eqOf(planUpdates()[0], "id")).toBe("plan-1");
    expect(eqOf(planUpdates()[0], "updated_at")).toBe(TOKEN);
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("adminMembership.toast.planMappingSaved"),
    );
  });

  it("odjęcie warstwy zapisuje `null`, nie napis „none”", async () => {
    h.plans = [planRow({ id: "plan-1", tier_key: "member" })];
    renderWithQueryClient(<AdminMembershipWorkspace />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(4));

    openTab("mapping");
    await waitFor(() => expect(screen.getAllByRole("combobox").length).toBeGreaterThan(0));
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "none" } });

    await waitFor(() => expect(planUpdates()).toHaveLength(1));
    expect(planUpdates()[0].argsOf("update")?.[0]).toEqual({ tier_key: null });
  });

  it("LOST UPDATE `tier_key`: zapis z drugiej karty po naszym odczycie = toast konfliktu, nie nadpisanie", async () => {
    // Kryterium SPEC §8.3 S1: druga zakładka zmienia plan (np. cenę w Paywallu)
    // tym samym wierszem - nasz wybór warstwy z tokenem sprzed tej zmiany NIE
    // może jej cicho nadpisać.
    h.plans = [planRow({ id: "plan-1", tier_key: null, price_cents: 4900 })];
    renderWithQueryClient(<AdminMembershipWorkspace />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(4));
    openTab("mapping");
    await waitFor(() => expect(screen.getAllByRole("combobox").length).toBeGreaterThan(0));
    h.plans = h.plans.map((p) => ({ ...p, price_cents: 5900, updated_at: `${TOKEN}#other` }));

    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "member" } });

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "adminPaywall.sync.staleWrite",
        expect.objectContaining({ action: expect.anything() }),
      ),
    );
    expect(toastSuccess).not.toHaveBeenCalledWith("adminMembership.toast.planMappingSaved");
    expect(h.plans[0]).toMatchObject({ tier_key: null, price_cents: 5900 });
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
    h.plans = [planRow({ id: "plan-1" })];
    renderWithQueryClient(<AdminMembershipWorkspace />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(4));

    openTab("mapping");

    await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(0));
    const values = screen.getAllByRole("option").map((o) => o.getAttribute("value"));
    expect(values).toContain("member");
    expect(values).not.toContain("wylaczona");
  });

  it("ZMIANA ZAMIERZONA: lista obejmuje też plany nieaktywne i wycofane, z ich stanem", async () => {
    h.plans = [
      planRow({ id: "p1", name_pl: "Aktywny" }),
      planRow({ id: "p2", name_pl: "Stary", active: false }),
      planRow({ id: "p3", name_pl: "Wycofany", for_sale: false }),
    ];
    renderWithQueryClient(<AdminMembershipWorkspace />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(4));

    openTab("mapping");

    await waitFor(() => expect(screen.getAllByRole("combobox")).toHaveLength(3));
    expect(screen.getByText("adminPaywall.plans.inactive")).toBeInTheDocument();
    expect(screen.getByText("adminPaywall.plans.withdrawn")).toBeInTheDocument();
  });

  it("błąd zapisu mapowania idzie wspólnym kanałem błędów", async () => {
    const failure = Object.assign(new Error("foreign key violation"), { name: "PostgrestError" });
    chain.setResponse("access_plans", (c) =>
      c.has("update") ? { data: null, error: failure } : ok(h.plans),
    );
    h.plans = [planRow({ id: "plan-1", tier_key: null })];
    renderWithQueryClient(<AdminMembershipWorkspace />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(4));

    openTab("mapping");
    await waitFor(() => expect(screen.getAllByRole("combobox").length).toBeGreaterThan(0));
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "member" } });

    await waitFor(() => expect(toastErrorKind).toHaveBeenCalledWith(failure, "save"));
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

// ODMOWA BAZY PRZY ZAPISIE, USUNIĘCIU I UTWORZENIU. Od S1 odmowa idzie
// wspólnym kanałem `toastError(err, rodzaj)` - redakcja widzi zdanie po
// polsku/angielsku, a nie surowy komunikat Postgresa (ZMIANA ZAMIERZONA). Test „błąd bazy przy
// zapisie warstwy" wyżej mierzy w rzeczywistości błąd ODCZYTU (katalog się
// nie wczytuje, więc nie ma czego zapisać) - gałęzie `if (error) throw error`
// trzech mutacji nie miały ani jednego wywołania. A to one decydują, czy
// odrzucony zapis (RLS, unikalność klucza, warstwa przypięta do planu) kończy
// się komunikatem, czy cichym „zapisano" bez zmiany w bazie.
describe("AdminMembershipWorkspace - odmowa bazy przy mutacjach", () => {
  /** Odczyt przechodzi, a wskazana operacja zapisu jest odrzucona. */
  function rejectOn(method: "update" | "delete" | "insert", message: string) {
    chain.setResponse("membership_tiers", (c) =>
      c.has(method)
        ? { data: null, error: Object.assign(new Error(message), { name: "PostgrestError" }) }
        : ok([membershipTier()]),
    );
  }

  it("odrzucony ZAPIS warstwy kończy się komunikatem, nie sukcesem", async () => {
    rejectOn("update", "permission denied for table membership_tiers");
    renderWithQueryClient(<AdminMembershipWorkspace />);
    const dialog = await openTierEditor("basics");
    const status = within(dialog).getByRole("group", { name: /groups\.status/ });
    fireEvent.change(within(status).getByRole("spinbutton"), { target: { value: "25" } });

    fireEvent.click(screen.getByRole("button", { name: /^adminMembership\.save$/ }));

    await waitFor(() =>
      expect(toastErrorKind).toHaveBeenCalledWith(
        expect.objectContaining({ message: "permission denied for table membership_tiers" }),
        "save",
      ),
    );
    expect(toastSuccess).not.toHaveBeenCalledWith("adminMembership.toast.tierSaved");
  });

  it("odrzucone USUNIĘCIE (np. warstwa przypięta do planu) kończy się komunikatem", async () => {
    rejectOn("delete", "violates foreign key constraint");
    renderWithQueryClient(<AdminMembershipWorkspace />);
    await openTierEditor("basics");

    fireEvent.click(screen.getByRole("button", { name: /deleteTitle/ }));

    await waitFor(() =>
      expect(toastErrorKind).toHaveBeenCalledWith(
        expect.objectContaining({ message: "violates foreign key constraint" }),
        "delete",
      ),
    );
    expect(toastSuccess).not.toHaveBeenCalledWith("adminMembership.toast.tierDeleted");
  });

  it("odrzucone UTWORZENIE (kolizja klucza) kończy się komunikatem", async () => {
    rejectOn("insert", "duplicate key value violates unique constraint");
    renderWithQueryClient(<AdminMembershipWorkspace />);
    await waitFor(() => expect(screen.getByText("1 / 1")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /newTierDialog\.title/ }));
    const fields = within(screen.getByRole("dialog")).getAllByRole("textbox");
    fireEvent.change(fields[0] as HTMLElement, { target: { value: "patron" } });
    fireEvent.change(fields[1] as HTMLElement, { target: { value: "Patron" } });
    fireEvent.change(fields[2] as HTMLElement, { target: { value: "Patron" } });
    fireEvent.click(screen.getByRole("button", { name: /newTierDialog\.create/ }));

    await waitFor(() =>
      expect(toastErrorKind).toHaveBeenCalledWith(
        expect.objectContaining({ message: "duplicate key value violates unique constraint" }),
        "save",
      ),
    );
    expect(toastSuccess).not.toHaveBeenCalledWith("adminMembership.toast.tierCreated");
  });

  it("zamknięcie okna edycji wraca do katalogu bez zapisu", async () => {
    renderWithQueryClient(<AdminMembershipWorkspace />);
    const dialog = await openTierEditor("basics");

    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(tierUpdate()).toBeUndefined();
  });
});
