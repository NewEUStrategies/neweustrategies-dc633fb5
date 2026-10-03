// KOKPIT `/admin` - złożenie sekcji, sześć niezależnych odczytów i jedno okno.
//
// CO DOWODZI TEN PLIK. `AdminDashboard` i `useDashboardData` stały na zerze
// funkcji, a to one decydują o trzech rzeczach widocznych od pierwszego
// wejścia do panelu:
//   1. sześć zapytań rysuje się i psuje NIEZALEŻNIE - awaria jednej sekcji nie
//      gasi pozostałych, a każdą da się ponowić osobno;
//   2. jedna zakładka okresu steruje oknem WSZYSTKICH sekcji, a „Na żywo"
//      chowa sekcje, które w pół godziny dają same zera;
//   3. czołówka treści jest kluczowana językiem panelu.
//
// GRANICA DOWODU. Funkcje serwerowe są atrapami (ich ciała dowodzi
// `lib/admin/dashboard/__tests__/dashboardFunctions.test.ts`), a panele -
// prostymi zaślepkami, które wypisują to, co dostały (ich render dowodzi
// `dashboardPanels.test.tsx`). React Query i hooki danych są PRAWDZIWE.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { DashboardRange } from "@/lib/admin/dashboard/period";

const h = vi.hoisted(() => ({
  language: "pl",
  fixedT: null as null | typeof realT,
  traffic: vi.fn(),
  crm: vi.fn(),
  marketing: vi.fn(),
  audience: vi.fn(),
  content: vi.fn(),
  realtime: vi.fn(),
  /** Zaślepka panelu: wypisuje okres okna i to, czy panel jest rozwinięty. */
  stub:
    (id: string) =>
    ({ range, expanded }: { range?: DashboardRange; expanded?: boolean }) => (
      <div
        data-testid={id}
      >{`${range?.period ?? "-"}|${expanded === true ? "expanded" : "-"}`}</div>
    ),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: h.fixedT?.(h.language.startsWith("en") ? "en" : "pl"),
    i18n: { language: h.language },
    ready: true,
  }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: unknown }) => (
    <a href={to}>{children as never}</a>
  ),
}));

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: <T,>(fn: T) => fn,
}));

vi.mock("@/lib/admin/dashboard/dashboard.functions", () => ({
  getDashboardTraffic: h.traffic,
  getDashboardCrm: h.crm,
  getDashboardMarketing: h.marketing,
  getDashboardAudience: h.audience,
  getDashboardContent: h.content,
  getDashboardRealtime: h.realtime,
}));

vi.mock("@/hooks/useAuth", () => ({ useRequiredTenant: () => "tenant-a" }));

vi.mock("../RealtimeStrip", () => ({ RealtimeStrip: h.stub("realtime") }));
vi.mock("../TrafficPanel", () => ({ TrafficPanel: h.stub("traffic") }));
vi.mock("../CrmPanel", () => ({ CrmPanel: h.stub("crm") }));
vi.mock("../MarketingPanel", () => ({ MarketingPanel: h.stub("marketing") }));
vi.mock("../AudiencePanel", () => ({ AudiencePanel: h.stub("audience") }));
vi.mock("../ContentPanel", () => ({ ContentPanel: h.stub("content") }));
vi.mock("../GeoPanel", () => ({
  GeoPanel: ({ traffic, leads }: { traffic: unknown[]; leads: unknown[] }) => (
    <div data-testid="geo">{`${traffic.length}|${leads.length}`}</div>
  ),
}));

import { realT } from "@/test/i18nReal";
import { renderHookWithQueryClient, renderWithQueryClient } from "@/test/renderWithQueryClient";
import {
  parseAudienceReport,
  parseContentReport,
  parseCrmReport,
  parseMarketingReport,
  parseRealtimeReport,
  parseTrafficReport,
} from "@/lib/admin/dashboard/parse";
import { rangeQuantumMs } from "@/lib/admin/dashboard/period";
import { AdminDashboard } from "../AdminDashboard";
import { useContentQuery, useDashboardRange } from "../useDashboardData";

h.fixedT = realT;

const ok = <T,>(report: T) => Promise.resolve({ available: true, report });

function answerAll() {
  const traffic = parseTrafficReport(null);
  h.traffic.mockImplementation(() =>
    ok({ ...traffic, countries: [{ code: "PL", sessions: 3, pageViews: 4 }] }),
  );
  h.crm.mockImplementation(() => ok(parseCrmReport(null)));
  h.marketing.mockImplementation(() => ok(parseMarketingReport(null)));
  h.audience.mockImplementation(() => ok(parseAudienceReport(null)));
  h.content.mockImplementation(() => ok(parseContentReport(null)));
  h.realtime.mockImplementation(() => ok(parseRealtimeReport(null)));
}

/** Sekcja po tytule `<h2>`. */
function section(title: string): HTMLElement {
  const heading = screen.getByRole("heading", { level: 2, name: title });
  const node = heading.closest("section");
  if (!(node instanceof HTMLElement)) throw new Error(`Brak sekcji "${title}"`);
  return node;
}

