// Trasa PUBLICZNA `/podcast/$slug` - strona odcinka. Do dziś: 0 z 82 linii,
// 0 z 30 funkcji.
//
// CO DOWODZI TEN PLIK.
//
// To najgłębsza strona sieci podcastów i jedyna, na którą wchodzi się wprost
// z social mediów, z czytnika i z wyników wyszukiwania. Render samego
// komponentu mija tę warstwę, w której mieszkają skutki: `notFound()` żyje
// w LOADERZE, `head()` biegnie POZA drzewem Reacta, a liczba zapytań na
// pierwszym malowaniu jest własnością SKLEJENIA loadera z `useQuery`. Dlatego
// wszystko poniżej idzie przez `renderRoute`, czyli przez prawdziwy router.
//
// PIĘĆ REGUŁ, KTÓRYCH ZŁAMANIE KOSZTUJE:
//
//   1. NIEISTNIEJĄCY SLUG TO 404, NIE PUSTA STRONA. Odcinek zbudowany wokół
//      `undefined` wystawiłby crawlerowi HTTP 200 z pustym artykułem, a taki
//      adres zostaje w indeksie jako strona bez treści.
//   2. TREŚĆ JEDNEGO OBSZARU ROBOCZEGO NIE WYCHODZI NA HOŚCIE DRUGIEGO.
//      Autorytetem jest polityka `tenant_id = public_tenant_id()`, więc wiersz
//      obcego tenanta NIE WRACA z odczytu - a trasa musi z tego zrobić 404,
//      nie pustkę i nie cudzy tytuł.
//   3. NAGŁÓWEK NIESIE TYTUŁ I OPIS W OBU JĘZYKACH. To on decyduje, jak ten
//      adres wygląda w wyniku wyszukiwania i w udostępnieniu.
//   4. STAN PUSTY NIE WYWALA TRASY. Odcinek bez rozdziałów, cytatów, osób,
//      notatek i transkrypcji to normalny stan redakcyjny (świeżo wgrane
//      audio), a nie awaria.
//   5. LICZBA ZAPYTAŃ NA PIERWSZYM MALOWANIU JEST ZAPADKĄ (blok N5 na końcu).
//      Każde zapytanie klienckie, którego loader nie zasiał, to round-trip PO
//      hydratacji na publicznej stronie treściowej - pod budżetami platformy
//      (ROOT_WARM_BUDGET_MS 2500, SSR_DB_DEADLINE_MS 8000, limit 6
//      równoległych subrequestów na żądanie na Workers).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - WARSTWY ZAPYTAŃ: `src/lib/queries/podcasts.ts` biegnie tu PRAWDZIWA
//   (atrapowany jest wyłącznie klient PostgREST), więc klucze cache i filtry
//   są tymi z produkcji. Ich własne asercje mieszkają przy tamtym module.
// - ODTWARZACZA: `PodcastPlayer` jest tu atrapą-markerem; jego dostępność
//   (etykiety transportu, aria-live na czasie) ma własny plik
//   `src/components/atoms/__tests__/PodcastPlayer.test.tsx`. Tutaj przedmiotem
//   dowodu jest WYŁĄCZNIE to, co trasa mu podaje i czym steruje (seek
//   z listy rozdziałów).
// - PARYTETU SŁOWNIKA PL/EN: `src/lib/__tests__/i18nPodcasts.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

// Identyfikatory przez `vi.hoisted`, nie przez zwykle `const`: fabryki
// `vi.mock` I bloki `vi.hoisted` sa wciagane NAD importy, wiec `vi.hoisted`
// czytajacy zwykla stala modulu wywala plik na `Cannot access 'TENANT_A'
// before initialization` - i to jest blad calego pliku, nie jednego testu.
const { TENANT_A, TENANT_B, EPISODE_ID, OTHER_EPISODE_ID, SHOW_ID, SLUG } = vi.hoisted(() => ({
  TENANT_A: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  TENANT_B: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  EPISODE_ID: "11111111-1111-4111-8111-111111111111",
  OTHER_EPISODE_ID: "22222222-2222-4222-8222-222222222222",
  SHOW_ID: "33333333-3333-4333-8333-333333333333",
  SLUG: "rozmowa-o-energii",
}));

