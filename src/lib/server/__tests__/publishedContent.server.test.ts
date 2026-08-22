// @vitest-environment node
//
// Co powierzchnie maszynowe (sitemapa, RSS, news-sitemap, llms.txt) mówią
// światu o treści serwisu - i czego NIE mówią.
//
// CO TO DOWODZI. Ten plik jest jedynym czytnikiem treści dla crawlerów, chodzi
// spod service role (bez RLS) i owija każdy odczyt w 60-sekundowy cache
// brzegowy. Testy są nazwane po skutkach, nie po funkcjach:
//   * ADRES JEST JEDEN - reguła „adres wpisu = pełna ścieżka strony rodzica +
//     slug" ma cztery kopie w dwóch plikach (feed główny, feed taksonomii, feed
//     relacji live, sitemapa). Jeśli którakolwiek policzy inaczej, serwis
//     publikuje dwa adresy tej samej treści: kanoniczny i ten z mapy. Stąd
//     JEDEN test parytetu, a nie cztery osobne;
//   * TREŚĆ BEZ RODZICA WYPADA - wpis, którego strona rodzicielska wróciła do
//     szkicu albo poszła do kosza, nie może wyjechać jako `/undefined/slug`;
//   * AWARIA WYGLĄDA INACZEJ NIŻ PUSTKA - pusty odczyt i odmowa bazy to dwa
//     osobne przypadki w każdym miejscu, gdzie warstwa danych umie zwrócić
//     jedno i drugie. Powierzchnia crawlera ma degradować (pusta lista / null),
//     ale awaria musi zostawić ślad z etykietą, inaczej wypisanie serwisu
//     z indeksu przebiega bez ani jednej linii w logu;
//   * CACHE NIE MYLI NAJEMCÓW ANI WARIANTÓW - klucz musi rozróżniać najemcę,
//     limit i slug; wpis z innym kluczem nie może wrócić jako trafienie.
//
// JAK. Zaślepiona jest DOKŁADNIE jedna granica: klient service-role
// (`@/integrations/supabase/client.server`) i host żądania. Cache brzegowy jest
// PRAWDZIWY - testy klucza i trafienia nie mają sensu na przezroczystej
// atrapie, a `clearEdgeTtlCache()` przed każdym przypadkiem daje izolację.
// Zero sieci, zero zegara: data bazowa ustawiona na sztywno, cache mierzony
// zegarem atrapowanym.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//   * ZAKRESU NAJEMCY (czy każde zapytanie ma `.eq("tenant_id", …)` i czy
//     tenant jest w kluczu cache) pilnuje bramka statyczna
//     `src/lib/server/__tests__/serviceRoleTenantScope.gate.test.ts` - tu nie
//     ma ani jednego testu „czy jest filtr tenanta";
//   * MECHANIKI cache'u brzegowego (skopowanie hostem, okno serve-stale,
//     twarde wygaśnięcie za 5x TTL, single-flight) dowodzi
//     `src/lib/__tests__/ssrCacheHostScope.test.ts`. Tutaj sprawdzamy tylko to,
//     co należy do CZYTNIKA: z czego zbudowany jest jego klucz i czy drugie
//     żądanie nie budzi bazy;
//   * KOLEKTORÓW SITEMAPY (sekcje, priorytety, lastmod, degradacja sekcji)
//     dowodzi `sitemapEntries.server.test.ts` - tu wchodzi tylko `posts`, i to
//     wyłącznie jako czwarta strona parytetu adresów;
//   * RENDERU feedów i plików (`rss.test.ts`, `podcastRss.test.ts`,
//     `newsSitemap.test.ts`, `llms.test.ts`, `machineSurfaces.contract.test.ts`)
//     - ten plik kończy się na WIERSZACH, nie na XML-u;
//   * izolacji najemca-najemca w bazie (RLS) - to pgTAP.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  fail,
  ok,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseFromStub,
  type SupabaseResult,
} from "@/test/supabaseChain";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import { clearEdgeTtlCache } from "@/lib/ssrCache";
import { collectSitemapSection } from "../sitemapEntries.server";
import {
  fetchLiveCoverageEntries,
  fetchMediaMetaByUrls,
  fetchPodcastChannelMeta,
  fetchPublicCategories,
  fetchPublishedPodcasts,
  fetchPublishedPodcastsByShow,
  fetchPublishedPosts,
  fetchPublishedPostsByTaxonomy,
  fetchPublishedShowBySlug,
  fetchPublishedShows,
  fetchPublishedTrackerItems,
  fetchPublishedWebStoryBySlug,
  fetchSeoSettingsValue,
  fetchTaxonomyForFeed,
  fetchTrackerFeedSources,
} from "../publishedContent.server";

const TENANT = "t-nes";
const INNY_NAJEMCA = "t-obcy";
const HOST = "nes.example";
const ORIGIN = `https://${HOST}`;
/** Data bazowa całego pliku - żaden test nie czyta prawdziwego zegara. */
const DATA_BAZOWA = "2026-08-21T10:00:00.000Z";

const STRONA = "p-analizy-prawo";
const SCIEZKA_STRONY = "analizy/prawo";
const SLUG_WPISU = "akt-o-uslugach";
const ADRES_WPISU = `/${SCIEZKA_STRONY}/${SLUG_WPISU}`;

// --------------------------------------------------------------------------
// Zaślepiona granica: klient service-role i host żądania.
// --------------------------------------------------------------------------

const atrapa = vi.hoisted(() => ({
  from: null as ((tabela: string) => unknown) | null,
  rpc: null as ((nazwa: string, args?: Record<string, unknown>) => Promise<unknown>) | null,
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (tabela: string) => {
      if (!atrapa.from) throw new Error("test: atrapa `from` nie została ustawiona");
      return atrapa.from(tabela);
    },
    rpc: (nazwa: string, args?: Record<string, unknown>) => {
      if (!atrapa.rpc) throw new Error("test: atrapa `rpc` nie została ustawiona");
      return atrapa.rpc(nazwa, args);
    },
  },
}));

vi.mock("@/lib/http/requestHost", () => ({
  currentTenantHost: () => Promise.resolve(HOST),
  requestPublicHost: () => HOST,
}));

let db: SupabaseFromStub;
let rpc: SupabaseRpcStub;
let ostrzezenia: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(DATA_BAZOWA));
  clearEdgeTtlCache();
  db = supabaseFromStub();
  rpc = supabaseRpcStub();
  atrapa.from = db.from;
  atrapa.rpc = rpc.rpc;
  ostrzezenia = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// --------------------------------------------------------------------------
// Pomocnicze: wiersze i strażniki (zawężanie w runtime, nie rzutowania).
// --------------------------------------------------------------------------

/** Wszystkie wystąpienia ogniwa - `argsOf` daje tylko pierwsze. */
function ogniwa(lancuch: RecordedChain, metoda: string): unknown[][] {
  return lancuch.calls.filter((c) => c.method === metoda).map((c) => [...c.args]);
}

/** Ostatni łańcuch dla tabeli; brak zapytania to błąd testu, nie `undefined`. */
function lancuch(tabela: string): RecordedChain {
  const wynik = db.lastChain(tabela);
  if (!wynik) throw new Error(`test: kod nie odpytał tabeli "${tabela}"`);
  return wynik;
}

function jestRekordem(wartosc: unknown): wartosc is Record<string, unknown> {
  return typeof wartosc === "object" && wartosc !== null && !Array.isArray(wartosc);
}

function wierszWpisu(nadpisania: Record<string, unknown> = {}) {
  return {
    id: "post-1",
    slug: SLUG_WPISU,
    parent_page_id: STRONA,
    title_pl: "Akt o usługach cyfrowych",
    title_en: "Digital Services Act",
    excerpt_pl: "Zapowiedź",
    excerpt_en: "Teaser",
    cover_image_url: null,
    published_at: "2026-08-10T06:00:00.000Z",
    updated_at: "2026-08-19T08:30:00.000Z",
    seo_noindex: false,
    ...nadpisania,
  };
}

