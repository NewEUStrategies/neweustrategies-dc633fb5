// Fabryka odpowiedzi feedów taksonomii (`taxonomyFeedResponse`) - jeden backend
// trzech tras: `/category/$slug/rss.xml`, `/tag/$slug/rss.xml`,
// `/programs/$slug/rss.xml`. Do 21.08.2026 plik miał ZERO wykonanych linii.
//
// CO TEN PLIK DOWODZI:
//   1) FAIL-CLOSED PO HOŚCIE - nieznany host to 404 i ZERO odczytów treści.
//      Odczyt jedzie kluczem service role (omija RLS), więc brak zawężenia do
//      tenanta właściciela hosta oznaczałby reklamowanie cudzych treści na
//      cudzej domenie; asercja jest na LICZBIE wywołań atrap, nie tylko na
//      statusie.
//   2) DECYZJĘ 404 KONTRA KANAŁ - wyłączony RSS w ustawieniach i nieistniejąca
//      taksonomia dają 404, ale taksonomia BEZ WPISÓW daje poprawny, PUSTY
//      kanał (kompletny dokument, nie ucięty XML).
//   3) MAPĘ ŚCIEŻEK HUBÓW (`/category/`, `/tag/`, `/programs/`) - to jedyna
//      różnica między trzema trasami, więc `siteUrl` i `feedUrl` są sprawdzone
//      dla każdego rodzaju osobno.
//   4) JĘZYK Z PREFIKSU ADRESU (+ spadek na język domyślny przy zniekształconym
//      adresie) i KAŻDE ramię spadków tytułu/opisu wpisu oraz opisu kanału.
//   5) ORIGIN (host + `x-forwarded-proto`), nagłówki cache i escaping XML.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE:
//   - `rss.test.ts` - format samego dokumentu RSS (`buildRssXml`, `xmlEscape`,
//     RFC 822). Tutaj `buildRssXml`, `parseSeoSettings` i `localizedPath`
//     zostają PRAWDZIWE, więc badana jest kompozycja, a nie format.
//   - `settings.test.ts` - walidacja i wartości domyślne `parseSeoSettings`.
//   - WARSTWA DANYCH: `fetchTaxonomyForFeed` / `fetchPublishedPostsByTaxonomy`
//     (wybór tabel, tabele łączące, obcinanie do limitu w SQL) są atrapami -
//     ten plik sprawdza wyłącznie, Z JAKIMI ARGUMENTAMI są wołane.
//   - `src/lib/tracker/__tests__/feedServer.test.ts` - ta sama mechanika, ale
//     dla kanału trackera (który ma dodatkowo `crawlerDegradeIsSafe`).
//   - E2E: `e2e/seo.spec.ts` dowodzi kanałów BAJTAMI na żywym SSR - testy
//     "rss.xml returns a well-formed feed" i "content feeds respond for the
//     tracker and live coverage". Żaden z jego 15 testów nie dotyka tras
//     taksonomii, a tutaj nie ma ANI JEDNEGO żądania sieciowego ani SSR:
//     wejściem jest atrapa `getRequest`, wyjściem obiekt `Response`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FeedTaxonomyKind,
  PublishedPostRow,
  TaxonomyFeedMeta,
} from "@/lib/server/publishedContent.server";

/** Minimalny kształt żądania, jaki czyta fabryka: adres + nagłówki. */
interface FeedRequest {
  url: string;
  headers: Headers;
}

const state = vi.hoisted(() => ({
  request: null as FeedRequest | null,
  trustedHost: null as string | null,
  tenantId: null as string | null,
  // Surowy blob z `site_settings` - `parseSeoSettings` przyjmuje `unknown`,
  // więc atrapa podaje albo brak wiersza (null), albo częściowe ustawienia.
  settings: null as { rss_enabled?: boolean; rss_item_count?: number } | null,
  taxonomy: null as TaxonomyFeedMeta | null,
  posts: [] as PublishedPostRow[],
  settingsCalls: [] as string[],
  taxonomyCalls: [] as Array<{ tenantId: string; kind: FeedTaxonomyKind; slug: string }>,
  postCalls: [] as Array<{
    tenantId: string;
    kind: FeedTaxonomyKind;
    slug: string;
    limit: number;
  }>,
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => state.request,
}));

