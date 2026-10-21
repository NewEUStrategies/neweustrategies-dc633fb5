// `MrrBridgeCard` - most MRR per waluta w wariantach `full` i `compact`
// (S7, SPEC §6.2; karta S7: „start + Σ = end w stopce, rozjazd > 0,5 % =
// baner").
//
// CO TEN PLIK DOWODZI.
//   1. Stopka każdej waluty pokazuje sumę kontrolną „początek + ruchy =
//      koniec"; waluta, której most się nie domyka (> 0,5 %), dostaje baner
//      `role="alert"` z kwotą rozjazdu, a domknięta - zdanie „most się domyka".
//   2. Waluty NIGDY nie są sumowane - każda ma własny wodospad i stopkę.
//   3. `full` i `compact` czytają TEN SAM klucz - dwa warianty w jednym cache
//      to jedno żądanie.
//   4. Redaktor dostaje `LockedMetricTile`, a RPC finansowe nie jest wołane.
//   5. Stany karty: odmowa, brak funkcji, okno sprzed księgi, MFA; axe czysty.
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ fetchBridge: vi.fn() }));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
vi.mock("@/lib/revenue/finance/finance.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/revenue/finance/finance.functions")>()),
  getRevenueMrrBridge: (...args: unknown[]) => h.fetchBridge(...args),
}));
// Rama wykresu ma własne testy (silnik, eksport, tabela danych); tu liczy się
// to, CO karta jej podaje: rodzaj, kroki, wartości i stopka.
vi.mock("@/components/admin/analytics/ChartCard", () => ({
  ChartCard: (props: {
    title: string;
    config: { kind: string; categories: string[]; series: { values: (number | null)[] }[] };
    footer?: ReactNode;
  }) => (
    <figure
      data-testid="bridge-chart"
      data-kind={props.config.kind}
      data-categories={props.config.categories.join("|")}
      data-values={props.config.series[0]?.values.join("|")}
    >
      <figcaption>{props.title}</figcaption>
      {props.footer}
    </figure>
  ),
}));

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { MrrBridgeCard } from "@/components/admin/revenue/mrr/MrrBridgeCard";
import { MRR_BRIDGE, TENANT, clone, testRange } from "../../overview/__tests__/hubFixtures";

function renderCards(ui: ReactNode, client?: QueryClient) {
  const queryClient = client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
    queryClient,
  };
}

beforeEach(async () => {
  h.fetchBridge.mockReset();
  h.fetchBridge.mockResolvedValue({ state: "ready", data: clone(MRR_BRIDGE) });
  await i18n.changeLanguage("pl");
});

afterEach(() => cleanup());

describe("MrrBridgeCard - wariant pełny", () => {
  it("wodospad per waluta: początek, ruchy, koniec - w jednostkach głównych", async () => {
    renderCards(
      <MrrBridgeCard tenantId={TENANT} roles={["admin"]} range={testRange()} segment={null} />,
    );
    const charts = await screen.findAllByTestId("bridge-chart");
    expect(charts).toHaveLength(2);
    const pln = charts[0] as HTMLElement;
    expect(pln).toHaveAttribute("data-kind", "waterfall");
    expect(pln.getAttribute("data-categories")).toBe(
      "MRR na początku|Nowe|Rozszerzenia|Reaktywacje|Zmniejszenia|Odejścia|MRR na końcu",
    );
    expect(pln.getAttribute("data-values")).toBe("10000|2000|500|100|-200|-400|12000");
    expect(within(pln).getByText("Most MRR · PLN")).toBeInTheDocument();
  });

  it("stopka: początek + ruchy = koniec; most domknięty bez baneru", async () => {
    renderCards(
      <MrrBridgeCard tenantId={TENANT} roles={["admin"]} range={testRange()} segment={null} />,
    );
    const pln = (await screen.findAllByTestId("bridge-chart"))[0] as HTMLElement;
    const equation = within(pln).getByText(/^Początek /);
    expect(equation.textContent?.replace(/\s/g, " ")).toMatch(
      /Początek 10 000,00 zł \+ ruchy 2000,00 zł = koniec 12 000,00 zł/,
    );
    expect(within(pln).getByText("Most się domyka (początek + ruchy = koniec).")).toBeVisible();
    expect(within(pln).queryByRole("alert")).toBeNull();
  });

  it("rozjazd > 0,5 % w jednej walucie = baner z kwotą rozjazdu tej waluty", async () => {
    renderCards(
      <MrrBridgeCard tenantId={TENANT} roles={["admin"]} range={testRange()} segment={null} />,
    );
    const eur = (await screen.findAllByTestId("bridge-chart"))[1] as HTMLElement;
    const alert = within(eur).getByRole("alert");
    expect(alert.textContent?.replace(/\s/g, " ")).toMatch(/różnica 100,00 € przekracza 0,5 %/);
    expect(eur.closest("[data-currency]")).toHaveAttribute("data-currency", "EUR");
  });

  it("waluty nie są sumowane - nigdzie nie ma kwoty łącznej", async () => {
    const { container } = renderCards(
      <MrrBridgeCard tenantId={TENANT} roles={["admin"]} range={testRange()} segment={null} />,
    );
    await screen.findAllByTestId("bridge-chart");
    // 12 000 zł + 1 200 € to nie jest żadna kwota - 13 200 nie może się pojawić.
    expect(container.textContent?.replace(/\s/g, "")).not.toContain("13200");
  });
});

