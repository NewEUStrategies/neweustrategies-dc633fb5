// `ChurnReasonsCard` - powody odejść z przepływu anulowania (S7; Z-S2-04:
// „not_given poza rankingiem jako reasonNotGiven + Hint, stripe:<code> jako
// „Stripe portal: <code>”").
//
// CO TEN PLIK DOWODZI.
//   1. Ranking malejąco po liczbie odpowiedzi, z miejscem i udziałem; tabela
//      ma `caption` i nagłówki `scope`.
//   2. „Bez podanego powodu" stoi POZA rankingiem - z liczbą, etykietą
//      i wyjaśnieniem - i nie rozcieńcza udziałów powodów.
//   3. `stripe:<kod>` to „Portal Stripe: <kod>" (EN: „Stripe customer
//      portal: <kod>"), a nie surowy napis.
//   4. Karta dzieli odczyt z kartą ofert (jedno żądanie); brak powodów -
//      zdanie; redaktor - kafel zablokowany bez RPC; axe bez naruszeń.
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ fetchOffers: vi.fn() }));

vi.mock("@/lib/revenue/finance/finance.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/revenue/finance/finance.functions")>()),
  getRevenueRetentionOffers: (...args: unknown[]) => h.fetchOffers(...args),
}));

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { ChurnReasonsCard } from "@/components/admin/revenue/retention/ChurnReasonsCard";
import { RetentionOffersCard } from "@/components/admin/revenue/retention/RetentionOffersCard";
import { TENANT, clone, testRange } from "../../overview/__tests__/hubFixtures";
import { RETENTION_OFFERS } from "../../mrr/__tests__/financeFixtures";

const RANGE = testRange("prev-month");

function renderCards(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(async () => {
  h.fetchOffers.mockReset().mockResolvedValue({ state: "ready", data: clone(RETENTION_OFFERS) });
  await i18n.changeLanguage("pl");
});

afterEach(() => cleanup());

describe("ChurnReasonsCard - ranking powodów", () => {
  it("ranking malejąco z miejscem, liczbą odpowiedzi i udziałem", async () => {
    renderCards(<ChurnReasonsCard tenantId={TENANT} roles={["admin"]} range={RANGE} />);
    const table = await screen.findByRole("table", {
      name: "Powody rezygnacji podane w przepływie anulowania",
    });
    const columns = within(table).getAllByRole("columnheader");
    expect(columns.map((c) => c.textContent)).toEqual(["Miejsce", "Powód", "Odpowiedzi", "Udział"]);
    for (const column of columns) expect(column).toHaveAttribute("scope", "col");
    const reasons = within(table)
      .getAllByRole("rowheader")
      .map((r) => r.textContent);
    expect(reasons).toEqual(["Za drogo", "Portal Stripe: too_expensive", "Brak czasu"]);
    const first = within(table).getByRole("rowheader", { name: "Za drogo" }).closest("tr");
    expect(first).toHaveTextContent("1");
    expect(first).toHaveTextContent("3");
    // Udział z odpowiedzi Z POWODEM: 3 z 6, a nie 3 z 10 (z „bez powodu").
    expect(first).toHaveTextContent("50 %");
  });

  it("„Bez podanego powodu” poza rankingiem - liczba, etykieta i wyjaśnienie", async () => {
    renderCards(<ChurnReasonsCard tenantId={TENANT} roles={["admin"]} range={RANGE} />);
    const notGiven = await screen.findByTestId("churn-reasons-not-given");
    expect(notGiven).toHaveTextContent("Bez podanego powodu");
    expect(notGiven).toHaveTextContent("4");
    expect(notGiven).toHaveTextContent("Osoba wybrała „Anuluj mimo to” przed wskazaniem powodu.");
    expect(notGiven).toHaveTextContent(
      "Odpowiedzi bez podanego powodu są policzone osobno - poza rankingiem powodów.",
    );
    const table = screen.getByTestId("churn-reasons-table");
    expect(within(table).queryByText("Bez podanego powodu")).toBeNull();
    expect(within(table).queryByText(/not_given/)).toBeNull();
  });

  it("starsza funkcja z not_given w liście: nadal poza rankingiem", async () => {
    h.fetchOffers.mockResolvedValue({
      state: "ready",
      data: {
        ...(clone(RETENTION_OFFERS) as object),
        reasons: [
          { reasonId: null, reasonLabel: "not_given", responses: 9 },
          { reasonId: "a", reasonLabel: "Cena", responses: 1 },
        ],
      },
    });
    renderCards(<ChurnReasonsCard tenantId={TENANT} roles={["admin"]} range={RANGE} />);
    const table = await screen.findByTestId("churn-reasons-table");
    expect(
      within(table)
        .getAllByRole("rowheader")
        .map((r) => r.textContent),
    ).toEqual(["Cena"]);
    expect(within(table).getByRole("row", { name: /Cena/ })).toHaveTextContent("100 %");
  });

  it("brak powodów: zdanie zamiast tabeli, „bez powodu” nadal widoczne", async () => {
    h.fetchOffers.mockResolvedValue({
      state: "ready",
      data: { ...(clone(RETENTION_OFFERS) as object), reasons: [] },
    });
    renderCards(<ChurnReasonsCard tenantId={TENANT} roles={["admin"]} range={RANGE} />);
    expect(
      await screen.findByText("W tym okresie nikt nie podał powodu rezygnacji."),
    ).toBeVisible();
    expect(screen.getByTestId("churn-reasons-not-given")).toHaveTextContent("4");
  });

  it("karta powodów i karta ofert - jedno żądanie przepływu", async () => {
    renderCards(
      <>
        <RetentionOffersCard tenantId={TENANT} roles={["admin"]} range={RANGE} />
        <ChurnReasonsCard tenantId={TENANT} roles={["admin"]} range={RANGE} />
      </>,
    );
    await screen.findByTestId("churn-reasons-table");
    await screen.findByText("Skuteczność zatrzymania");
    expect(h.fetchOffers).toHaveBeenCalledTimes(1);
  });

  it("redaktor: kafel zablokowany, RPC niewołane", async () => {
    renderCards(<ChurnReasonsCard tenantId={TENANT} roles={["editor"]} range={RANGE} />);
    expect(screen.getByTestId("churn-reasons")).toHaveAttribute("data-locked", "admin_only");
    await act(async () => undefined);
    expect(h.fetchOffers).not.toHaveBeenCalled();
  });

  it("po angielsku: portal Stripe i „no reason given”; bez naruszeń dostępności", async () => {
    await i18n.changeLanguage("en");
    const { container } = renderCards(
      <ChurnReasonsCard tenantId={TENANT} roles={["admin"]} range={RANGE} />,
    );
    expect(
      await screen.findByRole("rowheader", { name: "Stripe customer portal: too_expensive" }),
    ).toBeVisible();
    expect(summarize(await axeViolations(container))).toBe("");
  });
});
