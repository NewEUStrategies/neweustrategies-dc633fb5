// Trasa `/admin/analytics/bi` - warsztat z kompletem dashboardów BI.
//
// PO CO OSOBNY PLIK. Ramka sekcji w `adminAnalyticsRoute.test.tsx` montuje pod
// ścieżką `bi` ZASTĘPCZE dziecko, więc prawdziwy `AnalyticsBiPage` i jego
// `useQuery` statusu nie biegły w żadnym teście. A to trzeci z trzech odczytów
// `getAnalyticsStatus` (obok /admin/analytics i /admin/settings/analytics),
// które mają dzielić JEDEN wpis cache'u na najemcę (`analyticsStatusKey`).
// Własność „wspólny klucz" nie da się sprawdzić w `queryKeys.test.ts` - tam
// fabryka jest deterministyczna z definicji; łamie ją dopiero ekran, który
// wpisze klucz po swojemu albo zgubi `enabled`. Dowód stoi więc tutaj:
//
//   1. z najemcą status leży pod `analyticsStatusKey(TENANT)` - tym samym,
//      który asertują testy przeglądu i ustawień - a nie pod zaślepką `""`,
//   2. bez najemcy funkcja serwerowa NIE jest wołana (`enabled`),
//   3. świeży wpis zapamiętany przez INNY ekran pod tym kluczem obsługuje BI
//      bez własnego odczytu - to jest właśnie „wspólny wpis cache'u",
//   4. wpis INNEGO najemcy nie wycieka do tego: BI pobiera własny status.
//
// GRANICE. Siedem leniwych dashboardów to atrapy zapisujące propsy (każdy ma
// własny plik testowy); `GscBiDashboard` i `Ga4BiDashboard` są tu jedynym
// odbiorcą statusu, więc ich propsy są obserwowalnym skutkiem klucza. Najemca
// i funkcja serwerowa - atrapy jak w `adminAnalyticsRoute.test.tsx`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import type { AnalyticsStatus } from "@/lib/analytics/status.functions";

const h = vi.hoisted(() => ({
  status: null as unknown,
  statusCalls: 0,
  tenantId: null as string | null,
  props: {} as Record<string, Record<string, unknown> | undefined>,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
// Najemca sterowany z testu - prawdziwy `useCurrentTenantId` ciągnie klienta
// Supabase i sesję `useAuth`, których harness tras nie ma.
vi.mock("@/lib/tenant", () => ({
  useCurrentTenantId: () => h.tenantId,
}));
// Wartownik napisowy: `useServerFn` rozpoznaje funkcję bez ciągnięcia kodu
// serwerowego (zod, klient admin, bramka) do grafu modułów testu.
vi.mock("@/lib/analytics/status.functions", () => ({ getAnalyticsStatus: "fn:status" }));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => async () => {
    if (String(fn) !== "fn:status") throw new Error(`nieoczekiwana funkcja: ${String(fn)}`);
    h.statusCalls += 1;
    return h.status;
  },
}));

/** Atrapa dashboardu zapisująca propsy - przedmiotem dowodu jest, CO trasa oddaje. */
function dashboardStub(name: string) {
  return (props: Record<string, unknown>) => {
    h.props[name] = { ...props };
    return <div data-testid={`pulpit-${name}`} />;
  };
}

vi.mock("@/components/admin/analytics/TrafficGeoDashboard", () => ({
  TrafficGeoDashboard: dashboardStub("traffic"),
}));
vi.mock("@/components/admin/analytics/VitalsBiDashboard", () => ({
  VitalsBiDashboard: dashboardStub("vitals"),
}));
vi.mock("@/components/admin/analytics/ClientErrorsDashboard", () => ({
  ClientErrorsDashboard: dashboardStub("errors"),
}));
vi.mock("@/components/admin/analytics/AudienceSegmentsDashboard", () => ({
  AudienceSegmentsDashboard: dashboardStub("audience"),
}));
vi.mock("@/components/admin/analytics/GscBiDashboard", () => ({
  GscBiDashboard: dashboardStub("gsc"),
}));
vi.mock("@/components/admin/analytics/Ga4BiDashboard", () => ({
  Ga4BiDashboard: dashboardStub("ga4"),
}));
vi.mock("@/components/admin/analytics/FooterAnalyticsPanel", () => ({
  FooterAnalyticsPanel: dashboardStub("footer"),
}));

import { renderRoute, type RenderedRoute } from "@/test/routeHarness";
import { analyticsStatusKey } from "@/lib/analytics/queryKeys";
import { Route as AnalyticsBiRoute } from "@/routes/admin.analytics.bi";

const PATH = "/admin/analytics/bi";
const TENANT = "tenant-analytics";

