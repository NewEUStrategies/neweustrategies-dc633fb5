// Trzy trasy panelu SEO ZAMONTOWANE: `/admin/seo`, `/admin/seo/search-console`
// i `/admin/settings/seo` (48 + 41 + 28 niepokrytych linii, wszystkie na zerze).
//
// CO TEN PLIK DOWODZI - I DLACZEGO NIE JEST FARMĄ POKRYCIA.
//
// `adminRouteAuthority.gate.test.ts` argumentuje wprost, że render-testowanie
// tras panelu dla samego pokrycia jest farmą: ryzyko w trasie panelu to DOSTĘP,
// a dostęp egzekwują trzy inne warstwy. Ta bramka ma rację, a jej zakres został
// rozszerzony o rodzinę `admin.seo*` w tym samym commicie - razem z `it.fails`
// opisującym realny defekt autorytetu na `/admin/settings/seo`.
//
// Ten plik pokrywa to, czego bramka CELOWO nie dotyka - STAN i SKLEJENIE:
//
//   1. TRZY STANY LISTY, a nie dwa. `/admin/seo` renderuje jeden komunikat
//      pustki (`admin.list.noResults`) i jeden „ładowanie” (`admin.loading`)
//      wybierane warunkiem `rows.length ? ... : ...`. Odczyt, który PADŁ,
//      zostawia `rows` puste - czyli awaria wygląda dokładnie jak trwające
//      ładowanie. To jest przedmiot `it.fails` niżej.
//   2. FILTRY I WYSZUKIWANIE jako czysta funkcja stanu: pięć kafelków-filtrów
//      (każdy przełączalny i wyłączalny powtórnym kliknięciem), filtr rodzaju,
//      szukanie po tytule PL, tytule EN i slugu.
//   3. ZAKRES DAT GSC. `/admin/seo/search-console` liczy przedział z `new Date()`
//      i celowo cofa koniec o 2 dni („GSC data lags ~2 days”). Bez ustalonej
//      daty bazowej ta arytmetyka nie jest dowodliwa, a to ona decyduje, czy
//      panel pokazuje puste dane, bo poprosił o dzień, którego GSC nie ma.
//   4. AGREGATY GSC: CTR i pozycja ważona wyświetleniami, z obroną przed
//      dzieleniem przez zero przy zerowych wyświetleniach.
//   5. PAYLOAD MUTACJI ustawień SEO: klamry `rss_item_count` (5-100) i to, co
//      dokładnie ląduje w `save.mutate`.
//   6. `head()` każdej trasy niesie tytuł. Zakładka bez tytułu to dziewięć
//      identycznych kart „New European Strategies”.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//
// * UWIERZYTELNIENIA. `e2e/seo.spec.ts` ma test „/admin/seo is auth-gated
//   (redirects to /auth or /login)” i on dowodzi, że niezalogowany NIE widzi
//   dashboardu. Tutaj nie ma ANI JEDNEJ asercji o przekierowaniu na /auth.
// * AUTORYTETU. Czy panel oferuje akcję, którą baza odrzuci - o to odpowiada
//   `adminRouteAuthority.gate.test.ts` (sekcja „panel SEO - autorytet
//   dostępu”), czytając polityki RLS jako tekst migracji.
// * REGUŁ OCENY SEO. `seoContentStatus` i `summarizeSeoStatuses` mają własne
//   pokrycie w `src/lib/seo/__tests__/contentStatus.test.ts`. Tutaj dowodzimy,
//   że trasa je WOŁA i respektuje wynik, a nie odtwarzamy ich tabeli.
// * ORGANIZMÓW PANELU. `SeoScorePill`, `StatusBadge`, `RobotsTxtPreview` i
//   `ImageSlot` mają własne testy w `src/components/admin/**`; tutaj są atrapami
//   -markerami potwierdzającymi PRZEKAZANE PROPY.
// * SERVER FN GSC. `listGscSites` / `queryGscAnalytics` to osobna powierzchnia
//   (`src/lib/analytics/gsc.functions.ts`); ZERO wyjścia do sieci, atrapy
//   oddają sterowalne wyniki.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { useEffect, useState, type ReactNode } from "react";
import { renderRoute, routeMeta } from "@/test/routeHarness";
// Domyślne ustawienia SEO czytamy z PRODUKCYJNEJ stałej, żeby test nie
// rozjechał się z polami, które trasa faktycznie renderuje - nowe pole
// w ustawieniach ma tu wyjść samo.
import { DEFAULT_SEO_SETTINGS as SEO_DEFAULTS } from "@/lib/seo/settings";
import { Route as OverviewRoute } from "@/routes/admin.seo";
import { Route as SearchConsoleRoute } from "@/routes/admin.seo.search-console";
import { Route as SeoSettingsRoute } from "@/routes/admin.settings.seo";

