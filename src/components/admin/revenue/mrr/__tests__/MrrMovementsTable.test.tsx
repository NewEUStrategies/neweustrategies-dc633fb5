// `MrrMovementsTable` - ruchy MRR okresu według rodzaju, powodu i waluty
// (S7, SPEC §2.2 `mrr`; karta S7: „kwoty per waluta, nigdy suma; tabela
// caption/scope").
//
// CO TEN PLIK DOWODZI.
//   1. Waluty są kolumnami (`scope="col"`), rodzaj ruchu - nagłówkiem wiersza
//      (`scope="row"`); tabela ma `caption`. Żadna komórka nie łączy walut.
//   2. Pod „Odejścia" stoją powody z liczbą ruchów (liczebniki PL).
//   3. Most czyta TEN SAM klucz co `MrrBridgeCard` - obie karty to jedno
//      żądanie mostu.
//   4. Filtr segmentu: powody nie są pobierane (księga odejść nie zna
//      segmentu), zdanie mówi, jak je zobaczyć.
//   5. Odmowa księgi odejść nie zasłania rodzajów; redaktor - kafel
//      zablokowany bez RPC; axe bez naruszeń.
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ fetchBridge: vi.fn(), fetchChurn: vi.fn() }));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
vi.mock("@/lib/revenue/finance/finance.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/revenue/finance/finance.functions")>()),
  getRevenueMrrBridge: (...args: unknown[]) => h.fetchBridge(...args),
  getRevenueChurn: (...args: unknown[]) => h.fetchChurn(...args),
}));
// Wodospad mostu ma własne testy (S7-B); tu liczy się wyłącznie współdzielony klucz.
vi.mock("@/components/admin/analytics/ChartCard", () => ({
  ChartCard: (props: { title: string; footer?: ReactNode }) => (
    <figure data-testid="chart">
      <figcaption>{props.title}</figcaption>
      {props.footer}
    </figure>
  ),
}));

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { MrrBridgeCard } from "@/components/admin/revenue/mrr/MrrBridgeCard";
import { MrrMovementsTable } from "@/components/admin/revenue/mrr/MrrMovementsTable";
import { MRR_BRIDGE, TENANT, clone, testRange } from "../../overview/__tests__/hubFixtures";
import { CHURN } from "./financeFixtures";

const RANGE = testRange("prev-month");

function renderCards(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
    queryClient,
  };
}

function text(el: Element | null): string {
  return (el?.textContent ?? "").replace(/\s/g, " ");
}

beforeEach(async () => {
  h.fetchBridge.mockReset().mockResolvedValue({ state: "ready", data: clone(MRR_BRIDGE) });
  h.fetchChurn.mockReset().mockResolvedValue({ state: "ready", data: clone(CHURN) });
  await i18n.changeLanguage("pl");
});

afterEach(() => cleanup());

