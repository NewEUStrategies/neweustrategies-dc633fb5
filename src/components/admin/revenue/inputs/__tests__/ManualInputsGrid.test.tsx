// `ManualInputsGrid` i zakładka „Dane wejściowe" (S7; karta: „tylko admin,
// za długa notatka odrzucona (bez slice), współbieżność, daty YYYY-MM lokalne").
//
// CO TEN PLIK DOWODZI.
//   1. Tylko administrator: redaktor dostaje `RoleGateNotice`, a RPC danych
//      wejściowych nie jest wołane.
//   2. Miesiące LOKALNE `YYYY-MM` z `FormSelect`: okno 24 miesięcy wokół
//      bieżącego (odczyt `2025-10-01` … `2027-09-01`), domyślnie bieżący.
//   3. `new_customers_plan` to LICZBA klientów (12, nie 1200) z opisem pola;
//      kwota idzie w jednostkach drobnych waluty, udział bez waluty.
//   4. Za długa notatka: zapis NIE wychodzi, pole zostaje nietknięte (bez
//      przycięcia), komunikat mówi o limicie.
//   5. Współbieżność: token `updatedAt` w zapisie; `40001` → komunikat
//      konfliktu z TWOJĄ i AKTUALNĄ wartością.
//   6. axe bez naruszeń.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fetchInputs: vi.fn(),
  fetchOffer: vi.fn(),
  save: vi.fn(),
  auth: { roles: ["admin"] as string[], tenantId: "11111111-1111-4111-8111-111111111111" },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useHydrated: () => true,
  useSearch: () => ({}),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));
vi.mock("@/lib/revenue/finance/finance.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/revenue/finance/finance.functions")>()),
  getRevenueInputs: (...args: unknown[]) => h.fetchInputs(...args),
  getRevenueOfferMatrix: (...args: unknown[]) => h.fetchOffer(...args),
  saveRevenueInput: (...args: unknown[]) => h.save(...args),
}));

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { ManualInputsGrid } from "@/components/admin/revenue/inputs/ManualInputsGrid";
import { RevenueInputsTab } from "@/components/admin/revenue/tabs/RevenueInputsTab";
import { NOW_MS, OFFER_MATRIX, TENANT, clone } from "../../overview/__tests__/hubFixtures";

const TOKEN = "2026-10-10T08:00:00.123456+00:00";

const ROWS = [
  {
    id: "in-1",
    periodMonth: "2026-10-01",
    kind: "mrr_plan",
    segment: "all",
    currency: "PLN",
    amountMinor: 1_000_000,
    ratio: null,
    note: null,
    updatedAt: TOKEN,
    updatedBy: null,
  },
] as const;

function renderUi(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW_MS);
  h.fetchInputs.mockReset().mockResolvedValue({
    state: "ready",
    data: { fromMonth: "2025-10-01", toMonth: "2027-09-01", rows: clone(ROWS) },
  });
  h.fetchOffer.mockReset().mockResolvedValue({ state: "ready", data: clone(OFFER_MATRIX) });
  h.save.mockReset().mockResolvedValue({
    state: "saved",
    result: { op: "update", row: null },
  });
  h.auth = { roles: ["admin"], tenantId: TENANT };
  await i18n.changeLanguage("pl");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function renderGrid() {
  const view = renderUi(<ManualInputsGrid tenantId={TENANT} roles={["admin"]} segment={null} />);
  await screen.findByRole("table");
  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: "Waluta danych" })).toHaveTextContent("PLN"),
  );
  return view;
}

function row(kindLabel: string): HTMLElement {
  return screen.getByRole("rowheader", { name: new RegExp(`^${kindLabel}`) })
    .parentElement as HTMLElement;
}

describe("Dane wejściowe - rola", () => {
  it("redaktor: RoleGateNotice, bez wywołania RPC danych wejściowych", async () => {
    h.auth = { roles: ["editor"], tenantId: TENANT };
    renderUi(<RevenueInputsTab />);
    const tab = screen.getByTestId("revenue-tab-inputs");
    expect(within(tab).getByTestId("revenue-role-gate")).toHaveAttribute(
      "data-required-role",
      "admin",
    );
    await act(async () => undefined);
    expect(h.fetchInputs).not.toHaveBeenCalled();
  });

  it("administrator: zakładka montuje siatkę (h2), bez stanu „w przygotowaniu”", async () => {
    renderUi(<RevenueInputsTab />);
    const tab = screen.getByTestId("revenue-tab-inputs");
    expect(
      await within(tab).findByRole("heading", { level: 2, name: "Plan, koszty i marże" }),
    ).toBeVisible();
    expect(tab).not.toHaveTextContent("Ta sekcja huba jest w przygotowaniu.");
  });
});

describe("Dane wejściowe - miesiące lokalne", () => {
  it("okno 24 miesięcy wokół bieżącego; domyślnie bieżący miesiąc", async () => {
    await renderGrid();
    expect(h.fetchInputs).toHaveBeenCalledWith({
      data: { fromMonth: "2025-10-01", toMonth: "2027-09-01" },
    });
    const month = screen.getByRole("combobox", { name: "Miesiąc" });
    expect(month).toHaveTextContent("październik 2026");
    expect(screen.getByRole("table")).toHaveAccessibleName(
      "Dane wejściowe na październik 2026 - segment: Wszystkie segmenty",
    );
  });
});

