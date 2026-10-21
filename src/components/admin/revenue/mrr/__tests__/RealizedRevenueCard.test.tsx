// `RealizedRevenueCard` i `RevenueReconciliationCard` - przychód zrealizowany
// per kategoria i waluta oraz zgodność dokumentów z zamówieniami (S7, SPEC
// §2.2 `mrr`; karta S7: „kwoty per waluta, nigdy suma; brak liczby = „-”
// z powodem").
//
// CO TEN PLIK DOWODZI.
//   1. Tabela ma `caption` i nagłówki `scope`, grupę na walutę i wiersz
//      „Razem w <waluta>" z `totals` serwera - żadna komórka nie sumuje walut.
//   2. Dokumenty bez rozpoznanego środowiska (Z-S2-07) - zdanie z liczbą
//      i odnośnik do księgi monetyzacji.
//   3. Zgodność: werdykt rejestru S6 per waluta (EUR - zamówienia ponad
//      księgą = „Relacja odwrócona"), odnośniki do modułów-właścicieli.
//   4. Obie karty czytają JEDEN klucz `revenueRealizedQueryOptions` - jedno
//      żądanie.
//   5. Redaktor: `LockedMetricTile`, bez wywołania RPC; stany karty (odmowa,
//      wdrożenie w drodze, brak sprzedaży); axe bez naruszeń.
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ fetchRealized: vi.fn() }));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
vi.mock("@/lib/revenue/finance/finance.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/revenue/finance/finance.functions")>()),
  getRevenueRealized: (...args: unknown[]) => h.fetchRealized(...args),
}));

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { RealizedRevenueCard } from "@/components/admin/revenue/mrr/RealizedRevenueCard";
import { RevenueReconciliationCard } from "@/components/admin/revenue/mrr/RevenueReconciliationCard";
import { TENANT, clone, testRange } from "../../overview/__tests__/hubFixtures";
import { REALIZED } from "./financeFixtures";

function renderCards(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
    queryClient,
  };
}

const RANGE = testRange("prev-month");

beforeEach(async () => {
  h.fetchRealized.mockReset().mockResolvedValue({ state: "ready", data: clone(REALIZED) });
  await i18n.changeLanguage("pl");
});

afterEach(() => cleanup());

/** Tekst bez twardych spacji - `Intl` wstawia U+00A0 między liczbę a walutę. */
function text(el: Element | null): string {
  return (el?.textContent ?? "").replace(/\s/g, " ");
}

