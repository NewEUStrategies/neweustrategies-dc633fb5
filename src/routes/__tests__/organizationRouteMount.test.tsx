// Trasa `/organization/$slug` ZAMONTOWANA: loader, polityka cache, komponent.
//
// CO TEN PLIK DOWODZI (siostrzany `organizationRoute.test.tsx` sprawdza
// `validateSearch` i `head()` jako funkcje; loadera i komponentu nie wykonywał
// żaden test - 48% linii pliku trasy):
//
//  1. LISTA PUBLIKACJI JEST WTÓRNA. Jej awaria nie wywraca profilu, ale zdejmuje
//     wspólny cache (`no-store`), bo render bez dorobku jest NIEPEŁNY.
//  2. FIRMA Z KARTOTEKI (`org-<uuid>`) NIE MA PIVOTU PUBLIKACJI. Do 2026-10-02
//     loader i tak pytał archiwum o kategorię `org-<uuid>`, dostawał `null`
//     i czytał to jak awarię: każdy profil firmy szedł z `no-store`, płacił
//     zbędny odczyt na ścieżce TTFB i pokazywał „nie ma JESZCZE publikacji".
//  3. „NIE MA" I „NIE WIEM" TO DWA STANY. Brak organizacji to 404 bez cache;
//     awaria tożsamości to komunikat degradacji, nigdy fałszywe 404.
//  4. DEGRADACJA LECZY SIĘ SAMA. Flaga z loadera jest niezmienna przez życie
//     dopasowania; bez `useDegradedUntilHealed` profil zostawał pod
//     komunikatem awarii (bez przycisku ponowienia) mimo zdrowego backendu.
//  5. OKRUSZKI = `BreadcrumbList`. Widoczna nawigacja niesie ten sam poziom
//     „Organizacje", który `head()` deklaruje w danych strukturalnych, i ten
//     sam tekst (nakładka czyta go z `ORGANIZATION_PAGE_COPY`).
//  6. EKRAN BŁĘDU mówi językiem strony ze słownika nakładki, nie z warunku.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE: renderu sekcji osób i publikacji (atrapy-markery,
// mają `src/components/organizations/__tests__`), warstwy zapytań
// (`lib/queries/__tests__/organization.test.ts` - tu biegnie PRAWDZIWA, atrapą
// jest wyłącznie klient Supabase) ani samego archiwum (`archives.ts`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { fail, ok, type SupabaseFromStub } from "@/test/supabaseChain";
import type { SupabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({
  lang: "pl" as "pl" | "en",
  requestUrl: "",
  from: null as SupabaseFromStub | null,
  rpc: null as SupabaseRpcStub | null,
  /** Nagłówki `Cache-Control` ustawione przez loader, w kolejności. */
  cacheControl: [] as string[],
  /** Wynik archiwum; `"fail"` = odczyt listy pada. */
  archive: null as { posts: { id: string }[]; total: number } | null | "fail",
  archiveCalls: [] as { slug: string; page: number | undefined; sort: string | undefined }[],
  postsProps: null as null | {
    posts: readonly unknown[];
    page: number;
    totalPages: number;
    isPending: boolean;
    hrefFor: (page: number) => string;
    onPageChange: (page: number) => void;
  },
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabase/chain");
  const { supabaseRpcStub } = await import("@/test/supabase/rpc");
  const from = supabaseFromStub();
  const rpc = supabaseRpcStub();
  h.from = from;
  h.rpc = rpc;
  return { supabase: { from: from.from, rpc: rpc.rpc } };
});

vi.mock("@/lib/http/responseHeaders", () => ({
  setCacheControlHeader: (value: string) => void h.cacheControl.push(value),
  appendLinkHeader: () => {},
  readRouteCacheDirective: () => null,
}));

vi.mock("@/lib/seo/request", () => ({
  getRequestUrl: () => h.requestUrl,
  getOrigin: () => "https://nes.example.org",
}));

vi.mock("@/lib/i18n/localeRuntime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/i18n/localeRuntime")>()),
  currentLang: () => h.lang,
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  // Okruszki linkują do `/` i `/search` - tras spoza drzewa testowego.
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

