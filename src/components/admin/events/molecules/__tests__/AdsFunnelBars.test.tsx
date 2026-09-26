// Molekula `AdsFunnelBars` - lejek jako lista krokow.
//
// CO KONKRETNIE PSUJE SIE BEZ TYCH TESTOW.
//   1. PASKI NIE ZWEZAJA SIE - szerokosc liczona wzgledem poprzedniego kroku
//      zamiast pierwszego, i kazdy pasek wyglada na "prawie pelny".
//   2. ZEROWY MIANOWNIK DAJE "0%" albo "NaN%" zamiast kreski.
//   3. CZYTNIK EKRANU NIE DOSTAJE LICZB - pasek bez tekstu to sam ksztalt.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { axeViolations, summarize } from "@/test/axe";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-event-ads-funnel", () => ({ ensureAdsFunnelI18n: () => undefined }));

const { AdsFunnelBars } = await import("@/components/admin/events/molecules/AdsFunnelBars");

afterEach(cleanup);

const OF = "adminEventAdsFunnel.funnel.ofPrevious";

describe("AdsFunnelBars", () => {
  it("kazdy krok ma etykiete, wartosc i udzial w poprzednim - jako tekst", async () => {
    const { container } = render(
      <AdsFunnelBars
        steps={[
          { key: "visit", label: "Wizyta", value: 200 },
          { key: "start", label: "Start", value: 50 },
          { key: "registration", label: "Zgloszenie", value: 0 },
          { key: "paid", label: "Oplacone", value: 0 },
        ]}
      />,
    );
    const list = screen.getByRole("list", { name: "adminEventAdsFunnel.funnel.ariaLabel" });
    const items = list.querySelectorAll("li");
    expect(items).toHaveLength(4);
    expect(items[0]?.textContent).toBe("Wizyta200");
    expect(screen.getByText(`${OF}(percent=25%)`)).toBeInTheDocument();
    expect(screen.getByText(`${OF}(percent=0%)`)).toBeInTheDocument();
    // Zerowy mianownik (0 po 0) to kreska, nie "0%".
    expect(screen.getByText(`${OF}(percent=—)`)).toBeInTheDocument();
    // Szerokosc wzgledem PIERWSZEGO kroku.
    const bars = container.querySelectorAll<HTMLDivElement>("[aria-hidden='true'] > div");
    expect(Array.from(bars).map((bar) => bar.style.width)).toEqual(["100%", "25%", "0%", "0%"]);
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("bez wizyt paski maja zero szerokosci (nie dzielimy przez zero)", () => {
    const { container } = render(
      <AdsFunnelBars
        steps={[
          { key: "visit", label: "Wizyta", value: 0 },
          { key: "registration", label: "Zgloszenie", value: 3 },
        ]}
      />,
    );
    const bars = container.querySelectorAll<HTMLDivElement>("[aria-hidden='true'] > div");
    expect(Array.from(bars).map((bar) => bar.style.width)).toEqual(["0%", "0%"]);
  });

  it("same zera albo brak krokow - zdanie zamiast pustych paskow", () => {
    render(<AdsFunnelBars steps={[{ key: "visit", label: "Wizyta", value: 0 }]} />);
    expect(screen.getByText("adminEventAdsFunnel.funnel.empty")).toBeInTheDocument();
    cleanup();
    render(<AdsFunnelBars steps={[]} />);
    expect(screen.getByText("adminEventAdsFunnel.funnel.empty")).toBeInTheDocument();
  });
});
