// `FunnelStageMap` - mapa lejka (S7, SPEC §2.2 `funnel`; karta S7: „przejście
// między strumieniami bez ilorazu, etap aktywacji = brak definicji; mini lejek
// w Kokpicie = ten sam organizm i klucz").
//
// CO TEN PLIK DOWODZI.
//   1. Odwiedzający (analityka ze zgodą) stoją OBOK kroków księgi: przejście
//      do kont ma podpis „inna populacja", a nie procent - nigdzie nie pada
//      iloraz konta ÷ odwiedzający.
//   2. Aktywacja jest krokiem bez liczby, bez ilorazu i z notką D-02.
//   3. Udziały kroków z SQL (zasięg paywalla, konwersja kasy), start kasy bez
//      ilorazu.
//   4. `full` i `compact` czytają TEN SAM klucz (jedno żądanie), zwarty
//      prowadzi do zakładki Lejek.
//   5. Stany karty (MFA, odmowa, tor bez samoobsługi, kwoty ukryte) i axe.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ fetchFunnel: vi.fn() }));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
vi.mock("@/lib/revenue/funnel/funnel.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/revenue/funnel/funnel.functions")>()),
  getRevenueFunnel: (...args: unknown[]) => h.fetchFunnel(...args),
}));
vi.mock("@/components/admin/analytics/semantic/hooks/useBenchmark", async (importOriginal) => {
  const { noBenchmark } = await import("./funnelTestKit");
  return {
    ...(await importOriginal<
      typeof import("@/components/admin/analytics/semantic/hooks/useBenchmark")
    >()),
    useBenchmark: noBenchmark,
  };
});

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { FunnelStageMap } from "@/components/admin/revenue/funnel/FunnelStageMap";
import { FUNNEL_DTO, TENANT, clone, testRange } from "../../overview/__tests__/hubFixtures";
import { renderWithClient } from "./funnelTestKit";

function ready(overrides: Record<string, unknown> = {}) {
  return { state: "ready", funnel: { ...(clone(FUNNEL_DTO) as object), ...overrides } };
}

beforeEach(async () => {
  h.fetchFunnel.mockReset();
  h.fetchFunnel.mockResolvedValue(ready());
  await i18n.changeLanguage("pl");
});

afterEach(() => cleanup());

async function renderMap(variant: "full" | "compact" = "full", onOpenStage = vi.fn()) {
  const view = renderWithClient(
    <FunnelStageMap
      tenantId={TENANT}
      range={testRange()}
      segment={null}
      variant={variant}
      onOpenStage={onOpenStage}
    />,
  );
  await screen.findByRole("list", { name: "Kroki lejka samoobsługowego" });
  return view;
}

