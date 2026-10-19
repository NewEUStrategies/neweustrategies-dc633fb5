// `AreaHealthList` - kondycja obszarów: wynik na skali `brandAuditScore`,
// liczby krytycznych i ważnych słowem z ikoną, `null` = brak danych (nie 100).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { areaHealthScore } from "@/lib/admin/revenue/hubTabs";
import { axeViolations, summarize } from "@/test/axe";
import {
  AreaHealthList,
  type AreaHealthGroup,
} from "@/components/admin/revenue/molecules/AreaHealthList";

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
});

const GROUPS: AreaHealthGroup[] = [
  {
    group: "checkout",
    score: areaHealthScore({ critical: 1, warning: 2 }),
    counts: { critical: 1, warning: 2, info: 1 },
  },
  {
    group: "coupons",
    score: areaHealthScore({ critical: 0, warning: 0 }),
    counts: { critical: 0, warning: 0 },
  },
  { group: "journeys", score: null, counts: { critical: 0, warning: 0 } },
];

function row(area: string): HTMLElement {
  const li = document.querySelector<HTMLElement>(`li[data-area="${area}"]`);
  if (!li) throw new Error(`brak wiersza ${area}`);
  return li;
}

describe("AreaHealthList", () => {
  it("lista pod nagłówkiem „Kondycja obszarów” z wierszem na obszar", () => {
    render(<AreaHealthList groups={GROUPS} />);

    const region = screen.getByRole("region", { name: "Kondycja obszarów" });
    expect(within(region).getAllByRole("listitem")).toHaveLength(3);
  });

  it("wynik ze skali brandAuditScore i wagi słowem: 1 krytyczna + 2 ważne = 66", () => {
    render(<AreaHealthList groups={GROUPS} />);

    const checkout = row("checkout");
    expect(checkout).toHaveTextContent("Kasa");
    expect(checkout).toHaveTextContent("Wynik 66 na 100");
    expect(
      within(checkout).getByText("Krytyczne").closest("span")?.parentElement,
    ).toHaveTextContent("1");
    expect(within(checkout).getByText("Ważne").closest("span")?.parentElement).toHaveTextContent(
      "2",
    );
    expect(checkout).toHaveTextContent("4 problemy");
  });

  it("obszar bez diagnoz ma 100 i nie pokazuje pustych wag", () => {
    render(<AreaHealthList groups={GROUPS} />);

    const coupons = row("coupons");
    expect(coupons).toHaveTextContent("Wynik 100 na 100");
    expect(within(coupons).queryByText("Krytyczne")).toBeNull();
    // Zero po polsku odmienia się jak „wiele": „0 problemów".
    expect(coupons).toHaveTextContent("0 problemów");
  });

  it("null = brak danych, a NIE wynik 100 (nieznany obszar nie jest zdrowy)", () => {
    render(<AreaHealthList groups={GROUPS} />);

    const journeys = row("journeys");
    expect(journeys).toHaveTextContent("brak danych");
    expect(journeys).not.toHaveTextContent("100");
  });

  it("wersja angielska", async () => {
    await i18n.changeLanguage("en");
    render(<AreaHealthList groups={GROUPS} />);

    expect(screen.getByRole("region", { name: "Area health" })).toBeInTheDocument();
    expect(row("checkout")).toHaveTextContent("Score 66 out of 100");
    expect(row("checkout")).toHaveTextContent("4 issues");
    expect(row("journeys")).toHaveTextContent("no data");
  });

  it("nie ma naruszeń dostępności", async () => {
    const { container } = render(<AreaHealthList groups={GROUPS} />);
    expect(summarize(await axeViolations(container))).toBe("");
  });
});
