// Dwie trasy PUBLICZNE programów badawczych: `/programs` (katalog, 0 z 28
// linii) i `/programs/$slug` (landing, 0 z 73 linii, 0 z 23 funkcji).
//
// DLACZEGO W JEDNYM PLIKU. Obie stoją na tym samym module zapytań
// (`src/lib/queries/programs.ts`) i na tym samym słowniku (`i18n-programs`),
// a dowód, który ma sens, jest w KONTRAŚCIE między nimi: katalog rozdziela
// „pusto" od „nie dojechało", a landing tego NIE ROBI - i to jest defekt
// przypięty niżej (`it.fails`), nie różnica gustu. Trzymanie tych dwóch tras
// w osobnych plikach schowałoby ten kontrast.
//
// CZTERY REGUŁY, KTÓRYCH ZŁAMANIE KOSZTUJE:
//
//   1. NIEISTNIEJĄCY SLUG TO 404, NIE PUSTA STRONA PROGRAMU. Landing zbudowany
//      wokół `undefined` wystawiłby crawlerowi HTTP 200 z pustym szkieletem.
//   2. AWARIA BACKENDU NIE JEST 404 (przypięte niżej jako defekt). Landing
//      robi dziś `catch(() => null)` i zaraz potem `throw notFound()`, więc
//      minutowy blip zamienia ŻYWY program w twarde 404 - a 404 wyrzuca adres
//      z indeksu wyszukiwarki. Siostrzana trasa `/podcasts/$show` rozstrzyga
//      to samo pytanie POPRAWNIE (trzy rozdzielone stany), więc kontrakt jest
//      w repozytorium już zapisany - tylko nie tutaj.
//   3. NAGŁÓWEK NIESIE NAZWĘ I OPIS W OBU JĘZYKACH, a wersja bez danych
//      loadera musi wyjść z indeksu (`noindex, follow`) zamiast zostawiać
//      w nim pusty tytuł.
//   4. TREŚĆ JEDNEGO OBSZARU ROBOCZEGO NIE WYCHODZI NA HOŚCIE DRUGIEGO.
//
// ATRAPOWANE SĄ WYŁĄCZNIE GRANICE: klient Supabase, adres żądania, nagłówki
// odpowiedzi oraz dwa organizmy, które NIE NALEŻĄ do tych tras i mają własne
// pliki testowe - `FollowButton` (czyta sesję i preferencje) i `NewsletterForm`
// (woła server function). Warstwa zapytań, selektory landingu i słowniki biegną
// prawdziwe.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - PARYTETU SŁOWNIKA PL/EN: `src/lib/__tests__/i18nSupportBundles.test.ts`.
// - KANAŁU RSS PROGRAMU: `programs.$slug.rss[.]xml.ts` ma kontrakt
//   w `feedRoutesDegradation.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";

const { TENANT_A, TENANT_B, PROGRAM_ID, SLUG } = vi.hoisted(() => ({
  TENANT_A: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  TENANT_B: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  PROGRAM_ID: "55555555-5555-4555-8555-555555555555",
  SLUG: "bezpieczenstwo-europy",
}));

