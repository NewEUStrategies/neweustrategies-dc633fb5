// /organization/$slug - JĘZYK nagłówka i ekranu błędu oraz trasa w RUNTIME
// (loader + komponent zamontowane w routerze pamięciowym).
//
// UZUPEŁNIA `organizationRoute.test.tsx`, który przypina kanonikalizację
// i dane strukturalne w domyślnym języku. Tu stoi to, czego tamten nie widzi:
//
//   1. OBA JĘZYKI `head()`. Tytuł, sufiks strony listy, opis zastępczy
//      i etykieta okruszka są składane w `head()` warunkiem po języku - i MUSZĄ
//      mówić tym samym zdaniem co nakładka `i18n-organizations` (klucze `seo*`,
//      `pageSuffix`, `breadcrumb`). `head()` jedzie w shellu trasy, czyli
//      w chunku startowym KAŻDEJ strony, więc nie importuje tej nakładki (cały
//      słownik profilu trafiłby do entry) - test pilnuje, żeby dwie kopie tego
//      samego zdania się nie rozjechały.
//   2. EKRAN BŁĘDU mówi zdaniem nakładki (`organization.loadFailed`), tym samym
//      co notka degradacji tej trasy. Wcześniej miał własną, trzecią wersję
//      angielską („Failed to load…" obok „Couldn't load…").
//   3. LOADER: degradacja (blip backendu) NIE jest 404, brak organizacji JEST
//      404, a nagłówek cache idzie przez `resilientCacheControl` także wtedy,
//      gdy padła tylko lista publikacji.
//   4. KOMPONENT: przy degradacji notka zamiast „nie znaleziono", nagłówki sekcji
//      z nakładki, paginacja przez router z niejawnymi wartościami domyślnymi.
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  requestUrl: "",
  /** Język strony widziany przez loader (`currentLang()`). */
  lang: "pl" as "pl" | "en",
  org: null as null | ((slug: string, lang: string) => Promise<unknown>),
  archive: null as null | ((slug: string, params: Record<string, unknown>) => Promise<unknown>),
  cacheHeaders: [] as string[],
  breadcrumbs: [] as unknown[],
  profile: [] as { lang: string; total: number; slug: string }[],
  people: [] as { companyNames: readonly string[]; heading: string; verifiedLabel: string }[],
  posts: [] as {
    page: number;
    totalPages: number;
    heading: string;
    emptyText: string;
    isPending: boolean;
    onPageChange: (page: number) => void;
    hrefFor: (page: number) => string;
    count: number;
  }[],
}));

vi.mock("@/lib/seo/request", () => ({ getRequestUrl: () => h.requestUrl }));

// `currentLang` to `createIsomorphicFn` - bez kompilatora Start w teście biegnie
// gałąź SERWEROWA (bez żądania = język domyślny), więc język loadera podajemy
// wprost.
vi.mock("@/lib/i18n/localeRuntime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/i18n/localeRuntime")>()),
  currentLang: () => h.lang,
}));

vi.mock("@/lib/http/responseHeaders", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/http/responseHeaders")>()),
  setCacheControlHeader: (value: string) => {
    h.cacheHeaders.push(value);
  },
}));

// Zapytania zostają w KSZTAŁCIE produkcyjnym (ten sam klucz cache), podmieniona
// jest wyłącznie funkcja pobierająca - sterowana z testu.
vi.mock("@/lib/queries/organization", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queries/organization")>()),
  organizationQueryOptions: (slug: string, lang: "pl" | "en") => ({
    queryKey: ["public", "organization", slug, lang] as const,
    queryFn: () => (h.org ? h.org(slug, lang) : Promise.resolve(null)),
  }),
}));

vi.mock("@/lib/queries/archives", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queries/archives")>()),
  taxonomyArchiveQueryOptions: (_kind: string, slug: string, params: Record<string, unknown>) => ({
    queryKey: ["public", "archive", "category", slug, params] as const,
    queryFn: () => (h.archive ? h.archive(slug, params) : Promise.resolve(null)),
  }),
}));

// Wnętrza profilu mają własne testy (`components/organizations/__tests__`).
// Tutaj atrapy zapisują to, co TRASA im podała.
vi.mock("@/components/organizations/OrganizationProfile", () => ({
  OrganizationProfile: ({
    data,
    lang,
    total,
    children,
  }: {
    data: { term: { slug: string } };
    lang: string;
    total: number;
    children?: ReactNode;
  }) => {
    h.profile.push({ lang, total, slug: data.term.slug });
    return <article data-testid="profil">{children}</article>;
  },
}));