describe("FunnelStageMap - strumienie i kroki", () => {
  it("odwiedzający obok listy kroków, przejście do kont BEZ ilorazu", async () => {
    await renderMap();
    const visitors = screen.getByTestId("funnel-visitors");
    expect(visitors).toHaveAttribute("data-stream", "first_party");
    expect(visitors).toHaveTextContent("Odwiedzający");
    expect(visitors.textContent).toContain("5000");
    expect(within(visitors).getByTestId("funnel-cross-stream")).toHaveTextContent(
      "inna populacja niż konta, więc bez udziału procentowego",
    );

    const list = screen.getByRole("list", { name: "Kroki lejka samoobsługowego" });
    const items = within(list).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Nowe konta");
    // Pierwszy krok księgi nie ma udziału w odwiedzających (200 ÷ 5000 = 4 %).
    expect(items[0]).not.toHaveTextContent("Udział w poprzednim kroku");
    expect(list).not.toHaveTextContent("Odwiedzający");
    expect(document.body.textContent).not.toMatch(/Udział w poprzednim kroku: 4\s?%/);
  });

  it("aktywacja: krok bez liczby, bez ilorazu i z notką D-02", async () => {
    await renderMap();
    const list = screen.getByRole("list", { name: "Kroki lejka samoobsługowego" });
    const activation = within(list).getAllByRole("listitem")[1] as HTMLElement;
    expect(activation).toHaveTextContent("Aktywacja");
    expect(activation).toHaveTextContent("(brak definicji)");
    expect(activation).toHaveTextContent("-");
    expect(activation).toHaveTextContent("Udział w poprzednim kroku: -");
    expect(screen.getByTestId("funnel-activation-note")).toHaveTextContent("decyzja D-02");
  });

  it("udziały z SQL: paywall 15 %, kasa bez ilorazu, płatność 75 %", async () => {
    await renderMap();
    const items = within(
      screen.getByRole("list", { name: "Kroki lejka samoobsługowego" }),
    ).getAllByRole("listitem");
    expect(items.map((li) => li.querySelector("span.font-medium")?.textContent)).toEqual([
      "Nowe konta",
      "Aktywacja (brak definicji)",
      "Trafili na paywall",
      "Rozpoczęte płatności",
      "Opłacone",
    ]);
    expect(items[2]?.textContent).toMatch(/Udział w poprzednim kroku: 15\s?%/);
    expect(items[3]).toHaveTextContent("Udział w poprzednim kroku: -");
    expect(items[4]?.textContent).toMatch(/Udział w poprzednim kroku: 75\s?%/);
  });

  it("kliknięcie kroku otwiera arkusz (`?stage=`) z nazwą kroku", async () => {
    const onOpenStage = vi.fn();
    await renderMap("full", onOpenStage);
    fireEvent.click(screen.getByRole("button", { name: "Szczegóły kroku: Trafili na paywall" }));
    expect(onOpenStage).toHaveBeenCalledWith("paywall");
    fireEvent.click(screen.getByRole("button", { name: "Szczegóły kroku: Odwiedzający" }));
    expect(onOpenStage).toHaveBeenLastCalledWith("visitors");
  });

  it("kwoty ukryte, gdy rola ich nie widzi", async () => {
    h.fetchFunnel.mockResolvedValue(ready({ amountsVisible: false }));
    await renderMap();
    expect(screen.getByTestId("funnel-paid-amount")).toHaveTextContent(
      "Kwoty widzą administratorzy.",
    );
  });
});

describe("FunnelStageMap - Kokpit i stany", () => {
  it("compact i full w jednym cache = jedno żądanie; zwarty prowadzi do Lejka", async () => {
    renderWithClient(
      <>
        <FunnelStageMap tenantId={TENANT} range={testRange()} segment="all" variant="compact" />
        <FunnelStageMap tenantId={TENANT} range={testRange()} segment={null} variant="full" />
      </>,
    );
    await waitFor(() =>
      expect(screen.getAllByRole("list", { name: "Kroki lejka samoobsługowego" })).toHaveLength(2),
    );
    expect(h.fetchFunnel).toHaveBeenCalledTimes(1);
    const compact = screen
      .getAllByTestId("funnel-stage-map")
      .find((el) => el.getAttribute("data-variant") === "compact") as HTMLElement;
    expect(within(compact).getByRole("link", { name: "Pełny lejek" })).toHaveAttribute(
      "href",
      "/admin/revenue/funnel",
    );
    expect(within(compact).queryByTestId("funnel-activation-note")).toBeNull();
  });

  it("tor bez samoobsługi: zdanie zamiast pustej mapy", async () => {
    h.fetchFunnel.mockResolvedValue(ready({ selfServe: null }));
    renderWithClient(
      <FunnelStageMap tenantId={TENANT} range={testRange()} segment={null} track="sales" />,
    );
    expect(await screen.findByText(/Tor samoobsługi jest wyłączony/)).toBeVisible();
  });

  it("MFA bez aal2 = MfaRequiredNotice; odmowa roli = zdanie odmowy", async () => {
    h.fetchFunnel.mockRejectedValue(new Error("Forbidden: mfa_required - verify"));
    renderWithClient(<FunnelStageMap tenantId={TENANT} range={testRange()} segment={null} />);
    expect(await screen.findByTestId("revenue-mfa-required")).toBeInTheDocument();
    cleanup();

    h.fetchFunnel.mockResolvedValue({ state: "forbidden" });
    renderWithClient(<FunnelStageMap tenantId={TENANT} range={testRange()} segment={null} />);
    expect(await screen.findByText("Lejek widzą administratorzy i redaktorzy.")).toBeVisible();
  });

  it("nie ma naruszeń dostępności (pełny i zwarty)", async () => {
    const full = await renderMap("full");
    expect(summarize(await axeViolations(full.container))).toBe("");
    cleanup();
    const compact = await renderMap("compact");
    expect(summarize(await axeViolations(compact.container))).toBe("");
  });
});
