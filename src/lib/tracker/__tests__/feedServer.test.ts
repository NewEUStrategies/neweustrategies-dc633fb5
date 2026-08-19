// Odpowiedź kanału RSS trackera (`/tracker/rss.xml`, `/en/tracker/rss.xml`).
//
// DLACZEGO TO MA WŁASNY TEST, SKORO `feed.test.ts` JUŻ ISTNIEJE. Tamten plik
// sprawdza BUDOWĘ POZYCJI feedu (czysty `lib/tracker/feed.ts`). Ten sprawdza
// OBSŁUGĘ ŻĄDANIA, czyli to, czego czysta warstwa nie widzi: rozstrzygnięcie
// tenanta po hoście, decyzję 404 kontra pusty feed, respektowanie ustawień SEO
// i nagłówki cache. Do 18.08.2026 plik miał zero wykonanych linii.
//
// NAJWAŻNIEJSZA REGRESJA, KTÓREJ TU PILNUJEMY. Poprawka z 2026-08-03 dopisała
// drugi człon predykatu bezpieczeństwa: nieznany host przy ZASIEDLONYM
// katalogu domen to 404 (nie wolno reklamować treści domyślnego tenanta na
// cudzej domenie), ale host podglądu albo PUSTY katalog domen to poprawny,
// PUSTY feed. Przed poprawką ten kanał zwracał 404 tam, gdzie `/rss.xml`
// zwracał 200 - i do dziś nie miało to ani jednego testu jednostkowego,
// tylko e2e.
//
// Czyste zależności (`parseSeoSettings`, `buildRssXml`, `buildTrackerFeedItems`,
// `localizedPath`) zostają PRAWDZIWE - dzięki temu test dowodzi realnej
// kompozycji, a nie tego, że atrapy zwracają to, co im podłożono.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  request: null as Request | null,
  trustedHost: null as string | null,
  tenantId: null as string | null,
  degradeSafe: false,
  seoSettings: null as unknown,
  sources: { items: [] as unknown[], updates: [] as unknown[] },
  sourceCalls: [] as Array<{ tenantId: string; limit: number }>,
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => h.request,
}));

vi.mock("@/lib/http/requestHost", () => ({
  trustedPublicHost: () => Promise.resolve(h.trustedHost),
}));

vi.mock("@/lib/server/tenant.server", () => ({
  resolveCrawlerTenantIdForHost: () => Promise.resolve(h.tenantId),
  crawlerDegradeIsSafe: () => Promise.resolve(h.degradeSafe),
}));

vi.mock("@/lib/server/publishedContent.server", () => ({
  fetchSeoSettingsValue: () => Promise.resolve(h.seoSettings),
  fetchTrackerFeedSources: (tenantId: string, limit: number) => {
    h.sourceCalls.push({ tenantId, limit });
    return Promise.resolve(h.sources);
  },
}));

const { trackerFeedResponse } = await import("@/lib/tracker/feed.server");

const TENANT = "44444444-4444-4444-8444-444444444444";

/** Żądanie kanału pod danym adresem i hostem. */
function request(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://nes.example${path}`, { headers });
}

/** Jedno opublikowane dossier - żeby feed miał co wyrenderować. */
function itemSource() {
  return {
    slug: "akt-o-uslugach",
    title_pl: "Akt o usługach cyfrowych",
    title_en: "Digital Services Act",
    summary_pl: "Streszczenie",
    summary_en: "Summary",
    policy_area: "digital",
    stage: "plenary",
    updated_at: "2026-08-10T09:00:00.000Z",
    created_at: "2026-07-01T09:00:00.000Z",
  };
}

