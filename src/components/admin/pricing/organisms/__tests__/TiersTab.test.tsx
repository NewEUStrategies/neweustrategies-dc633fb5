// Zakładka „Warstwy i benefity" wraz z kartą marketingu warstwy - 0 z 11
// funkcji pokrytych do 18.08.2026 (mieszkała w pliku trasy `/admin/pricing`).
//
// To tutaj redakcja ustawia, jak warstwa WYGLĄDA na stronie cennika: w której
// zakładce stoi, czy jest kotwicą wyboru, czy ma przycisk zakupu, czy kontakt
// z działem. Najważniejsza rzecz w tej zakładce to koszyk NIEPRZYPISANYCH:
// warstwa wskazująca nieistniejący segment nie pokaże się klientowi w żadnej
// zakładce cennika, więc panel musi ją wyświetlić osobno.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

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
import { RouterLinkStub } from "@/test/routerLinkStub";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

let chain: SupabaseFromStub;
let lang = "pl";

vi.mock("react-i18next", () => reactI18nextStub(() => lang));
vi.mock("@tanstack/react-router", () => ({ Link: RouterLinkStub }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => chain.from(table) },
}));
vi.mock("@/components/ui/select", async () => radixSelectStub(await import("react")));
vi.mock("@/components/ui/switch", async () => radixSwitchStub(await import("react")));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

const { TiersTab } = await import("@/components/admin/pricing/organisms/TiersTab");

const AUDIENCES = [
  pricingAudience({ key: "individual", name_pl: "Osoba prywatna", name_en: "Individual" }),
  pricingAudience({ id: "a2", key: "b2b", name_pl: "Firmy", name_en: "Companies" }),
];

function renderTab(tiers = [membershipTier()], audiences = AUDIENCES) {
  return renderWithQueryClient(<TiersTab audiences={audiences} tiers={tiers} />);
}

function lastTierPatch(): Record<string, unknown> {
  return chain.lastChain("membership_tiers")!.argsOf("update")?.[0] as Record<string, unknown>;
}

beforeEach(() => {
  chain = supabaseFromStub();
  chain.setResponse("membership_tiers", ok([]));
  lang = "pl";
  toastSuccess.mockClear();
  toastError.mockClear();
});

describe("TiersTab - liczniki nad zakładką", () => {
  it("liczy warstwy, segmenty, wyróżnienia i przypisania", () => {
    renderTab(
      [
        membershipTier({ id: "t1", audience_key: "individual", highlight: true }),
        membershipTier({ id: "t2", audience_key: "b2b" }),
        membershipTier({ id: "t3", audience_key: null }),
      ],
      AUDIENCES,
    );

    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("2/3")).toBeInTheDocument();
  });

  it("warstwa wskazująca NIEISTNIEJĄCY segment nie liczy się jako przypisana", () => {
    renderTab([membershipTier({ audience_key: "skasowany" })], AUDIENCES);

    expect(screen.getByText("0/1")).toBeInTheDocument();
  });
});