vi.mock("@/lib/http/requestHost", () => ({
  trustedPublicHost: () => Promise.resolve(state.trustedHost),
}));

vi.mock("@/lib/server/tenant.server", () => ({
  resolveCrawlerTenantIdForHost: () => Promise.resolve(state.tenantId),
}));

vi.mock("@/lib/server/publishedContent.server", () => ({
  fetchSeoSettingsValue: (tenantId: string) => {
    state.settingsCalls.push(tenantId);
    return Promise.resolve(state.settings);
  },
  fetchTaxonomyForFeed: (tenantId: string, kind: FeedTaxonomyKind, slug: string) => {
    state.taxonomyCalls.push({ tenantId, kind, slug });
    return Promise.resolve(state.taxonomy);
  },
  fetchPublishedPostsByTaxonomy: (
    tenantId: string,
    kind: FeedTaxonomyKind,
    slug: string,
    limit: number,
  ) => {
    state.postCalls.push({ tenantId, kind, slug, limit });
    return Promise.resolve(state.posts);
  },
}));

const { taxonomyFeedResponse } = await import("@/lib/seo/taxonomyFeed.server");

const TENANT = "55555555-5555-4555-8555-555555555555";
const SLUG = "polityka-cyfrowa";
const HOST = "nes.example";

/** Żądanie kanału pod danym adresem publicznym. */
function feedRequest(path: string, headers: Record<string, string> = {}): FeedRequest {
  return { url: `https://${HOST}${path}`, headers: new Headers(headers) };
}

/** Metadane taksonomii - obie nazwy i oba opisy wypełnione. */
function taxonomyMeta(overrides: Partial<TaxonomyFeedMeta> = {}): TaxonomyFeedMeta {
  return {
    slug: SLUG,
    name_pl: "Polityka cyfrowa",
    name_en: "Digital policy",
    description_pl: "Analizy polityki cyfrowej UE",
    description_en: "EU digital policy analyses",
    ...overrides,
  };
}

/** Jeden opublikowany wpis przypięty do taksonomii. */
function publishedPost(overrides: Partial<PublishedPostRow> = {}): PublishedPostRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "akt-o-uslugach",
    parent_page_id: "22222222-2222-4222-8222-222222222222",
    title_pl: "Akt o usługach cyfrowych",
    title_en: "Digital Services Act",
    excerpt_pl: "Streszczenie PL",
    excerpt_en: "Summary EN",
    cover_image_url: null,
    published_at: "2026-01-20T08:00:00.000Z",
    updated_at: "2026-01-21T08:00:00.000Z",
    seo_noindex: false,
    path: "/analizy/akt-o-uslugach",
    ...overrides,
  };
}

/** Treść odpowiedzi feedu dla danego rodzaju taksonomii. */
async function feedXml(kind: FeedTaxonomyKind = "category", slug: string = SLUG): Promise<string> {
  const response = await taxonomyFeedResponse(kind, slug);
  return await response.text();
}

/** Liczba wystąpień znacznika w dokumencie. */
function countTags(xml: string, tag: string): number {
  return (xml.match(new RegExp(`<${tag}>`, "g")) ?? []).length;
}

