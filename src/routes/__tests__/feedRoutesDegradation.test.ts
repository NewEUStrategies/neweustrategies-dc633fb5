// CO DOWODZI TEN PLIK
//
// Trasy feedów i sitemap zachowują się poprawnie, gdy WARSTWA DANYCH ZAWODZI -
// czyli w jedynym stanie, którego suita e2e nie umie wytworzyć, bo jedzie na
// zdrowym środowisku. Trzy rzeczy o wysokiej konsekwencji:
//
//   1. AWARIA CZYTNIKA nie może wyemitować UCIĘTEGO, NIEPOPRAWNEGO XML-a.
//      To jest tu jedyna rzecz naprawdę kosztowna: robot, który dostanie
//      dokument z niezamkniętym korzeniem, odrzuca CAŁY plik, a nie jeden
//      wpis - znika wtedy cała sitemapa / cały kanał, nie brakujący artykuł.
//      Kontrakt: albo poprawny dokument (choćby z pustym zbiorem), albo status
//      błędu. Nigdy trzecia opcja.
//   2. NAGŁÓWKI odpowiedzi ZDEGRADOWANEJ: `content-type` i `cache-control`.
//      Feed z pustym zbiorem nie może dostać długiego TTL, bo utrwala awarię
//      na brzegu CDN - crawler wraca po godzinach do zapamiętanej pustki.
//   3. KONTRAKT SHARDÓW `sitemaps.$section.ts`: sekcja nieznana, sekcja pusta
//      i shard POZA zakresem paginacji. Te same reguły, które e2e sprawdza na
//      żywym środowisku - tutaj padają szybciej i bez bazy.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE
//
// Ten plik NIE goni procentu na trasach feedów i NIE powtarza ŻADNEGO z 15
// testów `e2e/seo.spec.ts`. Ścieżkę ZDROWĄ każdej z tych powierzchni dowodzi
// e2e bajtami z SSR i to tam należy jej szukać:
//
//   * kształt indeksu i obecność shardów  -> "sitemap.xml is a sitemapindex
//     pointing at shard files" oraz "every sitemap listed in the index resolves
//     to a urlset";
//   * 404 nieznanego shardu na żywym środowisku -> "an unknown sitemap shard is
//     a 404, not an empty urlset" (tu przypinamy tę samą regułę jednostkowo,
//     żeby padała szybciej, nie żeby ją powtórzyć na tym samym poziomie);
//   * alias indeksu -> "sitemap-index.xml redirects to the canonical index";
//   * `llms.txt` jako `text/plain` z sekcjami -> "llms.txt is text/plain and
//     lists sections";
//   * poprawnie sformowany kanał -> "rss.xml returns a well-formed feed";
//   * pochodzenie `robots.txt` Z TRASY, nie z pliku statycznego, i polityka
//     zależna od hosta -> trzy testy: "robots.txt comes from the ROUTE, not a
//     static file in public/", "robots.txt exposes crawl policy", "robots.txt
//     is served by the route, not by a static asset". `robots.txt` NIE jest
//     więc tutaj testowany wcale: cała jego logika mieszka w
//     `robotsRequest.server.ts` i `lib/seo/robots.ts` (jedno wiązanie żądania
//     z odpowiedzią w pliku trasy), a jego regresja wdrożeniowa jest właśnie
//     tym, co e2e pilnuje nagłówkiem `X-Robots-Tag`, którego atrapa nie umie
//     podrobić w sposób dowodzący czegokolwiek;
//   * feedy treści dla trackera i relacji -> "content feeds respond for the
//     tracker and live coverage";
//   * odnajdywalność kanału podcastu -> "podcast feed is auto-discoverable
//     from the podcast pages".
//
// Nie dubluje też testów jednostkowych czystych generatorów
// (`sitemapXml.test.ts`, `sitemapIndex.test.ts`, `rss.test.ts`,
// `newsSitemap.test.ts`, `llms.test.ts`) - one dowodzą, jak dokument jest
// SKŁADANY z poprawnego wejścia; ten plik dowodzi, co trasa robi, gdy wejścia
// NIE MA.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routeServerHandlers } from "@/test/routeHarness";
import { pgError } from "@/test/supabaseChain";

// ---------------------------------------------------------------------------
// Atrapy warstwy serwerowej. Stan przez `vi.hoisted()`, bo fabryki `vi.mock`
// są hoistowane nad importy i nie widzą zmiennych z góry pliku.
//
// `publishedContent.server.ts` i `sitemapEntries.server.ts` są tu WYŁĄCZNIE
// mockowane - to czytniki service-role należące do równoległego zadania
// modułu 20 i żaden test w tym pliku ich nie edytuje.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Kształty wierszy, jakie atrapa czytnika oddaje trasom modułu 07.
//
// Świadomie zawężone do PÓL, KTÓRE TRASA CZYTA - nie do pełnych interfejsów
// z `publishedContent.server.ts`. Test opisuje WEJŚCIE, którego dotyczy dowód;
// przepisanie tam całego wiersza bazy dołożyłoby dziesiątki pól, których żadna
// asercja w tym pliku nie dotyka, i przy każdej migracji trzeba by je ścigać.
// ---------------------------------------------------------------------------

/** Odcinek podcastu w kształcie, w jakim czyta go kanał RSS. */
interface PodcastRowStub {
  slug: string;
  title_pl: string;
  title_en: string;
  excerpt_pl: string | null;
  excerpt_en: string | null;
  audio_url: string;
  duration_seconds: number;
  season: number | null;
  episode_number: number | null;
  cover_image_url: string | null;
  published_at: string | null;
  show_id: string | null;
  explicit: boolean;
  episode_type: string;
}

type PodcastChannelMetaStub = {
  itunes_author: string | null;
  itunes_owner_name: string | null;
  itunes_owner_email: string | null;
  itunes_category: string | null;
  itunes_subcategory: string | null;
  itunes_explicit: boolean;
  itunes_type: string | null;
  itunes_image_url: string | null;
  itunes_copyright: string | null;
} | null;

type PodcastShowStub = {
  id: string;
  slug: string;
  title_pl: string;
  title_en: string;
  description_pl: string;
  description_en: string;
  cover_image_url: string | null;
  itunes_author: string | null;
  itunes_owner_name: string | null;
  itunes_owner_email: string | null;
  itunes_category: string | null;
  itunes_subcategory: string | null;
  itunes_explicit: boolean | null;
  itunes_type: string | null;
  itunes_complete: boolean;
} | null;

type WebStoryStub = {
  slug: string;
  title_pl: string;
  title_en: string;
  description_pl: string;
  description_en: string;
  cover_url: string | null;
  pages: unknown;
  published_at: string | null;
  updated_at: string | null;
} | null;

interface LiveEntryStub {
  id: string;
  postPath: string;
  postTitlePl: string;
  postTitleEn: string;
  title: string | null;
  bodyHtml: string;
  lang: string;
  occurredAt: string;
}

interface TrackerSourcesStub {
  items: Array<{
    id: string;
    slug: string;
    title_pl: string;
    title_en: string;
    summary_pl: string | null;
    summary_en: string | null;
    policy_area: string;
    stage: string;
    created_at: string;
    updated_at: string;
  }>;
  updates: Array<{
    id: string;
    item_id: string;
    note_pl: string;
    note_en: string;
    stage_from: string | null;
    stage_to: string | null;
    happened_on: string;
    created_at: string;
  }>;
}

type TaxonomyStub = {
  slug: string;
  name_pl: string;
  name_en: string;
  description_pl: string | null;
  description_en: string | null;
} | null;

interface FeedPostStub {
  slug: string;
  path: string;
  title_pl: string;
  title_en: string;
  excerpt_pl: string | null;
  excerpt_en: string | null;
  published_at: string | null;
  cover_image_url: string | null;
}

const state = vi.hoisted(() => ({
  /** Host zwracany przez `trustedPublicHost` (null = brak zaufanego hosta). */
  host: "neweuropeanstrategies.com" as string | null,
  /** Adres żądania - prefiks `/en/` przestawia kanał na angielski. */
  requestUrl: "https://neweuropeanstrategies.com/" as string,
  /** Nagłówki żądania - `x-forwarded-proto` decyduje o schemacie w adresach. */
  requestHeaders: { host: "neweuropeanstrategies.com" } as Record<string, string>,
  /** Tenant hosta (null = nieznany host). */
  tenantId: "t-1" as string | null,
  /** Czy degradacja jest bezpieczna (host podglądowy / pusty katalog domen). */
  degradeSafe: false,
  /** Ustawienia SEO oddawane przez czytnik (null = domyślne). */
  settings: null as unknown,
  /** Sposób, w jaki czytnik wpisów zawodzi - albo dane, gdy nie zawodzi. */
  postsFailure: null as "throw" | "pgError" | null,
  /**
   * Wpisy kanału sieciowego. DOMYŚLNIE PUSTE, bo cały ten plik dowodzi
   * zachowania trasy przy BRAKU danych; test, który potrzebuje kanału
   * PEŁNEGO (kontrola dodatnia nagłówka cache), ustawia to pole sam.
   */
  posts: [] as FeedPostStub[],
  /** Sposób awarii czytnika kategorii (llms.txt). */
  categoriesFailure: null as "throw" | null,
  /** Sposób awarii kolektora sekcji sitemapy. */
  sectionsFailure: null as "throw" | "pgError" | null,
  /** Wpisy sekcji sitemapy zwracane, gdy kolektor nie zawodzi. */
  sectionEntries: [] as Array<{ loc: string; lastmod?: string }>,

  // -------------------------------------------------------------------------
  // MODUŁ 07 - sześć powierzchni crawlera treści specjalnych.
  //
  // UWAGA NA WIERNOŚĆ ATRAPY. Czytniki w `publishedContent.server.ts` są
  // owinięte w `resilient(...)`, który ŁAPIE wyjątek i oddaje wartość
  // zapasową (`[]` / `null`). W produkcji awaria bazy NIE dochodzi więc do
  // trasy jako odrzucenie - dochodzi jako PUSTKA. Dlatego stan poniżej ma
  // DWA różne pokrętła i oba są potrzebne:
  //   * pusta lista / null = awaria taka, jaka NAPRAWDĘ dociera do trasy;
  //   * `*Failure` = awaria hipotetyczna, „gdyby ktoś zdjął `resilient`" -
  //     tu przedmiotem dowodu jest tylko to, że trasa NIE emituje uciętego
  //     dokumentu, bo odrzucenie zamienia się w 500.
  // -------------------------------------------------------------------------

  /** Odcinki kanału sieciowego podcastu. */
  podcasts: [] as PodcastRowStub[],
  /** Metadane kanału Apple (null = same domyślne marki). */
  podcastChannelMeta: null as PodcastChannelMetaStub,
  /** Program znaleziony po slugu (null = nieznany program). */
  show: null as PodcastShowStub,
  /** Odcinki programu. */
  showEpisodes: [] as PodcastRowStub[],
  /** Web story znaleziona po slugu (null = brak). */
  webStory: null as WebStoryStub,
  /** Wpisy relacji na żywo. */
  liveEntries: [] as LiveEntryStub[],
  /** Źródła kanału trackera. */
  trackerSources: { items: [], updates: [] } as TrackerSourcesStub,
  /** Taksonomia kanału programu (null = nieznany program). */
  taxonomy: null as TaxonomyStub,
  /** Wpisy kanału taksonomii. */
  taxonomyPosts: [] as FeedPostStub[],
  /**
   * Rozmiar i MIME plików audio z biblioteki mediów. PUSTA MAPA = odcinek na
   * URL-u zewnętrznym (kanał emituje wtedy `length="0"` i MIME z rozszerzenia).
   */
  mediaMeta: new Map<string, { sizeBytes: number | null; mimeType: string | null }>(),
  /** Awaria hipotetyczna czytnika podcastów (patrz uwaga o `resilient`). */
  podcastsFailure: null as "throw" | "pgError" | null,
  /** Awaria hipotetyczna czytnika wpisów relacji. */
  liveFailure: null as "throw" | "pgError" | null,
  /** Awaria hipotetyczna czytnika źródeł trackera. */
  trackerFailure: null as "throw" | "pgError" | null,
  /** Awaria hipotetyczna czytnika web stories. */
  webStoryFailure: null as "throw" | "pgError" | null,
}));