vi.mock("@/lib/queries/archives", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries/archives")>();
  const { queryOptions } = await import("@tanstack/react-query");
  return {
    ...actual,
    taxonomyArchiveQueryOptions: (
      kind: string,
      slug: string,
      params: { page?: number; pageSize?: number; sort?: string } = {},
    ) =>
      queryOptions({
        queryKey: ["public", "archive", kind, slug, params] as const,
        staleTime: 60_000,
        queryFn: async () => {
          h.archiveCalls.push({ slug, page: params.page, sort: params.sort });
          if (h.archive === "fail") throw new Error("test: archiwum niedostepne");
          return h.archive;
        },
      }),
  };
});

vi.mock("@/components/organizations/OrganizationPeople", () => ({
  OrganizationPeople: (props: { companyNames: string[]; heading: string }) => (
    <section data-testid="osoby" data-names={props.companyNames.join("|")}>
      {props.heading}
    </section>
  ),
}));

vi.mock("@/components/organizations/OrganizationPosts", () => ({
  OrganizationPosts: (props: NonNullable<typeof h.postsProps> & { emptyText: string }) => {
    h.postsProps = props;
    return (
      <section data-testid="publikacje" data-count={String(props.posts.length)}>
        {props.emptyText}
      </section>
    );
  },
}));

vi.mock("@/components/molecules/PublicNotFound", () => ({
  PublicNotFound: () => <p data-testid="nie-znaleziono" />,
}));

vi.mock("@/components/molecules/RouteErrorFallback", () => ({
  RouteErrorFallback: (props: { title?: string }) => <p data-testid="ekran-bledu">{props.title}</p>,
}));

// `react-i18next` NIE JEST atrapowany: fabryka z prawdziwym `t` sięga po
// `@/lib/i18n`, który importuje właśnie atrapowany pakiet (zakleszczenie -
// ostrzeżenie z nagłówka `@/test/i18nReal`). Język przełączamy na PRAWDZIWEJ
// instancji, więc asercje czytają napis ze słownika, a klucz bez rejestracji
// nakładki oblałby test zamiast przejść na samym kluczu.
const i18n = (await import("@/lib/i18n")).default;
await import("@/test/i18nReal");
const { renderRoute } = await import("@/test/routeHarness");
const { Route: OrganizationRoute } = await import("@/routes/organization.$slug");
const { ORGANIZATION_PAGE_COPY } = await import("@/lib/queries/organizationTerm");
const { cacheControlHeader, contentCacheControl } = await import("@/lib/http/cachePolicy");
const { realT } = await import("@/test/i18nReal");

const CLEAN = contentCacheControl();
const DEGRADED = cacheControlHeader({ cacheable: false });
const NOT_FOUND = contentCacheControl({ preview: true });

const COMPANY_ID = "6f1c2b9e-1d2a-4c3b-8e7f-0a1b2c3d4e5f";
const COMPANY_SLUG = `org-${COMPANY_ID}`;

const TERM_ROW = {
  id: "t-nato",
  slug: "nato",
  name_pl: "Sojusz Północnoatlantycki",
  name_en: "North Atlantic Alliance",
  description_pl: "Opis sojuszu.",
  description_en: null,
  logo_url: null,
  color: null,
};

function db(): SupabaseFromStub {
  if (!h.from) throw new Error("test: atrapa łańcucha Supabase nie została podpięta");
  return h.from;
}

function rpc(): SupabaseRpcStub {
  if (!h.rpc) throw new Error("test: atrapa RPC Supabase nie została podpięta");
  return h.rpc;
}

function posts(count: number): { id: string }[] {
  return Array.from({ length: count }, (_, i) => ({ id: `post-${i + 1}` }));
}

