// NOWE trasy kokpitu SEO: układ zakładek `/admin/seo`, karty społecznościowe
// `/admin/seo/social`, strona główna `/admin/seo/homepage` i kokpit
// `/admin/seo/` - wszystkie powstały 2026-09-14 i żadna nie miała pokrycia.
//
// CO TEN PLIK DOWODZI - I DLACZEGO TO NIE JEST FARMA POKRYCIA.
//
//   1. UKŁAD FAKTYCZNIE RENDERUJE `<Outlet />`. To jest CAŁA naprawa pozycji
//      `admin.seo` ze zmrożonego długu w `parentRoutesRenderOutlet.gate.test.ts`:
//      rodzic z własnym komponentem i bez `<Outlet />` montuje się sam, a jego
//      dzieci są nieosiągalne z przeglądarki. Tamta bramka czyta ŹRÓDŁO
//      (regex po `<Outlet`), więc nie widzi, czy węzeł faktycznie trafia do
//      drzewa. Tutaj jest render.
//   2. ZAKŁADKA INDEKSOWA dopasowuje się DOKŁADNĄ ścieżką. Prefiks "/admin/seo"
//      pasuje do każdej podstrony, więc naiwne `startsWith` zapalałoby kokpit
//      jako aktywny na wszystkich pięciu zakładkach naraz. To jedna linia
//      warunku i dokładnie ta klasa błędu, której nie widać w przeglądzie.
//   3. PODGLĄDY SIECI RÓŻNIĄ SIĘ. Cała wartość zakładki kart społecznościowych
//      polega na tym, że X przycina tytuł wcześniej niż LinkedIn i że przy
//      karcie „summary" kadr X-a robi się kwadratowy. Gdyby wszystkie karty
//      dostały jeden kształt, ekran wyglądałby poprawnie i kłamał.
//   4. AUTORYTET ZAPISU. Zakładki zapisujące `site_settings` gaszą zapis bez
//      roli `admin` - baza i tak by go odrzuciła (polityki RLS). Bramka
//      `adminRouteAuthority.gate.test.ts` czyta w tej sprawie ŹRÓDŁO; tutaj
//      sprawdzamy ZACHOWANIE: czy przycisk jest wyłączony i czy klik nic nie
//      wysyła.
//   5. PAYLOAD ZAPISU: co dokładnie ląduje w `save.mutate` po zmianie pola.
//   6. `head()` każdej trasy niesie własny tytuł - pięć zakładek bez tytułów
//      to pięć identycznych kart w przeglądarce.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//
// * REGUŁ AUDYTU MARKI. `auditBrandSeo` ma własną, pełną tablicę wejść
//   w `src/lib/seo/__tests__/brandAudit.test.ts`. Tutaj dowodzimy, że ekran
//   te reguły WOŁA i renderuje ich wynik przez klucze i18n - nie odtwarzamy
//   tabeli.
// * PROGÓW PRZYCIĘCIA per sieć - `src/lib/seo/__tests__/socialNetworks.test.ts`.
// * TABELI TREŚCI - `adminSeoRoutes.test.tsx` (przeniesiona do
//   `/admin/seo/content`, tam też został jej `it.fails` o nierozróżnialności
//   awarii odczytu od ładowania).
// * UWIERZYTELNIENIA - `e2e/seo.spec.ts` dowodzi, że niezalogowany nie zobaczy
//   `/admin/seo`. Tutaj nie ma ani jednej asercji o przekierowaniu.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { useEffect, useState, type ReactNode } from "react";
import { renderRoute, routeMeta } from "@/test/routeHarness";
import { DEFAULT_SEO_SETTINGS } from "@/lib/seo/settings";
import { SOCIAL_NETWORKS } from "@/lib/seo/socialNetworks";
import { Route as HubLayoutRoute } from "@/routes/admin.seo";
import { Route as SocialRoute } from "@/routes/admin.seo.social";
import { Route as HomepageRoute } from "@/routes/admin.seo.homepage";
import { Route as DashboardRoute } from "@/routes/admin.seo.index";
import { SITE_DEFAULT_TITLE, SITE_NAME } from "@/lib/seo/meta";

