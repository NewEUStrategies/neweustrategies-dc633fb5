// `SeverityLabel` - waga diagnozy jako ikona I słowo: trzy różne kształty,
// słowo zawsze widoczne, kolor nigdy jedynym nośnikiem (WCAG 1.4.1).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { REVENUE_SEVERITIES } from "@/lib/admin/revenue/hubTabs";
import { axeViolations, summarize } from "@/test/axe";
import { SeverityLabel } from "@/components/admin/revenue/atoms/SeverityLabel";

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
});

const PL = { critical: "Krytyczne", warning: "Ważne", info: "Informacja" } as const;
const EN = { critical: "Critical", warning: "Important", info: "Information" } as const;

describe("SeverityLabel", () => {
  it.each(REVENUE_SEVERITIES)("%s: słowo PL i dekoracyjna ikona", (severity) => {
    const { container } = render(<SeverityLabel severity={severity} />);
    const label = container.querySelector(`[data-severity="${severity}"]`);

    expect(label).toHaveTextContent(PL[severity]);
    const icon = label?.querySelector("svg");
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  it("każda waga ma INNY kształt ikony - odróżnialna bez koloru", () => {
    const shapes = REVENUE_SEVERITIES.map((severity) => {
      const { container } = render(<SeverityLabel severity={severity} />);
      const svg = container.querySelector("svg")?.innerHTML ?? "";
      cleanup();
      return svg;
    });
    expect(new Set(shapes).size).toBe(REVENUE_SEVERITIES.length);
  });

  it.each(REVENUE_SEVERITIES)("%s: słowo EN", async (severity) => {
    await i18n.changeLanguage("en");
    const { container } = render(<SeverityLabel severity={severity} />);

    expect(container).toHaveTextContent(EN[severity]);
  });

  it("nie ma naruszeń dostępności", async () => {
    const { container } = render(
      <div>
        {REVENUE_SEVERITIES.map((s) => (
          <SeverityLabel key={s} severity={s} />
        ))}
      </div>,
    );
    expect(summarize(await axeViolations(container))).toBe("");
  });
});
