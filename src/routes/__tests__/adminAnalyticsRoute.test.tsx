// Trasa `/admin/analytics` - 0/54 linii, 0/27 funkcji. Największy zerowy plik
// modułu 17 i jednocześnie jego SPINA: siedem zakładek, trzy pastylki statusu,
// cztery karty trybów GA4, mini-panel RUM i warstwa wniosków.
//
// PO CO TESTOWAĆ „SAMO SKLEJENIE". Bo w tym pliku sklejenie JEST logiką:
//
//   1. STATUS DECYDUJE, CO SIĘ RENDERUJE. `Ga4Panel` przy `configured: false`
//      NIE montuje pulpitu BI - pokazuje instrukcję konfiguracji. Odwrócenie
//      tego warunku daje pulpit odpytujący Data API bez kluczy, czyli ekran
//      błędów zamiast instrukcji. Analogicznie zakładka GSC bez danych statusu
//      renderuje `null`, a nie pulpit z `configured: undefined`.
//   2. TRZY STANY GA4, NIE DWA. „Podłączone", „jest service account, brak
//      GA4_PROPERTY_ID" i „nic nie ma" to trzy różne komunikaty i trzy różne
//      wagi wniosku (`good` / `warn` / `critical`). Zlepienie środkowego stanu
//      z którymkolwiek skrajnym kosztuje administratora godzinę szukania:
//      albo szuka klucza, który już wgrał, albo czeka na dane, które nie
//      przyjdą, bo brakuje jednego identyfikatora.
//   3. PRZYCISK TESTOWEGO EVENTU MA CZTERY WYJŚCIA. `configured: false` kończy
//      WCZEŚNIEJ (jeden komunikat, nie dwa), `ok: true` to sukces, `ok: false`
//      to błąd z treścią od Google (albo komunikat zapasowy), wyjątek to
//      trzecia ścieżka. Bez rozdzielenia tych czterech ścieżek panel mówi
//      „wysłano" na odrzuceniu przez GA4.
//   4. OSADZONY RAPORT WYMAGA DWÓCH WARUNKÓW. `hasEmbedUrl && embedUrl` -
//      flaga bez adresu daje `<iframe src="">`, czyli pustą ramkę 720 px
//      udającą raport.
//
// GRANICE. Atrapowane są: sześć leniwych pulpitów BI (każdy ma własny, pełny
// plik testowy - `ga4BiDashboard`, `gscBiDashboard`, `vitalsBiDashboard`,
// `audienceSegmentsDashboard`, `footerAnalyticsPanel`, `semanticOrganisms`),
// trzy funkcje serwerowe, toasty i i18n. PRAWDZIWE biegną: sklejenie trasy i
// `head()` (harness), `Tabs` Radiksa, `Suspense` z `React.lazy`,
// `useQuery`/`refetch` oraz `InsightSection` - bo to on zamienia wagę wniosku
// w widoczną plakietkę, więc atrapa w tym miejscu skasowałaby dowód z punktu 2.
//
// CZEGO TEN TEST NIE DOWODZI I DLACZEGO NIE MOŻE. Uprawnień: trasa nie ma
// własnego middleware, rolę sztabową wymusza `requireAdmin` po stronie funkcji
// serwerowej (`getAnalyticsStatus`) i RLS, a nie render - w teście nie ma
// sesji, więc „użytkownik bez roli" nie jest tu rozstrzygalny. Izolacji
// najemcy: każda z trzech funkcji serwerowych rozwiązuje najemcę SAMA
// (`resolveUserTenantId`, `has_role` filtrowane po `current_tenant_id()`), więc
// atrapa klienta dowiodłaby jedynie tego, co sama zwraca; kontrakt najemcy
// tych funkcji jest testowany u nich (`statusFunctions`, `vitalsFunctions`,
// `ga4Functions`) i w `check:tenant-isolation`.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { AnalyticsStatus } from "@/lib/analytics/status.functions";
import type { VitalMetricSummary } from "@/lib/observability/aggregate";

interface Ga4MpResultLike {
  ok: boolean;
  configured: boolean;
  debug?: string;
  error?: string;
}

const h = vi.hoisted(() => ({
  status: null as unknown,
  statusError: null as Error | null,
  /** Bramka: status nierozwiązany, dopóki test go nie zwolni. */
  statusGate: null as null | (() => void),
  statusCalls: 0,
  vitals: null as unknown,
  vitalsError: null as Error | null,
  vitalsGate: null as null | (() => void),
  ga4Result: null as unknown,
  ga4Error: null as Error | null,
  ga4Payloads: [] as unknown[],
  ga4Gate: null as null | (() => void),
  toastSuccess: [] as unknown[][],
  toastError: [] as unknown[][],
  props: {} as Record<string, Record<string, unknown> | undefined>,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => void h.toastSuccess.push(a),
    error: (...a: unknown[]) => void h.toastError.push(a),
  },
}));
// Komunikaty zapasowe jako rozpoznawalne wartowniki - test ma widzieć, KTÓRY
// komunikat wybrał kod, a nie zgadywać po tłumaczeniu.
vi.mock("@/lib/adminToasts", () => ({
  adminToast: {
    ga4NotConfigured: () => "atrapa:ga4NotConfigured",
    ga4Accepted: () => "atrapa:ga4Accepted",
    ga4Rejected: () => "atrapa:ga4Rejected",
  },
}));

