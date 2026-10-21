// `PaywallPairCard` - zasięg (PHR) i konwersja (PSCR) paywalla razem (S7,
// SPEC §2.2 `funnel`, §6.2: „PHR/PSCR jako small multiples, zakaz dwóch osi").
//
// CO TEN PLIK DOWODZI.
//   1. Para = dwa kafle wskaźników z rejestru obok siebie, w jednej grupie
//      z nazwą - każdy z własną skalą i oceną; żadnego wykresu z dwiema osiami
//      (rama wykresu nie jest montowana wcale).
//   2. Pod kaflami stoją mianowniki (konta z uderzeniem, aktywne konta,
//      kupujący) - procent nie wisi bez próby.
//   3. Data początku pomiaru paywalla albo zdanie „jeszcze bez pomiaru".
//   4. Ten sam odczyt co mapa lejka (jedno żądanie) i axe bez naruszeń.
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ fetchFunnel: vi.fn(), chartCard: vi.fn() }));

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
vi.mock("@/components/admin/analytics/ChartCard", () => ({
  ChartCard: (props: unknown) => {
    h.chartCard(props);
    return null;
  },
}));

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { FunnelStageMap } from "@/components/admin/revenue/funnel/FunnelStageMap";
import { PaywallPairCard } from "@/components/admin/revenue/funnel/PaywallPairCard";
import { FUNNEL_DTO, TENANT, clone, testRange } from "../../overview/__tests__/hubFixtures";
import { renderWithClient } from "./funnelTestKit";

function ready(selfServe: Record<string, unknown> = {}) {
  const dto = clone(FUNNEL_DTO) as { selfServe: Record<string, unknown> };
  return { state: "ready", funnel: { ...dto, selfServe: { ...dto.selfServe, ...selfServe } } };
}

beforeEach(async () => {
  h.fetchFunnel.mockReset();
  h.chartCard.mockReset();
  h.fetchFunnel.mockResolvedValue(ready());
  await i18n.changeLanguage("pl");
});

afterEach(() => cleanup());

async function renderPair() {
  const view = renderWithClient(
    <PaywallPairCard tenantId={TENANT} range={testRange()} segment={null} />,
  );
  await screen.findByRole("group", { name: "Paywall: zasięg i konwersja razem" });
  return view;
}

describe("PaywallPairCard", () => {
  it("dwa kafle z rejestru w jednej grupie, bez wykresu z dwiema osiami", async () => {
    await renderPair();
    const group = screen.getByRole("group", { name: "Paywall: zasięg i konwersja razem" });
    const tiles = [...group.querySelectorAll("[data-tile]")].map((el) =>
      el.getAttribute("data-tile"),
    );
    expect(tiles).toEqual(["paywall_hit_rate", "paywall_conversion_rate"]);
    expect(
      within(group)
        .getAllByRole("definition")
        .map((d) => d.textContent),
    ).toEqual([expect.stringMatching(/^15\s?%$/), expect.stringMatching(/^15\s?%$/)]);
    expect(h.chartCard).not.toHaveBeenCalled();
  });

  it("mianowniki pod kaflami i goście zatrzymani przez ścianę", async () => {
    await renderPair();
    expect(screen.getByText("120 z 800 aktywnych kont trafiło na paywall")).toBeVisible();
    expect(screen.getByText("18 z 120 kont kupiło po paywallu")).toBeVisible();
    expect(screen.getByText("Goście zatrzymani przez paywall: 340")).toBeVisible();
  });

  it("data początku pomiaru albo zdanie o braku pomiaru", async () => {
    await renderPair();
    expect(screen.getByTestId("paywall-data-since")).toHaveTextContent(
      "Pomiar paywalla od 1 września 2026",
    );
    cleanup();
    h.fetchFunnel.mockResolvedValue(ready({ paywallDataSince: null }));
    await renderPair();
    expect(screen.getByTestId("paywall-data-since")).toHaveTextContent(
      "Paywall nie ma jeszcze ani jednego pomiaru",
    );
  });

  it("ten sam odczyt co mapa lejka - jedno żądanie", async () => {
    renderWithClient(
      <>
        <FunnelStageMap tenantId={TENANT} range={testRange()} segment={null} />
        <PaywallPairCard tenantId={TENANT} range={testRange()} segment={null} />
      </>,
    );
    await screen.findByRole("group", { name: "Paywall: zasięg i konwersja razem" });
    await waitFor(() => expect(h.fetchFunnel).toHaveBeenCalledTimes(1));
  });

  it("nie ma naruszeń dostępności", async () => {
    const { container } = await renderPair();
    expect(summarize(await axeViolations(container))).toBe("");
  });
});