function wierszRelacji(nadpisania: Record<string, unknown> = {}) {
  return {
    id: "wpis-1",
    post_id: "post-1",
    title: "Głosowanie w PE",
    body_html: "<p>Przeszło</p>",
    lang: "pl",
    occurred_at: "2026-08-21T09:45:00.000Z",
    ...nadpisania,
  };
}

function wierszOdcinka(nadpisania: Record<string, unknown> = {}) {
  return {
    slug: "odcinek-12",
    title_pl: "Odcinek 12",
    title_en: "Episode 12",
    excerpt_pl: null,
    excerpt_en: null,
    audio_url: "https://media.example/odcinek-12.mp3",
    duration_seconds: 1800,
    season: 2,
    episode_number: 12,
    cover_image_url: null,
    published_at: "2026-08-18T05:00:00.000Z",
    show_id: "show-1",
    explicit: false,
    episode_type: "full",
    ...nadpisania,
  };
}

/** Odpowiedzi wspólne dla wszystkich powierzchni: strony + ich ścieżki. */
function zaplanujStrony(sciezka: string | null = SCIEZKA_STRONY): void {
  db.setResponse("pages", ok([{ id: STRONA }]));
  rpc.setResponse("page_full_path", (call) =>
    call.arg("_page_id") === STRONA ? ok(sciezka) : ok(null),
  );
}

/** Licznik atrap klienta - patrz komentarz przy `adminSitemapy`. */
let licznikAtrap = 0;

/**
 * Prawdziwy klient Supabase z podstawionym `fetch`, WYŁĄCZNIE dla czwartej
 * strony parytetu: `collectSitemapSection` bierze klienta PARAMETREM, więc
 * atrapa wstrzykiwana mockiem modułu tam nie dojdzie, a `as unknown as
 * SupabaseClient` odciąłby test od kontraktu klienta. Pełna wersja tej atrapy
 * (z zapisem zapytań i planem per tabela) stoi w `sitemapEntries.server.test.ts`
 * i tam należą wszystkie asercje o sekcjach sitemapy.
 */