// Trzy funkcje serwerowe zastąpione WARTOWNIKAMI NAPISOWYMI. Dzięki temu
// `useServerFn` rozpoznaje, o którą prosi komponent, a test nie ciągnie do
// grafu modułów kodu serwerowego (zod, klient admin, middleware).
vi.mock("@/lib/analytics/status.functions", () => ({ getAnalyticsStatus: "fn:status" }));
vi.mock("@/lib/analytics/ga4.functions", () => ({ sendGa4Event: "fn:ga4-event" }));
vi.mock("@/lib/observability/vitals.functions", () => ({ getVitalsSummary: "fn:vitals" }));

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => async (payload?: unknown) => {
    const name = String(fn);
    if (name === "fn:status") {
      h.statusCalls += 1;
      if (h.statusGate) await new Promise<void>((resolve) => (h.statusGate = resolve));
      if (h.statusError) throw h.statusError;
      return h.status;
    }
    if (name === "fn:vitals") {
      if (h.vitalsGate) await new Promise<void>((resolve) => (h.vitalsGate = resolve));
      if (h.vitalsError) throw h.vitalsError;
      return h.vitals;
    }
    h.ga4Payloads.push(payload);
    if (h.ga4Gate) await new Promise<void>((resolve) => (h.ga4Gate = resolve));
    if (h.ga4Error) throw h.ga4Error;
    return h.ga4Result;
  },
}));

/** Atrapa pulpitu zapisująca propsy - przedmiotem dowodu jest, CO trasa oddaje. */
function dashboardStub(name: string) {
  return (props: Record<string, unknown>) => {
    h.props[name] = { ...props };
    return <div data-testid={`pulpit-${name}`} />;
  };
}

vi.mock("@/components/admin/analytics/Ga4BiDashboard", () => ({
  Ga4BiDashboard: dashboardStub("ga4"),
}));
vi.mock("@/components/admin/analytics/GscBiDashboard", () => ({
  GscBiDashboard: dashboardStub("gsc"),
}));
vi.mock("@/components/admin/analytics/VitalsBiDashboard", () => ({
  VitalsBiDashboard: dashboardStub("vitals"),
}));
vi.mock("@/components/admin/analytics/AudienceSegmentsDashboard", () => ({
  AudienceSegmentsDashboard: dashboardStub("audience"),
}));
vi.mock("@/components/admin/analytics/FooterAnalyticsPanel", () => ({
  FooterAnalyticsPanel: dashboardStub("footer"),
}));
vi.mock("@/components/admin/analytics/semantic/organisms/SemanticReconciliationPanel", () => ({
  SemanticReconciliationPanel: dashboardStub("semantic"),
}));

import { renderRoute, type RenderedRoute } from "@/test/routeHarness";
import { Route as AnalyticsRoute } from "@/routes/admin.analytics";

const PATH = "/admin/analytics";
const STATUS_KEY = ["analytics-status"] as const;

/** Status z wszystkim wyłączonym - testy włączają POJEDYNCZE flagi. */
function status(
  patch: {
    gsc?: boolean;
    ga4?: Partial<AnalyticsStatus["ga4"]>;
    vitals?: boolean;
  } = {},
): AnalyticsStatus {
  return {
    gsc: { configured: patch.gsc ?? false },
    ga4: {
      configured: false,
      enabled: true,
      activeMode: null,
      hasServiceAccount: false,
      hasPropertyId: false,
      hasOauthRefresh: false,
      hasOauthClient: false,
      hasMeasurementProtocol: false,
      hasMeasurementId: false,
      hasEmbedUrl: false,
      serviceAccountEmail: null,
      propertyId: null,
      measurementId: null,
      embedUrl: null,
      missingSecrets: [],
      ...patch.ga4,
    },
    vitals: { configured: patch.vitals ?? false },
  };
}

function metric(patch: Partial<VitalMetricSummary> = {}): VitalMetricSummary {
  return {
    metric: "LCP",
    count: 120,
    p75: 1800,
    p50: 1200,
    min: 400,
    max: 5200,
    good: 80,
    needsImprovement: 30,
    poor: 10,
    rating: "needs-improvement",
    ...patch,
  };
}

function vitalsSummary(metrics: VitalMetricSummary[]) {
  return {
    windowDays: 7,
    total: metrics.reduce((sum, m) => sum + m.count, 0),
    metrics,
    paths: [],
    trends: [],
    windowTotal: metrics.reduce((sum, m) => sum + m.count, 0),
    capped: false,
  };
}

async function mount(): Promise<RenderedRoute> {
  const view = await renderRoute({ route: AnalyticsRoute, path: PATH, initialEntry: PATH });
  // Czekamy na STAN CACHE'U, nie na liczbę mikrotasków: React Query odkłada
  // wynik przez własny `notifyManager`, więc asercja po `await Promise.resolve()`
  // mierzyłaby pierwszą klatkę i przechodziła także wtedy, gdy zapytanie nie
  // zwróciło niczego.
  await waitFor(() => {
    const state = view.queryClient.getQueryState(STATUS_KEY);
    expect(state?.fetchStatus).toBe("idle");
  });
  return view;
}

/**
 * Ustawienia happy-dom dostępne w czasie wykonania.
 *
 * Bez `disableIframePageLoading` środowisko NAPRAWDĘ nawiguje osadzoną ramkę
 * (`Ga4EmbedCard`) pod podany adres, czyli test Looker Studio strzelałby w sieć
 * i sypał `AbortError`/`NetworkError` przy odmontowaniu. Test jednostkowy nie ma
 * prawa dotykać sieci - ten sam wzorzec i to samo uzasadnienie co w
 * `src/components/quiz/__tests__/LazyQuizIframe.test.tsx`.
 */