const h = vi.hoisted(() => ({
  /** Wiersze `research_programs` ze WSZYSTKICH obszarów roboczych. */
  programs: [] as Record<string, unknown>[],
  /** Tenant PRZEGLĄDANEJ domeny (rola polityki `public_tenant_id()`). */
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  /** Wiersze `research_program_projects` dla otwartego programu. */
  projects: [] as Record<string, unknown>[],
  /** Wiersze zwracane przez RPC `get_program_members`. */
  members: [] as Record<string, unknown>[],
  /** Wiersze `research_program_partners`. */
  partners: [] as Record<string, unknown>[],
  /** Wiersze `research_program_items` (tresci wybrane przez redakcje). */
  items: [] as Record<string, unknown>[],
  /** Wiersze `podcasts` dla kuratorowanych odcinkow. */
  podcasts: [] as Record<string, unknown>[],
  /** Wiersze `events` dla kuratorowanych wydarzen. */
  events: [] as Record<string, unknown>[],
  /** Tabele i RPC, których odczyt ma paść (blip backendu). */
  broken: new Set<string>(),
  /** Etykiety odczytów w kolejności - podstawa pomiaru zapytań. */
  reads: [] as string[],
  /** Adres żądania widziany przez `head()`. */
  requestUrl: "https://nes.example.org/programs",
  /** Wartości `Cache-Control`, jakie loader ustawił na odpowiedzi. */
  cacheControl: [] as string[],
  /** Wartości nagłówka HTTP `Link` (preload hero programu). */
  linkHeaders: [] as string[],
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, ok, fail } = await import("@/test/supabase/chain");
  const stub = supabaseFromStub();

  function filters(calls: ReadonlyArray<{ method: string; args: ReadonlyArray<unknown> }>) {
    const out = new Map<string, unknown>();
    for (const call of calls) {
      if (call.method === "eq" && typeof call.args[0] === "string") {
        out.set(call.args[0], call.args[1]);
      }
    }
    return out;
  }

  /** Odsiew polityki publicznej: tylko wiersze tenanta przeglądanej domeny. */
  function visible(rows: Record<string, unknown>[]) {
    return rows.filter((row) => row.tenant_id === h.tenantId);
  }

  stub.setResponse("research_programs", (chain) => {
    const eq = filters(chain.calls);
    const bySlug = eq.has("slug");
    h.reads.push(bySlug ? "research_programs:slug" : "research_programs:list");
    if (h.broken.has("research_programs")) return fail("test: research_programs niedostepna");
    const rows = visible(h.programs);
    return bySlug ? ok(rows.find((p) => p.slug === eq.get("slug")) ?? null) : ok(rows);
  });
  stub.setResponse("research_program_projects", () => {
    h.reads.push("research_program_projects");
    if (h.broken.has("research_program_projects")) return fail("test: projekty niedostepne");
    return ok(h.projects);
  });
  stub.setResponse("research_program_partners", () => {
    h.reads.push("research_program_partners");
    return ok(h.partners);
  });
  stub.setResponse("research_program_items", () => {
    h.reads.push("research_program_items");
    return ok(h.items);
  });
  stub.setResponse("podcasts", () => {
    h.reads.push("podcasts");
    return ok(h.podcasts);
  });
  stub.setResponse("events", () => {
    h.reads.push("events");
    return ok(h.events);
  });
  return {
    supabase: {
      from: stub.from,
      rpc: async (name: string) => {
        h.reads.push(`rpc:${name}`);
        if (h.broken.has(`rpc:${name}`)) {
          return { data: null, error: { message: "test: rpc niedostepne", code: "42501" } };
        }
        return { data: name === "get_program_members" ? h.members : [], error: null };
      },
    },
  };
});

vi.mock("@/lib/seo/request", () => ({
  getRequestUrl: () => h.requestUrl,
  getOrigin: () => "https://nes.example.org",
}));
vi.mock("@/lib/http/responseHeaders", () => ({
  appendLinkHeader: (value: string) => void h.linkHeaders.push(value),
  setCacheControlHeader: (value: string) => void h.cacheControl.push(value),
  readRouteCacheDirective: () => null,
}));
// GRANICE, KTÓRE NIE NALEŻĄ DO TYCH TRAS. Oba organizmy mają własne zapytania
// ZWIĄZANE Z SESJĄ czytelnika (obserwowanie programu, zapis do newslettera),
// więc z definicji nie dają się zasiać w loaderze: dehydrowany ładunek SSR jest
// WSPÓLNY dla wszystkich czytelników tego adresu, a stan obserwowania jest
// per-osoba. To jest odrzucenie z uzasadnieniem dla bloku N5 na końcu pliku.
vi.mock("@/components/FollowButton", () => ({
  FollowButton: () => <div data-testid="follow-button" />,
}));
vi.mock("@/components/NewsletterForm", () => ({
  NewsletterForm: () => <div data-testid="newsletter-form" />,
}));

import "@/test/i18nReal";
import { QueryClient } from "@tanstack/react-query";
import i18n from "@/lib/i18n";
import { setClientLang } from "@/lib/i18n/localeRuntime";
import { renderRoute, routeHead, type RouteHeadResult } from "@/test/routeHarness";
import { axeViolations, summarize } from "@/test/axe";
import { Route as ProgramsIndexRoute } from "@/routes/programs.index";
import { Route as ProgramDetailRoute } from "@/routes/programs.$slug";

const INDEX_PATH = "/programs/";
const DETAIL_PATH = "/programs/$slug";

// ── fixtures (RODO: wszystkie nazwy i tytuły są ZMYŚLONE) ───────────────────

function program(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PROGRAM_ID,
    tenant_id: TENANT_A,
    slug: SLUG,
    name_pl: "Bezpieczeństwo Europy",
    name_en: "European security",
    tagline_pl: "Jak Europa broni się sama.",
    tagline_en: "How Europe defends itself.",
    scope_pl: "Zdolności obronne, przemysł, odstraszanie.",
    scope_en: "Defence capabilities, industry, deterrence.",
    research_questions: [],
    icon: "shield",
    accent_color: "#123456",
    // Adres w kształcie Supabase Storage, bo tylko dla takich
    // `buildImageSrcSet` generuje warianty - a parytet preload<->render
    // jest tu przedmiotem dowodu, nie ozdobą.
    hero_image_url: "https://db.example.org/storage/v1/object/public/media/hero.jpg",
    category_id: null,
    contact_email: null,
    sort_order: 1,
    status: "published",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
    ...patch,
  };
}

