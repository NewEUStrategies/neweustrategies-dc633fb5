// `RevenueInsightSection` - sekcja „Przychód i lejek” na ekranie BI (karta S6,
// SPEC §6.5; PLAN S6 T4 pkt 9).
//
// Klasy defektów:
//   1. DRUGA LICZBA MRR. Sekcja ma czytać migawkę TĄ SAMĄ fabryką co hub
//      (`revenueSnapshotQueryOptions`) - inny klucz to drugi odczyt i ryzyko
//      dwóch różnych MRR na dwóch ekranach.
//   2. KWOTY DLA REDAKTORA. Redaktor widzi lejek i społeczność, a w miejscu
//      kwot - kafle zablokowane (nie „0 zł”, nie puste miejsce).
//   3. ODMOWA JAKO TOAST. 42501 to stan uprawnień: „dostępne dla
//      administratora i redaktora”, nie komunikat o awarii.
//   4. KAFEL BEZ REJESTRU. Każdy kafel: `metricId`, ocena albo powód jej
//      braku, objaśnienie i odnośnik do zakładki huba.
//   5. `?metric=` z adresu to dane wejściowe - nieznana metryka nie otwiera
//      niczego; znana otwiera pełne objaśnienie, zamknięcie czyści adres.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { createFileRoute } from "@tanstack/react-router";
import type {
  ReconciliationEntry,
  ReconciliationVerdict,
} from "@/lib/analytics/semantic/reconcile";
import type { RevenueSnapshotResult } from "@/lib/analytics/semantic/revenueSnapshot.functions";

const h = vi.hoisted(() => ({
  fetchSnapshot: vi.fn(),
  fetchGroup: vi.fn(),
  tenantId: "tenant-alfa" as string | null,
  /** Role sesji dla testu trasy BI (bramka sekcji przed leniwym importem). */
  roles: [] as string[],
}));

vi.mock("@/lib/tenant", () => ({ useCurrentTenantId: () => h.tenantId }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ roles: h.roles }) }));
// Trasa BI: status źródeł i siedem dashboardów to atrapy (mają własne testy);
// przedmiotem dowodu jest wyłącznie bramka sekcji przychodu i nagłówek (D14).
vi.mock("@/lib/analytics/status.functions", () => ({ getAnalyticsStatus: "fn:status" }));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => async () => null,
}));
vi.mock("@/components/admin/analytics/TrafficGeoDashboard", () => ({
  TrafficGeoDashboard: () => null,
}));
vi.mock("@/components/admin/analytics/VitalsBiDashboard", () => ({
  VitalsBiDashboard: () => null,
}));
vi.mock("@/components/admin/analytics/ClientErrorsDashboard", () => ({
  ClientErrorsDashboard: () => null,
}));
vi.mock("@/components/admin/analytics/AudienceSegmentsDashboard", () => ({
  AudienceSegmentsDashboard: () => null,
}));
vi.mock("@/components/admin/analytics/GscBiDashboard", () => ({ GscBiDashboard: () => null }));
vi.mock("@/components/admin/analytics/Ga4BiDashboard", () => ({ Ga4BiDashboard: () => null }));
vi.mock("@/components/admin/analytics/FooterAnalyticsPanel", () => ({
  FooterAnalyticsPanel: () => <div data-testid="pulpit-footer" />,
}));
vi.mock("@/lib/analytics/semantic/benchmarks/benchmarks.functions", () => ({
  getBenchmarkGroup: (...args: unknown[]) => h.fetchGroup(...args),
}));
// Fabryka zapytań zostaje PRAWDZIWA (klucz, świeżość) - podmieniamy wyłącznie
// funkcję pobierającą, żeby test widział, z jakim oknem sekcja pyta serwer.
vi.mock("@/lib/analytics/semantic/revenueSnapshot.functions", async (importOriginal) => {
  const orig =
    await importOriginal<typeof import("@/lib/analytics/semantic/revenueSnapshot.functions")>();
  return {
    ...orig,
    revenueSnapshotQueryOptions: (
      ...args: Parameters<typeof orig.revenueSnapshotQueryOptions>
    ) => ({
      ...orig.revenueSnapshotQueryOptions(...args),
      queryFn: () => h.fetchSnapshot(args[1]),
    }),
  };
});

