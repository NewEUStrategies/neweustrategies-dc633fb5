// `AttentionCard` (S7, SPEC §2.2 `overview` „Wymaga uwagi") - karta Kokpitu.
//
// CO TEN PLIK DOWODZI (karta S7.1):
//   1. Trzy najpoważniejsze OTWARTE diagnozy (waga, skutek trwający, wpływ)
//      jako zwarte `DiagnosticCard` - ta sama ocena i kolejność co lista
//      Diagnostyki; wyciszone nie wchodzą.
//   2. „Napraw" prowadzi do Diagnostyki z `?fix=` (dialog i „Cofnij" żyją
//      tam), „Wszystkie diagnozy" - do zakładki.
//   3. Brak faktów to „nie da się ocenić", nigdy „nic pilnego"; odmowa i MFA
//      zostawiają powiadomienie układowi; bez najemcy i roli - zero żądań.
//   4. Propsy `{ tenantId, roles }` - kontrakt montażu w `RevenueOverview` (S7.2).
//   5. axe bez naruszeń.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  fetchFacts: vi.fn(),
  fetchSnoozes: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useNavigate: () => h.navigate,
}));
vi.mock("@/lib/revenue/diagnostics/diagnostics.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/revenue/diagnostics/diagnostics.functions")>()),
  getRevenueFacts: () => h.fetchFacts(),
  getRevenueSnoozes: () => h.fetchSnoozes(),
}));

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { realT } from "@/test/i18nReal";
import { axeViolations, summarize } from "@/test/axe";
import {
  ATTENTION_LIMIT,
  AttentionCard,
  type AttentionCardProps,
} from "@/components/admin/revenue/overview/AttentionCard";
import { topAttention } from "@/lib/admin/revenue/diagnosticGroups";
import type { RevenueFacts } from "@/lib/revenue/diagnostics/facts";
import { evaluateFindings } from "@/lib/revenue/diagnostics/queries";
import {
  FACTS,
  TENANT,
  daysSnooze,
  factsRead,
  snoozesRead,
} from "@/components/admin/revenue/diagnostics/__tests__/diagnosticsFixtures";

const t = realT("pl");

const ALL_OK = {
  v: 1,
  computedAt: "2026-10-15T10:00:00.000Z",
  areas: { sync: { emitErrors24h: 0, emitErrors7d: 0, silentDaily: [], silentWeekly: [] } },
} as const satisfies RevenueFacts;

function renderCard(props: Partial<AttentionCardProps> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AttentionCard tenantId={TENANT} roles={["admin"]} {...props} />
    </QueryClientProvider>,
  );
}

function cardIds(): string[] {
  return [...document.querySelectorAll("article[data-check-id]")].map(
    (a) => a.getAttribute("data-check-id") ?? "",
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.navigate.mockReset();
  h.fetchFacts.mockReset().mockResolvedValue(factsRead(FACTS));
  h.fetchSnoozes.mockReset().mockResolvedValue(snoozesRead());
});

afterEach(() => cleanup());