async function mount(entry: string) {
  let view!: Awaited<ReturnType<typeof renderRoute>>;
  await act(async () => {
    view = await renderRoute({
      route: OrganizationRoute,
      path: "/organization/$slug",
      initialEntry: entry,
    });
  });
  return view;
}

/** Widoczne okruszki jako tekst i adresy - z twardym błędem, gdy ich nie ma. */
function crumbs(): { labels: string[]; hrefs: (string | null)[] } {
  const nav = screen.getByRole("navigation", { name: "breadcrumb" });
  const items = within(nav).getAllByRole("listitem");
  return {
    labels: items.map((li) => li.textContent?.trim() ?? ""),
    hrefs: items.map((li) => li.querySelector("a")?.getAttribute("href") ?? null),
  };
}

/** Język interfejsu (`useTranslation`) i języka renderu (`currentLang`) naraz. */
async function setLang(lang: "pl" | "en") {
  h.lang = lang;
  await act(async () => {
    await i18n.changeLanguage(lang);
  });
}

beforeEach(async () => {
  await setLang("pl");
  h.requestUrl = "";
  h.cacheControl = [];
  h.archive = { posts: posts(3), total: 30 };
  h.archiveCalls = [];
  h.postsProps = null;
  db().reset();
  rpc().reset();
  db().setResponse("categories", ok(TERM_ROW));
  rpc().setData("crm_company_brand", []);
});

afterEach(() => {
  cleanup();
});

describe("/organization/$slug - term taksonomii", () => {
  it("czysty render: profil, lista z paginacją i WSPÓLNY cache", async () => {
    await mount("/organization/nato");
    expect(screen.getByRole("heading", { name: "Sojusz Północnoatlantycki" })).toBeTruthy();
    expect(h.cacheControl).toEqual([CLEAN]);
    // 30 publikacji po 12 na stronę = 3 strony; lista z loadera, nie z drugiego odczytu.
    expect(h.postsProps?.posts).toHaveLength(3);
    expect(h.postsProps?.totalPages).toBe(3);
    expect(h.postsProps?.isPending).toBe(false);
    expect(h.archiveCalls).toEqual([{ slug: "nato", page: 1, sort: "newest" }]);
  });

  it("sekcja osób dostaje wszystkie warianty nazwy - dopasowanie jest ścisłe", async () => {
    await mount("/organization/nato");
    expect(screen.getByTestId("osoby").getAttribute("data-names")).toBe(
      "Sojusz Północnoatlantycki|North Atlantic Alliance",
    );
  });

  it("AWARIA LISTY nie wywraca profilu, ale zdejmuje wspólny cache", async () => {
    // Wspólny nagłówek utrwaliłby na brzegu profil bez dorobku na czas
    // świeżości plus okno `stale-while-revalidate`.
    h.archive = "fail";
    await mount("/organization/nato");
    expect(screen.getByRole("heading", { name: "Sojusz Północnoatlantycki" })).toBeTruthy();
    expect(h.cacheControl).toEqual([DEGRADED]);
    expect(h.postsProps?.posts).toEqual([]);
    expect(h.postsProps?.totalPages).toBe(1);
  });

  it("strona i porządek z adresu idą do archiwum i do adresów kolejnych stron", async () => {
    await mount("/organization/nato?page=2&sort=popular");
    expect(h.archiveCalls[0]).toEqual({ slug: "nato", page: 2, sort: "popular" });
    expect(h.postsProps?.page).toBe(2);
    // Strona pierwsza bez `page`, porządek niedomyślny zostaje w adresie.
    expect(h.postsProps?.hrefFor(1)).toBe("/organization/nato?sort=popular");
    expect(h.postsProps?.hrefFor(3)).toBe("/organization/nato?page=3&sort=popular");
  });

  it("zmiana strony nawiguje bez jawnych wartości domyślnych", async () => {
    const view = await mount("/organization/nato?page=2");
    expect(h.postsProps?.hrefFor(1)).toBe("/organization/nato");
    await act(async () => {
      h.postsProps?.onPageChange(3);
    });
    await waitFor(() => expect(view.search()).toEqual({ page: 3 }));
    expect(view.currentPath()).toBe("/organization/nato");
  });
});

