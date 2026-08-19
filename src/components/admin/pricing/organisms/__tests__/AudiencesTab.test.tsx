// Zakładka „Segmenty odbiorców" - 0 z 9 funkcji pokrytych do 18.08.2026
// (mieszkała w pliku trasy `/admin/pricing`, 1821 linii).
//
// Ten katalog decyduje, jakie ZAKŁADKI widzi klient na stronie cennika. Dwie
// reguły są tu pieniężne:
//
//   Segmentu Z PRZYPISANYMI WARSTWAMI nie wolno usunąć - warstwy zostałyby bez
//   zakładki, czyli oferta zniknęłaby ze strony, nie znikając z bazy.
//
//   Zapis wymaga nazwy w OBU językach - segment bez nazwy angielskiej jest
//   pustą zakładką dla połowy odbiorców.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import {
  membershipTier,
  ok,
  pricingAudience,
  radixSelectStub,
  radixSwitchStub,
  reactI18nextStub,
  supabaseFromStub,
  type SupabaseFromStub,
} from "@/test/admin/pricingFixtures";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

let chain: SupabaseFromStub;

vi.mock("react-i18next", () => reactI18nextStub());
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => chain.from(table) },
}));
// Atrapy podmieniają NASZE opakowania z `components/ui`, nie pakiety Radiksa:
// Radix Select i Switch nie reagują na `fireEvent.click` pod happy-dom.
vi.mock("@/components/ui/select", async () => radixSelectStub(await import("react")));
vi.mock("@/components/ui/switch", async () => radixSwitchStub(await import("react")));

const toastSuccess = vi.fn();
const toastError = vi.fn();
// happy-dom nie ma `window.confirm`, a panel pyta nim przed usunięciem
// segmentu - atrapa jest jedynym sposobem sprawdzenia OBU odpowiedzi.
const confirmStub = vi.fn(() => true);
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

const { AudiencesTab } = await import("@/components/admin/pricing/organisms/AudiencesTab");

const AUDIENCES = [
  pricingAudience({ id: "a1", key: "individual", sort_order: 0 }),
  pricingAudience({
    id: "a2",
    key: "b2b",
    name_pl: "Firmy",
    name_en: "Companies",
    sort_order: 10,
  }),
];

function renderTab(audiences = AUDIENCES, tiers = [] as ReturnType<typeof membershipTier>[]) {
  return renderWithQueryClient(<AudiencesTab audiences={audiences} tiers={tiers} />);
}

/** Ostatni patch UPDATE wysłany do tabeli segmentów. */
function lastPatch(): Record<string, unknown> {
  return chain.lastChain("pricing_audiences")!.argsOf("update")?.[0] as Record<string, unknown>;
}

beforeEach(() => {
  chain = supabaseFromStub();
  chain.setResponse("pricing_audiences", ok([]));
  toastSuccess.mockClear();
  toastError.mockClear();
  confirmStub.mockReturnValue(true);
  vi.stubGlobal("confirm", confirmStub);
});

describe("AudiencesTab - lista segmentów", () => {
  it("pokazuje klucz każdego segmentu (to on wiąże warstwy z zakładką)", () => {
    renderTab();

    expect(screen.getByText("individual")).toBeInTheDocument();
    expect(screen.getByText("b2b")).toBeInTheDocument();
  });

  it("pusty katalog daje OGŁOSZONY komunikat, nie ciszę", () => {
    renderTab([]);

    expect(screen.getByRole("status")).toHaveTextContent("adminPricing.audiences.empty");
    expect(screen.queryByText("individual")).not.toBeInTheDocument();
  });

  it("liczy warstwy przypisane do segmentu", () => {
    renderTab(AUDIENCES, [
      membershipTier({ id: "t1", audience_key: "individual" }),
      membershipTier({ id: "t2", audience_key: "individual" }),
      membershipTier({ id: "t3", audience_key: "b2b" }),
    ]);

    expect(screen.getByText('adminPricing.audiences.tiersCount {"count":2}')).toBeInTheDocument();
    expect(screen.getByText('adminPricing.audiences.tiersCount {"count":1}')).toBeInTheDocument();
  });

  it("warstwa bez segmentu nie doliczy się do żadnej zakładki", () => {
    renderTab(AUDIENCES, [membershipTier({ audience_key: null })]);

    expect(screen.getAllByText('adminPricing.audiences.tiersCount {"count":0}')).toHaveLength(2);
  });
});

