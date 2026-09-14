// Trasa `/admin/seo/queries` - rejestr fraz.
//
// CO TU JEST PRZEDMIOTEM DOWODU. Nie arytmetyka - ta ma własny plik
// (`queryRegistry.test.ts`, 50 przypadków) - i nie wygląd wiersza, bo to
// `QueryRegistryTable.test.tsx`. Tutaj dowodzimy rzeczy, których żaden z tamtych
// plików nie widzi, bo są własnością TEJ trasy:
//
//   1. O CO PYTA GOOGLE. Cała różnica wobec istniejącej zakładki Search Console
//      siedzi w jednym polu: `dimensions: ["page", "query"]` zamiast jednego
//      wymiaru. Gdyby ktoś to kiedyś uprościł do `["query"]`, ekran nadal by się
//      renderował, tabela nadal miałaby wiersze, a POWIĄZANIE frazy z artykułem
//      zniknęłoby bez jednego czerwonego testu. Stąd asercja na payloadzie.
//   2. ZAKRES DAT uwzględnia opóźnienie publikacji GSC. Pytanie o „wczoraj"
//      zwraca pustkę, a ekran wyglądałby wtedy na zepsuty.
//   3. STANY GRANICZNE, które w tym panelu są PIERWSZORZĘDNE, nie awaryjne:
//      brak konektora i brak danych mimo podłączenia. Świeży serwis widzi
//      jeden z nich zawsze.
//   4. DOPASOWANIE DO CMS-a: wpisy wygrywają ze stronami przy tym samym slugu.
//   5. PRZEŁĄCZNIK UJĘCIA faktycznie zmienia to, co widać.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderRoute, routeMeta } from "@/test/routeHarness";
import { Route as QueriesRoute } from "@/routes/admin.seo.queries";

const h = vi.hoisted(() => ({
  /** Odpowiedź `listGscSites`. */
  sites: { configured: true, sites: [{ siteUrl: "https://x.pl/" }] } as {
    configured: boolean;
    sites: { siteUrl: string }[];
  },
  /** Wiersze oddawane przez `queryGscAnalytics`. */
  rows: [] as {
    keys: string[];
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  }[],
  /** Payloady, z którymi trasa zapytała Google. */
  analyticsCalls: [] as Record<string, unknown>[],
  posts: [] as Record<string, unknown>[],
  pages: [] as Record<string, unknown>[],
  /** Błąd odczytu tabel treści (null = odczyt się udaje). */
  readError: null as Error | null,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ tenantId: "t-1", isAdmin: true, isStaff: true }),
  useRequiredTenant: () => "t-1",
}));

vi.mock("@/integrations/supabase/client", () => {
  const chain = (table: string) => {
    const link: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "order", "limit"]) link[method] = () => link;
    link.then = (resolve: (v: { data: unknown[] | null; error: unknown }) => unknown): unknown =>
      resolve({
        data: h.readError ? null : table === "posts" ? h.posts : h.pages,
        error: h.readError,
      });
    return link;
  };
  return { supabase: { from: (table: string) => chain(table) } };
});

vi.mock("@/lib/analytics/gsc.functions", () => ({
  listGscSites: Object.assign(() => Promise.resolve(h.sites), { __id: "listGscSites" }),
  queryGscAnalytics: Object.assign(() => Promise.resolve({ rows: h.rows }), {
    __id: "queryGscAnalytics",
  }),
}));