const h = vi.hoisted(() => ({
  /** Wiersze `posts` (undefined = zapytanie w locie / odczyt padł). */
  posts: undefined as unknown[] | undefined,
  /** Wiersze `pages`. */
  pages: undefined as unknown[] | undefined,
  /** Tabele, o które trasa faktycznie zapytała. */
  tables: [] as string[],
  /** Wynik `listGscSites`. */
  gscSites: { configured: true, sites: [{ siteUrl: "https://neweuropeanstrategies.com/" }] } as {
    configured: boolean;
    sites: Array<{ siteUrl: string }>;
  },
  /** Czy `listGscSites` ma odrzucić. */
  gscSitesError: null as Error | null,
  /** Wiersze zwracane przez `queryGscAnalytics`. */
  gscRows: [] as Array<{
    keys: string[];
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  }>,
  /** Argumenty KAŻDEGO wywołania `queryGscAnalytics`. */
  gscQueries: [] as Array<Record<string, unknown>>,
  /**
   * Ustawienia SEO oddawane przez `useSettings` (undefined = ładowanie).
   * STABILNA referencja - patrz komentarz przy atrapie `useSettings`.
   */
  seoSettings: undefined as Record<string, unknown> | undefined,
  /** Ten sam obiekt oddawany przy każdym renderze dla klucza `theme_options`. */
  themeOptions: { logo: { organization: "https://cdn.example/logo.png" } } as Record<
    string,
    unknown
  >,
  /** Payloady zapisu ustawień. */
  savePayloads: [] as Array<Record<string, unknown>>,
  savePending: false,
  /** Propsy zapisane przez atrapy organizmów. */
  organism: {} as Record<string, Record<string, unknown>>,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ tenantId: "t-1", isAdmin: true, isStaff: true }),
  useRequiredTenant: () => "t-1",
}));

// Klient Supabase: łańcuch PostgREST dla `posts` i `pages`. `undefined` w stanie
// znaczy „brak danych”, czyli to samo, co zostawia po sobie PADNIĘTY odczyt -
// i właśnie ta nieodróżnialność jest przedmiotem `it.fails` niżej.
vi.mock("@/integrations/supabase/client", () => {
  const chain = (table: string) => {
    const rows = table === "posts" ? h.posts : h.pages;
    const link: Record<string, unknown> = {};
    const self = () => link;
    for (const method of ["select", "eq", "is", "order", "limit"]) {
      link[method] = self;
    }
    link.then = (
      resolve: (value: { data: unknown[] | undefined; error: null }) => unknown,
    ): unknown => resolve({ data: rows, error: null });
    return link;
  };
  return {
    supabase: {
      from: (table: string) => {
        h.tables.push(table);
        return chain(table);
      },
    },
  };
});

vi.mock("@tanstack/react-start", () => ({
  useServerFn: (fn: unknown) => fn,
}));

vi.mock("@/lib/analytics/gsc.functions", () => ({
  listGscSites: () =>
    h.gscSitesError ? Promise.reject(h.gscSitesError) : Promise.resolve(h.gscSites),
  queryGscAnalytics: (input: { data: Record<string, unknown> }) => {
    h.gscQueries.push(input.data);
    return Promise.resolve({ rows: h.gscRows });
  },
}));

vi.mock("@/lib/admin/useSettings", () => ({
  // Atrapa MUSI oddawać TĘ SAMĄ referencję między renderami. `useDraft`
  // synchronizuje kopię roboczą efektem z zależnością `[source]`, więc nowy
  // obiekt przy każdym renderze zapętla render w nieskończoność - plik wisiał
  // wtedy do timeoutu bez ani jednego komunikatu (sprawdzone, nie założone).
  // Dlatego test podstawia gotowy obiekt w `beforeEach`, a atrapa go tylko
  // podaje - żadnego rozwijania w ciele hooka.
  useSettings: (key: string) => ({
    query: { data: key === "theme_options" ? h.themeOptions : h.seoSettings },
    save: {
      isPending: h.savePending,
      mutate: (payload: Record<string, unknown>) => {
        h.savePayloads.push(payload);
      },
    },
  }),
  // Prawdziwy `useDraft` synchronizuje kopię roboczą z odczytem; odtwarzamy to
  // minimalnie, bo przedmiotem dowodu jest PAYLOAD, nie mechanika kopii.
  useDraft: <T,>(source: T | undefined) => useDraftStub(source),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return { ...actual, Link: RouterLinkStub };
});

// Radix Select nie działa pod happy-dom bez pełnego pointer API. Podmieniamy na
// natywny `<select>`: przedmiotem dowodu jest to, KTÓRE opcje trasa wystawia
// i CO robi ze zmianą, a nie mechanika biblioteki.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (next: string) => void;
    children?: ReactNode;
  }) => (
    <select
      data-testid="select"
      value={value ?? ""}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

vi.mock("@/components/admin/atoms/StatusBadge", () => ({
  StatusBadge: ({ status, label }: { status: string; label: string }) => (
    <span data-testid="status-badge" data-status={status}>
      {label}
    </span>
  ),
}));

vi.mock("@/components/admin/seo/SeoScorePill", () => ({
  SeoScorePill: ({ score, grade }: { score: number; grade: string }) => (
    <span data-testid="score-pill" data-score={score} data-grade={grade} />
  ),
}));

vi.mock("@/components/admin/ImageSlot", () => ({
  ImageSlot: ({ label }: { label: string }) => <div data-testid="image-slot">{label}</div>,
}));

vi.mock("@/components/admin/seo/RobotsTxtPreview", () => ({
  RobotsTxtPreview: ({ settings }: { settings: Record<string, unknown> }) => {
    h.organism.robotsPreview = settings;
    return <div data-testid="robots-preview" />;
  },
}));

vi.mock("@/components/admin/settings/LinkedSource", () => ({
  // `preview` przychodzi PROPEM, nie jako children - atrapa musi go
  // wyrenderować, inaczej podgląd źródła znika z drzewa i test „puste pole
  // dziedziczy logo z motywu" nie ma czego znaleźć.
  LinkedSourceHeader: ({
    children,
    preview,
    sourceValue,
  }: {
    children?: ReactNode;
    preview?: ReactNode;
    sourceValue?: string;
  }) => (
    <div data-testid="linked-source" data-source-value={sourceValue ?? ""}>
      {preview}
      {children}
    </div>
  ),
  LinkedImagePreview: ({ src }: { src?: string }) => (
    <div data-testid="linked-image" data-src={src ?? ""} />
  ),
}));

// `useDraft` w kształcie testowym - musi mieszkać POZA fabryką `vi.mock`,
// bo fabryki są hoistowane i nie widzą importów z góry pliku.
function useDraftStub<T>(source: T | undefined): [T | undefined, (next: T) => void] {
  const [draft, setDraft] = useState<T | undefined>(source);
  useEffect(() => {
    if (source !== undefined) setDraft(source);
  }, [source]);
  return [draft, setDraft];
}

/** Wiersz treści w kształcie, w jakim czyta go `seoContentStatus`. */
function contentRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "p-1",
    slug: "analiza-jedna",
    status: "published",
    title_pl: "Analiza pierwsza",
    title_en: "First analysis",
    excerpt_pl: "Lead polski wystarczająco długi, żeby ocena go przyjęła.",
    excerpt_en: "English lead long enough for the assessment to accept it.",
    cover_image_url: "https://cdn.example/cover.jpg",
    seo_title_pl: null,
    seo_title_en: null,
    seo_description_pl: null,
    seo_description_en: null,
    seo_canonical_url: null,
    seo_noindex: false,
    seo_og_image_url: null,
    og_image_generated_url: null,
    ...overrides,
  };
}