const h = vi.hoisted(() => ({
  /** Ustawienia oddawane przez `useSettings` (undefined = ładowanie). */
  seoSettings: undefined as Record<string, unknown> | undefined,
  /** Payloady zapisu. */
  savePayloads: [] as Array<Record<string, unknown>>,
  savePending: false,
  /** Rola oglądającego - przedmiot dowodu w sekcji o autorytecie. */
  isAdmin: true,
  /** Propsy KAŻDEGO podglądu karty, w kolejności renderu. */
  cards: [] as Array<Record<string, unknown>>,
  /** Blob ustawień czytania - decyduje, czy `/` to strona z CMS-a. */
  reading: { homepage_mode: "", homepage_page_id: "", homepage_page_slug: "" } as Record<
    string,
    unknown
  >,
  /** Wiersz strony CMS-a pełniącej rolę strony głównej (null = brak). */
  staticHomepage: null as Record<string, unknown> | null,
  /** Propsy KAŻDEGO podglądu wyniku Google, w kolejności renderu. */
  serps: [] as Array<Record<string, unknown>>,
  /** Wiersze `posts` / `pages` dla kokpitu. */
  posts: [] as unknown[],
  pages: [] as unknown[],
  /** Tabele, o które kokpit faktycznie zapytał. */
  tables: [] as string[],
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ tenantId: "t-1", isAdmin: h.isAdmin, isStaff: true }),
  useRequiredTenant: () => "t-1",
}));

// Łańcuch PostgREST. `maybeSingle()` musi oddać POJEDYNCZY wiersz albo null -
// zakładka strony głównej pyta nim o stronę CMS-a pełniącą rolę `/`, a lista
// w tym miejscu (`[]`) jest prawdziwa i jednocześnie zawsze prawdziwa logicznie,
// więc atrapa oddająca tablicę cicho "znajdowałaby" stronę, której nie ma.
vi.mock("@/integrations/supabase/client", () => {
  const chain = (table: string) => {
    const link: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "order", "limit"]) {
      link[method] = () => link;
    }
    link.maybeSingle = () => Promise.resolve({ data: h.staticHomepage, error: null });
    link.then = (resolve: (value: { data: unknown[]; error: null }) => unknown): unknown =>
      resolve({ data: table === "posts" ? h.posts : h.pages, error: null });
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

vi.mock("@/lib/admin/useSettings", () => ({
  // Atrapa MUSI oddawać TĘ SAMĄ referencję między renderami - `useDraft`
  // synchronizuje kopię roboczą efektem z zależnością na źródle, więc nowy
  // obiekt przy każdym renderze zapętla render bez żadnego komunikatu.
  useSettings: (key: string) => ({
    query: { data: key === "reading" ? h.reading : h.seoSettings },
    save: {
      isPending: h.savePending,
      mutate: (payload: Record<string, unknown>) => {
        h.savePayloads.push(payload);
      },
    },
  }),
  useDraft: <T,>(source: T | undefined) => useDraftStub(source),
}));

function useDraftStub<T>(source: T | undefined) {
  const [draft, setDraft] = useState<T | null>(null);
  useEffect(() => {
    if (source && !draft) setDraft(source);
  }, [source, draft]);
  return [draft, setDraft] as const;
}

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return { ...actual, Link: RouterLinkStub };
});

vi.mock("@/components/admin/seo/SeoScorePill", () => ({
  SeoScorePill: ({ score, grade }: { score: number; grade: string }) => (
    <span data-testid="score-pill" data-score={score} data-grade={grade} />
  ),
}));

vi.mock("@/components/admin/ImageSlot", () => ({
  ImageSlot: ({ label, value }: { label: string; value: string }) => (
    <div data-testid="image-slot" data-value={value}>
      {label}
    </div>
  ),
}));