describe("MrrMovementsTable - rodzaj, powód i waluta", () => {
  it("waluty jako kolumny, rodzaje jako nagłówki wierszy, caption", async () => {
    renderCards(
      <MrrMovementsTable tenantId={TENANT} roles={["admin"]} range={RANGE} segment={null} />,
    );
    const table = await screen.findByRole("table", {
      name: "Ruchy MRR w okresie według rodzaju, powodu i waluty",
    });
    const columns = within(table).getAllByRole("columnheader");
    expect(columns.map((c) => c.textContent)).toEqual(["Rodzaj ruchu", "Powód", "PLN", "EUR"]);
    for (const column of columns) expect(column).toHaveAttribute("scope", "col");
    expect(within(table).getByRole("rowheader", { name: "Nowe" })).toHaveAttribute("scope", "row");
    const fresh = table.querySelector('tr[data-kind="new"][data-reason="all"]');
    expect(text(fresh)).toContain("2000,00 zł");
    expect(text(fresh)).toContain("100,00 €");
    // Otwarcia księgi nie ma w oknie - nie ma też wiersza.
    expect(table.querySelector('tr[data-kind="opening"]')).toBeNull();
  });

  it("powody odejść pod „Odejścia” z liczbą ruchów (liczebniki)", async () => {
    renderCards(
      <MrrMovementsTable tenantId={TENANT} roles={["admin"]} range={RANGE} segment={null} />,
    );
    const table = await screen.findByTestId("mrr-movements-table");
    const canceled = await within(table).findByText("Rezygnacja");
    const row = canceled.closest("tr") as HTMLElement;
    expect(row).toHaveAttribute("data-reason", "canceled");
    expect(text(row)).toContain("3 ruchy");
    expect(text(row)).toContain("-300,00 zł");
    // Powód bez ruchu w EUR to zmierzone zero, nie kreska.
    expect(text(row)).toContain("0,00 €");
    const unpaid = table.querySelector('tr[data-reason="unpaid"]');
    expect(text(unpaid)).toContain("1 ruch");
    // Wiersz powodu powtarza rodzaj dla czytnika.
    expect(within(row).getByRole("rowheader")).toHaveTextContent("Odejścia");
  });

  it("most z tym samym kluczem co MrrBridgeCard - jedno żądanie dla obu kart", async () => {
    renderCards(
      <>
        <MrrBridgeCard tenantId={TENANT} roles={["admin"]} range={RANGE} segment={null} />
        <MrrMovementsTable tenantId={TENANT} roles={["admin"]} range={RANGE} segment="all" />
      </>,
    );
    await screen.findByTestId("mrr-movements-table");
    await screen.findAllByTestId("chart");
    expect(h.fetchBridge).toHaveBeenCalledTimes(1);
  });

  it("filtr segmentu: powody nie są pobierane, zdanie mówi dlaczego", async () => {
    renderCards(
      <MrrMovementsTable
        tenantId={TENANT}
        roles={["admin"]}
        range={RANGE}
        segment="b2b_institution"
      />,
    );
    const table = await screen.findByTestId("mrr-movements-table");
    expect(table.querySelector('tr[data-reason="canceled"]')).toBeNull();
    expect(screen.getByTestId("mrr-movements-reasons")).toHaveTextContent(
      "Powody odejść liczymy dla wszystkich segmentów",
    );
    expect(h.fetchChurn).not.toHaveBeenCalled();
    expect(h.fetchBridge.mock.calls[0]?.[0]).toMatchObject({
      data: { segment: "b2b_institution" },
    });
  });

  it("odmowa księgi odejść nie zasłania rodzajów z mostu", async () => {
    h.fetchChurn.mockResolvedValue({ state: "forbidden" });
    renderCards(
      <MrrMovementsTable tenantId={TENANT} roles={["admin"]} range={RANGE} segment={null} />,
    );
    expect(await screen.findByTestId("mrr-movements-reasons")).toHaveTextContent(
      "Rozbicia odejść na powody nie udało się teraz wczytać",
    );
    expect(screen.getByRole("rowheader", { name: "Odejścia" })).toBeVisible();
  });

  it("księga bez walut: zdanie zamiast tabeli", async () => {
    h.fetchBridge.mockResolvedValue({
      state: "ready",
      data: { ...(clone(MRR_BRIDGE) as object), currencies: [] },
    });
    h.fetchChurn.mockResolvedValue({
      state: "ready",
      data: { ...(clone(CHURN) as object), reasons: [] },
    });
    renderCards(
      <MrrMovementsTable tenantId={TENANT} roles={["admin"]} range={RANGE} segment={null} />,
    );
    expect(await screen.findByText("W tym okresie nie było ruchów MRR.")).toBeVisible();
  });

  it("redaktor: kafel zablokowany, RPC mostu i odejść niewołane", async () => {
    renderCards(
      <MrrMovementsTable tenantId={TENANT} roles={["editor"]} range={RANGE} segment={null} />,
    );
    expect(screen.getByTestId("mrr-movements")).toHaveAttribute("data-locked", "admin_only");
    await act(async () => undefined);
    expect(h.fetchBridge).not.toHaveBeenCalled();
    expect(h.fetchChurn).not.toHaveBeenCalled();
  });

  it("po angielsku i bez naruszeń dostępności", async () => {
    await i18n.changeLanguage("en");
    const { container } = renderCards(
      <MrrMovementsTable tenantId={TENANT} roles={["admin"]} range={RANGE} segment={null} />,
    );
    const table = await screen.findByRole("table", {
      name: "MRR movements in the period by kind, reason and currency",
    });
    expect(await within(table).findByText(/3 movements/)).toBeVisible();
    expect(summarize(await axeViolations(container))).toBe("");
  });
});
