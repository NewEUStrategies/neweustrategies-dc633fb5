// `AdminBiStrip` - kompaktowy pasek BI na /admin i /admin/community: pomiar,
// awaria odczytu i zmierzone zero to TRZY stany, nie jeden.
//
// PO CO. Pasek stał bez testu, a jego defekt był dokładnie tej klasy, której
// pilnują pełne dashboardy: `String(vitalsQ.data?.windowTotal ?? 0)` malowało
// „Próbki RUM: 0" w trakcie pobierania i po KAŻDEJ awarii odczytu, bo pasek
// nie czytał `isError` wcale. Od 2026-10 obie funkcje serwerowe
// (`getVitalsSummary`, `getClientErrorsReport`) odrzucają wywołanie przy
// awarii odczytu zamiast oddawać zera - ten plik dowodzi, że pasek tego
// odrzucenia nie zamienia z powrotem w zero:
//
//   1. POMIAR W TOKU to napis „Pomiar" na KAŻDYM kafelku, nie „0".
//   2. ZMIERZONE ZERO to „0" (i kreska przy LCP bez próbek) - bez karty awarii.
//   3. AWARIA jednego źródła to „Awaria odczytu" na JEGO kafelkach i jedna
//      karta `role="alert"` z przyczyną; drugie źródło stoi z liczbami.
//   4. AWARIA ODŚWIEŻENIA nie zostawia starej liczby - react-query trzyma
//      poprzednie `data` obok `error`, więc pasek musi je świadomie pominąć.
//   5. NAJEMCA W KLUCZU: bez ustalonego najemcy nic się nie pobiera (kafelki
//      mówią „Pomiar"), a po przełączeniu obszaru roboczego cache nie oddaje
//      liczb poprzedniego (`@/lib/analytics/queryKeys`).
//   6. TYLKO ADMIN NAJEMCY: redaktor, autor, `super_admin` bez wiersza `admin`
//      i sesja z rolami w drodze nie pytają serwera i nie widzą paska - ani
//      karty „Awaria odczytu: Forbidden", którą do 2026-10 dostawał każdy
//      redaktor na /admin i /admin/community.
//
// `ChartCard` JEST TU ATRAPĄ, inaczej niż w pełnych dashboardach: pasek nie
// buduje żadnej własnej alternatywy tekstowej, a przedmiotem dowodu są serie
// oddane karcie (puste po awarii, pełne po odczycie). Atrapa zapisuje propsy
// i rysuje nazwany region - bez silnika, więc napisy wykresu nie zderzają się
// z etykietami kafelków.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { VitalsSummaryResult } from "@/lib/observability/vitals.functions";
import type { ClientErrorsReport } from "@/lib/observability/clientErrorsAggregate";
import type { VitalMetricSummary } from "@/lib/observability/aggregate";
import type { Role } from "@/hooks/useAuth";
import { freezeClock } from "@/test/time";

interface CapturedCard {
  title: string;
  csv?: { rows: readonly (readonly unknown[])[] };
}

// Zegar zamrożony (`check:clock-freeze`): fikstury niosą dni "2026-10-01".
// Pasek ich nie filtruje względem "teraz" - to etykiety osi i wiersze CSV -
// ale bez zamrożenia plik byłby zapalnikiem, gdyby kiedyś zaczął.
freezeClock();

const TENANT_A = "tenant-strip-a";
const TENANT_B = "tenant-strip-b";

const h = vi.hoisted(() => ({
  fetchVitals: vi.fn(),
  fetchErrors: vi.fn(),
  cards: [] as CapturedCard[],
  tenantId: null as string | null,
  auth: { roles: [] as Role[], loading: false },
}));

// Najemca jest ATRAPĄ (wzór: `vitalsBiDashboard.test.tsx`): prawdziwy
// `useCurrentTenantId` ciągnie klienta Supabase i sesję `useAuth`, a tu
// dowodzimy tylko, że identyfikator wchodzi do klucza i bramkuje odczyt.
vi.mock("@/lib/tenant", () => ({
  useCurrentTenantId: () => h.tenantId,
}));