describe("Dane wejściowe - zapis", () => {
  it("kwota w jednostkach drobnych z tokenem współbieżności", async () => {
    await renderGrid();
    const mrr = row("Plan MRR");
    const input = within(mrr).getByRole("textbox", { name: "Plan MRR: Kwota w PLN" });
    expect(input).toHaveValue("10000,00");
    fireEvent.change(input, { target: { value: "12 500,50" } });
    fireEvent.click(within(mrr).getByRole("button", { name: "Zapisz" }));
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1));
    expect(h.save.mock.calls[0]?.[0]).toEqual({
      data: {
        periodMonth: "2026-10-01",
        kind: "mrr_plan",
        segment: "all",
        currency: "PLN",
        amountMinor: 1_250_050,
        ratio: null,
        note: null,
        expectedUpdatedAt: TOKEN,
      },
    });
    expect(await within(mrr).findByText("Zapisano.")).toBeVisible();
  });

  it("plan nowych klientów to LICZBA (12, nie 1200) z opisem pola", async () => {
    await renderGrid();
    const plan = row("Plan nowych klientów");
    expect(within(plan).getByText("Liczba klientów, nie kwota.")).toBeVisible();
    const input = within(plan).getByRole("textbox", {
      name: "Plan nowych klientów: Liczba klientów",
    });
    expect(input).toHaveAccessibleDescription("Liczba klientów, nie kwota.");
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.click(within(plan).getByRole("button", { name: "Zapisz" }));
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1));
    expect(h.save.mock.calls[0]?.[0]).toMatchObject({
      data: { kind: "new_customers_plan", amountMinor: 12, currency: "PLN", ratio: null },
    });
  });

  it("udział bez waluty: 35 % = 0,35", async () => {
    await renderGrid();
    const margin = row("Marża brutto");
    fireEvent.change(
      within(margin).getByRole("textbox", { name: "Marża brutto: Udział w procentach" }),
      { target: { value: "35" } },
    );
    fireEvent.click(within(margin).getByRole("button", { name: "Zapisz" }));
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1));
    expect(h.save.mock.calls[0]?.[0]).toMatchObject({
      data: { kind: "gross_margin_pct", ratio: 0.35, amountMinor: null, currency: null },
    });
  });

  it("wartość spoza zakresu: komunikat, zapis nie wychodzi", async () => {
    await renderGrid();
    const cogs = row("Koszt własny sprzedaży");
    fireEvent.change(within(cogs).getByRole("textbox", { name: /Koszt własny sprzedaży: Kwota/ }), {
      target: { value: "-5" },
    });
    fireEvent.click(within(cogs).getByRole("button", { name: "Zapisz" }));
    expect(within(cogs).getByRole("alert")).toHaveTextContent("Wpisz kwotę nieujemną");
    expect(h.save).not.toHaveBeenCalled();
  });

  it("za długa notatka: odrzucona komunikatem, BEZ przycięcia pola", async () => {
    await renderGrid();
    const mrr = row("Plan MRR");
    const note = within(mrr).getByRole("textbox", { name: "Notatka do: Plan MRR" });
    const long = "x".repeat(501);
    fireEvent.change(note, { target: { value: long } });
    expect(note).toHaveValue(long);
    expect(note).toHaveAttribute("aria-invalid", "true");
    expect(within(mrr).getByText("501 z 500 znaków")).toBeVisible();
    fireEvent.click(within(mrr).getByRole("button", { name: "Zapisz" }));
    expect(within(mrr).getByRole("alert")).toHaveTextContent(
      "Notatka może mieć najwyżej 500 znaków.",
    );
    expect(h.save).not.toHaveBeenCalled();
    expect(note).toHaveValue(long);
  });

  it("konflikt 40001: komunikat z TWOJĄ i AKTUALNĄ wartością", async () => {
    h.save.mockResolvedValue({ state: "conflict" });
    await renderGrid();
    // Druga karta zapisała 11 000 zł - odświeżenie po konflikcie pokaże ją.
    h.fetchInputs.mockResolvedValue({
      state: "ready",
      data: {
        fromMonth: "2025-10-01",
        toMonth: "2027-09-01",
        rows: [
          {
            ...(clone(ROWS[0]) as object),
            amountMinor: 1_100_000,
            updatedAt: "2026-10-12T09:00:00+00:00",
          },
        ],
      },
    });
    const mrr = row("Plan MRR");
    fireEvent.change(within(mrr).getByRole("textbox", { name: "Plan MRR: Kwota w PLN" }), {
      target: { value: "13000" },
    });
    fireEvent.click(within(mrr).getByRole("button", { name: "Zapisz" }));
    const conflict = await screen.findByTestId("input-conflict");
    expect(conflict).toHaveTextContent("Ktoś zmienił tę wartość w międzyczasie.");
    expect(conflict).toHaveTextContent("Twoja wartość: 13000");
    await waitFor(() => expect(conflict).toHaveTextContent("Aktualna wartość: 11000,00"));
  });

  it("nie ma naruszeń dostępności", async () => {
    const { container } = await renderGrid();
    expect(summarize(await axeViolations(container))).toBe("");
  });
});
