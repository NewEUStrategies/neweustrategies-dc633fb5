// Trasa PUBLICZNA `/podcasts` - katalog sieci programów. Do dziś: 0 z 48 linii.
//
// CO DOWODZI TEN PLIK.
//
// To strona wejściowa całej sieci podcastów: linkuje ją nawigacja, kanał RSS
// i katalogi zewnętrzne. Render samego komponentu mija dokładnie tę warstwę,
// w której mieszkają skutki: loader (trzy zapytania RÓWNOLEGLE, każde z własnym
// budżetem), `head()` (biegnie POZA drzewem Reacta) i rozdzielenie „pusto"
// od „nie dojechało".
//
// PIĘĆ REGUŁ, KTÓRYCH ZŁAMANIE KOSZTUJE:
//
//   1. TRZY ZAPYTANIA BIEGNĄ RÓWNOLEGLE, NIE SEKWENCYJNIE. Sekwencyjne `await`
//      sumuje budżety (3 x 4 s), więc sama trasa staje się źródłem wolnego
//      TTFB - i to jest jedyna asercja tego pliku, która mierzy CZAS, bo
//      inaczej regresja jest niewidoczna aż do produkcyjnego incydentu.
//   2. „NIE DOJECHAŁO" NIE MOŻE WYGLĄDAĆ JAK „NIE MA". Pusty katalog i awaria
//      backendu renderują się identycznie, jeśli trasa nie rozdzieli tych
//      dwóch prawd - a czytelnik wychodzi wtedy z wnioskiem, że serwis nie ma
//      podcastów.
//   3. ZDEGRADOWANY RENDER NIE WCHODZI DO WSPÓLNEGO CACHE'A. Bez tego brzeg
//      CDN serwuje pustą powłokę kolejnym czytelnikom przez cały okres
//      świeżości, długo po powrocie backendu.
//   4. NAGŁÓWEK NIESIE OPIS W OBU JĘZYKACH I OGŁASZA KANAŁ SIECIOWY. Bez
//      `<link rel="alternate">` feed podcastu dawał się zasubskrybować
//      wyłącznie po ręcznym wklejeniu adresu - czytniki i Apple nie znają
//      naszej konwencji URL.
//   5. TREŚĆ JEDNEGO OBSZARU ROBOCZEGO NIE WYCHODZI NA HOŚCIE DRUGIEGO.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - 404: ta trasa go NIE MA i mieć nie powinna - `/podcasts` istnieje zawsze,
//   a pusty katalog jest HTTP 200 z uczciwą treścią. Odpowiednikiem „nie ma
//   takiego adresu" jest tu strona programu (`podcastShowRoute.test.tsx`).
// - WARSTWY ZAPYTAŃ: `src/lib/queries/podcasts.ts` biegnie PRAWDZIWA.
// - KANAŁU SIECIOWEGO: `podcast.rss[.]xml.ts` ma kontrakt w
//   `feedRoutesDegradation.test.ts`; tutaj dowodem jest samo OGŁOSZENIE kanału.
// - PARYTETU SŁOWNIKA PL/EN: `src/lib/__tests__/i18nPodcasts.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";

const { TENANT_A, TENANT_B, SHOW_ID } = vi.hoisted(() => ({
  TENANT_A: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  TENANT_B: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  SHOW_ID: "33333333-3333-4333-8333-333333333333",
}));

