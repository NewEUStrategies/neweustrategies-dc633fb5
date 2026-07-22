// GiftBanner - baner odbiorcy prezentu: wariant "gifted" (kod odblokowal
// tresc) i "invalid" (kod niewazny), oba z CTA planow.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GiftBanner } from "@/components/gifting/GiftBanner";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/i18n-gifting", () => ({}));

vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

describe("GiftBanner", () => {
  it("wariant gifted: tytul, opis i CTA planow", () => {
    render(<GiftBanner variant="gifted" />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveAttribute("data-gift-banner", "gifted");
    expect(screen.getByText("gifting.banner.title")).toBeInTheDocument();
    expect(screen.getByText("gifting.banner.desc")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "gifting.banner.cta" })).toHaveAttribute(
      "href",
      "/pricing",
    );
  });

  it("wariant invalid: komunikat o niewaznym linku", () => {
    render(<GiftBanner variant="invalid" />);
    expect(screen.getByRole("status")).toHaveAttribute("data-gift-banner", "invalid");
    expect(screen.getByText("gifting.banner.invalidTitle")).toBeInTheDocument();
    expect(screen.getByText("gifting.banner.invalidDesc")).toBeInTheDocument();
  });
});