describe("RealizedRevenueCard - per kategoria i waluta", () => {
  it("tabela z caption i scope, grupa na walutę, razem per waluta", async () => {
    renderCards(<RealizedRevenueCard tenantId={TENANT} roles={["admin"]} range={RANGE} />);
    const table = await screen.findByRole("table", {
      name: "Przychód zrealizowany według kategorii i waluty",
    });
    const groups = table.querySelectorAll("tbody[data-currency]");
    expect([...groups].map((g) => g.getAttribute("data-currency"))).toEqual(["PLN", "EUR"]);
    // Kolejność kategorii z rejestru (subskrypcje przed wydarzeniami).
    expect(
      [...(groups[0] as Element).querySelectorAll("tr[data-category]")].map((r) =>
        r.getAttribute("data-category"),
      ),
    ).toEqual(["subscription", "event"]);
    expect(within(table).getByRole("rowheader", { name: "Razem w PLN" })).toBeVisible();
    expect(within(table).getByRole("rowheader", { name: "Razem w EUR" })).toBeVisible();
    expect(text(table.querySelector('tr[data-total="PLN"]'))).toContain("11 800,00 zł");
    expect(text(table.querySelector('tr[data-total="EUR"]'))).toContain("500,00 €");
    for (const header of within(table).getAllByRole("columnheader")) {
      expect(header).toHaveAttribute("scope", "col");
    }
  });

  it("nigdy suma walut: nie ma kwoty PLN + EUR ani wiersza ogółem", async () => {
    renderCards(<RealizedRevenueCard tenantId={TENANT} roles={["admin"]} range={RANGE} />);
    const table = await screen.findByTestId("realized-table");
    // 1 180 000 + 50 000 groszy/centów jako jedna liczba - nigdzie.
    expect(text(table)).not.toMatch(/12\s?300,00/);
    expect(table.querySelectorAll("tr[data-total]")).toHaveLength(2);
  });

  it("dokumenty bez środowiska: liczba i odnośnik do księgi monetyzacji", async () => {
    renderCards(<RealizedRevenueCard tenantId={TENANT} roles={["admin"]} range={RANGE} />);
    const note = await screen.findByTestId("realized-unknown-environment");
    expect(note).toHaveTextContent("Dokumenty bez rozpoznanego środowiska (poza przychodem): 3");
    expect(within(note).getByRole("link", { name: "Otwórz: Księga monetyzacji" })).toHaveAttribute(
      "href",
      "/admin/monetization-ledger",
    );
  });

  it("brak opłaconych dokumentów: zdanie zamiast pustej tabeli", async () => {
    h.fetchRealized.mockResolvedValue({
      state: "ready",
      data: {
        ...(clone(REALIZED) as object),
        categories: [],
        totals: [],
        orders: [],
        unknownEnvironmentDocuments: 0,
      },
    });
    renderCards(<RealizedRevenueCard tenantId={TENANT} roles={["admin"]} range={RANGE} />);
    expect(
      await screen.findByText("W tym okresie nie opłacono żadnego dokumentu sprzedaży."),
    ).toBeVisible();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it.each([
    ["forbidden", "Kwoty przychodu widzą wyłącznie administratorzy."],
    ["unavailable", "Dane finansowe pojawią się po zakończeniu wdrożenia."],
  ] as const)("stan %s to zdanie w karcie, nie toast", async (state, sentence) => {
    h.fetchRealized.mockResolvedValue({ state });
    renderCards(<RealizedRevenueCard tenantId={TENANT} roles={["admin"]} range={RANGE} />);
    expect(await screen.findByText(sentence)).toBeVisible();
  });

  it("redaktor: kafel zablokowany, RPC niewołane", async () => {
    renderCards(<RealizedRevenueCard tenantId={TENANT} roles={["editor"]} range={RANGE} />);
    expect(screen.getByTestId("realized-revenue")).toHaveAttribute("data-locked", "admin_only");
    expect(screen.getByText("Kwoty widzi wyłącznie administrator")).toBeVisible();
    await act(async () => undefined);
    expect(h.fetchRealized).not.toHaveBeenCalled();
  });
});

describe("RevenueReconciliationCard - zgodność źródeł", () => {
  it("werdykt per waluta: zamówienia ponad księgą = relacja odwrócona", async () => {
    renderCards(<RevenueReconciliationCard tenantId={TENANT} roles={["admin"]} range={RANGE} />);
    const table = await screen.findByRole("table", {
      name: "Dokumenty sprzedaży i opłacone zamówienia według waluty",
    });
    const eur = table.querySelector('tr[data-currency="EUR"]') as HTMLElement;
    expect(eur).toHaveAttribute("data-verdict", "order_inverted");
    expect(within(eur).getByText("Relacja odwrócona")).toBeVisible();
    expect(text(eur)).toContain("-200,00 €");
    const pln = table.querySelector('tr[data-currency="PLN"]') as HTMLElement;
    expect(["aligned", "expected_drift"]).toContain(pln.getAttribute("data-verdict"));
    // Polska norma: liczby czterocyfrowe bez separatora tysięcy.
    expect(text(pln)).toContain("2800,00 zł");
  });

  it("odnośniki do modułów-właścicieli: księga i zamówienia rozliczeń", async () => {
    renderCards(<RevenueReconciliationCard tenantId={TENANT} roles={["admin"]} range={RANGE} />);
    expect(await screen.findByRole("link", { name: "Otwórz: Księga monetyzacji" })).toHaveAttribute(
      "href",
      "/admin/monetization-ledger",
    );
    expect(screen.getByRole("link", { name: "Otwórz: Rozliczenia - zamówienia" })).toHaveAttribute(
      "href",
      "/admin/billing",
    );
  });

  it("obie karty to jedno żądanie (ten sam klucz)", async () => {
    renderCards(
      <>
        <RealizedRevenueCard tenantId={TENANT} roles={["admin"]} range={RANGE} />
        <RevenueReconciliationCard tenantId={TENANT} roles={["admin"]} range={RANGE} />
      </>,
    );
    await screen.findByTestId("realized-table");
    await screen.findByTestId("reconciliation-table");
    expect(h.fetchRealized).toHaveBeenCalledTimes(1);
  });

  it("bez najemcy: stan karty, bez zapytania", async () => {
    renderCards(<RevenueReconciliationCard tenantId={null} roles={["admin"]} range={RANGE} />);
    expect(screen.getByText("Wybierz obszar roboczy, żeby zobaczyć dane huba.")).toBeVisible();
    await act(async () => undefined);
    expect(h.fetchRealized).not.toHaveBeenCalled();
  });

  it("obie karty po angielsku i bez naruszeń dostępności", async () => {
    await i18n.changeLanguage("en");
    const { container } = renderCards(
      <>
        <RealizedRevenueCard tenantId={TENANT} roles={["admin"]} range={RANGE} />
        <RevenueReconciliationCard tenantId={TENANT} roles={["admin"]} range={RANGE} />
      </>,
    );
    expect(await screen.findByRole("rowheader", { name: "Total in PLN" })).toBeVisible();
    await screen.findByRole("table", { name: "Sales documents and paid orders by currency" });
    expect(summarize(await axeViolations(container))).toBe("");
  });
});