const h = vi.hoisted(() => ({
  /** Wiersze `podcast_shows` ze WSZYSTKICH obszarów roboczych. */
  shows: [] as Record<string, unknown>[],
  /** Wiersze `podcasts` ze wszystkich obszarów. */
  episodes: [] as Record<string, unknown>[],
  /** Tenant PRZEGLĄDANEJ domeny (rola polityki `public_tenant_id()`). */
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  /** Tabele, których odczyt ma paść (blip backendu). */
  broken: new Set<string>(),
  /** Etykiety odczytów w kolejności. */
  reads: [] as string[],
  /**
   * Sztuczne opóźnienie odpowiedzi (ms) - JEDYNY sposób zmierzenia, czy trzy
   * zapytania loadera biegną równolegle. Przy odpowiedzi natychmiastowej
   * sekwencja i równoległość są nieodróżnialne.
   */
  delayMs: 0,
  /** Adres żądania widziany przez `head()`. */
  requestUrl: "https://nes.example.org/podcasts",
  /** Wartości `Cache-Control`, jakie loader ustawił na odpowiedzi. */
  cacheControl: [] as string[],
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, ok, fail } = await import("@/test/supabase/chain");
  const stub = supabaseFromStub();

  /** Odsiew polityki publicznej: tylko wiersze tenanta przeglądanej domeny. */
  function visible(rows: Record<string, unknown>[]) {
    return rows.filter((row) => row.tenant_id === h.tenantId);
  }

  async function delayed<T>(value: T): Promise<T> {
    if (h.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, h.delayMs));
    return value;
  }

  stub.setResponse("podcast_shows", async () => {
    h.reads.push("podcast_shows:published");
    if (h.broken.has("podcast_shows")) return delayed(fail("test: podcast_shows niedostepna"));
    return delayed(ok(visible(h.shows)));
  });
  stub.setResponse("podcasts", async (chain) => {
    // Katalog czyta `podcasts` DWA RAZY z różnymi kolumnami: pełne wiersze
    // (lista najnowszych) i lekką projekcję (statystyki per program). Etykieta
    // rozdziela je po `select`, bo tylko wtedy pomiar mówi, czego brakuje.
    // `argsOf` oddaje `undefined`, gdy ogniwa nie było - łańcuch bez `select`
    // jest w atrapie legalny, więc indeksowanie musi być opcjonalne.
    const select = chain.argsOf("select")?.[0];
    const isStats = typeof select === "string" && select.startsWith("show_id,");
    h.reads.push(isStats ? "podcasts:stats" : "podcasts:latest");
    if (h.broken.has(isStats ? "podcasts_stats" : "podcasts")) {
      return delayed(fail("test: podcasts niedostepna"));
    }
    return delayed(ok(visible(h.episodes)));
  });
  return { supabase: { from: stub.from } };
});

vi.mock("@/lib/seo/request", () => ({
  getRequestUrl: () => h.requestUrl,
  getOrigin: () => "https://nes.example.org",
}));
vi.mock("@/lib/http/responseHeaders", () => ({
  appendLinkHeader: () => {},
  setCacheControlHeader: (value: string) => void h.cacheControl.push(value),
  readRouteCacheDirective: () => null,
}));

import "@/test/i18nReal";
import { QueryClient } from "@tanstack/react-query";
import i18n from "@/lib/i18n";
import { setClientLang } from "@/lib/i18n/localeRuntime";
import { renderRoute, routeHead, type RouteHeadResult } from "@/test/routeHarness";
import { axeViolations, summarize } from "@/test/axe";
import { Route as PodcastsIndexRoute } from "@/routes/podcasts.index";

const PATH = "/podcasts/";

// ── fixtures (RODO: wszystkie nazwy i tytuły są ZMYŚLONE) ───────────────────

function show(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: SHOW_ID,
    tenant_id: TENANT_A,
    slug: "europa-o-energii",
    title_pl: "Europa o energii",
    title_en: "Europe on energy",
    description_pl: "Cykl o polityce energetycznej Unii.",
    description_en: "A series on the Union's energy policy.",
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

function episode(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    tenant_id: TENANT_A,
    slug: "odcinek-pierwszy",
    title_pl: "Zima bez gazu",
    title_en: "A winter without gas",
    excerpt_pl: "Co się dzieje, gdy magazyny są puste.",
    excerpt_en: "What happens when storage runs dry.",
    show_notes_pl: "",
    show_notes_en: "",
    transcript_pl: "",
    transcript_en: "",
    audio_url: "https://audio.example.org/odc-1.mp3",
    duration_seconds: 1500,
    episode_number: 1,
    season: 1,
    cover_image_url: null,
    status: "published",
    published_at: "2026-03-01T09:00:00.000Z",
    author_id: null,
    show_id: SHOW_ID,
    category_id: null,
    explicit: false,
    episode_type: "full",
    chapters: [],
    quotes: [],
    resources: [],
    created_at: "2026-02-01T09:00:00.000Z",
    updated_at: "2026-03-01T09:00:00.000Z",
    ...patch,
  };
}