/**
 * Rzuca w sposób, jaki wybrał test - albo oddaje wartość zapasową.
 *
 * `table` wchodzi do komunikatu PostgREST, bo asercja w
 * `expectRejectsWithInjectedFailure` jest na KONKRETNYM błędzie: test, który
 * przyjmuje „cokolwiek rzuciło", przechodziłby też wtedy, gdyby wywalił się
 * sam mock albo import trasy, czyli „dowodziłby" degradacji, której nie ma.
 */
function failOrEmpty<T>(mode: "throw" | "pgError" | null, empty: T, table = "posts"): T {
  if (mode === "throw") throw new Error("czytnik niedostępny");
  if (mode === "pgError") throw pgError(`permission denied for table ${table}`, "42501");
  return empty;
}

vi.mock("@tanstack/react-start/server", () => ({
  // Adres i nagłówki żądania są STEROWANE STANEM, bo język kanału bierze się
  // z prefiksu ścieżki (`stripLangPrefix`), a schemat z `x-forwarded-proto`.
  // Przy stałym adresie gałąź EN każdego kanału jest nieosiągalna - a kanał
  // EN to połowa kontraktu dwujęzycznego serwisu, nie wariant ozdobny.
  getRequest: () => new Request(state.requestUrl, { headers: state.requestHeaders }),
}));

vi.mock("@/lib/http/requestHost", () => ({
  trustedPublicHost: () => Promise.resolve(state.host),
}));

vi.mock("@/lib/server/tenant.server", () => ({
  resolveCrawlerTenantIdForHost: () => Promise.resolve(state.tenantId),
  crawlerDegradeIsSafe: () => Promise.resolve(state.degradeSafe),
  resolveTenantForHost: () => Promise.resolve(state.tenantId ? { id: state.tenantId } : null),
}));

vi.mock("@/lib/server/publishedContent.server", () => ({
  fetchSeoSettingsValue: () => Promise.resolve(state.settings),
  fetchPublishedPosts: () => Promise.resolve(failOrEmpty(state.postsFailure, state.posts)),
  fetchPublicCategories: () =>
    Promise.resolve(state.categoriesFailure === "throw" ? failOrEmpty("throw", []) : []),
  fetchPublishedPostsByTaxonomy: () =>
    Promise.resolve(failOrEmpty(state.postsFailure, state.taxonomyPosts)),
  fetchTaxonomyForFeed: () => Promise.resolve(state.taxonomy),
  // --- moduł 07: czytniki treści specjalnych -------------------------------
  fetchPublishedPodcasts: () =>
    Promise.resolve(failOrEmpty(state.podcastsFailure, state.podcasts, "podcasts")),
  fetchPodcastChannelMeta: () =>
    Promise.resolve(
      failOrEmpty(state.podcastsFailure, state.podcastChannelMeta, "podcast_settings"),
    ),
  fetchPublishedShowBySlug: () =>
    Promise.resolve(failOrEmpty(state.podcastsFailure, state.show, "podcast_shows")),
  fetchPublishedPodcastsByShow: () =>
    Promise.resolve(failOrEmpty(state.podcastsFailure, state.showEpisodes, "podcasts")),
  fetchMediaMetaByUrls: () => Promise.resolve(failOrEmpty(state.podcastsFailure, state.mediaMeta)),
  fetchPublishedWebStoryBySlug: () =>
    Promise.resolve(failOrEmpty(state.webStoryFailure, state.webStory, "web_stories")),
  fetchLiveCoverageEntries: () =>
    Promise.resolve(failOrEmpty(state.liveFailure, state.liveEntries, "live_blog_entries")),
  fetchTrackerFeedSources: () =>
    Promise.resolve(failOrEmpty(state.trackerFailure, state.trackerSources, "tracker_items")),
}));

vi.mock("@/lib/server/sitemapEntries.server", () => ({
  collectAllSitemapSections: () =>
    Promise.resolve(failOrEmpty(state.sectionsFailure, new Map<string, unknown[]>())),
  collectSitemapSection: () =>
    Promise.resolve(failOrEmpty(state.sectionsFailure, state.sectionEntries)),
  coreSitemapEntries: (origin: string) => [{ loc: `${origin}/` }],
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: () => ({ select: () => ({}) }) },
}));

// Indeks przekierowań nie jest przedmiotem dowodu w tym pliku (ma własny
// `redirectsServerRequest.test.ts`); degradujemy go do braku kanonizacji.
vi.mock("@/lib/seo/redirects.server", () => ({
  getRedirectIndexForTenant: () => Promise.resolve(null),
}));

// ---------------------------------------------------------------------------
// Fabryki atrap dla modułu 07.
//
// RODO: wszystkie nazwy audycji, programów i adresy e-mail są ZMYŚLONE, a
// domeny należą do zarezerwowanej przestrzeni `example.org` - żaden fixture
// w tym pliku nie może dać się użyć jako realny kontakt.
// ---------------------------------------------------------------------------

/** Odcinek podcastu z audio - domyślnie WAŻNA pozycja kanału. */
function podcastRow(overrides: Partial<PodcastRowStub> = {}): PodcastRowStub {
  return {
    slug: "rozmowy-o-europie-01",
    title_pl: "Rozmowy o Europie, odcinek pierwszy",
    title_en: "Talking Europe, episode one",
    excerpt_pl: "O czym rozmawiamy w tym sezonie.",
    excerpt_en: "What this season is about.",
    audio_url: "https://media.example.org/rozmowy-01.mp3",
    duration_seconds: 1800,
    season: 1,
    episode_number: 1,
    cover_image_url: "https://media.example.org/okladka.jpg",
    published_at: "2026-01-15T09:00:00Z",
    show_id: "show-1",
    explicit: false,
    episode_type: "full",
    ...overrides,
  };
}

function channelMeta(): PodcastChannelMetaStub {
  return {
    itunes_author: "Redakcja testowa",
    itunes_owner_name: "Redakcja testowa",
    itunes_owner_email: "redakcja@example.org",
    itunes_category: "News",
    itunes_subcategory: "Politics",
    itunes_explicit: false,
    itunes_type: "episodic",
    itunes_image_url: "https://media.example.org/kanal.jpg",
    itunes_copyright: "© 2026 Redakcja testowa",
  };
}

function podcastShow(): PodcastShowStub {
  return {
    id: "show-1",
    slug: "rozmowy-o-europie",
    title_pl: "Rozmowy o Europie",
    title_en: "Talking Europe",
    description_pl: "Cykl rozmów o polityce europejskiej.",
    description_en: "A series of conversations on European policy.",
    cover_image_url: "https://media.example.org/okladka-programu.jpg",
    itunes_author: null,
    itunes_owner_name: null,
    itunes_owner_email: null,
    itunes_category: null,
    itunes_subcategory: null,
    itunes_explicit: null,
    itunes_type: null,
    itunes_complete: false,
  };
}

/**
 * Web story z JEDNĄ stroną obrazkową i okładką - minimalne wejście, które
 * `canBuildAmpStory` uznaje za wystarczające do wyemitowania WAŻNEGO AMP.
 */
function webStory(): WebStoryStub {
  return {
    slug: "europa-w-piatke-obrazkow",
    title_pl: "Europa w pięciu obrazkach",
    title_en: "Europe in five pictures",
    description_pl: "Krótka opowieść wizualna.",
    description_en: "A short visual story.",
    cover_url: "https://media.example.org/story-cover.jpg",
    pages: [
      {
        id: "p_1",
        background: "image",
        media_url: "https://media.example.org/story-1.jpg",
        poster_url: "",
        color: "#141414",
        title_pl: "Pierwsza plansza",
        title_en: "First panel",
        caption_pl: "Podpis planszy.",
        caption_en: "Panel caption.",
        cta_label_pl: "",
        cta_label_en: "",
        cta_href: "",
        text_position: "bottom",
        text_align: "left",
        duration_seconds: 6,
      },
    ],
    published_at: "2026-01-20T10:00:00Z",
    updated_at: "2026-01-21T10:00:00Z",
  };
}

function liveEntry(overrides: Partial<LiveEntryStub> = {}): LiveEntryStub {
  return {
    id: "entry-1",
    postPath: "/relacje/szczyt-europejski",
    postTitlePl: "Szczyt europejski, relacja",
    postTitleEn: "European summit, live",
    title: null,
    bodyHtml: "<p>Pierwszy wpis relacji.</p>",
    lang: "pl",
    occurredAt: "2026-02-03T09:00:00Z",
    ...overrides,
  };
}

function trackerSources(): TrackerSourcesStub {
  return {
    items: [
      {
        id: "item-1",
        slug: "akt-o-uslugach-cyfrowych",
        title_pl: "Akt o usługach cyfrowych",
        title_en: "Digital Services Act",
        summary_pl: "Streszczenie dossier.",
        summary_en: "Dossier summary.",
        policy_area: "digital",
        stage: "trilogue",
        created_at: "2026-01-02T10:00:00Z",
        updated_at: "2026-02-01T10:00:00Z",
      },
    ],
    updates: [
      {
        id: "update-1",
        item_id: "item-1",
        note_pl: "Rada przyjęła stanowisko.",
        note_en: "The Council adopted its position.",
        stage_from: "committee",
        stage_to: "trilogue",
        happened_on: "2026-02-01",
        created_at: "2026-02-01T11:00:00Z",
      },
    ],
  };
}

function taxonomy(): TaxonomyStub {
  return {
    slug: "polityka-cyfrowa",
    name_pl: "Polityka cyfrowa",
    name_en: "Digital policy",
    description_pl: "Program badawczy.",
    description_en: "Research program.",
  };
}

function feedPost(overrides: Partial<FeedPostStub> = {}): FeedPostStub {
  return {
    slug: "pierwsza-analiza",
    path: "/analizy/pierwsza-analiza",
    title_pl: "Pierwsza analiza",
    title_en: "First analysis",
    excerpt_pl: "Streszczenie analizy.",
    excerpt_en: "Analysis summary.",
    published_at: "2026-01-10T08:00:00Z",
    cover_image_url: null,
    ...overrides,
  };
}

const HEALTHY = {
  host: "neweuropeanstrategies.com",
  requestUrl: "https://neweuropeanstrategies.com/",
  requestHeaders: { host: "neweuropeanstrategies.com" } as Record<string, string>,
  tenantId: "t-1" as string | null,
  degradeSafe: false,
  settings: null as unknown,
  postsFailure: null,
  posts: [] as FeedPostStub[],
  categoriesFailure: null,
  sectionsFailure: null,
  sectionEntries: [] as Array<{ loc: string; lastmod?: string }>,
  // Moduł 07 startuje ZDROWO: kanały mają treść, programy się rozwiązują.
  // Test, który chce stanu awaryjnego, zeruje POJEDYNCZE pole - dzięki temu
  // z opisu testu widać, KTÓRA warstwa zawiodła.
  podcasts: [podcastRow()] as PodcastRowStub[],
  podcastChannelMeta: channelMeta(),
  show: podcastShow(),
  showEpisodes: [podcastRow({ show_id: "show-1" })] as PodcastRowStub[],
  webStory: webStory(),
  liveEntries: [liveEntry()] as LiveEntryStub[],
  trackerSources: trackerSources(),
  taxonomy: taxonomy(),
  taxonomyPosts: [feedPost()] as FeedPostStub[],
  mediaMeta: new Map<string, { sizeBytes: number | null; mimeType: string | null }>(),
  podcastsFailure: null,
  liveFailure: null,
  trackerFailure: null,
  webStoryFailure: null,
};