describe("TiersTab - grupowanie po segmencie", () => {
  it("warstwa stoi w nagłówku swojego segmentu", () => {
    renderTab([membershipTier({ audience_key: "individual" })], AUDIENCES);

    expect(screen.getByRole("heading", { name: "Osoba prywatna" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Firmy" })).not.toBeInTheDocument();
  });

  it("segment BEZ warstw nie dostaje pustej sekcji", () => {
    renderTab([membershipTier({ audience_key: "b2b" })], AUDIENCES);

    expect(screen.getByRole("heading", { name: "Firmy" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Osoba prywatna" })).not.toBeInTheDocument();
  });

  it("warstwa wskazująca skasowany segment trafia do NIEPRZYPISANYCH, nie ginie", () => {
    renderTab([membershipTier({ name_pl: "Sierota", audience_key: "skasowany" })], AUDIENCES);

    expect(
      screen.getByRole("heading", { name: "adminPricing.tiers.unassigned" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Sierota")).toBeInTheDocument();
  });

  it("bez nieprzypisanych warstw sekcja „nieprzypisane” w ogóle się nie pokazuje", () => {
    renderTab([membershipTier({ audience_key: "individual" })], AUDIENCES);

    expect(
      screen.queryByRole("heading", { name: "adminPricing.tiers.unassigned" }),
    ).not.toBeInTheDocument();
  });
});

describe("TierMarketingCard - co widzi klient", () => {
  it("pokazuje nazwę warstwy w języku panelu i jej rangę", () => {
    renderTab([membershipTier({ name_pl: "Członek", name_en: "Member", rank: 20 })]);

    expect(screen.getByText("Członek")).toBeInTheDocument();
    expect(screen.getByText(/adminPricing\.tiers\.rankBadge/)).toBeInTheDocument();
  });

  it("po angielsku pokazuje nazwę angielską", () => {
    lang = "en";
    renderTab([membershipTier({ name_pl: "Członek", name_en: "Member" })]);

    expect(screen.getByText("Member")).toBeInTheDocument();
    expect(screen.queryByText("Członek")).not.toBeInTheDocument();
  });

  it("WYRÓŻNIONA warstwa dostaje znacznik kotwicy", () => {
    renderTab([membershipTier({ highlight: true })]);

    expect(screen.getAllByText("adminPricing.tiers.highlight").length).toBeGreaterThan(0);
  });

  it("badge redakcyjny pokazuje się w nagłówku karty", () => {
    renderTab([membershipTier({ badge_pl: "Najpopularniejszy" })]);

    expect(screen.getByText("Najpopularniejszy")).toBeInTheDocument();
  });

  it("cztery grupy pól są nazwanymi zbiorami, nie płaską listą", () => {
    renderTab();

    expect(screen.getAllByRole("group").length).toBeGreaterThanOrEqual(4);
  });
});

describe("TiersTab - ZAPIS marketingu warstwy", () => {
  it("zapisuje przypisanie do segmentu wybrane z listy", async () => {
    renderTab([membershipTier({ id: "t9", audience_key: "individual" })]);

    const audienceSelect = screen.getAllByRole("combobox")[0];
    fireEvent.change(audienceSelect, { target: { value: "b2b" } });
    fireEvent.click(screen.getByRole("button", { name: /tiers\.save/ }));

    await waitFor(() => expect(chain.chainsFor("membership_tiers")).toHaveLength(1));
    expect(lastTierPatch().audience_key).toBe("b2b");
    expect(chain.lastChain("membership_tiers")!.argsOf("eq")).toEqual(["id", "t9"]);
  });

  it("wybór „brak segmentu” zapisuje `null`, a nie napis „none”", async () => {
    renderTab([membershipTier({ audience_key: "individual" })]);

    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "none" } });
    fireEvent.click(screen.getByRole("button", { name: /tiers\.save/ }));

    await waitFor(() => expect(chain.chainsFor("membership_tiers")).toHaveLength(1));
    expect(lastTierPatch().audience_key).toBeNull();
  });

  it("puste badge i link kontaktowy schodzą do bazy jako `null`", async () => {
    renderTab([membershipTier({ badge_pl: "  ", contact_url: "   " })]);

    fireEvent.click(screen.getByRole("button", { name: /tiers\.save/ }));

    await waitFor(() => expect(chain.chainsFor("membership_tiers")).toHaveLength(1));
    expect(lastTierPatch().badge_pl).toBeNull();
    expect(lastTierPatch().contact_url).toBeNull();
  });

  it("przełącznik wyróżnienia zmienia zapisywaną wartość", async () => {
    renderTab([membershipTier({ highlight: false })]);

    fireEvent.click(screen.getAllByRole("switch")[0]);
    fireEvent.click(screen.getByRole("button", { name: /tiers\.save/ }));

    await waitFor(() => expect(chain.chainsFor("membership_tiers")).toHaveLength(1));
    expect(lastTierPatch().highlight).toBe(true);
  });

  it("tryb przycisku zakupu zapisuje się wybraną wartością", async () => {
    renderTab([membershipTier({ cta_mode: "auto" })]);

    const ctaSelect = screen.getAllByRole("combobox")[1];
    fireEvent.change(ctaSelect, { target: { value: "contact" } });
    fireEvent.click(screen.getByRole("button", { name: /tiers\.save/ }));

    await waitFor(() => expect(chain.chainsFor("membership_tiers")).toHaveLength(1));
    expect(lastTierPatch().cta_mode).toBe("contact");
  });

  it("badge angielski, nota cenowa i link kontaktowy mają osobne pola", async () => {
    renderTab([
      membershipTier({
        badge_en: "Most popular",
        contact_url: "/kontakt",
        price_note_pl: "2-20 miejsc",
        price_note_en: "2-20 seats",
      }),
    ]);

    fireEvent.change(screen.getByDisplayValue("Most popular"), { target: { value: "Top pick" } });
    fireEvent.change(screen.getByDisplayValue("/kontakt"), {
      target: { value: "mailto:a@b.test" },
    });
    fireEvent.change(screen.getByDisplayValue("2-20 seats"), { target: { value: "2-50 seats" } });
    fireEvent.click(screen.getByRole("button", { name: /tiers\.save/ }));

    await waitFor(() => expect(chain.chainsFor("membership_tiers")).toHaveLength(1));
    expect(lastTierPatch()).toMatchObject({
      badge_en: "Top pick",
      contact_url: "mailto:a@b.test",
      price_note_en: "2-50 seats",
      price_note_pl: "2-20 miejsc",
    });
  });

  it("przełącznik „za miejsce” zapisuje się razem z notą cenową", async () => {
    renderTab([membershipTier({ per_seat: false })]);

    const switches = screen.getAllByRole("switch");
    fireEvent.click(switches[switches.length - 1]);
    fireEvent.click(screen.getByRole("button", { name: /tiers\.save/ }));

    await waitFor(() => expect(chain.chainsFor("membership_tiers")).toHaveLength(1));
    expect(lastTierPatch().per_seat).toBe(true);
  });

  it("edytor benefitów zapisuje listę par PL/EN, nie surowy tekst", async () => {
    renderTab([membershipTier({ benefits: [{ pl: "Briefing", en: "Briefing" }] })]);

    fireEvent.click(screen.getByRole("button", { name: /tiers\.save/ }));

    await waitFor(() => expect(chain.chainsFor("membership_tiers")).toHaveLength(1));
    expect(lastTierPatch().benefits).toEqual([{ pl: "Briefing", en: "Briefing" }]);
  });

  it("błąd zapisu trafia do komunikatu, sukces nie jest ogłaszany", async () => {
    chain.setResponse("membership_tiers", {
      data: null,
      error: Object.assign(new Error("check constraint"), { name: "PostgrestError" }),
    });
    renderTab();

    fireEvent.click(screen.getByRole("button", { name: /tiers\.save/ }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("check constraint"));
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("udany zapis potwierdza komunikatem", async () => {
    renderTab();

    fireEvent.click(screen.getByRole("button", { name: /tiers\.save/ }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("adminPricing.toast.tierSaved"));
  });

  it("edycja JEDNEJ warstwy nie zmienia szkicu drugiej", async () => {
    renderTab([
      membershipTier({ id: "t1", name_pl: "Pierwsza", badge_pl: "A" }),
      membershipTier({ id: "t2", name_pl: "Druga", badge_pl: "B" }),
    ]);

    fireEvent.change(screen.getByDisplayValue("A"), { target: { value: "Zmienione" } });
    const secondCard = screen.getByText("Druga").closest("div.overflow-hidden")!;
    fireEvent.click(within(secondCard as HTMLElement).getByRole("button", { name: /tiers\.save/ }));

    await waitFor(() => expect(chain.chainsFor("membership_tiers")).toHaveLength(1));
    expect(lastTierPatch().badge_pl).toBe("B");
  });
});

describe("TiersTab - skok do panelu członkostwa", () => {
  it("rangi i bramki są w innym panelu - zakładka o tym mówi i tam prowadzi", () => {
    renderTab();

    const link = screen.getByRole("link", { name: /tiers\.openMembership/ });
    expect(link).toHaveAttribute("href", "/admin/membership");
    expect(screen.getByText("adminPricing.tiers.coreHint")).toBeInTheDocument();
  });
});