async function mount(queryClient?: QueryClient) {
  return renderRoute({
    route: PodcastsIndexRoute,
    path: PATH,
    initialEntry: "/podcasts",
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

/** Pierwszy ogłoszony kanał RSS z `head().links`. */
function feedLink(head: RouteHeadResult): Record<string, unknown> {
  const found = (head.links ?? []).find((link) => link.type === "application/rss+xml");
  if (!found) throw new Error("test: head() nie oglasza kanalu RSS");
  return found;
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  setClientLang("pl");
  h.shows = [show()];
  h.episodes = [episode()];
  h.tenantId = TENANT_A;
  h.broken = new Set<string>();
  h.reads = [];
  h.delayMs = 0;
  h.requestUrl = "https://nes.example.org/podcasts";
  h.cacheControl = [];
});

afterEach(async () => {
  cleanup();
  setClientLang("pl");
  await i18n.changeLanguage("pl");
  vi.restoreAllMocks();
});

describe("trasa /podcasts - katalog programów i najnowsze odcinki", () => {
  it("pokazuje katalog programów PRZED listą odcinków i linkuje do stron programów", async () => {
    // Kolejność jest treścią modelu „sieć programów": strona ma prowadzić do
    // serii, a nie do worka plików audio. Zamiana kolejności zamienia katalog
    // podcastów w kanał RSS w HTML-u.
    await mount();

    const headings = screen.getAllByRole("heading", { level: 2 }).map((el) => el.textContent);
    expect(headings).toEqual(["Programy", "Najnowsze odcinki"]);
    // `getAllBy`, nie `getBy`: nazwa programu jest CZĘŚCIĄ dostępnej nazwy
    // linku do odcinka (nadtytuł karty), więc dopasowań jest dwa - i to jest
    // poprawne. Dowodem jest tu obecność linku do strony PROGRAMU.
    const hrefs = screen
      .getAllByRole("link", { name: /Europa o energii/ })
      .map((el) => el.getAttribute("href"));
    expect(hrefs).toContain("/podcasts/europa-o-energii");
  });

  it("karta programu niesie LICZNIK odcinków w polskiej formie liczby mnogiej", async () => {
    // Polski ma trzy formy istotne dla liczb. Karta katalogu pokazywała
    // wcześniej skrót „odc." dla każdej liczby - licznik jest tu jedyną
    // informacją o tym, czy program w ogóle żyje.
    h.episodes = [
      episode(),
      episode({ id: "22222222-2222-4222-8222-222222222222", slug: "drugi" }),
      episode({ id: "33333333-3333-4333-8333-333333333334", slug: "trzeci" }),
    ];
    await mount();

    expect(screen.getByText(/3 odcinki/)).toBeInTheDocument();
  });

  it("odcinek jest podpisany nazwą swojego programu, nie samym numerem", async () => {
    // Bez mapy `show_id -> tytuł` lista najnowszych traci kontekst serii,
    // a jest to jedyne miejsce, w którym czytelnik widzi obie rzeczy naraz.
    await mount();

    expect(screen.getByRole("link", { name: /Zima bez gazu/ })).toHaveAttribute(
      "href",
      "/podcast/odcinek-pierwszy",
    );
    expect(screen.getAllByText("Europa o energii").length).toBeGreaterThan(0);
  });

  it("ogłasza kanał sieciowy także w TREŚCI strony, nie tylko w nagłówku", async () => {
    await mount();

    expect(screen.getByRole("link", { name: /RSS/ })).toHaveAttribute("href", "/podcast/rss.xml");
  });

  it("nie zostawia katalogu z wadami dostępności", async () => {
    const view = await mount();
    await screen.findByRole("heading", { level: 1, name: "Podcast" });

    const violations = await axeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("trasa /podcasts - pusto kontra nie dojechało", () => {
  it("brak odcinków to KOMUNIKAT, nie pusta sekcja bez wyjaśnienia", async () => {
    h.episodes = [];
    await mount();

    expect(screen.getByText("Brak opublikowanych odcinków.")).toBeInTheDocument();
    // Katalog programów zostaje - program bez odcinków to normalny stan.
    expect(screen.getByRole("heading", { name: "Programy" })).toBeInTheDocument();
  });

  it("brak programów UKRYWA sekcję katalogu zamiast pokazywać puste płótno", async () => {
    h.shows = [];
    await mount();

    expect(screen.queryByRole("heading", { name: "Programy" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Najnowsze odcinki" })).toBeInTheDocument();
  });

  it("pusty katalog to HTTP 200 z treścią - trasa NIE MA i nie potrzebuje 404", async () => {
    // `/podcasts` istnieje zawsze. `notFoundComponent` na stronie zbiorczej
    // zamieniłby „redakcja jeszcze nic nie opublikowała" w „tego adresu nie
    // ma" - a to wyrzuciłoby stronę wejściową sieci z indeksu.
    h.shows = [];
    h.episodes = [];
    await mount();

    expect(PodcastsIndexRoute.options.notFoundComponent).toBeUndefined();
    expect(screen.getByRole("heading", { level: 1, name: "Podcast" })).toBeInTheDocument();
    expect(screen.getByText("Brak opublikowanych odcinków.")).toBeInTheDocument();
  });

  it("AWARIA BACKENDU mówi wprost, co się stało - nie udaje pustej sieci", async () => {
    // Gdyby degradacja renderowała pusty stan, czytelnik wyszedłby z wnioskiem,
    // że serwis nie ma podcastów, a monitoring nie widziałby niczego.
    h.broken.add("podcasts");
    await mount();

    await waitFor(() =>
      expect(screen.getByText("Nie udało się załadować podcastów")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Brak opublikowanych odcinków.")).toBeNull();
  });

  it("po angielsku komunikat awarii też jest angielski", async () => {
    await i18n.changeLanguage("en");
    setClientLang("en");
    h.broken.add("podcasts");
    await mount();

    await waitFor(() => expect(screen.getByText("Couldn't load podcasts")).toBeInTheDocument());
  });

  it("degradacja JEDNEGO z trzech zapytań już zdejmuje render ze wspólnego cache'a", async () => {
    // Statystyki są tylko dekoracją kart, ale render bez nich jest niepełny -
    // i nie wolno go utrwalić na brzegu CDN dla kolejnych czytelników.
    h.broken.add("podcasts_stats");
    await mount();

    expect(h.cacheControl.at(-1)).toContain("no-store");
  });

  it("KONTROLA DODATNIA: czysty render deklaruje politykę TREŚCI, nie no-store", async () => {
    await mount();

    expect(h.cacheControl.at(-1)).toContain("s-maxage");
    expect(h.cacheControl.at(-1)).not.toContain("no-store");
  });
});

describe("trasa /podcasts - izolacja obszarów roboczych", () => {
  it("program i odcinek innego obszaru nie pojawiają się na tym hoście", async () => {
    // Autorytetem jest polityka publiczna (`tenant_id = public_tenant_id()`).
    // Ten test pilnuje SKUTKU: katalog tego hosta zawiera tylko jego treść.
    h.shows = [
      show(),
      show({
        id: "77777777-7777-4777-8777-777777777777",
        tenant_id: TENANT_B,
        slug: "obcy",
        title_pl: "Program obcego obszaru",
      }),
    ];
    h.episodes = [
      episode(),
      episode({
        id: "88888888-8888-4888-8888-888888888888",
        tenant_id: TENANT_B,
        slug: "odcinek-obcy",
        title_pl: "Odcinek obcego obszaru",
      }),
    ];
    await mount();

    const hrefs = screen
      .getAllByRole("link", { name: /Europa o energii/ })
      .map((el) => el.getAttribute("href"));
    expect(hrefs).toContain("/podcasts/europa-o-energii");
    expect(screen.queryByText("Program obcego obszaru")).toBeNull();
    expect(screen.queryByText("Odcinek obcego obszaru")).toBeNull();
  });

  it("KONTROLA DODATNIA: na hoście drugiego obszaru widać JEGO treść", async () => {
    // Bez tej pary poprzedni test przechodziłby też wtedy, gdyby katalog nie
    // renderował niczego - a to nie jest izolacja, tylko awaria.
    h.shows = [show({ tenant_id: TENANT_B, title_pl: "Program obcego obszaru" })];
    h.episodes = [];
    h.tenantId = TENANT_B;
    await mount();

    expect(screen.getByText("Program obcego obszaru")).toBeInTheDocument();
  });
});

describe("trasa /podcasts - nagłówek dokumentu", () => {
  it("po polsku opis i tytuł kanału są polskie", async () => {
    const head = routeHead(PodcastsIndexRoute);

    expect(headTitle(head)).toBe("Podcast - New European Strategies");
    expect(metaContent(head, "name", "description")).toBe(
      "Sieć podcastów New European Strategies - przeglądaj programy i słuchaj najnowszych odcinków.",
    );
    expect(metaContent(head, "httpEquiv", "content-language")).toBe("pl");
    expect(feedLink(head).title).toBe("Podcast NES - RSS");
  });

  it("na adresie /en opis i tytuł kanału są angielskie", async () => {
    // `head()` biegnie POZA drzewem Reacta, więc o języku rozstrzyga wyłącznie
    // prefiks adresu - nie stan i18next w przeglądarce.
    h.requestUrl = "https://nes.example.org/en/podcasts";
    const head = routeHead(PodcastsIndexRoute);

    expect(metaContent(head, "name", "description")).toBe(
      "New European Strategies podcast network - browse programs and listen to the latest episodes.",
    );
    expect(metaContent(head, "httpEquiv", "content-language")).toBe("en");
    expect(feedLink(head).title).toBe("NES Podcast - RSS");
  });

  it("kanał EN prowadzi pod adres z prefiksem językowym, nie pod polski", async () => {
    // `feedAlternateLink` lokalizuje ścieżkę - bez tego czytelnik EN dostawałby
    // kanał polski i nigdy by nie zauważył, że subskrybuje inny język.
    h.requestUrl = "https://nes.example.org/en/podcasts";
    const en = String(feedLink(routeHead(PodcastsIndexRoute)).href);

    h.requestUrl = "https://nes.example.org/podcasts";
    const pl = String(feedLink(routeHead(PodcastsIndexRoute)).href);

    expect(en).not.toBe(pl);
    expect(en).toContain("/en/");
    expect(pl).not.toContain("/en/");
  });

  it("pusty getRequestUrl spada na '/podcasts', a nie na pusty adres kanoniczny", async () => {
    // Bez adresu kanonicznego wyszukiwarka sama wybiera adres reprezentatywny
    // i potrafi zindeksować wariant z parametrami kampanii jako osobną stronę.
    h.requestUrl = "";
    const head = routeHead(PodcastsIndexRoute);
    const canonical = (head.links ?? []).find((link) => link.rel === "canonical");

    expect(canonical?.href).toBe("/podcasts");
  });
});

// ── N5: LICZBA ZAPYTAŃ NA PIERWSZYM MALOWANIU + RÓWNOLEGŁOŚĆ ────────────────
//
// POMIAR, NIE OPINIA. `measureFirstPaint` rozdziela odczyty LOADERA (serwer,
// przed pierwszym bajtem HTML) od odczytów KLIENTA (start na montażu, czyli
// round-tripy PO hydratacji). Rozdzielenie działa, bo loader zasiewa cache
// zapytań, a ten jedzie do przeglądarki w dehydrowanym ładunku SSR.
//
// ZMIERZONE: loader 3 odczyty, klient 0. Ta trasa jest WZORCEM dla pozostałych
// czterech tej rodziny - cała jej treść jest publiczna i cała jest zasiana, więc
// zapadka stoi na ZERZE. Dopisanie tu `useQuery` bez zasiewu w loaderze ma
// wywalić test, a nie przejść niezauważone.
interface FirstPaintMeasurement {
  loaderReads: string[];
  clientReads: string[];
}

type IndexLoader = (ctx: { context: { queryClient: QueryClient } }) => Promise<unknown>;

function indexLoader(): IndexLoader {
  const loader = PodcastsIndexRoute.options.loader;
  if (typeof loader !== "function") throw new Error("test: trasa nie ma loadera");
  return loader as IndexLoader;
}

async function measureFirstPaint(): Promise<FirstPaintMeasurement> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await indexLoader()({ context: { queryClient } });
  const loaderReads = [...h.reads];

  const view = await mount(queryClient);
  await screen.findByRole("heading", { level: 1 });
  await waitFor(() => expect(view.queryClient.isFetching()).toBe(0));

  return { loaderReads, clientReads: h.reads.slice(loaderReads.length) };
}

describe("trasa /podcasts - zapadka na liczbie zapytań pierwszego malowania", () => {
  it("nie robi ANI JEDNEGO zapytania klienckiego na pierwszym malowaniu", async () => {
    const { loaderReads, clientReads } = await measureFirstPaint();

    expect([...loaderReads].sort()).toEqual([
      "podcast_shows:published",
      "podcasts:latest",
      "podcasts:stats",
    ]);
    expect(clientReads, `odczyty klienta: ${clientReads.join(", ")}`).toEqual([]);
  });

  it("trzy zapytania loadera biegną RÓWNOLEGLE - wall-clock to jeden budżet", async () => {
    // JEDYNA asercja czasowa w tym pliku, i to celowo: sekwencyjne `await`
    // sumowałoby budżety (3 x 4 s = 12 s przy niedostępnym backendzie), więc
    // sama strona wejściowa sieci stałaby się źródłem wolnego TTFB. Regresja
    // jest niewidoczna w każdym innym teście, bo WYNIK jest identyczny.
    // Próg jest luźny (2,5 x opóźnienie jednej odpowiedzi), żeby nie mierzyć
    // szybkości maszyny CI - odróżnia 1 x 60 ms od 3 x 60 ms, nic więcej.
    h.delayMs = 60;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const started = Date.now();
    await indexLoader()({ context: { queryClient } });
    const elapsed = Date.now() - started;

    expect(h.reads).toHaveLength(3);
    expect(elapsed, `loader trwal ${elapsed} ms przy 3 x ${h.delayMs} ms`).toBeLessThan(
      h.delayMs * 2.5,
    );
  });
});

// ---------------------------------------------------------------------------
// OGŁASZANIE KANAŁU kontra `rss_enabled` - defekt REPO-WIDE, przypięty
//
// ZNALEZIONE PRZEGLĄDEM ADWERSARIALNYM 2026-09-02, po tym jak kampania modułu
// 07 podpięła oba kanały podcastu pod przełącznik `rss_enabled` (dotąd były
// JEDYNYMI kanałami RSS w repozytorium, których redakcja nie mogła wyłączyć).
//
// KONSEKWENCJA. Redakcja gasi „RSS" w ustawieniach SEO -> `/podcast/rss.xml`
// oddaje 404 „Feed disabled", ale PIĘĆ powierzchni ogłasza ten kanał
// BEZWARUNKOWO: `<link rel="alternate">` tej trasy, WIDOCZNY dla człowieka
// przycisk „RSS" w nagłówku, dwa alternates na `/podcasts/$show` z widocznym
// linkiem obok i wpis w `llms.txt`. Czytnik RSS i asystent AI dostają adres,
// który zwraca 404; człowiek klika przycisk i trafia w ścianę.
//
// DLACZEGO NIE NAPRAWIAM TEGO TUTAJ - i to nie jest wymówka, a zakres.
// To NIE jest defekt podcastów. `/rss.xml` i `/live/rss.xml` ogłaszają się
// dokładnie tak samo bezwarunkowo i robiły to PRZED tą kampanią - podpięcie
// podcastu pod `rss_enabled` tylko UWIDOCZNIŁO wzorzec, który jest w repo
// wszędzie. Poprawna naprawa jest jedna dla wszystkich powierzchni i wymaga
// decyzji, której nie wolno podjąć po cichu przy okazji testów:
//   (a) `head()` jest czystą funkcją ADRESU i nie widzi ustawień - żeby je
//       zobaczyć, ustawienia muszą wejść do `loaderData`, czyli powstaje NOWY
//       kliencki czytnik `site_settings` (dziś nie ma takiego zapytania:
//       `lib/queries/public.ts` nie ma klucza „seo") i CZWARTY odczyt na
//       pierwszym malowaniu każdej trasy ogłaszającej kanał;
//   (b) albo `podcast_feed_enabled` jako osobne pole ustawień, żeby wyłączenie
//       RSS artykułów nie gasiło subskrypcji audycji (patrz komentarz
//       w `routes/podcast.rss[.]xml.ts` - świadomy koszt tamtej decyzji);
//   (c) albo ogłaszanie zostaje bezwarunkowe, a wtedy `rss_enabled` musi
//       przestać zwracać 404 i zacząć zwracać pusty kanał - co łamie regułę
//       „kanał wyłączony w ustawieniach to 404, nie pusty kanał".
// Trzy różne kontrakty produktowe. Wybór należy do redakcji, nie do testu.
// ---------------------------------------------------------------------------

describe("ogłaszanie kanału kontra wyłączony RSS (defekt repo-wide)", () => {
  it.fails("DEFEKT: `head()` ogłasza kanał, choć redakcja wyłączyła RSS", () => {
    // KONTRAKT DOCELOWY: gdy ładunek loadera niesie informację o wyłączonym
    // kanale, `head()` NIE emituje `rel="alternate"` na ten kanał.
    // Dziś `head()` nie przyjmuje tej informacji w ogóle, więc asercja pada -
    // i to jest cała treść defektu: nie ma DROGI, którą ustawienie mogłoby tu
    // dojechać.
    const head = routeHead(PodcastsIndexRoute, { loaderData: { rssEnabled: false } });
    // FILTR PO TYPIE, nie po `rel`: `rel="alternate"` niosą też wpisy
    // hreflang (wersje językowe strony), które są tu ZAWSZE poprawne.
    // Pierwsza wersja tej asercji brała samo `rel` i padała na hreflangu,
    // czyli byłaby przypięciem, które po naprawie NIGDY nie zmieni koloru.
    const feeds = (head.links ?? []).filter((link) => link.type === "application/rss+xml");
    expect(feeds, "wyłączony kanał nie może być ogłaszany").toEqual([]);
  });

  it("kontrola dodatnia: to JEST dziś zachowanie - alternate leci ZAWSZE", () => {
    // Bez tej kontroli `it.fails` wyżej „przechodziłby" także wtedy, gdyby
    // trasa przestała ogłaszać kanał w ogóle - czyli gdyby naprawa poszła
    // w złą stronę i zabrała autodiscovery zdrowemu kanałowi.
    const withFlag = routeHead(PodcastsIndexRoute, { loaderData: { rssEnabled: false } });
    const withoutFlag = routeHead(PodcastsIndexRoute, { loaderData: { degraded: false } });
    const feedOf = (head: RouteHeadResult): unknown =>
      (head.links ?? []).find((link) => link.type === "application/rss+xml")?.href;
    expect(feedOf(withFlag), "kanał ogłaszany niezależnie od flagi").toContain("/podcast/rss.xml");
    expect(
      feedOf(withoutFlag),
      "ładunek bez flagi daje DOKŁADNIE ten sam wynik - `head()` jej nie czyta",
    ).toBe(feedOf(withFlag));
  });

  it("kontrola dodatnia: widoczny przycisk RSS też nie zna ustawienia", async () => {
    // Druga połowa defektu i ta gorsza: alternate widzi tylko robot, a ten
    // przycisk klika CZŁOWIEK.
    await mount();
    const rssLink = document.querySelector('a[href="/podcast/rss.xml"]');
    expect(rssLink, "przycisk RSS jest w nagłówku bezwarunkowo").not.toBeNull();
  });
});