vi.mock("@/components/organizations/OrganizationPeople", () => ({
  OrganizationPeople: (props: {
    companyNames: readonly string[];
    heading: string;
    verifiedLabel: string;
  }) => {
    h.people.push(props);
    return <section data-testid="osoby">{props.heading}</section>;
  },
}));

vi.mock("@/components/organizations/OrganizationPosts", () => ({
  OrganizationPosts: (props: {
    posts: readonly unknown[];
    page: number;
    totalPages: number;
    heading: string;
    emptyText: string;
    isPending: boolean;
    onPageChange: (page: number) => void;
    hrefFor: (page: number) => string;
  }) => {
    h.posts.push({ ...props, count: props.posts.length });
    return <section data-testid="publikacje">{props.heading}</section>;
  },
}));

vi.mock("@/components/Breadcrumbs", () => ({
  Breadcrumbs: ({ items }: { items: unknown[] }) => {
    h.breadcrumbs.push(items);
    return <nav data-testid="okruszki" />;
  },
}));

vi.mock("@/components/molecules/PublicNotFound", () => ({
  PublicNotFound: () => <div data-testid="nie-znaleziono" />,
}));

vi.mock("@/components/molecules/RouteErrorFallback", () => ({
  RouteErrorFallback: ({ title }: { title?: string }) => <h1 data-testid="ekran-bledu">{title}</h1>,
}));

vi.mock("@/components/archive/ArchiveSkeleton", () => ({
  ArchiveSkeleton: () => <div data-testid="szkielet" />,
}));

// Prawdziwa nakładka, tylko `ensureI18n` podglądane: w teście słownik i tak
// rejestruje import, więc o tym, czy WYDZIELONY chunk (ekran błędu, komponent)
// sam zapewnia sobie słownik, mówi wyłącznie wywołanie.
vi.mock("@/lib/i18n-organizations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/i18n-organizations")>();
  return { ...actual, ensureI18n: vi.fn(actual.ensureI18n) };
});

const { default: i18n } = await import("@/lib/i18n");
const { contentCacheControl } = await import("@/lib/http/cachePolicy");
const { resilientCacheControl } = await import("@/lib/ssr/resilientLoad");
const { renderRoute } = await import("@/test/routeHarness");
const { Route } = await import("@/routes/organization.$slug");
const { ensureI18n: ensureOrganizationsI18n } = await import("@/lib/i18n-organizations");

type HeadResult = {
  meta?: Record<string, unknown>[];
  scripts?: { children?: string }[];
};

function head(ctx: Record<string, unknown>): HeadResult {
  const fn: unknown = Route.options.head;
  if (typeof fn !== "function") throw new Error("test: trasa nie ma `head()`");
  return fn(ctx) as HeadResult;
}

function title(result: HeadResult): string {
  return String(result.meta?.find((m) => "title" in m)?.title ?? "");
}

function description(result: HeadResult): string {
  return String(result.meta?.find((m) => m.name === "description")?.content ?? "");
}

function crumbNames(result: HeadResult): string[] {
  for (const script of result.scripts ?? []) {
    const node = JSON.parse(String(script.children ?? "{}")) as Record<string, unknown>;
    if (node["@type"] === "BreadcrumbList") {
      const items = node.itemListElement as { name: string }[];
      return items.map((item) => item.name);
    }
  }
  return [];
}

const TERM = {
  id: "org-1",
  slug: "nato",
  name_pl: "NATO",
  name_en: "NATO",
  description_pl: null,
  description_en: null,
  logo_url: null,
  color: null,
};

const ORG = { term: TERM, brand: { name: "NATO", logoUrl: null, website: null, branch: null } };

function orgHead(page: number, lang: "pl" | "en"): HeadResult {
  h.requestUrl = lang === "en" ? "/en/organization/nato" : "/organization/nato";
  return head({
    params: { slug: "nato" },
    loaderData: { org: ORG, degraded: false, total: 4, page, lang },
  });
}

/** Zdanie nakładki w zadanym języku - jedyne źródło prawdy o kopii profilu. */
function overlay(lang: "pl" | "en", key: string, values?: Record<string, unknown>): string {
  return i18n.getFixedT(lang)(`organization.${key}`, values);
}

