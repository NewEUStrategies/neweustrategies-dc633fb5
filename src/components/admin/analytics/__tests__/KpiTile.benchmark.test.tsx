// `KpiTile` z rejestru wskaźników (SPEC §5.5, §6.2; D9, D10; karta S6).
//
// Klasy defektów:
//   1. „+∞” PRZY BAZIE ZERO (D9). Procent od zera nie istnieje - kafel huba ma
//      pokazać kreskę z opisem, a nie nieskończoność albo „0%”.
//   2. FORMAT W ZŁYM JĘZYKU. Kafel w EN z przecinkiem dziesiętnym to liczba,
//      którą Anglik czyta jako tysiące - `Intl` w języku kafla.
//   3. ETYKIETA BEZ OBJAŚNIENIA. Skrót bez ikony prowadzącej do definicji,
//      wzoru i benchmarku to żargon (SPEC §6.5); etykieta jest węzłem, nie napisem.
//   4. SUMA WALUT. Kwota z PLN i EUR dodanych do siebie nie jest żadną kwotą.
//   5. ZERO ZAMIAST BLOKADY. Redaktor bez dostępu do kwot widzi kafel
//      zablokowany, nie „0 zł”.
// Plik nie zmienia zachowania kafli bez `metricId` - to przypina
// `kpiTile.test.tsx` (poza manifestem S6, Z-S6-01).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

const h = vi.hoisted(() => ({ fetchGroup: vi.fn() }));

