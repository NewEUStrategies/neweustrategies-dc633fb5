/**
 * Trasa `/admin/community/` ZAMONTOWANA - pulpit społeczności: dwanaście
 * kafelków metryk, dziesięć globalnych przełączników modułów, TTL wiadomości,
 * dwie akcje serwisowe i kolejka zgłoszeń użytkowników. Przed tym plikiem
 * 0/58 linii i 0/33 funkcji.
 *
 * GDZIE NAPRAWDĘ STOI BRAMKA UPRAWNIEŃ - USTALENIE, NIE ZAŁOŻENIE.
 * Zlecenie brzmiało „użytkownik bez roli sztabowej nie widzi panelu". Zanim
 * powstał ten plik, sprawdziłem, gdzie ten warunek FAKTYCZNIE mieszka:
 *
 *   1. `src/routes/admin.tsx` (wspólny layout `/admin`) - JEDYNA bramka
 *      renderu dla wszystkich tras panelu: `useAuth()` daje `isStaff`, efekt
 *      robi `navigate({ to: "/login" })`, a komponent zwraca `null`.
 *   2. `src/routes/admin.community.tsx` - tylko podnawigacja i `<Outlet/>`,
 *      zero warunku roli.
 *   3. TA trasa - zero warunku roli. Nie ma `useAuth`, nie ma `beforeLoad`,
 *      nie ma `redirect` ani `<Navigate/>`.
 *   4. Warstwa danych - i to jest tutaj RÓŻNICA wobec siostrzanej trasy ankiet.
 *      Trzy z czterech odczytów pulpitu (`admin_community_stats`,
 *      `admin_network_stats`, `admin_list_user_reports`) i obie akcje
 *      serwisowe idą przez RPC `SECURITY DEFINER`, które SAME sprawdzają
 *      `is_staff()` i SAME wyznaczają tenanta z `auth.uid()`. Panel nie
 *      przekazuje im ani roli, ani tenanta - nie ma czym skłamać.
 *
 * Dlatego NIE MA tu testu „bez roli nie widzi panelu" udającego dowód na
 * poziomie tej trasy: taki test albo mierzyłby atrapę `useAuth`, której ta
 * trasa nawet nie woła, albo przechodziłby zawsze. Zamiast tego są asercje
 * mierzące TO, CO JEST. Dowodu na sam layout `/admin` tu NIE DUBLUJEMY -
 * pilnuje go `adminRouteAuthority.gate.test.ts` dla wszystkich tras panelu
 * naraz.
 *
 * WIELOTENANTOWOŚĆ. Pulpit nie wysyła ŻADNEGO identyfikatora tenanta:
 * `fetchCommunityStats()`, `fetchNetworkStats()` i `fetchUserReports("open")`
 * to wywołania bez parametru tenanta, a każdy z tych RPC ma w ciele
 * `tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id =
 * auth.uid())`. Test renderujący na atrapie tego nie udowodni - może
 * udowodnić dokładnie dwie rzeczy i obie tu są: (a) panel nie dokłada
 * własnego, konkurencyjnego argumentu tenanta, (b) pokazuje wyłącznie to, co
 * oddała warstwa. Trzecia połowa dowodu idzie odczytem migracji.
 *
 * KAFELEK BEZ DANYCH POKAZUJE „-", NIE „0". To jest tu osobny przedmiot
 * dowodu, bo zero na kafelku „Pytania czek." znaczy „kolejka pusta, nic nie
 * czeka" - a to nieprawda, gdy odczyt w ogóle nie doszedł. `StatCard` robi
 * `value ?? "-"`, więc kontrakt jest spełniony; ten plik go PRZYPINA, dla obu
 * grup kafelków osobno (metryki społeczności i metryki sieci liczą się
 * z dwóch różnych zapytań i mogą paść niezależnie).
 *
 * NAWIGACJA DO PODSTRON MIESZKA POZA TĄ TRASĄ. Pulpit nie ma ani jednego
 * `<Link/>`; zakładki (`chat`, `kluby`, `Q&A`, `ankiety`, `współtwórcy`,
 * `odznaki`, `powiadomienia`, `zaangażowanie`) renderuje `CommunitySubNav`
 * montowany przez layout `admin.community.tsx`. Harness montuje POJEDYNCZĄ
 * trasę pod zastępczym korzeniem, więc renderem nie da się tego tutaj
 * dosięgnąć - dowód idzie odczytem plików i mówi wprost, gdzie ta nawigacja
 * jest.
 *
 * CO JEST ATRAPĄ I DLACZEGO: dwie granice danych (`@/lib/admin/community`,
 * `@/lib/admin/network`), toasty (`sonner`) i SILNIK WYKRESU
 * (`@/components/admin/analytics/EChart`) - ten ostatni dlatego, że happy-dom
 * nie ma canvasu, a nie po to, żeby cokolwiek ukryć; uzasadnienie stoi przy
 * samej atrapie. i18n, router, react-query i Radix są PRAWDZIWE, więc asercje
 * mierzą napisy ze słownika, a nie literały wpisane w teście. Prawdziwy jest
 * też cały `AdminBiStrip` z kartami wykresów - to stamtąd bierze się nagłówek
 * poziomu drugiego, którego ten pulpit kiedyś nie miał.
 * `react-i18next` świadomie NIE
 * jest atrapowany - fabryka takiego mocka sięga po `@/lib/i18n`, czyli moduł
 * importujący właśnie mockowany pakiet, i zakleszcza plik (ostrzeżenie
 * z nagłówka `@/test/i18nReal`).
 *
 * RODO: żadnych prawdziwych osób ani treści - nazwy zgłaszających
 * i zgłaszanych oraz treści zgłoszeń są zmyślone i oczywiście fikcyjne.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import type { CommunityModulesSettings, CommunityStats } from "@/lib/admin/community";
import type { NetworkStats, UserReportRow } from "@/lib/admin/network";

const h = vi.hoisted(() => ({
  stats: null as CommunityStats | null,
  statsFails: false,
  statsCalls: 0,
  modules: null as CommunityModulesSettings | null,
  modulesFails: false,
  savedPatches: [] as Partial<CommunityModulesSettings>[],
  saveFails: false,
  networkStats: null as NetworkStats | null,
  networkFails: false,
  networkArgs: [] as unknown[],
  reports: [] as UserReportRow[],
  reportsFails: false,
  reportsCalls: [] as string[],
  resolveCalls: [] as { id: string; action: string }[],
  resolveFails: false,
  purgeCalls: 0,
  purgeCount: 0,
  purgeHolds: false,
  releasePurge: null as (() => void) | null,
  purgeFails: false,
  remindersCalls: 0,
  remindersCount: 0,
  remindersHolds: false,
  releaseReminders: null as (() => void) | null,
  remindersFails: false,
  toastSuccess: [] as string[],
  toastError: [] as string[],
}));

// Granica danych numer jeden: metryki, toggle modułów i akcje serwisowe.
vi.mock("@/lib/admin/community", () => ({
  fetchCommunityStats: async (): Promise<CommunityStats> => {
    h.statsCalls += 1;
    if (h.statsFails) throw new Error("test: odczyt metryk odrzucony");
    if (!h.stats) throw new Error("test: fixture metryk nieustawiony");
    return h.stats;
  },
  fetchCommunityModules: async (): Promise<CommunityModulesSettings> => {
    if (h.modulesFails) throw new Error("test: odczyt modułów odrzucony");
    if (!h.modules) throw new Error("test: fixture modułów nieustawiony");
    return h.modules;
  },
  updateCommunityModules: async (
    patch: Partial<CommunityModulesSettings>,
  ): Promise<CommunityModulesSettings> => {
    h.savedPatches.push(patch);
    if (h.saveFails) throw new Error("test: zapis modułów odrzucony");
    if (!h.modules) throw new Error("test: fixture modułów nieustawiony");
    const next = { ...h.modules, ...patch };
    h.modules = next;
    return next;
  },
  purgeExpiredMessages: async (): Promise<number> => {
    h.purgeCalls += 1;
    if (h.purgeHolds) {
      await new Promise<void>((resolve) => {
        h.releasePurge = resolve;
      });
    }
    if (h.purgeFails) throw new Error("test: purge odrzucony");
    return h.purgeCount;
  },
  runEventReminders: async (): Promise<number> => {
    h.remindersCalls += 1;
    if (h.remindersHolds) {
      await new Promise<void>((resolve) => {
        h.releaseReminders = resolve;
      });
    }
    if (h.remindersFails) throw new Error("test: przypomnienia odrzucone");
    return h.remindersCount;
  },
}));

// Granica danych numer dwa: metryki sieci kontaktów i kolejka zgłoszeń.
vi.mock("@/lib/admin/network", () => ({
  fetchNetworkStats: async (...args: unknown[]): Promise<NetworkStats | null> => {
    h.networkArgs.push(args);
    if (h.networkFails) throw new Error("test: odczyt metryk sieci odrzucony");
    return h.networkStats;
  },
  fetchUserReports: async (status: string): Promise<UserReportRow[]> => {
    h.reportsCalls.push(status);
    if (h.reportsFails) throw new Error("test: odczyt zgłoszeń odrzucony");
    return h.reports;
  },
  resolveUserReport: async (id: string, action: "resolved" | "dismissed"): Promise<void> => {
    h.resolveCalls.push({ id, action });
    if (h.resolveFails) throw new Error("test: rozstrzygnięcie odrzucone");
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: (message: string) => h.toastSuccess.push(message),
    error: (message: string) => h.toastError.push(message),
  },
}));

// Granica danych numer trzy: SILNIK WYKRESU paska analityki modułu 17.
// Pulpit osadza `<AdminBiStrip days={14} />`, a ten - dwie karty `ChartCard`,
// z których każda montuje `EChart`. `EChart` po zamontowaniu dociąga leniwie
// `EChartClient`, czyli ~1 MB ECharts rysującego po canvasie; happy-dom canvasu
// nie ma, więc `getContext("2d")` oddaje `null` i zrender wywala się ASYNCHRO-
// NICZNIE, w klatce animacji i przy `dispose()` po odmontowaniu
// (`Cannot set properties of null (setting 'dpr')`, `... reading 'clearRect'`).
// Vitest przypisuje takie nieobsłużone wyjątki testowi, który AKURAT trwa -
// stąd kilkanaście czerwonych przypadków bez jednej nieudanej asercji.
// Atrapa odcina wyłącznie rysowanie: `ChartCard`, jego przyciski eksportu,
// nagłówek `h2` paska i cała reszta drzewa biegną PRAWDZIWE, więc asercje
// dostępności nadal mierzą to, co widzi operator. Ta sama granica i z tego
// samego powodu stoi w `adminCouponsAnalyticsRoute.test.tsx`.
vi.mock("@/components/admin/analytics/EChart", () => ({
  EChart: ({ option, height }: { option: unknown; height?: number | string }) => (
    <div data-testid="wykres" data-wysokosc={String(height)} data-opcja={JSON.stringify(option)} />
  ),
}));

import { renderRoute, routeHead } from "@/test/routeHarness";
import { realT } from "@/test/i18nReal";
import { axeViolations, summarize } from "@/test/axe";
import { Route as CommunityIndexRoute } from "@/routes/admin.community.index";

const t = realT("pl");
const PATH = "/admin/community";
const ROUTE_FILE = "src/routes/admin.community.index.tsx";
const LAYOUT_FILE = "src/routes/admin.community.tsx";
const SUBNAV_FILE = "src/components/admin/community/CommunitySubNav.tsx";
const NETWORK_MIGRATION = "supabase/migrations/20260717170000_connections_v2.sql";
const COMMUNITY_STATS_MIGRATION =
  "supabase/migrations/20260713200000_chat_admin_tenant_scope_fix.sql";

function communityStats(over: Partial<CommunityStats> = {}): CommunityStats {
  return {
    conversations_total: 41,
    messages_last_24h: 128,
    events_upcoming: 6,
    events_drafts: 2,
    qa_sessions_open: 3,
    qa_questions_pending: 9,
    ...over,
  };
}

function modules(over: Partial<CommunityModulesSettings> = {}): CommunityModulesSettings {
  return {
    chat_enabled: true,
    connections_enabled: true,
    events_enabled: true,
    qa_enabled: true,
    polls_enabled: true,
    contributor_program_enabled: true,
    badges_enabled: true,
    push_enabled: true,
    expert_requests_enabled: true,
    clubs_enabled: false,
    default_message_ttl_seconds: null,
    ...over,
  };
}

function networkStats(over: Partial<NetworkStats> = {}): NetworkStats {
  return {
    connections_total: 210,
    pending_total: 12,
    invites_30d: 40,
    accepted_30d: 21,
    responded_30d: 30,
    members_with_connection: 88,
    avg_hours_to_accept_30d: 11,
    ...over,
  };
}

function userReport(over: Partial<UserReportRow> = {}): UserReportRow {
  return {
    id: "report-1",
    reporter_id: "user-zglaszajacy",
    reporter_name: "Anna Przykładowa",
    reported_id: "user-zglaszany",
    reported_name: "Bogdan Zmyślony",
    reason: "spam",
    details: "Zmyślona treść zgłoszenia do testu.",
    status: "open",
    created_at: "2026-08-30T08:00:00.000Z",
    resolved_at: "",
    resolution_note: "",
    total_count: 1,
    ...over,
  };
}

/** Klient z wyłączonymi ponowieniami - test odmowy nie ma na co czekać. */
function testClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