describe("AudiencesTab - zapis segmentu", () => {
  it("zapisuje przycięte nazwy i tagline", async () => {
    renderTab([AUDIENCES[0]]);

    const namePl = screen.getAllByDisplayValue("Osoba prywatna")[0];
    fireEvent.change(namePl, { target: { value: "  Osoby prywatne  " } });
    fireEvent.click(screen.getByRole("button", { name: /audiences\.save/ }));

    await waitFor(() => expect(lastPatch()).toBeDefined());
    expect(lastPatch().name_pl).toBe("Osoby prywatne");
    expect(chain.lastChain("pricing_audiences")!.argsOf("eq")).toEqual(["id", "a1"]);
  });

  it("PUSTY tagline schodzi do bazy jako `null`, nie jako pusty napis", async () => {
    // Pusty napis wyświetlałby się na stronie jako puste zdanie pod nazwą
    // segmentu; `null` znaczy „nie pokazuj tego wiersza wcale".
    renderTab([AUDIENCES[0]]);

    fireEvent.change(screen.getByDisplayValue("Dla czytających codziennie"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: /audiences\.save/ }));

    await waitFor(() => expect(lastPatch()).toBeDefined());
    expect(lastPatch().tagline_pl).toBeNull();
  });

  it("tagline i zdanie zaufania w OBU językach mają osobne pola", async () => {
    renderTab([
      pricingAudience({
        id: "a1",
        tagline_en: "For daily readers",
        trust_pl: "Faktura",
        trust_en: "Invoice",
      }),
    ]);

    fireEvent.change(screen.getByDisplayValue("For daily readers"), {
      target: { value: "For readers" },
    });
    fireEvent.change(screen.getByDisplayValue("Faktura"), { target: { value: "Faktura VAT" } });
    fireEvent.change(screen.getByDisplayValue("Invoice"), { target: { value: "VAT invoice" } });
    fireEvent.click(screen.getByRole("button", { name: /audiences\.save/ }));

    await waitFor(() => expect(lastPatch()).toBeDefined());
    expect(lastPatch()).toMatchObject({
      tagline_en: "For readers",
      trust_pl: "Faktura VAT",
      trust_en: "VAT invoice",
    });
  });

  it("zmiana IKONY segmentu zapisuje wybrany slug", async () => {
    renderTab([AUDIENCES[0]]);

    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "landmark" } });
    fireEvent.click(screen.getByRole("button", { name: /audiences\.save/ }));

    await waitFor(() => expect(lastPatch()).toBeDefined());
    expect(lastPatch().icon).toBe("landmark");
  });

  it("WYŁĄCZENIE segmentu zdejmuje zakładkę ze strony, ale nie kasuje danych", async () => {
    renderTab([AUDIENCES[0]]);

    fireEvent.click(screen.getAllByRole("switch")[0]);
    fireEvent.click(screen.getByRole("button", { name: /audiences\.save/ }));

    await waitFor(() => expect(lastPatch()).toBeDefined());
    expect(lastPatch().active).toBe(false);
    expect(chain.lastChain("pricing_audiences")!.has("delete")).toBe(false);
  });

  it("lista ikon zawiera wszystkie warianty ze zbioru wspólnego ze stroną", () => {
    renderTab([AUDIENCES[0]]);

    const values = screen.getAllByRole("option").map((o) => o.getAttribute("value"));
    expect(values).toContain("graduation-cap");
    expect(values).toHaveLength(6);
  });

  it("brak nazwy angielskiej BLOKUJE przycisk zapisu", () => {
    renderTab([AUDIENCES[0]]);

    fireEvent.change(screen.getAllByDisplayValue("Individual")[0], { target: { value: "" } });

    expect(screen.getByRole("button", { name: /audiences\.save/ })).toBeDisabled();
    expect(chain.chainsFor("pricing_audiences")).toHaveLength(0);
  });

  it("błąd zapisu trafia do komunikatu, nie w próżnię", async () => {
    chain.setResponse("pricing_audiences", {
      data: null,
      error: Object.assign(new Error("permission denied"), { name: "PostgrestError" }),
    });
    renderTab([AUDIENCES[0]]);

    fireEvent.click(screen.getByRole("button", { name: /audiences\.save/ }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("permission denied"));
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("udany zapis potwierdza komunikatem", async () => {
    renderTab([AUDIENCES[0]]);

    fireEvent.click(screen.getByRole("button", { name: /audiences\.save/ }));

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("adminPricing.toast.audienceSaved"),
    );
    expect(toastError).not.toHaveBeenCalled();
  });
});