const h = vi.hoisted(() => ({
  /** Wiersze tabeli `podcasts` ze WSZYSTKICH obszarów roboczych. */
  episodes: [] as Record<string, unknown>[],
  /** Wiersze `podcast_shows` ze wszystkich obszarów. */
  shows: [] as Record<string, unknown>[],
  /** Wiersz `podcast_settings` (linki subskrypcji + wariant odtwarzacza). */
  settings: null as Record<string, unknown> | null,
  /** Wiersze `podcast_episode_people` (prowadzący/goście). */
  people: [] as Record<string, unknown>[],
  /**
   * Tenant PRZEGLĄDANEJ domeny. Atrapa odgrywa tu rolę polityki
   * `tenant_id = public_tenant_id()`: produkcja wysyła nagłówek
   * `x-tenant-host`, a baza odsiewa wiersze. Test modeluje SKUTEK, bo trasa
   * własnego porównania tenantów nie ma i mieć nie powinna.
   */
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  /** Tabele, których odczyt ma paść (blip backendu). */
  broken: new Set<string>(),
  /** Etykiety odczytów w kolejności - PODSTAWA POMIARU zapytań (blok N5). */
  reads: [] as string[],
  /** Adres żądania widziany przez `head()` - decyduje o języku i kanonicznym. */
  requestUrl: "https://nes.example.org/podcast/rozmowa-o-energii",
  /** Wartości nagłówka HTTP `Link` dopisane przez loader (preload okładki). */
  linkHeaders: [] as string[],
  /** Wartości `Cache-Control`, jakie loader ustawił na odpowiedzi. */
  cacheControl: [] as string[],
  /** Propsy, jakie atrapa odtwarzacza dostała od trasy. */
  playerProps: {} as Record<string, unknown>,
  /** Sekundy przekazane do `seek` zarejestrowanego przez odtwarzacz. */
  seeks: [] as number[],
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, ok, fail } = await import("@/test/supabase/chain");
  const stub = supabaseFromStub();

  /** Wszystkie pary `.eq(kolumna, wartość)` łańcucha - `argsOf` daje tylko pierwszą. */
  function filters(calls: ReadonlyArray<{ method: string; args: ReadonlyArray<unknown> }>) {
    const out = new Map<string, unknown>();
    for (const call of calls) {
      if (call.method === "eq" && typeof call.args[0] === "string") {
        out.set(call.args[0], call.args[1]);
      }
    }
    return out;
  }

  /** Odsiew „polityki publicznej": tylko wiersze tenanta przeglądanej domeny. */
  function visible(rows: Record<string, unknown>[]) {
    return rows.filter((row) => row.tenant_id === h.tenantId);
  }

  stub.setResponse("podcasts", (chain) => {
    const eq = filters(chain.calls);
    if (h.broken.has("podcasts")) return fail("test: tabela podcasts niedostepna");
    if (eq.has("slug")) {
      h.reads.push("podcasts:slug");
      const row = visible(h.episodes).find((e) => e.slug === eq.get("slug"));
      return ok(row ?? null);
    }
    h.reads.push("podcasts:show_id");
    return ok(visible(h.episodes).filter((e) => e.show_id === eq.get("show_id")));
  });
  stub.setResponse("podcast_shows", (chain) => {
    h.reads.push("podcast_shows:id");
    if (h.broken.has("podcast_shows")) return fail("test: tabela podcast_shows niedostepna");
    const eq = filters(chain.calls);
    return ok(visible(h.shows).find((s) => s.id === eq.get("id")) ?? null);
  });
  stub.setResponse("podcast_settings", () => {
    h.reads.push("podcast_settings");
    if (h.broken.has("podcast_settings")) return fail("test: tabela podcast_settings niedostepna");
    return ok(h.settings);
  });
  stub.setResponse("podcast_episode_people", (chain) => {
    h.reads.push("podcast_episode_people");
    if (h.broken.has("podcast_episode_people")) return fail("test: tabela people niedostepna");
    const eq = filters(chain.calls);
    return ok(h.people.filter((p) => p.episode_id === eq.get("episode_id")));
  });
  return { supabase: { from: stub.from } };
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
// Odtwarzacz: atrapa-marker + przechwycenie `registerSeek`. Lista rozdziałów
// trasy steruje odtwarzaniem WYŁĄCZNIE przez tę funkcję - gdyby przestała
// dochodzić, rozdziały zamieniłyby się w martwe przyciski i nic w interfejsie
// by tego nie pokazało.
vi.mock("@/components/atoms/PodcastPlayer", () => ({
  PodcastPlayer: (props: Record<string, unknown>) => {
    h.playerProps = props;
    const register = props.registerSeek;
    if (typeof register === "function") {
      register((seconds: number) => void h.seeks.push(seconds));
    }
    return <div data-testid="podcast-player" />;
  },
}));

import "@/test/i18nReal";
import { QueryClient } from "@tanstack/react-query";
import i18n from "@/lib/i18n";
import { renderRoute, routeHead, type RouteHeadResult } from "@/test/routeHarness";
import { axeViolations, summarize } from "@/test/axe";
import { Route as EpisodeRoute } from "@/routes/podcast.$slug";

const PATH = "/podcast/$slug";

// ── fixtures (RODO: wszystkie nazwy, tytuły i osoby są ZMYŚLONE) ────────────

function episode(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: EPISODE_ID,
    tenant_id: TENANT_A,
    slug: SLUG,
    title_pl: "Rozmowa o energii",
    title_en: "A conversation on energy",
    excerpt_pl: "Skąd Europa bierze prąd zimą.",
    excerpt_en: "Where Europe gets power in winter.",
    show_notes_pl: "",
    show_notes_en: "",
    transcript_pl: "",
    transcript_en: "",
    audio_url: "https://audio.example.org/odc-1.mp3",
    duration_seconds: 1830,
    episode_number: 7,
    season: 2,
    cover_image_url: "https://cdn.example.org/okladka.jpg",
    status: "published",
    published_at: "2026-07-01T09:00:00.000Z",
    author_id: null,
    show_id: SHOW_ID,
    category_id: null,
    explicit: false,
    episode_type: "full",
    chapters: [],
    quotes: [],
    resources: [],
    created_at: "2026-06-01T09:00:00.000Z",
    updated_at: "2026-07-01T09:00:00.000Z",
    ...patch,
  };
}

function show(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: SHOW_ID,
    tenant_id: TENANT_A,
    slug: "europa-o-energii",
    title_pl: "Europa o energii",
    title_en: "Europe on energy",
    description_pl: "Cykl o polityce energetycznej.",
    description_en: "A series on energy policy.",
    cover_image_url: null,
    spotify_url: null,
    apple_url: null,
    youtube_url: null,
    sort_order: 1,
    status: "published",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...patch,
  };
}