async function mountOverview(queryClient?: QueryClient) {
  return renderRoute({
    route: CommunityIndexRoute,
    path: PATH,
    initialEntry: PATH,
    queryClient: queryClient ?? testClient(),
  });
}

/**
 * Wartość kafelka po jego ETYKIECIE.
 *
 * Kafelek to dwa rodzeństwa: wiersz „ikona + etykieta" i wiersz z liczbą.
 * Odczyt po etykiecie (a nie po pozycji w siatce) jest tu warunkiem sensu -
 * przestawienie kafelków miejscami nie może zamienić testu w fałszywy dowód,
 * że „Pytania czek." pokazują liczbę konwersacji.
 */
function statValue(label: string): string {
  const labelRow = screen.getByText(label);
  const valueRow = labelRow.nextElementSibling;
  if (!valueRow) throw new Error(`test: kafelek „${label}" nie ma wiersza z wartością`);
  return valueRow.textContent ?? "";
}

/**
 * Przełącznik modułu po etykiecie.
 *
 * STRAŻNIK, nie rzutowanie: napis „Sieć kontaktów" występuje na tym ekranie
 * DWA razy (etykieta przełącznika i tytuł karty sieci), więc helper sprawdza
 * w runtime, przy którym z nich faktycznie stoi przełącznik.
 */