describe("AudiencesTab - USUNIĘCIE segmentu", () => {
  it("segment Z WARSTWAMI nie da się usunąć - komunikat zamiast zapytania", async () => {
    // Usunięcie zdjęłoby ze strony cennika całą zakładkę wraz z ofertą.
    renderTab([AUDIENCES[0]], [membershipTier({ audience_key: "individual" })]);

    fireEvent.click(screen.getByRole("button", { name: /audiences\.deleteTitle/ }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("adminPricing.audiences.deleteBlocked"),
    );
    expect(chain.chainsFor("pricing_audiences")).toHaveLength(0);
  });

  it("segment BEZ warstw usuwa się po potwierdzeniu", async () => {
    renderTab([AUDIENCES[0]], []);

    fireEvent.click(screen.getByRole("button", { name: /audiences\.deleteTitle/ }));

    await waitFor(() => expect(chain.chainsFor("pricing_audiences")).toHaveLength(1));
    expect(chain.lastChain("pricing_audiences")!.has("delete")).toBe(true);
  });

  it("ODWOŁANE potwierdzenie nie usuwa niczego", async () => {
    confirmStub.mockReturnValue(false);
    renderTab([AUDIENCES[0]], []);

    fireEvent.click(screen.getByRole("button", { name: /audiences\.deleteTitle/ }));

    await waitFor(() => expect(confirmStub).toHaveBeenCalled());
    expect(chain.chainsFor("pricing_audiences")).toHaveLength(0);
  });

  it("BŁĄD usunięcia segmentu trafia do komunikatu", async () => {
    chain.setResponse("pricing_audiences", {
      data: null,
      error: Object.assign(new Error("foreign key violation"), { name: "PostgrestError" }),
    });
    renderTab([AUDIENCES[0]], []);

    fireEvent.click(screen.getByRole("button", { name: /audiences\.deleteTitle/ }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("foreign key violation"));
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("udane usunięcie potwierdza komunikatem", async () => {
    renderTab([AUDIENCES[0]], []);

    fireEvent.click(screen.getByRole("button", { name: /audiences\.deleteTitle/ }));

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("adminPricing.toast.audienceDeleted"),
    );
  });
});

describe("AudiencesTab - kolejność zakładek u klienta", () => {
  it("pierwszy segment nie może iść w górę, ostatni w dół", () => {
    renderTab();

    const up = screen.getAllByRole("button", { name: /audiences\.moveUp/ });
    const down = screen.getAllByRole("button", { name: /audiences\.moveDown/ });
    expect(up[0]).toBeDisabled();
    expect(down[down.length - 1]).toBeDisabled();
  });

  it("przesunięcie w dół zapisuje NOWĄ kolejność w bazie", async () => {
    renderTab();

    fireEvent.click(screen.getAllByRole("button", { name: /audiences\.moveDown/ })[0]);

    await waitFor(() => expect(chain.chainsFor("pricing_audiences").length).toBeGreaterThan(0));
    const patches = chain
      .chainsFor("pricing_audiences")
      .map((call) => call.argsOf("update")?.[0] as { sort_order: number });
    expect(patches.map((p) => p.sort_order)).toEqual([0, 10]);
  });

  it("przesunięcie potwierdza się komunikatem", async () => {
    renderTab();

    fireEvent.click(screen.getAllByRole("button", { name: /audiences\.moveUp/ })[1]);

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("adminPricing.toast.reordered"));
  });

  it("BŁĄD zapisu kolejności trafia do komunikatu", async () => {
    chain.setResponse("pricing_audiences", {
      data: null,
      error: Object.assign(new Error("permission denied"), { name: "PostgrestError" }),
    });
    renderTab();

    fireEvent.click(screen.getAllByRole("button", { name: /audiences\.moveDown/ })[0]);

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("permission denied"));
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

describe("AudiencesTab - nowy segment", () => {
  it("okno „nowy segment” jest dostępne z zakładki", () => {
    renderTab();

    expect(screen.getByRole("button", { name: /audiences\.new/ })).toBeInTheDocument();
  });

  it("tworzy segment z kolejnością ZA ostatnim istniejącym", async () => {
    renderTab();

    fireEvent.click(screen.getByRole("button", { name: /audiences\.new/ }));
    fireEvent.change(screen.getByPlaceholderText("media"), { target: { value: "media" } });
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[inputs.length - 2], { target: { value: "Media" } });
    fireEvent.change(inputs[inputs.length - 1], { target: { value: "Media" } });
    fireEvent.click(screen.getByRole("button", { name: /audiences\.create/ }));

    await waitFor(() => expect(chain.chainsFor("pricing_audiences")).toHaveLength(1));
    const inserted = chain.lastChain("pricing_audiences")!.argsOf("insert")?.[0] as {
      sort_order: number;
      key: string;
    };
    expect(inserted).toMatchObject({ key: "media", sort_order: 20 });
  });

  it("bez ŻADNEGO segmentu i warstwy nie ma skąd wziąć tenanta - zapis odmawia", async () => {
    renderTab([], []);

    fireEvent.click(screen.getByRole("button", { name: /audiences\.new/ }));
    fireEvent.change(screen.getByPlaceholderText("media"), { target: { value: "media" } });
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[inputs.length - 2], { target: { value: "Media" } });
    fireEvent.change(inputs[inputs.length - 1], { target: { value: "Media" } });
    fireEvent.click(screen.getByRole("button", { name: /audiences\.create/ }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("adminPricing.toast.noTenant"));
    expect(chain.chainsFor("pricing_audiences")).toHaveLength(0);
  });
});