/** Status z wszystkim wyłączonym; `gsc`/`ga4` włączane pojedynczo. */
function status(patch: { gsc?: boolean; ga4?: boolean } = {}): AnalyticsStatus {
  return {
    gsc: { configured: patch.gsc ?? false },
    ga4: {
      configured: patch.ga4 ?? false,
      enabled: true,
      activeMode: patch.ga4 ? "service_account" : null,
      hasServiceAccount: patch.ga4 ?? false,
      hasPropertyId: patch.ga4 ?? false,
      hasOauthRefresh: false,
      hasOauthClient: false,
      hasMeasurementProtocol: false,
      hasMeasurementId: false,
      hasEmbedUrl: false,
      serviceAccountEmail: null,
      propertyId: null,
      measurementId: null,
      measurementIdSource: null,
      embedUrl: null,
      missingSecrets: [],
    },
    vitals: { configured: false },
  };
}

/** Montuje trasę i czeka, aż leniwe dashboardy statusu wyjdą spod `Suspense`. */
async function mount(queryClient?: QueryClient): Promise<RenderedRoute> {
  const view = await renderRoute({
    route: AnalyticsBiRoute,
    path: PATH,
    initialEntry: PATH,
    queryClient,
  });
  await waitFor(() => {
    expect(screen.getByTestId("pulpit-gsc")).toBeTruthy();
    expect(screen.getByTestId("pulpit-ga4")).toBeTruthy();
  });
  return view;
}

/** Klient z wpisem statusu zapamiętanym tak, jak zostawia go inny ekran. */
function clientWithCachedStatus(tenantId: string, cached: AnalyticsStatus): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(analyticsStatusKey(tenantId), cached);
  return queryClient;
}

beforeEach(() => {
  cleanup();
  h.status = status();
  h.statusCalls = 0;
  h.tenantId = TENANT;
  h.props = {};
});

describe("status na warsztacie BI - najemca w kluczu i wspólny wpis cache'u", () => {
  it("status leży pod `analyticsStatusKey(TENANT)`, a dashboardy dostają jego flagi", async () => {
    h.status = status({ gsc: true, ga4: true });
    const view = await mount();

    await waitFor(() =>
      expect(view.queryClient.getQueryState(analyticsStatusKey(TENANT))?.status).toBe("success"),
    );
    expect(h.statusCalls).toBe(1);
    // Żaden wpis pod kluczem-zaślepką z pustym najemcą.
    expect(view.queryClient.getQueryState(analyticsStatusKey(""))).toBeUndefined();
    await waitFor(() => expect(h.props.gsc?.configured).toBe(true));
    expect(h.props.ga4).toMatchObject({ configured: true, activeMode: "service_account" });
  });

  it("bez ustalonego najemcy status NIE jest pobierany, dashboardy dostają „nieskonfigurowane”", async () => {
    h.tenantId = null;
    h.status = status({ gsc: true, ga4: true });
    const view = await mount();
    // Pełny obrót pętli - wyłączone zapytanie i tak nie ruszy.
    await act(async () => {});

    expect(h.statusCalls).toBe(0);
    for (const query of view.queryClient.getQueryCache().getAll()) {
      expect(query.state.data).toBeUndefined();
    }
    expect(h.props.gsc?.configured).toBe(false);
    expect(h.props.ga4).toMatchObject({ configured: false, activeMode: undefined });
  });

  it("świeży wpis zapamiętany przez INNY ekran obsługuje BI bez własnego odczytu", async () => {
    // Tak zostawia cache przegląd albo ustawienia (ten sam `analyticsStatusKey`,
    // to samo `staleTime`). Serwer mówi tu co innego niż cache - gdyby BI
    // liczył klucz po swojemu, pobrałby status i oddał flagi z serwera.
    h.status = status();
    const queryClient = clientWithCachedStatus(TENANT, status({ gsc: true, ga4: true }));
    await mount(queryClient);
    await act(async () => {});

    expect(h.statusCalls).toBe(0);
    expect(h.props.gsc?.configured).toBe(true);
    expect(h.props.ga4?.configured).toBe(true);
  });

  it("wpis INNEGO najemcy nie wycieka - BI pobiera status własnego obszaru roboczego", async () => {
    h.status = status();
    const queryClient = clientWithCachedStatus("tenant-beta", status({ gsc: true, ga4: true }));
    await mount(queryClient);

    await waitFor(() => expect(h.statusCalls).toBe(1));
    await waitFor(() =>
      expect(queryClient.getQueryState(analyticsStatusKey(TENANT))?.status).toBe("success"),
    );
    expect(h.props.gsc?.configured).toBe(false);
    expect(h.props.ga4?.configured).toBe(false);
  });
});