function adminSitemapy(
  sciezka: string | null,
  wiersze: ReadonlyArray<Record<string, unknown>>,
): SupabaseClient<Database> {
  licznikAtrap += 1;
  return createClient<Database>("https://stub.invalid", "klucz-testowy", {
    // Własny klucz magazynu sesji: przy wspólnym kluczu klient woła
    // `console.warn("Multiple GoTrueClient instances…")`, a tym samym kanałem
    // mierzymy ślad awarii odczytu.
    auth: { persistSession: false, autoRefreshToken: false, storageKey: `atrapa-${licznikAtrap}` },
    global: {
      fetch: (input: RequestInfo | URL) => {
        const { pathname } = new URL(String(input));
        const cialo: unknown = pathname.endsWith("/rpc/page_full_path")
          ? sciezka
          : pathname.endsWith("/pages")
            ? [{ id: STRONA, seo_noindex: false }]
            : wiersze;
        return Promise.resolve(
          new Response(JSON.stringify(cialo), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      },
    },
  });
}

/** Ten sam wpis widziany przez wszystkie cztery powierzchnie. */
async function adresyWszystkichPowierzchni(sciezka: string | null): Promise<{
  feed: string[];
  feedTaksonomii: string[];
  relacjaLive: string[];
  sitemapa: string[];
}> {
  zaplanujStrony(sciezka);
  db.setResponse("posts", ok([wierszWpisu()]));
  db.setResponse("live_blog_entries", ok([wierszRelacji()]));
  db.setResponse("categories", ok({ id: "kat-1" }));
  db.setResponse("post_categories", ok([{ post_id: "post-1" }]));

  const feed = await fetchPublishedPosts(TENANT);
  const feedTaksonomii = await fetchPublishedPostsByTaxonomy(TENANT, "category", "prawo");
  const relacjaLive = await fetchLiveCoverageEntries(TENANT);
  const sitemapa = await collectSitemapSection(
    adminSitemapy(sciezka, [
      { slug: SLUG_WPISU, parent_page_id: STRONA, updated_at: null, published_at: "2026-08-10" },
    ]),
    TENANT,
    ORIGIN,
    "posts",
  );
  return {
    feed: feed.map((w) => w.path),
    feedTaksonomii: feedTaksonomii.map((w) => w.path),
    relacjaLive: relacjaLive.map((w) => w.postPath),
    sitemapa: sitemapa.map((w) => w.loc.slice(ORIGIN.length)),
  };
}

describe("parytet adresów kanonicznych - jedna reguła, cztery kopie", () => {
  it("ten sam wpis dostaje IDENTYCZNY adres w feedzie, w feedzie taksonomii, w relacji live i w sitemapie", async () => {
    const adresy = await adresyWszystkichPowierzchni(SCIEZKA_STRONY);
    expect(adresy).toEqual({
      feed: [ADRES_WPISU],
      feedTaksonomii: [ADRES_WPISU],
      relacjaLive: [ADRES_WPISU],
      sitemapa: [ADRES_WPISU],
    });
    // Jeden zbiór wartości = jedna reguła. Rozjazd którejkolwiek kopii daje
    // dwa adresy tej samej treści (kanoniczny i ten z mapy) i kanibalizację
    // w wynikach wyszukiwania.
    const wszystkie = new Set(Object.values(adresy).flat());
    expect([...wszystkie]).toEqual([ADRES_WPISU]);
  });

  it("wpis bez opublikowanej strony rodzicielskiej znika ze WSZYSTKICH powierzchni naraz", async () => {
    // Rodzic nie ma ścieżki (usunięty / wrócił do szkicu): żadna powierzchnia
    // nie ma prawa wypuścić adresu zbudowanego z `undefined`.
    const adresy = await adresyWszystkichPowierzchni(null);
    expect(adresy).toEqual({ feed: [], feedTaksonomii: [], relacjaLive: [], sitemapa: [] });
  });

  it("pusta ścieżka rodzica nie sklei adresu //slug na ŻADNEJ powierzchni", async () => {
    // Strażnik pustej ścieżki jest w tym repo w dwóch wariantach:
    //   * `publishedContent.server.ts:74` -> `typeof p === "string" && p`
    //     (pusta ścieżka NIE wchodzi do mapy),
    //   * `sitemapEntries.server.ts:76`   -> `typeof p === "string"`
    //     (pusta ścieżka wchodzi do mapy jako "").
    // Dla ADRESU WPISU obie kopie kończą tak samo, bo kolektor `posts` odrzuca
    // ścieżkę fałszywą (`sitemapEntries.server.ts:120-121`) - i właśnie to jest
    // tu przypięte, żeby wyrównywanie tych strażników nie odbyło się kosztem
    // wypuszczenia `//slug`. Skutek samej rozbieżności widać wyłącznie w sekcji
    // `pages` i ma własny zapis w `sitemapEntries.server.test.ts`.
    const adresy = await adresyWszystkichPowierzchni("");
    expect(adresy).toEqual({ feed: [], feedTaksonomii: [], relacjaLive: [], sitemapa: [] });
  });
});

describe("wpis bez rodzica w mapie ścieżek - każda powierzchnia osobno", () => {
  it("feed główny pomija wpis, którego rodzica nie ma w mapie", async () => {
    zaplanujStrony();
    db.setResponse(
      "posts",
      ok([wierszWpisu(), wierszWpisu({ id: "post-2", slug: "sierota", parent_page_id: "p-brak" })]),
    );
    const wpisy = await fetchPublishedPosts(TENANT);
    expect(wpisy.map((w) => w.path)).toEqual([ADRES_WPISU]);
  });

  it("feed taksonomii pomija wpis, którego rodzica nie ma w mapie", async () => {
    zaplanujStrony();
    db.setResponse("tags", ok({ id: "tag-1" }));
    db.setResponse("post_tags", ok([{ post_id: "post-1" }, { post_id: "post-2" }]));
    db.setResponse(
      "posts",
      ok([wierszWpisu(), wierszWpisu({ id: "post-2", slug: "sierota", parent_page_id: "p-brak" })]),
    );
    const wpisy = await fetchPublishedPostsByTaxonomy(TENANT, "tag", "ai-act");
    expect(wpisy.map((w) => w.path)).toEqual([ADRES_WPISU]);
  });

  it("feed relacji live pomija wpisy prowadzone przez posta bez ścieżki", async () => {
    zaplanujStrony();
    db.setResponse(
      "live_blog_entries",
      ok([wierszRelacji(), wierszRelacji({ id: "wpis-2", post_id: "post-2" })]),
    );
    db.setResponse(
      "posts",
      ok([
        { id: "post-1", slug: SLUG_WPISU, parent_page_id: STRONA, title_pl: "A", title_en: "A" },
        { id: "post-2", slug: "sierota", parent_page_id: "p-brak", title_pl: "B", title_en: "B" },
      ]),
    );
    const wpisy = await fetchLiveCoverageEntries(TENANT);
    expect(wpisy.map((w) => [w.id, w.postPath])).toEqual([["wpis-1", ADRES_WPISU]]);
  });

  it("feed relacji live pomija wpisy prowadzone przez posta nieopublikowanego", async () => {
    // Post wrócił do szkicu: zapytanie o posty go nie zwraca, więc wpisy
    // relacji zostają BEZ posta - i muszą wypaść z kanału.
    zaplanujStrony();
    db.setResponse("live_blog_entries", ok([wierszRelacji({ post_id: "post-szkic" })]));
    db.setResponse("posts", ok([]));
    expect(await fetchLiveCoverageEntries(TENANT)).toEqual([]);
  });
});

describe("feed główny - co i w jakiej kolejności wyjeżdża do RSS-a", () => {
  it("wypuszcza tylko treść opublikowaną, nieusuniętą i indeksowalną, najnowszą pierwszą", async () => {
    zaplanujStrony();
    db.setResponse("posts", ok([wierszWpisu()]));
    const wpisy = await fetchPublishedPosts(TENANT, 25);
    expect(wpisy).toHaveLength(1);
    expect(wpisy[0]).toMatchObject({ slug: SLUG_WPISU, path: ADRES_WPISU, seo_noindex: false });

    const zapytanie = lancuch("posts");
    expect(ogniwa(zapytanie, "eq")).toEqual([
      ["tenant_id", TENANT],
      ["status", "published"],
      // Adres, o którym mówimy crawlerowi „nie indeksuj", nie ma prawa być
      // reklamowany w kanale ani w mapie.
      ["seo_noindex", false],
    ]);
    expect(ogniwa(zapytanie, "is")).toEqual([["deleted_at", null]]);
    expect(ogniwa(zapytanie, "order")).toEqual([["published_at", { ascending: false }]]);
    expect(ogniwa(zapytanie, "limit")).toEqual([[25]]);
    expect(String(zapytanie.argsOf("select")?.[0])).toContain("parent_page_id");
  });

  it("mapa ścieżek czyta tylko strony opublikowane i nieusunięte, po jednym RPC na stronę", async () => {
    zaplanujStrony();
    db.setResponse("posts", ok([]));
    await fetchPublishedPosts(TENANT);
    const zapytanie = lancuch("pages");
    expect(ogniwa(zapytanie, "eq")).toEqual([
      ["tenant_id", TENANT],
      ["status", "published"],
    ]);
    expect(ogniwa(zapytanie, "is")).toEqual([["deleted_at", null]]);
    expect(rpc.callsFor("page_full_path").map((c) => c.arg("_page_id"))).toEqual([STRONA]);
  });

  it("brak opublikowanych wpisów to pusty feed BEZ ostrzeżenia w logu", async () => {
    zaplanujStrony();
    db.setResponse("posts", ok([]));
    expect(await fetchPublishedPosts(TENANT)).toEqual([]);
    expect(ostrzezenia).not.toHaveBeenCalled();
  });

  it("odpowiedź bez wierszy (data null) też daje pusty feed, nie wyjątek", async () => {
    zaplanujStrony();
    db.setResponse("posts", ok(null));
    expect(await fetchPublishedPosts(TENANT)).toEqual([]);
  });

  it("awaria mapy ścieżek opróżnia feed i ZOSTAWIA ślad z etykietą", async () => {
    // Osobny przypadek od awarii samych wpisów: to mapa ścieżek pada, a wpisy
    // wracają poprawnie. Bez ścieżki rodzica nie da się złożyć adresu, więc
    // feed jest pusty - ale awaria musi być widoczna w logu.
    db.setResponse("pages", () => {
      throw new Error("pages: połączenie zerwane");
    });
    db.setResponse("posts", ok([wierszWpisu()]));
    expect(await fetchPublishedPosts(TENANT)).toEqual([]);
    expect(ostrzezenia).toHaveBeenCalledWith("[seo] page-paths read failed:", expect.any(Error));
  });

  it.fails("odmowa bazy jest nieodróżnialna od pustego feedu i nie zostawia śladu", async () => {
    // DEFEKT (do decyzji człowieka). Każdy odczyt w tym pliku czyta wyłącznie
    // `data` i porzuca `error` - `publishedContent.server.ts:63, 125, 165, 216,
    // 241, 263, 298, 330, 371, 392, 440, 458, 474, 519, 564, 636, 644, 650, 657,
    // 663, 670, 760, 772`.
    // MECHANIZM: klient Supabase NIE rzuca na odmowie - zwraca
    // `{ data: null, error }`. Skoro nic nie leci wyjątkiem, `resilient`
    // (25-32) nigdy nie łapie, `console.warn` nie zostaje wywołany, a `data ??
    // []` zamienia odmowę w pustą listę. Fallback `resilient` i wynik odmowy są
    // BIT W BIT te same, więc żadna warstwa wyżej nie umie ich rozróżnić.
    // KONSEKWENCJA: `permission denied` po zmianie polityki, timeout puli albo
    // błąd migracji daje kanał RSS i sitemapę, które mówią crawlerowi „ten
    // serwis nie ma już treści". Google wypisuje adresy z indeksu, a w logach
    // nie ma ANI JEDNEJ linii. To dokładnie ta klasa („awaria wygląda jak brak
    // danych"), która w tym repo wystąpiła już trzy razy.
    // DLACZEGO NIE NAPRAWIAM: poprawka to decyzja o kontrakcie powierzchni
    // crawlerowej - czy odmowa ma podnieść wyjątek (wtedy `resilient` loguje
    // i degraduje, ale trzeba przejrzeć wszystkie 23 miejsca), czy ma zostać
    // pustym wynikiem z jawnym logiem i metryką. Wybór należy do człowieka.
    zaplanujStrony();
    db.setResponse("posts", fail("permission denied for table posts", "42501"));
    expect(await fetchPublishedPosts(TENANT)).toEqual([]);
    expect(ostrzezenia).toHaveBeenCalledWith(
      "[seo] published-posts read failed:",
      expect.anything(),
    );
  });
});

describe("kategorie do llms.txt", () => {
  it("zwraca kategorie posortowane po nazwie polskiej", async () => {
    db.setResponse(
      "categories",
      ok([
        {
          slug: "prawo",
          name_pl: "Prawo",
          name_en: "Law",
          description_pl: "Opis",
          description_en: null,
        },
      ]),
    );
    const kategorie = await fetchPublicCategories(TENANT);
    expect(kategorie).toEqual([
      {
        slug: "prawo",
        name_pl: "Prawo",
        name_en: "Law",
        description_pl: "Opis",
        description_en: null,
      },
    ]);
    expect(ogniwa(lancuch("categories"), "order")).toEqual([["name_pl"]]);
  });

  it("brak kategorii to pusta lista, nie null", async () => {
    db.setResponse("categories", ok(null));
    expect(await fetchPublicCategories(TENANT)).toEqual([]);
    expect(ostrzezenia).not.toHaveBeenCalled();
  });
});

describe("kanał podcastowy - odcinki i programy", () => {
  it("czyta opublikowane odcinki najnowszymi od góry, z pustymi datami na końcu", async () => {
    db.setResponse("podcasts", ok([wierszOdcinka()]));
    const odcinki = await fetchPublishedPodcasts(TENANT, 20);
    expect(odcinki.map((o) => o.slug)).toEqual(["odcinek-12"]);
    // Kolumny Apple (explicit / episode_type) muszą przejść przez czytnik -
    // bez nich Apple Podcasts Connect odrzuca kanał.
    expect(odcinki[0]).toMatchObject({ explicit: false, episode_type: "full" });
    const zapytanie = lancuch("podcasts");
    expect(ogniwa(zapytanie, "order")).toEqual([
      ["published_at", { ascending: false, nullsFirst: false }],
    ]);
    expect(ogniwa(zapytanie, "is")).toEqual([["deleted_at", null]]);
    expect(ogniwa(zapytanie, "limit")).toEqual([[20]]);
  });

  it("przycina limit odcinków do przedziału 1-200 (żądanie z zewnątrz nie ustawia rozmiaru odczytu)", async () => {
    db.setResponse("podcasts", ok([]));
    await fetchPublishedPodcasts(TENANT, 5_000);
    expect(ogniwa(lancuch("podcasts"), "limit")).toEqual([[200]]);
    await fetchPublishedPodcasts(TENANT, 0);
    expect(ogniwa(lancuch("podcasts"), "limit")).toEqual([[1]]);
  });

  it("odcinki jednego programu mają własny limit 1-500 i filtr programu", async () => {
    db.setResponse("podcasts", ok([wierszOdcinka()]));
    const odcinki = await fetchPublishedPodcastsByShow(TENANT, "show-1", 900);
    expect(odcinki).toHaveLength(1);
    const zapytanie = lancuch("podcasts");
    expect(ogniwa(zapytanie, "eq")).toEqual([
      ["tenant_id", TENANT],
      ["show_id", "show-1"],
      ["status", "published"],
    ]);
    expect(ogniwa(zapytanie, "limit")).toEqual([[500]]);
    await fetchPublishedPodcastsByShow(TENANT, "show-1", -3);
    expect(ogniwa(lancuch("podcasts"), "limit")).toEqual([[1]]);
  });

  it("program po slugu wraca jednym wierszem, z nadpisaniami Apple", async () => {
    db.setResponse(
      "podcast_shows",
      ok({ id: "show-1", slug: "eurokompas", itunes_explicit: true, itunes_complete: false }),
    );
    const program = await fetchPublishedShowBySlug(TENANT, "eurokompas");
    expect(program).toMatchObject({ slug: "eurokompas", itunes_explicit: true });
    const zapytanie = lancuch("podcast_shows");
    expect(zapytanie.has("maybeSingle")).toBe(true);
    expect(ogniwa(zapytanie, "eq")).toEqual([
      ["tenant_id", TENANT],
      ["slug", "eurokompas"],
      ["status", "published"],
    ]);
  });

  it("nieopublikowany albo nieistniejący program to null, a nie pusty obiekt", async () => {
    db.setResponse("podcast_shows", ok(null));
    expect(await fetchPublishedShowBySlug(TENANT, "brak")).toBeNull();
    expect(ostrzezenia).not.toHaveBeenCalled();
  });

  it("lista programów idzie w kolejności redakcyjnej (sort_order), nie alfabetycznej", async () => {
    db.setResponse("podcast_shows", ok([{ id: "show-1", slug: "eurokompas" }]));
    expect(await fetchPublishedShows(TENANT)).toHaveLength(1);
    expect(ogniwa(lancuch("podcast_shows"), "order")).toEqual([
      ["sort_order", { ascending: true }],
    ]);
  });

  it("metadane kanału Apple: brak singletonu to null (kanał dziedziczy domyślne)", async () => {
    db.setResponse("podcast_settings", ok(null));
    expect(await fetchPodcastChannelMeta(TENANT)).toBeNull();
    expect(lancuch("podcast_settings").has("maybeSingle")).toBe(true);
  });

  it("metadane kanału Apple wracają w całości, gdy singleton istnieje", async () => {
    db.setResponse("podcast_settings", ok({ itunes_author: "NES", itunes_explicit: false }));
    const meta = await fetchPodcastChannelMeta(TENANT);
    expect(meta).toMatchObject({ itunes_author: "NES", itunes_explicit: false });
  });
});

describe("web story dla wariantu AMP", () => {
  it("zwraca opublikowaną historię razem ze stronami", async () => {
    db.setResponse(
      "web_stories",
      ok({ slug: "szczyt-ue", pages: [{ id: 1 }], published_at: "2026-08-20T10:00:00.000Z" }),
    );
    const historia = await fetchPublishedWebStoryBySlug(TENANT, "szczyt-ue");
    expect(historia).toMatchObject({ slug: "szczyt-ue" });
    expect(ogniwa(lancuch("web_stories"), "eq")).toEqual([
      ["tenant_id", TENANT],
      ["slug", "szczyt-ue"],
      ["status", "published"],
    ]);
  });

  it("historia nieopublikowana to null (trasa AMP odpowie 404)", async () => {
    db.setResponse("web_stories", ok(null));
    expect(await fetchPublishedWebStoryBySlug(TENANT, "szkic")).toBeNull();
  });
});

describe("metadane plików do <enclosure> w RSS-ie", () => {
  it("pusta lista adresów NIE odpytuje bazy (kanał bez plików nie budzi tabeli mediów)", async () => {
    const meta = await fetchMediaMetaByUrls(TENANT, []);
    expect(meta.size).toBe(0);
    expect(db.chains).toEqual([]);
  });

  it("adresy puste i powtórzone są odsiane przed zapytaniem", async () => {
    db.setResponse(
      "media",
      ok([{ public_url: "https://m/a.mp3", size_bytes: 12, mime_type: null }]),
    );
    const meta = await fetchMediaMetaByUrls(TENANT, [
      "https://m/a.mp3",
      "https://m/a.mp3",
      "",
      "https://m/b.mp3",
    ]);
    expect(ogniwa(lancuch("media"), "in")).toEqual([
      ["public_url", ["https://m/a.mp3", "https://m/b.mp3"]],
    ]);
    expect(meta.get("https://m/a.mp3")).toEqual({ sizeBytes: 12, mimeType: null });
    // Plik, którego nie ma w bibliotece mediów, NIE dostaje wpisu - kanał
    // emituje wtedy length=0, a nie zmyśloną wartość z innego odcinka.
    expect(meta.has("https://m/b.mp3")).toBe(false);
  });

  it("brak dopasowań to pusta mapa, nie null", async () => {
    db.setResponse("media", ok([]));
    const meta = await fetchMediaMetaByUrls(TENANT, ["https://m/a.mp3"]);
    expect(meta.size).toBe(0);
    expect(ostrzezenia).not.toHaveBeenCalled();
  });
});

describe("ustawienia SEO czytane server-side", () => {
  it("zwraca sam `value` wpisu o kluczu `seo`", async () => {
    db.setResponse("site_settings", ok({ value: { title_pl: "NES" } }));
    const ustawienia = await fetchSeoSettingsValue(TENANT);
    expect(jestRekordem(ustawienia) && ustawienia.title_pl).toBe("NES");
    expect(ogniwa(lancuch("site_settings"), "eq")).toEqual([
      ["tenant_id", TENANT],
      ["key", "seo"],
    ]);
  });

  it("brak wpisu ustawień to null - powierzchnie brane są z wartości domyślnych", async () => {
    db.setResponse("site_settings", ok(null));
    expect(await fetchSeoSettingsValue(TENANT)).toBeNull();
  });

  it("wpis bez pola `value` też daje null, nie undefined", async () => {
    db.setResponse("site_settings", ok({ value: null }));
    expect(await fetchSeoSettingsValue(TENANT)).toBeNull();
  });
});

describe("nagłówek feedu taksonomii - trzy źródła, trzy kształty", () => {
  it("tag: jedna kolumna `name` staje się nazwą w obu językach", async () => {
    // Tagi są jednojęzyczne w bazie, a kanał musi mieć tytuł w obu wersjach.
    db.setResponse("tags", ok({ slug: "ai-act", name: "AI Act" }));
    expect(await fetchTaxonomyForFeed(TENANT, "tag", "ai-act")).toEqual({
      slug: "ai-act",
      name_pl: "AI Act",
      name_en: "AI Act",
      description_pl: null,
      description_en: null,
    });
    expect(db.chainsFor("research_programs")).toEqual([]);
    expect(db.chainsFor("categories")).toEqual([]);
  });

  it("program badawczy: opis kanału bierze się z tagline, i tylko dla opublikowanych", async () => {
    db.setResponse(
      "research_programs",
      ok({
        slug: "rynek-cyfrowy",
        name_pl: "Rynek cyfrowy",
        name_en: "Digital market",
        tagline_pl: "Analizy",
        tagline_en: "Analysis",
      }),
    );
    expect(await fetchTaxonomyForFeed(TENANT, "program", "rynek-cyfrowy")).toEqual({
      slug: "rynek-cyfrowy",
      name_pl: "Rynek cyfrowy",
      name_en: "Digital market",
      description_pl: "Analizy",
      description_en: "Analysis",
    });
    expect(ogniwa(lancuch("research_programs"), "eq")).toEqual([
      ["tenant_id", TENANT],
      ["slug", "rynek-cyfrowy"],
      ["status", "published"],
    ]);
  });

  it("program z brakami: nazwa spada na drugi język, a potem na slug", async () => {
    db.setResponse(
      "research_programs",
      ok({ slug: null, name_pl: null, name_en: "Digital", tagline_pl: null, tagline_en: null }),
    );
    expect(await fetchTaxonomyForFeed(TENANT, "program", "rynek-cyfrowy")).toEqual({
      slug: "rynek-cyfrowy",
      name_pl: "Digital",
      name_en: "Digital",
      description_pl: null,
      description_en: null,
    });
  });

  it("kategoria bez żadnej nazwy dostaje slug jako tytuł kanału (kanał bez tytułu jest nieważny)", async () => {
    db.setResponse(
      "categories",
      ok({
        slug: null,
        name_pl: null,
        name_en: null,
        description_pl: null,
        description_en: null,
      }),
    );
    expect(await fetchTaxonomyForFeed(TENANT, "category", "prawo")).toEqual({
      slug: "prawo",
      name_pl: "prawo",
      name_en: "prawo",
      description_pl: null,
      description_en: null,
    });
  });

  it("kategoria z opisami przechodzi w całości", async () => {
    db.setResponse(
      "categories",
      ok({
        slug: "prawo",
        name_pl: "Prawo",
        name_en: "Law",
        description_pl: "Opis PL",
        description_en: "Opis EN",
      }),
    );
    expect(await fetchTaxonomyForFeed(TENANT, "category", "prawo")).toMatchObject({
      name_pl: "Prawo",
      description_en: "Opis EN",
    });
  });

  it("nieistniejąca taksonomia to null dla KAŻDEGO z trzech rodzajów (trasa odpowie 404)", async () => {
    db.setResponse("tags", ok(null));
    db.setResponse("research_programs", ok(null));
    db.setResponse("categories", ok(null));
    expect(await fetchTaxonomyForFeed(TENANT, "tag", "brak")).toBeNull();
    expect(await fetchTaxonomyForFeed(TENANT, "program", "brak")).toBeNull();
    expect(await fetchTaxonomyForFeed(TENANT, "category", "brak")).toBeNull();
    expect(ostrzezenia).not.toHaveBeenCalled();
  });
});

describe("wpisy feedu taksonomii - trzy różne złączenia", () => {
  it("kategoria: id kategorii, potem złączenie post_categories, potem wpisy", async () => {
    zaplanujStrony();
    db.setResponse("categories", ok({ id: "kat-1" }));
    db.setResponse("post_categories", ok([{ post_id: "post-1" }, { post_id: "post-1" }]));
    db.setResponse("posts", ok([wierszWpisu()]));
    const wpisy = await fetchPublishedPostsByTaxonomy(TENANT, "category", "prawo", 30);
    expect(wpisy.map((w) => w.path)).toEqual([ADRES_WPISU]);
    expect(ogniwa(lancuch("post_categories"), "eq")).toEqual([["category_id", "kat-1"]]);
    // Powtórzone złączenie nie mnoży identyfikatorów w zapytaniu o wpisy.
    expect(ogniwa(lancuch("posts"), "in")).toEqual([["id", ["post-1"]]]);
    expect(ogniwa(lancuch("posts"), "limit")).toEqual([[30]]);
  });

  it("tag: złączenie idzie przez post_tags i kolumnę tag_id", async () => {
    zaplanujStrony();
    db.setResponse("tags", ok({ id: "tag-1" }));
    db.setResponse("post_tags", ok([{ post_id: "post-1" }]));
    db.setResponse("posts", ok([wierszWpisu()]));
    expect(await fetchPublishedPostsByTaxonomy(TENANT, "tag", "ai-act")).toHaveLength(1);
    expect(ogniwa(lancuch("post_tags"), "eq")).toEqual([["tag_id", "tag-1"]]);
    expect(db.chainsFor("post_categories")).toEqual([]);
  });

  it("program: wpisy idą przez KATEGORIĘ programu, nie przez własne złączenie", async () => {
    // Regresja z historii repo: `program` odpytywał tabelę `programs` (hub
    // ekspercki) i junction `post_programs` - rozłączny byt i przestrzeń
    // slugów, więc feed serwował wpisy zupełnie innego programu.
    zaplanujStrony();
    db.setResponse("research_programs", ok({ category_id: "kat-9" }));
    db.setResponse("post_categories", ok([{ post_id: "post-1" }]));
    db.setResponse("posts", ok([wierszWpisu()]));
    expect(await fetchPublishedPostsByTaxonomy(TENANT, "program", "rynek-cyfrowy")).toHaveLength(1);
    expect(ogniwa(lancuch("post_categories"), "eq")).toEqual([["category_id", "kat-9"]]);
    expect(db.chainsFor("post_programs")).toEqual([]);
  });

  it("program bez przypisanej kategorii daje pusty feed BEZ zapytania o złączenie", async () => {
    db.setResponse("research_programs", ok({ category_id: null }));
    expect(await fetchPublishedPostsByTaxonomy(TENANT, "program", "sierota")).toEqual([]);
    expect(db.chainsFor("post_categories")).toEqual([]);
    expect(db.chainsFor("posts")).toEqual([]);
  });

  it("nieistniejąca taksonomia daje pusty feed BEZ zapytania o wpisy", async () => {
    db.setResponse("tags", ok(null));
    expect(await fetchPublishedPostsByTaxonomy(TENANT, "tag", "brak")).toEqual([]);
    expect(db.chainsFor("post_tags")).toEqual([]);
    expect(db.chainsFor("posts")).toEqual([]);
  });

  it("taksonomia bez przypiętych wpisów NIE odpytuje tabeli wpisów", async () => {
    db.setResponse("categories", ok({ id: "kat-1" }));
    db.setResponse("post_categories", ok([]));
    expect(await fetchPublishedPostsByTaxonomy(TENANT, "category", "prawo")).toEqual([]);
    expect(db.chainsFor("posts")).toEqual([]);
    expect(db.chainsFor("pages")).toEqual([]);
    expect(ostrzezenia).not.toHaveBeenCalled();
  });
});

describe("tracker legislacyjny - dossier i ich aktualizacje", () => {
  it("dossier do sitemapy sortują się po RUCHU sprawy, nie po debiucie", async () => {
    db.setResponse(
      "eu_policy_items",
      ok([{ slug: "ai-act", title_pl: "AI Act", stage: "trilog", updated_at: "2026-08-21" }]),
    );
    const dossier = await fetchPublishedTrackerItems(TENANT, 10);
    expect(dossier.map((d) => d.slug)).toEqual(["ai-act"]);
    const zapytanie = lancuch("eu_policy_items");
    expect(ogniwa(zapytanie, "order")).toEqual([["updated_at", { ascending: false }]]);
    expect(ogniwa(zapytanie, "eq")).toEqual([
      ["tenant_id", TENANT],
      ["status", "published"],
    ]);
    expect(ogniwa(zapytanie, "limit")).toEqual([[10]]);
  });

  it("kanał trackera czyta dossier szerszym oknem niż limit kanału", async () => {
    // Scalenie i przycięcie robi builder feedu, więc starsze dossier musi być
    // dostępne jako kontekst swojej świeżej aktualizacji.
    db.setResponse("eu_policy_items", ok([{ id: "d-1", slug: "ai-act" }]));
    db.setResponse("eu_policy_updates", ok([{ id: "u-1", item_id: "d-1", note_pl: "Etap" }]));
    const zrodla = await fetchTrackerFeedSources(TENANT, 50);
    expect(zrodla.items).toHaveLength(1);
    expect(zrodla.updates).toHaveLength(1);
    expect(ogniwa(lancuch("eu_policy_items"), "limit")).toEqual([[200]]);
    expect(ogniwa(lancuch("eu_policy_updates"), "limit")).toEqual([[50]]);
    // Aktualizacje zawężone do dossier, które przeszły filtr publikacji.
    expect(ogniwa(lancuch("eu_policy_updates"), "in")).toEqual([["item_id", ["d-1"]]]);
  });

  it("okno dossier nigdy nie schodzi poniżej 100 wierszy", async () => {
    db.setResponse("eu_policy_items", ok([]));
    await fetchTrackerFeedSources(TENANT, 5);
    expect(ogniwa(lancuch("eu_policy_items"), "limit")).toEqual([[100]]);
  });

  it("brak opublikowanych dossier NIE odpytuje tabeli aktualizacji", async () => {
    db.setResponse("eu_policy_items", ok([]));
    expect(await fetchTrackerFeedSources(TENANT)).toEqual({ items: [], updates: [] });
    expect(db.chainsFor("eu_policy_updates")).toEqual([]);
    expect(ostrzezenia).not.toHaveBeenCalled();
  });

  it("dossier bez aktualizacji dają kanał z samymi dossier", async () => {
    db.setResponse("eu_policy_items", ok([{ id: "d-1", slug: "ai-act" }]));
    db.setResponse("eu_policy_updates", ok(null));
    const zrodla = await fetchTrackerFeedSources(TENANT);
    expect(zrodla.items).toHaveLength(1);
    expect(zrodla.updates).toEqual([]);
  });
});

describe("relacja na żywo - jednostką kanału jest WPIS, nie post", () => {
  it("czyta wpisy z zapasem, bo część wisi na postach, które wróciły do szkicu", async () => {
    zaplanujStrony();
    db.setResponse("live_blog_entries", ok([wierszRelacji()]));
    db.setResponse(
      "posts",
      ok([
        { id: "post-1", slug: SLUG_WPISU, parent_page_id: STRONA, title_pl: "A", title_en: "B" },
      ]),
    );
    const wpisy = await fetchLiveCoverageEntries(TENANT, 5);
    expect(wpisy).toEqual([
      {
        id: "wpis-1",
        postPath: ADRES_WPISU,
        postTitlePl: "A",
        postTitleEn: "B",
        title: "Głosowanie w PE",
        bodyHtml: "<p>Przeszło</p>",
        lang: "pl",
        occurredAt: "2026-08-21T09:45:00.000Z",
      },
    ]);
    expect(ogniwa(lancuch("live_blog_entries"), "limit")).toEqual([[20]]);
    expect(ogniwa(lancuch("live_blog_entries"), "order")).toEqual([
      ["occurred_at", { ascending: false }],
    ]);
    // Posty czytane JEDNYM zapytaniem po odsianych identyfikatorach.
    expect(ogniwa(lancuch("posts"), "in")).toEqual([["id", ["post-1"]]]);
  });

  it("przycina kanał do limitu, choć odczyt brał czterokrotność", async () => {
    zaplanujStrony();
    db.setResponse(
      "live_blog_entries",
      ok([
        wierszRelacji({ id: "w-1" }),
        wierszRelacji({ id: "w-2" }),
        wierszRelacji({ id: "w-3" }),
      ]),
    );
    db.setResponse(
      "posts",
      ok([
        { id: "post-1", slug: SLUG_WPISU, parent_page_id: STRONA, title_pl: "A", title_en: "B" },
      ]),
    );
    const wpisy = await fetchLiveCoverageEntries(TENANT, 2);
    expect(wpisy.map((w) => w.id)).toEqual(["w-1", "w-2"]);
  });

  it("brak wpisów relacji NIE odpytuje ani postów, ani mapy ścieżek", async () => {
    db.setResponse("live_blog_entries", ok([]));
    expect(await fetchLiveCoverageEntries(TENANT)).toEqual([]);
    expect(db.chainsFor("posts")).toEqual([]);
    expect(db.chainsFor("pages")).toEqual([]);
    expect(ostrzezenia).not.toHaveBeenCalled();
  });

  it("odpowiedź bez wierszy (data null) też daje pusty kanał", async () => {
    db.setResponse("live_blog_entries", ok(null));
    expect(await fetchLiveCoverageEntries(TENANT)).toEqual([]);
  });

  it("wpisy relacji czytane są dla postów opublikowanych i indeksowalnych", async () => {
    zaplanujStrony();
    db.setResponse("live_blog_entries", ok([wierszRelacji()]));
    db.setResponse("posts", ok([]));
    await fetchLiveCoverageEntries(TENANT);
    expect(ogniwa(lancuch("posts"), "eq")).toEqual([
      ["tenant_id", TENANT],
      ["status", "published"],
      ["seo_noindex", false],
    ]);
    expect(ogniwa(lancuch("posts"), "is")).toEqual([["deleted_at", null]]);
  });
});

describe("cache brzegowy czytnika - z czego zbudowany jest klucz", () => {
  it("drugie żądanie tej samej listy w oknie 60 s nie budzi bazy", async () => {
    db.setResponse("categories", ok([{ slug: "prawo", name_pl: "Prawo" }]));
    const pierwsze = await fetchPublicCategories(TENANT);
    vi.advanceTimersByTime(59_000);
    const drugie = await fetchPublicCategories(TENANT);
    expect(drugie).toEqual(pierwsze);
    expect(db.chainsFor("categories")).toHaveLength(1);
  });

  it("inny najemca to inny klucz - własne zapytanie i własny wynik", async () => {
    db.setResponse("categories", (l) =>
      ok([{ slug: l.calls.some((c) => c.args.includes(INNY_NAJEMCA)) ? "obcy" : "prawo" }]),
    );
    expect(await fetchPublicCategories(TENANT)).toEqual([{ slug: "prawo" }]);
    expect(await fetchPublicCategories(INNY_NAJEMCA)).toEqual([{ slug: "obcy" }]);
    expect(db.chainsFor("categories")).toHaveLength(2);
  });

  it("inny limit to inny klucz - krótsza lista nie zamraża dłuższej", async () => {
    db.setResponse("podcasts", ok([wierszOdcinka()]));
    await fetchPublishedPodcasts(TENANT, 10);
    await fetchPublishedPodcasts(TENANT, 20);
    await fetchPublishedPodcasts(TENANT, 10);
    expect(db.chainsFor("podcasts").map((l) => ogniwa(l, "limit")[0])).toEqual([[10], [20]]);
  });

  it("inny slug to inny klucz - program A nie odpowiada za program B", async () => {
    db.setResponse("podcast_shows", (l) => ok({ slug: String(l.argsOf("eq")?.[1] ?? "") }));
    expect(await fetchPublishedShowBySlug(TENANT, "eurokompas")).toMatchObject({ slug: TENANT });
    expect(db.chainsFor("podcast_shows")).toHaveLength(1);
    await fetchPublishedShowBySlug(TENANT, "inny-program");
    expect(db.chainsFor("podcast_shows")).toHaveLength(2);
  });

  it("po 60 s wynik jest podawany natychmiast, a odczyt startuje w tle", async () => {
    // Kontrakt cache'u brzegowego (mechanikę dowodzi ssrCacheHostScope.test.ts):
    // powierzchnia crawlera nie blokuje się na round-tripie po wygaśnięciu TTL.
    // Tutaj sprawdzamy, że czytnik naprawdę w tym uczestniczy - czyli że po
    // minucie baza jest odpytana PONOWNIE, a nie że wynik zamarł na godziny.
    db.setResponse("categories", ok([{ slug: "stare" }]));
    expect(await fetchPublicCategories(TENANT)).toEqual([{ slug: "stare" }]);

    vi.advanceTimersByTime(60_001);
    db.setResponse("categories", ok([{ slug: "nowe" }]));
    // Wartość nieświeża wraca NATYCHMIAST - jeszcze przed jakimkolwiek
    // domknięciem mikrozadań, czyli zanim odświeżenie w tle dotknie bazy.
    expect(await fetchPublicCategories(TENANT)).toEqual([{ slug: "stare" }]);

    await vi.advanceTimersByTimeAsync(1);
    // Odświeżenie w tle naprawdę poszło do bazy (drugi łańcuch) i to ono, a nie
    // kolejne żądanie, zapłaciło za round-trip.
    expect(db.chainsFor("categories")).toHaveLength(2);
    expect(await fetchPublicCategories(TENANT)).toEqual([{ slug: "nowe" }]);
    expect(db.chainsFor("categories")).toHaveLength(2);
  });

  it.fails("dwie różne listy plików o wspólnym początku dzielą jeden wpis cache", async () => {
    // DEFEKT (do decyzji człowieka). `publishedContent.server.ts:325` buduje
    // klucz z listy adresów: `unique.slice().sort().join("|").slice(0, 512)`.
    // MECHANIZM: obcięcie do 512 znaków. Publiczny adres pliku z magazynu
    // Supabase ma ~110 znaków, więc już SZÓSTY plik w kanale wypada za granicę
    // klucza - dwie różne listy plików, które zgadzają się na pierwszych pięciu
    // adresach, dostają IDENTYCZNY klucz i przez 60 s współdzielą jeden wynik.
    // KONSEKWENCJA: `fetchMediaMetaByUrls` zwraca mapę zbudowaną dla innego
    // zestawu odcinków, więc RSS podcastu emituje `<enclosure length="0">` dla
    // odcinków, których metadanych w tej mapie nie ma (komentarz przy funkcji
    // dopuszcza length=0 tylko dla plików ZEWNĘTRZNYCH, nie dla wgranych).
    // Apple Podcasts i Spotify traktują brak długości jako błąd elementu -
    // odcinek nie pobiera się w kliencie, a redakcja widzi „opublikowany".
    // DLACZEGO NIE NAPRAWIAM: poprawka to zamiana obcięcia na SKRÓT listy
    // (klucz stałej długości), a wybór funkcji skrótu i jej długości jest
    // decyzją o kolizyjności i o kosztach CPU na krawędzi - do człowieka.
    const dlugiAdres = (numer: string) =>
      `https://przyklad-projektu.supabase.co/storage/v1/object/public/media/podcasty/2026/08/odcinek-${numer}-mix-finalny.mp3`;
    const wspolne = ["01", "02", "03", "04", "05"].map(dlugiAdres);
    const adresA = dlugiAdres("90");
    const adresB = dlugiAdres("91");
    expect(wspolne.join("|").length).toBeGreaterThan(512);

    db.setResponse("media", (l) => {
      const adresy = l.argsOf("in")?.[1];
      const zapytane = Array.isArray(adresy) ? adresy : [];
      return ok(
        zapytane.map((url) => ({ public_url: url, size_bytes: 1024, mime_type: "audio/mpeg" })),
      );
    });
    const metaA = await fetchMediaMetaByUrls(TENANT, [...wspolne, adresA]);
    expect(metaA.has(adresA)).toBe(true);

    const metaB = await fetchMediaMetaByUrls(TENANT, [...wspolne, adresB]);
    expect(db.chainsFor("media")).toHaveLength(2);
    expect(metaB.has(adresB)).toBe(true);
  });
});

// --------------------------------------------------------------------------
// Degradacja: awaria transportu w KAŻDYM czytniku daje bezpieczną wartość
// i JEDEN ślad z etykietą. Powierzchnia crawlera nie ma prawa odpowiedzieć 500.
// --------------------------------------------------------------------------

/** Odpowiedzi towarzyszące - żadna z nich nie jest przedmiotem przypadku. */
function odpowiedziTowarzyszace(): void {
  zaplanujStrony();
  const puste: SupabaseResult = ok([]);
  db.setResponse("posts", ok([wierszWpisu()]));
  db.setResponse("tags", ok({ id: "tag-1" }));
  db.setResponse("post_tags", ok([{ post_id: "post-1" }]));
  db.setResponse("categories", ok({ id: "kat-1" }));
  db.setResponse("post_categories", ok([{ post_id: "post-1" }]));
  db.setResponse("research_programs", ok({ category_id: "kat-9" }));
  db.setResponse("live_blog_entries", ok([wierszRelacji()]));
  db.setResponse("eu_policy_items", ok([{ id: "d-1", slug: "ai-act" }]));
  db.setResponse("eu_policy_updates", puste);
  db.setResponse("media", puste);
  db.setResponse("podcasts", puste);
  db.setResponse("podcast_shows", puste);
  db.setResponse("podcast_settings", ok(null));
  db.setResponse("site_settings", ok(null));
  db.setResponse("web_stories", ok(null));
}

interface PrzypadekAwarii {
  /** Czytnik nazwany po tym, co obsługuje. */
  czytnik: string;
  /** Tabela, której odczyt pada. */
  tabela: string;
  /** Etykieta w logu - po niej operator poznaje, która powierzchnia padła. */
  etykieta: string;
  /** Wartość, na którą czytnik ma zdegradować. */
  oczekiwane: unknown;
  wywolaj: () => Promise<unknown>;
}

const PRZYPADKI_AWARII: readonly PrzypadekAwarii[] = [
  {
    czytnik: "feed główny",
    tabela: "posts",
    etykieta: "published-posts",
    oczekiwane: [],
    wywolaj: () => fetchPublishedPosts(TENANT),
  },
  {
    czytnik: "kategorie llms.txt",
    tabela: "categories",
    etykieta: "categories",
    oczekiwane: [],
    wywolaj: () => fetchPublicCategories(TENANT),
  },
  {
    czytnik: "kanał podcastu",
    tabela: "podcasts",
    etykieta: "podcasts",
    oczekiwane: [],
    wywolaj: () => fetchPublishedPodcasts(TENANT),
  },
  {
    czytnik: "program po slugu",
    tabela: "podcast_shows",
    etykieta: "podcast-show",
    oczekiwane: null,
    wywolaj: () => fetchPublishedShowBySlug(TENANT, "eurokompas"),
  },
  {
    czytnik: "odcinki programu",
    tabela: "podcasts",
    etykieta: "podcasts-by-show",
    oczekiwane: [],
    wywolaj: () => fetchPublishedPodcastsByShow(TENANT, "show-1"),
  },
  {
    czytnik: "lista programów",
    tabela: "podcast_shows",
    etykieta: "podcast-shows",
    oczekiwane: [],
    wywolaj: () => fetchPublishedShows(TENANT),
  },
  {
    czytnik: "web story",
    tabela: "web_stories",
    etykieta: "web-story",
    oczekiwane: null,
    wywolaj: () => fetchPublishedWebStoryBySlug(TENANT, "szczyt-ue"),
  },
  {
    czytnik: "metadane plików",
    tabela: "media",
    etykieta: "media-meta",
    oczekiwane: new Map(),
    wywolaj: () => fetchMediaMetaByUrls(TENANT, ["https://m/a.mp3"]),
  },
  {
    czytnik: "metadane kanału Apple",
    tabela: "podcast_settings",
    etykieta: "podcast-channel-meta",
    oczekiwane: null,
    wywolaj: () => fetchPodcastChannelMeta(TENANT),
  },
  {
    czytnik: "ustawienia SEO",
    tabela: "site_settings",
    etykieta: "settings",
    oczekiwane: null,
    wywolaj: () => fetchSeoSettingsValue(TENANT),
  },
  {
    czytnik: "nagłówek feedu taksonomii",
    tabela: "categories",
    etykieta: "feed-taxonomy",
    oczekiwane: null,
    wywolaj: () => fetchTaxonomyForFeed(TENANT, "category", "prawo"),
  },
  {
    czytnik: "dossier trackera",
    tabela: "eu_policy_items",
    etykieta: "tracker-items",
    oczekiwane: [],
    wywolaj: () => fetchPublishedTrackerItems(TENANT),
  },
  {
    czytnik: "relacja na żywo",
    tabela: "live_blog_entries",
    etykieta: "live-entries",
    oczekiwane: [],
    wywolaj: () => fetchLiveCoverageEntries(TENANT),
  },
  {
    czytnik: "wpisy feedu taksonomii",
    tabela: "tags",
    etykieta: "feed-taxonomy-posts",
    oczekiwane: [],
    wywolaj: () => fetchPublishedPostsByTaxonomy(TENANT, "tag", "ai-act"),
  },
  {
    czytnik: "kanał trackera",
    tabela: "eu_policy_items",
    etykieta: "tracker-feed",
    oczekiwane: { items: [], updates: [] },
    wywolaj: () => fetchTrackerFeedSources(TENANT),
  },
];

describe("degradacja odczytu - awaria zamiast 500 na powierzchni crawlera", () => {
  for (const przypadek of PRZYPADKI_AWARII) {
    it(`${przypadek.czytnik}: zerwany odczyt daje bezpieczną wartość i ślad "${przypadek.etykieta}"`, async () => {
      odpowiedziTowarzyszace();
      db.setResponse(przypadek.tabela, () => {
        throw new Error("połączenie zerwane");
      });
      await expect(przypadek.wywolaj()).resolves.toEqual(przypadek.oczekiwane);
      expect(ostrzezenia).toHaveBeenCalledWith(
        `[seo] ${przypadek.etykieta} read failed:`,
        expect.any(Error),
      );
    });
  }
});

// --------------------------------------------------------------------------
// Druga strona tej samej monety: odpowiedź BEZ wierszy. Klient Supabase daje
// `data: null` i tam, gdzie kod robi `data ?? []`, wynik musi być pustą
// kolekcją - nigdy wyjątkiem i nigdy `undefined` przemyconym dalej.
// --------------------------------------------------------------------------

interface PrzypadekPustki {
  czytnik: string;
  przygotuj: () => void;
  wywolaj: () => Promise<unknown>;
  oczekiwane: unknown;
}

const PRZYPADKI_PUSTKI: readonly PrzypadekPustki[] = [
  {
    czytnik: "mapa ścieżek stron bez wierszy",
    przygotuj: () => {
      db.setResponse("pages", ok(null));
      db.setResponse("posts", ok([wierszWpisu()]));
    },
    wywolaj: () => fetchPublishedPosts(TENANT),
    oczekiwane: [],
  },
  {
    czytnik: "kanał podcastu",
    przygotuj: () => db.setResponse("podcasts", ok(null)),
    wywolaj: () => fetchPublishedPodcasts(TENANT),
    oczekiwane: [],
  },
  {
    czytnik: "odcinki programu",
    przygotuj: () => db.setResponse("podcasts", ok(null)),
    wywolaj: () => fetchPublishedPodcastsByShow(TENANT, "show-1"),
    oczekiwane: [],
  },
  {
    czytnik: "lista programów",
    przygotuj: () => db.setResponse("podcast_shows", ok(null)),
    wywolaj: () => fetchPublishedShows(TENANT),
    oczekiwane: [],
  },
  {
    czytnik: "metadane plików",
    przygotuj: () => db.setResponse("media", ok(null)),
    wywolaj: () => fetchMediaMetaByUrls(TENANT, ["https://m/a.mp3"]),
    oczekiwane: new Map(),
  },
  {
    czytnik: "dossier trackera",
    przygotuj: () => db.setResponse("eu_policy_items", ok(null)),
    wywolaj: () => fetchPublishedTrackerItems(TENANT),
    oczekiwane: [],
  },
  {
    czytnik: "kanał trackera",
    przygotuj: () => db.setResponse("eu_policy_items", ok(null)),
    wywolaj: () => fetchTrackerFeedSources(TENANT),
    oczekiwane: { items: [], updates: [] },
  },
  {
    czytnik: "relacja live bez opublikowanych postów",
    przygotuj: () => {
      zaplanujStrony();
      db.setResponse("live_blog_entries", ok([wierszRelacji()]));
      db.setResponse("posts", ok(null));
    },
    wywolaj: () => fetchLiveCoverageEntries(TENANT),
    oczekiwane: [],
  },
  {
    czytnik: "feed programu bez wierszy złączenia",
    przygotuj: () => {
      db.setResponse("research_programs", ok({ category_id: "kat-9" }));
      db.setResponse("post_categories", ok(null));
    },
    wywolaj: () => fetchPublishedPostsByTaxonomy(TENANT, "program", "rynek-cyfrowy"),
    oczekiwane: [],
  },
  {
    czytnik: "feed kategorii bez wierszy złączenia",
    przygotuj: () => {
      db.setResponse("categories", ok({ id: "kat-1" }));
      db.setResponse("post_categories", ok(null));
    },
    wywolaj: () => fetchPublishedPostsByTaxonomy(TENANT, "category", "prawo"),
    oczekiwane: [],
  },
  {
    czytnik: "feed tagu bez wierszy złączenia",
    przygotuj: () => {
      db.setResponse("tags", ok({ id: "tag-1" }));
      db.setResponse("post_tags", ok(null));
    },
    wywolaj: () => fetchPublishedPostsByTaxonomy(TENANT, "tag", "ai-act"),
    oczekiwane: [],
  },
  {
    czytnik: "feed taksonomii ze złączeniem, ale bez wpisów",
    przygotuj: () => {
      zaplanujStrony();
      db.setResponse("tags", ok({ id: "tag-1" }));
      db.setResponse("post_tags", ok([{ post_id: "post-1" }]));
      db.setResponse("posts", ok(null));
    },
    wywolaj: () => fetchPublishedPostsByTaxonomy(TENANT, "tag", "ai-act"),
    oczekiwane: [],
  },
];

describe("odpowiedź bez wierszy - pustka, nie awaria", () => {
  for (const przypadek of PRZYPADKI_PUSTKI) {
    it(`${przypadek.czytnik}: pusty wynik i ANI JEDNEGO ostrzeżenia w logu`, async () => {
      przypadek.przygotuj();
      await expect(przypadek.wywolaj()).resolves.toEqual(przypadek.oczekiwane);
      // Kluczowa różnica wobec bloku wyżej: brak danych NIE jest awarią, więc
      // log musi milczeć - inaczej operator ściga alarmy pustych serwisów.
      expect(ostrzezenia).not.toHaveBeenCalled();
    });
  }
});

describe("feed taksonomii - domknięcie gałęzi nazw i braków", () => {
  it("program bez nazwy angielskiej bierze polską, a bez żadnej - slug", async () => {
    db.setResponse("research_programs", (l) =>
      l.argsOf("eq")?.[1] === TENANT && l.calls.some((c) => c.args.includes("tylko-pl"))
        ? ok({ slug: "tylko-pl", name_pl: "Rynek", name_en: null })
        : ok({ slug: "bez-nazw", name_pl: null, name_en: null }),
    );
    expect(await fetchTaxonomyForFeed(TENANT, "program", "tylko-pl")).toMatchObject({
      name_pl: "Rynek",
      name_en: "Rynek",
    });
    expect(await fetchTaxonomyForFeed(TENANT, "program", "bez-nazw")).toMatchObject({
      name_pl: "bez-nazw",
      name_en: "bez-nazw",
    });
  });

  it("nieistniejąca kategoria daje pusty feed BEZ zapytania o złączenie", async () => {
    db.setResponse("categories", ok(null));
    expect(await fetchPublishedPostsByTaxonomy(TENANT, "category", "brak")).toEqual([]);
    expect(db.chainsFor("post_categories")).toEqual([]);
    expect(db.chainsFor("posts")).toEqual([]);
  });
});
