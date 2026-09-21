// Trasa `/admin/community/notifications` ZAMONTOWANA - statystyki doręczeń,
// panel zdrowia harmonogramu i akcja utrzymaniowa. Przed tym plikiem 0/14 linii
// i 0/6 funkcji.
//
// GDZIE NAPRAWDĘ STOI BRAMKA UPRAWNIEŃ - USTALENIE, NIE ZAŁOŻENIE.
// Zadanie brzmiało „użytkownik bez roli sztabowej nie widzi panelu". Zanim
// powstał ten plik, sprawdziłem, gdzie ten warunek FAKTYCZNIE mieszka, i wyszło
// tak:
//
//   1. `src/routes/admin.tsx` (wspólny layout `/admin`) - JEDYNA bramka
//      renderu dla wszystkich tras panelu: `useAuth()` daje `isStaff`,
//      a efekt robi `navigate({ to: "/login" })` i komponent zwraca `null`.
//   2. `src/routes/admin.community.tsx` - tylko podnawigacja i `<Outlet/>`,
//      zero warunku roli.
//   3. TA trasa - zero warunku roli. Nie ma `useAuth`, nie ma `redirect`,
//      nie ma `Navigate`.
//   4. `src/lib/admin/community.ts` - `fetchNotificationStats`
//      i `cleanupFailedPushSubscriptions` idą ZWYKŁYM klientem Supabase
//      (`supabase.from(...)`), a nie serwerową funkcją z middleware. Autorytet
//      ostateczny to więc RLS (`*_staff_*`, `has_role admin|super_admin|
//      editor`), sprawdzany w pgTAP, nie w teście na atrapie.
//
// Dlatego NIE MA tu testu „bez roli nie widzi panelu" udającego dowód na
// poziomie tej trasy: taki test albo mierzyłby atrapę `useAuth`, której ta
// trasa nawet nie woła, albo przechodziłby zawsze. Zamiast tego są dwie
// asercje mierzące TO, CO JEST: (a) render tej trasy nie zależy od roli
// (mierzone renderem), (b) warunek roli stoi w layoucie `/admin` i to on
// przekierowuje na `/login` (mierzone odczytem pliku - tak samo jak robi to
// bramka `adminRouteAuthority.gate.test.ts`, która pilnuje tej warstwy dla
// wszystkich 140 tras panelu).
//
// CO POZA TYM DOWODZI TEN PLIK:
//   * `head()` ustawia tytuł karty (bez niego panel jest w historii
//     przeglądarki nierozpoznawalny wśród innych podstron admina),
//   * sześć kafelków statystyk pokazuje dane z `fetchNotificationStats`,
//     a BRAK DANYCH pokazuje „-", nie „0" i nie „undefined" - zero na kafelku
//     „nieudane push" znaczy „wszystko dobrze", a to nieprawda, gdy odczyt
//     w ogóle nie doszedł,
//   * akcja utrzymaniowa woła `cleanupFailedPushSubscriptions`, UNIEWAŻNIA
//     `["admin-notification-stats"]` (bez tego kafelki po czyszczeniu pokazują
//     stare liczby) i mówi, ILE rekordów zniknęło,
//   * odmowa bazy kończy się toastem błędu, nie ciszą.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import type { NotificationStats } from "@/lib/admin/community";

const h = vi.hoisted(() => ({
  fetchStats: vi.fn<() => Promise<NotificationStats>>(),
  cleanup: vi.fn<() => Promise<number>>(),
  toasts: [] as { kind: "success" | "error"; text: string }[],
}));

// Warstwa danych panelu. Atrapa jest tu na miejscu: `fetchNotificationStats`
// składa SZEŚĆ równoległych zapytań liczących, a przedmiotem dowodu tej trasy
// jest to, co robi Z WYNIKIEM - nie jak go zdobywa.
vi.mock("@/lib/admin/community", () => ({
  fetchNotificationStats: () => h.fetchStats(),
  cleanupFailedPushSubscriptions: () => h.cleanup(),
}));

// Panel zdrowia harmonogramu ma WŁASNY test
// (`src/components/admin/community/__tests__/SchedulerHealthPanel.test.tsx`)
// i ciągnie serwerową funkcję przez `useServerFn`. Tutaj dowodem jest samo
// SKLEJENIE: czy trasa go montuje i czy stoi PRZED statystykami - panel
// odpowiada na pytanie „czy harmonogram w ogóle biegnie", a statystyki tylko
// na „ile", więc kolejność jest treścią, nie estetyką.
vi.mock("@/components/admin/community/SchedulerHealthPanel", () => ({
  SchedulerHealthPanel: () => <div data-testid="scheduler-health">panel zdrowia</div>,
}));