function personRow(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "person-1",
    episode_id: EPISODE_ID,
    profile_id: null,
    display_name: "Zofia Wiatrak",
    role: "host",
    url: null,
    sort_order: 0,
    profiles: null,
    ...patch,
  };
}

async function mount(slug = SLUG, queryClient?: QueryClient) {
  return renderRoute({
    route: EpisodeRoute,
    path: PATH,
    initialEntry: `/podcast/${slug}`,
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
  h.episodes = [episode()];
  h.shows = [show()];
  h.settings = null;
  h.people = [];
  h.tenantId = TENANT_A;
  h.broken = new Set<string>();
  h.reads = [];
  h.requestUrl = `https://nes.example.org/podcast/${SLUG}`;
  h.linkHeaders = [];
  h.cacheControl = [];
  h.playerProps = {};
  h.seeks = [];
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
  vi.restoreAllMocks();
});

describe("trasa /podcast/$slug - sklejenie i treść odcinka", () => {
  it("czyta slug ze ŚCIEŻKI i pokazuje TEN odcinek, nie pierwszy z tabeli", async () => {
    // Adres jest jedynym wejściem na tę stronę. Slug odczytany z innego miejsca
    // (albo zignorowany) dałby stronę, która pod każdym adresem pokazuje ten
    // sam odcinek - a każdy taki adres jest zaindeksowany osobno.
    h.episodes = [
      episode({ id: OTHER_EPISODE_ID, slug: "inny-odcinek", title_pl: "Inny odcinek" }),
      episode(),
    ];
    const view = await mount("inny-odcinek");

    expect(view.currentPath()).toBe("/podcast/inny-odcinek");
    expect(screen.getByRole("heading", { level: 1, name: "Inny odcinek" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { level: 1, name: "Rozmowa o energii" }),
    ).not.toBeInTheDocument();
  });

  it("prowadzi do strony programu i pokazuje etykietę sezonu i odcinka", async () => {
    // Odcinek bez wyjścia do programu jest ślepą uliczką: czytelnik z social
    // mediów nie ma jak trafić na resztę serii.
    await mount();

    expect(screen.getByRole("link", { name: "Europa o energii" })).toHaveAttribute(
      "href",
      "/podcasts/europa-o-energii",
    );
    expect(screen.getByText("Sezon 2 · Odc. 7")).toBeInTheDocument();
  });

  it("lista rozdziałów przeskakuje odtwarzanie do znacznika czasu", async () => {
    // Rozdziały działają WYŁĄCZNIE przez `registerSeek`. Gdyby ta funkcja
    // przestała dochodzić do odtwarzacza, przyciski dalej by się renderowały
    // i dalej dawały się kliknąć - po prostu nic by nie robiły.
    h.episodes = [
      episode({
        chapters: [
          { start: 0, title_pl: "Wstęp", title_en: "Intro" },
          { start: 615, title_pl: "Ceny mocy", title_en: "Capacity prices" },
        ],
      }),
    ];
    await mount();

    fireEvent.click(screen.getByRole("button", { name: /Ceny mocy/ }));
    expect(h.seeks).toEqual([615]);
  });

  it("odtwarzacz dostaje wariant i sterowanie tempem z ustawień, nie z zera", async () => {
    // `podcast_settings` decyduje o kształcie odtwarzacza NAD ZGIĘCIEM
    // (`sticky` przykleja pasek do dołu ekranu). Zgubienie tych propsów zmienia
    // układ strony po hydratacji.
    h.settings = {
      tenant_id: TENANT_A,
      default_player_variant: "sticky",
      show_speed_control: false,
      spotify_url: "https://open.example.org/nes",
    };
    await mount();

    await waitFor(() => expect(h.playerProps.variant).toBe("sticky"));
    expect(h.playerProps.showSpeed).toBe(false);
    expect(h.playerProps.src).toBe("https://audio.example.org/odc-1.mp3");
    expect(screen.getByRole("link", { name: "Spotify" })).toHaveAttribute(
      "href",
      "https://open.example.org/nes",
    );
  });

  it("pokazuje prowadzących i gości z rolą w języku strony", async () => {
    h.people = [
      personRow(),
      personRow({ id: "person-2", display_name: "Jan Bryza", role: "guest" }),
    ];
    await mount();

    expect(await screen.findByText("Zofia Wiatrak")).toBeInTheDocument();
    expect(screen.getByText("Jan Bryza")).toBeInTheDocument();
    expect(screen.getAllByText("Prowadzący").length).toBeGreaterThan(0);
    expect(screen.getByText("Gość")).toBeInTheDocument();
  });

  it("nie zostawia strony odcinka z wadami dostępności", async () => {
    h.people = [personRow()];
    h.episodes = [
      episode({
        chapters: [{ start: 30, title_pl: "Wstęp", title_en: "Intro" }],
        quotes: [{ text_pl: "Zima jest testem.", text_en: "Winter is a test.", attribution: "" }],
        show_notes_pl: "<p>Notatki.</p>",
        resources: [
          { label_pl: "Raport", label_en: "Report", url: "https://example.org/r", kind: "source" },
        ],
      }),
    ];
    const view = await mount();
    await screen.findByRole("heading", { level: 1, name: "Rozmowa o energii" });

    const violations = await axeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("trasa /podcast/$slug - stan pusty i brak odcinka", () => {
  it("odcinek bez rozdziałów, cytatów, osób i notatek nadal się renderuje", async () => {
    // To normalny stan redakcyjny (świeżo wgrane audio), a nie awaria. Sekcje
    // renderują się warunkowo, więc pusto = brak sekcji, nie pusty nagłówek
    // sekcji i nie wywrotka trasy.
    const view = await mount();

    expect(
      screen.getByRole("heading", { level: 1, name: "Rozmowa o energii" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("podcast-player")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Rozdziały" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Osoby" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Transkrypcja" })).not.toBeInTheDocument();
    expect(view.container.textContent).not.toContain("undefined");
  });

  it("nieistniejący slug kończy się KOMUNIKATEM 404, nie pustym artykułem", async () => {
    // `notFound()` w loaderze jest jedyną rzeczą, która trzyma taki adres poza
    // indeksem. Bez niego crawler dostaje HTTP 200 z artykułem bez treści.
    await mount("nie-ma-takiego-odcinka");

    expect(await screen.findByText("Nie znaleziono odcinka.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByTestId("podcast-player")).not.toBeInTheDocument();
  });

  it("awaria odczytu odcinka daje komunikat ze słownika, nie białą stronę", async () => {
    // Oba wejścia (`errorComponent`, `notFoundComponent`) renderują się jak
    // każdy komponent, więc mówią językiem strony - wcześniej były to jedyne
    // miejsca tej trasy, które mówiły po polsku do WSZYSTKICH.
    h.broken.add("podcasts");
    await mount();

    // `waitFor` + `getByText`, a NIE `expect(await findByText(...))`: rzut
    // z loadera wywołuje jeszcze jedno przejście routera, które PODMIENIA węzeł
    // komunikatu. Referencja zwrócona przez `findByText` bywa wtedy już
    // odczepiona od dokumentu i asercja pada na w pełni poprawnym renderze.
    await waitFor(() =>
      expect(
        screen.getByText("Nie udało się wczytać odcinka. Spróbuj ponownie później."),
      ).toBeInTheDocument(),
    );
  });

  it("po angielsku komunikat 404 też jest angielski", async () => {
    await i18n.changeLanguage("en");
    await mount("nie-ma-takiego-odcinka");

    expect(await screen.findByText("Episode not found.")).toBeInTheDocument();
  });
});

describe("trasa /podcast/$slug - izolacja obszarów roboczych", () => {
  it("odcinek innego obszaru roboczego daje 404, a nie jego tytuł na tym hoście", async () => {
    // Autorytetem jest polityka publiczna (`tenant_id = public_tenant_id()`):
    // wiersz obcego tenanta NIE WRACA z odczytu. Ten test pilnuje SKUTKU -
    // cudza treść nie może pojawić się na tym hoście ani jako tytuł, ani jako
    // pusta strona z HTTP 200.
    h.episodes = [episode({ tenant_id: TENANT_B, title_pl: "Odcinek obcego obszaru" })];
    await mount();

    expect(await screen.findByText("Nie znaleziono odcinka.")).toBeInTheDocument();
    expect(screen.queryByText("Odcinek obcego obszaru")).not.toBeInTheDocument();
  });

  it("KONTROLA DODATNIA: ten sam slug na własnym hoście renderuje się normalnie", async () => {
    // Bez tej pary poprzedni test przechodziłby też wtedy, gdyby trasa nie
    // renderowała NICZEGO - a to nie jest izolacja, tylko awaria.
    h.episodes = [episode({ tenant_id: TENANT_B, title_pl: "Odcinek obcego obszaru" })];
    h.tenantId = TENANT_B;
    await mount();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Odcinek obcego obszaru" }),
    ).toBeInTheDocument();
  });

  it("program obcego obszaru nie dokleja się do odcinka jako nagłówek serii", async () => {
    // Odcinek niesie `show_id`, nie slug programu - gdyby odczyt programu
    // wypadł z polityki publicznej, na stronie odcinka pojawiłaby się nazwa
    // cudzego programu z linkiem do cudzej strony.
    h.shows = [show({ tenant_id: TENANT_B, title_pl: "Program obcego obszaru" })];
    await mount();

    await screen.findByRole("heading", { level: 1, name: "Rozmowa o energii" });
    expect(screen.queryByText("Program obcego obszaru")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Program obcego/ })).not.toBeInTheDocument();
  });
});

describe("trasa /podcast/$slug - nagłówek dokumentu", () => {
  it("tytuł i opis biorą się Z ODCINKA i niosą sufiks programu", async () => {
    const head = routeHead(EpisodeRoute, { loaderData: { podcast: episode() } });

    expect(headTitle(head)).toBe("Rozmowa o energii · Podcast");
    expect(metaContent(head, "property", "og:title")).toBe("Rozmowa o energii");
    expect(metaContent(head, "name", "description")).toBe("Skąd Europa bierze prąd zimą.");
    expect(metaContent(head, "property", "og:type")).toBe("article");
  });

  it("na adresie /en opis i tytuł kanału RSS są angielskie", async () => {
    // `head()` biegnie POZA drzewem Reacta (SSR składa metadane przed
    // hydracją), więc o języku rozstrzyga wyłącznie prefiks adresu.
    h.requestUrl = `https://nes.example.org/en/podcast/${SLUG}`;
    const head = routeHead(EpisodeRoute, { loaderData: { podcast: episode() } });

    expect(metaContent(head, "httpEquiv", "content-language")).toBe("en");
    const feed = (head.links ?? []).find((link) => link.type === "application/rss+xml");
    expect(feed?.title).toBe("NES Podcast - RSS");
  });

  it("na adresie bez prefiksu tytuł kanału RSS jest polski", async () => {
    const head = routeHead(EpisodeRoute, { loaderData: { podcast: episode() } });

    expect(metaContent(head, "httpEquiv", "content-language")).toBe("pl");
    const feed = (head.links ?? []).find((link) => link.type === "application/rss+xml");
    expect(feed?.title).toBe("Podcast NES - RSS");
  });

  it("odcinek bez zajawki dostaje opis marki, nie pusty <meta description>", async () => {
    // Pusty `content` w wyniku wyszukiwania to wynik bez zajawki, a zajawka
    // decyduje o kliknięciu. Fallback jest lepszy niż brak i niż pustka.
    const head = routeHead(EpisodeRoute, {
      loaderData: { podcast: episode({ excerpt_pl: "", excerpt_en: "" }) },
    });

    expect(metaContent(head, "name", "description").length).toBeGreaterThan(20);
  });

  it("JSON-LD opisuje ODCINEK: numer, data i adres pliku audio", async () => {
    const head = routeHead(EpisodeRoute, { loaderData: { podcast: episode() } });
    const jsonLd = (head.scripts ?? []).find((s) => s.type === "application/ld+json");
    const parsed: unknown = JSON.parse(jsonLd?.children ?? "null");

    expect(parsed).toMatchObject({
      "@type": "PodcastEpisode",
      name: "Rozmowa o energii",
      episodeNumber: 7,
      datePublished: "2026-07-01T09:00:00.000Z",
      associatedMedia: { contentUrl: "https://audio.example.org/odc-1.mp3" },
    });
    // Opis marki NIE należy do JSON-LD odcinka - tam wolno wyłącznie realną
    // zajawkę, inaczej każdy odcinek serwisu opisuje się tym samym zdaniem.
    const withoutExcerpt = routeHead(EpisodeRoute, {
      loaderData: { podcast: episode({ excerpt_pl: "", excerpt_en: "" }) },
    });
    const bare: unknown = JSON.parse(
      (withoutExcerpt.scripts ?? []).find((s) => s.type === "application/ld+json")?.children ??
        "null",
    );
    expect(bare).not.toHaveProperty("description");
  });

  it("bez danych loadera nagłówek nie zostawia w indeksie pustego tytułu", async () => {
    // `head()` bywa wołane bez ładunku (przerwana nawigacja, 404).
    const head = routeHead(EpisodeRoute, {});

    expect(headTitle(head)).toBe("Podcast");
  });

  it("loader dopisuje nagłówek HTTP Link z preloadem okładki (LCP)", async () => {
    // Preload rusza z <head>, zanim parser dojdzie do <img> - i musi wskazywać
    // TEN SAM wariant, który strona maluje, inaczej przeglądarka pobiera dwa.
    await mount();

    // ZMIERZONE, nie zgadnięte: `imagePreloadLinkHeaderValue` składa parametry
    // RFC 8288 z wartościami W CUDZYSŁOWACH (`as="image"`), więc asercja na
    // `as=image` przechodziłaby tylko przez przypadek - i nie przechodziła.
    expect(h.linkHeaders.some((value) => value.includes('as="image"'))).toBe(true);
    expect(h.linkHeaders.some((value) => value.includes('rel="preload"'))).toBe(true);
  });
});

// ── N5: LICZBA ZAPYTAŃ NA PIERWSZYM MALOWANIU ───────────────────────────────
//
// POMIAR, NIE OPINIA. `measureFirstPaint` rozdziela dwie fale tego samego
// wczytania:
//   * FALA LOADERA - odczyty, które robi serwer, zanim poleci HTML;
//   * FALA KLIENTA - odczyty, które startują na MONTAŻU, czyli round-tripy PO
//     hydratacji, każdy z pełnym opóźnieniem sieci czytelnika.
// Rozdzielenie działa, bo loader zasiewa cache zapytań, a ten jedzie do
// przeglądarki w dehydrowanym ładunku SSR (`router.options.dehydrate`), więc
// świeży wpis nie jest ponawiany na montażu.
//
// ZMIERZONE PRZED ZMIANĄ: loader 1 odczyt (odcinek), klient 4 odczyty
// (`podcast_settings`, `podcast_shows`, `podcast_episode_people`,
// `podcasts` po `show_id`). Cztery round-tripy po hydratacji na stronie
// treściowej, z czego trzy zasilają treść NAD ZGIĘCIEM (nazwa programu
// w nadtytule, wariant odtwarzacza, prowadzący i goście).
//
// ZMIERZONE PO ZMIANIE: loader 4 odczyty, klient 1 odczyt.
//
// CO ZOSTAJE KLIENCKIE I DLACZEGO - ODRZUCENIE Z UZASADNIENIEM.
// `showEpisodesQueryOptions` (rekomendacje „więcej z tego programu") ZOSTAJE
// po stronie klienta. To jedyne zapytanie tej trasy, które ciągnie do 500
// wierszy PEŁNEGO `PODCAST_FIELDS` - razem z `transcript_pl`/`transcript_en`
// i notatkami - żeby zbudować CZTERY kafelki pod całą treścią. Przeniesienie
// go do loadera wymieniłoby jeden round-trip po hydratacji na setki kilobajtów
// w dehydrowanym ładunku SSR, na ścieżce krytycznej KAŻDEGO czytelnika, w tym
// tych, którzy do rekomendacji nigdy nie doscrollują. Zapadka stoi więc na
// dzisiejszej liczbie tego jednego zapytania, a nie na zerze.
//
// STAN ODTWARZANIA (pozycja, tempo) nie jest tu zapytaniem - żyje
// w `localStorage` odtwarzacza, więc z definicji jest kliencki. Ta trasa nie
// ma treści za bramką subskrybenta: cały odcinek jest publiczny.

/** Wynik pomiaru pierwszego wczytania: odczyty serwera kontra odczyty klienta. */
interface FirstPaintMeasurement {
  loaderReads: string[];
  clientReads: string[];
}

/**
 * Loader trasy jako funkcja - `renderRoute` woła go sam, ale wtedy nie da się
 * ODCZYTAĆ granicy między falami. Tutaj wołamy go wprost na tym samym kliencie
 * zapytań, który potem dostaje `renderRoute`: drugi bieg loadera trafia już na
 * ciepły, świeży cache, więc nie dolicza odczytów do fali klienta.
 */
type EpisodeLoader = (ctx: {
  context: { queryClient: QueryClient };
  params: { slug: string };
}) => Promise<unknown>;

function episodeLoader(): EpisodeLoader {
  const loader = EpisodeRoute.options.loader;
  if (typeof loader !== "function") throw new Error("test: trasa nie ma loadera");
  return loader as EpisodeLoader;
}

async function measureFirstPaint(slug = SLUG): Promise<FirstPaintMeasurement> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await episodeLoader()({ context: { queryClient }, params: { slug } });
  const loaderReads = [...h.reads];

  const view = await mount(slug, queryClient);
  await screen.findByRole("heading", { level: 1 });
  // Zapytania kliencka startują w efektach montażu - czekamy, aż cache
  // przestanie się zmieniać, inaczej pomiar liczyłby mniej, niż strona robi.
  await waitFor(() => expect(view.queryClient.isFetching()).toBe(0));

  return { loaderReads, clientReads: h.reads.slice(loaderReads.length) };
}

describe("trasa /podcast/$slug - zapadka na liczbie zapytań pierwszego malowania", () => {
  it("nie robi WIĘCEJ NIŻ JEDNO zapytanie klienckie na pierwszym malowaniu", async () => {
    // ZAPADKA. Każdy odczyt w tej fali to round-trip po hydratacji z pełnym
    // opóźnieniem sieci czytelnika. Dopisanie tu drugiego `useQuery` bez
    // zasiewu w loaderze ma wywalić ten test, a nie przejść niezauważone.
    h.people = [personRow()];
    h.settings = { tenant_id: TENANT_A, default_player_variant: "full" };
    const { clientReads } = await measureFirstPaint();

    expect(clientReads.length, `odczyty klienta: ${clientReads.join(", ")}`).toBeLessThanOrEqual(1);
  });

  it("loader zasiewa program, ustawienia i osoby - to treść nad zgięciem", async () => {
    // Bez zasiewu nadtytuł z nazwą programu, wariant odtwarzacza i lista
    // prowadzących dojeżdżają PO hydratacji: crawler ich nie widzi, a czytelnik
    // widzi przeskok układu.
    h.people = [personRow()];
    h.settings = { tenant_id: TENANT_A, default_player_variant: "full" };
    const { loaderReads } = await measureFirstPaint();

    expect(loaderReads).toContain("podcasts:slug");
    expect(loaderReads).toContain("podcast_shows:id");
    expect(loaderReads).toContain("podcast_settings");
    expect(loaderReads).toContain("podcast_episode_people");
  });

  it("rekomendacje zostają klienckie - to jedyny dopuszczony round-trip", async () => {
    // Odrzucenie z uzasadnieniem (patrz komentarz nad tym blokiem): 500 pełnych
    // wierszy z transkrypcjami dla czterech kafelków pod całą treścią.
    h.settings = { tenant_id: TENANT_A, default_player_variant: "full" };
    const { loaderReads, clientReads } = await measureFirstPaint();

    expect(loaderReads).not.toContain("podcasts:show_id");
    expect(clientReads).toEqual(["podcasts:show_id"]);
  });

  it("blip na zapytaniu wtórnym ZDEJMUJE render ze wspólnego cache'a", async () => {
    // Warunek drugi przeniesienia: odcinek bez nazwy programu i bez
    // prowadzących nie może utrwalić się na brzegu CDN, bo brzeg serwowałby tę
    // okaleczoną stronę kolejnym czytelnikom przez cały okres świeżości.
    h.broken.add("podcast_shows");
    await mount();

    expect(h.cacheControl.at(-1)).toContain("no-store");
  });

  it("KONTROLA DODATNIA: czysty render NIE dopisuje własnego Cache-Control", async () => {
    // Bez tej pary poprzedni test przechodziłby też wtedy, gdyby trasa
    // deklarowała `no-store` ZAWSZE - a to skasowałoby cache brzegowy całej
    // sieci podcastów, nie tylko renderu zdegradowanego.
    h.settings = { tenant_id: TENANT_A, default_player_variant: "full" };
    await mount();

    expect(h.cacheControl).toEqual([]);
  });

  it("blip na zapytaniu wtórnym NIE zamienia strony odcinka w ekran błędu", async () => {
    // To warunek konieczny przeniesienia zapytań do loadera: gołe
    // `ensureQueryData` na czterech odczytach zamieniłoby awarię ustawień
    // odtwarzacza w HTTP 500 na działającym odcinku.
    h.broken.add("podcast_settings");
    h.broken.add("podcast_episode_people");
    await mount();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Rozmowa o energii" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("podcast-player")).toBeInTheDocument();
  });
});
