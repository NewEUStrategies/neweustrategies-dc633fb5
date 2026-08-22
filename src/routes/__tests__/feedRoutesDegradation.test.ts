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
const state = vi.hoisted(() => ({
  /** Host zwracany przez `trustedPublicHost` (null = brak zaufanego hosta). */
  host: "neweuropeanstrategies.com" as string | null,
  /** Tenant hosta (null = nieznany host). */
  tenantId: "t-1" as string | null,
  /** Czy degradacja jest bezpieczna (host podglądowy / pusty katalog domen). */
  degradeSafe: false,
  /** Ustawienia SEO oddawane przez czytnik (null = domyślne). */
  settings: null as unknown,
  /** Sposób, w jaki czytnik wpisów zawodzi - albo dane, gdy nie zawodzi. */
  postsFailure: null as "throw" | "pgError" | null,
  /** Sposób awarii czytnika kategorii (llms.txt). */
  categoriesFailure: null as "throw" | null,
  /** Sposób awarii kolektora sekcji sitemapy. */
  sectionsFailure: null as "throw" | "pgError" | null,
  /** Wpisy sekcji sitemapy zwracane, gdy kolektor nie zawodzi. */
  sectionEntries: [] as Array<{ loc: string; lastmod?: string }>,
}));

/** Rzuca w sposób, jaki wybrał test - albo oddaje pustą listę. */
function failOrEmpty<T>(mode: "throw" | "pgError" | null, empty: T): T {
  if (mode === "throw") throw new Error("czytnik niedostępny");
  if (mode === "pgError") throw pgError("permission denied for table posts", "42501");
  return empty;
}

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () =>
    new Request("https://neweuropeanstrategies.com/", {
      headers: { host: "neweuropeanstrategies.com" },
    }),
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
  fetchPublishedPosts: () => Promise.resolve(failOrEmpty(state.postsFailure, [])),
  fetchPublicCategories: () =>
    Promise.resolve(state.categoriesFailure === "throw" ? failOrEmpty("throw", []) : []),
  fetchPublishedPostsByTaxonomy: () => Promise.resolve(failOrEmpty(state.postsFailure, [])),
  fetchTaxonomyForFeed: () => Promise.resolve(null),
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

const HEALTHY = {
  host: "neweuropeanstrategies.com",
  tenantId: "t-1" as string | null,
  degradeSafe: false,
  settings: null as unknown,
  postsFailure: null,
  categoriesFailure: null,
  sectionsFailure: null,
  sectionEntries: [] as Array<{ loc: string; lastmod?: string }>,
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

/** Odpowiedź jest albo poprawnym dokumentem, albo statusem błędu. Nic trzeciego. */
async function assertNeverTruncated(response: Response, kind: "xml" | "text"): Promise<void> {
  const body = await response.text();
  if (response.status >= 400) {
    // Status błędu jest poprawną odpowiedzią na awarię - crawler ponowi.
    expect(body.length, "status błędu z pustym ciałem jest w porządku").toBeGreaterThanOrEqual(0);
    return;
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
      "permission denied for table posts",
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

  it.fails("DEFEKT: pusty kanał /rss.xml dostaje ten sam DŁUGI TTL co kanał pełny", async () => {
    const { Route } = await import("../rss[.]xml");
    const res = await routeServerHandlers(Route).GET!({});
    const cc = res.headers.get("cache-control") ?? "";
    // KONSEKWENCJA: odpowiedź zdegradowana - pusta, bo katalog domen był
    // nieosiągalny albo tenant się nie rozwiązał - ląduje na brzegu z
    // `s-maxage=1800` i `stale-while-revalidate=86400`. Crawler i czytelnik
    // dostają zapamiętaną PUSTKĘ przez pół godziny, a jako „stale" nawet
    // przez dobę - już po tym, jak baza wróciła. Awaria trwająca sekundy
    // utrwala się na 24 godziny, a jedynym lekarstwem jest ręczne czyszczenie
    // cache. Feed z pustym zbiorem powinien dostać TTL liczony w sekundach
    // albo `no-store`.
    expect(cc, "pusty feed nie może dostać długiego TTL").not.toMatch(/s-maxage=1800/);
    expect(cc, "pusty feed nie może być podawany jako stale przez dobę").not.toMatch(
      /stale-while-revalidate=86400/,
    );
  });

  it("kontrola dodatnia: to JEST dziś nagłówek pustego kanału (naprawa wywali it.fails wyżej)", async () => {
    const { Route } = await import("../rss[.]xml");
    const res = await routeServerHandlers(Route).GET!({});
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

  it.fails(
    "DEFEKT: pusta news-sitemap dostaje ten sam TTL co pełna, mimo że świeżość jest jej całym sensem",
    async () => {
      const { Route } = await import("../news-sitemap[.]xml");
      const res = await routeServerHandlers(Route).GET!({});
      // KONSEKWENCJA: Google News czyta ten plik po to, żeby zobaczyć wpisy
      // z ostatnich 48 h. Pusty dokument zapamiętany na `s-maxage=300` plus
      // `stale-while-revalidate=600` wypada z okna nowości - materiał
      // opublikowany w czasie awarii nigdy nie trafi do News, bo do momentu
      // wygaśnięcia cache przestanie być świeży.
      expect(res.headers.get("cache-control") ?? "").not.toMatch(/stale-while-revalidate/);
    },
  );

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
