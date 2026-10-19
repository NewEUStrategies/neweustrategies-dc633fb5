// `DashboardPeriodTabs` z WŁASNĄ listą okresów (`periods` + `labelKey`
// + opcjonalny `comparisonKey`) - tak, jak używa go hub „Przychód i lejek"
// z `REVENUE_PERIODS`. Zachowanie domyślne pulpitu przypinają istniejące
// testy pulpitu (`dashboardPanels.test.tsx`); tu tylko dowód, że wariant bez
// nowych propsów rysuje dokładnie osiem okresów pulpitu z podpisem.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import "@/lib/i18n-admin-revenue";
import "@/lib/i18n-admin-revenue-shell";
import { DASHBOARD_PERIODS } from "@/lib/admin/dashboard/period";
import { REVENUE_PERIODS, type RevenuePeriod } from "@/lib/revenue/search";
import { axeViolations, summarize } from "@/test/axe";
import { DashboardPeriodTabs } from "@/components/admin/dashboard/DashboardPeriodTabs";

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
});

const LABEL_KEY: Readonly<Record<RevenuePeriod, string>> = {
  week: "adminRevenue.period.week",
  month: "adminRevenue.period.month",
  "prev-month": "adminRevenue.period.prev-month",
  quarter: "adminRevenue.period.quarter",
  "half-year": "adminRevenue.period.half-year",
  year: "adminRevenue.period.year",
  ltm: "adminRevenue.period.ltm",
  custom: "adminRevenue.period.custom",
};

const COMPARISON_KEY: Readonly<Record<RevenuePeriod, string>> = {
  week: "adminRevenue.comparison.week",
  month: "adminRevenue.comparison.month",
  "prev-month": "adminRevenue.comparison.prev-month",
  quarter: "adminRevenue.comparison.quarter",
  "half-year": "adminRevenue.comparison.half-year",
  year: "adminRevenue.comparison.year",
  ltm: "adminRevenue.comparison.ltm",
  custom: "adminRevenue.comparison.custom",
};

function buttons(): HTMLButtonElement[] {
  return within(screen.getByRole("group", { name: "Okres" })).getAllByRole("button");
}

describe("DashboardPeriodTabs - własna lista okresów", () => {
  it("rysuje okresy huba w kolejności listy, z etykietami z labelKey", () => {
    render(
      <DashboardPeriodTabs
        periods={REVENUE_PERIODS}
        value="month"
        onChange={() => {}}
        labelKey={(p) => LABEL_KEY[p]}
      />,
    );

    expect(buttons().map((b) => b.textContent)).toEqual([
      "Ten tydzień",
      "Ten miesiąc",
      "Poprzedni miesiąc",
      "Kwartał",
      "Półrocze",
      "Rok",
      "Ostatnie 12 miesięcy",
      "Własny zakres",
    ]);
  });

  it("stan wybranego okresu niesie aria-pressed, a klik oddaje okres z typu listy", () => {
    const onChange = vi.fn<(next: RevenuePeriod) => void>();
    render(
      <DashboardPeriodTabs
        periods={REVENUE_PERIODS}
        value="prev-month"
        onChange={onChange}
        labelKey={(p) => LABEL_KEY[p]}
      />,
    );

    const pressed = buttons().filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed.map((b) => b.textContent)).toEqual(["Poprzedni miesiąc"]);

    fireEvent.click(screen.getByRole("button", { name: "Ostatnie 12 miesięcy" }));
    expect(onChange).toHaveBeenCalledWith("ltm");
  });

  it("bez comparisonKey (albo gdy zwraca null) nie ma podpisu okresu odniesienia", () => {
    const { container, rerender } = render(
      <DashboardPeriodTabs
        periods={REVENUE_PERIODS}
        value="ltm"
        onChange={() => {}}
        labelKey={(p) => LABEL_KEY[p]}
      />,
    );
    expect(container.querySelectorAll("p")).toHaveLength(0);

    rerender(
      <DashboardPeriodTabs
        periods={REVENUE_PERIODS}
        value="ltm"
        onChange={() => {}}
        labelKey={(p) => LABEL_KEY[p]}
        comparisonKey={() => null}
      />,
    );
    expect(container.querySelectorAll("p")).toHaveLength(0);
  });

  it("comparisonKey daje podpis dla bieżącego okresu", () => {
    render(
      <DashboardPeriodTabs
        periods={REVENUE_PERIODS}
        value="ltm"
        onChange={() => {}}
        labelKey={(p) => LABEL_KEY[p]}
        comparisonKey={(p) => COMPARISON_KEY[p]}
      />,
    );
    expect(screen.getByText("wobec 12 pełnych miesięcy wcześniej")).toBeInTheDocument();
  });

  it("bez nowych propsów: osiem okresów pulpitu i jego podpis (zachowanie bez zmian)", () => {
    render(<DashboardPeriodTabs value="month" onChange={() => {}} />);

    expect(buttons()).toHaveLength(DASHBOARD_PERIODS.length);
    expect(screen.getByRole("button", { name: "Ten miesiąc" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("wobec poprzedniego miesiąca do tego samego dnia")).toBeInTheDocument();
  });

  it("wersja angielska i brak naruszeń dostępności", async () => {
    await i18n.changeLanguage("en");
    const { container } = render(
      <DashboardPeriodTabs
        periods={REVENUE_PERIODS}
        value="custom"
        onChange={() => {}}
        labelKey={(p) => LABEL_KEY[p]}
        comparisonKey={(p) => COMPARISON_KEY[p]}
      />,
    );

    expect(screen.getByRole("button", { name: "Custom range" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("vs a period of the same length just before it")).toBeInTheDocument();
    expect(summarize(await axeViolations(container))).toBe("");
  });
});