function toggleSwitch(label: string): HTMLElement {
  for (const node of screen.getAllByText(label)) {
    const row = node.parentElement?.parentElement;
    const found = row ? within(row).queryByRole("switch") : null;
    if (found) return found;
  }
  throw new Error(`test: brak przełącznika przy etykiecie „${label}"`);
}

/** Otwiera listę Radiksa klawiaturą - pointer events nie działają w happy-dom. */
function openSelect(trigger: HTMLElement): HTMLElement {
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  return screen.getByRole("listbox");
}

/** Atrapa natywnego `confirm` - happy-dom go nie implementuje. */
const confirmSpy = vi.fn<(message?: string) => boolean>(() => true);

beforeEach(() => {
  h.stats = communityStats();
  h.statsFails = false;
  h.statsCalls = 0;
  h.modules = modules();
  h.modulesFails = false;
  h.savedPatches = [];
  h.saveFails = false;
  h.networkStats = networkStats();
  h.networkFails = false;
  h.networkArgs = [];
  h.reports = [];
  h.reportsFails = false;
  h.reportsCalls = [];
  h.resolveCalls = [];
  h.resolveFails = false;
  h.purgeCalls = 0;
  h.purgeCount = 0;
  h.purgeHolds = false;
  h.releasePurge = null;
  h.purgeFails = false;
  h.remindersCalls = 0;
  h.remindersCount = 0;
  h.remindersHolds = false;
  h.releaseReminders = null;
  h.remindersFails = false;
  h.toastSuccess = [];
  h.toastError = [];
  confirmSpy.mockReset();
  confirmSpy.mockReturnValue(true);
  // Definiujemy na OBU obiektach: komponent wołałby gołe `confirm(...)`, więc
  // liczy się `globalThis`, a helpery testowe sięgają po `window`.
  Object.defineProperty(globalThis, "confirm", {
    configurable: true,
    writable: true,
    value: confirmSpy,
  });
  Object.defineProperty(window, "confirm", {
    configurable: true,
    writable: true,
    value: confirmSpy,
  });
});

afterEach(() => cleanup());