beforeEach(() => {
  Object.assign(state, HEALTHY);
  // Kod tras liczy rok w `copyright` i daty `lastmod`; bez ustalonego czasu
  // asercje na dokumencie byłyby zależne od dnia uruchomienia suity.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-02-03T10:15:00Z"));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Wspólny kontrakt „nigdy ucięty dokument"
// ---------------------------------------------------------------------------

/**
 * Czy dokument XML jest DOMKNIĘTY - ten sam warunek, który decyduje, czy parser
 * robota przyjmie plik, czy odrzuci go w całości.
 *
 * Świadomie NIE używamy tu prawdziwego parsera: happy-dom parsuje XML
 * pobłażliwie (naprawia drzewo i nie zgłasza błędu), więc test „przechodziłby"
 * także dla dokumentu, który Googlebot odrzuci. Sprawdzamy więc dokładnie to,
 * co odrzucenie powoduje: obecność deklaracji i domknięcie korzenia.
 */
function xmlIsWellFormed(body: string): boolean {
  if (!body.startsWith("<?xml")) return false;
  const root = /<([a-zA-Z][\w:.-]*)/.exec(body.replace(/<\?xml[^?]*\?>/, ""));
  if (!root) return false;
  return body.trimEnd().endsWith(`</${root[1]}>`);
}

/**
 * Odpowiedź jest albo poprawnym dokumentem, albo statusem błędu. Nic trzeciego.
 *
 * ODDAJE CIAŁO, bo `Response` w happy-dom nie daje się klonować po odczycie
 * („Request body is already used"), a wołający często potrzebuje DRUGIEJ
 * asercji na tym samym dokumencie - np. że pusty kanał nie ma `<item>`.
 */
async function assertNeverTruncated(response: Response, kind: "xml" | "text"): Promise<string> {
  const body = await response.text();
  if (response.status >= 400) {
    // Status błędu jest poprawną odpowiedzią na awarię - crawler ponowi.
    expect(body.length, "status błędu z pustym ciałem jest w porządku").toBeGreaterThanOrEqual(0);
    return body;
  }
  expect(response.status, "odpowiedź udana").toBe(200);
  if (kind === "xml") {
    expect(
      xmlIsWellFormed(body),
      `dokument NIE jest domknięty - parser robota odrzuci CAŁY plik:\n${body.slice(0, 400)}`,
    ).toBe(true);
  } else {
    expect(body.length, "dokument tekstowy nie może być pusty").toBeGreaterThan(0);
  }
  return body;
}

/**
 * Uruchamia handler i sprawdza kontrakt „nigdy ucięty dokument" dla ścieżki,
 * na której trasa NIE owija odczytu w `try`.
 *
 * Asercja jest na KONKRETNYM błędzie, który wstrzyknął test - nie na „cokolwiek
 * rzuciło". Bez tego zawężenia test przechodziłby także wtedy, gdyby wywalił się
 * sam mock albo import trasy, czyli „dowodziłby" degradacji, której nie ma.
 */
async function expectRejectsWithInjectedFailure(
  run: () => Promise<Response>,
  mode: "throw" | "pgError",
  table = "posts",
): Promise<void> {
  const error = await run().then(
    (res) => {
      throw new Error(
        `handler ODPOWIEDZIAŁ (${res.status}) zamiast odrzucić - sprawdź, czy atrapa faktycznie zawodzi`,
      );
    },
    (e: unknown) => e,
  );
  expect(error, "odrzucenie musi być błędem").toBeInstanceOf(Error);
  const message = error instanceof Error ? error.message : "";
  if (mode === "pgError") {
    expect(message, "błąd musi pochodzić z WSTRZYKNIĘTEJ awarii PostgREST").toContain(
      `permission denied for table ${table}`,
    );
    expect(error instanceof Error ? error.name : "").toBe("PostgrestError");
  } else {
    expect(message, "błąd musi pochodzić z WSTRZYKNIĘTEJ awarii czytnika").toBe(
      "czytnik niedostępny",
    );
  }
}

describe("sitemapIsWellFormed - kontrola samego narzędzia", () => {
  // Bez tego bloku asercja „dokument jest domknięty" mogłaby przechodzić dla
  // wszystkiego i nikt by tego nie zauważył.
  it.each([
    ['<?xml version="1.0"?><urlset><url><loc>/a</loc></url></urlset>', true],
    ['<?xml version="1.0"?><urlset><url><loc>/a</loc></url>', false],
    ["<urlset></urlset>", false],
    ['<?xml version="1.0"?>', false],
    ["", false],
  ])("rozpoznaje %j jako domknięty=%s", (body, expected) => {
    expect(xmlIsWellFormed(body)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// 1. Awaria czytnika - dla każdej powierzchni osobno
// ---------------------------------------------------------------------------

describe("awaria warstwy danych - żadna trasa nie emituje uciętego dokumentu", () => {
  it.each(["throw", "pgError"] as const)(
    "/rss.xml przy awarii czytnika (%s) oddaje poprawny dokument albo status błędu",
    async (mode) => {
      state.postsFailure = mode;
      const { Route } = await import("../rss[.]xml");
      const handler = routeServerHandlers(Route).GET;
      expect(handler, "trasa musi mieć handler GET").toBeDefined();
      // Trasa nie owija odczytu w `try`, więc handler odrzuca - i to JEST
      // poprawne zachowanie: framework zamienia odrzucenie w 500, a 500 to
      // status błędu, nie dokument. Kontrakt „nigdy ucięty XML" jest spełniony
      // wtedy i tylko wtedy, gdy nie ma trzeciej możliwości.
      await expectRejectsWithInjectedFailure(() => handler!({}), mode);
    },
  );

  it.each(["throw", "pgError"] as const)(
    "/news-sitemap.xml przy awarii czytnika (%s) nie emituje uciętego XML-a",
    async (mode) => {
      state.postsFailure = mode;
      const { Route } = await import("../news-sitemap[.]xml");
      const handler = routeServerHandlers(Route).GET;
      await expectRejectsWithInjectedFailure(() => handler!({}), mode);
    },
  );

  it("/llms.txt przy awarii czytnika kategorii nie emituje obciętego przewodnika", async () => {
    state.categoriesFailure = "throw";
    const { Route } = await import("../llms[.]txt");
    const handler = routeServerHandlers(Route).GET;
    await expectRejectsWithInjectedFailure(() => handler!({}), "throw");
  });

  it.each(["throw", "pgError"] as const)(
    "/sitemap.xml przy awarii kolektora sekcji (%s) nie emituje uciętego indeksu",
    async (mode) => {
      state.sectionsFailure = mode;
      const { Route } = await import("../sitemap[.]xml");
      const handler = routeServerHandlers(Route).GET;
      await expectRejectsWithInjectedFailure(() => handler!({}), mode);
    },
  );

  it.each(["throw", "pgError"] as const)(
    "/sitemaps/core.xml przy awarii kolektora (%s) nie emituje uciętego shardu",
    async (mode) => {
      state.sectionsFailure = mode;
      const { Route } = await import("../sitemaps.$section");
      const handler = routeServerHandlers(Route).GET;
      await expectRejectsWithInjectedFailure(
        () => handler!({ params: { section: "core.xml" } }),
        mode,
      );
    },
  );

  it("awaria indeksu przekierowań NIE wywraca sitemapy - degraduje do braku kanonizacji", async () => {
    // To jedyna warstwa, którą trasy sitemapy owijają w `try` (patrz
    // `loadRedirectIndex`), i właśnie dlatego jest osobnym przypadkiem:
    // sitemapa musi wyjść, tylko bez podmiany adresów na cele przekierowań.
    vi.doMock("@/lib/seo/redirects.server", () => ({
      getRedirectIndexForTenant: () => Promise.reject(new Error("indeks niedostępny")),
    }));
    vi.resetModules();
    const { Route } = await import("../sitemaps.$section");
    const handler = routeServerHandlers(Route).GET;
    const res = await handler!({ params: { section: "core.xml" } });
    // Degradacja tenanta nieobsłużonego: `core` ma statyczny szkielet, więc
    // dokument POWSTAJE i musi być domknięty.
    await assertNeverTruncated(res, "xml");
    vi.doUnmock("@/lib/seo/redirects.server");
    vi.resetModules();
  });
});

// ---------------------------------------------------------------------------
// 2. Nagłówki odpowiedzi zdegradowanej
// ---------------------------------------------------------------------------

describe("nagłówki odpowiedzi ZDEGRADOWANEJ (pusty zbiór)", () => {
  beforeEach(() => {
    // Host podglądowy z pustym katalogiem domen: tenanta nie ma, ale degradacja
    // jest bezpieczna, więc trasy oddają poprawny, PUSTY dokument. To ten stan,
    // w którym nagłówki decydują, czy awaria utrwali się na brzegu.
    state.tenantId = null;
    state.degradeSafe = true;
  });

  it("/rss.xml oddaje poprawny, pusty kanał z typem treści feedu", async () => {
    const { Route } = await import("../rss[.]xml");
    const res = await routeServerHandlers(Route).GET!({});
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/rss+xml; charset=utf-8");
    const body = await res.text();
    expect(xmlIsWellFormed(body), "pusty kanał musi być domkniętym dokumentem").toBe(true);
    expect(body).toContain("<rss");
    expect(body).not.toContain("<item>");
  });

  it("pusty kanał /rss.xml NIE dostaje długiego TTL - NAPRAWIONE 2026-09-02", async () => {
    // HISTORIA TEGO TESTU. Do 2026-09-02 stał tu `it.fails` z kontrolą
    // dodatnią asertującą literał `public, max-age=300, s-maxage=1800,
    // stale-while-revalidate=86400` - czyli DEFEKT był przypięty, nie
    // naprawiony. KONSEKWENCJA, którą tamten opis nazywał: odpowiedź
    // zdegradowana (pusta, bo katalog domen był nieosiągalny albo tenant się
    // nie rozwiązał) lądowała na brzegu z półgodzinnym `s-maxage` i dobowym
    // `stale-while-revalidate`. Crawler i czytelnik dostawali zapamiętaną
    // PUSTKĘ długo po tym, jak baza wróciła; awaria trwająca sekundy utrwalała
    // się na 24 godziny, a jedynym lekarstwem było ręczne czyszczenie cache.
    //
    // Naprawa mieszka w `lib/seo/feedCache.ts` (jeden kontrakt dla wszystkich
    // kanałów) i objęła TĄ SAMĄ zmianą kanał sieciowy, kanały podcastu,
    // tracker, relację na żywo i feedy taksonomii - dotąd literał był
    // przepisany w pięciu miejscach.
    const { Route } = await import("../rss[.]xml");
    const cc = (await routeServerHandlers(Route).GET!({})).headers.get("cache-control") ?? "";
    expect(cc, "pusty feed nie może dostać długiego TTL").not.toMatch(/s-maxage=1800/);
    expect(cc, "pusty feed nie może być podawany jako stale przez dobę").not.toMatch(
      /stale-while-revalidate/,
    );
    expect(cc, "pusty feed musi rewalidować u klienta").toContain("must-revalidate");
  });

  it("kontrola dodatnia: kanał Z TREŚCIĄ nadal dostaje długi TTL", async () => {
    // Bez tej kontroli naprawa wyżej „przechodziłaby" także wtedy, gdyby ktoś
    // skrócił TTL WSZYSTKIM kanałom - a to byłoby wymiana jednej regresji na
    // drugą: czytniki RSS odpytują agresywnie i bez `s-maxage` każde odpytanie
    // schodziłoby do bazy.
    state.tenantId = "t-1";
    state.degradeSafe = false;
    state.posts = [feedPost()];
    const { Route } = await import("../rss[.]xml");
    const res = await routeServerHandlers(Route).GET!({});
    expect(
      await res.text(),
      "kanał MUSI mieć pozycję - inaczej test nie dowodzi niczego",
    ).toContain("<item>");
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=300, s-maxage=1800, stale-while-revalidate=86400",
    );
  });

  it("/news-sitemap.xml oddaje poprawny, pusty dokument z typem XML", async () => {
    const { Route } = await import("../news-sitemap[.]xml");
    const res = await routeServerHandlers(Route).GET!({});
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(xmlIsWellFormed(await res.text())).toBe(true);
  });

  it("pusta news-sitemap NIE dostaje TTL pełnej - NAPRAWIONE 2026-09-02", async () => {
    // HISTORIA. Stał tu `it.fails` z opisem konsekwencji: Google News czyta
    // ten plik po to, żeby zobaczyć wpisy z ostatnich 48 h, a pusty dokument
    // zapamiętany na `s-maxage=300` plus `stale-while-revalidate=600` wypada
    // z okna nowości - materiał opublikowany w czasie awarii nigdy do News nie
    // trafi, bo do wygaśnięcia cache przestanie być świeży.
    //
    // Przypięcie przestało być uzasadnione w chwili, gdy powstał
    // `lib/seo/feedCache.ts`: naprawa nie wymagała żadnej decyzji produktowej,
    // tylko podania liczby wpisów do gotowego kontraktu. Zostawienie `it.fails`
    // przy naprawie leżącej w jednej linii byłoby wymówką, nie odroczeniem.
    const { Route } = await import("../news-sitemap[.]xml");
    const cc = (await routeServerHandlers(Route).GET!({})).headers.get("cache-control") ?? "";
    expect(cc, "pusta news-sitemap nie może być podawana jako stale").not.toMatch(
      /stale-while-revalidate/,
    );
    expect(cc, "pusta news-sitemap musi rewalidować u klienta").toContain("must-revalidate");
  });

  it("kontrola dodatnia: news-sitemap Z WPISAMI zachowuje SWÓJ, krótszy TTL pełny", async () => {
    // Bez tej kontroli naprawa wyżej „przechodziłaby" także wtedy, gdyby ktoś
    // skrócił TTL wszystkim news-sitemapom - a TTL pełnej jest tu świadomym
    // wyjątkiem (minuty, nie pół godziny), bo świeżość jest całym jej sensem.
    state.tenantId = "t-1";
    state.degradeSafe = false;
    // Data publikacji MUSI wpaść w okno nowości Google News (48 h od
    // ustalonego zegara testu, 2026-02-03), inaczej wpis nie wejdzie do
    // dokumentu i „kontrola dodatnia" mierzyłaby pustkę.
    state.posts = [feedPost({ published_at: "2026-02-03T08:00:00Z" })];
    const { Route } = await import("../news-sitemap[.]xml");
    const res = await routeServerHandlers(Route).GET!({});
    expect(await res.clone().text(), "dokument MUSI mieć wpis").toContain("<url>");
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=120, s-maxage=300, stale-while-revalidate=600",
    );
  });

  it("/sitemap.xml oddaje domknięty indeks, gdy nie ma żadnej sekcji do ogłoszenia", async () => {
    const { Route } = await import("../sitemap[.]xml");
    const res = await routeServerHandlers(Route).GET!({});
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    const body = await res.text();
    expect(xmlIsWellFormed(body)).toBe(true);
    expect(body).toContain("<sitemapindex");
    expect(body).toContain("</sitemapindex>");
  });

  it("indeks i shardy ZAWSZE rewalidują u klienta - inaczej zmiana SEO nie propaguje", async () => {
    // `max-age=0` + `must-revalidate` to jedyna część kontraktu cache tych
    // powierzchni, która jest dziś poprawna dla odpowiedzi zdegradowanej -
    // i którą e2e sprawdza wyłącznie dla indeksu na zdrowym środowisku
    // ("sitemap.xml is a sitemapindex...", asercja na cache-control). Tutaj
    // przypinamy ją dla stanu awaryjnego, którego e2e nie umie wytworzyć.
    const { Route } = await import("../sitemap[.]xml");
    const cc = (await routeServerHandlers(Route).GET!({})).headers.get("cache-control") ?? "";
    expect(cc).toContain("max-age=0");
    expect(cc).toContain("must-revalidate");
  });

  it("/llms.txt jest fail-closed przy nieznanym tenancie - 404, nie pusty przewodnik", async () => {
    // Ta trasa NIE ma członu degradacji (`crawlerDegradeIsSafe`), który mają
    // /rss.xml i /news-sitemap.xml. Przypinamy różnicę, bo to nie przypadek:
    // przewodnik dla asystentów AI opisuje redakcję, więc pusty jest gorszy
    // od nieobecnego - asystent zacytowałby serwis bez treści.
    const { Route } = await import("../llms[.]txt");
    const res = await routeServerHandlers(Route).GET!({});
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Unknown host");
  });
});

describe("host nieznany i brak zaufanego hosta - fail-closed", () => {
  it.each([
    ["../rss[.]xml", "/rss.xml"],
    ["../news-sitemap[.]xml", "/news-sitemap.xml"],
    ["../llms[.]txt", "/llms.txt"],
  ])("%s oddaje 404 dla hosta, którego nie objął żaden tenant", async (modulePath) => {
    state.tenantId = null;
    state.degradeSafe = false;
    const { Route } = (await import(modulePath)) as {
      Route: Parameters<typeof routeServerHandlers>[0];
    };
    const res = await routeServerHandlers(Route).GET!({});
    expect(res.status).toBe(404);
  });

  it("/sitemap.xml oddaje 404 dla hosta bez tenanta (nie mapuje cudzych adresów)", async () => {
    state.tenantId = null;
    state.degradeSafe = false;
    const { Route } = await import("../sitemap[.]xml");
    const res = await routeServerHandlers(Route).GET!({});
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Unknown host");
  });

  it("brak zaufanego hosta daje pusty origin, a trasa nadal nie emituje uciętego dokumentu", async () => {
    state.host = null;
    state.tenantId = null;
    state.degradeSafe = true;
    const { Route } = await import("../rss[.]xml");
    const res = await routeServerHandlers(Route).GET!({});
    await assertNeverTruncated(res, "xml");
  });
});

describe("feed wyłączony w ustawieniach redakcji", () => {
  it("/rss.xml z `rss_enabled: false` oddaje 404, nie pusty kanał", async () => {
    state.settings = { rss_enabled: false };
    const { Route } = await import("../rss[.]xml");
    const res = await routeServerHandlers(Route).GET!({});
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Feed disabled");
  });

  it("/news-sitemap.xml z `news_sitemap_enabled: false` oddaje 404", async () => {
    state.settings = { news_sitemap_enabled: false };
    const { Route } = await import("../news-sitemap[.]xml");
    const res = await routeServerHandlers(Route).GET!({});
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("News sitemap disabled");
  });

  it("/llms.txt z `llms_txt_enabled: false` oddaje 404", async () => {
    state.settings = { llms_txt_enabled: false };
    const { Route } = await import("../llms[.]txt");
    const res = await routeServerHandlers(Route).GET!({});
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("llms.txt disabled");
  });
});

// ---------------------------------------------------------------------------
// 3. Kontrakt shardów
// ---------------------------------------------------------------------------

describe("kontrakt sitemaps.$section - sekcja nieznana, pusta i poza paginacją", () => {
  async function shard(section: string): Promise<Response> {
    const { Route } = await import("../sitemaps.$section");
    return routeServerHandlers(Route).GET!({ params: { section } });
  }

  it.each([
    ["nie-ma-takiej-sekcji.xml", "sekcja poza dozwolonym zbiorem"],
    ["core", "brak rozszerzenia .xml"],
    ["core.txt", "złe rozszerzenie"],
    ["core-1.xml", "pierwszy shard NIE nosi sufiksu - `-1` byłby duplikatem adresu"],
    ["core-0.xml", "numeracja shardów startuje od 2"],
    ["core-abc.xml", "numer shardu nie jest liczbą"],
    ["core-2.5.xml", "numer shardu nie jest całkowity"],
    ["", "pusty segment"],
    [".xml", "sam sufiks bez sekcji"],
  ])("%s -> 404 (%s)", async (section) => {
    const res = await shard(section);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Unknown sitemap");
  });

  it("odrzuca nieznaną sekcję PRZED jakimkolwiek odczytem bazy", async () => {
    // Sens tej asercji: shard sitemapy jest publiczny i niezalogowany, więc
    // `parseSitemapShard` jest tu tanią bramką odcinającą skanowanie adresów.
    // Gdyby odczyt szedł przed walidacją, każde `/sitemaps/cokolwiek.xml`
    // kosztowałoby round-trip do service-role.
    state.sectionsFailure = "throw";
    const res = await shard("nie-ma-takiej-sekcji.xml");
    expect(res.status, "gdyby czytał bazę, dostalibyśmy odrzucenie, nie 404").toBe(404);
  });

  it("sekcja PUSTA to 404, nie pusty <urlset>", async () => {
    // Pusty plik w Search Console wygląda jak błąd publikacji i zostaje
    // w raporcie; 404 czyści wpis. Tę samą regułę e2e sprawdza na żywym
    // środowisku ("an unknown sitemap shard is a 404, not an empty urlset") -
    // tutaj pada bez bazy i bez SSR, czyli o rzędy wielkości szybciej.
    state.sectionEntries = [];
    const res = await shard("posts.xml");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Unknown sitemap");
  });

  it("shard POZA zakresem paginacji to 404, choć sekcja MA treść", async () => {
    // Rozróżnienie względem przypadku wyżej: tu sekcja NIE jest pusta - warstwa
    // danych oddaje adresy, więc `posts.xml` odpowiada 200. Pusty wychodzi
    // dopiero `shardSlice` dla shardu 3, bo tyle stron paginacji nie istnieje.
    // To adres, który ktoś trzyma po skasowaniu treści (albo bot zgadł numer);
    // 404 czyści wpis w Search Console, a pusty <urlset> zostawiłby go jako
    // „błąd publikacji".
    state.sectionEntries = [
      { loc: "https://neweuropeanstrategies.com/analizy/a" },
      { loc: "https://neweuropeanstrategies.com/analizy/b" },
    ];
    const pierwszy = await shard("posts.xml");
    expect(pierwszy.status, "shard pierwszy MA treść - inaczej test nie dowodzi paginacji").toBe(
      200,
    );
    expect(await pierwszy.text()).toContain("<urlset");

    const poza = await shard("posts-3.xml");
    expect(poza.status).toBe(404);
    expect(await poza.text()).toBe("Unknown sitemap");
  });

  it("nieznany HOST na znanym shardzie to 404 (fail-closed przed odczytem treści)", async () => {
    state.tenantId = null;
    state.degradeSafe = false;
    const res = await shard("core.xml");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Unknown host");
  });

  it("shard `core` na hoście podglądowym degraduje do statycznego szkieletu, nie do 404", async () => {
    // Indeks OGŁASZA `core.xml`, więc 404 na tej sekcji zrobiłby z indeksu
    // dokument kierujący crawlera w pustkę - dokładnie ten błąd, który e2e
    // pilnuje testem "every sitemap listed in the index resolves to a urlset".
    state.tenantId = null;
    state.degradeSafe = true;
    const res = await shard("core.xml");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(xmlIsWellFormed(body)).toBe(true);
    expect(body).toContain("<urlset");
  });

  it("sekcja INNA niż `core` na hoście podglądowym to 404 - nie ma szkieletu do pokazania", async () => {
    state.tenantId = null;
    state.degradeSafe = true;
    const res = await shard("posts.xml");
    expect(res.status).toBe(404);
  });
});

describe("alias indeksu /sitemap-index.xml", () => {
  it("oddaje 301 na kanoniczny indeks i NIE serwuje drugiej kopii treści", async () => {
    // e2e sprawdza sam fakt przekierowania ("sitemap-index.xml redirects to the
    // canonical index"); tutaj przypinamy to, czego tam nie widać: że ciało
    // jest PUSTE (żadnej drugiej kopii mapy do podwójnego crawlowania) i że
    // alias ma własny, długi TTL - on się nie zmienia, w przeciwieństwie do mapy.
    const { Route } = await import("../sitemap-index[.]xml");
    const res = await routeServerHandlers(Route).GET!({});
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/sitemap.xml");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(await res.text()).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 4. MODUŁ 07 - sześć powierzchni crawlera treści specjalnych
//
// CZEGO TU BRAKOWAŁO. Kontrakt kanałów, narzędzie (`xmlIsWellFormed`) i cały
// harness stały w tym pliku od 2026-08, a SZEŚĆ powierzchni crawlera modułu
// „typy treści specjalne" nie było do nich zapisanych ANI JEDNĄ asercją:
//
//   /podcast/rss.xml            0/23 linii   kanał sieciowy podcastu
//   /podcasts/$show/rss.xml     0/27         kanał programu (Apple/Spotify)
//   /live/rss.xml               0/24         relacja na żywo
//   /tracker/rss.xml            0/2          tracker legislacyjny UE
//   /programs/$slug/rss.xml     0/2          kanał programu badawczego
//   /web-stories/$slug/amp      0/15         wariant AMP web story
//
// STAWKA. To powierzchnie, które CDN zapamiętuje na godziny, a katalogi
// (Apple Podcasts, Spotify, Google Discover) traktują ich odpowiedź jako
// stan faktyczny, nie jako pomiar. Trzy klasy awarii, każda cicha:
//   * dokument ucięty -> robot odrzuca CAŁY plik, więc znika cały kanał;
//   * pusty kanał z długim TTL -> katalog widzi „audycja bez odcinków"
//     i utrwala to na brzegu długo po powrocie bazy;
//   * kanał na nieprzypisanej domenie -> treść jednego obszaru roboczego
//     pod adresem drugiego, w cache, którego nie widzi nikt poza crawlerem.
//
// CZEGO NIE DUBLUJE. Ścieżkę zdrową kanałów trackera i relacji dowodzi
// `e2e/seo.spec.ts` („content feeds respond for the tracker and live
// coverage"), a odnajdywalność kanału podcastu - „podcast feed is
// auto-discoverable from the podcast pages". Czyste generatory mają własne
// testy jednostkowe (`podcastRss.test.ts`, `ampStory.test.ts`, `rss.test.ts`,
// `lib/tracker/__tests__/feed.test.ts`) - one dowodzą, jak dokument jest
// SKŁADANY z poprawnego wejścia; ten plik dowodzi, co trasa robi, gdy wejścia
// NIE MA albo gdy host jest obcy.
// ---------------------------------------------------------------------------

/**
 * Czy dokument HTML jest DOMKNIĘTY - odpowiednik `xmlIsWellFormed` dla
 * wariantu AMP, który NIE jest XML-em i nie ma deklaracji `<?xml`.
 *
 * Walidator AMP odrzuca dokument bez `<!doctype html>` i bez domkniętego
 * `</html>` w całości, a odrzucony dokument AMP znaczy „ta historia nie
 * kwalifikuje się do Web Stories" - czyli dokładnie ta sama konsekwencja,
 * co ucięty XML w kanale.
 */
function htmlIsWellFormed(body: string): boolean {
  if (!/^<!doctype html>/i.test(body.trimStart())) return false;
  return body.trimEnd().endsWith("</html>");
}

/** Nagłówki, które kanał PUSTY musi dostać po naprawie z `lib/seo/feedCache.ts`. */
const EMPTY_FEED_CACHE = "public, max-age=0, s-maxage=60, must-revalidate";
/** Nagłówek kanału PEŁNEGO - standardowy. */
const FULL_FEED_CACHE = "public, max-age=300, s-maxage=1800, stale-while-revalidate=86400";
/** Nagłówek kanału PEŁNEGO relacji na żywo - świadomy wyjątek (minuty, nie godziny). */
const FULL_LIVE_CACHE = "public, max-age=60, s-maxage=120, stale-while-revalidate=600";

/** Handler GET powierzchni modułu 07 pod jej ścieżką modułową. */
async function surfaceGet(modulePath: string, params?: Record<string, string>): Promise<Response> {
  const { Route } = (await import(modulePath)) as {
    Route: Parameters<typeof routeServerHandlers>[0];
  };
  const handler = routeServerHandlers(Route).GET;
  expect(handler, `${modulePath} musi mieć handler GET`).toBeDefined();
  return handler!(params ? { params } : {});
}

/** Sześć powierzchni w jednym miejscu - żadna lista niżej nie może się rozjechać. */
const MODULE_07_SURFACES = [
  ["../podcast.rss[.]xml", "/podcast/rss.xml", undefined],
  ["../podcasts.$show.rss[.]xml", "/podcasts/$show/rss.xml", { show: "rozmowy-o-europie" }],
  ["../live_.rss[.]xml", "/live/rss.xml", undefined],
  ["../tracker.rss[.]xml", "/tracker/rss.xml", undefined],
  ["../programs.$slug.rss[.]xml", "/programs/$slug/rss.xml", { slug: "polityka-cyfrowa" }],
  ["../web-stories.$slug.amp", "/web-stories/$slug/amp", { slug: "europa-w-piatke-obrazkow" }],
] as const satisfies ReadonlyArray<readonly [string, string, Record<string, string> | undefined]>;

describe("htmlIsWellFormed - kontrola samego narzędzia", () => {
  // Bez tego bloku asercja „dokument AMP jest domknięty" mogłaby przechodzić
  // dla wszystkiego i nikt by tego nie zauważył - dokładnie ten sam powód,
  // dla którego `xmlIsWellFormed` ma swój blok kontrolny wyżej.
  it.each([
    ["<!doctype html><html><body>x</body></html>", true],
    ["<!DOCTYPE html><html></html>", true],
    ["  <!doctype html><html></html>  ", true],
    ["<!doctype html><html><body>ucięte", false],
    ["<html></html>", false],
    ["<!doctype html>", false],
    ["", false],
  ])("rozpoznaje %j jako domknięty=%s", (body, expected) => {
    expect(htmlIsWellFormed(body)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// 4.1 Awaria warstwy danych
// ---------------------------------------------------------------------------

describe("moduł 07: awaria czytnika NIE emituje uciętego dokumentu", () => {
  // DWA POKRĘTŁA, DWIE RÓŻNE AWARIE - patrz uwaga o `resilient` przy stanie.
  //
  // (a) awaria REALNA: `resilient(...)` w `publishedContent.server.ts` łapie
  //     wyjątek i oddaje `[]` / `null`, więc do trasy dochodzi PUSTKA. To jest
  //     stan, który zdarza się na produkcji - i to on decyduje o nagłówkach.
  // (b) awaria HIPOTETYCZNA: „gdyby ktoś zdjął `resilient`". Tu przedmiotem
  //     dowodu jest wyłącznie to, że trasa nie ma TRZECIEJ możliwości między
  //     poprawnym dokumentem a statusem błędu.

  describe("(a) czytnik zdegradował do pustki - dokument MUSI być domknięty", () => {
    it("/podcast/rss.xml bez ani jednego odcinka oddaje domknięty, pusty kanał", async () => {
      state.podcasts = [];
      const body = await assertNeverTruncated(await surfaceGet("../podcast.rss[.]xml"), "xml");
      expect(body).toContain("<rss");
      expect(body, "kanał bez odcinków nie może udawać, że je ma").not.toContain("<item>");
    });

    it("/podcast/rss.xml pomija odcinki BEZ audio - odcinek bez pliku nie jest pozycją podcastu", async () => {
      // KONSEKWENCJA: `<item>` bez `<enclosure>` jest w kanale podcastowym
      // pozycją nieważną. Apple odrzuca cały kanał przy walidacji, a nie
      // pojedynczy wpis, więc jeden odcinek zapisany bez pliku wywalałby
      // z katalogu całą audycję.
      state.podcasts = [podcastRow({ audio_url: "" }), podcastRow({ slug: "z-audio" })];
      const body = await (await surfaceGet("../podcast.rss[.]xml")).text();
      expect(body).toContain("z-audio");
      expect((body.match(/<item>/g) ?? []).length, "dokładnie jeden ważny odcinek").toBe(1);
    });

    it("/podcasts/$show/rss.xml dla programu BEZ odcinków oddaje domknięty, pusty kanał", async () => {
      state.showEpisodes = [];
      const body = await assertNeverTruncated(
        await surfaceGet("../podcasts.$show.rss[.]xml", { show: "rozmowy-o-europie" }),
        "xml",
      );
      expect(body).not.toContain("<item>");
    });

    it("/live/rss.xml bez wpisów relacji oddaje domknięty, pusty kanał", async () => {
      state.liveEntries = [];
      await assertNeverTruncated(await surfaceGet("../live_.rss[.]xml"), "xml");
    });

    it("/tracker/rss.xml bez dossier oddaje domknięty, pusty kanał", async () => {
      state.trackerSources = { items: [], updates: [] };
      await assertNeverTruncated(await surfaceGet("../tracker.rss[.]xml"), "xml");
    });

    it("/programs/$slug/rss.xml dla programu bez analiz oddaje domknięty, pusty kanał", async () => {
      state.taxonomyPosts = [];
      const body = await assertNeverTruncated(
        await surfaceGet("../programs.$slug.rss[.]xml", { slug: "polityka-cyfrowa" }),
        "xml",
      );
      expect(body, "program bez analiz nie może udawać, że je ma").not.toContain("<item>");
    });

    it("/web-stories/$slug/amp emituje DOMKNIĘTY dokument AMP, nie ucięty", async () => {
      const res = await surfaceGet("../web-stories.$slug.amp", {
        slug: "europa-w-piatke-obrazkow",
      });
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(
        htmlIsWellFormed(body),
        `dokument AMP NIE jest domknięty - walidator Google odrzuci CAŁĄ historię:\n${body.slice(0, 400)}`,
      ).toBe(true);
    });
  });

  describe("(b) czytnik RZUCA - trasa odrzuca, framework robi z tego 500", () => {
    it.each(["throw", "pgError"] as const)(
      "/podcast/rss.xml przy awarii czytnika odcinków (%s)",
      async (mode) => {
        state.podcastsFailure = mode;
        await expectRejectsWithInjectedFailure(
          () => surfaceGet("../podcast.rss[.]xml"),
          mode,
          "podcasts",
        );
      },
    );

    it.each(["throw", "pgError"] as const)(
      "/podcasts/$show/rss.xml przy awarii czytnika programu (%s)",
      async (mode) => {
        state.podcastsFailure = mode;
        await expectRejectsWithInjectedFailure(
          () => surfaceGet("../podcasts.$show.rss[.]xml", { show: "rozmowy-o-europie" }),
          mode,
          "podcast_shows",
        );
      },
    );

    it.each(["throw", "pgError"] as const)(
      "/live/rss.xml przy awarii czytnika wpisów relacji (%s)",
      async (mode) => {
        state.liveFailure = mode;
        await expectRejectsWithInjectedFailure(
          () => surfaceGet("../live_.rss[.]xml"),
          mode,
          "live_blog_entries",
        );
      },
    );

    it.each(["throw", "pgError"] as const)(
      "/tracker/rss.xml przy awarii czytnika źródeł (%s)",
      async (mode) => {
        state.trackerFailure = mode;
        await expectRejectsWithInjectedFailure(
          () => surfaceGet("../tracker.rss[.]xml"),
          mode,
          "tracker_items",
        );
      },
    );

    it.each(["throw", "pgError"] as const)(
      "/programs/$slug/rss.xml przy awarii czytnika wpisów (%s)",
      async (mode) => {
        state.postsFailure = mode;
        await expectRejectsWithInjectedFailure(
          () => surfaceGet("../programs.$slug.rss[.]xml", { slug: "polityka-cyfrowa" }),
          mode,
        );
      },
    );

    it.each(["throw", "pgError"] as const)(
      "/web-stories/$slug/amp przy awarii czytnika historii (%s)",
      async (mode) => {
        state.webStoryFailure = mode;
        await expectRejectsWithInjectedFailure(
          () => surfaceGet("../web-stories.$slug.amp", { slug: "europa-w-piatke-obrazkow" }),
          mode,
          "web_stories",
        );
      },
    );
  });
});

// ---------------------------------------------------------------------------
// 4.2 Nagłówki odpowiedzi ZDEGRADOWANEJ
// ---------------------------------------------------------------------------

describe("moduł 07: pusty kanał NIE dostaje długiego TTL", () => {
  // KONSEKWENCJA, dla której ten blok istnieje. Apple Podcasts i Spotify
  // traktują kanał, który oddał 200 z zerem pozycji, jako informację „ta
  // audycja nie ma odcinków" - nie jako awarię. Utrwalenie tego na brzegu
  // przez `s-maxage=1800` i podawanie jako stale przez `86400` to ryzyko
  // wypadnięcia audycji z katalogu po awarii trwającej sekundy. Naprawa
  // mieszka w `lib/seo/feedCache.ts` i jest jedna dla wszystkich kanałów.

  it("/podcast/rss.xml: kanał bez odcinków dostaje TTL odpowiedzi zdegradowanej", async () => {
    state.podcasts = [];
    const res = await surfaceGet("../podcast.rss[.]xml");
    expect(res.headers.get("cache-control")).toBe(EMPTY_FEED_CACHE);
  });

  it("/podcast/rss.xml: kontrola dodatnia - kanał Z ODCINKAMI dostaje długi TTL", async () => {
    // Bez tej kontroli test wyżej „przechodziłby" także wtedy, gdyby ktoś
    // skrócił TTL WSZYSTKIM kanałom - a to wymiana jednej regresji na drugą.
    const res = await surfaceGet("../podcast.rss[.]xml");
    expect(await res.clone().text()).toContain("<item>");
    expect(res.headers.get("cache-control")).toBe(FULL_FEED_CACHE);
  });

  it("/podcasts/$show/rss.xml: program bez odcinków dostaje TTL zdegradowany", async () => {
    state.showEpisodes = [];
    const res = await surfaceGet("../podcasts.$show.rss[.]xml", { show: "rozmowy-o-europie" });
    expect(res.headers.get("cache-control")).toBe(EMPTY_FEED_CACHE);
  });

  it("/podcasts/$show/rss.xml: kontrola dodatnia - program Z ODCINKAMI ma długi TTL", async () => {
    const res = await surfaceGet("../podcasts.$show.rss[.]xml", { show: "rozmowy-o-europie" });
    expect(await res.clone().text()).toContain("<item>");
    expect(res.headers.get("cache-control")).toBe(FULL_FEED_CACHE);
  });

  it("/tracker/rss.xml: kanał bez dossier dostaje TTL zdegradowany", async () => {
    state.trackerSources = { items: [], updates: [] };
    const res = await surfaceGet("../tracker.rss[.]xml");
    expect(res.headers.get("cache-control")).toBe(EMPTY_FEED_CACHE);
  });

  it("/tracker/rss.xml: kontrola dodatnia - kanał Z DOSSIER ma długi TTL", async () => {
    const res = await surfaceGet("../tracker.rss[.]xml");
    expect(await res.clone().text()).toContain("<item>");
    expect(res.headers.get("cache-control")).toBe(FULL_FEED_CACHE);
  });

  it("/programs/$slug/rss.xml: program bez analiz dostaje TTL zdegradowany", async () => {
    state.taxonomyPosts = [];
    const res = await surfaceGet("../programs.$slug.rss[.]xml", { slug: "polityka-cyfrowa" });
    expect(res.headers.get("cache-control")).toBe(EMPTY_FEED_CACHE);
  });

  it("/programs/$slug/rss.xml: kontrola dodatnia - program Z ANALIZAMI ma długi TTL", async () => {
    const res = await surfaceGet("../programs.$slug.rss[.]xml", { slug: "polityka-cyfrowa" });
    expect(await res.clone().text()).toContain("<item>");
    expect(res.headers.get("cache-control")).toBe(FULL_FEED_CACHE);
  });

  it("/live/rss.xml: relacja bez wpisów dostaje TTL zdegradowany", async () => {
    state.liveEntries = [];
    const res = await surfaceGet("../live_.rss[.]xml");
    expect(res.headers.get("cache-control")).toBe(EMPTY_FEED_CACHE);
  });

  it("/live/rss.xml: relacja Z WPISAMI zachowuje SWÓJ, krótszy TTL pełny", async () => {
    // Relacja starzeje się w minutach, nie w godzinach - to świadomy wyjątek
    // od `FEED_CACHE_CONTROL_FULL`, nie literówka (patrz `feedCache.ts`).
    const res = await surfaceGet("../live_.rss[.]xml");
    expect(await res.clone().text()).toContain("<item>");
    expect(res.headers.get("cache-control")).toBe(FULL_LIVE_CACHE);
  });

  it("/live/rss.xml: wpisy w OBCYM języku są filtrowane, a kanał wychodzi jako pusty", async () => {
    // Wpisy relacji są jednojęzyczne (kolumna `live_blog_entries.lang`).
    // Kanał PL, w którym wszystkie wpisy są EN, jest z perspektywy czytnika
    // kanałem pustym - i musi dostać TTL pustego, nie TTL pełnego.
    state.liveEntries = [liveEntry({ lang: "en" }), liveEntry({ id: "entry-2", lang: "en" })];
    const res = await surfaceGet("../live_.rss[.]xml");
    expect(await res.clone().text()).not.toContain("<item>");
    expect(res.headers.get("cache-control")).toBe(EMPTY_FEED_CACHE);
  });

  it("każdy kanał modułu 07 podaje typ treści feedu, nie text/plain", async () => {
    for (const [modulePath, label, params] of MODULE_07_SURFACES) {
      if (label === "/web-stories/$slug/amp") continue;
      const res = await surfaceGet(modulePath, params);
      expect(res.headers.get("content-type"), `${label} content-type`).toBe(
        "application/rss+xml; charset=utf-8",
      );
    }
  });

  it("/web-stories/$slug/amp podaje text/html - AMP nie jest kanałem", async () => {
    const res = await surfaceGet("../web-stories.$slug.amp", {
      slug: "europa-w-piatke-obrazkow",
    });
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });
});

// ---------------------------------------------------------------------------
// 4.3 Nieznany host - fail-closed
// ---------------------------------------------------------------------------

describe("moduł 07: nieznany host to fail-closed, nie cudze adresy", () => {
  beforeEach(() => {
    // Realna OBCA domena przy ZASIEDLONYM katalogu: nie ma tu żadnej
    // nieszkodliwej niejednoznaczności, więc każda powierzchnia musi odmówić.
    state.tenantId = null;
    state.degradeSafe = false;
  });

  it.each(MODULE_07_SURFACES)(
    "%s (%s) oddaje 404 dla hosta, którego nie objął żaden tenant",
    async (modulePath, label, params) => {
      const res = await surfaceGet(modulePath, params);
      expect(res.status, `${label} musi być fail-closed`).toBe(404);
      expect(await res.text()).toBe("Unknown host");
    },
  );

  it("brak zaufanego hosta NIE wypuszcza kanału z adresami cudzej domeny", async () => {
    // `trustedPublicHost` oddaje null, gdy nagłówek `Host` wskazuje domenę,
    // której nie ma w katalogu tenantów. Kanał zbudowany na takim hoście
    // reklamowałby cudzą domenę jako swoją.
    state.host = null;
    state.tenantId = null;
    state.degradeSafe = false;
    for (const [modulePath, label, params] of MODULE_07_SURFACES) {
      const res = await surfaceGet(modulePath, params);
      expect(res.status, `${label} bez zaufanego hosta`).toBe(404);
    }
  });

  it("kontrola dodatnia: ten sam zestaw powierzchni ODPOWIADA dla hosta z tenantem", async () => {
    // Bez tej kontroli blok wyżej „dowodziłby" fail-closed także wtedy, gdyby
    // wszystkie sześć tras były po prostu zepsute i zawsze zwracały 404.
    state.tenantId = "t-1";
    state.degradeSafe = false;
    for (const [modulePath, label, params] of MODULE_07_SURFACES) {
      const res = await surfaceGet(modulePath, params);
      expect(res.status, `${label} na hoście z tenantem`).toBe(200);
    }
  });
});

// ---------------------------------------------------------------------------
// 4.4 Kanał wyłączony w ustawieniach redakcji
// ---------------------------------------------------------------------------

describe("moduł 07: kanał wyłączony w ustawieniach to 404, nie pusty kanał", () => {
  // NAPRAWA 2026-09-02 (N2). Oba kanały podcastu były do dziś JEDYNYMI
  // kanałami RSS w repozytorium, których redakcja NIE mogła wyłączyć:
  // przełącznik „RSS" w ustawieniach SEO gasił `/rss.xml`, `/tracker/rss.xml`,
  // `/live/rss.xml` i feedy taksonomii, a kanały podcastu serwowały dalej.
  // Ten blok jest CZERWONY bez tej naprawy.
  beforeEach(() => {
    state.settings = { rss_enabled: false };
  });

  it.each([
    ["../podcast.rss[.]xml", "/podcast/rss.xml", undefined],
    ["../podcasts.$show.rss[.]xml", "/podcasts/$show/rss.xml", { show: "rozmowy-o-europie" }],
    ["../live_.rss[.]xml", "/live/rss.xml", undefined],
    ["../tracker.rss[.]xml", "/tracker/rss.xml", undefined],
    ["../programs.$slug.rss[.]xml", "/programs/$slug/rss.xml", { slug: "polityka-cyfrowa" }],
  ] as const)("%s (%s) z `rss_enabled: false` oddaje 404", async (modulePath, label, params) => {
    const res = await surfaceGet(modulePath, params);
    expect(res.status, `${label} przy wyłączonym RSS`).toBe(404);
    expect(await res.text()).toBe("Feed disabled");
  });

  it("kanał podcastu odmawia PRZED odczytem odcinków - wyłączony znaczy wyłączony", async () => {
    // Gdyby kolejność była odwrotna, wyłączenie RSS nadal kosztowałoby
    // round-trip do service-role na każde odpytanie czytnika.
    state.podcastsFailure = "throw";
    const res = await surfaceGet("../podcast.rss[.]xml");
    expect(res.status, "gdyby czytał bazę, dostalibyśmy odrzucenie, nie 404").toBe(404);
  });

  it("ODRZUCONE: /web-stories/$slug/amp NIE ma przełącznika i to nie jest defekt tej trasy", async () => {
    // `SeoSettingsSchema` nie ma pola `amp_enabled` - wariant AMP nie jest
    // kanałem subskrypcji, tylko DRUGIM RENDEREM strony, która i tak jest
    // publiczna, i jest podlinkowany wyłącznie z kanonicznej strony przez
    // `rel=amphtml`. Wyłącznik dla niego to nowe pole ustawień, czyli osobna
    // praca produktowa - a nie brak w tej trasie. Ten test przypina FAKT, że
    // AMP nie reaguje na `rss_enabled`, żeby nikt nie „naprawił" go przez
    // podpięcie pod przełącznik od czegoś innego.
    const res = await surfaceGet("../web-stories.$slug.amp", {
      slug: "europa-w-piatke-obrazkow",
    });
    expect(res.status, "AMP nie jest kanałem RSS i nie gaśnie z RSS").toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 4.5 N2: DWA różne kontrakty braku tenanta na kanałach jednego modułu
// ---------------------------------------------------------------------------

describe("moduł 07 (N2): kontrakt braku tenanta - kanał hosta kontra kanał sluga", () => {
  // CO USTALIŁO TO ZADANIE. `/podcast/rss.xml` miał WYŁĄCZNIE człon
  // fail-closed, a `/live/rss.xml` dwuczłonowy predykat z `crawlerDegradeIsSafe`.
  // Różnica NIE była zamierzona i została ujednolicona - w stronę
  // dwuczłonowego, bo:
  //
  //   * człon fail-closed decyduje o szczelności tenanta i w obu wariantach
  //     jest IDENTYCZNY (realna obca domena przy zasiedlonym katalogu dostaje
  //     404 tak samo - dowodzi tego blok 4.3 wyżej);
  //   * `tenantId === null && crawlerDegradeIsSafe === true` zachodzi TYLKO
  //     wtedy, gdy katalog domen jest pusty albo nieosiągalny, a `defaultTenant`
  //     nie istnieje - czyli gdy nie ma czego wyciekać, bo nie ma czego czytać;
  //   * jednoczłonowy warunek nie zacieśniał więc niczego - zamieniał tylko
  //     „katalog nieosiągalny" na 404 na hostach podglądowych i w CI, czyli
  //     był regresją DOSTĘPNOŚCI bez zysku bezpieczeństwa.
  //
  // REGUŁA, którą to ustaliło i którą ten blok przypina: kanał adresowany
  // SAMYM HOSTEM ma stan zdegradowany, kanał adresowany SLUGIEM go nie ma -
  // bez tenanta nie ma czego znaleźć po slugu, więc każda droga kończy się 404
  // i dokładanie tam drugiego członu byłoby gałęzią, której nic nie odróżnia.
  beforeEach(() => {
    // Host podglądowy / nieosiągalny katalog domen: tenanta nie ma, ale
    // degradacja jest bezpieczna.
    state.tenantId = null;
    state.degradeSafe = true;
  });

  it.each([
    ["../podcast.rss[.]xml", "/podcast/rss.xml"],
    ["../live_.rss[.]xml", "/live/rss.xml"],
    ["../tracker.rss[.]xml", "/tracker/rss.xml"],
  ] as const)(
    "kanał adresowany HOSTEM (%s) degraduje do poprawnego, PUSTEGO kanału",
    async (modulePath, label) => {
      const res = await surfaceGet(modulePath);
      expect(res.status, `${label} na hoście podglądowym`).toBe(200);
      const body = await res.text();
      expect(xmlIsWellFormed(body), `${label} musi być domkniętym dokumentem`).toBe(true);
      expect(body).toContain("<rss");
      expect(body, "bez tenanta nie ma czego pokazać").not.toContain("<item>");
    },
  );

  it("degradacja NIE wypuszcza treści - kanał jest pusty, choć czytnik miał dane", async () => {
    // Najważniejsza asercja całego bloku: stan atrapy ma odcinki, dossier
    // i wpisy relacji, a mimo to kanał wychodzi PUSTY - bo trasa nie woła
    // czytnika bez tenanta. Gdyby kiedyś zawołała, TU by to wyszło, zamiast
    // wyjść jako treść jednego obszaru roboczego na cudzej domenie.
    expect(state.podcasts.length, "atrapa MUSI mieć dane, inaczej test jest pusty").toBeGreaterThan(
      0,
    );
    for (const [modulePath, label] of [
      ["../podcast.rss[.]xml", "/podcast/rss.xml"],
      ["../live_.rss[.]xml", "/live/rss.xml"],
      ["../tracker.rss[.]xml", "/tracker/rss.xml"],
    ] as const) {
      const body = await (await surfaceGet(modulePath)).text();
      expect(body, `${label} nie może wypuścić treści bez tenanta`).not.toContain("<item>");
    }
  });

  it.each([
    ["../podcasts.$show.rss[.]xml", "/podcasts/$show/rss.xml", { show: "rozmowy-o-europie" }],
    ["../programs.$slug.rss[.]xml", "/programs/$slug/rss.xml", { slug: "polityka-cyfrowa" }],
    ["../web-stories.$slug.amp", "/web-stories/$slug/amp", { slug: "europa-w-piatke-obrazkow" }],
  ] as const)(
    "powierzchnia adresowana SLUGIEM (%s) nie ma stanu zdegradowanego - 404",
    async (modulePath, label, params) => {
      const res = await surfaceGet(modulePath, params);
      expect(res.status, `${label} bez tenanta nie ma czego znaleźć po slugu`).toBe(404);
    },
  );

  it("pusty kanał zdegradowany dostaje KRÓTKI TTL - inaczej ujednolicenie byłoby wymianą awarii", async () => {
    // To jest drugie pół naprawy N2 i bez niego pierwsze pół byłoby szkodliwe:
    // dołożenie degradacji do kanału podcastu STWORZYŁO nową ścieżkę, na której
    // emitowany jest pusty kanał. Gdyby dostawał TTL kanału pełnego, katalog
    // Apple utrwalałby „audycja bez odcinków" na dobę.
    for (const [modulePath, label, expected] of [
      ["../podcast.rss[.]xml", "/podcast/rss.xml", EMPTY_FEED_CACHE],
      ["../live_.rss[.]xml", "/live/rss.xml", EMPTY_FEED_CACHE],
      ["../tracker.rss[.]xml", "/tracker/rss.xml", EMPTY_FEED_CACHE],
    ] as const) {
      const res = await surfaceGet(modulePath);
      expect(res.headers.get("cache-control"), `${label} TTL zdegradowany`).toBe(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// 4.6 Program / historia nieznane po slugu
// ---------------------------------------------------------------------------

describe("moduł 07: nieznany slug to 404, nie pusty dokument", () => {
  it("/podcasts/$show/rss.xml dla nieistniejącego programu oddaje 404", async () => {
    // Pusty kanał pod adresem skasowanego programu zostaje w czytnikach
    // subskrybentów jako „audycja, która przestała nadawać"; 404 pozwala
    // czytnikowi wypisać kanał.
    state.show = null;
    const res = await surfaceGet("../podcasts.$show.rss[.]xml", { show: "nie-ma-takiego" });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Unknown program");
  });

  it("/programs/$slug/rss.xml dla nieistniejącego programu oddaje 404", async () => {
    state.taxonomy = null;
    const res = await surfaceGet("../programs.$slug.rss[.]xml", { slug: "nie-ma-takiego" });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
  });

  it("/web-stories/$slug/amp dla nieistniejącej historii oddaje 404", async () => {
    state.webStory = null;
    const res = await surfaceGet("../web-stories.$slug.amp", { slug: "nie-ma-takiej" });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
  });

  it("/web-stories/$slug/amp BEZ postera oddaje 404 - lepszy brak wariantu niż wariant nieważny", async () => {
    // `canBuildAmpStory` wymaga postera pionowego i co najmniej jednej strony.
    // Dokument AMP bez postera przechodzi przez nasz builder, ale walidator
    // Google go odrzuca - a odrzucony wariant to gorszy stan niż jego brak,
    // bo `rel=amphtml` na kanonicznej stronie obiecuje dokument, który jest.
    state.webStory = { ...webStory()!, cover_url: null, pages: [] };
    const res = await surfaceGet("../web-stories.$slug.amp", {
      slug: "europa-w-piatke-obrazkow",
    });
    expect(res.status).toBe(404);
  });

  it("kontrola dodatnia: historia Z okładką i stroną DAJE dokument AMP", async () => {
    const res = await surfaceGet("../web-stories.$slug.amp", {
      slug: "europa-w-piatke-obrazkow",
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<amp-story");
    expect(body).toContain("Europa w pięciu obrazkach");
  });
});

// ---------------------------------------------------------------------------
// 4.7 Kanał dwujęzyczny i tożsamość odcinka
//
// CO TU JEST STAWKĄ. Serwis jest dwujęzyczny i kanały są ADRESOWANE JĘZYKIEM
// (`/podcast/rss.xml` kontra `/en/podcast/rss.xml`), więc gałąź EN każdej trasy
// jest połową kontraktu, nie wariantem ozdobnym. Dwie rzeczy mogą tu pójść źle
// cicho:
//   * kanał EN podaje polskie tytuły (albo odwrotnie) - czytelnik dostaje
//     kanał w języku, którego nie zamawiał, i nikt tego nie zgłosi;
//   * `<guid>` odcinka RÓŻNI SIĘ między kanałami językowymi - wtedy czytnik
//     i katalog widzą DWA odcinki tam, gdzie jest jeden, więc subskrybent
//     dostaje ten sam odcinek dwa razy. Trasa dokumentuje to wprost
//     („Tożsamość odcinka jest jedna dla obu kanałów językowych - adres
//     kanoniczny bez prefiksu"), ale nic tego nie pilnowało.
// ---------------------------------------------------------------------------

describe("moduł 07: kanał EN kontra kanał PL", () => {
  /** Przestawia żądanie na wariant angielski (prefiks ścieżki, jak w routerze). */
  function requestEn(path: string): void {
    state.requestUrl = `https://neweuropeanstrategies.com/en${path}`;
  }

  it("/podcast/rss.xml w wariancie EN podaje ANGIELSKIE tytuły i angielski język kanału", async () => {
    requestEn("/podcast/rss.xml");
    const body = await (await surfaceGet("../podcast.rss[.]xml")).text();
    expect(body).toContain("Talking Europe, episode one");
    expect(body, "kanał EN nie może podawać polskiego tytułu").not.toContain(
      "Rozmowy o Europie, odcinek pierwszy",
    );
    expect(body).toContain("<language>en</language>");
  });

  it("kontrola dodatnia: wariant PL podaje POLSKIE tytuły", async () => {
    const body = await (await surfaceGet("../podcast.rss[.]xml")).text();
    expect(body).toContain("Rozmowy o Europie, odcinek pierwszy");
    expect(body).toContain("<language>pl</language>");
  });

  it("guid odcinka jest TEN SAM w obu kanałach językowych - jeden odcinek, jedna tożsamość", async () => {
    const pl = await (await surfaceGet("../podcast.rss[.]xml")).text();
    requestEn("/podcast/rss.xml");
    const en = await (await surfaceGet("../podcast.rss[.]xml")).text();
    const guid = (body: string): string | undefined => /<guid[^>]*>([^<]+)<\/guid>/.exec(body)?.[1];
    expect(guid(pl), "kanał PL musi mieć guid, inaczej test nie dowodzi niczego").toBeDefined();
    expect(guid(en)).toBe(guid(pl));
    expect(guid(pl), "guid jest adresem KANONICZNYM, bez prefiksu języka").not.toContain("/en/");
  });

  it("link odcinka RÓŻNI się między językami, choć guid jest wspólny", async () => {
    // Rozróżnienie względem testu wyżej: tożsamość jest jedna, ale ADRES
    // prowadzi do wersji językowej - inaczej czytnik EN wysyłałby czytelnika
    // na polską stronę odcinka.
    requestEn("/podcast/rss.xml");
    const body = await (await surfaceGet("../podcast.rss[.]xml")).text();
    expect(body).toContain("<link>https://neweuropeanstrategies.com/en/podcast/");
  });

  it("/podcasts/$show/rss.xml w wariancie EN podaje angielski tytuł programu", async () => {
    requestEn("/podcasts/rozmowy-o-europie/rss.xml");
    const body = await (
      await surfaceGet("../podcasts.$show.rss[.]xml", {
        show: "rozmowy-o-europie",
      })
    ).text();
    expect(body).toContain("Talking Europe");
    expect(body).toContain("<language>en</language>");
  });

  it("/live/rss.xml w wariancie EN przepuszcza wpisy EN, a odcina PL", async () => {
    // Wpisy relacji są JEDNOJĘZYCZNE (kolumna `live_blog_entries.lang`), więc
    // filtr języka jest tu treścią kanału, nie kosmetyką.
    state.liveEntries = [
      liveEntry({ id: "pl-1", lang: "pl", bodyHtml: "<p>Wpis polski.</p>" }),
      liveEntry({ id: "en-1", lang: "en", bodyHtml: "<p>English entry.</p>" }),
    ];
    requestEn("/live/rss.xml");
    const body = await (await surfaceGet("../live_.rss[.]xml")).text();
    expect(body).toContain("English entry.");
    expect(body, "kanał EN nie może wpuścić wpisu polskiego").not.toContain("Wpis polski.");
  });

  it("/tracker/rss.xml w wariancie EN podaje angielskie noty dossier", async () => {
    requestEn("/tracker/rss.xml");
    const body = await (await surfaceGet("../tracker.rss[.]xml")).text();
    expect(body).toContain("Digital Services Act");
    expect(body).toContain("<language>en</language>");
  });

  it("/programs/$slug/rss.xml w wariancie EN podaje angielską nazwę programu", async () => {
    requestEn("/programs/polityka-cyfrowa/rss.xml");
    const body = await (
      await surfaceGet("../programs.$slug.rss[.]xml", {
        slug: "polityka-cyfrowa",
      })
    ).text();
    expect(body).toContain("Digital policy");
  });

  it("schemat adresów bierze się z x-forwarded-proto, nie ze zgadywania", async () => {
    // Kanał za terminatorem TLS, który podaje `http`, nie może reklamować
    // adresów `https` - czytnik dostałby link, którego origin nie odpowiada.
    state.requestHeaders = { host: "neweuropeanstrategies.com", "x-forwarded-proto": "http" };
    const body = await (await surfaceGet("../podcast.rss[.]xml")).text();
    expect(body).toContain("<link>http://neweuropeanstrategies.com/podcast/");
  });
});

// ---------------------------------------------------------------------------
// 4.8 Kontrakt <enclosure> i pola iTunes odcinka
//
// KONSEKWENCJA. `<enclosure length type>` jest w kanale podcastowym POLEM
// WYMAGANYM: odtwarzacze używają `length` do pokazania paska postępu przed
// pobraniem całości, a Apple odrzuca kanał, w którym `type` nie zgadza się
// z plikiem. Rozmiar i MIME znamy tylko dla plików z biblioteki mediów, więc
// obie ścieżki - „mamy metadane" i „URL zewnętrzny" - muszą być pokryte.
// ---------------------------------------------------------------------------

describe("moduł 07: enclosure i pola iTunes odcinka", () => {
  it("odcinek z biblioteki mediów dostaje PRAWDZIWY rozmiar i MIME", async () => {
    state.mediaMeta = new Map([
      [
        "https://media.example.org/rozmowy-01.mp3",
        { sizeBytes: 24_117_248, mimeType: "audio/mpeg" },
      ],
    ]);
    const body = await (await surfaceGet("../podcast.rss[.]xml")).text();
    expect(body).toContain('length="24117248"');
    expect(body).toContain('type="audio/mpeg"');
  });

  it("odcinek na URL-u ZEWNĘTRZNYM dostaje length=0 i MIME z rozszerzenia", async () => {
    // Rozróżnienie: bez wpisu w bibliotece mediów nie znamy rozmiaru, a
    // zgadywanie go byłoby gorsze niż zero - odtwarzacz pokazałby fałszywy
    // pasek postępu. MIME da się wyprowadzić z rozszerzenia i to jest zrobione.
    const body = await (await surfaceGet("../podcast.rss[.]xml")).text();
    expect(body).toContain('length="0"');
    expect(body).toContain('type="audio/mpeg"');
  });

  it("odcinek OZNACZONY jako explicit wychodzi z itunes:explicit yes", async () => {
    state.podcasts = [podcastRow({ explicit: true })];
    const body = await (await surfaceGet("../podcast.rss[.]xml")).text();
    expect(body).toContain("<itunes:explicit>yes</itunes:explicit>");
  });

  it("nieznany episode_type degraduje do `full`, a nie do pustego tagu", async () => {
    // `<itunes:episodeType>` przyjmuje dokładnie trzy wartości. Wartość
    // spoza tego zbioru (literówka w panelu, nowa kolumna) nie może wyjść
    // do kanału, bo Apple odrzuca kanał, nie pojedynczy wpis.
    state.podcasts = [podcastRow({ episode_type: "nieistniejacy-typ" })];
    const body = await (await surfaceGet("../podcast.rss[.]xml")).text();
    expect(body).toContain("<itunes:episodeType>full</itunes:episodeType>");
    expect(body).not.toContain("nieistniejacy-typ");
  });

  it.each(["trailer", "bonus"] as const)(
    "episode_type `%s` przechodzi bez zmiany",
    async (kind) => {
      state.podcasts = [podcastRow({ episode_type: kind })];
      const body = await (await surfaceGet("../podcast.rss[.]xml")).text();
      expect(body).toContain(`<itunes:episodeType>${kind}</itunes:episodeType>`);
    },
  );

  it("odcinek bez sezonu i bez numeru nie emituje pustych tagów iTunes", async () => {
    state.podcasts = [podcastRow({ season: null, episode_number: null })];
    const body = await (await surfaceGet("../podcast.rss[.]xml")).text();
    expect(body).not.toContain("<itunes:season>");
    expect(body).not.toContain("<itunes:episode>");
  });

  it("odcinek bez opisu w języku kanału spada na opis z drugiego języka", async () => {
    // Kanał bez opisu odcinka jest gorszy niż kanał z opisem w drugim języku:
    // czytnik pokazuje pustą kartę odcinka, a katalog liczy to jako braki
    // metadanych.
    state.podcasts = [podcastRow({ excerpt_pl: null })];
    const body = await (await surfaceGet("../podcast.rss[.]xml")).text();
    expect(body).toContain("What this season is about.");
  });

  it("odcinek bez ŻADNEGO tytułu spada na slug, a nie na pusty tytuł", async () => {
    state.podcasts = [podcastRow({ title_pl: "", title_en: "" })];
    const body = await (await surfaceGet("../podcast.rss[.]xml")).text();
    expect(body).toContain("rozmowy-o-europie-01");
  });

  it("metadane kanału NIEUSTAWIONE spadają na domyślne marki, nie na pustkę", async () => {
    // Kanał bez `<itunes:image>`, kategorii i właściciela jest odrzucany
    // przez Apple - i to jest awaria cicha (patrz `lib/podcast/applePodcast.ts`).
    state.podcastChannelMeta = null;
    const body = await (await surfaceGet("../podcast.rss[.]xml")).text();
    expect(body).toContain("<itunes:image");
    expect(body).toContain("<itunes:category");
  });

  it("program NADPISUJE metadane kanału sieciowego, a brakujące dziedziczy", async () => {
    state.show = {
      ...podcastShow()!,
      itunes_author: "Autor programu",
      itunes_category: "Society & Culture",
    };
    const body = await (
      await surfaceGet("../podcasts.$show.rss[.]xml", {
        show: "rozmowy-o-europie",
      })
    ).text();
    expect(body, "nadpisanie programu wygrywa").toContain("Autor programu");
    expect(body, "pole nienadpisane dziedziczy z kanału").toContain("redakcja@example.org");
  });

  it("program ZAKOŃCZONY emituje itunes:complete - katalog przestaje czekać na odcinki", async () => {
    state.show = { ...podcastShow()!, itunes_complete: true };
    const body = await (
      await surfaceGet("../podcasts.$show.rss[.]xml", {
        show: "rozmowy-o-europie",
      })
    ).text();
    expect(body).toContain("<itunes:complete>yes</itunes:complete>");
  });

  it("program bez opisu spada na tytuł serwisu, nie na pusty <description>", async () => {
    state.show = { ...podcastShow()!, description_pl: "", description_en: "" };
    const body = await (
      await surfaceGet("../podcasts.$show.rss[.]xml", {
        show: "rozmowy-o-europie",
      })
    ).text();
    expect(/<description>\s*<\/description>/.test(body), "pusty opis kanału").toBe(false);
  });
});

describe("moduł 07: kanał programu - zapasy tytułu i opisu między językami", () => {
  // Program wypełniony tylko w jednym języku jest normalnym stanem redakcji
  // (tłumaczenie wchodzi później). Kanał w drugim języku nie może z tego
  // powodu wyjść bez tytułu - czytnik pokazałby wtedy kanał bez nazwy, a
  // katalog uznałby metadane za niekompletne.
  async function showFeed(params = { show: "rozmowy-o-europie" }): Promise<string> {
    return (await surfaceGet("../podcasts.$show.rss[.]xml", params)).text();
  }

  it("kanał PL programu bez tytułu PL spada na tytuł EN", async () => {
    state.show = { ...podcastShow()!, title_pl: "" };
    expect(await showFeed()).toContain("Talking Europe");
  });

  it("kanał EN programu bez tytułu EN spada na tytuł PL", async () => {
    state.requestUrl = "https://neweuropeanstrategies.com/en/podcasts/rozmowy-o-europie/rss.xml";
    state.show = { ...podcastShow()!, title_en: "" };
    expect(await showFeed()).toContain("Rozmowy o Europie");
  });

  it("program BEZ ŻADNEGO tytułu spada na slug, nie na pusty <title>", async () => {
    state.show = { ...podcastShow()!, title_pl: "", title_en: "" };
    const body = await showFeed();
    expect(body).toContain("rozmowy-o-europie");
    expect(/<title>\s*<\/title>/.test(body), "pusty tytuł kanału").toBe(false);
  });

  it("kanał EN programu bez opisu EN spada na opis PL", async () => {
    state.requestUrl = "https://neweuropeanstrategies.com/en/podcasts/rozmowy-o-europie/rss.xml";
    state.show = { ...podcastShow()!, description_en: "" };
    expect(await showFeed()).toContain("Cykl rozmów o polityce europejskiej.");
  });

  it("odcinek programu bez tytułu w języku kanału spada na drugi język", async () => {
    state.showEpisodes = [podcastRow({ title_pl: "", show_id: "show-1" })];
    expect(await showFeed()).toContain("Talking Europe, episode one");
  });

  it("odcinek programu bez ŻADNEGO opisu nie wywala kanału", async () => {
    state.showEpisodes = [podcastRow({ excerpt_pl: null, excerpt_en: null, show_id: "show-1" })];
    const body = await showFeed();
    expect(xmlIsWellFormed(body), "kanał musi zostać domknięty").toBe(true);
    expect(body).toContain("<item>");
  });
});