vi.mock("sonner", () => ({
  toast: {
    success: (text: string) => h.toasts.push({ kind: "success", text }),
    error: (text: string) => h.toasts.push({ kind: "error", text }),
  },
}));

// `react-i18next` NIE JEST atrapowany - napisy mają pochodzić ze słownika
// (`@/lib/i18n-admin-community`, rejestrowany przy imporcie modułu trasy).
// Skrót `vi.mock("react-i18next", () => reactI18nextMock())` zakleszczyłby
// plik: fabryka mocka sięga po `@/lib/i18n`, czyli moduł importujący właśnie
// mockowany pakiet (ostrzeżenie z nagłówka `@/test/i18nReal`).

import { realT } from "@/test/i18nReal";
import { renderRoute, routeHead } from "@/test/routeHarness";
import { axeViolations, summarize } from "@/test/axe";
import { Route as NotificationsAdminRoute } from "@/routes/admin.community.notifications";

const t = realT("pl");
const PATH = "/admin/community/notifications";

function stats(over: Partial<NotificationStats> = {}): NotificationStats {
  return {
    push_subscriptions_active: 128,
    push_subscriptions_failed: 7,
    notifications_last_24h: 342,
    notifications_unread: 51,
    digest_daily_users: 19,
    digest_weekly_users: 4,
    ...over,
  };
}

beforeEach(() => {
  cleanup();
  h.fetchStats.mockReset();
  h.fetchStats.mockResolvedValue(stats());
  h.cleanup.mockReset();
  h.cleanup.mockResolvedValue(0);
  h.toasts = [];
});

/** Klient z wyłączonymi ponowieniami - test odmowy nie ma na co czekać. */
function testClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

async function mountRoute(queryClient?: QueryClient) {
  return renderRoute({
    route: NotificationsAdminRoute,
    path: PATH,
    initialEntry: PATH,
    queryClient: queryClient ?? testClient(),
  });
}

/**
 * Wartość kafelka po jego etykiecie.
 *
 * Kafelek to dwa rodzeństwa: wiersz „ikona + etykieta" i wiersz z liczbą.
 * Odczyt po etykiecie (a nie po pozycji w siatce) jest tu warunkiem sensu -
 * przestawienie kafelków miejscami nie może zamienić testu w fałszywy dowód,
 * że „nieudane push" pokazuje liczbę aktywnych.
 */
function statValue(label: string): string {
  const labelRow = screen.getByText(label);
  const valueRow = labelRow.nextElementSibling;
  if (!valueRow) throw new Error(`test: kafelek „${label}" nie ma wiersza z wartością`);
  return valueRow.textContent ?? "";
}