describe("pulpit społeczności - sklejenie trasy i gdzie stoi bramka uprawnień", () => {
  it("head() ustawia tytuł karty przeglądarki", async () => {
    // Czytamy DWIEMA drogami: wprost (kontrakt funkcji) i przez zamontowany
    // router (to, co faktycznie trafiłoby do `<HeadContent/>`).
    expect(routeHead(CommunityIndexRoute).meta).toContainEqual({ title: "Community · Admin" });

    const { meta } = await mountOverview();
    expect(meta()).toContainEqual({ title: "Community · Admin" });
  });

  it("ta trasa NIE bramkuje dostępu sama - renderuje się bez pytania o rolę", async () => {
    // Dowód pozytywny: komponent nie woła `useAuth` i nie przekierowuje, więc
    // renderuje się w harnessie, w którym żadnej sesji nie ma. To NIE jest
    // dziura - to podział pracy: jedna bramka w layoucie zamiast stu
    // czterdziestu kopii w trasach.
    await mountOverview();
    expect(
      await screen.findByRole("heading", {
        name: t("adminCommunity.overview.communityPanel"),
      }),
    ).toBeInTheDocument();
  });

  it("plik trasy nie zawiera warunku roli ani przekierowania", () => {
    const source = readFileSync(ROUTE_FILE, "utf8");
    expect(source).not.toMatch(/isStaff|isAdmin|isSuperAdmin|useAuth/);
    expect(source).not.toMatch(/beforeLoad|redirect\(|<Navigate/);
  });

  it("trasa wisi pod `/admin`, więc chroni ją bramka `isStaff` z layoutu", () => {
    const source = readFileSync(ROUTE_FILE, "utf8");
    expect(source).toMatch(/createFileRoute\("\/admin\/community\/"\)/);
    const layout = readFileSync("src/routes/admin.tsx", "utf8");
    expect(layout).toMatch(/isStaff/);
    expect(layout).toMatch(/navigate\(\{\s*to:\s*"\/login"\s*\}\)/);
  });

  it("autorytetem odczytów pulpitu są RPC `SECURITY DEFINER` z `is_staff()`", () => {
    // RÓŻNICA wobec siostrzanej trasy ankiet, która czyta tabelę wprost i stoi
    // na samym RLS: tutaj rola jest sprawdzana w ciele funkcji bazy, więc
    // odmowa jest wyjątkiem, a nie pustą listą.
    const network = readFileSync(NETWORK_MIGRATION, "utf8");
    expect(network).toMatch(/FUNCTION public\.admin_network_stats\(\)/);
    expect(network).toMatch(/FUNCTION public\.admin_list_user_reports/);
    expect(network).toMatch(/public\.is_staff\(\)/);
    const community = readFileSync(COMMUNITY_STATS_MIGRATION, "utf8");
    expect(community).toMatch(/FUNCTION public\.admin_community_stats\(\)/);
    expect(community).toMatch(/RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'/);
  });
});

describe("pulpit społeczności - rozdział tenantów", () => {
  it("panel nie wysyła ŻADNEGO identyfikatora tenanta", async () => {
    // Gdyby wysyłał, mielibyśmy dwa niezależne źródła prawdy o tym, czyje to
    // dane, i pierwsza rozbieżność skończyłaby się pokazaniem cudzych metryk
    // albo ukryciem własnych. Rozdział ma być JEDEN i ma być w bazie.
    await mountOverview();
    await waitFor(() => expect(h.reportsCalls.length).toBeGreaterThan(0));
    expect(h.statsCalls).toBe(1);
    // `fetchUserReports` bierze wyłącznie status kolejki. `fetchNetworkStats`
    // jest przekazany do react-query jako `queryFn`, więc dostaje kontekst
    // zapytania - i to jest CAŁA jego lista argumentów: sygnatura funkcji jest
    // bezparametrowa, a RPC woła się bez ładunku.
    expect(h.networkArgs).toHaveLength(1);
    expect(h.reportsCalls).toEqual(["open"]);
    const layer = readFileSync("src/lib/admin/network.ts", "utf8");
    expect(layer).toMatch(
      /export async function fetchNetworkStats\(\): Promise<NetworkStats \| null>/,
    );
    expect(layer).toMatch(/supabase\.rpc\("admin_network_stats"\);/);
    expect(layer).toMatch(/p_status: status,/);
    // Bez komentarzy - nagłówek pliku OPISUJE tenanta, kod go nie dotyka.
    const code = layer
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");
    expect(code).not.toMatch(/tenant/i);
  });

  it("tenanta wyznaczają RPC z profilu wołającego, nie parametr z przeglądarki", () => {
    const network = readFileSync(NETWORK_MIGRATION, "utf8");
    expect(network).toMatch(
      /tenant_id =\s*\(SELECT p\.tenant_id FROM public\.profiles p WHERE p\.id = auth\.uid\(\)\)/,
    );
    const community = readFileSync(COMMUNITY_STATS_MIGRATION, "utf8");
    expect(community).toMatch(/v_tenant uuid := public\.current_tenant_id\(\)/);
  });

  it("panel renderuje WYŁĄCZNIE zgłoszenia oddane przez warstwę - nic nie dorabia", async () => {
    h.reports = [userReport({ id: "report-tenant-a", reporter_name: "Anna z tenanta A" })];
    await mountOverview();
    expect(await screen.findByText(/Anna z tenanta A/)).toBeInTheDocument();
    expect(screen.queryByText(/tenanta B/)).toBeNull();
  });
});

describe("pulpit społeczności - kafelki metryk", () => {
  it("sześć kafelków społeczności pokazuje liczby z `admin_community_stats`", async () => {
    await mountOverview();
    await waitFor(() => expect(statValue(t("adminCommunity.overview.conversations"))).toBe("41"));
    expect(statValue(t("adminCommunity.overview.messages24h"))).toBe("128");
    expect(statValue(t("adminCommunity.overview.upcoming"))).toBe("6");
    expect(statValue(t("adminCommunity.overview.drafts"))).toBe("2");
    expect(statValue(t("adminCommunity.overview.openQ"))).toBe("3");
    expect(statValue(t("adminCommunity.overview.pendingQs"))).toBe("9");
  });

  it("sześć kafelków sieci pokazuje liczby z `admin_network_stats`", async () => {
    await mountOverview();
    await waitFor(() => expect(statValue(t("adminCommunity.overview.connections"))).toBe("210"));
    expect(statValue(t("adminCommunity.overview.pending"))).toBe("12");
    expect(statValue(t("adminCommunity.overview.invites30d"))).toBe("40");
    expect(statValue(t("adminCommunity.overview.accepted30d"))).toBe("21");
    expect(statValue(t("adminCommunity.overview.connectedMembers"))).toBe("88");
    // Skuteczność liczy się z dwóch pól, nie przychodzi z bazy: 21/30.
    expect(statValue(t("adminCommunity.overview.acceptance"))).toBe("70");
  });

  it("BRAK METRYK SPOŁECZNOŚCI pokazuje „-”, nie „0” ani „undefined”", async () => {
    // Zero na kafelku „Pytania czek." znaczy „kolejka pusta, nic nie czeka" -
    // a to nieprawda, gdy liczby w ogóle nie doszły. `undefined` z kolei jest
    // wyciekiem implementacji na ekran operatora.
    h.statsFails = true;
    await mountOverview();
    await screen.findByText(t("adminCommunity.overview.conversations"));
    for (const key of [
      "conversations",
      "messages24h",
      "upcoming",
      "drafts",
      "openQ",
      "pendingQs",
    ] as const) {
      expect(statValue(t(`adminCommunity.overview.${key}`))).toBe("-");
    }
  });

  it("BRAK METRYK SIECI pokazuje „-” niezależnie od metryk społeczności", async () => {
    // Dwa różne zapytania mogą paść niezależnie: kafelki sieci nie mogą
    // pokazać zer tylko dlatego, że sąsiednia siatka się wczytała.
    h.networkFails = true;
    await mountOverview();
    await waitFor(() => expect(statValue(t("adminCommunity.overview.conversations"))).toBe("41"));
    for (const key of [
      "connections",
      "pending",
      "invites30d",
      "accepted30d",
      "acceptance",
      "connectedMembers",
    ] as const) {
      expect(statValue(t(`adminCommunity.overview.${key}`))).toBe("-");
    }
  });

  it("pusty wynik RPC sieci (null) to też „-”, nie zera", async () => {
    // `admin_network_stats` oddaje ZERO WIERSZY, gdy wołający nie jest
    // sztabem - a wtedy „0 połączeń" byłoby zdaniem o stanie tenanta,
    // nie o odmowie.
    h.networkStats = null;
    await mountOverview();
    await screen.findByText(t("adminCommunity.overview.connections"));
    expect(statValue(t("adminCommunity.overview.connections"))).toBe("-");
    expect(statValue(t("adminCommunity.overview.acceptance"))).toBe("-");
  });

  it("skuteczność bez ani jednej odpowiedzi to „-”, nie „0”", async () => {
    // Dzielenie przez zero: brak odpowiedzi w oknie 30 dni znaczy „nie ma
    // z czego liczyć", a nie „nikt nie zaakceptował".
    h.networkStats = networkStats({ responded_30d: 0, accepted_30d: 0 });
    await mountOverview();
    await waitFor(() => expect(statValue(t("adminCommunity.overview.pending"))).toBe("12"));
    expect(statValue(t("adminCommunity.overview.acceptance"))).toBe("-");
  });
});

describe("pulpit społeczności - globalne przełączniki modułów", () => {
  it("przełączniki odwzorowują stan z `site_settings`, w tym opt-in klubów", async () => {
    h.modules = modules({ chat_enabled: false, clubs_enabled: true });
    await mountOverview();
    await waitFor(() =>
      expect(toggleSwitch(t("adminCommunity.overview.chat"))).toHaveAttribute(
        "aria-checked",
        "false",
      ),
    );
    // Kluby są jedynym modułem opt-in: brak wpisu ma znaczyć „wyłączone".
    expect(toggleSwitch(t("adminCommunity.overview.discussionClubs"))).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(toggleSwitch(t("adminCommunity.overview.events"))).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("przełączenie wysyła TYLKO zmieniony klucz, nie cały obiekt ustawień", async () => {
    // `updateCommunityModules` scala łatkę ze STANEM Z BAZY, więc wysłanie
    // całego obiektu z ekranu nadpisałoby zmiany zrobione w międzyczasie
    // przez innego administratora.
    await mountOverview();
    await waitFor(() => expect(h.modules).not.toBeNull());
    fireEvent.click(toggleSwitch(t("adminCommunity.overview.polls")));
    await waitFor(() => expect(h.savedPatches).toEqual([{ polls_enabled: false }]));
  });

  it("zapis wpisuje nowy stan do cache i UNIEWAŻNIA publiczne ustawienia witryny", async () => {
    // Bez unieważnienia `site_settings_public` wyłączony moduł nadal jest
    // widoczny w nawigacji użytkownika aż do przeładowania strony - czyli
    // przełącznik „działa" w panelu i nie działa w produkcie.
    const queryClient = testClient();
    const setData = vi.spyOn(queryClient, "setQueryData");
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await mountOverview(queryClient);
    await waitFor(() =>
      expect(toggleSwitch(t("adminCommunity.overview.chat"))).toHaveAttribute(
        "aria-checked",
        "true",
      ),
    );

    fireEvent.click(toggleSwitch(t("adminCommunity.overview.chat")));
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["site_settings_public"] }),
    );
    expect(setData).toHaveBeenCalledWith(
      ["admin-community-modules"],
      expect.objectContaining({ chat_enabled: false }),
    );
    expect(h.toastSuccess).toContain(t("adminCommunity.overview.saved"));
  });

  it("odmowa zapisu kończy się toastem błędu, nie cichym powrotem do starego stanu", async () => {
    h.saveFails = true;
    await mountOverview();
    await waitFor(() =>
      expect(toggleSwitch(t("adminCommunity.overview.badges"))).toHaveAttribute(
        "aria-checked",
        "true",
      ),
    );
    fireEvent.click(toggleSwitch(t("adminCommunity.overview.badges")));
    await waitFor(() => expect(h.toastError).toContain(t("adminCommunity.overview.failedSave")));
    expect(h.toastSuccess).toEqual([]);
  });

  it("każdy z dziesięciu modułów ma własny przełącznik i własny klucz", async () => {
    // Lista jest tu treścią: dołożenie modułu bez przełącznika znaczy, że
    // nowej funkcji nie da się wyłączyć bez wdrożenia.
    await mountOverview();
    await waitFor(() => expect(screen.getAllByRole("switch")).toHaveLength(10));
    const expected: [string, keyof CommunityModulesSettings][] = [
      [t("adminCommunity.overview.chat"), "chat_enabled"],
      [t("adminCommunity.overview.network"), "connections_enabled"],
      [t("adminCommunity.overview.events"), "events_enabled"],
      ["Q&A", "qa_enabled"],
      [t("adminCommunity.overview.polls"), "polls_enabled"],
      [t("adminCommunity.overview.contributorProgram"), "contributor_program_enabled"],
      [t("adminCommunity.overview.badges"), "badges_enabled"],
      [t("adminCommunity.overview.pushNotifications"), "push_enabled"],
      [t("adminCommunity.overview.discussionClubs"), "clubs_enabled"],
      [t("adminCommunity.overview.expertRequests"), "expert_requests_enabled"],
    ];
    for (const [label, key] of expected) {
      h.savedPatches = [];
      fireEvent.click(toggleSwitch(label));
      await waitFor(() => expect(h.savedPatches).toHaveLength(1));
      expect(Object.keys(h.savedPatches[0] ?? {})).toEqual([key]);
    }
  });
});

describe("pulpit społeczności - czas życia wiadomości", () => {
  const ttlTrigger = () => {
    const label = screen.getByText(t("adminCommunity.overview.defaultMessageTtl"));
    const block = label.parentElement;
    if (!block) throw new Error("test: sekcja TTL nie ma kontenera");
    return within(block).getByRole("combobox");
  };

  it("brak TTL pokazuje „bez limitu”, a nie pustą listę", async () => {
    h.modules = modules({ default_message_ttl_seconds: null });
    await mountOverview();
    await waitFor(() =>
      expect(ttlTrigger()).toHaveTextContent(t("adminCommunity.overview.ttlOff")),
    );
  });

  it("ustawiony TTL pokazuje SWOJĄ pozycję, nie domyślną", async () => {
    h.modules = modules({ default_message_ttl_seconds: 604_800 });
    await mountOverview();
    await waitFor(() => expect(ttlTrigger()).toHaveTextContent(t("adminCommunity.overview.ttl7d")));
  });

  it("wybór okna czasowego zapisuje SEKUNDY, nie etykietę", async () => {
    await mountOverview();
    await waitFor(() =>
      expect(ttlTrigger()).toHaveTextContent(t("adminCommunity.overview.ttlOff")),
    );
    fireEvent.click(
      within(openSelect(ttlTrigger())).getByRole("option", {
        name: t("adminCommunity.overview.ttl24h"),
      }),
    );
    await waitFor(() => expect(h.savedPatches).toEqual([{ default_message_ttl_seconds: 86_400 }]));
  });

  it("powrót na „bez limitu” zapisuje `null`, a nie zero", async () => {
    // Zero sekund znaczyłoby „kasuj natychmiast" - dokładnie odwrotnie niż
    // „nie kasuj wcale". Ta różnica jest nieodwracalna po stronie crona.
    h.modules = modules({ default_message_ttl_seconds: 86_400 });
    await mountOverview();
    await waitFor(() =>
      expect(ttlTrigger()).toHaveTextContent(t("adminCommunity.overview.ttl24h")),
    );
    fireEvent.click(
      within(openSelect(ttlTrigger())).getByRole("option", {
        name: t("adminCommunity.overview.ttlOff"),
      }),
    );
    await waitFor(() => expect(h.savedPatches).toEqual([{ default_message_ttl_seconds: null }]));
  });
});

describe("pulpit społeczności - akcje serwisowe", () => {
  const purgeButton = () =>
    screen.getByRole("button", { name: t("adminCommunity.overview.purgeExpiredMessages") });
  const remindersButton = () =>
    screen.getByRole("button", { name: t("adminCommunity.overview.runEventReminders") });

  it("czyszczenie woła bazę i mówi, ILE wiadomości zniknęło", async () => {
    h.purgeCount = 3;
    await mountOverview();
    fireEvent.click(purgeButton());
    await waitFor(() => expect(h.purgeCalls).toBe(1));
    // Liczba jest treścią komunikatu, nie ozdobą: „wyczyszczono 0"
    // i „wyczyszczono 3000" to dwie różne informacje o stanie bazy, a formy
    // mnogie jadą przez słownik.
    const expected = t("adminCommunity.overview.purgedMessages", { count: 3 });
    await waitFor(() => expect(h.toastSuccess).toContain(expected));
    expect(expected).toContain("3");
  });

  it("czyszczenie bez trafień też raportuje wynik (zero to informacja)", async () => {
    h.purgeCount = 0;
    await mountOverview();
    fireEvent.click(purgeButton());
    await waitFor(() =>
      expect(h.toastSuccess).toContain(t("adminCommunity.overview.purgedMessages", { count: 0 })),
    );
  });

  it("przycisk czyszczenia jest zablokowany w trakcie - dwa kliki to dwa przebiegi", async () => {
    h.purgeHolds = true;
    await mountOverview();
    const button = purgeButton();
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);
    expect(h.purgeCalls).toBe(1);

    const release = h.releasePurge;
    if (!release) throw new Error("test: purge nie wystartował, nie ma czego zwolnić");
    release();
    await waitFor(() => expect(button).toBeEnabled());
  });

  it("odmowa czyszczenia mówi o błędzie - cisza sugerowałaby, że kolejka zniknęła", async () => {
    h.purgeFails = true;
    await mountOverview();
    fireEvent.click(purgeButton());
    await waitFor(() => expect(h.toastError).toContain(t("adminCommunity.overview.purgeFailed")));
    expect(h.toastSuccess).toEqual([]);
  });

  it("przypomnienia o wydarzeniach mówią, ILE wysłano", async () => {
    h.remindersCount = 5;
    await mountOverview();
    fireEvent.click(remindersButton());
    await waitFor(() => expect(h.remindersCalls).toBe(1));
    await waitFor(() =>
      expect(h.toastSuccess).toContain(
        t("adminCommunity.overview.remindersDispatched", { count: 5 }),
      ),
    );
  });

  it("przycisk przypomnień jest zablokowany w trakcie - powiadomienia są nieodwracalne", async () => {
    h.remindersHolds = true;
    await mountOverview();
    const button = remindersButton();
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);
    expect(h.remindersCalls).toBe(1);

    const release = h.releaseReminders;
    if (!release) throw new Error("test: przypomnienia nie wystartowały");
    release();
    await waitFor(() => expect(button).toBeEnabled());
  });

  it("odmowa przypomnień mówi o błędzie zamiast udawać wysyłkę", async () => {
    h.remindersFails = true;
    await mountOverview();
    fireEvent.click(remindersButton());
    await waitFor(() =>
      expect(h.toastError).toContain(t("adminCommunity.overview.remindersFailed")),
    );
    expect(h.toastSuccess).toEqual([]);
  });
});