async function mountIndex(queryClient?: QueryClient) {
  return renderRoute({
    route: ProgramsIndexRoute,
    path: INDEX_PATH,
    initialEntry: "/programs",
    queryClient,
  });
}

async function mountDetail(slug = SLUG, queryClient?: QueryClient) {
  return renderRoute({
    route: ProgramDetailRoute,
    path: DETAIL_PATH,
    initialEntry: `/programs/${slug}`,
    queryClient,
  });
}

/** Wartość `content` wpisu meta - z twardym błędem, gdy wpisu nie ma. */
// `httpEquiv` w unii kluczy: `head()` tych tras emituje nie tylko
// `name`/`property`, ale też `http-equiv` (np. `content-language`),
// a helper skopiowany z innego testu tego klucza nie znał.
function metaContent(
  head: RouteHeadResult,
  key: "name" | "property" | "httpEquiv" | "httpEquiv",
  value: string,
): string {
  const found = (head.meta ?? []).find((entry) => entry[key] === value);
  const content = found?.content;
  if (typeof content !== "string") throw new Error(`test: brak meta ${key}="${value}"`);
  return content;
}

/** Tytuł dokumentu z `head()` - z twardym błędem, gdy go nie ma. */
function headTitle(head: RouteHeadResult): string {
  const found = (head.meta ?? []).find((entry) => typeof entry.title === "string");
  if (typeof found?.title !== "string") throw new Error("test: head() nie niesie tytulu");
  return found.title;
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  setClientLang("pl");
  h.programs = [program()];
  h.tenantId = TENANT_A;
  h.projects = [];
  h.members = [];
  h.partners = [];
  h.items = [];
  h.podcasts = [];
  h.events = [];
  h.broken = new Set<string>();
  h.reads = [];
  h.requestUrl = "https://nes.example.org/programs";
  h.cacheControl = [];
  h.linkHeaders = [];
});

afterEach(async () => {
  cleanup();
  setClientLang("pl");
  await i18n.changeLanguage("pl");
  vi.restoreAllMocks();
});

// ═══ /programs - katalog ════════════════════════════════════════════════════