// Role też są ATRAPĄ - z tego samego powodu: prawdziwy `useAuth` to sesja
// Supabase. Pasek czyta z niego wyłącznie `roles` i `loading`, więc atrapa
// podaje dokładnie te dwa pola (sterowane per przypadek przez `h.auth`).
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => h.auth,
}));

// `useServerFn` staje się tożsamością - wywołanie idzie prosto do atrapy.
// Mock CZĘŚCIOWY, bo `@/lib/i18n` ciągnie z tego samego pakietu
// `createIsomorphicFn`, a pełna atrapa wywracałaby inicjalizację słownika.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));

vi.mock("@/lib/observability/vitals.functions", () => ({
  getVitalsSummary: (...args: unknown[]) => h.fetchVitals(...args),
}));
vi.mock("@/lib/observability/clientErrors.functions", () => ({
  getClientErrorsReport: (...args: unknown[]) => h.fetchErrors(...args),
}));

// `Link` bez routera - pasek osadzają trasy, a tu sprawdzamy sam pasek.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("../ChartCard", () => ({
  ChartCard: (props: CapturedCard) => {
    h.cards.push(props);
    return <section aria-label={props.title} />;
  },
}));

// `react-i18next` NIE JEST atrapowany: napisy kafelków i karty awarii mają
// przychodzić ZE SŁOWNIKA (nakładkę `i18n-admin-analytics` importuje sam pasek).
import "@/test/i18nReal";
import { realT } from "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { analyticsBiStripKey } from "@/lib/analytics/queryKeys";
import { AdminBiStrip } from "../AdminBiStrip";

// ---------------------------------------------------------------------------
// Słownik i odczyt kafelków
// ---------------------------------------------------------------------------

function bi(path: string): string {
  return realT("pl")(`adminAnalytics.bi.${path}`);
}
function common(path: string, vars: Record<string, unknown> = {}): string {
  return realT("pl")(`adminAnalytics.common.${path}`, vars);
}

/** Wartość kafelka KPI - element tuż za etykietą. */
function tile(kpi: "samples" | "lcp" | "errors" | "errorGroups"): string | null | undefined {
  return screen.getByText(bi(`kpi.${kpi}`), { exact: true }).nextElementSibling?.textContent;
}

/** Ostatnie propsy karty wykresu o danym tytule - to, co pasek oddał przy ostatnim renderze. */
function lastCard(chart: "lcpTrend" | "errorsDaily"): CapturedCard {
  const title = bi(`charts.${chart}`);
  const found = h.cards.filter((c) => c.title === title).at(-1);
  if (!found) throw new Error(`test: karta „${title}” nie została wyrenderowana`);
  return found;
}

// ---------------------------------------------------------------------------
// Dane
// ---------------------------------------------------------------------------

function lcpMetric(p75: number): VitalMetricSummary {
  return {
    metric: "LCP",
    count: 40,
    p75,
    p50: p75 - 300,
    min: 400,
    max: 5200,
    good: 20,
    needsImprovement: 15,
    poor: 5,
    rating: "needs-improvement",
  };
}

function vitals(patch: Partial<VitalsSummaryResult> = {}): VitalsSummaryResult {
  return {
    windowDays: 14,
    total: 0,
    metrics: [],
    paths: [],
    trends: [],
    windowTotal: 0,
    capped: false,
    ...patch,
  };
}

function errors(patch: Partial<ClientErrorsReport> = {}): ClientErrorsReport {
  return {
    windowDays: 14,
    total: 0,
    windowTotal: 0,
    capped: false,
    uniqueGroups: 0,
    affectedPaths: 0,
    last24h: 0,
    daily: [],
    groups: [],
    ...patch,
  };
}