describe("pulpit społeczności - kolejka zgłoszeń użytkowników", () => {
  it("pusta kolejka mówi wprost, że zgłoszeń nie ma", async () => {
    await mountOverview();
    expect(await screen.findByText(t("adminCommunity.overview.noOpenReports"))).toBeInTheDocument();
  });

  it("kolejka pokazuje strony sporu, powód i szczegóły oraz LICZNIK otwartych", async () => {
    h.reports = [
      userReport({ id: "report-1", reason: "spam" }),
      userReport({
        id: "report-2",
        reporter_name: "Cezary Fikcyjny",
        reported_name: "Dorota Nieistniejąca",
        reason: "harassment",
        details: undefined,
      }),
    ];
    await mountOverview();
    expect(await screen.findByText("Anna Przykładowa → Bogdan Zmyślony")).toBeInTheDocument();
    expect(screen.getByText("Cezary Fikcyjny → Dorota Nieistniejąca")).toBeInTheDocument();
    expect(screen.getByText("spam")).toBeInTheDocument();
    expect(screen.getByText("Zmyślona treść zgłoszenia do testu.")).toBeInTheDocument();
    // Plakietka z liczbą - bez niej rosnąca kolejka wygląda jak pusta.
    const heading = screen.getByText(t("adminCommunity.overview.userReports"));
    expect(heading.parentElement?.textContent).toContain("2");
  });

  it("rozstrzygnięcie idzie do RPC z akcją `resolved`, unieważnia kolejkę i potwierdza się", async () => {
    h.reports = [userReport({ id: "report-do-rozstrzygniecia" })];
    const queryClient = testClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await mountOverview(queryClient);
    await screen.findByText("Anna Przykładowa → Bogdan Zmyślony");

    fireEvent.click(screen.getByRole("button", { name: t("adminCommunity.overview.resolve") }));
    await waitFor(() =>
      expect(h.resolveCalls).toEqual([{ id: "report-do-rozstrzygniecia", action: "resolved" }]),
    );
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin-user-reports"] }),
    );
    expect(h.toastSuccess).toContain(t("adminCommunity.overview.reportResolved"));
  });

  it("oddalenie jedzie z akcją `dismissed` - to inna decyzja niż rozstrzygnięcie", async () => {
    // Baza zapisuje status wprost z tego argumentu, a `admin_resolve_user_report`
    // przyjmuje wyłącznie te dwie wartości. Pomylenie ich zmieniłoby treść
    // wpisu w rejestrze moderacji.
    h.reports = [userReport({ id: "report-do-oddalenia" })];
    await mountOverview();
    await screen.findByText("Anna Przykładowa → Bogdan Zmyślony");

    fireEvent.click(screen.getByRole("button", { name: t("adminCommunity.overview.dismiss") }));
    await waitFor(() =>
      expect(h.resolveCalls).toEqual([{ id: "report-do-oddalenia", action: "dismissed" }]),
    );
  });

  it("odmowa rozstrzygnięcia mówi o błędzie zamiast udawać, że zgłoszenie zniknęło", async () => {
    h.reports = [userReport()];
    h.resolveFails = true;
    await mountOverview();
    await screen.findByText("Anna Przykładowa → Bogdan Zmyślony");

    fireEvent.click(screen.getByRole("button", { name: t("adminCommunity.overview.resolve") }));
    await waitFor(() => expect(h.toastError).toContain(t("adminCommunity.overview.failedResolve")));
    expect(h.toastSuccess).toEqual([]);
  });

  it("odmowa odczytu kolejki NIE udaje pustej kolejki... a jednak udaje - stan zastany", async () => {
    // USTALENIE, nie życzenie. `reportsQ.data ?? []` sprawia, że odmowa
    // odczytu renderuje ten sam komunikat co pusta kolejka. Kontrakt spisany
    // jest niżej w sekcji „defekty zastane" (`it.fails` + kontrola dodatnia);
    // tutaj przypinamy to, co jest, żeby nikt nie uznał braku testu za dowód.
    h.reportsFails = true;
    await mountOverview();
    expect(await screen.findByText(t("adminCommunity.overview.noOpenReports"))).toBeInTheDocument();
  });
});

