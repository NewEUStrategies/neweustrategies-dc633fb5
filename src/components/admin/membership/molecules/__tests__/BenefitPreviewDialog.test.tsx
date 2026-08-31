// Podgląd benefitu: redakcja pisze pola PL/EN „na ślepo", więc okno musi
// pokazać dokładnie to, co zobaczy klient na cenniku - w obu językach naraz.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { reactI18nextStub } from "@/test/admin/pricingFixtures";
import type { TierBenefit } from "@/lib/billing/tiers";

vi.mock("react-i18next", () => reactI18nextStub());

const { BenefitPreviewDialog } =
  await import("@/components/admin/membership/molecules/BenefitPreviewDialog");

const benefit: TierBenefit = {
  pl: "Dostęp do briefingów",
  en: "Access to briefings",
  detail_pl: "Co tydzień",
  detail_en: "Every week",
};

describe("BenefitPreviewDialog", () => {
  it("renderuje benefit w PL i EN tak jak strona cennika", () => {
    render(<BenefitPreviewDialog benefit={benefit} open onOpenChange={vi.fn()} />);

    expect(screen.getByText("Dostęp do briefingów")).toBeInTheDocument();
    expect(screen.getByText("Access to briefings")).toBeInTheDocument();
    expect(screen.getByText("Co tydzień")).toBeInTheDocument();
    expect(screen.getByText("Every week")).toBeInTheDocument();
  });

  it("zamknięte okno nic nie renderuje", () => {
    render(<BenefitPreviewDialog benefit={benefit} open={false} onOpenChange={vi.fn()} />);

    expect(screen.queryByText("Dostęp do briefingów")).not.toBeInTheDocument();
  });

  it("bez wybranego benefitu okno pokazuje sam nagłówek, nie pustą listę", () => {
    render(<BenefitPreviewDialog benefit={null} open onOpenChange={vi.fn()} />);

    expect(screen.getByText("adminPricing.benefits.previewTitle")).toBeInTheDocument();
    expect(screen.queryByText("adminPricing.benefits.previewPl")).not.toBeInTheDocument();
  });
});
