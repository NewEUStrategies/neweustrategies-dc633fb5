// GiftBanner - baner odbiorcy: "gifted" (link odblokowal tresc) oraz trzy
// warianty odmowy - "exhausted" (budzet klikniec wyczerpany), "expired"
// (link po terminie) i "invalid" (kod nieprawidlowy). Kazdy z wlasnym copy
// i CTA planow.
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

  it("wariant exhausted: budzet klikniec wyczerpali wczesniejsi czytelnicy", () => {
    render(<GiftBanner variant="exhausted" />);
    expect(screen.getByRole("status")).toHaveAttribute("data-gift-banner", "exhausted");
    expect(screen.getByText("gifting.banner.exhaustedTitle")).toBeInTheDocument();
    expect(screen.getByText("gifting.banner.exhaustedDesc")).toBeInTheDocument();
  });

  it("wariant expired: link po terminie waznosci ma wlasne copy", () => {
    render(<GiftBanner variant="expired" />);
    expect(screen.getByRole("status")).toHaveAttribute("data-gift-banner", "expired");
    expect(screen.getByText("gifting.banner.expiredTitle")).toBeInTheDocument();
    expect(screen.getByText("gifting.banner.expiredDesc")).toBeInTheDocument();
  });
});