describe("pulpit społeczności - nawigacja do podstron", () => {
  it("pulpit sam nie linkuje nigdzie - zakładki daje layout `/admin/community`", () => {
    // Odczyt plików, nie render: harness montuje POJEDYNCZĄ trasę pod
    // zastępczym korzeniem, więc `CommunitySubNav` z rodzica jest tu poza
    // zasięgiem. Ten test mówi, GDZIE ta nawigacja mieszka, zamiast udawać,
    // że jej nie ma.
    const source = readFileSync(ROUTE_FILE, "utf8");
    expect(source).not.toMatch(/<Link/);

    const layout = readFileSync(LAYOUT_FILE, "utf8");
    expect(layout).toMatch(/<CommunitySubNav \/>/);
    expect(layout).toMatch(/<Outlet \/>/);
  });

  it("podnawigacja prowadzi do wszystkich siostrzanych podstron modułu", () => {
    const subnav = readFileSync(SUBNAV_FILE, "utf8");
    for (const to of [
      "/admin/community",
      "/admin/community/chat",
      "/admin/community/clubs",
      "/admin/community/qa",
      "/admin/community/polls",
      "/admin/community/contributors",
      "/admin/community/badges",
      "/admin/community/notifications",
      "/admin/community/engagement",
    ]) {
      expect(subnav).toContain(`to: "${to}" as const`);
    }
    // Zakładka pulpitu jest DOKŁADNA, reszta prefiksowa - inaczej „/admin/community"
    // podświetlałoby się na każdej podstronie modułu.
    expect(subnav).toMatch(/to: "\/admin\/community" as const[\s\S]{0,200}exact: true/);
  });
});