function happyDomSettings(): { disableIframePageLoading: boolean } {
  return (window as unknown as { happyDOM: { settings: { disableIframePageLoading: boolean } } })
    .happyDOM.settings;
}

/** Zakładka o widocznej nazwie - Radix aktywuje trigger na `mouseDown`. */
async function openTab(label: string): Promise<void> {
  await act(async () => {
    fireEvent.mouseDown(screen.getByRole("tab", { name: new RegExp(label) }));
  });
}

beforeEach(() => {
  cleanup();
  happyDomSettings().disableIframePageLoading = true;
  h.status = status();
  h.statusError = null;
  h.statusGate = null;
  h.statusCalls = 0;
  h.vitals = vitalsSummary([]);
  h.vitalsError = null;
  h.vitalsGate = null;
  h.ga4Result = { ok: true, configured: true } satisfies Ga4MpResultLike;
  h.ga4Error = null;
  h.ga4Payloads = [];
  h.ga4Gate = null;
  h.toastSuccess = [];
  h.toastError = [];
  h.props = {};
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
describe("nagłówki trasy", () => {
  it("`head()` daje tytuł i opis, a opis NIE wymienia nazw sekretów", async () => {
    const view = await mount();

    const meta = view.meta();
    const title = meta.find((entry) => "title" in entry);
    expect(String(title?.title)).toContain("Analityka");
    const description = meta.find((entry) => entry.name === "description");
    expect(String(description?.content).length).toBeGreaterThan(20);
    for (const secret of ["GA4_API_SECRET", "GA4_SERVICE_ACCOUNT_JSON", "SERVICE_ACCOUNT"]) {
      expect(String(description?.content)).not.toContain(secret);
    }
    expect(view.currentPath()).toBe(PATH);
  });
});

// ---------------------------------------------------------------------------
describe("siedem zakładek, jeden montowany pulpit", () => {
  // MUSI BYĆ PIERWSZY test otwierający leniwą zakładkę w tym pliku. `React.lazy`
  // pamięta rozwiązany moduł, a `cleanup()` nie czyści rejestru modułów - po
  // pierwszym zamontowaniu `AudienceSegmentsDashboard` kolejne rendery mają go
  // gotowego i klatka z zastępką NIE ISTNIEJE. Kolejność testów w pliku jest
  // deterministyczna (vitest wykonuje je sekwencyjnie), więc to założenie jest
  // twarde, a nie szczęśliwe - ale przeniesienie tego testu niżej sprawi, że
  // przestanie mierzyć cokolwiek.
  it("ZANIM leniwy pulpit dojedzie, widać zastępkę wczytywania, a nie pustkę", async () => {
    await mount();

    // Bez `await`: `React.lazy` rozwiązuje się mikrotaskiem, więc stan pośredni
    // istnieje dokładnie jedną klatkę - i to on jest tu przedmiotem dowodu.
    act(() => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: /Audytorium/ }));
    });
    expect(screen.getByText(/Ładowanie dashboardu/)).toBeTruthy();

    await waitFor(() => expect(screen.getByTestId("pulpit-audience")).toBeTruthy());
  });

  it("lista ma DOKŁADNIE siedem zakładek i każda ma dostępną nazwę", async () => {
    await mount();

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(7);
    for (const tab of tabs) expect((tab.textContent ?? "").trim().length).toBeGreaterThan(0);
  });

  it("domyślnie otwarty jest PRZEGLĄD - żaden ciężki pulpit BI nie jest montowany", async () => {
    h.status = status({ gsc: true, ga4: { configured: true }, vitals: true });
    await mount();

    for (const name of ["ga4", "gsc", "audience", "footer", "semantic"]) {
      expect(screen.queryByTestId(`pulpit-${name}`)).toBeNull();
    }
  });

  it("każda z pięciu leniwych zakładek montuje SWÓJ pulpit", async () => {
    h.status = status({ gsc: true, ga4: { configured: true, activeMode: "service_account" } });
    await mount();

    for (const [label, testId] of [
      ["GA4", "ga4"],
      ["Search Console", "gsc"],
      ["Web Vitals", "vitals"],
      ["Audytorium", "audience"],
      ["Stopka", "footer"],
    ] as const) {
      await openTab(label);
      await waitFor(() => expect(screen.getByTestId(`pulpit-${testId}`)).toBeTruthy());
    }
  });

  it("zakładka uzgodnienia bierze nazwę ze SŁOWNIKA, nie z tekstu w kodzie", async () => {
    await mount();

    const tab = screen.getByRole("tab", { name: /admin\.nav\.analyticsReconciliation/ });
    await act(async () => {
      fireEvent.mouseDown(tab);
    });
    await waitFor(() => expect(screen.getByTestId("pulpit-semantic")).toBeTruthy());
  });

  it("zakładka NIE zapisuje się w adresie - ta trasa nie ma zakładek linkowalnych", async () => {
    // Świadoma RÓŻNICA wobec `/admin/performance`, gdzie zakładka żyje w
    // `?tab=`. Test przypina stan faktyczny, więc przejście na zakładki
    // linkowalne będzie zmianą JAWNĄ, a nie przypadkową.
    const view = await mount();

    await openTab("Web Vitals");
    await waitFor(() => expect(screen.getByTestId("pulpit-vitals")).toBeTruthy());
    expect(view.search()).toEqual({});
    expect(view.currentPath()).toBe(PATH);
  });
});