import "@/test/i18nReal";
import { realT } from "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { renderRoute, type RenderedRoute } from "@/test/routeHarness";
import "@/lib/i18n-admin-analytics";
import "@/lib/i18n-admin-revenue-shell";
import { authoritativeBinding, metricById, type MetricId } from "@/lib/analytics/semantic/metrics";
import { REVENUE_FORBIDDEN_CODE } from "@/lib/analytics/semantic/revenueSnapshot.functions";
import { revenueKeys } from "@/lib/revenue/keys";
import { Route as BiRoute } from "@/routes/admin.analytics.bi";
import {
  ADMIN_TILES,
  EDITOR_TILES,
  RevenueInsightSection,
} from "../organisms/RevenueInsightSection";
import { payloadFor } from "./benchmarkFixtures";

const PATH = "/admin/analytics/bi";
const Route = createFileRoute("/admin/analytics/bi")({ component: RevenueInsightSection });

function entry(
  metricId: MetricId,
  value: number | null,
  verdict: ReconciliationVerdict = "single_source",
): ReconciliationEntry {
  return {
    metricId,
    canonicalValue: value,
    authoritativeStream: authoritativeBinding(metricId).streamId,
    observations: [],
    spread: null,
    verdict,
    reasons: [],
  };
}

const VALUES: Partial<Record<MetricId, number>> = {
  mrr: 1_240_000,
  arr: 14_880_000,
  net_revenue_retention: 1.02,
  logo_churn_monthly: 0.042,
  revenue_realized: 1_300_000,
  trial_to_paid_rate: 0.31,
  registered_to_paid_rate: 0.04,
  paywall_conversion_rate: 0.02,
  checkout_conversion_rate: 0.5,
  email_open_rate: 0.38,
  event_attendance_rate: 0.6,
  club_active_member_rate: 0.3,
};

function snapshot(role: "admin" | "editor" = "admin"): RevenueSnapshotResult {
  const ids = Object.keys(VALUES) as MetricId[];
  return {
    window: {
      period: "month",
      sinceIso: "2026-10-01T00:00:00.000Z",
      untilIso: "2026-10-19T00:00:00.000Z",
      offsetMinutes: -120,
      complete: false,
    },
    previous: null,
    entries: ids.map((id) =>
      entry(
        id,
        role === "editor" && metricById(id).currencyBound ? null : (VALUES[id] ?? null),
        id === "revenue_realized" ? "aligned" : "single_source",
      ),
    ),
    deltas: ids.map((id) => ({
      metricId: id,
      current: VALUES[id] ?? null,
      previous: id === "mrr" ? 0 : null,
      deltaPct: null,
    })),
    ratios: [],
    streams: [],
    money:
      role === "admin"
        ? {
            mrr: [
              { currency: "PLN", amountMinor: 1_240_000 },
              { currency: "EUR", amountMinor: 50_000 },
            ],
            arr: [{ currency: "PLN", amountMinor: 14_880_000 }],
            revenue_realized: [{ currency: "PLN", amountMinor: 1_300_000 }],
          }
        : {},
    dataSince: "2024-01-01",
    computedAt: null,
    basisMix: null,
    role,
  };
}

async function mount(initial = PATH): Promise<RenderedRoute> {
  const view = await renderRoute({ route: Route, path: PATH, initialEntry: initial });
  return view;
}

async function loaded(): Promise<void> {
  await waitFor(() =>
    expect(document.querySelector('[data-tile="mrr"], [data-locked-reason]')).not.toBeNull(),
  );
}