describe("pulpit społeczności - dostępność", () => {
  it("naruszenia axe są PRZYPIĘTE do jednego znanego defektu, nie wyciszone regułą", async () => {
    // Lista jest przypięta, a nie wyłączona flagą: każde NOWE naruszenie
    // wywali ten test zamiast schować się pod `enabled: false`. Defekt jest
    // opisany niżej, w sekcji „defekty zastane".
    //
    // BYŁY TU DWA. Drugim był `heading-order` - i on ZNIKNĄŁ, bo pulpit dostał
    // nagłówek poziomu drugiego. Dowód i mechanizm: dwa testy niżej
    // („drabina nagłówków...").
    h.reports = [userReport()];
    const { container } = await mountOverview();
    await screen.findByText("Anna Przykładowa → Bogdan Zmyślony");
    const violations = await axeViolations(container);
    expect(violations.map((v) => v.id).sort(), summarize(violations)).toEqual(["button-name"]);
    const byId = new Map(violations.map((v) => [v.id, v]));
    // Dziesięć przełączników modułów plus lista TTL.
    expect(byId.get("button-name")?.nodes).toHaveLength(11);
  });

  /**
   * DEFEKT ZAMKNIĘTY, NIE WYCISZONY - `it`, nie `it.fails`.
   *
   * Do 2026-09-02 pulpit otwierał się `<h1>` („Panel społeczności"), a NASTĘPNYM
   * nagłówkiem w drzewie był `<h3>` kolejki zgłoszeń - poziom drugi nie
   * istniał, bo tytuły kart (`CardTitle`) renderują się jako `<div>`. Ten test
   * i jego kontrola dodatnia stały wtedy w sekcji „defekty zastane" jako
   * `it.fails` + opis stanu dzisiejszego.
   *
   * CO SIĘ ZMIENIŁO. Commit 3d4b684 dołożył `AdminBiStrip` (pasek analityki
   * modułu 17), a `src/routes/admin.community.index.tsx` osadza go zaraz pod
   * nagłówkiem strony (`<AdminBiStrip days={14} />`). Pasek renderuje własny
   * `<h2>{t("adminAnalytics.bi.stripTitle")}</h2>`, więc drabina nagłówków jest
   * pełna: `h1` -> `h2` -> `h3` i axe nie ma czego zgłosić. Zgodnie z zasadą
   * z nagłówka sekcji „defekty zastane" („naprawa defektu zapali kontrolę
   * i wymusi aktualizację obu") oba przypadki są zaktualizowane i PRZENIESIONE
   * tutaj - od tej chwili pilnują braku przeskoku, a nie jego obecności.
   *
   * CZEGO TEN TEST NIE TWIERDZI: że tytuły sekcji („Dostępność modułów",
   * „Akcje serwisowe", „Sieć kontaktów") są już nagłówkami. Nadal są `<div>`
   * i nadal nie da się po nich nawigować czytnikiem ekranu - to jednak nie
   * jest naruszenie reguły `heading-order` i nie ma tu udawać, że jest.
   */
  it("kolejność poziomów nagłówków nie przeskakuje poziomu", async () => {
    const { container } = await mountOverview();
    await screen.findByText(t("adminCommunity.overview.userReports"));
    const violations = await axeViolations(container);
    expect(
      violations.map((v) => v.id),
      summarize(violations),
    ).not.toContain("heading-order");
  });

  it("drabina nagłówków to `h1` -> `h2` -> `h3`, a poziom drugi daje pasek analityki", async () => {
    // Kontrola nazywa ŹRÓDŁO poziomu drugiego. Sama lista `["H1","H2","H3"]`
    // przeszłaby też wtedy, gdyby `h2` przyszedł skądkolwiek - a wtedy usunięcie
    // paska analityki z tej trasy po cichu przywróciłoby przeskok poziomu.
    await mountOverview();
    await screen.findByText(t("adminCommunity.overview.userReports"));
    const headings = screen.getAllByRole("heading");
    expect(headings.map((el) => el.tagName)).toEqual(["H1", "H2", "H3"]);
    expect(headings[1]).toHaveTextContent(t("adminAnalytics.bi.stripTitle"));
  });
});

// ---------------------------------------------------------------------------
// DEFEKTY ZASTANE. Każdy `it.fails` ma obok KONTROLĘ DODATNIĄ, która opisuje
// stan dzisiejszy: naprawa defektu zapali kontrolę i wymusi aktualizację obu.
// ---------------------------------------------------------------------------