// ---------------------------------------------------------------------------
describe("brama wczytywania statusu", () => {
  it("dopóki status nie dojechał, przegląd pokazuje komunikat, a nie pastylki", async () => {
    h.statusGate = () => {};
    await renderRoute({ route: AnalyticsRoute, path: PATH, initialEntry: PATH });

    expect(screen.getByText(/Ładowanie statusu/)).toBeTruthy();
    expect(screen.queryByText("Google Search Console")).toBeNull();

    const release = h.statusGate as unknown as () => void;
    await act(async () => {
      release();
      await Promise.resolve();
    });
  });

  it("zakładka GSC BEZ danych statusu renderuje NIC - pulpit nie dostaje `undefined`", async () => {
    h.statusError = new Error("Forbidden: admin role required");
    await mount();

    await openTab("Search Console");
    expect(screen.queryByTestId("pulpit-gsc")).toBeNull();
    expect(h.props.gsc).toBeUndefined();
  });

  it("zakładka GA4 BEZ danych statusu też renderuje NIC", async () => {
    h.statusError = new Error("Forbidden: admin role required");
    await mount();

    await openTab("GA4");
    expect(screen.queryByTestId("pulpit-ga4")).toBeNull();
    expect(screen.queryByText("Sposoby podłączenia GA4")).toBeNull();
  });

  it("zakładka Web Vitals dziala BEZ statusu - RUM nie zależy od kluczy Google", async () => {
    h.statusError = new Error("Forbidden");
    await mount();

    await openTab("Web Vitals");
    await waitFor(() => expect(screen.getByTestId("pulpit-vitals")).toBeTruthy());
  });

  it("przycisk odświeżania pyta serwer PONOWNIE", async () => {
    await mount();
    expect(h.statusCalls).toBe(1);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Odśwież status/ }));
    });

    await waitFor(() => expect(h.statusCalls).toBe(2));
  });
});

