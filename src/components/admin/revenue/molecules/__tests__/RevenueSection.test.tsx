// `RevenueSection` - region zakładki nazwany nagłówkiem `h2`, z opisem
// i akcjami; ten sam szkielet dla wszystkich zakładek huba.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { RevenueSection } from "@/components/admin/revenue/molecules/RevenueSection";

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
});

describe("RevenueSection", () => {
  it("region nazwany nagłówkiem h2 z klucza, opis i akcje w nagłówku sekcji", () => {
    render(
      <RevenueSection
        titleKey="adminRevenue.areaHealth.title"
        descriptionKey="adminRevenue.money.neverSummed"
        actions={<button type="button">Akcja</button>}
      >
        <p>Treść sekcji</p>
      </RevenueSection>,
    );

    const region = screen.getByRole("region", { name: "Kondycja obszarów" });
    expect(
      within(region).getByRole("heading", { level: 2, name: "Kondycja obszarów" }),
    ).toBeInTheDocument();
    expect(region).toHaveTextContent("Kwot w różnych walutach nie sumujemy");
    expect(within(region).getByRole("button", { name: "Akcja" })).toBeInTheDocument();
    expect(within(region).getByText("Treść sekcji")).toBeInTheDocument();
  });

  it("ramka panelu `rounded-[6px]` z obrysem - ta sama w obu motywach", () => {
    render(
      <RevenueSection titleKey="adminRevenue.areaHealth.title">
        <span />
      </RevenueSection>,
    );
    const region = screen.getByRole("region");
    expect(region.className).toContain("rounded-[6px]");
    expect(region.className).toContain("border");
    // Geometria nie zależy od motywu: żadnej klasy `dark:` zmieniającej
    // rozmiar, odstęp czy promień (AGENTS - tylko kolory).
    expect(region.className).not.toMatch(/dark:(p|m|rounded|border-\d|gap|space)/);
  });

  it("bez opisu i akcji rysuje sam nagłówek i treść", () => {
    render(
      <RevenueSection titleKey="adminRevenue.related.heading">
        <span>x</span>
      </RevenueSection>,
    );
    const region = screen.getByRole("region", { name: "Powiązane moduły" });
    expect(region.querySelectorAll("p")).toHaveLength(0);
  });

  it("wersja angielska i brak naruszeń dostępności", async () => {
    await i18n.changeLanguage("en");
    const { container } = render(
      <RevenueSection
        titleKey="adminRevenue.areaHealth.title"
        descriptionKey="adminRevenue.locked.hint"
      >
        <p>Body</p>
      </RevenueSection>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Area health" })).toBeInTheDocument();
    expect(summarize(await axeViolations(container))).toBe("");
  });
});