describe("/admin/community/notifications - nagłówek i skład panelu", () => {
  it("head() ustawia tytuł karty", async () => {
    // Czytamy `head()` DWIEMA drogami: wprost (kontrakt funkcji) i przez
    // zamontowany router (to, co faktycznie trafiłoby do `<HeadContent/>`).
    const bezpośrednio = routeHead(NotificationsAdminRoute);
    expect(bezpośrednio.meta).toContainEqual({ title: "Notifications · Community · Admin" });

    const { meta } = await mountRoute();
    expect(meta()).toContainEqual({ title: "Notifications · Community · Admin" });
  });

  it("montuje panel zdrowia harmonogramu PRZED siatką statystyk", async () => {
    const { container } = await mountRoute();
    const panel = await screen.findByTestId("scheduler-health");
    const siatka = container.querySelector(".grid");
    expect(siatka).not.toBeNull();
    // Panel mówi „czy dyspozytor w ogóle biegnie", statystyki tylko „ile".
    // Rosnąca kolejka wygląda dokładnie tak samo jak brak powiadomień do
    // wysłania, więc panel musi być pierwszy.
    expect(panel.compareDocumentPosition(siatka!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("montowany panel to ten, który czyta ŚWIEŻOŚĆ z logu przebiegów", () => {
    // LUKA DOMKNIĘTA 02.09.2026. Asercja wyżej mierzy KOLEJNOŚĆ montowania,
    // ale panel jest tutaj ATRAPĄ, więc sama w sobie przechodziłaby również
    // wtedy, gdyby ktoś podmienił panel na statyczny baner „harmonogram OK".
    // Domykamy to odczytem źródeł - tą samą techniką, którą ten plik stosuje
    // niżej dla bramki uprawnień, bo renderem atrapy nie da się tego dosięgnąć.
    //
    // ŁAŃCUCH „AWARIA HARMONOGRAMU JEST WIDOCZNA" ma dwa końce i oba są
    // pokryte: koniec ZAPISUJĄCY (przebieg, także nieudany, ląduje
    // w `public.job_runner_runs`) dowodzi
    // `src/routes/api/public/-community-cron.test.ts`, a koniec RENDERUJĄCY
    // (stan `stale`/`never` podnosi widoczny alert) -
    // `src/components/admin/community/__tests__/SchedulerHealthPanel.test.tsx`.
    // Tu spinamy je w jedno: TA trasa montuje komponent, który ciągnie
    // `getSchedulerHealth`, a ta funkcja liczy świeżość z RPC
    // `job_scheduler_health` - czyli z tego samego logu przebiegów.
    const panel = readFileSync("src/components/admin/community/SchedulerHealthPanel.tsx", "utf8");
    expect(panel).toMatch(/getSchedulerHealth/);

    const warstwa = readFileSync("src/lib/admin/scheduler.functions.ts", "utf8");
    expect(warstwa).toMatch(/rpc\("job_scheduler_health"\)/);
    expect(warstwa).toMatch(/freshness: schedulerFreshness\(/);
  });

  it("pokazuje SZEŚĆ kafelków z danymi z fetchNotificationStats", async () => {
    await mountRoute();

    await waitFor(() =>
      expect(statValue(t("adminCommunity.notifications.pushActive"))).toBe("128"),
    );
    expect(statValue(t("adminCommunity.notifications.pushFailed"))).toBe("7");
    expect(statValue(t("adminCommunity.notifications.sent24h"))).toBe("342");
    expect(statValue(t("adminCommunity.notifications.unread"))).toBe("51");
    expect(statValue(t("adminCommunity.notifications.dailyDigest"))).toBe("19");
    expect(statValue(t("adminCommunity.notifications.weeklyDigest"))).toBe("4");
    expect(h.fetchStats).toHaveBeenCalledTimes(1);
  });

  it("BRAK DANYCH pokazuje „-”, nie „0” ani „undefined”", async () => {
    // Odmowa odczytu (RLS albo awaria) zostawia `q.data` puste. Zero na
    // kafelku „nieudane push" znaczy „wszystko w porządku" - a to nieprawda,
    // gdy liczby w ogóle nie doszły. `undefined` z kolei jest wyciekiem
    // implementacji na ekran operatora.
    h.fetchStats.mockRejectedValue(new Error("odmowa bazy"));
    await mountRoute();

    await screen.findByText(t("adminCommunity.notifications.pushActive"));
    for (const key of [
      "pushActive",
      "pushFailed",
      "sent24h",
      "unread",
      "dailyDigest",
      "weeklyDigest",
    ] as const) {
      expect(statValue(t(`adminCommunity.notifications.${key}`))).toBe("-");
    }
  });
});

describe("/admin/community/notifications - akcja utrzymaniowa", () => {
  const purgeButton = () =>
    screen.getByRole("button", {
      name: t("adminCommunity.notifications.purgeFailedPushSubscriptions"),
    });

  it("czyszczenie woła RPC, unieważnia statystyki i mówi ILE rekordów zniknęło", async () => {
    h.cleanup.mockResolvedValue(3);
    const queryClient = testClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await mountRoute(queryClient);
    await screen.findByText(t("adminCommunity.notifications.pushActive"));

    fireEvent.click(purgeButton());

    await waitFor(() => expect(h.cleanup).toHaveBeenCalledTimes(1));
    // Bez unieważnienia kafelki po czyszczeniu pokazują STARE liczby (query ma
    // `staleTime: 30_000`), więc operator widzi nieudane subskrypcje, których
    // już nie ma, i klika drugi raz.
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin-notification-stats"] }),
    );
    // Liczba w komunikacie jedzie przez formy mnogie - „Usunięto 3 nieudane
    // subskrypcje", a nie surowy klucz i nie gołe „OK".
    expect(h.toasts).toContainEqual({
      kind: "success",
      text: t("adminCommunity.notifications.removedFailedSubscriptions", { count: 3 }),
    });
  });

  it("czyszczenie bez trafień też raportuje wynik (zero to informacja)", async () => {
    h.cleanup.mockResolvedValue(0);
    await mountRoute();
    await screen.findByText(t("adminCommunity.notifications.pushActive"));

    fireEvent.click(purgeButton());

    await waitFor(() =>
      expect(h.toasts).toContainEqual({
        kind: "success",
        text: t("adminCommunity.notifications.removedFailedSubscriptions", { count: 0 }),
      }),
    );
  });

  it("odmowa bazy pokazuje toast błędu, nie ciszę", async () => {
    h.cleanup.mockRejectedValue(new Error("odmowa bazy"));
    await mountRoute();
    await screen.findByText(t("adminCommunity.notifications.pushActive"));

    fireEvent.click(purgeButton());

    // Akcja utrzymaniowa kasuje wiersze - jej cicha porażka jest gorsza niż
    // brak przycisku, bo operator zakłada, że kolejka została wyczyszczona.
    await waitFor(() =>
      expect(h.toasts).toContainEqual({
        kind: "error",
        text: t("adminCommunity.notifications.failed"),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// UPRAWNIENIA. Patrz USTALENIE w nagłówku pliku: bramka renderu stoi
// w layoucie `/admin`, autorytet ostateczny w RLS. Poniżej mierzymy dokładnie
// to, co jest - żaden z tych testów nie udaje, że ta trasa sama kogoś odsyła.
// ---------------------------------------------------------------------------

describe("/admin/community/notifications - gdzie stoi bramka uprawnień", () => {
  it("ta trasa NIE bramkuje dostępu sama - renderuje się bez pytania o rolę", async () => {
    // Dowód pozytywny: komponent trasy nie woła `useAuth` ani nie przekierowuje,
    // więc renderuje się w harnessie, w którym żadnej sesji nie ma. To NIE jest
    // dziura - to podział pracy: jedna bramka w layoucie zamiast stu
    // czterdziestu kopii w trasach. Gdyby ktoś dołożył warunek roli TUTAJ, ten
    // test zapali się jako pierwszy i wymusi aktualizację opisu.
    await mountRoute();
    expect(await screen.findByTestId("scheduler-health")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: t("adminCommunity.notifications.notifications") }),
    ).toBeInTheDocument();
  });

  it("plik trasy nie zawiera warunku roli ani przekierowania", () => {
    const zrodlo = readFileSync("src/routes/admin.community.notifications.tsx", "utf8");
    expect(zrodlo).not.toMatch(/isStaff|isAdmin|isSuperAdmin/);
    expect(zrodlo).not.toMatch(/beforeLoad|redirect\(|<Navigate/);
  });

  it("bramka renderu żyje w layoucie `/admin` i prowadzi na /login", () => {
    // Odczyt pliku, nie render: layout jest RODZICEM tej trasy, a harness
    // montuje pojedynczą trasę pod zastępczym korzeniem, więc renderem nie da
    // się go tu dosięgnąć. To ta sama technika, której używa bramka
    // `src/routes/__tests__/adminRouteAuthority.gate.test.ts` dla wszystkich
    // tras panelu naraz.
    const layout = readFileSync("src/routes/admin.tsx", "utf8");
    expect(layout).toMatch(/isStaff/);
    expect(layout).toMatch(/navigate\(\{\s*to:\s*"\/login"\s*\}\)/);
    expect(layout).toMatch(/if \(!session \|\| !isStaff\) return null;/);
  });

  it("dane panelu idą zwykłym klientem Supabase (autorytetem jest RLS, nie middleware)", () => {
    // Świadome NEGATYWNE ustalenie. Gdyby te funkcje były serwerowymi
    // (`createServerFn`), dowód uprawnień robiłoby się przez
    // `serverFnMiddlewareNames` z `@/test/serverFnHarness`. Nie są: czytają
    // `supabase.from(...)` w przeglądarce, więc jedyną barierą jest polityka
    // `*_staff_*` w bazie, a jej dowód mieszka w pgTAP - nie w teście na
    // atrapie klienta.
    const warstwa = readFileSync("src/lib/admin/community.ts", "utf8");
    expect(warstwa).not.toMatch(/createServerFn/);
    expect(warstwa).toMatch(/export async function fetchNotificationStats/);
    expect(warstwa).toMatch(/export async function cleanupFailedPushSubscriptions/);
  });
});

describe("/admin/community/notifications - dostępność", () => {
  it("panel nie ma naruszeń axe", async () => {
    const { container } = await mountRoute();
    await screen.findByText(t("adminCommunity.notifications.pushActive"));

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