beforeEach(() => {
  h.requestUrl = "";
  h.lang = "pl";
  h.org = null;
  h.archive = null;
  h.cacheHeaders.length = 0;
  h.breadcrumbs.length = 0;
  h.profile.length = 0;
  h.people.length = 0;
  h.posts.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("head() mówi językiem adresu", () => {
  it("PL: tytuł, sufiks strony listy, opis zastępczy i okruszek", () => {
    const first = orgHead(1, "pl");
    expect(title(first)).toBe("NATO - organizacja");
    expect(description(first)).toBe("NATO - profil organizacji w New European Strategies.");
    expect(crumbNames(first).slice(1)).toEqual(["Organizacje", "NATO"]);
    expect(title(orgHead(2, "pl"))).toBe("NATO - organizacja (strona 2)");
  });

  it("EN: tytuł, sufiks strony listy, opis zastępczy i okruszek", () => {
    const first = orgHead(1, "en");
    expect(title(first)).toBe("NATO - organization");
    expect(description(first)).toBe("NATO - organization profile at New European Strategies.");
    expect(crumbNames(first).slice(1)).toEqual(["Organizations", "NATO"]);
    expect(title(orgHead(3, "en"))).toBe("NATO - organization (page 3)");
  });

  it("bez danych loadera nazwa zastępcza też idzie za językiem adresu", () => {
    h.requestUrl = "/en/organization/nie-ma";
    expect(title(head({ params: { slug: "nie-ma" }, loaderData: undefined }))).toBe(
      "Organization - organization",
    );
    h.requestUrl = "/organization/nie-ma";
    expect(title(head({ params: { slug: "nie-ma" }, loaderData: undefined }))).toBe(
      "Organizacja - organizacja",
    );
  });

  it.each(["pl", "en"] as const)(
    "%s: kopia w head() jest TYM SAMYM zdaniem co klucze nakładki (seo*, pageSuffix, breadcrumb)",
    (lang) => {
      const second = orgHead(2, lang);
      expect(title(second)).toBe(
        `NATO - ${overlay(lang, "seoTitleSuffix")} (${overlay(lang, "pageSuffix", { page: 2 })})`,
      );
      expect(description(second)).toBe(overlay(lang, "seoDescriptionFallback", { name: "NATO" }));
      expect(crumbNames(second)[1]).toBe(overlay(lang, "breadcrumb"));
    },
  );
});

describe("ekran błędu trasy", () => {
  function renderError(): void {
    const Comp: unknown = Route.options.errorComponent;
    if (typeof Comp !== "function") throw new Error("test: trasa nie ma komponentu błędu");
    const ErrorScreen = Comp as (props: { error: Error; reset: () => void }) => ReactNode;
    render(<ErrorScreen error={new Error("boom")} reset={() => {}} />);
  }

  it.each(["pl", "en"] as const)(
    "%s: nagłówek to `organization.loadFailed` - to samo zdanie co notka degradacji",
    (lang) => {
      h.requestUrl = lang === "en" ? "/en/organization/nato" : "/organization/nato";
      renderError();
      expect(screen.getByTestId("ekran-bledu").textContent).toBe(overlay(lang, "loadFailed"));
    },
  );

  it("ekran błędu sam rejestruje słownik profilu - ma własny chunk, bez komponentu trasy", () => {
    vi.mocked(ensureOrganizationsI18n).mockClear();
    renderError();
    expect(ensureOrganizationsI18n).toHaveBeenCalled();
  });

  it("EN nie wraca do osobnej, trzeciej wersji zdania", () => {
    h.requestUrl = "/en/organization/nato";
    renderError();
    expect(screen.getByTestId("ekran-bledu").textContent).toBe(
      "Couldn't load the organization profile",
    );
  });
});

describe("loader i komponent w routerze", () => {
  async function mount(initialEntry = "/organization/nato") {
    return renderRoute({ route: Route, path: "/organization/$slug", initialEntry });
  }

  it("organizacja z publikacjami: profil, sekcje z nakładki i czysty nagłówek cache", async () => {
    h.org = async () => ORG;
    h.archive = async () => ({ posts: [{ id: "p1" }, { id: "p2" }], total: 30 });
    vi.mocked(ensureOrganizationsI18n).mockClear();

    await mount();

    expect(await screen.findByTestId("profil")).toBeTruthy();
    // Komponent trasy jedzie w osobnym chunku - słownik zapewnia sobie sam.
    expect(ensureOrganizationsI18n).toHaveBeenCalled();
    expect(h.cacheHeaders).toEqual([resilientCacheControl(false)]);
    expect(h.profile.at(-1)).toEqual({ lang: "pl", total: 30, slug: "nato" });
    expect(h.breadcrumbs.at(-1)).toEqual([{ label: "NATO" }]);
    expect(h.people.at(-1)).toEqual({
      companyNames: expect.arrayContaining(["NATO"]),
      heading: overlay("pl", "peopleHeading"),
      verifiedLabel: overlay("pl", "verified"),
    });
    const posts = h.posts.at(-1);
    expect(posts).toMatchObject({
      page: 1,
      // 30 publikacji po 12 na stronę.
      totalPages: 3,
      count: 2,
      heading: overlay("pl", "postsHeading"),
      emptyText: overlay("pl", "postsEmpty"),
      isPending: false,
    });
  });

  it("paginacja: adres strony pierwszej bez `?page`, kolejnej z numerem i porządkiem", async () => {
    h.org = async () => ORG;
    h.archive = async () => ({ posts: [], total: 30 });

    const view = await mount("/organization/nato?sort=oldest");
    await screen.findByTestId("profil");
    const posts = h.posts.at(-1);
    if (!posts) throw new Error("test: lista publikacji się nie wyrenderowała");

    expect(posts.hrefFor(1)).toBe("/organization/nato?sort=oldest");
    expect(posts.hrefFor(2)).toBe("/organization/nato?page=2&sort=oldest");

    act(() => posts.onPageChange(3));
    await waitFor(() => expect(view.search()).toEqual({ page: 3, sort: "oldest" }));
    expect(view.currentPath()).toBe("/organization/nato");
  });

  it("domyślny porządek zostaje NIEJAWNY także przy nawigacji z komponentu", async () => {
    h.org = async () => ORG;
    h.archive = async () => ({ posts: [], total: 30 });

    const view = await mount("/organization/nato?page=2");
    await screen.findByTestId("profil");
    const posts = h.posts.at(-1);
    if (!posts) throw new Error("test: lista publikacji się nie wyrenderowała");

    expect(posts.hrefFor(1)).toBe("/organization/nato");
    act(() => posts.onPageChange(1));
    await waitFor(() => expect(view.search()).toEqual({}));
  });

  it("padnięta lista publikacji nie wywraca profilu, ale render nie trafia do cache", async () => {
    h.org = async () => ORG;
    h.archive = async () => {
      throw new Error("archiwum leży");
    };

    await mount();

    expect(await screen.findByTestId("profil")).toBeTruthy();
    expect(h.cacheHeaders).toEqual([resilientCacheControl(true)]);
    expect(h.profile.at(-1)?.total).toBe(0);
  });

  it("blip backendu tożsamości: notka degradacji z nakładki, NIE „nie znaleziono”", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    h.org = async () => {
      throw new Error("backend leży");
    };

    await mount();

    expect(await screen.findByText(overlay("pl", "loadFailed"))).toBeTruthy();
    expect(screen.queryByTestId("nie-znaleziono")).toBeNull();
    expect(screen.queryByTestId("profil")).toBeNull();
    expect(h.cacheHeaders).toEqual([resilientCacheControl(true)]);
  });

  it("organizacji nie ma: 404 z nagłówkiem `no-store`", async () => {
    h.org = async () => null;

    await mount("/organization/nie-ma");

    expect(await screen.findByTestId("nie-znaleziono")).toBeTruthy();
    // Harness może powtórzyć loader, który rzucił `notFound` (match bez danych
    // nie jest „świeży") - liczy się, że KAŻDY bieg ustawił `no-store`.
    expect(h.cacheHeaders.length).toBeGreaterThan(0);
    expect(new Set(h.cacheHeaders)).toEqual(new Set([contentCacheControl({ preview: true })]));
  });

  it("organizacja znika przy odświeżeniu otwartej strony: ekran 404, nie wywrotka", async () => {
    // Loader widział organizację, ale zapytanie komponentu (`useSuspenseQuery`)
    // odświeża się po czasie świeżości - wpis mógł w międzyczasie zniknąć.
    h.org = async () => ORG;
    h.archive = async () => ({ posts: [], total: 0 });
    const view = await mount();
    await screen.findByTestId("profil");

    h.org = async () => null;
    await act(() => view.queryClient.refetchQueries({ queryKey: ["public", "organization"] }));

    expect(await screen.findByTestId("nie-znaleziono")).toBeTruthy();
    expect(screen.queryByTestId("profil")).toBeNull();
  });

  it("szkielet ładowania to szkielet archiwum, nie pusty ekran", () => {
    const Pending: unknown = Route.options.pendingComponent;
    if (typeof Pending !== "function") throw new Error("test: trasa nie ma szkieletu ładowania");
    const Skeleton = Pending as () => ReactNode;
    render(<Skeleton />);
    expect(screen.getByTestId("szkielet")).toBeTruthy();
  });

  it("loader pyta o tożsamość w języku strony", async () => {
    h.lang = "en";
    const asked: string[] = [];
    h.org = async (_slug, lang) => {
      asked.push(lang);
      return ORG;
    };
    h.archive = async () => ({ posts: [], total: 0 });

    await mount();

    await screen.findByTestId("profil");
    expect(asked).toEqual(["en"]);
    expect(h.profile.at(-1)?.lang).toBe("en");
  });
});