describe("MrrBridgeCard - wariant zwarty i wspólny klucz", () => {
  it("compact: linia na walutę z sumą kontrolną i odnośnikiem do pełnego mostu", async () => {
    renderCards(
      <MrrBridgeCard
        tenantId={TENANT}
        roles={["admin"]}
        range={testRange()}
        segment="all"
        variant="compact"
      />,
    );
    const card = await screen.findByTestId("mrr-bridge");
    await within(card).findAllByText(/^Początek /);
    expect(card).toHaveAttribute("data-variant", "compact");
    expect(within(card).queryByTestId("bridge-chart")).toBeNull();
    expect(within(card).getByRole("alert").textContent).toContain("0,5 %");
    expect(within(card).getByRole("link", { name: "Pełny most" })).toHaveAttribute(
      "href",
      "/admin/revenue/mrr",
    );
  });

  it("full i compact w jednym cache = jedno żądanie (ten sam klucz; segment all = brak)", async () => {
    renderCards(
      <>
        <MrrBridgeCard tenantId={TENANT} roles={["admin"]} range={testRange()} segment={null} />
        <MrrBridgeCard
          tenantId={TENANT}
          roles={["admin"]}
          range={testRange()}
          segment="all"
          variant="compact"
        />
      </>,
    );
    await waitFor(() => expect(screen.getAllByText(/^Początek /).length).toBe(4));
    expect(h.fetchBridge).toHaveBeenCalledTimes(1);
  });
});

describe("MrrBridgeCard - role i stany", () => {
  it("redaktor: kafel zablokowany, RPC finansowe NIE jest wołane", async () => {
    renderCards(
      <MrrBridgeCard tenantId={TENANT} roles={["editor"]} range={testRange()} segment={null} />,
    );
    const card = screen.getByTestId("mrr-bridge");
    expect(card).toHaveAttribute("data-locked", "admin_only");
    expect(within(card).getByRole("group", { name: "Most MRR" })).toBeInTheDocument();
    expect(within(card).getByText("Kwoty widzi wyłącznie administrator")).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.fetchBridge).not.toHaveBeenCalled();
  });

  it("bez najemcy: stan karty, bez zapytania", async () => {
    renderCards(
      <MrrBridgeCard tenantId={null} roles={["admin"]} range={testRange()} segment={null} />,
    );
    expect(screen.getByText("Wybierz obszar roboczy, żeby zobaczyć dane huba.")).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.fetchBridge).not.toHaveBeenCalled();
  });

  it.each([
    [{ state: "forbidden" }, "Kwoty przychodu widzą wyłącznie administratorzy."],
    [{ state: "unavailable" }, "Dane finansowe pojawią się po zakończeniu wdrożenia."],
  ])("odczyt %o = stan karty, nie toast", async (read, text) => {
    h.fetchBridge.mockResolvedValue(read);
    renderCards(
      <MrrBridgeCard tenantId={TENANT} roles={["admin"]} range={testRange()} segment={null} />,
    );
    expect(await screen.findByText(text)).toBeVisible();
  });

  it("okno sprzed księgi: zdanie z datą pierwszego ruchu, bez zera", async () => {
    h.fetchBridge.mockResolvedValue({
      state: "ready",
      data: { ...(clone(MRR_BRIDGE) as object), currencies: null, dataSince: "2026-03-01" },
    });
    renderCards(
      <MrrBridgeCard tenantId={TENANT} roles={["admin"]} range={testRange()} segment={null} />,
    );
    expect(await screen.findByText(/pierwsze ruchy zapisano 1 marca 2026/)).toBeVisible();
  });

  it("MFA bez aal2: powiadomienie MFA zamiast liczb", async () => {
    h.fetchBridge.mockRejectedValue(
      new Error("Forbidden: mfa_required - verify your second factor"),
    );
    renderCards(
      <MrrBridgeCard tenantId={TENANT} roles={["admin"]} range={testRange()} segment={null} />,
    );
    expect(await screen.findByTestId("revenue-mfa-required")).toBeInTheDocument();
  });

  it.each(["full", "compact"] as const)(
    "nie ma naruszeń dostępności: administrator, wariant %s",
    async (variant) => {
      const { container } = renderCards(
        <MrrBridgeCard
          tenantId={TENANT}
          roles={["admin"]}
          range={testRange()}
          segment={null}
          variant={variant}
        />,
      );
      await waitFor(() => expect(screen.getAllByText(/^Początek /).length).toBe(2));
      expect(summarize(await axeViolations(container))).toBe("");
    },
  );

  it("nie ma naruszeń dostępności: redaktor (kafel zablokowany)", async () => {
    const { container } = renderCards(
      <MrrBridgeCard tenantId={TENANT} roles={["editor"]} range={testRange()} segment={null} />,
    );
    expect(summarize(await axeViolations(container))).toBe("");
  });

  it("po angielsku: stopka i baner w języku panelu", async () => {
    await i18n.changeLanguage("en");
    renderCards(
      <MrrBridgeCard tenantId={TENANT} roles={["admin"]} range={testRange()} segment={null} />,
    );
    expect((await screen.findAllByText(/^Opening /)).length).toBe(2);
    expect(screen.getByText("MRR bridge · EUR")).toBeInTheDocument();
  });
});