describe("pulpit społeczności - defekty zastane", () => {
  /**
   * ZŁAMANY KONTRAKT: OPERACJA KASUJĄCA CUDZE WIADOMOŚCI IDZIE Z JEDNEGO
   * KLIKNIĘCIA. „Wyczyść wygasłe wiadomości" woła `chat_purge_expired_messages`,
   * czyli `DELETE FROM public.messages` w całym tenancie. Kasowania nie da się
   * cofnąć, a przycisk stoi obok przycisku, który tylko rozsyła przypomnienia,
   * i wygląda tak samo (oba `variant="outline"`, oba z ikoną).
   *
   * DOWÓD, że to niekonsekwencja, a nie decyzja: siostrzana trasa
   * `admin.community.polls.tsx` przepuszcza kasowanie ankiety przez
   * `confirm(t("adminCommunity.polls.delete"))`, a `admin.community.chat.tsx`
   * przez pełne okno potwierdzenia z opisem zasięgu. Trzy panele tego samego
   * modułu chronią operacje niszczące trzema różnymi sposobami, a jeden z nich
   * to brak ochrony.
   *
   * OCZEKIWANY KONTRAKT: czyszczenie przechodzi przez potwierdzenie mówiące,
   * czego dotyczy (jak przy kasowaniu konwersacji).
   *
   * Zapisane jako `it.fails`: naprawa wymaga zmiany pliku trasy i nowych kluczy
   * i18n, a ten plik nie zmienia zachowania produkcyjnego.
   */
  it.fails("czyszczenie wygasłych wiadomości pyta o potwierdzenie", async () => {
    confirmSpy.mockReturnValue(false);
    await mountOverview();
    fireEvent.click(
      screen.getByRole("button", { name: t("adminCommunity.overview.purgeExpiredMessages") }),
    );
    expect(confirmSpy).toHaveBeenCalled();
    expect(h.purgeCalls).toBe(0);
  });

  it("kontrola dodatnia: dziś jedno kliknięcie kasuje BEZ pytania", async () => {
    confirmSpy.mockReturnValue(false);
    await mountOverview();
    fireEvent.click(
      screen.getByRole("button", { name: t("adminCommunity.overview.purgeExpiredMessages") }),
    );
    await waitFor(() => expect(h.purgeCalls).toBe(1));
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("kontrola dodatnia: atrapa `confirm` DZIAŁA - siostrzana trasa ankiet ją wywołuje", () => {
    // Bez tej kontroli `it.fails` wyżej dałoby się „spełnić" zepsutą atrapą
    // (gdyby `confirm` nigdy nie był podmieniany, asercja też by padła).
    // Tu dowodzimy, że wzorzec bramki potwierdzenia w tym module ISTNIEJE
    // i wygląda dokładnie tak, jak zakłada `it.fails`.
    const polls = readFileSync("src/routes/admin.community.polls.tsx", "utf8");
    expect(polls).toMatch(/if \(confirm\(t\("adminCommunity\.polls\.delete"\)\)\)/);
    const overview = readFileSync(ROUTE_FILE, "utf8");
    expect(overview).not.toMatch(/confirm\(/);
    // Atrapa jest podpięta i odpowiada - dowód, że asercja `toHaveBeenCalled`
    // ma czym się zapalić.
    expect(window.confirm("test")).toBe(true);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });

  /**
   * ZŁAMANY KONTRAKT: ODMOWA ODCZYTU MODUŁÓW POKAZUJE FABRYKOWANY STAN
   * „WŁĄCZONE". Kafelki liczb mają tu porządny kontrakt - `StatCard` robi
   * `value ?? "-"`, więc brak danych nie udaje zera. Przełączniki modułów tego
   * kontraktu NIE mają: `checked={modules?.chat_enabled ?? true}`. Gdy
   * `fetchCommunityModules` odmówi (RLS, awaria), `modules` zostaje
   * `undefined`, a operator widzi DZIESIĘĆ przełączników w stanie
   * „włączone" - w tym `clubs_enabled`, który w bazie jest opt-in i domyślnie
   * wyłączony, więc przynajmniej jeden z tych stanów jest na pewno kłamstwem.
   *
   * KONSEKWENCJA: to jest dokładnie ten sam błąd klasy, co „0 zamiast -" na
   * kafelku. Administrator, który wyłączył czat, po awarii odczytu widzi
   * „czat: włączony" i albo uzna, że ktoś mu zmienił ustawienia, albo kliknie,
   * żeby „wyłączyć" - a klik jest zablokowany, więc nie dostanie nawet błędu.
   * Ekran nie mówi ANI SŁOWA o tym, że ustawień nie udało się odczytać.
   *
   * OCZEKIWANY KONTRAKT: przy nieznanym stanie panel nie deklaruje żadnego -
   * pokazuje komunikat o nieudanym odczycie (analogicznie do „-" na kafelku),
   * a nie domyślne „włączone".
   *
   * Zapisane jako `it.fails`: naprawa wymaga zmiany pliku trasy i nowego klucza
   * i18n, a ten plik nie zmienia zachowania produkcyjnego.
   */
  it.fails("odmowa odczytu modułów NIE pokazuje fabrykowanego stanu „włączone”", async () => {
    h.modulesFails = true;
    await mountOverview();
    await waitFor(() => expect(screen.getAllByRole("switch")).toHaveLength(10));
    const checked = screen
      .getAllByRole("switch")
      .filter((s) => s.getAttribute("aria-checked") === "true");
    expect(checked).toEqual([]);
  });

  it("kontrola dodatnia: dziś odmowa daje dziewięć „włączone” i ani słowa o błędzie", async () => {
    h.modulesFails = true;
    await mountOverview();
    await waitFor(() => expect(screen.getAllByRole("switch")).toHaveLength(10));
    const checked = screen
      .getAllByRole("switch")
      .filter((s) => s.getAttribute("aria-checked") === "true");
    // Dziewięć modułów „włączonych" plus kluby „wyłączone" - stan zmyślony
    // przez zapasowe wartości w JSX, nie odczytany z bazy.
    expect(checked).toHaveLength(9);
    expect(toggleSwitch(t("adminCommunity.overview.discussionClubs"))).toHaveAttribute(
      "aria-checked",
      "false",
    );
    // Przełączniki są ZABLOKOWANE, więc operator nie dostanie nawet błędu
    // z bazy, który powiedziałby mu, że coś jest nie tak.
    expect(toggleSwitch(t("adminCommunity.overview.chat"))).toBeDisabled();
    expect(h.toastError).toEqual([]);
  });

  it("kontrola dodatnia: kafelki W TYM SAMYM renderze robią to poprawnie", async () => {
    // To jest dowód, że kontrakt „brak danych to nie jest stan" jest w tym
    // pliku wykonalny i gdzie indziej wykonany - a więc `it.fails` wyżej opisuje
    // niekonsekwencję, nie niemożliwość.
    h.modulesFails = true;
    h.statsFails = true;
    await mountOverview();
    await screen.findByText(t("adminCommunity.overview.conversations"));
    expect(statValue(t("adminCommunity.overview.conversations"))).toBe("-");
  });

  /**
   * ZŁAMANY KONTRAKT: ODMOWA ODCZYTU KOLEJKI ZGŁOSZEŃ WYGLĄDA JAK PUSTA
   * KOLEJKA. `const reports = reportsQ.data ?? []` plus `reports.length === 0
   * ? <p>Brak otwartych zgłoszeń.</p>` sprawia, że nieudany odczyt melduje
   * moderatorowi „nie ma nic do zrobienia". Zgłoszenie użytkownika o nękaniu
   * czeka wtedy w bazie, a panel mówi, że kolejka jest czysta.
   *
   * OCZEKIWANY KONTRAKT: `reportsQ.isError` ma własną gałąź z komunikatem
   * o nieudanym odczycie.
   */
  it.fails("odmowa odczytu kolejki zgłoszeń NIE udaje pustej kolejki", async () => {
    h.reportsFails = true;
    await mountOverview();
    await waitFor(() => expect(h.reportsCalls.length).toBeGreaterThan(0));
    await waitFor(() =>
      expect(screen.queryByText(t("adminCommunity.overview.noOpenReports"))).toBeNull(),
    );
  });

  it("kontrola dodatnia: przy UDANYM pustym odczycie ten komunikat jest prawdą", async () => {
    // Bez tej kontroli `it.fails` wyżej dałoby się „naprawić" przez usunięcie
    // komunikatu o pustce - a wtedy panel przestałby mówić cokolwiek na
    // poprawnie pustej kolejce.
    h.reports = [];
    await mountOverview();
    expect(await screen.findByText(t("adminCommunity.overview.noOpenReports"))).toBeInTheDocument();
  });

  /**
   * ZŁAMANY KONTRAKT: JEDENAŚCIE KONTROLEK BEZ NAZWY DOSTĘPNEJ.
   * `Switch` z Radiksa renderuje `<button role="switch">`, a stojący obok napis
   * jest zwykłym `<div>`, nie `<label htmlFor>` - przełącznik nie dostaje nawet
   * `id`, więc nie ma czego wskazać. Lista TTL to `<button role="combobox">`,
   * a rola `combobox` NIE bierze nazwy z treści (nazwa musi pochodzić od
   * autora: `aria-label` albo `<label>`), więc widoczne „Bez limitu" w środku
   * nie jest jej nazwą.
   *
   * KONSEKWENCJA: czytnik ekranu czyta „przełącznik, zaznaczony" dziesięć razy
   * z rzędu, przy przełącznikach, które wyłączają CAŁE MODUŁY produktu dla
   * wszystkich użytkowników tenanta.
   *
   * OCZEKIWANY KONTRAKT: każdy przełącznik i lista mają nazwę dostępną
   * (`aria-label` albo `<Label htmlFor>` z `id` na kontrolce). Klucze i18n
   * z etykietami już istnieją - naprawa nie potrzebuje nowych tłumaczeń.
   */
  it.fails("pulpit nie ma naruszeń axe", async () => {
    const { container } = await mountOverview();
    await screen.findByText(t("adminCommunity.overview.moduleAvailability"));
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("kontrola dodatnia: dziś żadna z jedenastu kontrolek nie ma nazwy", async () => {
    await mountOverview();
    await screen.findByText(t("adminCommunity.overview.moduleAvailability"));
    const controls = [...screen.getAllByRole("switch"), ...screen.getAllByRole("combobox")];
    expect(controls).toHaveLength(11);
    for (const control of controls) {
      expect(control.getAttribute("aria-label")).toBeNull();
      expect(control.getAttribute("aria-labelledby")).toBeNull();
      expect(control.getAttribute("title")).toBeNull();
    }
  });

  // PRZESKOK POZIOMU NAGŁÓWKA (`h1` -> `h3`) BYŁ CZWARTYM DEFEKTEM TEJ SEKCJI.
  // Został zamknięty - `AdminBiStrip` wstawił między nie własny `<h2>` - więc
  // oba przypadki (`it.fails` i jego kontrola dodatnia) przeniosły się w górę,
  // do sekcji „pulpit społeczności - dostępność", i tam pilnują dziś BRAKU
  // przeskoku. Pełna historia i mechanizm stoją w komentarzu nad
  // „kolejność poziomów nagłówków nie przeskakuje poziomu".
});