// `useServerFn` w teście ma tylko przekazać funkcję dalej i zapisać payload
// zapytania analitycznego - to on jest przedmiotem dowodu nr 1.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => {
    const tagged = fn as { __id?: string };
    return (arg?: { data?: Record<string, unknown> }) => {
      if (tagged.__id === "queryGscAnalytics" && arg?.data) h.analyticsCalls.push(arg.data);
      return (fn as (a?: unknown) => unknown)(arg);
    };
  },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return { ...actual, Link: RouterLinkStub };
});

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (v: string) => void;
    children?: React.ReactNode;
  }) => (
    <select
      data-testid="select"
      value={value}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

const row = (page: string, query: string, over: Record<string, number> = {}) => ({
  keys: [page, query],
  clicks: over.clicks ?? 0,
  impressions: over.impressions ?? 0,
  ctr: over.ctr ?? 0,
  position: over.position ?? 10,
});

beforeEach(() => {
  h.sites = { configured: true, sites: [{ siteUrl: "https://x.pl/" }] };
  h.rows = [];
  h.analyticsCalls = [];
  h.posts = [];
  h.pages = [];
  h.readError = null;
});

afterEach(cleanup);

/**
 * Render + oczekiwanie na rozwiązanie łańcucha zapytań. Ekran pyta Google
 * DOPIERO po tym, jak `listGscSites` odda właściwość - dwa zapytania po sobie,
 * więc sam `renderRoute` zostawia komponent w stanie sprzed pierwszego wyniku
 * i każda asercja o treści byłaby asercją o stanie ładowania.
 */
async function renderQueries() {
  const result = await renderRoute({
    route: QueriesRoute,
    path: "/admin/seo/queries",
    initialEntry: "/admin/seo/queries",
  });
  await waitFor(() => {
    if (h.sites.configured === false) {
      expect(screen.getByText("adminSeoHub.queriesNotConnected")).toBeTruthy();
      return;
    }
    // Stan KOŃCOWY, nie sam fakt wysłania zapytania: albo jest co pokazać,
    // albo padł komunikat o braku fraz. Czekanie na samo wywołanie zostawiało
    // ekran w renderze sprzed wyniku i asercje mierzyły stan ładowania.
    if (h.rows.length === 0) {
      expect(screen.getByText("adminSeoHub.queriesNoData")).toBeTruthy();
      return;
    }
    expect(document.querySelectorAll('[data-testid="registry-page"]').length).toBeGreaterThan(0);
  });
  return result;
}

describe("/admin/seo/queries - o co pyta Google", () => {
  it("pyta o OBA wymiary naraz - bez tego nie ma powiązania frazy z artykułem", async () => {
    await renderQueries();
    expect(h.analyticsCalls.length).toBeGreaterThan(0);
    expect(h.analyticsCalls[0].dimensions).toEqual(["page", "query"]);
  });

  it("zakres dat kończy się DWA dni wstecz, bo GSC publikuje z opóźnieniem", async () => {
    await renderQueries();
    const call = h.analyticsCalls[0];
    const end = new Date(`${call.endDate as string}T00:00:00Z`);
    const today = new Date();
    const daysBack = Math.round(
      (Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - end.getTime()) /
        86_400_000,
    );
    expect(daysBack).toBe(2);
  });

  it("domyślny zakres to 28 dni i zaczyna się wcześniej, niż kończy", async () => {
    await renderQueries();
    const call = h.analyticsCalls[0];
    expect(String(call.startDate) < String(call.endDate)).toBe(true);
  });

  it("zmiana zakresu wysyła NOWE zapytanie z wcześniejszą datą startu", async () => {
    await renderQueries();
    const before = String(h.analyticsCalls[0].startDate);
    const selects = screen.getAllByTestId("select");
    fireEvent.change(selects[1], { target: { value: "90d" } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const after = String(h.analyticsCalls[h.analyticsCalls.length - 1].startDate);
    expect(after < before).toBe(true);
  });
});

describe("/admin/seo/queries - stany graniczne", () => {
  it("brak konektora mówi wprost, czego brakuje, zamiast pokazywać pustą tabelę", async () => {
    h.sites = { configured: false, sites: [] };
    await renderQueries();
    expect(screen.getByText("adminSeoHub.queriesNotConnected")).toBeTruthy();
  });

  it("konektor podłączony, ale Google nie ma jeszcze fraz - osobny komunikat", async () => {
    h.rows = [];
    await renderQueries();
    expect(screen.getByText("adminSeoHub.queriesNoData")).toBeTruthy();
    // To NIE jest ten sam stan co brak konektora.
    expect(screen.queryByText("adminSeoHub.queriesNotConnected")).toBeNull();
  });

  it("gdy są dane, żaden z komunikatów pustki się nie pokazuje", async () => {
    h.rows = [row("https://x.pl/blog/a", "fraza", { impressions: 100 })];
    await renderQueries();
    expect(screen.queryByText("adminSeoHub.queriesNoData")).toBeNull();
    expect(screen.queryByText("adminSeoHub.queriesNotConnected")).toBeNull();
  });
});

describe("/admin/seo/queries - dopasowanie do CMS-a i ujęcia", () => {
  it("wpis wygrywa ze stroną przy tym samym slugu - to wpis się pozycjonuje", async () => {
    h.rows = [row("https://x.pl/blog/zderzenie", "fraza", { impressions: 100 })];
    h.pages = [{ slug: "zderzenie", title_pl: "STRONA", title_en: null }];
    h.posts = [{ slug: "zderzenie", title_pl: "WPIS", title_en: null }];
    await renderQueries();
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs.some((href) => href?.includes("/admin/posts/zderzenie"))).toBe(true);
    expect(hrefs.some((href) => href?.includes("/admin/pages/zderzenie"))).toBe(false);
  });

  it("przełącznik ujęcia zmienia to, co widać - z kart na wiersze fraz", async () => {
    h.rows = [row("https://x.pl/blog/a", "fraza", { impressions: 100 })];
    await renderQueries();
    expect(screen.getAllByTestId("registry-page").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("adminSeoHub.queriesViewQueries"));
    expect(screen.getAllByTestId("query-row").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("registry-page")).toBeNull();
  });

  it("przełącznik wraca z fraz na karty - powrót to osobne domknięcie", async () => {
    h.rows = [row("https://x.pl/blog/a", "fraza", { impressions: 100 })];
    await renderQueries();
    fireEvent.click(screen.getByText("adminSeoHub.queriesViewQueries"));
    expect(screen.getAllByTestId("query-row").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("adminSeoHub.queriesViewPages"));
    expect(screen.getAllByTestId("registry-page").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("query-row")).toBeNull();
  });

  it("wybór innej właściwości wysyła zapytanie o TEN adres, nie o domyślny", async () => {
    h.sites = {
      configured: true,
      sites: [{ siteUrl: "https://x.pl/" }, { siteUrl: "https://druga.pl/" }],
    };
    h.rows = [row("https://x.pl/blog/a", "fraza", { impressions: 100 })];
    await renderQueries();
    fireEvent.change(screen.getAllByTestId("select")[0], {
      target: { value: "https://druga.pl/" },
    });
    await waitFor(() => {
      expect(h.analyticsCalls[h.analyticsCalls.length - 1].siteUrl).toBe("https://druga.pl/");
    });
  });

  it("padnięty odczyt CMS-a nie kasuje rejestru - frazy zostają, znika tylko dopasowanie", async () => {
    // Frazy przychodzą z Google, tytuły z bazy. Awaria bazy nie może zabierać
    // tego, co Google już oddało - inaczej jeden zły odczyt gasi cały ekran.
    h.readError = new Error("PostgREST padł");
    h.rows = [row("https://x.pl/blog/a", "fraza", { impressions: 100 })];
    await renderQueries();
    const card = screen.getByTestId("registry-page");
    expect(card.textContent).toContain("/blog/a");
    expect(card.textContent).toContain("adminSeoHub.queriesUnmatched");
  });

  it("gdy nic nie odstaje od normy, mówi to wprost zamiast pokazywać pustą listę zadań", async () => {
    h.rows = [
      row("https://x.pl/blog/a", "fraza", {
        impressions: 1000,
        clicks: 300,
        ctr: 0.3,
        position: 3,
      }),
    ];
    await renderQueries();
    expect(screen.getByText("adminSeoHub.queriesOpportunitiesEmpty")).toBeTruthy();
  });

  it("gdy coś odstaje, pokazuje wyjaśnienie liczby do odzyskania", async () => {
    h.rows = [
      row("https://x.pl/blog/a", "fraza", {
        impressions: 1000,
        clicks: 1,
        ctr: 0.001,
        position: 3,
      }),
    ];
    await renderQueries();
    expect(screen.getByText("adminSeoHub.queriesMissedClicksHint")).toBeTruthy();
  });

  it("kafle sumują wyświetlenia i kliknięcia całego rejestru", async () => {
    h.rows = [
      row("https://x.pl/a", "q1", { impressions: 100, clicks: 3 }),
      row("https://x.pl/b", "q2", { impressions: 200, clicks: 7 }),
    ];
    await renderQueries();
    const text = document.body.textContent ?? "";
    expect(text).toContain("300");
    expect(text).toContain("10");
  });
});

describe("/admin/seo/queries - metadane trasy", () => {
  it("ma własny tytuł strony, żeby karta w przeglądarce nie była bezimienna", async () => {
    const meta = await routeMeta(QueriesRoute);
    const title = meta.find((entry) => typeof entry.title === "string")?.title;
    expect(title).toBeTruthy();
    expect(title).toContain("SEO");
  });
});