describe("/organization/$slug - firma z kartoteki (`org-<uuid>`)", () => {
  beforeEach(() => {
    // Tak odpowiada PRAWDZIWE archiwum: kategorii o slugu `org-<uuid>` nie ma.
    h.archive = null;
    rpc().setData("get_mention_target", [
      {
        id: COMPANY_ID,
        kind: "organization",
        label: "Instytut Badań",
        subtitle: "Think tank",
        logo_url: null,
        website: "instytut.example",
      },
    ]);
  });

  it("archiwum NIE jest pytane ani w loaderze, ani po hydratacji", async () => {
    await mount(`/organization/${COMPANY_SLUG}`);
    expect(screen.getByRole("heading", { name: "Instytut Badań" })).toBeTruthy();
    expect(h.archiveCalls).toEqual([]);
  });

  it("brak listy z DEFINICJI nie jest awarią - profil firmy idzie do wspólnego cache", async () => {
    // Przed naprawą: `null` z archiwum = „lista nie dojechała" = `no-store`
    // na KAŻDYM profilu firmy.
    await mount(`/organization/${COMPANY_SLUG}`);
    expect(h.cacheControl).toEqual([CLEAN]);
  });

  it("sekcji publikacji nie ma - „nie ma jeszcze publikacji” byłoby obietnicą bez pokrycia", async () => {
    await mount(`/organization/${COMPANY_SLUG}`);
    expect(screen.queryByTestId("publikacje")).toBeNull();
    // Osoby zostają: firma to pracodawca ze snapshotu `current_company`.
    expect(screen.getByTestId("osoby").getAttribute("data-names")).toBe("Instytut Badań");
  });
});

describe("/organization/$slug - „nie ma” kontra „nie wiem”", () => {
  it("brak organizacji to 404 bez wspólnego cache", async () => {
    db().setResponse("categories", ok(null));
    await mount("/organization/nie-ma");
    expect(screen.getByTestId("nie-znaleziono")).toBeTruthy();
    // Dopasowanie 404 nie jest w routerze „świeże", więc montowanie harnessu
    // woła loader drugi raz - liczy się to, że KAŻDY nagłówek jest bez cache.
    expect(h.cacheControl.length).toBeGreaterThan(0);
    expect(new Set(h.cacheControl)).toEqual(new Set([NOT_FOUND]));
  });

  it("awaria tożsamości to degradacja z ponowieniem, NIGDY fałszywe 404", async () => {
    db().setResponse("categories", fail("test: categories niedostepne"));
    await mount("/organization/nato");
    expect(h.cacheControl).toEqual([DEGRADED]);
    expect(screen.queryByTestId("nie-znaleziono")).toBeNull();
    expect(screen.getByText("Nie udało się załadować profilu organizacji")).toBeTruthy();
    // Przy degradacji loader nie czeka na listę - nie ma czego nią ozdobić.
    expect(screen.queryByTestId("publikacje")).toBeNull();
  });

  it("po powrocie backendu ponowienie LECZY profil bez nawigacji", async () => {
    // Bez `useDegradedUntilHealed` flaga z loadera trzymała komunikat awarii
    // nad zdrowymi danymi aż do kolejnej nawigacji - i nie było przycisku.
    db().setResponse("categories", fail("test: categories niedostepne"));
    await mount("/organization/nato");
    const retry = await screen.findByRole("button", { name: /spróbuj ponownie/i });
    db().setResponse("categories", ok(TERM_ROW));
    await act(async () => {
      fireEvent.click(retry);
    });
    expect(await screen.findByRole("heading", { name: "Sojusz Północnoatlantycki" })).toBeTruthy();
    expect(screen.queryByText("Nie udało się załadować profilu organizacji")).toBeNull();
  });

  it("ponowienie, które ustali BRAK organizacji, kończy się 404, a nie pustym profilem", async () => {
    // Przy degradacji nie wiemy, czy organizacja istnieje. Gdy backend wróci
    // i odpowie „nie ma", widok ma to powiedzieć - nie wisieć na komunikacie awarii.
    db().setResponse("categories", fail("test: categories niedostepne"));
    await mount("/organization/nato");
    const retry = await screen.findByRole("button", { name: /spróbuj ponownie/i });
    db().setResponse("categories", ok(null));
    await act(async () => {
      fireEvent.click(retry);
    });
    expect(await screen.findByTestId("nie-znaleziono")).toBeTruthy();
    expect(screen.queryByText("Nie udało się załadować profilu organizacji")).toBeNull();
  });

  it("nieudane ponowienie ZOSTAWIA komunikat - cisza sugerowałaby pusty profil", async () => {
    db().setResponse("categories", fail("test: categories niedostepne"));
    await mount("/organization/nato");
    const retry = await screen.findByRole("button", { name: /spróbuj ponownie/i });
    await act(async () => {
      fireEvent.click(retry);
    });
    expect(screen.getByText("Nie udało się załadować profilu organizacji")).toBeTruthy();
    expect(screen.queryByTestId("nie-znaleziono")).toBeNull();
  });
});

