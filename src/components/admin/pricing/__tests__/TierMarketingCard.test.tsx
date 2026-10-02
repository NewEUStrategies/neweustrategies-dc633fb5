// Karta marketingu warstwy - nota cenowa PL i benefity edytowane NA KARCIE,
// sprawdzane po tym, co faktycznie zapisuje się w `membership_tiers`.
//
// RYZYKO. Nota cenowa („2-20 miejsc") i lista benefitów to tekst, który klient
// czyta pod ceną na /pricing - czyli warunki oferty. Pole polskie, które
// zapisuje się do kolumny angielskiej (albo wcale), daje kartę, na której
// polski czytelnik widzi stare warunki, a redakcja jest przekonana, że je
// zmieniła. Benefit dopisany na karcie musi dojść do bazy przez TĘ SAMĄ
// serializację co w panelu członkostwa (`serializeTierBenefits`): z
// dziedziczeniem brakującej wersji językowej i bez pustych wierszy.
//
// Atrapowane są wyłącznie granice: klient Supabase (zapis warstwy), słownik
// (echo klucza), toasty i dwa prymitywy Radiksa, które nie reagują na zdarzenia
// pod happy-dom. Zakładka, karta, edytor benefitów i reguły szkicu biegną
// PRAWDZIWE - stąd montaż przez `TiersTab`, który trzyma szkic i zapis karty.
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
import { RouterLinkStub } from "@/test/routerLinkStub";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

let chain: SupabaseFromStub;

vi.mock("react-i18next", () => reactI18nextStub());
vi.mock("@tanstack/react-router", () => ({ Link: RouterLinkStub }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => chain.from(table) },
}));
vi.mock("@/components/ui/select", async () => radixSelectStub(await import("react")));
vi.mock("@/components/ui/switch", async () => radixSwitchStub(await import("react")));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { TiersTab } = await import("@/components/admin/pricing/organisms/TiersTab");

const AUDIENCES = [pricingAudience({ key: "individual" })];

function renderCard(tier = membershipTier()) {
  return renderWithQueryClient(<TiersTab audiences={AUDIENCES} tiers={[tier]} />);
}

async function saveAndReadPatch(): Promise<Record<string, unknown>> {
  fireEvent.click(screen.getByRole("button", { name: /tiers\.save/ }));
  await waitFor(() => expect(chain.chainsFor("membership_tiers")).toHaveLength(1));
  return chain.lastChain("membership_tiers")!.argsOf("update")?.[0] as Record<string, unknown>;
}

beforeEach(() => {
  chain = supabaseFromStub();
  chain.setResponse("membership_tiers", ok([]));
});

describe("TierMarketingCard - nota cenowa", () => {
  it("polska nota zapisuje się do `price_note_pl`, angielska zostaje bez zmian", async () => {
    renderCard(
      membershipTier({ id: "t-team", price_note_pl: "2-20 miejsc", price_note_en: "2-20 seats" }),
    );

    fireEvent.change(screen.getByDisplayValue("2-20 miejsc"), {
      target: { value: "  2-50 miejsc  " },
    });
    const patch = await saveAndReadPatch();

    expect(patch.price_note_pl).toBe("2-50 miejsc");
    expect(patch.price_note_en).toBe("2-20 seats");
    expect(chain.lastChain("membership_tiers")!.argsOf("eq")).toEqual(["id", "t-team"]);
  });

  it("wyczyszczona polska nota schodzi do bazy jako `null`, nie pusty napis", async () => {
    renderCard(membershipTier({ price_note_pl: "2-20 miejsc", price_note_en: null }));

    fireEvent.change(screen.getByDisplayValue("2-20 miejsc"), { target: { value: "   " } });
    const patch = await saveAndReadPatch();

    expect(patch.price_note_pl).toBeNull();
  });
});

describe("TierMarketingCard - benefity edytowane na karcie", () => {
  it("benefit dopisany tylko po polsku zapisuje się z angielską kopią", async () => {
    renderCard(membershipTier({ benefits: [{ pl: "Briefing", en: "Briefing" }] }));

    fireEvent.click(screen.getByRole("button", { name: /benefits\.add/ }));
    fireEvent.change(screen.getByLabelText("adminPricing.benefits.labelPl #2"), {
      target: { value: " Raport kwartalny " },
    });
    const patch = await saveAndReadPatch();

    expect(patch.benefits).toEqual([
      { pl: "Briefing", en: "Briefing" },
      { pl: "Raport kwartalny", en: "Raport kwartalny" },
    ]);
  });

  it("dodany i niewypełniony wiersz NIE trafia do bazy jako pusty benefit", async () => {
    renderCard(membershipTier({ benefits: [{ pl: "Briefing", en: "Briefing" }] }));

    fireEvent.click(screen.getByRole("button", { name: /benefits\.add/ }));
    expect(screen.getByLabelText("adminPricing.benefits.labelPl #2")).toHaveValue("");
    const patch = await saveAndReadPatch();

    expect(patch.benefits).toEqual([{ pl: "Briefing", en: "Briefing" }]);
  });

  it("usunięcie benefitu na karcie usuwa go z zapisu warstwy", async () => {
    renderCard(
      membershipTier({
        benefits: [
          { pl: "Briefing", en: "Briefing" },
          { pl: "Debaty", en: "Debates" },
        ],
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "adminPricing.benefits.remove #1" }));
    const patch = await saveAndReadPatch();

    expect(patch.benefits).toEqual([{ pl: "Debaty", en: "Debates" }]);
  });
});