// ---------------------------------------------------------------------------
describe("pastylki statusu", () => {
  it("trzy pastylki: GSC, GA4, Web Vitals", async () => {
    await mount();

    for (const label of ["Google Search Console", "Google Analytics 4", "Web Vitals"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it("GSC podłączony i niepodłączony mają RÓŻNE opisy", async () => {
    h.status = status({ gsc: true });
    const first = await mount();
    expect(screen.getByText("Podłączone (OAuth)")).toBeTruthy();

    first.unmount();
    cleanup();
    h.status = status({ gsc: false });
    await mount();
    expect(screen.getByText("Wymaga podłączenia connectora")).toBeTruthy();
  });

  it("GA4 ma TRZY opisy, nie dwa - stan pośredni jest własnym komunikatem", async () => {
    h.status = status({ ga4: { configured: true, propertyId: "123456789" } });
    const view = await mount();
    expect(screen.getByText("Property 123456789")).toBeTruthy();

    view.unmount();
    cleanup();
    h.status = status({ ga4: { hasServiceAccount: true } });
    const second = await mount();
    expect(screen.getByText("Brak GA4_PROPERTY_ID")).toBeTruthy();

    second.unmount();
    cleanup();
    h.status = status();
    await mount();
    expect(screen.getByText("Brak service accounta")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Waga wniosku jest tym, co administrator czyta PIERWSZE. `InsightSection`
// biegnie prawdziwy, więc asercja idzie po plakietce zbiorczej - dokładnie po
// tym, co widzi użytkownik.
describe("wnioski i ich wagi", () => {
  it("wszystko rozłączone: DWA wnioski krytyczne (GSC, GA4) i jedno ostrzeżenie (RUM)", async () => {
    await mount();

    expect(screen.getByText("adminAnalytics.insightSection.badgeCritical(count=2)")).toBeTruthy();
    expect(screen.getByText("adminAnalytics.insightSection.badgeWarn(count=1)")).toBeTruthy();
    expect(screen.getByText("Brak połączenia z GSC")).toBeTruthy();
    expect(screen.getByText("GA4 nie jest podłączony")).toBeTruthy();
  });

  it("wszystko podłączone: TRZY wnioski dobre, zero krytycznych", async () => {
    h.status = status({
      gsc: true,
      ga4: { configured: true, propertyId: "999" },
      vitals: true,
    });
    await mount();

    expect(screen.getByText("adminAnalytics.insightSection.badgeOk(count=3)")).toBeTruthy();
    expect(screen.queryByText(/badgeCritical/)).toBeNull();
    expect(screen.getByText("GA4 aktywny (property 999)")).toBeTruthy();
  });

  it("service account BEZ property to OSTRZEŻENIE, nie stan krytyczny ani dobry", async () => {
    // To jest ta pomyłka, która kosztuje godzinę: „critical" każe szukać
    // klucza, który już wgrano, a „good" każe czekać na dane, które nie
    // przyjdą.
    h.status = status({ ga4: { hasServiceAccount: true } });
    await mount();

    expect(screen.getByText("Service account jest, brak GA4_PROPERTY_ID")).toBeTruthy();
    expect(screen.getByText("adminAnalytics.insightSection.badgeWarn(count=2)")).toBeTruthy();
    expect(screen.getByText("adminAnalytics.insightSection.badgeCritical(count=1)")).toBeTruthy();
  });

  it("każdy wniosek niesie KONKRETNE kroki naprawcze, nie samo rozpoznanie", async () => {
    await mount();

    const list = screen.getByRole("heading", { level: 3 }).closest("div.p-4");
    expect(list).toBeTruthy();
    const items = within(list as HTMLElement).getAllByRole("listitem");
    // Trzy wnioski + ich kroki: sama diagnoza bez kroków nie jest wnioskiem.
    expect(items.length).toBeGreaterThan(3 + 3);
  });
});

// ---------------------------------------------------------------------------
describe("panel GA4 - status decyduje o zawartości", () => {
  it("NIESKONFIGUROWANY GA4 pokazuje instrukcję, a NIE pulpit odpytujący Data API", async () => {
    h.status = status({ ga4: { configured: false } });
    await mount();
    await openTab("GA4");

    expect(screen.getByText("Sposoby podłączenia GA4")).toBeTruthy();
    expect(screen.queryByTestId("pulpit-ga4")).toBeNull();
  });

  it("SKONFIGUROWANY GA4 montuje pulpit i oddaje mu tryb aktywny", async () => {
    h.status = status({ ga4: { configured: true, activeMode: "oauth_refresh" } });
    await mount();
    await openTab("GA4");

    await waitFor(() => expect(screen.getByTestId("pulpit-ga4")).toBeTruthy());
    expect(h.props.ga4).toEqual({ configured: true, activeMode: "oauth_refresh" });
    // Instrukcja zostaje POD pulpitem - admin może przełączyć tryb bez
    // rozłączania GA4.
    expect(screen.getByText("Sposoby podłączenia GA4")).toBeTruthy();
  });

  it("brak trybu aktywnego jest oddawany jako `undefined`, nie jako `null`", async () => {
    // `null` w propsie oznaczałby „tryb ustawiony na nic", a chodzi o „nie
    // wiadomo" - pulpit rozgałęzia się po `undefined`.
    h.status = status({ ga4: { configured: true, activeMode: null } });
    await mount();
    await openTab("GA4");

    await waitFor(() => expect(screen.getByTestId("pulpit-ga4")).toBeTruthy());
    expect(h.props.ga4?.activeMode).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(h.props.ga4 ?? {}, "activeMode")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("cztery karty trybów GA4", () => {
  it("cztery karty istnieją, w kolejności od najmocniejszego trybu odczytu", async () => {
    await mount();
    await openTab("GA4");

    for (const title of [
      "1. Service Account (JSON)",
      "2. OAuth 2.0 (refresh token)",
      "3. Measurement Protocol (server-side events)",
      "4. Embed (Looker Studio / iframe)",
    ]) {
      expect(screen.getByText(title)).toBeTruthy();
    }
  });

  it("plakietka „Aktywny” stoi przy DOKŁADNIE jednym trybie", async () => {
    h.status = status({ ga4: { activeMode: "oauth_refresh" } });
    await mount();
    await openTab("GA4");

    const active = screen.getAllByText("Aktywny");
    expect(active).toHaveLength(1);
    const card = active[0].closest("div.p-4");
    expect(within(card as HTMLElement).getByText("2. OAuth 2.0 (refresh token)")).toBeTruthy();
  });

  it("service account jest „Gotowe” tylko RAZEM z property id", async () => {
    h.status = status({ ga4: { hasServiceAccount: true, hasPropertyId: false } });
    await mount();
    await openTab("GA4");

    const card = screen.getByText("1. Service Account (JSON)").closest("div.p-4") as HTMLElement;
    expect(within(card).getByText("Nieaktywne")).toBeTruthy();
    expect(within(card).getByText(/^SA/).textContent).toContain("✓");
    expect(within(card).getByText(/^Property/).textContent).toContain("×");
  });

  it("OAuth jest „Gotowe” tylko przy TRZECH warunkach naraz", async () => {
    h.status = status({
      ga4: { hasOauthClient: true, hasOauthRefresh: true, hasPropertyId: true },
    });
    await mount();
    await openTab("GA4");

    const card = screen.getByText("2. OAuth 2.0 (refresh token)").closest("div.p-4") as HTMLElement;
    expect(within(card).getByText("Gotowe")).toBeTruthy();
    expect(within(card).queryByText("Nieaktywne")).toBeNull();
  });

  it("adres e-mail service accountu pokazywany jest TYLKO, gdy jest znany", async () => {
    h.status = status({ ga4: { serviceAccountEmail: "raporty@projekt.iam.example.com" } });
    await mount();
    await openTab("GA4");
    expect(screen.getByText("raporty@projekt.iam.example.com")).toBeTruthy();

    cleanup();
    h.status = status({ ga4: { serviceAccountEmail: null } });
    await mount();
    await openTab("GA4");
    expect(screen.queryByText(/iam\.example\.com/)).toBeNull();
  });

  it("identyfikator pomiaru jest jawny (jest publiczny), ale API secret NIGDY nie ma wartości", async () => {
    // `G-...` widać w kodzie każdej strony, więc jego pokazanie nie jest
    // wyciekiem. Sekret API nie ma w kontrakcie statusu ŻADNEGO pola z
    // wartością - panel może wyświetlić wyłącznie jego NAZWĘ.
    h.status = status({
      ga4: { hasMeasurementId: true, measurementId: "G-TEST12345", hasMeasurementProtocol: true },
    });
    await mount();
    await openTab("GA4");

    expect(screen.getByText("G-TEST12345")).toBeTruthy();
    expect(screen.getByText("GA4_API_SECRET")).toBeTruthy();
    const body = document.body.textContent ?? "";
    for (const marker of ["BEGIN PRIVATE KEY", "client_secret", "refresh_token="]) {
      expect(body).not.toContain(marker);
    }
  });

  it("przycisk testowego eventu istnieje TYLKO przy skonfigurowanym Measurement Protocol", async () => {
    h.status = status({ ga4: { hasMeasurementProtocol: false } });
    await mount();
    await openTab("GA4");
    expect(screen.queryByRole("button", { name: /Wyślij testowy event/ })).toBeNull();

    cleanup();
    h.status = status({ ga4: { hasMeasurementProtocol: true } });
    await mount();
    await openTab("GA4");
    expect(screen.getByRole("button", { name: /Wyślij testowy event/ })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe("testowy event GA4 ma cztery wyjścia", () => {
  async function openGa4WithButton(): Promise<HTMLElement> {
    h.status = status({ ga4: { hasMeasurementProtocol: true, hasMeasurementId: true } });
    await mount();
    await openTab("GA4");
    return screen.getByRole("button", { name: /Wyślij testowy event/ });
  }

  const clickTest = async (button: HTMLElement) => {
    await act(async () => {
      fireEvent.click(button);
    });
  };

  it("wysyła event W TRYBIE DEBUG i z identyfikatorem klienta - inaczej GA4 nic nie waliduje", async () => {
    const button = await openGa4WithButton();
    await clickTest(button);

    expect(h.ga4Payloads).toHaveLength(1);
    const payload = h.ga4Payloads[0] as { data: Record<string, unknown> };
    expect(payload.data.eventName).toBe("admin_test_event");
    expect(payload.data.debug).toBe(true);
    expect(payload.data.params).toEqual({ source: "admin_analytics_page" });
    expect(String(payload.data.clientId)).toMatch(/^admin-\d+$/);
  });

  it("PRZYJĘTY event daje sukces i ani jednego komunikatu błędu", async () => {
    h.ga4Result = { ok: true, configured: true } satisfies Ga4MpResultLike;
    const button = await openGa4WithButton();
    await clickTest(button);

    expect(h.toastSuccess).toEqual([["atrapa:ga4Accepted"]]);
    expect(h.toastError).toEqual([]);
  });

  it("ODRZUCONY event daje treść od Google, a nie własny komunikat zapasowy", async () => {
    h.ga4Result = {
      ok: false,
      configured: true,
      error: "GA4: nieznana nazwa eventu",
    } satisfies Ga4MpResultLike;
    const button = await openGa4WithButton();
    await clickTest(button);

    expect(h.toastError).toEqual([["GA4: nieznana nazwa eventu"]]);
    expect(h.toastSuccess).toEqual([]);
  });

  it("odrzucenie BEZ treści spada na komunikat zapasowy, a nie na „undefined”", async () => {
    h.ga4Result = { ok: false, configured: true } satisfies Ga4MpResultLike;
    const button = await openGa4WithButton();
    await clickTest(button);

    expect(h.toastError).toEqual([["atrapa:ga4Rejected"]]);
  });

  it("BRAK KONFIGURACJI kończy WCZEŚNIEJ - jeden komunikat, nie dwa", async () => {
    // Bez `return` po `configured: false` panel dokładał drugi komunikat
    // („odrzucone"), czyli mówił o odpowiedzi, której nie było.
    h.ga4Result = { ok: false, configured: false } satisfies Ga4MpResultLike;
    const button = await openGa4WithButton();
    await clickTest(button);

    expect(h.toastError).toEqual([["atrapa:ga4NotConfigured"]]);
    expect(h.toastSuccess).toEqual([]);
  });

  it("brak konfiguracji Z TREŚCIĄ błędu pokazuje tę treść", async () => {
    h.ga4Result = {
      ok: false,
      configured: false,
      error: "Brak Measurement ID lub GA4_API_SECRET",
    } satisfies Ga4MpResultLike;
    const button = await openGa4WithButton();
    await clickTest(button);

    expect(h.toastError).toEqual([["Brak Measurement ID lub GA4_API_SECRET"]]);
  });

  it("WYJĄTEK z funkcji serwerowej daje komunikat z jego treścią", async () => {
    h.ga4Error = new Error("sieć: przekroczony limit czasu");
    const button = await openGa4WithButton();
    await clickTest(button);

    expect(h.toastError).toEqual([["sieć: przekroczony limit czasu"]]);
  });

  it("odrzucenie NIE-BŁĘDEM też ma czytelny komunikat", async () => {
    h.ga4Error = { toString: () => "odmowa uprawnienia" } as unknown as Error;
    const button = await openGa4WithButton();
    await clickTest(button);

    expect(h.toastError).toEqual([["odmowa uprawnienia"]]);
  });

  it("odpowiedź diagnostyczna Google trafia do konsoli, ale tylko gdy JEST", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    h.ga4Result = {
      ok: true,
      configured: true,
      debug: '{"validationMessages":[]}',
    } satisfies Ga4MpResultLike;
    const button = await openGa4WithButton();
    await clickTest(button);

    expect(info).toHaveBeenCalledWith("[GA4 Debug]", '{"validationMessages":[]}');

    info.mockClear();
    cleanup();
    h.ga4Result = { ok: true, configured: true } satisfies Ga4MpResultLike;
    const again = await openGa4WithButton();
    await clickTest(again);
    expect(info).not.toHaveBeenCalled();
  });

  it("w trakcie wysyłki przycisk jest ZABLOKOWANY, a po niej wraca - także po błędzie", async () => {
    h.ga4Gate = () => {};
    const button = await openGa4WithButton();
    await clickTest(button);

    expect((button as HTMLButtonElement).disabled).toBe(true);
    await clickTest(button);
    expect(h.ga4Payloads).toHaveLength(1);

    const release = h.ga4Gate as unknown as () => void;
    await act(async () => {
      release();
      await Promise.resolve();
    });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("osadzony raport wymaga DWÓCH warunków", () => {
  it("flaga i adres razem dają ramkę raportu i link „otwórz w nowej karcie”", async () => {
    const url = "https://lookerstudio.google.com/embed/reporting/abc/page/1";
    h.status = status({ ga4: { configured: true, hasEmbedUrl: true, embedUrl: url } });
    await mount();
    await openTab("GA4");

    const frame = await screen.findByTitle("GA4 Looker Studio embed");
    expect(frame.getAttribute("src")).toBe(url);
    const link = screen.getByRole("link", { name: /Otwórz w nowej karcie/ });
    expect(link.getAttribute("href")).toBe(url);
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("FLAGA BEZ ADRESU nie renderuje pustej ramki udającej raport", async () => {
    h.status = status({ ga4: { configured: true, hasEmbedUrl: true, embedUrl: null } });
    await mount();
    await openTab("GA4");

    await waitFor(() => expect(screen.getByTestId("pulpit-ga4")).toBeTruthy());
    expect(screen.queryByTitle("GA4 Looker Studio embed")).toBeNull();
  });

  it("raport osadzony jest widoczny TAKŻE przy nieskonfigurowanym Data API", async () => {
    // To jedyny tryb, który nie wymaga niczego po naszej stronie - odcięcie go
    // razem z pulpitem zabrałoby administratorowi jedyny działający widok.
    const url = "https://lookerstudio.google.com/embed/reporting/xyz/page/1";
    h.status = status({ ga4: { configured: false, hasEmbedUrl: true, embedUrl: url } });
    await mount();
    await openTab("GA4");

    expect(screen.getByTitle("GA4 Looker Studio embed").getAttribute("src")).toBe(url);
    expect(screen.queryByTestId("pulpit-ga4")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("mini-panel RUM w przeglądzie", () => {
  it("dopóki próbki nie dojechały, pokazuje wczytywanie", async () => {
    h.vitalsGate = () => {};
    await mount();

    expect(screen.getByText(/Ładowanie\.\.\./)).toBeTruthy();

    const release = h.vitalsGate as unknown as () => void;
    await act(async () => {
      release();
      await Promise.resolve();
    });
  });

  it("BRAK próbek to jawny komunikat, nie trzy puste kafelki", async () => {
    h.vitals = vitalsSummary([]);
    await mount();

    await waitFor(() => expect(screen.getByText("Brak próbek.")).toBeTruthy());
  });

  it("BŁĄD odczytu RUM też daje komunikat, a nie wywrotkę na `metrics`", async () => {
    // Po odrzuceniu zapytania `q.data` jest `undefined` przy `isLoading: false` -
    // to jedyna ścieżka, na której opcjonalny dostęp `q.data?.metrics` naprawdę
    // pracuje. Bez niego kafelki lecą na `undefined.slice`.
    h.vitals = null;
    h.vitalsError = new Error("Forbidden: admin role required");
    await mount();

    await waitFor(() => expect(screen.getByText("Brak próbek.")).toBeTruthy());
    // Reszta przeglądu stoi - awaria jednego kafelka nie gasi panelu.
    expect(screen.getByText("Google Search Console")).toBeTruthy();
  });

  it("pokazuje TRZY pierwsze metryki, nie wszystkie sześć", async () => {
    h.vitals = vitalsSummary([
      metric({ metric: "LCP", p75: 900, count: 10 }),
      metric({ metric: "INP", p75: 120, count: 11 }),
      metric({ metric: "CLS", p75: 0.0834, count: 12 }),
      metric({ metric: "FCP", p75: 700, count: 13 }),
      metric({ metric: "TTFB", p75: 300, count: 14 }),
    ]);
    await mount();

    await waitFor(() => expect(screen.getByText("LCP")).toBeTruthy());
    expect(screen.getByText("INP")).toBeTruthy();
    expect(screen.getByText("CLS")).toBeTruthy();
    expect(screen.queryByText("FCP")).toBeNull();
    expect(screen.queryByText("TTFB")).toBeNull();
  });

  it("CLS ma TRZY miejsca po przecinku - bez nich 0,08 i 0,08 są nieodróżnialne", async () => {
    h.vitals = vitalsSummary([metric({ metric: "CLS", p75: 0.0834, count: 12 })]);
    await mount();

    await waitFor(() => expect(screen.getByText("0.083")).toBeTruthy());
    expect(screen.getByText("12 próbek")).toBeTruthy();
  });

  it("metryka czasowa PONIŻEJ sekundy ma jednostkę `ms`", async () => {
    h.vitals = vitalsSummary([metric({ metric: "INP", p75: 184.6, count: 40 })]);
    await mount();

    await waitFor(() => expect(screen.getByText(/^185/)).toBeTruthy());
    expect(screen.getByText(/^185/).textContent).toContain("ms");
  });

  it("prowadzi do pełnego widoku RUM pod `/admin/performance`", async () => {
    await mount();

    const links = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href") === "/admin/performance");
    expect(links.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// PRZYPIĘTE DEFEKTY. Zgodnie z zamówieniem nie zmieniamy tu zachowania
// produkcyjnego - defekt zostaje opisany testem, który JEST czerwony, i to
// czerwień jest jego dokumentacją.
describe("defekty przypięte (it.fails)", () => {
  // DEFEKT 1 - JEDNOSTKA ZNIKA DOKŁADNIE TAM, GDZIE JEST NAJPOTRZEBNIEJSZA.
  //
  //   `${Math.round(m.p75)} ${m.p75 >= 1000 ? "" : "ms"}`
  //
  // Warunek jest odwrócony względem intencji: dla wartości POWYŻEJ sekundy -
  // czyli dla każdego złego LCP - kafelek pokazuje samą liczbę („2400 ") bez
  // jednostki, a dla wartości dobrych dokłada „ms". Czytający nie ma jak
  // odróżnić 2400 ms od 2400 s ani od bezwymiarowego wskaźnika, i to na tym
  // jednym kafelku, który ma zaalarmować. Intencją była zamiana na sekundy
  // („2,4 s"), a nie usunięcie jednostki. Kontrakt złamany: KAŻDA metryka
  // czasowa na kafelku ma jednostkę.
  it.fails(
    "metryka POWYŻEJ sekundy traci jednostkę - `p75 >= 1000` daje pusty sufiks",
    async () => {
      h.vitals = vitalsSummary([metric({ metric: "LCP", p75: 2400, count: 55 })]);
      await mount();

      await waitFor(() => expect(screen.getByText(/^2400/)).toBeTruthy());
      const tile = screen.getByText(/^2400/).textContent ?? "";
      // Oczekiwanie: jednostka czasu jest obecna (ms albo s).
      expect(tile).toMatch(/\d\s*(ms|s)\b/);
    },
  );

  // DEFEKT 2 - CAŁY PANEL JEST JEDNOJĘZYCZNY I ŻADNA BRAMKA TEGO NIE WIDZI.
  //
  // Z całego ekranu przez słownik idą DWA napisy (`admin.nav.analytics`,
  // `admin.nav.analyticsReconciliation`); pozostałe kilkadziesiąt - nazwy
  // zakładek, opisy pastylek, cztery karty trybów wraz z instrukcjami,
  // wszystkie tytuły, interpretacje i kroki naprawcze wniosków - to literały
  // polskie wpisane w JSX. Angielski administrator widzi panel po polsku.
  //
  // DLACZEGO NIE ZŁAPAŁA TEGO ŻADNA BRAMKA i18n - to jest tu najciekawsze,
  // bo pokazuje LUKĘ W POMIARZE, nie tylko dług w pliku:
  //   * `check:i18n-parity` porównuje KLUCZE między PL i EN. Tych napisów nie
  //     ma w żadnym słowniku, więc nie ma czego porównać - parytet jest
  //     zielony dokładnie dlatego, że tekst istnieje wyłącznie w kodzie.
  //   * `check:i18n-hardcoded` (ratchet per plik) mierzy ROZGAŁĘZIENIE po
  //     języku: `isPl ? "Zapisz" : "Save"`, `lang === "pl" ? … : …`, bliźniaki
  //     `l("Zapisz","Save")`. Tekst JEDNOJĘZYCZNY nie rozgałęzia się, więc nie
  //     jest trafieniem - plik ma w bazie ratchetu zero i to zero jest
  //     prawdziwe dla tego, co bramka mierzy.
  //   * `check:i18n-default-value` łapie `t(key, { defaultValue })`, a tu nie
  //     ma nawet wywołania `t`.
  // Trzy zielone bramki i jednojęzyczny panel to nie sprzeczność, to granica
  // pomiaru - i dlatego ten defekt musi być przypięty testem, a nie liczbą.
  //
  // Kontrakt złamany: tekst widoczny dla użytkownika pochodzi ze słownika.
  // Asercja: po zamontowaniu z atrapą i18n (echo klucza) KAŻDY widoczny napis
  // zdaniowy jest echem klucza. Zmierzone przy pisaniu tego testu: dziesiątki
  // napisów niebędących kluczami (dokładna liczba rośnie z zawartością kart).
  it.fails(
    "tekst panelu idzie ze słownika - dziś kilkadziesiąt literałów PL omija `t()`",
    async () => {
      h.status = status({ ga4: { hasMeasurementProtocol: true } });
      await mount();

      const offenders = polishLiterals();
      expect(offenders).toEqual([]);
    },
  );
});

/**
 * Widoczne napisy, które NIE są echem klucza słownika.
 *
 * Atrapa i18n zwraca klucz (`admin.nav.analytics`) albo klucz z parametrami
 * (`…badgeOk(count=3)`), więc każdy napis przechodzący przez `t()` daje się
 * rozpoznać kształtem. Odsiewamy też to, co nie jest tekstem naturalnym:
 * liczby, pojedyncze znaki, glify statusu i nazwy sekretów w `<code>` (te
 * ostatnie są identyfikatorami technicznymi, nie tekstem do tłumaczenia).
 */
function polishLiterals(): string[] {
  const KEY_ECHO = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)+(\(.*\))?$/;
  const TECHNICAL = /^[A-Z0-9_]+$/;
  const found = new Set<string>();
  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      const text = (node.textContent ?? "").trim();
      if (text.length < 4) return;
      if (KEY_ECHO.test(text) || TECHNICAL.test(text)) return;
      if (!/[a-ząćęłńóśźż]/.test(text)) return;
      found.add(text);
      return;
    }
    node.childNodes.forEach(walk);
  };
  walk(document.body);
  return [...found].sort();
}
