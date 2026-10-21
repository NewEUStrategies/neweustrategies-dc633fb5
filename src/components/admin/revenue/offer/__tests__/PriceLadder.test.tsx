// `PriceLadder` - drabina cen per waluta (S7, SPEC §2.2 `offer`).
//
// CO TEN PLIK DOWODZI.
//   1. Każda waluta ma własną tabelę (`caption` z kodem) - kwot w różnych
//      walutach nie ma w jednej tabeli ani w sumie.
//   2. W walucie: od najniższej warstwy, potem okres (miesiąc przed rokiem).
//   3. Status sprzedaży i problemy planu słowami S2; liczba płacących dla
//      redaktora to „-" z powodem, nie zero.
//   4. axe bez naruszeń.
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ fetchOffer: vi.fn() }));

vi.mock("@/lib/revenue/finance/finance.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/revenue/finance/finance.functions")>()),
  getRevenueOfferMatrix: (...args: unknown[]) => h.fetchOffer(...args),
}));

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { PriceLadder } from "@/components/admin/revenue/offer/PriceLadder";
import { OFFER_MATRIX, TENANT, clone } from "../../overview/__tests__/hubFixtures";
import { renderWithClient } from "./offerTestKit";

beforeEach(async () => {
  h.fetchOffer.mockReset().mockResolvedValue({ state: "ready", data: clone(OFFER_MATRIX) });
  await i18n.changeLanguage("pl");
});

afterEach(() => cleanup());

async function renderLadder() {
  const view = renderWithClient(<PriceLadder tenantId={TENANT} />);
  await screen.findByRole("table", { name: "Plany w walucie EUR" });
  return view;
}

describe("PriceLadder", () => {
  it("osobna tabela na walutę - bez sumy walut", async () => {
    await renderLadder();
    const tables = screen.getAllByRole("table");
    expect(tables.map((t) => t.querySelector("caption")?.textContent)).toEqual([
      "Plany w walucie EUR",
      "Plany w walucie PLN",
    ]);
    const pln = screen.getByRole("table", { name: "Plany w walucie PLN" });
    expect(pln).not.toHaveTextContent("€");
  });

  it("w walucie: warstwa, potem okres - miesiąc przed rokiem", async () => {
    await renderLadder();
    const pln = screen.getByRole("table", { name: "Plany w walucie PLN" });
    const rows = within(pln).getAllByRole("row").slice(1);
    expect(rows.map((row) => row.getAttribute("data-plan"))).toEqual([
      "plan-plus-month",
      "plan-plus-year",
    ]);
    expect(rows[0]).toHaveTextContent("miesięcznie");
    expect(rows[1]).toHaveTextContent("rocznie");
    expect(rows[1]?.textContent).toMatch(/490,00\s?zł/);
  });

  it("status sprzedaży i problemy planu słowami S2", async () => {
    await renderLadder();
    const eur = screen.getByRole("table", { name: "Plany w walucie EUR" });
    expect(eur).toHaveTextContent("Poza sprzedażą");
    expect(eur).toHaveTextContent("Plan nie ma pary w katalogu cen");
  });

  it("redaktor: liczba płacących to „-” z powodem, nie zero", async () => {
    const offer = clone(OFFER_MATRIX) as { plans: { activeSubscriptions: number | null }[] };
    for (const plan of offer.plans) plan.activeSubscriptions = null;
    h.fetchOffer.mockResolvedValue({ state: "ready", data: offer });
    await renderLadder();
    expect(screen.getByText("Liczbę płacących widzą administratorzy.")).toBeVisible();
    const cells = [...document.querySelectorAll("tbody tr")].map(
      (row) => row.lastElementChild?.textContent,
    );
    expect(cells).toEqual(["-", "-", "-"]);
  });

  it("nie ma naruszeń dostępności", async () => {
    const { container } = await renderLadder();
    expect(summarize(await axeViolations(container))).toBe("");
  });
});
