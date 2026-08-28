import { describe, expect, it } from "vitest";

import { parseCompanyBrand } from "@/lib/crm/useCompanyBrand";

describe("parseCompanyBrand", () => {
  it("czyta logotyp i domenę z kartoteki CRM", () => {
    expect(
      parseCompanyBrand({
        id: "c1",
        name: "ACME",
        logo_url: "https://cdn.example/acme.png",
        website: "https://acme.example",
        industry: "Energetyka",
      }),
    ).toEqual({
      id: "c1",
      name: "ACME",
      logoUrl: "https://cdn.example/acme.png",
      website: "https://acme.example",
      industry: "Energetyka",
    });
  });

  it("brak dopasowania i puste napisy dają same nulle", () => {
    expect(parseCompanyBrand(null).logoUrl).toBeNull();
    expect(parseCompanyBrand({ name: "   ", logo_url: "" }).name).toBeNull();
  });
});