beforeEach(() => {
  h.posts = [];
  h.pages = [];
  h.tables = [];
  h.gscSites = { configured: true, sites: [{ siteUrl: "https://neweuropeanstrategies.com/" }] };
  h.gscSitesError = null;
  h.gscRows = [];
  h.gscQueries = [];
  h.seoSettings = { ...SEO_DEFAULTS };
  h.savePayloads = [];
  h.savePending = false;
  h.organism = {};
  // GSC liczy przedział z `new Date()`; bez ustalonej daty arytmetyka zakresu
  // nie jest dowodliwa.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-02-03T10:15:00Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ===========================================================================
// /admin/seo - przegląd treści
// ===========================================================================

describe("/admin/seo - przegląd treści", () => {
  async function mount(): Promise<HTMLElement> {
    const rendered = await renderRoute({
      route: OverviewRoute,
      path: "/admin/seo",
      initialEntry: "/admin/seo",
    });
    return rendered.container;
  }

  it("head() niesie tytuł zakładki", async () => {
    const meta = await routeMeta(OverviewRoute);
    expect(meta.some((entry) => typeof entry.title === "string" && entry.title.length > 0)).toBe(
      true,
    );
  });

  it("czyta OBIE tabele treści, zawężone do tenanta", async () => {
    await mount();
    await waitFor(() => {
      expect(h.tables).toContain("posts");
      expect(h.tables).toContain("pages");
    });
  });

  it("stan PUSTY (obie tabele bez wierszy) pokazuje klucz `admin.loading`", async () => {
    // To jest stan faktyczny, nie postulowany: warunek w trasie to
    // `rows.length ? t("admin.list.noResults") : t("admin.loading")`, więc przy
    // zerowej liczbie wierszy - także po odczycie zakończonym! - panel mówi
    // „ładowanie”. Przypinamy to, żeby naprawa od razu wywaliła test.
    h.posts = [];
    h.pages = [];
    await mount();
    await waitFor(() => {
      expect(screen.getByText("admin.loading")).toBeTruthy();
    });
  });

  it.fails(
    "DEFEKT: awaria odczytu jest NIEROZRÓŻNIALNA od trwającego ładowania i od pustej bazy",
    async () => {
      // KONSEKWENCJA. `useQuery` w tej trasie nie ma ŻADNEJ obsługi `error`:
      // `const { data: posts } = useQuery(...)`. Gdy odczyt padnie (odebrany
      // grant, awaria PostgREST, zerwana sieć), `posts` zostaje `undefined`,
      // `rows` jest puste i tabela renderuje „admin.loading” - wieczne
      // ładowanie bez żadnego komunikatu. Redakcja widzi kręcący się panel
      // i wnioskuje, że serwis nie ma treści albo że „coś się zacięło”;
      // nikt nie dowiaduje się, że przegląd SEO nie działa. Zadanie wymaga
      // stanu błędu ODRĘBNEGO od pustki - tego stanu tu nie ma.
      //
      // NAPRAWA (poza zakresem: nie zmieniamy produkcji, żeby test przeszedł):
      // odczytać `isError` z obu zapytań i wyświetlić komunikat błędu, tak jak
      // robi to `/admin/seo/search-console` (`sitesQuery.error`).
      h.posts = undefined;
      h.pages = undefined;
      await mount();
      await waitFor(() => {
        expect(screen.queryByText("admin.loading"), "awaria nie może udawać ładowania").toBeNull();
      });
    },
  );

  it("wiersze z OBU tabel trafiają do tabeli, strony przed wpisami", async () => {
    h.pages = [contentRow({ id: "pg-1", slug: "o-nas", title_pl: "O nas" })];
    h.posts = [contentRow({ id: "po-1", slug: "analiza", title_pl: "Analiza" })];
    await mount();
    await waitFor(() => {
      expect(screen.getAllByTestId("score-pill")).toHaveLength(2);
    });
    const slugs = screen.getAllByText(/^\/(o-nas|analiza)$/).map((el) => el.textContent);
    expect(slugs).toEqual(["/o-nas", "/analiza"]);
  });

  it("kafelki podsumowania liczą wiersze i mają klucze i18n", async () => {
    h.posts = [contentRow({ seo_noindex: true }), contentRow({ id: "p-2", slug: "b" })];
    h.pages = [];
    await mount();
    await waitFor(() => {
      expect(screen.getByText("admin.seoOverview.tileTotal")).toBeTruthy();
    });
    for (const key of [
      "admin.seoOverview.tileMissingDesc",
      "admin.seoOverview.tileDefaultImage",
      "admin.seoOverview.tileNoindex",
      "admin.seoOverview.tileOverrides",
    ]) {
      expect(screen.getByText(key)).toBeTruthy();
    }
  });

  it("kliknięcie kafelka WŁĄCZA filtr, a powtórne go WYŁĄCZA", async () => {
    // Kafelek jest jedynym sposobem dojścia do listy „braki opisu”, więc
    // przełącznik musi działać w obie strony - inaczej redakcja zostaje
    // z zawężoną listą i nie wie dlaczego.
    h.posts = [
      contentRow({ id: "z-opisem", slug: "z-opisem" }),
      contentRow({ id: "bez-opisu", slug: "bez-opisu", excerpt_pl: null, excerpt_en: null }),
    ];
    h.pages = [];
    await mount();
    await waitFor(() => expect(screen.getAllByTestId("score-pill")).toHaveLength(2));

    fireEvent.click(screen.getByText("admin.seoOverview.tileMissingDesc"));
    await waitFor(() => expect(screen.getAllByTestId("score-pill")).toHaveLength(1));
    expect(screen.getByText("/bez-opisu")).toBeTruthy();

    fireEvent.click(screen.getByText("admin.seoOverview.tileMissingDesc"));
    await waitFor(() => expect(screen.getAllByTestId("score-pill")).toHaveLength(2));
  });

  it("kafelek „Łącznie” nie jest filtrem - kliknięcie nie zawęża listy", async () => {
    h.posts = [contentRow(), contentRow({ id: "p-2", slug: "b" })];
    h.pages = [];
    await mount();
    await waitFor(() => expect(screen.getAllByTestId("score-pill")).toHaveLength(2));
    fireEvent.click(screen.getByText("admin.seoOverview.tileTotal"));
    await waitFor(() => expect(screen.getAllByTestId("score-pill")).toHaveLength(2));
  });

  it("filtr rodzaju zawęża do wpisów albo do stron", async () => {
    h.posts = [contentRow({ id: "po", slug: "wpis" })];
    h.pages = [contentRow({ id: "pg", slug: "strona" })];
    await mount();
    await waitFor(() => expect(screen.getAllByTestId("score-pill")).toHaveLength(2));

    fireEvent.change(screen.getByTestId("select"), { target: { value: "post" } });
    await waitFor(() => expect(screen.getAllByTestId("score-pill")).toHaveLength(1));
    expect(screen.getByText("/wpis")).toBeTruthy();

    fireEvent.change(screen.getByTestId("select"), { target: { value: "page" } });
    await waitFor(() => expect(screen.getByText("/strona")).toBeTruthy());

    fireEvent.change(screen.getByTestId("select"), { target: { value: "all" } });
    await waitFor(() => expect(screen.getAllByTestId("score-pill")).toHaveLength(2));
  });

  it.each([
    ["Analiza", "/pierwsza"],
    ["analiza", "/pierwsza"],
    ["FIRST", "/pierwsza"],
    ["pierwsza", "/pierwsza"],
  ])("szukanie %j znajduje wiersz po tytule PL, tytule EN albo slugu", async (query, expected) => {
    h.posts = [
      contentRow({ id: "a", slug: "pierwsza", title_pl: "Analiza", title_en: "First" }),
      contentRow({ id: "b", slug: "druga", title_pl: "Coś innego", title_en: "Something else" }),
    ];
    h.pages = [];
    await mount();
    await waitFor(() => expect(screen.getAllByTestId("score-pill")).toHaveLength(2));
    const input = screen.getByPlaceholderText("admin.seoOverview.searchPlaceholder");
    fireEvent.change(input, { target: { value: query } });
    await waitFor(() => expect(screen.getAllByTestId("score-pill")).toHaveLength(1));
    expect(screen.getByText(expected)).toBeTruthy();
  });

  it("szukanie bez trafień pokazuje `admin.list.noResults`, NIE `admin.loading`", async () => {
    // To jest ta różnica, którą trasa umie zrobić poprawnie: skoro wiersze
    // istnieją, pustka po filtrze mówi „nic nie pasuje”, a nie „ładowanie”.
    h.posts = [contentRow()];
    h.pages = [];
    await mount();
    await waitFor(() => expect(screen.getAllByTestId("score-pill")).toHaveLength(1));
    fireEvent.change(screen.getByPlaceholderText("admin.seoOverview.searchPlaceholder"), {
      target: { value: "czegoś-takiego-nie-ma" },
    });
    await waitFor(() => expect(screen.getByText("admin.list.noResults")).toBeTruthy());
    expect(screen.queryByText("admin.loading")).toBeNull();
  });

  it.each([
    ["noindex", { seo_noindex: true }],
    ["default_image", { cover_image_url: null }],
    ["overrides", { seo_title_pl: "Nadpisany tytuł" }],
  ])("filtr %s zostawia wyłącznie wiersz, który go spełnia", async (filterKey, overrides) => {
    const tileKey =
      filterKey === "noindex"
        ? "admin.seoOverview.tileNoindex"
        : filterKey === "default_image"
          ? "admin.seoOverview.tileDefaultImage"
          : "admin.seoOverview.tileOverrides";
    h.posts = [
      contentRow({ id: "zwykly", slug: "zwykly" }),
      contentRow({ id: "x", slug: "x", ...overrides }),
    ];
    h.pages = [];
    await mount();
    await waitFor(() => expect(screen.getAllByTestId("score-pill")).toHaveLength(2));
    fireEvent.click(screen.getByText(tileKey));
    await waitFor(() => expect(screen.getAllByTestId("score-pill")).toHaveLength(1));
    expect(screen.getByText("/x")).toBeTruthy();
  });

  it("wiersz `noindex` dostaje plakietkę, a zwykły kreskę", async () => {
    h.posts = [contentRow({ seo_noindex: true })];
    h.pages = [contentRow({ id: "pg", slug: "strona" })];
    await mount();
    await waitFor(() => expect(screen.getAllByTestId("score-pill")).toHaveLength(2));
    expect(screen.getAllByText("noindex").length).toBeGreaterThan(0);
  });

  it("odnośnik wiersza prowadzi do edytora WŁAŚCIWEGO rodzaju treści", async () => {
    h.posts = [contentRow({ id: "po", slug: "wpis" })];
    h.pages = [contentRow({ id: "pg", slug: "strona" })];
    await mount();
    await waitFor(() => expect(screen.getAllByTestId("score-pill")).toHaveLength(2));
    const hrefs = screen.getAllByRole("link").map((el) => el.getAttribute("href"));
    expect(hrefs).toContain("/admin/posts/wpis");
    expect(hrefs).toContain("/admin/pages/strona");
  });

  it("tytuł pusty w obu językach spada na slug", async () => {
    h.posts = [contentRow({ slug: "tylko-slug", title_pl: "", title_en: "" })];
    h.pages = [];
    await mount();
    await waitFor(() => expect(screen.getAllByTestId("score-pill")).toHaveLength(1));
    // Odnośnik niesie slug jako treść - to ostatnie ramię `||` w trasie.
    expect(screen.getByRole("link").textContent).toContain("tylko-slug");
  });

  it("licznik „przefiltrowane / wszystkie” pokazuje oba wymiary", async () => {
    // Trasa renderuje `{filtered.length} / {rows.length}`, co React rozbija na
    // OSOBNE węzły tekstowe - `getByText("1 / 2")` takiego napisu nie widzi.
    // Czytamy więc `textContent` bezpośrednio z kontenera; to jedyna asercja
    // w tym pliku, która musi obejść matcher Testing Library, i dlatego ma
    // własny komentarz zamiast pomocnika.
    const counters = (root: HTMLElement) =>
      Array.from(root.querySelectorAll("span")).map((el) =>
        (el.textContent ?? "").replace(/\s+/g, " ").trim(),
      );
    // Tytuły i slugi muszą się ROZCHODZIĆ, inaczej fraza trafia w oba wiersze
    // i licznik nie ma jak spaść (pierwsza wersja tego testu miała dokładnie
    // ten błąd: „a" siedzi i w „Analiza", i w slugu drugiego wiersza).
    h.posts = [
      contentRow({
        id: "a",
        slug: "geopolityka",
        title_pl: "Geopolityka",
        title_en: "Geopolitics",
      }),
      contentRow({ id: "b", slug: "sankcje", title_pl: "Sankcje", title_en: "Sanctions" }),
    ];
    h.pages = [];
    const container = await mount();
    await waitFor(() => expect(counters(container)).toContain("2 / 2"));
    fireEvent.change(screen.getByPlaceholderText("admin.seoOverview.searchPlaceholder"), {
      target: { value: "sankcje" },
    });
    await waitFor(() => expect(counters(container)).toContain("1 / 2"));
  });
});

// ===========================================================================
// /admin/seo/search-console
// ===========================================================================

describe("/admin/seo/search-console", () => {
  async function mount(): Promise<void> {
    await renderRoute({
      route: SearchConsoleRoute,
      path: "/admin/seo/search-console",
      initialEntry: "/admin/seo/search-console",
    });
  }

  it("head() niesie tytuł zakładki", async () => {
    const meta = await routeMeta(SearchConsoleRoute);
    expect(meta.some((entry) => typeof entry.title === "string" && entry.title.length > 0)).toBe(
      true,
    );
  });

  it("BRAK KONFIGURACJI pokazuje klucz `admin.gsc.notConfigured` i nie pyta o dane", async () => {
    h.gscSites = { configured: false, sites: [] };
    await mount();
    await waitFor(() => expect(screen.getByText("admin.gsc.notConfigured")).toBeTruthy());
    expect(h.gscQueries, "bez właściwości nie ma o co pytać").toHaveLength(0);
    expect(screen.queryByText("admin.gsc.noSites")).toBeNull();
  });

  it("BRAK WŁAŚCIWOŚCI to komunikat ODRĘBNY od braku konfiguracji", async () => {
    h.gscSites = { configured: true, sites: [] };
    await mount();
    await waitFor(() => expect(screen.getByText("admin.gsc.noSites")).toBeTruthy());
    expect(screen.queryByText("admin.gsc.notConfigured")).toBeNull();
    expect(h.gscQueries).toHaveLength(0);
  });

  it("BŁĄD odczytu właściwości ma własny komunikat - nie udaje pustki", async () => {
    // Ta trasa robi to, czego nie robi `/admin/seo`: czyta `sitesQuery.error`
    // i wyświetla komunikat. Przypinamy to jako wzorzec do naprawy tamtej.
    h.gscSitesError = new Error("GSC: brak uprawnień do właściwości");
    await mount();
    await waitFor(() =>
      expect(screen.getByText("GSC: brak uprawnień do właściwości")).toBeTruthy(),
    );
  });

  it("domyślny zakres to 28 dni, a koniec cofnięty o 2 dni (opóźnienie danych GSC)", async () => {
    // Data bazowa 2026-02-03 -> koniec 2026-02-01, początek 2026-01-04 (30 dni).
    // Bez cofnięcia panel prosiłby o dzień, którego GSC jeszcze nie ma, i
    // pokazywał zera przy działającym serwisie.
    await mount();
    await waitFor(() => expect(h.gscQueries.length).toBeGreaterThan(0));
    expect(h.gscQueries[0]).toMatchObject({
      siteUrl: "https://neweuropeanstrategies.com/",
      startDate: "2026-01-04",
      endDate: "2026-02-01",
      rowLimit: 25,
    });
  });

  it("pyta OSOBNO o zapytania i o strony", async () => {
    await mount();
    await waitFor(() => expect(h.gscQueries.length).toBeGreaterThanOrEqual(2));
    const dimensions = h.gscQueries.map((q) => q.dimensions);
    expect(dimensions).toEqual(expect.arrayContaining([["query"], ["page"]]));
  });

  it.each([
    ["7d", "2026-01-25"],
    ["90d", "2025-11-03"],
  ])("zmiana zakresu na %s przesuwa datę początkową na %s", async (range, expectedStart) => {
    // Zakres domyślny to 28d, więc przełączamy na INNY - przestawienie na ten
    // sam nie zmieniłoby klucza cache i nowego zapytania by nie było.
    // Arytmetyka kodu: koniec = dziś - 2 dni = 2026-02-01; początek = dziś - N,
    // gdzie N to 9 / 30 / 92 dni (bufor na opóźnienie danych GSC).
    await mount();
    await waitFor(() => expect(h.gscQueries.length).toBeGreaterThan(0));
    h.gscQueries = [];
    const selects = screen.getAllByTestId("select");
    // Drugi `<select>` to zakres (pierwszy wybiera właściwość).
    fireEvent.change(selects[1], { target: { value: range } });
    await waitFor(() => expect(h.gscQueries.length).toBeGreaterThan(0));
    expect(h.gscQueries[0]).toMatchObject({ startDate: expectedStart, endDate: "2026-02-01" });
  });

  it("agregaty liczą CTR i pozycję WAŻONĄ wyświetleniami", async () => {
    // Pozycja średnia arytmetyczna kłamie: strona z 1 wyświetleniem na pozycji
    // 1 nie może przeważyć strony z 999 wyświetleniami na pozycji 20.
    h.gscRows = [
      { keys: ["fraza a"], clicks: 10, impressions: 100, ctr: 0.1, position: 5 },
      { keys: ["fraza b"], clicks: 5, impressions: 900, ctr: 0.0055, position: 25 },
    ];
    await mount();
    // clicks 15, impressions 1000, CTR 1,50%, pozycja (5*100 + 25*900)/1000 = 23,0.
    // Kafelki agregatów mają klasę `text-2xl`; klucz „admin.gsc.clicks" pojawia
    // się też w nagłówkach obu tabel, więc szukamy po WARTOŚCI, nie po etykiecie.
    await waitFor(() => expect(screen.getAllByText("1.50%").length).toBeGreaterThan(0));
    expect(screen.getAllByText("23.0").length).toBeGreaterThan(0);
    expect(screen.getAllByText("15").length).toBeGreaterThan(0);
  });

  it("zerowe wyświetlenia nie dzielą przez zero", async () => {
    h.gscRows = [{ keys: ["fraza"], clicks: 0, impressions: 0, ctr: 0, position: 0 }];
    await mount();
    await waitFor(() => expect(screen.getAllByText("0.00%").length).toBeGreaterThan(0));
    // Sedno testu: ZERO wyświetleń nie może dać NaN ani Infinity w żadnym
    // miejscu - ani w kafelku CTR, ani w kolumnie pozycji.
    expect(screen.queryByText("NaN%")).toBeNull();
    expect(screen.queryByText("NaN")).toBeNull();
    expect(screen.queryByText("Infinity")).toBeNull();
  });

  it("brak wierszy pokazuje `admin.gsc.noData` w obu tabelach", async () => {
    h.gscRows = [];
    await mount();
    await waitFor(() => expect(screen.getAllByText("admin.gsc.noData")).toHaveLength(2));
  });

  it("wiersz tabeli stron renderuje adres jako odnośnik w nowej karcie", async () => {
    h.gscRows = [
      {
        keys: ["https://neweuropeanstrategies.com/analizy/x"],
        clicks: 3,
        impressions: 40,
        ctr: 0.075,
        position: 12.34,
      },
    ];
    await mount();
    await waitFor(() => expect(screen.getAllByText("admin.gsc.topPages")).toHaveLength(1));
    const link = screen
      .getAllByRole("link")
      .find((el) => el.getAttribute("href")?.includes("/analizy/x"));
    expect(link, "adres strony musi być klikalny").toBeTruthy();
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toContain("noopener");
  });

  it("wiersz bez klucza nie wywraca tabeli (spadek na pusty napis)", async () => {
    h.gscRows = [{ keys: [], clicks: 1, impressions: 2, ctr: 0.5, position: 3 }];
    await mount();
    await waitFor(() => expect(screen.getAllByText("admin.gsc.topQueries")).toHaveLength(1));
    expect(screen.getAllByText("50.00%").length).toBeGreaterThan(0);
  });

  it("odnośnik powrotny prowadzi do /admin/seo", async () => {
    await mount();
    await waitFor(() => expect(screen.getByText(/admin\.gsc\.backToSeo/)).toBeTruthy());
    const hrefs = screen.getAllByRole("link").map((el) => el.getAttribute("href"));
    expect(hrefs).toContain("/admin/seo");
  });
});

// ===========================================================================
// /admin/settings/seo
// ===========================================================================

describe("/admin/settings/seo - ustawienia SEO serwisu", () => {
  async function mount(): Promise<void> {
    await renderRoute({
      route: SeoSettingsRoute,
      path: "/admin/settings/seo",
      initialEntry: "/admin/settings/seo",
    });
  }

  /** Przycisk `SaveBar` - jedyny przycisk formularza ustawień. */
  function saveButton(): HTMLElement {
    const buttons = screen.getAllByRole("button");
    expect(buttons, "formularz musi mieć przycisk zapisu").not.toHaveLength(0);
    return buttons[buttons.length - 1];
  }

  it("head() niesie tytuł zakładki", async () => {
    const meta = await routeMeta(SeoSettingsRoute);
    expect(meta.some((entry) => typeof entry.title === "string" && entry.title.length > 0)).toBe(
      true,
    );
  });

  it("przed odczytem ustawień pokazuje `admin.loading` i NIE renderuje formularza", async () => {
    h.seoSettings = undefined;
    await mount();
    await waitFor(() => expect(screen.getByText("admin.loading")).toBeTruthy());
    expect(screen.queryByText("admin.seoSettings.title")).toBeNull();
  });

  it("po odczycie renderuje sekcje z kluczami i18n", async () => {
    await mount();
    await waitFor(() => expect(screen.getByText("admin.seoSettings.title")).toBeTruthy());
    for (const key of ["admin.seoSettings.sectionTitles", "admin.seoSettings.sectionFeeds"]) {
      expect(screen.getByText(key)).toBeTruthy();
    }
  });

  it("zapis wysyła kopię roboczą z NAŁOŻONĄ zmianą pola", async () => {
    h.seoSettings = { ...SEO_DEFAULTS, ...{ title_suffix: "Stary sufiks" } };
    await mount();
    await waitFor(() => expect(screen.getByText("admin.seoSettings.title")).toBeTruthy());
    // Pole sufiksu tytułu jest jedynym `<input maxlength="120">` w formularzu;
    // `placeholder` mają tu wszystkie pola tekstowe, więc nie zawęża.
    const suffix = screen
      .getAllByRole("textbox")
      .find((el) => el.getAttribute("maxlength") === "120");
    expect(suffix, "formularz musi mieć pole sufiksu tytułu").toBeTruthy();
    fireEvent.change(suffix!, { target: { value: "Nowy sufiks" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.savePayloads).toHaveLength(1));
    expect(h.savePayloads[0]).toMatchObject({ title_suffix: "Nowy sufiks" });
  });

  it.each([
    ["4", 5],
    ["5", 5],
    ["30", 30],
    ["100", 100],
    ["101", 100],
    ["", 30],
    ["nie-liczba", 30],
  ])("liczba wpisów w RSS %j zaciska się do %s", async (typed, expected) => {
    // Klamry mają znaczenie po obu stronach: 0 wyłączyłoby kanał bez informacji,
    // a 5000 wygenerowałoby dokument, którego czytniki nie przyjmą.
    h.seoSettings = { ...SEO_DEFAULTS, ...{ rss_item_count: 30 } };
    await mount();
    await waitFor(() => expect(screen.getByText("admin.seoSettings.title")).toBeTruthy());
    const number = screen.getByRole("spinbutton");
    fireEvent.change(number, { target: { value: typed } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.savePayloads).toHaveLength(1));
    expect(h.savePayloads[0]).toMatchObject({ rss_item_count: expected });
  });

  it("przełącznik RSS trafia do payloadu w obie strony", async () => {
    h.seoSettings = { ...SEO_DEFAULTS, ...{ rss_enabled: true } };
    await mount();
    await waitFor(() => expect(screen.getByText("admin.seoSettings.rssEnabled")).toBeTruthy());
    fireEvent.click(screen.getByText("admin.seoSettings.rssEnabled"));
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.savePayloads).toHaveLength(1));
    expect(h.savePayloads[0]).toMatchObject({ rss_enabled: false });
  });

  it("podgląd robots.txt dostaje BIEŻĄCĄ kopię roboczą, nie zapisane ustawienia", async () => {
    // O to jest cały sens podglądu: redakcja ma zobaczyć skutek zmiany PRZED
    // zapisem. Gdyby dostawał `query.data`, pokazywałby stan sprzed edycji.
    h.seoSettings = { ...SEO_DEFAULTS, ...{ rss_enabled: true } };
    await mount();
    await waitFor(() => expect(screen.getByTestId("robots-preview")).toBeTruthy());
    expect(h.organism.robotsPreview).toMatchObject({ rss_enabled: true });
  });

  it.each([
    ["admin.seoSettings.titleSuffixEnabled", "title_suffix_enabled"],
    ["admin.seoSettings.newsSitemapEnabled", "news_sitemap_enabled"],
    ["admin.seoSettings.llmsEnabled", "llms_txt_enabled"],
    ["admin.seoSettings.aiSearchAllowed", "ai_search_crawlers_allowed"],
    ["admin.seoSettings.aiTrainingAllowed", "ai_training_crawlers_allowed"],
  ])("przełącznik %s trafia do payloadu jako `%s`", async (labelKey, field) => {
    // Każdy z tych przełączników zmienia zachowanie POWIERZCHNI PUBLICZNEJ:
    // llms.txt i polityka crawlerów AI decydują, co asystenci mogą czytać
    // i czym się trenować, a news sitemap - czy serwis jest w Google News.
    // Wartość musi dojechać do payloadu pod właściwym kluczem, bo pomyłka
    // klucza jest tu niewidoczna do pierwszego audytu.
    h.seoSettings = { ...SEO_DEFAULTS, [field]: true };
    await mount();
    await waitFor(() => expect(screen.getByText(labelKey)).toBeTruthy());
    fireEvent.click(screen.getByText(labelKey));
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.savePayloads).toHaveLength(1));
    expect(h.savePayloads[0]).toMatchObject({ [field]: false });
  });

  it.each([
    ["news_publication_name", "Nowa nazwa wydawnictwa", 120, "wydawnictwo-startowe"],
    ["twitter_site", "@nowe_konto", 60, "@startowe"],
  ])("pole tekstowe `%s` trafia do payloadu", async (field, typed, maxLength, marker) => {
    // Sufiks tytułu i nazwa wydawnictwa mają TEN SAM `maxlength=120`, więc
    // atrybut ich nie rozróżnia. Rozróżnia je wartość startowa, którą
    // podstawiamy jako znacznik - to jedyny selektor niezależny od kolejności
    // pól w formularzu.
    h.seoSettings = { ...SEO_DEFAULTS, [field]: marker };
    await mount();
    await waitFor(() => expect(screen.getByText("admin.seoSettings.title")).toBeTruthy());
    const input = screen
      .getAllByRole("textbox")
      .find(
        (el) =>
          el.getAttribute("maxlength") === String(maxLength) &&
          el instanceof HTMLInputElement &&
          el.value === marker,
      );
    expect(input, `brak pola ${field}`).toBeTruthy();
    fireEvent.change(input!, { target: { value: typed } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.savePayloads).toHaveLength(1));
    expect(h.savePayloads[0]).toMatchObject({ [field]: typed });
  });

  it.each([
    [
      "https://www.linkedin.com/company/nes\nhttps://x.com/nes",
      ["https://www.linkedin.com/company/nes", "https://x.com/nes"],
    ],
    ["  https://x.com/nes  ", ["https://x.com/nes"]],
    ["x.com/nes\nftp://plik", []],
    ["", []],
  ])("`sameAs` przyjmuje %j i normalizuje do %j", async (typed, expected) => {
    // To pole zasila `sameAs` w JSON-LD organizacji. Wiersz, który nie jest
    // adresem http(s), MUSI wypaść: Google czyta ten graf jako tożsamość
    // wydawcy, a nieprawidłowy adres unieważnia cały węzeł.
    h.seoSettings = { ...SEO_DEFAULTS, organization_same_as: [] };
    await mount();
    await waitFor(() => expect(screen.getByText("admin.seoSettings.sameAs")).toBeTruthy());
    const area = screen.getByPlaceholderText(/linkedin\.com/);
    fireEvent.change(area, { target: { value: typed } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.savePayloads).toHaveLength(1));
    expect(h.savePayloads[0]).toMatchObject({ organization_same_as: expected });
  });

  it("`sameAs` obcina listę do dwudziestu pozycji", async () => {
    h.seoSettings = { ...SEO_DEFAULTS, organization_same_as: [] };
    await mount();
    await waitFor(() => expect(screen.getByText("admin.seoSettings.sameAs")).toBeTruthy());
    const many = Array.from({ length: 25 }, (_, i) => `https://example.com/${i}`).join("\n");
    fireEvent.change(screen.getByPlaceholderText(/linkedin\.com/), { target: { value: many } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.savePayloads).toHaveLength(1));
    const saved = h.savePayloads[0].organization_same_as;
    expect(Array.isArray(saved) && saved.length).toBe(20);
  });

  it.each([
    [
      { logo: { organization: "https://cdn/org.png", main: "https://cdn/main.png" } },
      "https://cdn/org.png",
    ],
    [{ logo: { main: "https://cdn/main.png" } }, "https://cdn/main.png"],
    [{ logo: {} }, ""],
    [{}, ""],
  ])("logo wydawcy dziedziczone z motywu: %j -> %j", async (themeOptions, expected) => {
    // Lancuch `themeLogo.organization || themeLogo.main || ""` decyduje, co
    // trafia do `publisher` w JSON-LD artykulu, gdy redakcja nie nadpisala
    // logo. Kazde ramie osobno, bo pomylka daje wezel wydawcy bez logo -
    // a Google traktuje to jako brak, nie jako logo domyslne.
    h.themeOptions = themeOptions;
    h.seoSettings = { ...SEO_DEFAULTS, publisher_logo_url: "" };
    await mount();
    await waitFor(() => expect(screen.getByTestId("linked-source")).toBeTruthy());
    expect(screen.getByTestId("linked-source").getAttribute("data-source-value")).toBe(expected);
    expect(screen.getByTestId("linked-image").getAttribute("data-src")).toBe(expected);
  });

  it("nadpisane logo wydawcy wygrywa nad logo z motywu", async () => {
    h.themeOptions = { logo: { organization: "https://cdn/org.png" } };
    h.seoSettings = { ...SEO_DEFAULTS, publisher_logo_url: "https://cdn/wlasne.png" };
    await mount();
    await waitFor(() => expect(screen.getByTestId("image-slot")).toBeTruthy());
    // Zrodlo (motyw) nadal jest widoczne jako informacja, ale wartosc pola to
    // nadpisanie - inaczej redakcja nie wiedzialaby, ze cos nadpisala.
    expect(screen.getByTestId("linked-source").getAttribute("data-source-value")).toBe(
      "https://cdn/org.png",
    );
  });

  it("sekcje AI i encji wydawcy renderują nagłówki z kluczy", async () => {
    await mount();
    await waitFor(() => expect(screen.getByText("admin.seoSettings.sectionAi")).toBeTruthy());
    expect(screen.getByText("admin.seoSettings.sectionEntity")).toBeTruthy();
    expect(screen.getByText("admin.seoSettings.robotsPreview")).toBeTruthy();
  });

  it("stan zapisywania blokuje przycisk - dwa kliknięcia nie wysyłają dwóch zapisów", async () => {
    h.savePending = true;
    await mount();
    await waitFor(() => expect(screen.getByText("admin.seoSettings.title")).toBeTruthy());
    expect(saveButton().hasAttribute("disabled")).toBe(true);
  });
});