beforeEach(() => {
  h.language = "pl";
  for (const fn of [h.traffic, h.crm, h.marketing, h.audience, h.content, h.realtime]) {
    fn.mockReset();
  }
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("AdminDashboard - stany odczytu", () => {
  it("przed odpowiedzią każda sekcja czeka z rezerwą wysokości, bez żadnej liczby", () => {
    const never = () => new Promise(() => {});
    for (const fn of [h.traffic, h.crm, h.marketing, h.audience, h.content, h.realtime]) {
      fn.mockImplementation(never);
    }
    renderWithQueryClient(<AdminDashboard />);

    expect(screen.getByRole("heading", { level: 1, name: "Kokpit" })).toBeTruthy();
    const pending = screen.getAllByRole("status");
    // Siedem sekcji: puls, ruch, mapa, CRM, marketing, użytkownicy, treść.
    expect(pending).toHaveLength(7);
    expect(pending.map((p) => p.style.minHeight)).toEqual([
      "320px",
      "420px",
      "420px",
      "400px",
      "380px",
      "380px",
      "300px",
    ]);
    expect(screen.queryByTestId("traffic")).toBeNull();
  });

  it("po odpowiedzi każda sekcja rysuje swój panel, a okno trafia do funkcji serwera", async () => {
    answerAll();
    renderWithQueryClient(<AdminDashboard />);

    for (const id of ["realtime", "traffic", "crm", "marketing", "audience", "content"]) {
      expect(await screen.findByTestId(id)).toBeTruthy();
    }
    expect(screen.getByTestId("traffic").textContent).toBe("month|-");
    expect(screen.getByTestId("realtime").textContent).toBe("-|-");
    // Mapa dostaje kraje ruchu z odczytu RUCHU, a kontakty z odczytu CRM.
    expect(screen.getByTestId("geo").textContent).toBe("1|0");

    const payload = h.traffic.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(Object.keys(payload.data).sort()).toEqual([
      "bucket",
      "offsetMinutes",
      "prevSinceIso",
      "prevUntilIso",
      "sinceIso",
      "untilIso",
    ]);
    expect(h.content.mock.calls[0]?.[0]).toMatchObject({ data: { lang: "pl" } });
    expect(h.realtime.mock.calls[0]?.[0]).toEqual({
      data: { activeMinutes: 5, windowMinutes: 30 },
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("awaria JEDNEJ sekcji nie gasi pozostałych i daje się ponowić osobno", async () => {
    answerAll();
    h.crm.mockImplementation(() => Promise.reject(new Error("timeout")));
    renderWithQueryClient(<AdminDashboard />);

    const crm = section("CRM");
    const alert = await within(crm).findByRole("alert");
    expect(alert.textContent).toContain("Nie udało się wczytać danych.");
    // Ruch i marketing rysują się mimo awarii CRM.
    expect(await screen.findByTestId("traffic")).toBeTruthy();
    expect(await screen.findByTestId("marketing")).toBeTruthy();
    expect(screen.queryByTestId("crm")).toBeNull();

    h.crm.mockImplementation(() => ok(parseCrmReport(null)));
    const callsBefore = h.crm.mock.calls.length;
    fireEvent.click(within(crm).getByRole("button", { name: "Spróbuj ponownie" }));
    expect(await screen.findByTestId("crm")).toBeTruthy();
    expect(h.crm.mock.calls.length).toBe(callsBefore + 1);
  });

  it("awaria ruchu kładzie też mapę - i obie ponawiają ODCZYT RUCHU", async () => {
    answerAll();
    h.traffic.mockImplementation(() => Promise.reject(new Error("boom")));
    renderWithQueryClient(<AdminDashboard />);

    const geo = section("Mapa pochodzenia");
    expect(await within(geo).findByRole("alert")).toBeTruthy();
    expect(within(section("Ruch na stronie")).getByRole("alert")).toBeTruthy();

    h.traffic.mockImplementation(() => ok(parseTrafficReport(null)));
    fireEvent.click(within(geo).getByRole("button", { name: "Spróbuj ponownie" }));
    expect(await screen.findByTestId("geo")).toBeTruthy();
    expect(await screen.findByTestId("traffic")).toBeTruthy();
  });

  it.each([
    ["Teraz na stronie", h.realtime, parseRealtimeReport],
    ["Ruch na stronie", h.traffic, parseTrafficReport],
    ["CRM", h.crm, parseCrmReport],
    ["Marketing", h.marketing, parseMarketingReport],
    ["Użytkownicy platformy", h.audience, parseAudienceReport],
    ["Treść", h.content, parseContentReport],
  ] as const)("„%s”: brak źródła w bazie to status, nie awaria", async (title, fn, parse) => {
    answerAll();
    fn.mockImplementation(() => Promise.resolve({ available: false, report: parse(null) }));
    renderWithQueryClient(<AdminDashboard />);

    const node = section(title);
    await waitFor(() =>
      expect(within(node).getByRole("status").textContent).toContain("Źródło jeszcze niedostępne"),
    );
    expect(within(node).queryByRole("alert")).toBeNull();
  });

  it("każda sekcja ponawia WŁASNY odczyt", async () => {
    answerAll();
    const failing = [h.realtime, h.traffic, h.marketing, h.audience, h.content];
    for (const fn of failing) fn.mockImplementation(() => Promise.reject(new Error("x")));
    renderWithQueryClient(<AdminDashboard />);

    const titles = [
      "Teraz na stronie",
      "Ruch na stronie",
      "Marketing",
      "Użytkownicy platformy",
      "Treść",
    ];
    for (const [i, title] of titles.entries()) {
      const node = section(title);
      await within(node).findByRole("alert");
      const fn = failing[i];
      if (!fn) throw new Error("brak atrapy");
      const before = fn.mock.calls.length;
      fireEvent.click(within(node).getByRole("button", { name: "Spróbuj ponownie" }));
      await waitFor(() => expect(fn.mock.calls.length).toBe(before + 1));
    }
  });
});

describe("AdminDashboard - jedno okno czasu", () => {
  it("zakładka „Na żywo” chowa sekcje z samymi zerami i rozwija puls", async () => {
    answerAll();
    renderWithQueryClient(<AdminDashboard />);
    await screen.findByTestId("crm");

    fireEvent.click(screen.getByRole("button", { name: "Na żywo" }));

    await waitFor(() => expect(screen.getByTestId("traffic").textContent).toBe("realtime|-"));
    expect(screen.getByTestId("realtime").textContent).toBe("-|expanded");
    for (const title of ["CRM", "Marketing", "Użytkownicy platformy", "Treść"]) {
      expect(screen.queryByRole("heading", { level: 2, name: title })).toBeNull();
    }
    expect(screen.getByRole("heading", { level: 2, name: "Mapa pochodzenia" })).toBeTruthy();
  });

  it("zmiana okresu przestawia wszystkie sekcje na nowe okno", async () => {
    answerAll();
    renderWithQueryClient(<AdminDashboard />);
    await screen.findByTestId("crm");

    fireEvent.click(screen.getByRole("button", { name: "Rok" }));

    await waitFor(() => expect(screen.getByTestId("crm").textContent).toBe("year|-"));
    expect(screen.getByTestId("traffic").textContent).toBe("year|-");
    expect(screen.getByTestId("marketing").textContent).toBe("year|-");
    expect(screen.getByTestId("audience").textContent).toBe("year|-");
    const yearCall = h.traffic.mock.calls.at(-1)?.[0] as { data: { bucket: string } };
    expect(yearCall.data.bucket).toBe("month");
  });

  it("okno domknięte („Poprzedni miesiąc”) też przechodzi przez wszystkie sekcje", async () => {
    answerAll();
    renderWithQueryClient(<AdminDashboard />);
    await screen.findByTestId("crm");

    fireEvent.click(screen.getByRole("button", { name: "Poprzedni miesiąc" }));

    await waitFor(() => expect(screen.getByTestId("content").textContent).toBe("-|-"));
    await waitFor(() => expect(screen.getByTestId("traffic").textContent).toBe("prev-month|-"));
    expect(screen.getByText("wobec miesiąca wcześniejszego, w całości")).toBeTruthy();
  });

  it("po angielsku nagłówki sekcji idą ze słownika EN", async () => {
    h.language = "en";
    answerAll();
    renderWithQueryClient(<AdminDashboard />);
    expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Site traffic" })).toBeTruthy();
    await waitFor(() => expect(h.content).toHaveBeenCalled());
    expect(h.content.mock.calls[0]?.[0]).toMatchObject({ data: { lang: "en" } });
  });
});

describe("useDashboardRange - okno odświeżane w rytmie kwantu", () => {
  it("okno rosnące przesuwa się po upływie kwantu, a nie przy każdym renderze", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(new Date(2026, 2, 15, 12, 0, 30));
    const { result, rerender } = renderHookWithQueryClient(() => useDashboardRange("realtime"));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);

    act(() => {
      vi.advanceTimersByTime(rangeQuantumMs("realtime") * 2);
    });
    expect(result.current.current.untilIso > first.current.untilIso).toBe(true);
  });

  it("odmontowanie zdejmuje interwał", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const { unmount } = renderHookWithQueryClient(() => useDashboardRange("today"));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("useContentQuery - język jest częścią klucza", () => {
  it("klucz zapytania niesie tenanta i język panelu", async () => {
    answerAll();
    const { result, queryClient } = renderHookWithQueryClient(() => {
      const range = useDashboardRange("month");
      return useContentQuery(range);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const keys = queryClient
      .getQueryCache()
      .getAll()
      .map((q) => JSON.stringify(q.queryKey));
    expect(
      keys.some((k) => k.includes("tenant-a") && k.includes("content") && k.includes('"pl"')),
    ).toBe(true);
  });
});