vi.mock("@/lib/analytics/semantic/benchmarks/benchmarks.functions", () => ({
  getBenchmarkGroup: (...args: unknown[]) => h.fetchGroup(...args),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

import "@/test/i18nReal";
import { realT } from "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import "@/lib/i18n-admin-revenue-shell";
import { formatMoneyMinor } from "@/lib/analytics/semantic/format";
import { KpiTile, formatDelta, type KpiTileProps } from "../KpiTile";
import { payloadFor } from "../semantic/__tests__/benchmarkFixtures";

function tile(props: Partial<KpiTileProps> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactElement = <KpiTile label="MRR" value="12 400 zł" metricId="mrr" {...props} />;
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function chip(container: HTMLElement): HTMLElement | null {
  return container.querySelector("[class*='rounded-md'][class*='bg-muted/60']");
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.fetchGroup.mockReset();
  h.fetchGroup.mockImplementation(async ({ data }: { data: { group: never; lang: never } }) =>
    payloadFor(data.group, data.lang),
  );
});
afterEach(cleanup);

describe("formatDelta (D9)", () => {
  it("baza 0 → null (nie „+∞” i nie „0%”); procent i różnica przez Intl w języku", () => {
    expect(formatDelta(120, 0, false, "pl")).toBeNull();
    expect(formatDelta(0, 0, false, "pl")).toBeNull();
    expect(formatDelta(120, 100, false, "pl")).toBe("+20,0%");
    expect(formatDelta(120, 100, false, "en")).toBe("+20.0%");
    expect(formatDelta(80, 100, false, "en")).toBe("-20.0%");
    expect(formatDelta(100, 100, false, "pl")).toBe("0,0%");
    expect(formatDelta(1234.5, 0, true, "en", " pp")).toBe("+1,234.5 pp");
    expect(formatDelta(-1.25, 0, true, "pl")).toBe("-1,25");
  });
});

describe("KpiTile z metricId - delta D9", () => {
  it("poprzedni okres = 0: chip z kreską i opisem „brak porównania”, bez strzałki", () => {
    const t = realT("pl");
    const { container } = tile({ current: 120, previous: 0 });
    const c = chip(container);
    expect(c?.getAttribute("data-delta")).toBe("no-baseline");
    expect(c?.querySelector("[data-role='delta-value']")?.textContent).toBe("-");
    expect(c?.querySelector("[data-arrow]")).toBeNull();
    expect(c?.textContent).toContain(t("adminRevenue.benchmark.kpi.noBaseline"));
    expect(container.textContent).not.toContain("∞");
  });

  it("EN po angielsku: kropka dziesiętna i znak", () => {
    const { container } = tile({ current: 120, previous: 100, lang: "en" });
    expect(chip(container)?.querySelector("[data-role='delta-value']")?.textContent).toBe("+20.0%");
  });

  it("PL po polsku: przecinek dziesiętny", () => {
    const { container } = tile({ current: 90, previous: 100, lang: "pl" });
    expect(chip(container)?.querySelector("[data-role='delta-value']")?.textContent).toBe("-10,0%");
  });
});

describe("KpiTile z metricId - etykieta-węzeł z objaśnieniem", () => {
  it("etykieta jest parą term/definition z ikoną objaśnienia OBOK napisu", () => {
    const t = realT("pl");
    tile({ label: <abbr title="Monthly Recurring Revenue">MRR</abbr> });
    const term = screen.getByRole("term");
    expect(term.querySelector("abbr")?.textContent).toBe("MRR");
    expect(
      within(term).getByRole("button", {
        name: t("adminRevenue.benchmark.help.open", { name: "MRR" }),
      }),
    ).toHaveAttribute("aria-haspopup", "dialog");
    expect(screen.getByRole("definition").textContent).toBe("12 400 zł");
  });

  it("ikona otwiera MetricExplainer z treścią benchmarku wskaźnika", async () => {
    const t = realT("pl");
    const mrr = payloadFor("revenue", "pl").benchmarks.find((b) => b.key === "mrr");
    tile({ current: 1_240_000, previous: 1_000_000 });
    fireEvent.click(
      screen.getByRole("button", { name: t("adminRevenue.benchmark.help.open", { name: "MRR" }) }),
    );
    await act(async () => {});
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(mrr?.interpretation ?? "∅")).toBeInTheDocument();
    expect(h.fetchGroup).toHaveBeenCalledWith({ data: { group: "revenue", lang: "pl" } });
  });

  it("ocena benchmarku pod wartością: poziom albo jawny powód braku, nigdy szary poziom", () => {
    const t = realT("pl");
    const a = tile({
      benchmark: {
        tier: "good",
        band: { tier: "good", min: 1, max: 2, basis: "B" },
        basis: "B",
        contextId: "x",
        direction: "higher",
        value: 1.5,
      },
    });
    expect(a.container.querySelector('[data-tier="good"]')?.textContent).toBe(
      t("adminRevenue.benchmark.tier.good"),
    );
    a.unmount();
    const b = tile({ benchmark: { tier: "none", why: "measure_mismatch" } });
    expect(b.container.querySelector('[data-tier="none"]')?.textContent).toBe(
      t("adminRevenue.benchmark.state.measure_mismatch"),
    );
    expect(b.container.querySelectorAll("[data-dot]")).toHaveLength(0);
  });
});

describe("KpiTile z metricId - kwoty, blokada, szczegóły", () => {
  it("kwoty per waluta: preferowana na wierzchu, reszta pod „+N”, nigdy suma", () => {
    const t = realT("pl");
    const { container } = tile({
      money: [
        { currency: "PLN", amountMinor: 1_000_000 },
        { currency: "EUR", amountMinor: 240_000 },
      ],
      preferredCurrency: "EUR",
    });
    const definition = screen.getByRole("definition");
    expect(definition.querySelector("[data-money='primary']")?.getAttribute("data-currency")).toBe(
      "EUR",
    );
    expect(definition.textContent).toContain(formatMoneyMinor(240_000, "EUR", "pl"));
    expect(definition.textContent).toContain(t("adminRevenue.money.otherCurrencies", { count: 1 }));
    // Suma 12 400 (PLN + EUR) nie istnieje nigdzie w kaflu.
    expect(container.textContent).not.toContain("12 400");
  });

  it("brak danych kwot (`null`) mówi słowem, nie zerem", () => {
    const t = realT("pl");
    tile({ money: null });
    expect(screen.getByRole("definition").textContent).toBe(t("adminRevenue.money.noData"));
  });

  it("kafel zablokowany: grupa nazwana etykietą, powód słowem, bez liczby i bez objaśnienia", () => {
    const t = realT("pl");
    const { container } = tile({ lockedReason: "admin_only", value: "12 400 zł" });
    const group = screen.getByRole("group", { name: "MRR" });
    expect(group.textContent).toContain(t("adminRevenue.locked.admin_only"));
    expect(container.textContent).not.toContain("12 400");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("kafel zablokowany z etykietą-węzłem bierze nazwę z rejestru", () => {
    tile({ label: <span>MRR</span>, lockedReason: "mfa_required", metricId: "arr" });
    expect(screen.getByRole("group").getAttribute("aria-labelledby")).toBeTruthy();
    expect(screen.getByRole("group").textContent).toContain("ARR");
  });

  it("drillHref: odnośnik do szczegółów w hubie z nazwą wskaźnika, zapytanie jako search", () => {
    const t = realT("pl");
    tile({ drillHref: "/admin/revenue/mrr?w=quarter" });
    const link = screen.getByRole("link", {
      name: t("adminRevenue.benchmark.kpi.drill", { name: "MRR" }),
    });
    expect(link.getAttribute("href")).toBe("/admin/revenue/mrr");
    expect(link.getAttribute("data-drill")).toBe("/admin/revenue/mrr?w=quarter");
  });
});

describe("KpiTile z metricId - dostępność i język", () => {
  it("pełny kafel bez naruszeń axe", async () => {
    const { container } = tile({
      current: 120,
      previous: 0,
      money: [{ currency: "PLN", amountMinor: 1_000_000 }],
      benchmark: { tier: "none", why: "small_sample" },
      drillHref: "/admin/revenue/mrr",
      series: [1, 2, 3],
    });
    expect(summarize(await axeViolations(container))).toBe("");
  });

  it("w EN opis bazy 0 i etykieta ikony są angielskie", async () => {
    await i18n.changeLanguage("en");
    const en = realT("en");
    const { container } = tile({ current: 5, previous: 0, lang: "en" });
    expect(chip(container)?.textContent).toContain(en("adminRevenue.benchmark.kpi.noBaseline"));
    expect(
      screen.getByRole("button", { name: en("adminRevenue.benchmark.help.open", { name: "MRR" }) }),
    ).toBeInTheDocument();
  });
});