describe("/organization/$slug - okruszki i język", () => {
  it("widoczne okruszki mają TEN SAM poziom „Organizacje” co JSON-LD", async () => {
    // Przed naprawą: „Strona główna › Nazwa" na ekranie, a w `BreadcrumbList`
    // „Strona główna › Organizacje › Nazwa" - dane strukturalne deklarowały
    // poziom, którego czytelnik nie widział.
    const view = await mount("/organization/nato");
    const visible = crumbs();
    expect(visible.labels.slice(1)).toEqual(["Organizacje", "Sojusz Północnoatlantycki"]);
    expect(visible.hrefs.slice(1)).toEqual(["/search", null]);

    const ld = view
      .headScripts()
      .map((s) => JSON.parse(String(s.children)) as Record<string, unknown>)
      .find((n) => n["@type"] === "BreadcrumbList") as {
      itemListElement: { name: string }[];
    };
    expect(ld.itemListElement.slice(1).map((i) => i.name)).toEqual(visible.labels.slice(1));
  });

  it("wersja EN mówi po angielsku w okruszkach, nazwie i tytule karty", async () => {
    await setLang("en");
    h.requestUrl = "/en/organization/nato";
    const view = await mount("/organization/nato");
    expect(crumbs().labels.slice(1)).toEqual(["Organizations", "North Atlantic Alliance"]);
    const title = view.meta().find((m) => typeof m.title === "string")?.title;
    expect(title).toBe("North Atlantic Alliance - organization");
  });

  it("szkielet ładowania rezerwuje miejsce, ale jest dekoracją dla czytnika", () => {
    const Pending = OrganizationRoute.options.pendingComponent as () => ReactElement;
    const { container } = render(<Pending />);
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });

  it("nakładka i `head()` czytają okruszek z JEDNEGO źródła", () => {
    for (const lang of ["pl", "en"] as const) {
      expect(realT(lang)("organization.breadcrumb")).toBe(ORGANIZATION_PAGE_COPY[lang].breadcrumb);
    }
  });

  it("ekran błędu trasy bierze tytuł ze słownika w języku strony", async () => {
    const ErrorComponent = OrganizationRoute.options.errorComponent as (
      props: ErrorComponentProps,
    ) => ReactElement;
    const props = { error: new Error("test"), reset: () => {} } as ErrorComponentProps;
    for (const [lang, expected] of [
      ["pl", "Nie udało się załadować profilu organizacji"],
      ["en", "Couldn't load the organization profile"],
    ] as const) {
      await setLang(lang);
      const { unmount } = render(<ErrorComponent {...props} />);
      expect(screen.getByTestId("ekran-bledu").textContent).toBe(expected);
      unmount();
    }
  });
});