describe("AttentionCard - trzy najpoważniejsze otwarte diagnozy", () => {
  it("kolejność = `topAttention` (ta sama co lista Diagnostyki), karty zwarte", async () => {
    renderCard();
    await waitFor(() => expect(cardIds()).toHaveLength(ATTENTION_LIMIT));
    const expected = topAttention(evaluateFindings(FACTS, []), ATTENTION_LIMIT).map(
      (f) => f.checkId,
    );
    expect(cardIds()).toEqual(expected);
    expect(cardIds()).toEqual([
      "metering.settings_row_missing",
      "sync.emit_errors",
      "catalog.enquiry_plan_buyable",
    ]);
    const section = screen.getByRole("region", { name: t("adminRevenue.attention.title") });
    expect(within(section).getAllByRole("heading", { level: 3 })).toHaveLength(3);
    // Zwarte: bez opisu reguły i bez wyciszania.
    expect(
      screen.queryByText(t("adminRevenue.checks.metering.settings_row_missing.description")),
    ).toBe(null);
    expect(screen.queryByRole("button", { name: t("adminRevenue.diagnostics.card.snooze") })).toBe(
      null,
    );
  });

  it("wyciszona diagnoza nie wchodzi do „Wymaga uwagi”", async () => {
    h.fetchSnoozes.mockResolvedValue(snoozesRead([daysSnooze("metering.settings_row_missing")]));
    renderCard();
    await waitFor(() =>
      expect(cardIds()).toEqual([
        "sync.emit_errors",
        "catalog.enquiry_plan_buyable",
        "checkout.abandon_window_default",
      ]),
    );
  });

  it("„Napraw” prowadzi do Diagnostyki z `?fix=`, „Wszystkie diagnozy” do zakładki", async () => {
    renderCard();
    await waitFor(() => expect(cardIds()).toHaveLength(3));
    const card = document.querySelector('article[data-check-id="metering.settings_row_missing"]');
    if (!(card instanceof HTMLElement)) throw new Error("brak karty");
    fireEvent.click(within(card).getByRole("button", { name: t("adminRevenue.diagnostics.card.fix") }));
    expect(h.navigate).toHaveBeenCalledWith({
      to: "/admin/revenue/$tab",
      params: { tab: "diagnostics" },
      search: { fix: "metering.settings_row_missing" },
    });
    expect(screen.getByRole("link", { name: t("adminRevenue.attention.all") })).toHaveAttribute(
      "href",
      "/admin/revenue/diagnostics",
    );
  });
});

describe("AttentionCard - stany", () => {
  it("brak otwartych diagnoz: „nic pilnego”", async () => {
    h.fetchFacts.mockResolvedValue(factsRead(ALL_OK));
    renderCard();
    expect(await screen.findByTestId("attention-empty")).toHaveTextContent(
      t("adminRevenue.attention.empty"),
    );
  });

  it("fakty niedostępne albo błąd: „nie da się ocenić”, nigdy „nic pilnego”", async () => {
    h.fetchFacts.mockResolvedValue({ state: "unavailable" });
    renderCard();
    expect(await screen.findByTestId("attention-unknown")).toHaveTextContent(
      t("adminRevenue.attention.unknown"),
    );
    expect(screen.queryByTestId("attention-empty")).toBe(null);
    cleanup();

    h.fetchFacts.mockRejectedValue(new Error("boom"));
    renderCard();
    expect(
      await screen.findByTestId("attention-unknown", undefined, { timeout: 4_000 }),
    ).toBeInTheDocument();
  });

  it("wczytywanie: komunikat w regionie statusu", () => {
    h.fetchFacts.mockReturnValue(new Promise(() => {}));
    renderCard();
    expect(screen.getByText(t("adminRevenue.attention.loading"))).toHaveAttribute(
      "role",
      "status",
    );
  });

  it("odmowa i MFA: karta znika (powiadomienie należy do układu)", async () => {
    h.fetchFacts.mockResolvedValue({ state: "mfa_required" });
    renderCard();
    await waitFor(() => expect(h.fetchFacts).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId("revenue-attention")).toBe(null));
  });

  it.each([
    ["bez najemcy", { tenantId: null }],
    ["autor", { roles: ["author"] }],
  ])("%s: nic i zero żądań", (_label, props) => {
    const { container } = renderCard(props);
    expect(container).toBeEmptyDOMElement();
    expect(h.fetchFacts).not.toHaveBeenCalled();
    expect(h.fetchSnoozes).not.toHaveBeenCalled();
  });

  it("redaktor widzi te same diagnozy (bez kwot w faktach - liczy je SQL)", async () => {
    renderCard({ roles: ["editor"] });
    await waitFor(() => expect(cardIds()).toHaveLength(3));
  });
});

describe("AttentionCard - dostępność", () => {
  it("axe bez naruszeń", async () => {
    const { container } = renderCard();
    await waitFor(() => expect(cardIds()).toHaveLength(3));
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