beforeEach(() => {
  h.request = request("/tracker/rss.xml");
  h.trustedHost = "nes.example";
  h.tenantId = TENANT;
  h.degradeSafe = false;
  h.seoSettings = { rss_enabled: true, rss_item_count: 20 };
  h.sources = { items: [itemSource()], updates: [] };
  h.sourceCalls = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("trackerFeedResponse - rozstrzygnięcie hosta", () => {
  it("nieznany host przy zasiedlonym katalogu domen daje 404 (fail-closed)", async () => {
    // Nie wolno reklamować treści domyślnego tenanta na cudzej domenie.
    h.tenantId = null;
    h.degradeSafe = false;
    const response = await trackerFeedResponse();
    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("Unknown host");
  });

  it("host podglądu albo pusty katalog domen daje POPRAWNY, PUSTY feed", async () => {
    // To jest dokładnie ta regresja z 2026-08-03: bez drugiego członu predykatu
    // kanał zwracał 404 na hoście podglądu i w CI bez zasianego katalogu, choć
    // `/rss.xml` zwracał tam 200. Nie ma czego wyciekać, więc feed ma być pusty,
    // a nie nieobecny.
    h.tenantId = null;
    h.degradeSafe = true;
    const response = await trackerFeedResponse();
    expect(response.status).toBe(200);
    const xml = await response.text();
    expect(xml).toContain("<rss");
    expect(xml).not.toContain("<item>");
  });

  it("degradacja do pustego feedu NIE pyta bazy o treści", async () => {
    h.tenantId = null;
    h.degradeSafe = true;
    await trackerFeedResponse();
    expect(h.sourceCalls).toHaveLength(0);
  });

  it("pusty host nie wywraca odpowiedzi", async () => {
    h.trustedHost = null;
    h.tenantId = null;
    h.degradeSafe = true;
    await expect(trackerFeedResponse()).resolves.toMatchObject({ status: 200 });
  });
});

describe("trackerFeedResponse - ustawienia redakcyjne", () => {
  it("wyłączony RSS daje 404, a nie pusty kanał", async () => {
    // Redakcja, która wyłączyła RSS, oczekuje, że adres przestanie istnieć -
    // pusty kanał zostawiłby go w czytnikach na zawsze.
    h.seoSettings = { rss_enabled: false };
    const response = await trackerFeedResponse();
    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("Feed disabled");
  });

  it("liczba pozycji z ustawień jedzie do odczytu źródeł", async () => {
    h.seoSettings = { rss_enabled: true, rss_item_count: 7 };
    await trackerFeedResponse();
    expect(h.sourceCalls).toEqual([{ tenantId: TENANT, limit: 7 }]);
  });

  it("odczyt źródeł jest zawężony do tenanta hosta", async () => {
    await trackerFeedResponse();
    expect(h.sourceCalls[0]?.tenantId).toBe(TENANT);
  });
});

describe("trackerFeedResponse - nagłówki i treść", () => {
  it("oddaje kanał RSS z właściwym typem treści", async () => {
    const response = await trackerFeedResponse();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/rss+xml; charset=utf-8");
  });

  it("nagłówek cache pozwala pośrednikom trzymać kanał pół godziny", async () => {
    // Czytniki RSS odpytują agresywnie; bez `s-maxage` każde odpytanie
    // schodziłoby do bazy.
    expect((await trackerFeedResponse()).headers.get("Cache-Control")).toBe(
      "public, max-age=300, s-maxage=1800, stale-while-revalidate=86400",
    );
  });

  it("dossier trafia do kanału jako pozycja", async () => {
    const xml = await (await trackerFeedResponse()).text();
    expect(xml).toContain("Akt o usługach cyfrowych");
    expect(xml).toContain("/tracker/akt-o-uslugach");
  });

  it("kanał wskazuje na hub trackera i na samego siebie", async () => {
    const xml = await (await trackerFeedResponse()).text();
    expect(xml).toContain("https://nes.example/tracker</link>");
    expect(xml).toContain("https://nes.example/tracker/rss.xml");
  });
});

describe("trackerFeedResponse - język z adresu", () => {
  it("adres bez prefiksu daje kanał polski", async () => {
    h.request = request("/tracker/rss.xml");
    const xml = await (await trackerFeedResponse()).text();
    expect(xml).toContain("<language>pl</language>");
  });

  it("prefiks /en daje kanał angielski i angielskie adresy", async () => {
    h.request = request("/en/tracker/rss.xml");
    const xml = await (await trackerFeedResponse()).text();
    expect(xml).toContain("<language>en</language>");
    expect(xml).toContain("https://nes.example/en/tracker");
    expect(xml).toContain("Digital Services Act");
  });

  it("niepoprawny adres żądania spada na język domyślny zamiast rzucać", async () => {
    // `new URL(req.url)` w bloku `try` - żądanie ze zniekształconym adresem
    // ma dać kanał w języku domyślnym, a nie 500 dla crawlera.
    h.request = { url: "nie-jest-adresem", headers: new Headers() } as unknown as Request;
    const response = await trackerFeedResponse();
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<language>pl</language>");
  });
});

describe("trackerFeedResponse - protokół żądania", () => {
  it("domyślnie buduje adresy po https", async () => {
    const xml = await (await trackerFeedResponse()).text();
    expect(xml).toContain("https://nes.example/tracker");
  });

  it("honoruje x-forwarded-proto z pośrednika", async () => {
    // Za terminatorem TLS oryginalny protokół przychodzi wyłącznie tym
    // nagłówkiem; bez niego lokalny podgląd po http budowałby adresy https.
    h.request = request("/tracker/rss.xml", { "x-forwarded-proto": "http" });
    const xml = await (await trackerFeedResponse()).text();
    expect(xml).toContain("http://nes.example/tracker");
  });
});
