// Mapper partnerow z RPC panelu na model publicznego pasa poziomow.
//
// CO TU JEST PILNOWANE: podglad studia ma pokazac DOKLADNIE to, co zobaczy
// uczestnik - te same grupy, ta sama kolejnosc i bez przypiec, ktorych po
// publikacji nie bedzie.
import { describe, expect, it } from "vitest";
import { sponsorTiersFromAdminRows } from "@/lib/events/sponsorsPreview";
import type { EventSponsorRow } from "@/lib/events/sponsorsApi";

function row(overrides: Partial<EventSponsorRow>): EventSponsorRow {
  return {
    id: "s-1",
    snapshot_name: "Acme",
    is_published: true,
    sort_order: 0,
    ...overrides,
  } as EventSponsorRow;
}

describe("sponsorTiersFromAdminRows", () => {
  it("grupuje po poziomie i ustawia rangi malejaco, grupe bez poziomu na koncu", () => {
    const tiers = sponsorTiersFromAdminRows([
      row({ id: "a", snapshot_name: "Bez poziomu", tier_id: undefined }),
      row({ id: "b", snapshot_name: "Srebro", tier_id: "t-silver", tier_rank: 10 }),
      row({ id: "c", snapshot_name: "Zloto", tier_id: "t-gold", tier_rank: 30 }),
    ]);

    expect(tiers.map((tier) => tier.tierId)).toEqual(["t-gold", "t-silver", null]);
    expect(tiers[0].sponsors[0].name).toBe("Zloto");
  });

  it("odsiewa przypiecia nieogloszone i pozycje bez nazwy", () => {
    const tiers = sponsorTiersFromAdminRows([
      row({ id: "a", is_published: false }),
      row({ id: "b", snapshot_name: undefined, crm_name: undefined }),
      row({ id: "c", snapshot_name: "Widoczny" }),
    ]);

    expect(tiers).toHaveLength(1);
    expect(tiers[0].sponsors.map((sponsor) => sponsor.name)).toEqual(["Widoczny"]);
  });

  it("w grupie sortuje po sort_order, a przy remisie po nazwie", () => {
    const tiers = sponsorTiersFromAdminRows([
      row({ id: "a", snapshot_name: "Zeta", tier_id: "t", sort_order: 1 }),
      row({ id: "b", snapshot_name: "Alfa", tier_id: "t", sort_order: 1 }),
      row({ id: "c", snapshot_name: "Omega", tier_id: "t", sort_order: 0 }),
    ]);

    expect(tiers[0].sponsors.map((sponsor) => sponsor.name)).toEqual(["Omega", "Alfa", "Zeta"]);
  });

  it("bierze dane z migawki, a z CRM dopiero w jej braku", () => {
    const [tier] = sponsorTiersFromAdminRows([
      row({
        id: "a",
        snapshot_name: "Migawka",
        snapshot_logo_url: undefined,
        crm_logo_url: "https://example.com/logo.svg",
        snapshot_website: "https://migawka.example",
        crm_website: "https://crm.example",
      }),
    ]);

    expect(tier.sponsors[0].logoUrl).toBe("https://example.com/logo.svg");
    expect(tier.sponsors[0].websiteUrl).toBe("https://migawka.example");
  });

  it("pusta lista i brak danych nie wywracaja pasa", () => {
    expect(sponsorTiersFromAdminRows([])).toEqual([]);
    expect(sponsorTiersFromAdminRows(null)).toEqual([]);
  });
});