const VITALS_42 = vitals({
  total: 42,
  windowTotal: 42,
  metrics: [lcpMetric(2345.6)],
  trends: [{ day: "2026-10-01", p75: { LCP: 2345.6 } }],
});

function strip(days?: number, showLink?: boolean) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Fabryka, nie jeden element: React pomija render elementu o tej samej
  // referencji, a ponowny render ma odczytać nowego najemcę.
  const tree = () => (
    <QueryClientProvider client={queryClient}>
      <AdminBiStrip days={days} showLink={showLink} />
    </QueryClientProvider>
  );
  const utils = render(tree());
  return {
    ...utils,
    queryClient,
    /** Ponowny render tych samych propsów na tym samym cache - np. po zmianie najemcy. */
    rerenderStrip: () => utils.rerender(tree()),
  };
}

/** Czeka, aż OBA zapytania wyjdą ze stanu pomiaru. */
async function settled(): Promise<void> {
  await waitFor(() => {
    expect(h.fetchVitals).toHaveBeenCalled();
    expect(h.fetchErrors).toHaveBeenCalled();
  });
  await waitFor(() => expect(screen.queryByText(common("measuringShort"))).toBeNull());
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.cards.length = 0;
  h.tenantId = TENANT_A;
  // Domyślnie ADMIN najemcy - zachowanie paska, którego dotyczy większość
  // przypadków. Pozostałe role mają własną sekcję na końcu pliku.
  h.auth = { roles: ["admin"], loading: false };
  h.fetchVitals.mockReset();
  h.fetchErrors.mockReset();
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------

describe("AdminBiStrip - pomiar, awaria i zmierzone zero", () => {
  it("w trakcie pomiaru żaden kafelek nie maluje zera", async () => {
    h.fetchVitals.mockImplementation(() => new Promise<VitalsSummaryResult>(() => {}));
    h.fetchErrors.mockImplementation(() => new Promise<ClientErrorsReport>(() => {}));
    strip();
    await waitFor(() => expect(h.fetchVitals).toHaveBeenCalled());

    for (const kpi of ["samples", "lcp", "errors", "errorGroups"] as const) {
      expect(tile(kpi)).toBe(common("measuringShort"));
    }
    // „Jeszcze nie wiem" to nie awaria - karta alarmu nie ma prawa wisieć.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("zmierzone zero to „0”, LCP bez próbek to kreska, bez karty awarii", async () => {
    h.fetchVitals.mockResolvedValue(vitals());
    h.fetchErrors.mockResolvedValue(errors());
    strip();
    await settled();

    expect(tile("samples")).toBe("0");
    // Kreska to luka ZMIERZONEGO okna, a nie „Pomiar" ani „Awaria odczytu".
    expect(tile("lcp")).toBe("-");
    expect(tile("errors")).toBe("0");
    expect(tile("errorGroups")).toBe("0");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("awaria odczytu RUM: kafelki RUM mówią „Awaria odczytu”, karta podaje przyczynę, błędy stoją z liczbą", async () => {
    const reason = 'relation "public.web_vitals" does not exist';
    h.fetchVitals.mockRejectedValue(new Error(reason));
    h.fetchErrors.mockResolvedValue(
      errors({ windowTotal: 7, uniqueGroups: 2, daily: [{ day: "2026-10-01", count: 7 }] }),
    );
    strip();
    await settled();

    expect(tile("samples")).toBe(common("readFailedShort"));
    expect(tile("lcp")).toBe(common("readFailedShort"));
    // Źródła są niezależne: awaria RUM nie gasi liczb błędów przeglądarki.
    expect(tile("errors")).toBe("7");
    expect(tile("errorGroups")).toBe("2");

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(common("readFailedReason", { reason }));
    expect(alert).toHaveTextContent(common("readFailedHint"));

    // Wykres awarii dostaje PUSTĄ serię (silnik rysuje własną pustą ramę),
    // wykres zdrowego źródła - swoje dni.
    expect(lastCard("lcpTrend").csv?.rows).toEqual([]);
    expect(lastCard("errorsDaily").csv?.rows).toEqual([["2026-10-01", 7]]);
  });

  it("awaria odczytu błędów przeglądarki - lustrzanie", async () => {
    h.fetchVitals.mockResolvedValue(VITALS_42);
    h.fetchErrors.mockRejectedValue(new Error("statement timeout"));
    strip();
    await settled();

    expect(tile("errors")).toBe(common("readFailedShort"));
    expect(tile("errorGroups")).toBe(common("readFailedShort"));
    expect(tile("samples")).toBe("42");
    expect(tile("lcp")).toBe("2346 ms");
    expect(screen.getByRole("alert")).toHaveTextContent("statement timeout");
    expect(lastCard("errorsDaily").csv?.rows).toEqual([]);
    expect(lastCard("lcpTrend").csv?.rows).toEqual([["2026-10-01", 2345.6]]);
  });

  it("awaria przy ODŚWIEŻENIU nie zostawia starej liczby", async () => {
    // react-query trzyma poprzednie `data` obok świeżego `error`. Bez
    // świadomego pominięcia kafelek pokazywałby „42" z poprzedniego odczytu
    // jako bieżący pomiar - obok karty, która mówi, że odczytu nie było.
    h.fetchVitals.mockResolvedValue(VITALS_42);
    h.fetchErrors.mockResolvedValue(errors());
    const { queryClient } = strip();
    await settled();
    expect(tile("samples")).toBe("42");

    h.fetchVitals.mockRejectedValue(new Error("statement timeout"));
    await act(() => queryClient.refetchQueries());

    // React Query odkłada powiadomienie obserwatorów przez `notifyManager`,
    // więc czekamy na STAN EKRANU, a nie na liczbę mikrotasków.
    await waitFor(() => expect(tile("samples")).toBe(common("readFailedShort")));
    expect(tile("lcp")).toBe(common("readFailedShort"));
    expect(screen.getByRole("alert")).toHaveTextContent("statement timeout");
    expect(lastCard("lcpTrend").csv?.rows).toEqual([]);
  });

  it("odrzucenie bez komunikatu podaje „przyczyna nieznana”", async () => {
    h.fetchVitals.mockRejectedValue(new Error(""));
    h.fetchErrors.mockResolvedValue(errors());
    strip();
    await settled();

    expect(screen.getByRole("alert")).toHaveTextContent(
      common("readFailedReason", { reason: common("unknownReason") }),
    );
  });

  it("odrzucenie, które NIE jest `Error`, też dostaje „przyczyna nieznana”", async () => {
    h.fetchVitals.mockResolvedValue(vitals());
    h.fetchErrors.mockRejectedValue({ code: "PGRST205" });
    strip();
    await settled();

    expect(tile("errors")).toBe(common("readFailedShort"));
    expect(screen.getByRole("alert")).toHaveTextContent(
      common("readFailedReason", { reason: common("unknownReason") }),
    );
  });

  it("karta awarii nie wnosi naruszeń axe", async () => {
    h.fetchVitals.mockRejectedValue(new Error('relation "public.web_vitals" does not exist'));
    h.fetchErrors.mockResolvedValue(errors({ windowTotal: 7, uniqueGroups: 2 }));
    const { container } = strip();
    await settled();
    await screen.findByRole("alert");

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("zapytania niosą okno z propsa", async () => {
    h.fetchVitals.mockResolvedValue(vitals());
    h.fetchErrors.mockResolvedValue(errors());
    strip(30);
    await settled();

    expect(h.fetchVitals).toHaveBeenCalledWith({ data: { days: 30 } });
    expect(h.fetchErrors).toHaveBeenCalledWith({ data: { days: 30 } });
  });
});

describe("AdminBiStrip - najemca w kluczu zapytań", () => {
  it("bez ustalonego najemcy nic się nie pobiera, a kafelki mówią „Pomiar”", async () => {
    h.tenantId = null;
    h.fetchVitals.mockResolvedValue(VITALS_42);
    h.fetchErrors.mockResolvedValue(errors());
    const { queryClient } = strip();
    // Dajemy react-query pełny obrót pętli - wyłączone zapytanie i tak nie ruszy.
    await act(async () => {});

    expect(h.fetchVitals).not.toHaveBeenCalled();
    expect(h.fetchErrors).not.toHaveBeenCalled();
    for (const kpi of ["samples", "lcp", "errors", "errorGroups"] as const) {
      expect(tile(kpi)).toBe(common("measuringShort"));
    }
    expect(screen.queryByRole("alert")).toBeNull();
    // Klucz-zaślepka z pustym najemcą nie dostał żadnych danych.
    for (const query of queryClient.getQueryCache().getAll()) {
      expect(query.state.data).toBeUndefined();
    }
  });

  it("oba zapytania niosą najemcę w kluczu (fabryka `analyticsBiStripKey`)", async () => {
    h.fetchVitals.mockResolvedValue(vitals());
    h.fetchErrors.mockResolvedValue(errors());
    const { queryClient } = strip(30);
    await settled();

    const keys = queryClient
      .getQueryCache()
      .getAll()
      .map((q) => q.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        analyticsBiStripKey(TENANT_A, "vitals", 30),
        analyticsBiStripKey(TENANT_A, "errors", 30),
      ]),
    );
    for (const key of keys) expect(key[1]).toBe(TENANT_A);
  });

  it("po przełączeniu najemcy pasek nie pokazuje liczb poprzedniego z cache'u", async () => {
    h.fetchVitals.mockResolvedValue(VITALS_42);
    h.fetchErrors.mockResolvedValue(errors({ windowTotal: 7, uniqueGroups: 2 }));
    const { rerenderStrip } = strip();
    await settled();
    expect(tile("samples")).toBe("42");
    expect(tile("errors")).toBe("7");

    // Ten sam klient cache, inny obszar roboczy; odczyt nowego wisi.
    h.tenantId = TENANT_B;
    h.fetchVitals.mockImplementation(() => new Promise<VitalsSummaryResult>(() => {}));
    h.fetchErrors.mockImplementation(() => new Promise<ClientErrorsReport>(() => {}));
    rerenderStrip();

    await waitFor(() => expect(h.fetchVitals).toHaveBeenCalledTimes(2));
    expect(h.fetchErrors).toHaveBeenCalledTimes(2);
    for (const kpi of ["samples", "lcp", "errors", "errorGroups"] as const) {
      expect(tile(kpi)).toBe(common("measuringShort"));
    }
  });
});

describe("AdminBiStrip - odnośnik do pełnego panelu", () => {
  it("domyślnie prowadzi do /admin/analytics/bi", async () => {
    h.fetchVitals.mockResolvedValue(vitals());
    h.fetchErrors.mockResolvedValue(errors());
    strip();
    await settled();

    expect(screen.getByRole("link", { name: bi("openFull") })).toHaveAttribute(
      "href",
      "/admin/analytics/bi",
    );
  });

  it("`showLink={false}` zdejmuje odnośnik, a kafelki zostają", async () => {
    h.fetchVitals.mockResolvedValue(vitals());
    h.fetchErrors.mockResolvedValue(errors());
    strip(14, false);
    await settled();

    expect(screen.queryByRole("link")).toBeNull();
    expect(tile("samples")).toBe("0");
  });
});

describe("AdminBiStrip - widzi go tylko admin najemcy", () => {
  // Odmowa bramki to tutaj TEN SAM tekst, który serwer oddaje redaktorowi.
  // Gdyby pasek mimo roli zapytał, karta awarii pokazałaby właśnie go.
  const FORBIDDEN = "Forbidden: admin role required";

  function odmowaSerwera(): void {
    h.fetchVitals.mockRejectedValue(new Error(FORBIDDEN));
    h.fetchErrors.mockRejectedValue(new Error(FORBIDDEN));
  }

  it.each<[string, Role[]]>([
    ["redaktor", ["editor"]],
    ["autor", ["author"]],
    ["redaktor i autor", ["editor", "author"]],
    ["zalogowany bez roli redakcyjnej", []],
    // `isAdmin` z `useAuth` liczy `super_admin`, ale `requireAnalyticsAdmin`
    // pyta wyłącznie o `admin` - pasek idzie za bramką serwera.
    ["super_admin bez wiersza admin", ["super_admin"]],
  ])("%s: zero zapytań, zero paska, zero karty awarii", async (_, roles) => {
    h.auth = { roles, loading: false };
    odmowaSerwera();
    const { container, queryClient } = strip();
    // Pełny obrót pętli - wyłączone zapytanie i tak nie ruszy.
    await act(async () => {});

    expect(h.fetchVitals).not.toHaveBeenCalled();
    expect(h.fetchErrors).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(new RegExp(FORBIDDEN))).toBeNull();
    expect(screen.queryByText(common("readFailedShort"))).toBeNull();
    expect(screen.queryByText(bi("stripTitle"))).toBeNull();
    for (const query of queryClient.getQueryCache().getAll()) {
      expect(query.state.data).toBeUndefined();
      expect(query.state.error).toBeNull();
    }
  });

  it("role w drodze: nic się nie pobiera i nic nie miga - pasek wchodzi dopiero z rolą", async () => {
    // Tak wygląda zalogowana sesja przed powrotem `user_roles`: `loading`
    // i pusty zestaw ról (`useAuth` zeruje role przy zmianie tożsamości).
    h.auth = { roles: [], loading: true };
    h.fetchVitals.mockResolvedValue(VITALS_42);
    h.fetchErrors.mockResolvedValue(errors());
    const { container, rerenderStrip } = strip();
    await act(async () => {});

    expect(h.fetchVitals).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();

    // Role dojechały - ten sam komponent (bez ponownego montażu) zaczyna
    // pytać, więc kolejność hooków nie zależy od roli.
    h.auth = { roles: ["admin"], loading: false };
    rerenderStrip();
    await settled();
    expect(tile("samples")).toBe("42");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("`loading` wygrywa z rolą: dopóki tożsamość nie jest rozstrzygnięta, pasek nie pyta", async () => {
    h.auth = { roles: ["admin"], loading: true };
    const { container } = strip();
    await act(async () => {});

    expect(h.fetchVitals).not.toHaveBeenCalled();
    expect(h.fetchErrors).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it.each<[string, Role[]]>([
    ["admin", ["admin"]],
    ["admin i super_admin", ["super_admin", "admin"]],
  ])("%s: pasek pyta oba źródła i rysuje kafelki", async (_, roles) => {
    h.auth = { roles, loading: false };
    h.fetchVitals.mockResolvedValue(VITALS_42);
    h.fetchErrors.mockResolvedValue(errors({ windowTotal: 7, uniqueGroups: 2 }));
    strip();
    await settled();

    expect(screen.getByRole("heading", { name: bi("stripTitle") })).toBeInTheDocument();
    expect(tile("samples")).toBe("42");
    expect(tile("errors")).toBe("7");
  });

  it("admin bez ustalonego najemcy nadal widzi neutralny „Pomiar”, nie pustkę", async () => {
    // Rola rozstrzyga, CZY pasek istnieje; najemca - czy już pyta. Te dwa
    // warunki są rozłączne: admin z najemcą w drodze widzi pomiar w toku.
    h.tenantId = null;
    strip();
    await act(async () => {});

    expect(h.fetchVitals).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: bi("stripTitle") })).toBeInTheDocument();
    expect(tile("samples")).toBe(common("measuringShort"));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