describe("trasa /programs - katalog programów", () => {
  it("pokazuje kartę programu z nazwą, tezą i drogą do landingu", async () => {
    await mountIndex();

    expect(
      screen.getByRole("heading", { level: 2, name: "Bezpieczeństwo Europy" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Jak Europa broni się sama.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Bezpieczeństwo Europy/ })).toHaveAttribute(
      "href",
      `/programs/${SLUG}`,
    );
  });

  it("etykieta wejścia w program idzie ze SŁOWNIKA, w obu językach", async () => {
    // NAPRAWIONE 2026-09-02. Karta miała `lang === "en" ? "Explore" : "Poznaj
    // program"` wpisane w JSX, mimo że klucz `programs.explore` istniał
    // w słowniku od początku - i miał INNĄ treść angielską („Explore the
    // program"). Dwa równoległe zestawy literałów, z których jeden był
    // niewidoczny dla bramki parytetu, a drugi dla czytelnika.
    await mountIndex();
    expect(screen.getByText("Poznaj program")).toBeInTheDocument();

    cleanup();
    await i18n.changeLanguage("en");
    setClientLang("en");
    await mountIndex();
    expect(screen.getByText("Explore the program")).toBeInTheDocument();
  });

  it("brak programów to KOMUNIKAT, a nie puste płótno", async () => {
    h.programs = [];
    await mountIndex();

    expect(screen.getByText("Brak opublikowanych programów.")).toBeInTheDocument();
  });

  it("AWARIA BACKENDU mówi wprost, co się stało - nie udaje pustego katalogu", async () => {
    // „Brak programów" i „nie udało się pobrać" to dwie różne prawdy. Bez tego
    // rozdzielenia czytelnik wychodzi z wnioskiem, że instytut nie prowadzi
    // badań, a monitoring nie widzi niczego.
    h.broken.add("research_programs");
    await mountIndex();

    await waitFor(() =>
      expect(screen.getByText("Nie udało się załadować programów")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Brak opublikowanych programów.")).toBeNull();
    expect(h.cacheControl.at(-1)).toContain("no-store");
  });

  it("po angielsku komunikat awarii jest angielski i idzie ze słownika", async () => {
    // Do dziś ten komunikat był literałem „Couldn't load programmes" wpisanym
    // w JSX - z brytyjską pisownią, której nie ma nigdzie w słowniku.
    await i18n.changeLanguage("en");
    setClientLang("en");
    h.broken.add("research_programs");
    await mountIndex();

    await waitFor(() => expect(screen.getByText("Couldn't load programs")).toBeInTheDocument());
  });

  it("KONTROLA DODATNIA: czysty render deklaruje politykę TREŚCI, nie no-store", async () => {
    await mountIndex();

    expect(h.cacheControl.at(-1)).toContain("s-maxage");
    expect(h.cacheControl.at(-1)).not.toContain("no-store");
  });

  it("program innego obszaru roboczego nie pojawia się w katalogu tego hosta", async () => {
    h.programs = [
      program(),
      program({
        id: "66666666-6666-4666-8666-666666666666",
        tenant_id: TENANT_B,
        slug: "obcy",
        name_pl: "Program obcego obszaru",
      }),
    ];
    await mountIndex();

    expect(screen.getByText("Bezpieczeństwo Europy")).toBeInTheDocument();
    expect(screen.queryByText("Program obcego obszaru")).toBeNull();
  });

  it("KONTROLA DODATNIA: na hoście drugiego obszaru widać JEGO program", async () => {
    h.programs = [program({ tenant_id: TENANT_B, name_pl: "Program obcego obszaru" })];
    h.tenantId = TENANT_B;
    await mountIndex();

    expect(screen.getByText("Program obcego obszaru")).toBeInTheDocument();
  });

  it("nie zostawia katalogu z wadami dostępności", async () => {
    const view = await mountIndex();
    await screen.findByRole("heading", { level: 1 });

    const violations = await axeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("trasa /programs - nagłówek dokumentu", () => {
  it("po polsku tytuł i opis są polskie, bez pauzy typograficznej", async () => {
    // House style: dywiz, nie pauza „—". Tytuł SEO jest tekstem WIDOCZNYM
    // w wynikach wyszukiwania, więc reguła obowiązuje go tak samo jak słownik.
    const head = routeHead(ProgramsIndexRoute);

    expect(headTitle(head)).toBe("Programy badawcze - New European Strategies");
    expect(metaContent(head, "name", "description")).toContain("Nasze programy badawcze");
    expect(headTitle(head)).not.toContain("—");
    expect(metaContent(head, "name", "description")).not.toContain("—");
    expect(metaContent(head, "httpEquiv", "content-language")).toBe("pl");
  });

  it("na adresie /en tytuł i opis są angielskie", async () => {
    h.requestUrl = "https://nes.example.org/en/programs";
    const head = routeHead(ProgramsIndexRoute);

    expect(headTitle(head)).toBe("Research programs - New European Strategies");
    expect(metaContent(head, "name", "description")).toContain("Our research programs");
    expect(metaContent(head, "httpEquiv", "content-language")).toBe("en");
  });

  it("okruszki JSON-LD niosą etykietę w języku strony", async () => {
    const pl = routeHead(ProgramsIndexRoute);
    expect(pl.scripts?.[0]?.children).toContain("Programy badawcze");

    h.requestUrl = "https://nes.example.org/en/programs";
    const en = routeHead(ProgramsIndexRoute);
    expect(en.scripts?.[0]?.children).toContain("Research programs");
  });
});

// ═══ /programs/$slug - landing ══════════════════════════════════════════════

describe("trasa /programs/$slug - sklejenie i treść landingu", () => {
  it("czyta slug ze ŚCIEŻKI i pokazuje TEN program, nie pierwszy z tabeli", async () => {
    h.programs = [
      program({
        id: "66666666-6666-4666-8666-666666666666",
        slug: "gospodarka",
        name_pl: "Gospodarka Europy",
      }),
      program(),
    ];
    const view = await mountDetail("gospodarka");

    expect(view.currentPath()).toBe("/programs/gospodarka");
    expect(
      screen.getByRole("heading", { level: 1, name: "Gospodarka Europy" }),
    ).toBeInTheDocument();
  });

  it("aria-label linku projektu idzie ze SŁOWNIKA i niesie nazwę projektu", async () => {
    // NAPRAWIONE 2026-09-02: było `lang === "en" ? \`Open project: ${name}\` :
    // ...` w JSX. Etykieta linku wychodzącego jest jedynym, co czytnik ekranu
    // mówi o tym linku - a bramka parytetu nie miała czego porównać.
    h.projects = [
      {
        id: "p1",
        name_pl: "Mapa zdolności",
        name_en: "Capability map",
        summary_pl: null,
        summary_en: null,
        project_status: "active",
        url: "https://example.org/projekt",
        sort_order: 0,
      },
    ];
    await mountDetail();

    expect(await screen.findByText("Otwórz projekt: Mapa zdolności")).toBeInTheDocument();
  });

  it("pełny landing renderuje WSZYSTKIE sekcje redakcyjne, każdą z drogą wyjścia", async () => {
    // Landing programu jest zbudowany z ośmiu sekcji renderowanych WARUNKOWO.
    // Kiedy każda z nich ma dane, każda musi też mieć poprawny link wyjścia -
    // bo to jedyny powód, dla którego redakcja te sekcje wypełnia. Pojedyncza
    // sekcja renderowana bez linku (albo z linkiem do złego zasobu) jest
    // niewidoczna w każdym teście, który patrzy tylko na nagłówki.
    h.members = [
      {
        program_id: PROGRAM_ID,
        profile_id: "prof-1",
        display_name: "Zofia Wiatrak",
        avatar_url: null,
        job_title: null,
        profile_slug: "zofia-wiatrak",
        member_role_pl: "Kierowniczka programu",
        member_role_en: "Program lead",
        is_lead: true,
        sort_order: 0,
      },
      {
        program_id: PROGRAM_ID,
        profile_id: "prof-2",
        display_name: "Jan Bryza",
        avatar_url: null,
        job_title: "Analityk",
        profile_slug: null,
        member_role_pl: null,
        member_role_en: null,
        is_lead: false,
        sort_order: 1,
      },
    ];
    h.projects = [
      {
        id: "p1",
        name_pl: "Mapa zdolności",
        name_en: "Capability map",
        summary_pl: "Przegląd zdolności obronnych.",
        summary_en: "A review of defence capabilities.",
        project_status: "active",
        url: null,
        sort_order: 0,
      },
    ];
    h.partners = [
      { id: "part-1", name: "Instytut Wymyślony", logo_url: null, url: "https://example.org/i" },
    ];
    h.items = [
      { item_type: "podcast", post_id: null, podcast_id: "pod-1", event_id: null, sort_order: 0 },
      { item_type: "event", post_id: null, podcast_id: null, event_id: "ev-1", sort_order: 1 },
    ];
    h.podcasts = [
      {
        id: "pod-1",
        slug: "odcinek-o-obronie",
        title_pl: "Odcinek o obronie",
        title_en: "An episode on defence",
        excerpt_pl: "Rozmowa o zdolnościach.",
        excerpt_en: "A talk on capabilities.",
        cover_image_url: null,
      },
    ];
    h.events = [
      {
        id: "ev-1",
        slug: "debata-o-obronie",
        title_pl: "Debata o obronie",
        title_en: "A debate on defence",
        starts_at: "2026-10-01T17:00:00.000Z",
        location: "Sala wymyślona",
      },
    ];
    await mountDetail();

    // Zespół: lider z profilem prowadzi do jego strony, członek bez profilu
    // renderuje się BEZ linku (a nie z linkiem do `/author/null`).
    expect(screen.getByRole("link", { name: /Zofia Wiatrak/ })).toHaveAttribute(
      "href",
      "/author/zofia-wiatrak",
    );
    expect(screen.getByText("Jan Bryza")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Jan Bryza/ })).toBeNull();
    // Projekt bez adresu zewnętrznego nie udaje linku.
    expect(screen.getByText("Mapa zdolności")).toBeInTheDocument();
    expect(screen.queryByText(/Otwórz projekt/)).toBeNull();
    // Partner, kuratorowany odcinek i wydarzenie - każde z własnym wyjściem.
    expect(screen.getByRole("link", { name: /Instytut Wymyślony/ })).toHaveAttribute(
      "href",
      "https://example.org/i",
    );
    expect(screen.getByRole("link", { name: /Odcinek o obronie/ })).toHaveAttribute(
      "href",
      "/podcast/odcinek-o-obronie",
    );
    expect(screen.getByRole("link", { name: /Debata o obronie/ })).toHaveAttribute(
      "href",
      "/events/debata-o-obronie",
    );
    // Newsletter programu i przycisk obserwowania to GRANICE (atrapy) - tutaj
    // dowodem jest wyłącznie to, że landing je w ogóle montuje.
    expect(screen.getByTestId("newsletter-form")).toBeInTheDocument();
    expect(screen.getByTestId("follow-button")).toBeInTheDocument();
  });

  it("pytania badawcze renderują się w języku strony i pomijają puste wpisy", async () => {
    // Pytania są tablicą JSON w kolumnie, więc redakcja potrafi zostawić w niej
    // wpis z samymi spacjami. Renderowanie go daje pusty punkt listy.
    h.programs = [
      program({
        research_questions: [
          { pl: "Kto płaci za odstraszanie?", en: "Who pays for deterrence?" },
          { pl: "   ", en: "   " },
        ],
      }),
    ];
    await mountDetail();

    expect(screen.getByText("Kto płaci za odstraszanie?")).toBeInTheDocument();
    const items = screen.getAllByRole("listitem").map((el) => el.textContent?.trim());
    expect(items.filter((text) => text === "")).toEqual([]);
  });

  it("loader dopisuje nagłówek HTTP Link z preloadem hero (LCP)", async () => {
    // Hero nad zgięciem jest kandydatem LCP. Preload rusza z nagłówków
    // odpowiedzi, zanim parser dojdzie do <img>, i niesie TEN SAM `srcset`,
    // który maluje `OptimizedImage responsive` - inaczej przeglądarka pobiera
    // dwa warianty tego samego obrazu.
    await mountDetail();

    expect(h.linkHeaders.some((value) => value.includes('as="image"'))).toBe(true);
    expect(h.linkHeaders.some((value) => value.includes("imagesrcset="))).toBe(true);
  });

  it("program bez hero NIE dopisuje pustego preloadu", async () => {
    h.programs = [program({ hero_image_url: null })];
    await mountDetail();

    expect(h.linkHeaders).toEqual([]);
  });

  it("nie zostawia landingu z wadami dostępności", async () => {
    h.members = [
      {
        program_id: PROGRAM_ID,
        profile_id: "prof-1",
        display_name: "Zofia Wiatrak",
        avatar_url: null,
        job_title: null,
        profile_slug: null,
        member_role_pl: "Kierowniczka programu",
        member_role_en: "Program lead",
        is_lead: true,
        sort_order: 0,
      },
    ];
    const view = await mountDetail();
    await screen.findByRole("heading", { level: 1, name: "Bezpieczeństwo Europy" });

    const violations = await axeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("trasa /programs/$slug - brak programu i izolacja obszarów", () => {
  it("nieistniejący slug kończy się STRONĄ 404, nie pustym landingiem", async () => {
    await mountDetail("nie-ma-takiego-programu");

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Nie znaleziono strony" })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("heading", { level: 1, name: "Bezpieczeństwo Europy" })).toBeNull();
  });

  it("program innego obszaru daje 404, a nie swoją nazwę na tym hoście", async () => {
    h.programs = [program({ tenant_id: TENANT_B, name_pl: "Program obcego obszaru" })];
    await mountDetail();

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Nie znaleziono strony" })).toBeInTheDocument(),
    );
    expect(screen.queryByText("Program obcego obszaru")).toBeNull();
  });

  it("KONTROLA DODATNIA: ten sam slug na własnym hoście renderuje landing", async () => {
    h.programs = [program({ tenant_id: TENANT_B, name_pl: "Program obcego obszaru" })];
    h.tenantId = TENANT_B;
    await mountDetail();

    expect(
      screen.getByRole("heading", { level: 1, name: "Program obcego obszaru" }),
    ).toBeInTheDocument();
  });
});

// ── DEFEKT PRZYPIĘTY: fabrykowany 404 przy awarii backendu ──────────────────
//
// KONTRAKT, KTÓREGO CHCEMY. Blip backendu na trasie adresowanej slugiem musi
// dać HTTP 200 z uczciwym komunikatem - dokładnie tak, jak rozstrzyga to
// siostrzana `/podcasts/$show` (trzy rozdzielone stany: wiersz / `null` /
// „nie wiemy"). Doktryna jest w repozytorium zapisana i przetestowana, tylko
// nie na tej trasie.
//
// STAN DZISIEJSZY. `programs.$slug` robi `ensureQueryData(...).catch(() => null)`
// i zaraz potem `if (!landing) throw notFound()`, więc „nie wiem" i „nie ma"
// wpadają do jednej gałęzi. Minutowa niedostępność bazy zamienia ŻYWĄ stronę
// programu w twarde 404, a 404 wyrzuca adres z indeksu wyszukiwarki na tygodnie.
//
// DLACZEGO NIE NAPRAWIAM TEGO TUTAJ. Naprawa nie jest lokalna: wymaga
// trójstanowego loadera (`loadResilient`), nowej gałęzi renderu (uczciwy
// komunikat zamiast `PublicNotFound`) ORAZ nagłówka `no-store`, żeby
// zdegradowany render nie zamarzł na brzegu CDN. Ta sama zmiana należy się
// `tracker.$slug` i `/experts`, które mają bliźniaczy defekt w drugą stronę
// (gubią flagę `degraded`), więc jest to jedna spójna jednostka pracy nad
// doktryną fail-open dla tras slugowych - a nie doklejka do pliku testowego.
// Zapadka poniżej pilnuje, żeby defekt nie zniknął z widoku ani nie został
// „naprawiony" przypadkiem bez zmiany tego opisu.
describe("trasa /programs/$slug - awaria backendu kontra 404", () => {
  it.fails("awaria odczytu NIE POWINNA dawać 404 na żywym programie", async () => {
    // TEN TEST MA PADAĆ. Gdy zacznie przechodzić, defekt jest naprawiony -
    // wtedy zdejmij `.fails` i usuń kontrolę dodatnią poniżej.
    //
    // Asercja jest SYNCHRONICZNA celowo: `renderRoute` czeka na loader, więc
    // `notFound()` jest już rozstrzygnięte w pierwszym renderze. `waitFor`
    // zamieniłby ten przypadek w zapadkę, która nigdy nie zmieni koloru -
    // po naprawie czekanie na nieistniejący nagłówek 404 i tak rzucałoby
    // timeoutem, czyli `it.fails` zostawałby zielony na zawsze.
    h.broken.add("research_programs");
    await mountDetail();

    expect(screen.queryByRole("heading", { name: "Nie znaleziono strony" })).toBeNull();
  });

  it("KONTROLA DODATNIA: dziś awaria odczytu daje dokładnie stronę 404", async () => {
    // Bez tej pary `it.fails` wyżej byłby zielony także wtedy, gdyby trasa
    // przestała się renderować z jakiegokolwiek innego powodu.
    h.broken.add("research_programs");
    await mountDetail();

    expect(screen.getByRole("heading", { name: "Nie znaleziono strony" })).toBeInTheDocument();
    // I nie ma tu ŻADNEGO nagłówka `no-store` - zdegradowana odpowiedź może
    // trafić na brzeg CDN i utrwalić 404 dla kolejnych czytelników.
    expect(h.cacheControl).toEqual([]);
  });
});

describe("trasa /programs/$slug - nagłówek dokumentu", () => {
  it("po polsku tytuł niesie nazwę programu, a opis jego tezę", async () => {
    const head = routeHead(ProgramDetailRoute, {
      loaderData: { landing: { program: program() }, heroPreload: null },
      params: { slug: SLUG },
    });

    expect(headTitle(head)).toBe("Bezpieczeństwo Europy - New European Strategies");
    expect(metaContent(head, "name", "description")).toBe("Jak Europa broni się sama.");
    expect(metaContent(head, "property", "og:image")).toBe(
      "https://db.example.org/storage/v1/object/public/media/hero.jpg",
    );
  });

  it("na adresie /en tytuł i opis biorą kolumny angielskie", async () => {
    h.requestUrl = `https://nes.example.org/en/programs/${SLUG}`;
    const head = routeHead(ProgramDetailRoute, {
      loaderData: { landing: { program: program() }, heroPreload: null },
      params: { slug: SLUG },
    });

    expect(headTitle(head)).toBe("European security - New European Strategies");
    expect(metaContent(head, "name", "description")).toBe("How Europe defends itself.");
    expect(metaContent(head, "httpEquiv", "content-language")).toBe("en");
  });

  it("program bez tezy spada na ZAKRES, a bez zakresu na własną nazwę", async () => {
    // Pusty `description` w wyniku wyszukiwania to wynik bez zajawki. Kolejność
    // fallbacków jest treścią kontraktu: teza jest krótsza i lepsza od zakresu,
    // a nazwa jest ostatnią deską ratunku - nigdy pustka.
    const noTagline = program({ tagline_pl: null, tagline_en: null });
    expect(
      metaContent(
        routeHead(ProgramDetailRoute, {
          loaderData: { landing: { program: noTagline }, heroPreload: null },
          params: { slug: SLUG },
        }),
        "name",
        "description",
      ),
    ).toBe("Zdolności obronne, przemysł, odstraszanie.");

    const bare = program({
      tagline_pl: null,
      tagline_en: null,
      scope_pl: null,
      scope_en: null,
    });
    expect(
      metaContent(
        routeHead(ProgramDetailRoute, {
          loaderData: { landing: { program: bare }, heroPreload: null },
          params: { slug: SLUG },
        }),
        "name",
        "description",
      ),
    ).toBe("Bezpieczeństwo Europy");
  });

  it("bez danych loadera nagłówek WYCHODZI Z INDEKSU zamiast zostawiać pusty tytuł", async () => {
    // `head()` bywa wołane bez ładunku (przerwana nawigacja, 404). Adres bez
    // programu nie ma czego obiecywać, więc nie może zostać w indeksie.
    h.requestUrl = `https://nes.example.org/programs/${SLUG}`;
    const head = routeHead(ProgramDetailRoute, { params: { slug: SLUG } });

    expect(headTitle(head)).toBe("Programy badawcze");
    expect(metaContent(head, "name", "robots")).toBe("noindex, follow");
  });

  it("po angielsku wersja bez danych też mówi po angielsku i też jest noindex", async () => {
    h.requestUrl = `https://nes.example.org/en/programs/${SLUG}`;
    const head = routeHead(ProgramDetailRoute, { params: { slug: SLUG } });

    expect(headTitle(head)).toBe("Research programs");
    expect(metaContent(head, "name", "robots")).toBe("noindex, follow");
  });
});

// ── N5: LICZBA ZAPYTAŃ NA PIERWSZYM MALOWANIU ───────────────────────────────
//
// POMIAR, NIE OPINIA. `measure*` rozdziela odczyty LOADERA (serwer, przed
// pierwszym bajtem HTML) od odczytów KLIENTA (start na montażu, czyli
// round-tripy PO hydratacji). Rozdzielenie działa, bo loader zasiewa cache
// zapytań, a ten jedzie do przeglądarki w dehydrowanym ładunku SSR.
//
// ZMIERZONE `/programs`:       loader 1 odczyt, klient 0.
// ZMIERZONE `/programs/$slug`: loader 5 odczytów (jeden „landing bundle":
//   program + RPC składu + projekty + partnerzy + wybrane treści), klient 0.
//
// OBIE TRASY SĄ JUŻ CZYSTE - nie ma tu czego przenosić, i to jest wynik
// pomiaru, nie założenie. Zapadka stoi na ZERZE, żeby dopisanie `useQuery`
// bez zasiewu w loaderze wywaliło test, a nie przeszło niezauważone.
//
// ODRZUCONE Z UZASADNIENIEM - co MUSI zostać klienckie na landingu:
//   * `FollowButton` (obserwowanie programu) czyta SESJĘ czytelnika. Zasiew
//     w loaderze jest tu nie tylko trudny, ale NIEDOPUSZCZALNY: dehydrowany
//     ładunek SSR jest wspólny dla wszystkich czytelników tego adresu i wchodzi
//     na brzeg CDN, więc stan „obserwuję" jednej osoby wyszedłby innym.
//   * `NewsletterForm` woła server function DOPIERO na wysłanie formularza -
//     na pierwszym malowaniu nie robi żadnego odczytu.
// Oba są tu atrapami-markerami, więc pomiar dotyczy zapytań SAMEJ TRASY.
interface FirstPaintMeasurement {
  loaderReads: string[];
  clientReads: string[];
}

type AnyLoader = (ctx: {
  context: { queryClient: QueryClient };
  params: { slug: string };
}) => Promise<unknown>;

function loaderOf(route: typeof ProgramsIndexRoute | typeof ProgramDetailRoute): AnyLoader {
  const loader = route.options.loader;
  if (typeof loader !== "function") throw new Error("test: trasa nie ma loadera");
  return loader as AnyLoader;
}

async function measure(
  route: typeof ProgramsIndexRoute | typeof ProgramDetailRoute,
  mountFn: (queryClient: QueryClient) => Promise<{ queryClient: QueryClient }>,
  slug = SLUG,
): Promise<FirstPaintMeasurement> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await loaderOf(route)({ context: { queryClient }, params: { slug } });
  const loaderReads = [...h.reads];

  const view = await mountFn(queryClient);
  await screen.findByRole("heading", { level: 1 });
  await waitFor(() => expect(view.queryClient.isFetching()).toBe(0));

  return { loaderReads, clientReads: h.reads.slice(loaderReads.length) };
}

describe("trasy programów - zapadka na liczbie zapytań pierwszego malowania", () => {
  it("/programs nie robi ANI JEDNEGO zapytania klienckiego", async () => {
    const { loaderReads, clientReads } = await measure(ProgramsIndexRoute, (qc) => mountIndex(qc));

    expect(loaderReads).toEqual(["research_programs:list"]);
    expect(clientReads, `odczyty klienta: ${clientReads.join(", ")}`).toEqual([]);
  });

  it("/programs/$slug nie robi ANI JEDNEGO zapytania klienckiego", async () => {
    const { loaderReads, clientReads } = await measure(ProgramDetailRoute, (qc) =>
      mountDetail(SLUG, qc),
    );

    // Cały landing to JEDEN klucz cache (`["programs","landing",slug]`), więc
    // pięć odczytów jedzie w jednym `queryFn` - to dlatego zasiew z loadera
    // wystarcza i nic nie dogania strony po hydratacji.
    expect([...loaderReads].sort()).toEqual([
      "research_program_items",
      "research_program_partners",
      "research_program_projects",
      "research_programs:slug",
      "rpc:get_program_members",
    ]);
    expect(clientReads, `odczyty klienta: ${clientReads.join(", ")}`).toEqual([]);
  });
});