// Podgląd karty zastąpiony markerem zapisującym PROPY: przedmiotem dowodu jest
// to, jaką specyfikację i jakie teksty dostaje każda sieć, a nie markup karty
// (ten ma własny test jednostkowy komponentu).
vi.mock("@/components/admin/seo/SocialCardPreview", () => ({
  SocialCardPreview: (props: Record<string, unknown>) => {
    h.cards.push(props);
    const spec = props.spec as { id: string; aspect: string };
    return <div data-testid="social-card" data-network={spec.id} data-aspect={spec.aspect} />;
  },
}));

// Podgląd wyniku Google zastąpiony markerem zapisującym PROPY: przedmiotem
// dowodu jest to, JAKIE wartości ekran policzył (tytuł, opis, nazwa serwisu),
// a nie sposób, w jaki SerpPreview je rysuje - ten ma własny test.
vi.mock("@/components/admin/seo/SerpPreview", () => ({
  SerpPreview: (props: Record<string, unknown>) => {
    h.serps.push(props);
    return <div data-testid="serp" data-site-name={String(props.siteName ?? "")} />;
  },
}));

// SeoTextField to input + miernik pikselowy; tutaj potrzebujemy wyłącznie
// możliwości wpisania wartości, żeby sprawdzić payload zapisu.
vi.mock("@/components/admin/seo/SeoTextField", () => ({
  SeoTextField: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string | null;
    onChange: (next: string | null) => void;
  }) => (
    <label>
      {label}
      <input
        aria-label={label}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
      />
    </label>
  ),
}));

beforeEach(() => {
  h.seoSettings = { ...DEFAULT_SEO_SETTINGS };
  h.reading = { homepage_mode: "", homepage_page_id: "", homepage_page_slug: "" };
  h.staticHomepage = null;
  h.serps = [];
  h.posts = [];
  h.pages = [];
  h.tables = [];
  h.savePayloads = [];
  h.savePending = false;
  h.isAdmin = true;
  h.cards = [];
});

afterEach(() => cleanup());

describe("/admin/seo - układ zakładek", () => {
  /**
   * Harness montuje DOKŁADNIE jedną trasę pod podanym wzorcem, więc adres
   * startowy musi się w ten wzorzec trafiać - inaczej nie ma dopasowania
   * i nie renderuje się nic. Układ i tak nie czyta własnej ścieżki z trasy,
   * tylko `useRouterState().location.pathname`, więc podanie wzorca równego
   * adresowi jest wiernym odtworzeniem tego, co widzi komponent w produkcji
   * na tej podstronie.
   */
  async function mount(initialEntry: string) {
    return renderRoute({ route: HubLayoutRoute, path: initialEntry, initialEntry });
  }

  it("head() niesie tytuł zakładki", async () => {
    const meta = await routeMeta(HubLayoutRoute);
    expect(meta.some((entry) => typeof entry.title === "string" && entry.title.length > 0)).toBe(
      true,
    );
  });

  it("renderuje WSZYSTKIE pięć zakładek z kluczami i18n", async () => {
    await mount("/admin/seo");
    for (const key of [
      "adminSeoHub.tabDashboard",
      "adminSeoHub.tabHomepage",
      "adminSeoHub.tabSocial",
      "adminSeoHub.tabContent",
      "adminSeoHub.tabSearchConsole",
    ]) {
      expect(screen.getByText(key)).toBeTruthy();
    }
  });

  it("każda zakładka prowadzi pod swój adres", async () => {
    await mount("/admin/seo");
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([
      "/admin/seo",
      "/admin/seo/homepage",
      "/admin/seo/social",
      "/admin/seo/content",
      "/admin/seo/search-console",
    ]);
  });

  it("na `/admin/seo` aktywny jest WYŁĄCZNIE kokpit", async () => {
    await mount("/admin/seo");
    const active = screen
      .getAllByRole("link")
      .filter((a) => (a.getAttribute("class") ?? "").includes("border-brand"));
    expect(active.map((a) => a.getAttribute("href"))).toEqual(["/admin/seo"]);
  });

  it("na podstronie kokpit GAŚNIE - inaczej świeciłby na wszystkich zakładkach", async () => {
    // To jest przedmiot dowodu, nie ozdoba: prefiks "/admin/seo" pasuje do
    // KAŻDEJ z pięciu ścieżek, więc `startsWith` bez wyjątku dla indeksu
    // zapalałby kokpit zawsze.
    await mount("/admin/seo/social");
    const active = screen
      .getAllByRole("link")
      .filter((a) => (a.getAttribute("class") ?? "").includes("border-brand"));
    expect(active.map((a) => a.getAttribute("href"))).toEqual(["/admin/seo/social"]);
  });

  it("renderuje `<Outlet />` - to jest cała naprawa nieosiągalnych dzieci", async () => {
    // Harness montuje TYLKO tę trasę, więc dziecko jest puste; dowodem jest to,
    // że render w ogóle przechodzi i pasek zakładek stoi. Gdyby układ nie
    // wołał `<Outlet />`, żadna zakładka nie dałaby się otworzyć w przeglądarce
    // (`Match` renderuje ALBO `component`, ALBO `<Outlet />`).
    const { container } = await mount("/admin/seo");
    expect(container.querySelector("nav")).toBeTruthy();
    expect(screen.getByText("adminSeoHub.title")).toBeTruthy();
  });
});