beforeEach(() => {
  // Kod produkcyjny stempluje copyright rokiem z `new Date()` - zegar musi być
  // ustalony, inaczej test padnie 1 stycznia.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-02-03T10:15:00Z"));
  state.request = feedRequest(`/category/${SLUG}/rss.xml`);
  state.trustedHost = HOST;
  state.tenantId = TENANT;
  state.settings = { rss_enabled: true, rss_item_count: 30 };
  state.taxonomy = taxonomyMeta();
  state.posts = [publishedPost()];
  state.settingsCalls = [];
  state.taxonomyCalls = [];
  state.postCalls = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("taxonomyFeedResponse - rozstrzygnięcie hosta (fail-closed)", () => {
  it("nieznany host daje 404 i ZERO odczytów treści", async () => {
    // Klucz service role omija RLS: gdyby odczyt poszedł bez tenanta, feed
    // reklamowałby treści domyślnego tenanta na cudzej domenie.
    state.tenantId = null;
    const response = await taxonomyFeedResponse("category", SLUG);
    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("Unknown host");
    expect(state.settingsCalls).toHaveLength(0);
    expect(state.taxonomyCalls).toHaveLength(0);
    expect(state.postCalls).toHaveLength(0);
  });

  it("każdy odczyt jest zawężony do tenanta właściciela hosta", async () => {
    await taxonomyFeedResponse("category", SLUG);
    expect(state.settingsCalls).toEqual([TENANT]);
    expect(state.taxonomyCalls).toEqual([{ tenantId: TENANT, kind: "category", slug: SLUG }]);
    expect(state.postCalls[0]?.tenantId).toBe(TENANT);
  });
});

describe("taxonomyFeedResponse - ustawienia redakcyjne", () => {
  it("wyłączony RSS daje 404, a nie pusty kanał", async () => {
    // Redakcja, która wyłączyła RSS, oczekuje, że adres przestanie istnieć -
    // pusty kanał zostałby w czytnikach na zawsze.
    state.settings = { rss_enabled: false };
    const response = await taxonomyFeedResponse("tag", SLUG);
    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("Feed disabled");
    expect(state.taxonomyCalls).toHaveLength(0);
    expect(state.postCalls).toHaveLength(0);
  });

  it("rss_item_count z ustawień jedzie do odczytu wpisów jako CZWARTY argument", async () => {
    // Obcinanie do limitu robi warstwa danych, więc kontraktem fabryki jest sam
    // przekazany argument, a nie liczba pozycji w dokumencie.
    state.settings = { rss_enabled: true, rss_item_count: 7 };
    await taxonomyFeedResponse("program", SLUG);
    expect(state.postCalls).toEqual([{ tenantId: TENANT, kind: "program", slug: SLUG, limit: 7 }]);
  });

  it("brak wiersza ustawień = kanał włączony z limitem domyślnym", async () => {
    state.settings = null;
    const response = await taxonomyFeedResponse("category", SLUG);
    expect(response.status).toBe(200);
    expect(state.postCalls[0]?.limit).toBe(30);
  });
});

describe("taxonomyFeedResponse - taksonomia nieistniejąca i pusta", () => {
  it("nieistniejąca taksonomia daje 404 i nie pyta o wpisy", async () => {
    state.taxonomy = null;
    const response = await taxonomyFeedResponse("category", "nie-ma-takiego-slugu");
    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("Not found");
    expect(state.postCalls).toHaveLength(0);
  });

  it("taksonomia BEZ WPISÓW daje kompletny dokument z zerem pozycji", async () => {
    // Ucięty albo pusty dokument to w czytniku błąd parsowania; poprawny kanał
    // bez pozycji mówi "nic tu jeszcze nie ma" i zostaje w subskrypcjach.
    state.posts = [];
    const response = await taxonomyFeedResponse("category", SLUG);
    expect(response.status).toBe(200);
    const xml = await response.text();
    expect(xml).toMatch(/^<\?xml/);
    expect(xml).toContain("<rss");
    expect(xml).toContain("<channel>");
    expect(xml.trimEnd().endsWith("</rss>")).toBe(true);
    expect(xml).not.toContain("<item>");
    expect(xml).toContain("<title>Polityka cyfrowa - New European Strategies</title>");
  });
});

describe("taxonomyFeedResponse - pozycje kanału", () => {
  it("jeden wpis daje dokładnie jedną pozycję z adresem origin + ścieżka wpisu", async () => {
    const xml = await feedXml();
    expect(countTags(xml, "item")).toBe(1);
    expect(xml).toContain("<link>https://nes.example/analizy/akt-o-uslugach</link>");
    expect(xml).toContain("<title>Akt o usługach cyfrowych</title>");
  });

  it("kilka wpisów zachowuje kolejność z warstwy danych", async () => {
    state.posts = [
      publishedPost({ id: "a", slug: "pierwszy", title_pl: "Pierwszy", path: "/analizy/pierwszy" }),
      publishedPost({ id: "b", slug: "drugi", title_pl: "Drugi", path: "/analizy/drugi" }),
    ];
    const xml = await feedXml();
    expect(countTags(xml, "item")).toBe(2);
    expect(xml.indexOf("Pierwszy")).toBeLessThan(xml.indexOf("Drugi"));
  });
});

describe("taxonomyFeedResponse - mapa ścieżek hubów taksonomii", () => {
  const HUBS: ReadonlyArray<{ kind: FeedTaxonomyKind; hub: string }> = [
    { kind: "category", hub: "/category/polityka-cyfrowa" },
    { kind: "tag", hub: "/tag/polityka-cyfrowa" },
    { kind: "program", hub: "/programs/polityka-cyfrowa" },
  ];

  it.each(HUBS)(
    "$kind: kanał wskazuje hub $hub i sam siebie pod $hub/rss.xml",
    async ({ kind, hub }) => {
      // Ta mapa to JEDYNA różnica między trzema trasami - zły hub oznacza
      // kanał odsyłający czytnika na 404.
      const xml = await feedXml(kind);
      expect(xml).toContain(`<link>https://nes.example${hub}</link>`);
      expect(xml).toContain(`href="https://nes.example${hub}/rss.xml"`);
      expect(state.taxonomyCalls).toEqual([{ tenantId: TENANT, kind, slug: SLUG }]);
    },
  );

  it("prefiks języka wchodzi PRZED ścieżkę huba", async () => {
    state.request = feedRequest(`/en/programs/${SLUG}/rss.xml`);
    const xml = await feedXml("program");
    expect(xml).toContain("<link>https://nes.example/en/programs/polityka-cyfrowa</link>");
    expect(xml).toContain('href="https://nes.example/en/programs/polityka-cyfrowa/rss.xml"');
  });
});

describe("taxonomyFeedResponse - język z prefiksu adresu", () => {
  it("adres nagi daje kanał polski (tytuł, opis i adresy PL)", async () => {
    state.request = feedRequest(`/category/${SLUG}/rss.xml`);
    const xml = await feedXml();
    expect(xml).toContain("<language>pl</language>");
    expect(xml).toContain("<title>Polityka cyfrowa - New European Strategies</title>");
    expect(xml).toContain("Analizy polityki cyfrowej UE");
    expect(xml).toContain("<link>https://nes.example/analizy/akt-o-uslugach</link>");
  });

  it("prefiks /en daje kanał angielski (tytuł, opis i adresy EN)", async () => {
    state.request = feedRequest(`/en/category/${SLUG}/rss.xml`);
    const xml = await feedXml();
    expect(xml).toContain("<language>en</language>");
    expect(xml).toContain("<title>Digital policy - New European Strategies</title>");
    expect(xml).toContain("EU digital policy analyses");
    expect(xml).toContain("<title>Digital Services Act</title>");
    expect(xml).toContain("<link>https://nes.example/en/analizy/akt-o-uslugach</link>");
  });

  it("kanał EN spada na nazwę PL, gdy nazwa EN jest pusta", async () => {
    state.request = feedRequest(`/en/category/${SLUG}/rss.xml`);
    state.taxonomy = taxonomyMeta({ name_en: "" });
    const xml = await feedXml();
    expect(xml).toContain("<title>Polityka cyfrowa - New European Strategies</title>");
  });

  it("zniekształcony adres żądania spada na język domyślny zamiast rzucać", async () => {
    // `new URL(req.url)` stoi w bloku `try` - crawler z rozjechanym adresem ma
    // dostać kanał w języku domyślnym, a nie 500.
    state.request = { url: "to-nie-jest-adres", headers: new Headers() };
    const response = await taxonomyFeedResponse("category", SLUG);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<language>pl</language>");
  });
});

describe("taxonomyFeedResponse - spadki tytułu wpisu", () => {
  it("EN: pusty title_en spada na title_pl", async () => {
    state.request = feedRequest(`/en/category/${SLUG}/rss.xml`);
    state.posts = [publishedPost({ title_en: "" })];
    expect(await feedXml()).toContain("<title>Akt o usługach cyfrowych</title>");
  });

  it("PL: pusty title_pl spada na title_en", async () => {
    state.posts = [publishedPost({ title_pl: "" })];
    expect(await feedXml()).toContain("<title>Digital Services Act</title>");
  });

  it("oba tytuły puste spadają na slug wpisu", async () => {
    // Pozycja bez tytułu jest w czytniku nieklikalna - slug to ostatnia deska.
    state.posts = [publishedPost({ title_pl: "", title_en: "" })];
    expect(await feedXml()).toContain("<title>akt-o-uslugach</title>");
  });

  it("EN: oba tytuły puste spadają na slug również w gałęzi angielskiej", async () => {
    state.request = feedRequest(`/en/category/${SLUG}/rss.xml`);
    state.posts = [publishedPost({ title_pl: "", title_en: "" })];
    expect(await feedXml()).toContain("<title>akt-o-uslugach</title>");
  });
});

describe("taxonomyFeedResponse - spadki opisu wpisu", () => {
  it("EN: pusty excerpt_en spada na excerpt_pl", async () => {
    state.request = feedRequest(`/en/category/${SLUG}/rss.xml`);
    state.posts = [publishedPost({ excerpt_en: "" })];
    expect(await feedXml()).toContain("<description>Streszczenie PL</description>");
  });

  it("EN: wypełniony excerpt_en wygrywa z polskim", async () => {
    state.request = feedRequest(`/en/category/${SLUG}/rss.xml`);
    const xml = await feedXml();
    expect(xml).toContain("<description>Summary EN</description>");
    expect(xml).not.toContain("Streszczenie PL");
  });

  it("PL: brak excerpt_pl spada na excerpt_en", async () => {
    state.posts = [publishedPost({ excerpt_pl: null })];
    expect(await feedXml()).toContain("<description>Summary EN</description>");
  });

  it("oba opisy puste = pozycja bez <description> (opis ma tylko kanał)", async () => {
    state.posts = [publishedPost({ excerpt_pl: null, excerpt_en: null })];
    const xml = await feedXml();
    expect(countTags(xml, "description")).toBe(1);
    expect(xml).toContain("<description>Analizy polityki cyfrowej UE</description>");
  });
});

describe("taxonomyFeedResponse - opis kanału", () => {
  it("PL: brak obu opisów daje polskie zdanie domyślne z nazwą taksonomii", async () => {
    state.taxonomy = taxonomyMeta({ description_pl: "", description_en: null });
    expect(await feedXml()).toContain(
      "<description>Najnowsze analizy: Polityka cyfrowa</description>",
    );
  });

  it("EN: brak obu opisów daje ANGIELSKIE zdanie domyślne, nie polskie", async () => {
    // Kanał EN z polskim zdaniem domyślnym to widoczny błąd w czytniku.
    state.request = feedRequest(`/en/category/${SLUG}/rss.xml`);
    state.taxonomy = taxonomyMeta({ description_pl: null, description_en: "" });
    const xml = await feedXml();
    expect(xml).toContain("<description>Latest analyses: Digital policy</description>");
    expect(xml).not.toContain("Najnowsze analizy");
  });

  it("PL: pusty description_pl spada na description_en", async () => {
    state.taxonomy = taxonomyMeta({ description_pl: "" });
    expect(await feedXml()).toContain("<description>EU digital policy analyses</description>");
  });

  it("EN: pusty description_en spada na description_pl", async () => {
    state.request = feedRequest(`/en/category/${SLUG}/rss.xml`);
    state.taxonomy = taxonomyMeta({ description_en: "" });
    expect(await feedXml()).toContain("<description>Analizy polityki cyfrowej UE</description>");
  });

  it("ZMIERZONE zachowanie: pusta nazwa PL daje tytuł kanału bez nazwy", async () => {
    // Przypięcie stanu faktycznego (patrz `it.fails` poniżej) - gdy ktoś dopisze
    // spadek nazwy PL na EN, ten test zapali się pierwszy.
    state.taxonomy = taxonomyMeta({ name_pl: "", description_pl: "", description_en: null });
    const xml = await feedXml();
    expect(xml).toContain("<title> - New European Strategies</title>");
    expect(xml).toContain("<description>Najnowsze analizy: </description>");
  });

  // DEFEKT: nazwa kanału dla PL to samo `taxonomy.name_pl`, bez spadku na
  // `name_en` - spadek istnieje TYLKO w gałęzi EN (i, dla pozycji, w obie
  // strony). KONSEKWENCJA: taksonomia opisana wyłącznie po angielsku (import,
  // program prowadzony w EN) wystawia na kanale PL tytuł " - New European
  // Strategies" i opis "Najnowsze analizy: " - czytniki RSS zapisują ten tytuł
  // trwale przy subskrypcji, więc późniejsza poprawka treści go nie naprawi.
  it.fails("DEFEKT: kanał PL nie spada na nazwę EN, gdy nazwa PL jest pusta", async () => {
    state.taxonomy = taxonomyMeta({ name_pl: "" });
    expect(await feedXml()).toContain("<title>Digital policy - New European Strategies</title>");
  });
});

describe("taxonomyFeedResponse - origin odpowiedzi", () => {
  it("bez nagłówka protokołu buduje adresy po https", async () => {
    expect(await feedXml()).toContain("<link>https://nes.example/category/polityka-cyfrowa</link>");
  });

  it("honoruje x-forwarded-proto: http z pośrednika", async () => {
    // Za terminatorem TLS oryginalny protokół przychodzi wyłącznie tym
    // nagłówkiem; lokalny podgląd po http dostawałby inaczej adresy https.
    state.request = feedRequest(`/category/${SLUG}/rss.xml`, { "x-forwarded-proto": "http" });
    expect(await feedXml()).toContain("<link>http://nes.example/category/polityka-cyfrowa</link>");
  });

  it("brak zaufanego hosta daje PUSTY origin, a nie adresy cudzego hosta", async () => {
    // Niezaufany nagłówek Host nie może wejść do treści kanału - lepszy adres
    // relatywny niż kanał reklamujący domenę podszywającą się pod nas.
    state.trustedHost = null;
    const xml = await feedXml();
    expect(xml).toContain("<link>/category/polityka-cyfrowa</link>");
    expect(xml).toContain('href="/category/polityka-cyfrowa/rss.xml"');
    expect(xml).not.toContain("nes.example");
  });
});

describe("taxonomyFeedResponse - nagłówki i stopka kanału", () => {
  it("oddaje kanał jako application/rss+xml z UTF-8", async () => {
    const response = await taxonomyFeedResponse("category", SLUG);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/rss+xml; charset=utf-8");
  });

  it("nagłówek cache pozwala pośrednikom trzymać kanał pół godziny", async () => {
    // Czytniki RSS odpytują agresywnie; bez `s-maxage` każde odpytanie
    // schodziłoby do bazy.
    const response = await taxonomyFeedResponse("tag", SLUG);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=300, s-maxage=1800, stale-while-revalidate=86400",
    );
  });

  it("copyright stempluje rok z zegara systemowego", async () => {
    // Zegar ustalony w beforeEach na 2026-02-03 - stąd deterministyczny rok.
    expect(await feedXml()).toContain("<copyright>© 2026 New European Strategies</copyright>");
  });
});

describe("taxonomyFeedResponse - escaping XML", () => {
  it("nazwa taksonomii z & i < wychodzi jako encje, a dokument zostaje parsowalny", async () => {
    state.taxonomy = taxonomyMeta({
      name_pl: "Prawo & <polityka>",
      description_pl: "",
      description_en: null,
    });
    const xml = await feedXml();
    expect(xml).toContain("Prawo &amp; &lt;polityka&gt; - New European Strategies");
    expect(xml).toContain("Najnowsze analizy: Prawo &amp; &lt;polityka&gt;");
    // Dowód parsowalności: surowy `<` rozwaliłby drzewo, a nie tylko tekst.
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    expect(doc.documentElement.nodeName.toLowerCase()).toBe("rss");
    expect(doc.querySelector("channel > title")?.textContent).toBe(
      "Prawo & <polityka> - New European Strategies",
    );
  });

  it("tytuł wpisu z encjami nie rozrywa pozycji", async () => {
    state.posts = [publishedPost({ title_pl: 'Rada UE "&" Parlament' })];
    const xml = await feedXml();
    expect(xml).toContain("Rada UE &quot;&amp;&quot; Parlament");
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    expect(doc.querySelectorAll("item").length).toBe(1);
  });
});