function tile(id: MetricId): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-tile="${id}"]`);
  if (!el) throw new Error(`test: brak kafla ${id}`);
  return el;
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.tenantId = "tenant-alfa";
  h.roles = [];
  h.fetchSnapshot.mockReset();
  h.fetchSnapshot.mockResolvedValue(snapshot("admin"));
  h.fetchGroup.mockReset();
  h.fetchGroup.mockImplementation(async ({ data }: { data: { group: never; lang: never } }) =>
    payloadFor(data.group, data.lang),
  );
});
afterEach(cleanup);

describe("RevenueInsightSection - administrator", () => {
  it("nagłówek sekcji, 12 kafli z rejestru, każdy z odnośnikiem do zakładki huba", async () => {
    const t = realT("pl");
    await mount();
    await loaded();
    expect(
      screen.getByRole("heading", { level: 2, name: t("adminAnalytics.bi.revenue.title") }),
    ).toBeInTheDocument();
    for (const spec of [...ADMIN_TILES, ...EDITOR_TILES]) {
      const el = tile(spec.metricId);
      expect(
        el.querySelector(`[data-drill="/admin/revenue/${spec.tab}"]`),
        spec.metricId,
      ).not.toBeNull();
      // Ikona objaśnienia przy KAŻDEJ etykiecie (SPEC §6.5).
      expect(el.querySelector("[data-metric-help]"), spec.metricId).not.toBeNull();
    }
  });

  it("kwoty per waluta z migawki, bez sumy; baza 0 = „brak porównania”", async () => {
    const t = realT("pl");
    await mount();
    await loaded();
    const mrr = tile("mrr");
    expect(mrr.querySelector("[data-money='primary']")?.getAttribute("data-currency")).toBe("PLN");
    expect(mrr.textContent).toContain(t("adminRevenue.money.otherCurrencies", { count: 1 }));
    expect(mrr.querySelector("[data-delta='no-baseline']")).not.toBeNull();
  });

  it("ocena tą samą regułą co kafel huba: churn 4,2 % - poziom z rejestru; kwota MRR - inna wielkość", async () => {
    const t = realT("pl");
    await mount();
    await loaded();
    await waitFor(() =>
      expect(
        tile("logo_churn_monthly").querySelector("[data-tier]:not([data-tier='none'])"),
      ).not.toBeNull(),
    );
    await waitFor(() =>
      expect(tile("mrr").querySelector("[data-tier='none']")?.textContent).toBe(
        t("adminRevenue.benchmark.state.measure_mismatch"),
      ),
    );
  });

  it("przychód zrealizowany niesie werdykt uzgodnienia księgi z zamówieniami", async () => {
    const t = realT("pl");
    await mount();
    await loaded();
    const group = within(tile("revenue_realized")).getByRole("group", {
      name: t("adminAnalytics.bi.revenue.reconciliation"),
    });
    expect(group.textContent).toBe(t("adminAnalytics.semantic.verdict.aligned"));
  });

  it("migawka pod kluczem fabryki huba z najemcą; zmiana okresu pyta o nowe okno", async () => {
    const view = await mount();
    await loaded();
    const prefix = revenueKeys.domainTenant("snapshot", "tenant-alfa");
    const keys = view.queryClient
      .getQueryCache()
      .getAll()
      .map((q) => q.queryKey);
    expect(keys.some((k) => prefix.every((part, i) => k[i] === part))).toBe(true);
    expect(h.fetchSnapshot.mock.calls[0][0]).toMatchObject({ period: "month" });

    const t = realT("pl");
    fireEvent.click(screen.getByRole("button", { name: t("adminRevenue.period.quarter") }));
    await waitFor(() => expect(h.fetchSnapshot).toHaveBeenCalledTimes(2));
    expect(h.fetchSnapshot.mock.calls[1][0]).toMatchObject({ period: "quarter" });
    // Okresy huba BEZ własnego zakresu - BI nie ma pól dat.
    expect(screen.queryByRole("button", { name: t("adminRevenue.period.custom") })).toBeNull();
  });

  it("źródła bez wpiętego RPC: jawna informacja zamiast samych kresek", async () => {
    h.fetchSnapshot.mockResolvedValue({
      ...snapshot("admin"),
      streams: [
        { streamId: "billing", available: true },
        { streamId: "lifecycle", available: false, reason: "not_configured" },
      ],
    });
    await mount();
    await loaded();
    expect(screen.getByTestId("revenue-sources-pending")).toHaveTextContent(
      "Część źródeł nie jest jeszcze podłączona",
    );
  });

  it("komplet źródeł: bez informacji o niepodłączonych", async () => {
    await mount();
    await loaded();
    expect(screen.queryByTestId("revenue-sources-pending")).toBeNull();
  });

  it("bez najemcy nie pyta serwera (szkielet o wymiarach kafli)", async () => {
    h.tenantId = null;
    await mount();
    await act(async () => {});
    expect(h.fetchSnapshot).not.toHaveBeenCalled();
    expect(document.querySelector("[aria-busy='true']")).not.toBeNull();
  });
});

describe("RevenueInsightSection - redaktor i odmowa", () => {
  it("redaktor: kafle kwot zablokowane („tylko administrator”), lejek i społeczność widoczne", async () => {
    const t = realT("pl");
    h.fetchSnapshot.mockResolvedValue(snapshot("editor"));
    await mount();
    await waitFor(() =>
      expect(document.querySelectorAll("[data-locked-reason='admin_only']")).toHaveLength(
        ADMIN_TILES.length,
      ),
    );
    for (const spec of ADMIN_TILES) {
      const label = metricById(spec.metricId).labelPl;
      expect(screen.getByRole("group", { name: label }).textContent).toContain(
        t("adminRevenue.locked.admin_only"),
      );
    }
    for (const spec of EDITOR_TILES) expect(tile(spec.metricId)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("12 400");
  });

  it("42501: stan „dostępne dla administratora i redaktora”, nie alert", async () => {
    h.fetchSnapshot.mockRejectedValue(
      Object.assign(new Error("Forbidden: admin or editor role required"), {
        code: REVENUE_FORBIDDEN_CODE,
      }),
    );
    await mount();
    const gate = await screen.findByTestId("revenue-role-gate", {}, { timeout: 4000 });
    expect(gate).toHaveAttribute("role", "status");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("inny błąd: `role=alert` i ponowienie", async () => {
    const t = realT("pl");
    h.fetchSnapshot.mockRejectedValue(new Error("network"));
    await mount();
    const alert = await screen.findByRole("alert", {}, { timeout: 4000 });
    expect(alert.textContent).toContain(t("adminAnalytics.bi.revenue.error"));
    h.fetchSnapshot.mockResolvedValue(snapshot("admin"));
    fireEvent.click(
      within(alert).getByRole("button", { name: t("adminAnalytics.bi.revenue.retry") }),
    );
    await loaded();
  });
});

describe("RevenueInsightSection - ?metric= i słownik", () => {
  it("?metric= znanej metryki otwiera pełne objaśnienie; zamknięcie czyści adres", async () => {
    const t = realT("pl");
    const view = await mount(`${PATH}?metric=net_revenue_retention`);
    const sheet = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(sheet.textContent).toContain(t("adminRevenue.benchmark.explainer.levers")),
    );
    expect(sheet.getAttribute("aria-labelledby")).toBeTruthy();
    fireEvent.keyDown(sheet, { key: "Escape" });
    await waitFor(() => expect(view.search().metric).toBeUndefined());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("?metric= spoza rejestru nie otwiera niczego", async () => {
    await mount(`${PATH}?metric=nie_ma_takiej`);
    await loaded();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("„Więcej” w objaśnieniu kafla ustawia ?metric= (adres do udostępnienia)", async () => {
    const t = realT("pl");
    const view = await mount();
    await loaded();
    fireEvent.click(
      within(tile("arr")).getByRole("button", {
        name: t("adminRevenue.benchmark.help.open", { name: "ARR" }),
      }),
    );
    const popover = await screen.findByRole("dialog");
    fireEvent.click(
      await within(popover).findByRole("button", {
        name: t("adminRevenue.benchmark.explainer.more"),
      }),
    );
    await waitFor(() => expect(view.search().metric).toBe("arr"));
  });

  it("słownik grup przychodowych ładuje się dopiero po rozwinięciu, bez metryk ruchu", async () => {
    const t = realT("pl");
    await mount();
    await loaded();
    expect(screen.queryByRole("table")).toBeNull();
    const toggle = screen.getByRole("button", {
      name: t("adminAnalytics.bi.revenue.dictionaryShow"),
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    const table = await screen.findByRole("table");
    expect(table.querySelector('[data-metric="mrr"]')).not.toBeNull();
    expect(table.querySelector('[data-metric="sessions"]')).toBeNull();
    // Z wartościami migawki: kolumny „teraz” i „ocena”.
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toContain(t("adminRevenue.benchmark.dictionary.colNow"));
  });
});

describe("RevenueInsightSection - dostępność i język", () => {
  it("sekcja bez naruszeń axe", async () => {
    const view = await mount();
    await loaded();
    await waitFor(() => expect(h.fetchGroup).toHaveBeenCalled());
    expect(summarize(await axeViolations(view.container))).toBe("");
  });

  it("EN: nagłówek, okresy i etykiety kafli po angielsku", async () => {
    await i18n.changeLanguage("en");
    const en = realT("en");
    await mount();
    await loaded();
    expect(
      screen.getByRole("heading", { level: 2, name: en("adminAnalytics.bi.revenue.title") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: en("adminRevenue.period.month") }),
    ).toBeInTheDocument();
    expect(tile("net_revenue_retention").textContent).toContain(
      metricById("net_revenue_retention").labelEn,
    );
  });
});

describe("trasa /admin/analytics/bi - bramka sekcji i nagłówek (D14)", () => {
  async function mountBi(): Promise<RenderedRoute> {
    const view = await renderRoute({ route: BiRoute, path: PATH, initialEntry: PATH });
    await screen.findByTestId("pulpit-footer");
    return view;
  }

  it("nagłówek sekcyjny z `adminPageHead`, opis ≥ 40 znaków (bez generycznego „| Admin”)", async () => {
    const view = await mountBi();
    const meta = view.meta();
    expect(meta).toContainEqual({ title: "BI - wszystkie dashboardy | New European Strategies" });
    const description = meta.find((m) => m.name === "description")?.content;
    expect(typeof description === "string" && description.length >= 40).toBe(true);
    expect(meta).toContainEqual({ name: "robots", content: "noindex, nofollow" });
  });

  it("autor (bez roli admin/editor) NIE dostaje sekcji ani zapytania o migawkę", async () => {
    h.roles = ["author"];
    await mountBi();
    await act(async () => {});
    expect(document.querySelector('[data-tile="mrr"]')).toBeNull();
    expect(h.fetchSnapshot).not.toHaveBeenCalled();
  });

  it.each([["admin"], ["editor"]])(
    "rola %s: sekcja montuje się NA KOŃCU strony (bez przesunięć)",
    async (role) => {
      const t = realT("pl");
      h.roles = [role];
      await mountBi();
      const heading = await screen.findByRole("heading", {
        level: 2,
        name: t("adminAnalytics.bi.revenue.title"),
      });
      // Sekcja stoi PO ostatnim dashboardzie - jej pojawienie się po
      // rozstrzygnięciu roli nie przesuwa niczego powyżej (CLS).
      const footer = screen.getByTestId("pulpit-footer");
      expect(
        footer.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    },
  );
});