describe("/admin/seo/social - karty społecznościowe", () => {
  async function mount() {
    return renderRoute({
      route: SocialRoute,
      path: "/admin/seo/social",
      initialEntry: "/admin/seo/social",
    });
  }

  it("head() niesie tytuł zakładki", async () => {
    const meta = await routeMeta(SocialRoute);
    expect(meta.some((entry) => typeof entry.title === "string" && entry.title.length > 0)).toBe(
      true,
    );
  });

  it("przed odczytem ustawień pokazuje `admin.loading` i NIE renderuje formularza", async () => {
    h.seoSettings = undefined;
    await mount();
    expect(screen.getByText("admin.loading")).toBeTruthy();
    expect(screen.queryByTestId("image-slot")).toBeNull();
  });

  it("renderuje podgląd dla KAŻDEJ sieci z tabeli", async () => {
    await mount();
    const rendered = screen
      .getAllByTestId("social-card")
      .map((n) => n.getAttribute("data-network"));
    expect(rendered).toEqual(SOCIAL_NETWORKS.map((n) => n.id));
  });

  it("wszystkie karty dostają TE SAME teksty - inaczej porównanie kłamie", async () => {
    await mount();
    const titles = new Set(h.cards.map((c) => c.title));
    const descriptions = new Set(h.cards.map((c) => c.description));
    expect(titles.size).toBe(1);
    expect(descriptions.size).toBe(1);
  });

  it("karta X jest SZEROKA przy `summary_large_image`", async () => {
    await mount();
    const x = screen
      .getAllByTestId("social-card")
      .find((n) => n.getAttribute("data-network") === "x");
    expect(x?.getAttribute("data-aspect")).toBe("2 / 1");
  });

  it("karta X robi się KWADRATOWA po przełączeniu na `summary`", async () => {
    // X czyta `twitter:card`. Podgląd, który tego nie respektuje, pokazywałby
    // wariant, który redakcja właśnie wyłączyła - i to jest cała różnica
    // między podglądem a ozdobą.
    h.seoSettings = { ...DEFAULT_SEO_SETTINGS, twitter_card_type: "summary" };
    await mount();
    const x = screen
      .getAllByTestId("social-card")
      .find((n) => n.getAttribute("data-network") === "x");
    expect(x?.getAttribute("data-aspect")).toBe("1 / 1");
  });

  it("puste ustawienie obrazka spada na wbudowaną kartę marki, nie na pustkę", async () => {
    await mount();
    for (const card of h.cards) {
      expect(String(card.imageUrl)).toContain("og-default.jpg");
    }
  });

  it("pusty `alt` spada na tekst zastępczy z nazwą marki", async () => {
    await mount();
    expect(String(h.cards[0]?.imageAlt)).toContain("New European Strategies");
  });

  it("zapis wysyła kopię roboczą z NAŁOŻONĄ zmianą pola", async () => {
    await mount();
    const alt = screen.getAllByRole("textbox")[0];
    fireEvent.change(alt, { target: { value: "Karta marki" } });
    fireEvent.click(screen.getByText("admin.saveSettings"));
    expect(h.savePayloads).toHaveLength(1);
    expect(h.savePayloads[0]).toMatchObject({ default_og_image_alt: "Karta marki" });
  });

  it("BEZ roli `admin` zapis jest wyłączony, a klik nic nie wysyła", async () => {
    // RLS `site_settings` puszcza zapis wyłącznie adminowi, a layout `/admin`
    // wpuszcza cały personel. Aktywny przycisk kłamałby redaktorowi.
    h.isAdmin = false;
    await mount();
    expect(screen.getByText("adminSeoHub.readOnlyNotice")).toBeTruthy();
    const button = screen.getByText("admin.saveSettings") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(h.savePayloads).toEqual([]);
  });

  it("z rolą `admin` ostrzeżenie o trybie do odczytu NIE pojawia się", async () => {
    await mount();
    expect(screen.queryByText("adminSeoHub.readOnlyNotice")).toBeNull();
  });
});

