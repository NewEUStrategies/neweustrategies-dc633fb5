// Atom „legenda planu sali" - każdy znak stanu jest OPISANY SŁOWEM.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW. Sześć znaków (wolne, zajęte,
// rezerwacja, blokada, dostępność, zaznaczenie) ma po jednym podpisie,
// kategorie dochodzą po nich z kolorem, a sekcja jest nazwana własnym
// nagłówkiem - bez tego stan miejsca niesie sam kształt, bez słowa.
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-event-seating", () => ({ ensureSeatingI18n: () => undefined }));

import { SeatMapLegend } from "@/components/admin/events/atoms/SeatMapLegend";

describe("SeatMapLegend", () => {
  it("podpisuje sześć znaków stanu, a potem kategorie z ich kolorem", () => {
    render(
      <SeatMapLegend
        categories={[
          { id: "c1", name: "VIP", color: "#112233" },
          { id: "c2", name: "Prasa", color: "#445566" },
        ]}
      />,
    );

    const sekcja = screen.getByRole("region", { name: "adminEventSeating.legend.title" });
    const pozycje = within(sekcja).getAllByRole("listitem");
    expect(pozycje.map((li) => li.textContent)).toEqual([
      "adminEventSeating.legend.available",
      "adminEventSeating.legend.occupied",
      "adminEventSeating.legend.held",
      "adminEventSeating.legend.blocked",
      "adminEventSeating.legend.accessible",
      "adminEventSeating.legend.selected",
      "VIP",
      "Prasa",
    ]);
    const kropka = pozycje[6]?.querySelector("span") as HTMLElement;
    expect(kropka.style.backgroundColor).toBe("#112233");
    // Znaki są zdublowane słowem, więc same ikony są ukryte przed czytnikiem.
    expect(pozycje[0]?.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(pozycje[3]?.querySelector("path")).not.toBeNull();
    expect(pozycje[4]?.querySelector("rect")).not.toBeNull();
    expect(pozycje[2]?.querySelector("circle")?.getAttribute("stroke-dasharray")).toBe("3 2");
    expect(pozycje[1]?.querySelector("circle")?.getAttribute("fill")).toBe("currentColor");
    expect(pozycje[5]?.querySelectorAll("circle")).toHaveLength(2);
  });

  it("bez kategorii zostają same znaki stanu", () => {
    render(<SeatMapLegend categories={[]} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
  });
});