describe("/admin/seo/homepage - strona główna", () => {
  async function mount() {
    return renderRoute({
      route: HomepageRoute,
      path: "/admin/seo/homepage",
      initialEntry: "/admin/seo/homepage",
    });
  }

  it("head() niesie tytuł zakładki", async () => {
    const meta = await routeMeta(HomepageRoute);
    expect(meta.some((entry) => typeof entry.title === "string" && entry.title.length > 0)).toBe(
      true,
    );
  });

  it("przed odczytem ustawień pokazuje `admin.loading` i NIE renderuje formularza", async () => {
    h.seoSettings = undefined;
    await mount();
    expect(screen.getByText("admin.loading")).toBeTruthy();
    expect(screen.queryByTestId("serp")).toBeNull();
  });

  it("rysuje podgląd dla OBU języków", async () => {
    await mount();
    expect(screen.getAllByTestId("serp")).toHaveLength(2);
  });

  it("puste pola spadają na wbudowane teksty marki - tak jak publiczny <head>", async () => {
    await mount();
    expect(h.serps.map((s) => s.title)).toEqual([SITE_DEFAULT_TITLE.pl, SITE_DEFAULT_TITLE.en]);
  });

  it("podgląd pokazuje EDYTOWALNĄ nazwę serwisu, nie stałą marki", async () => {
    // To jest cały powód, dla którego pole nazwy w ogóle powstało: linia nazwy
    // nad niebieskim linkiem decyduje, czy Google zdejmie z tytułu prefiks
    // marki. Podgląd rysujący tu stałą ukrywałby skutek tej edycji.
    h.seoSettings = { ...DEFAULT_SEO_SETTINGS, site_name: "Nowe Strategie" };
    await mount();
    for (const node of screen.getAllByTestId("serp")) {
      expect(node.getAttribute("data-site-name")).toBe("Nowe Strategie");
    }
  });

  it("pusta nazwa spada na stałą marki", async () => {
    await mount();
    for (const node of screen.getAllByTestId("serp")) {
      expect(node.getAttribute("data-site-name")).toBe(SITE_NAME);
    }
  });

  it("DOMYŚLNE tytuły marki zapalają `titleBrandStripped` w OBU językach", async () => {
    // Dokładnie objaw z wyszukiwarki, od którego zaczęła się ta zakładka:
    // "New European Strategies - European Security Analysis" wraca w SERP-ie
    // jako "European Security Analysis". Oba wbudowane tytuły zaczynają się od
    // nazwy marki i separatora, więc ekran ma to powiedzieć wprost - dwa razy,
    // po jednym na język.
    await mount();
    const stripped = screen.getAllByText(
      `adminSeoHub.finding.titleBrandStripped(brand=${SITE_NAME})`,
    );
    expect(stripped).toHaveLength(2);
  });

  it("tytuł z marką NA KOŃCU gasi to ostrzeżenie", async () => {
    h.seoSettings = {
      ...DEFAULT_SEO_SETTINGS,
      site_title_pl: `Bezpieczeństwo Europy - ${SITE_NAME}`,
      site_title_en: `European security - ${SITE_NAME}`,
    };
    await mount();
    expect(
      screen.queryByText(`adminSeoHub.finding.titleBrandStripped(brand=${SITE_NAME})`),
    ).toBeNull();
  });

  it("zapis wysyła kopię roboczą z NAŁOŻONĄ zmianą nazwy serwisu", async () => {
    await mount();
    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "Nowa Nazwa" } });
    fireEvent.click(screen.getByText("admin.saveSettings"));
    expect(h.savePayloads).toHaveLength(1);
    expect(h.savePayloads[0]).toMatchObject({ site_name: "Nowa Nazwa" });
  });

  it("BEZ statycznej strony głównej NIE straszy ostrzeżeniem o nadpisaniu", async () => {
    await mount();
    expect(screen.queryByText("adminSeoHub.staticHomepageNotice")).toBeNull();
  });

  it("strona CMS-a z własnym tytułem SEO POKAZUJE ostrzeżenie i link do edytora", async () => {
    // Bez tego redakcja poprawia tytuł tutaj, nie widzi zmiany w Google
    // i słusznie uznaje, że panel jest zepsuty - bo wygrywa nadpisanie
    // ze strony, o której ten ekran nic nie mówił.
    h.reading = { homepage_mode: "static_page", homepage_page_id: "p-1", homepage_page_slug: "" };
    h.staticHomepage = {
      id: "p-1",
      slug: "strona-glowna",
      seo_title_pl: "Własny tytuł strony",
      seo_title_en: null,
    };
    const { findByText } = await mount();
    await findByText("adminSeoHub.staticHomepageNotice");
    const link = screen
      .getAllByRole("link")
      .find((a) => a.textContent === "adminSeoHub.staticHomepageOpen");
    expect(link?.getAttribute("href")).toBe("/admin/pages/strona-glowna");
  });

  it("ostrzeżenie pojawia się TYLKO przy języku, który faktycznie jest nadpisany", async () => {
    h.reading = { homepage_mode: "static_page", homepage_page_id: "p-1", homepage_page_slug: "" };
    h.staticHomepage = {
      id: "p-1",
      slug: "strona-glowna",
      seo_title_pl: "Własny tytuł strony",
      seo_title_en: null,
    };
    const { findAllByText } = await mount();
    expect(await findAllByText("adminSeoHub.staticHomepageNotice")).toHaveLength(1);
  });

  it("BEZ roli `admin` zapis jest wyłączony, a klik nic nie wysyła", async () => {
    h.isAdmin = false;
    await mount();
    expect(screen.getByText("adminSeoHub.readOnlyNotice")).toBeTruthy();
    const button = screen.getByText("admin.saveSettings") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(h.savePayloads).toEqual([]);
  });
});

describe("/admin/seo/ - kokpit", () => {
  /** Wiersz treści w kształcie, jakiego wymaga `seoContentStatus`. */
  function contentRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "c-1",
      slug: "wpis",
      status: "published",
      title_pl: "Wpis",
      title_en: "Post",
      excerpt_pl: "Opis PL",
      excerpt_en: "Opis EN",
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

  async function mount() {
    return renderRoute({ route: DashboardRoute, path: "/admin/seo", initialEntry: "/admin/seo" });
  }

  it("head() niesie tytuł zakładki", async () => {
    const meta = await routeMeta(DashboardRoute);
    expect(meta.some((entry) => typeof entry.title === "string" && entry.title.length > 0)).toBe(
      true,
    );
  });

  it("przed odczytem ustawień pokazuje `admin.loading` i NIE liczy wyniku", async () => {
    h.seoSettings = undefined;
    await mount();
    expect(screen.getByText("admin.loading")).toBeTruthy();
    expect(screen.queryByTestId("score-pill")).toBeNull();
  });

  it("czyta OBIE tabele treści", async () => {
    const { findByTestId } = await mount();
    await findByTestId("score-pill");
    expect(h.tables).toContain("posts");
    expect(h.tables).toContain("pages");
  });

  it("problem WSPÓLNY dla obu języków liczy się RAZ, nie dwa razy", async () => {
    // Karta społecznościowa i profile `sameAs` są jednym ustawieniem serwisu,
    // więc audyt obu języków zgłasza je dwukrotnie. Kokpit ma je scalić -
    // inaczej licznik pokazuje podwojoną liczbę problemów i nie zgadza się
    // z listą na zakładce strony głównej.
    await mount();
    expect(screen.getAllByText("adminSeoHub.finding.sameAsMissing")).toHaveLength(1);
    expect(screen.getAllByText("adminSeoHub.finding.ogImageBuiltIn")).toHaveLength(1);
  });

  it("na domyślnych ustawieniach marki wynik NIE jest pełny", async () => {
    // Wbudowane tytuły zaczynają się od nazwy marki, karta jest wbudowana,
    // a `sameAs` puste - kokpit nie ma prawa pokazać tu zieleni.
    await mount();
    const pill = screen.getByTestId("score-pill");
    expect(Number(pill.getAttribute("data-score"))).toBeLessThan(100);
    expect(pill.getAttribute("data-grade")).toBeTruthy();
  });

  it("komplet poprawnych ustawień daje wynik 100 i komunikat `allGood`", async () => {
    h.seoSettings = {
      ...DEFAULT_SEO_SETTINGS,
      site_name: SITE_NAME,
      site_title_pl: `Bezpieczeństwo Europy - ${SITE_NAME}`,
      site_title_en: `European security - ${SITE_NAME}`,
      site_description_pl:
        "Niezależny think-tank o bezpieczeństwie Europy i geopolityce: analizy, raporty, wywiady i policy papers na temat gry mocarstw.",
      site_description_en:
        "An independent think-tank on European security and geopolitics: analyses, reports, interviews and policy papers on great-power rivalry.",
      default_og_image_url: "https://cdn.example/og.jpg",
      default_og_image_alt: "Karta marki",
      organization_same_as: ["https://www.linkedin.com/company/nes"],
      publisher_logo_url: "https://cdn.example/logo.png",
      twitter_site: "@nes",
    };
    await mount();
    expect(screen.getByTestId("score-pill").getAttribute("data-score")).toBe("100");
    expect(screen.getByText("adminSeoHub.allGood")).toBeTruthy();
  });

  it("kafelki treści liczą się z TEGO SAMEGO modułu, co tabela", async () => {
    // Jedna treść kompletna, jedna bez opisu EN i bez własnej karty.
    h.pages = [contentRow({ id: "p-1", slug: "strona" })];
    h.posts = [contentRow({ id: "w-1", slug: "wpis-2", excerpt_en: null, cover_image_url: null })];
    const { findByText } = await mount();
    await findByText("adminSeoHub.contentSummary(done=1,total=2)");
  });

  it("pliki generowane otwierają się zwykłym <a>, a ekrany panelu przez router", async () => {
    // Pomylenie tych dwóch rzeczy jest realnym błędem: /robots.txt nie jest
    // trasą routera, więc <Link> pokazałby stronę 404 zamiast pliku.
    await mount();
    const links = screen.getAllByRole("link");
    const byHref = (href: string) => links.find((a) => a.getAttribute("href") === href);
    expect(byHref("/robots.txt")?.getAttribute("target")).toBe("_blank");
    expect(byHref("/sitemap.xml")?.getAttribute("target")).toBe("_blank");
    expect(byHref("/llms.txt")?.getAttribute("target")).toBe("_blank");
    expect(byHref("/admin/settings/seo")?.getAttribute("target")).toBeNull();
    expect(byHref("/admin/redirects")?.getAttribute("target")).toBeNull();
  });

  it("prowadzi do zakładek, które naprawiają zgłoszone problemy", async () => {
    await mount();
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(
      expect.arrayContaining(["/admin/seo/homepage", "/admin/seo/social", "/admin/seo/content"]),
    );
  });

  it("NIE oferuje zapisu - to ekran tylko do czytania", async () => {
    await mount();
    expect(screen.queryByText("admin.saveSettings")).toBeNull();
    expect(h.savePayloads).toEqual([]);
  });
});
