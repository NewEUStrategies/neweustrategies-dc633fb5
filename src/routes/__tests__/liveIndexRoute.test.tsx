// Trasa PUBLICZNA `/live` - indeks relacji na żywo. Do dziś: 0 z 23 linii.
//
// CO DOWODZI TEN PLIK.
//
// To jedyna powierzchnia ODKRYWANIA trwających relacji: redakcja linkuje ją
// z social mediów w chwili, gdy wydarzenie się dzieje. Render samego
// komponentu mija trzy warstwy, w których to się rozstrzyga: loader (POLITYKA
// CACHE'A - relacja na żywo nie może być serwowana z brzegu jako wpis sprzed
// 15 minut), `head()` (autodiscovery kanału RSS i metadane w obu językach)
// oraz sam mechanizm świeżości, którego ta trasa NIE ma i nie powinna mieć
// (patrz blok „kanał realtime" niżej).
//
// CZTERY REGUŁY, KTÓRYCH ZŁAMANIE KOSZTUJE:
//
//   1. ŻYWA POLITYKA CACHE'A, NIE DOMYŚLNA. `/live` deklaruje `s-maxage=30`,
//      nie 900 jak archiwum. Nadpisanie tego domyślną polityką treści daje
//      czytelnikowi trwającej relacji wpis sprzed kwadransa - awarię
//      niewidoczną w żadnym teście renderu.
//   2. PLAKIETKA „NA ŻYWO" LICZONA JEST ZEGAREM KLIENTA, NIE SERWERA.
//      Gałąź „na żywo" niesie trzy dodatkowe elementy z animacją, więc rozjazd
//      hydratacji jest tu rozjazdem STRUKTURY - React 19 odpowiada na to
//      przebudową całego poddrzewa, czyli utratą HTML-a z SSR.
//   3. DEGRADACJA MÓWI PRAWDĘ. Pusta lista i „nic nie dojechało" wyglądają
//      identycznie, a to dwie różne prawdy.
//   4. RELACJA INNEGO OBSZARU ROBOCZEGO NIE POJAWIA SIĘ NA TYM HOŚCIE.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - KANAŁU RSS `/live/rss.xml`: pełny kontrakt degradacji i TTL ma
//   `src/routes/__tests__/feedRoutesDegradation.test.ts`. Tutaj dowodzimy
//   WYŁĄCZNIE tego, czego tamten plik nie widzi: że strona GŁOSI istnienie
//   tego kanału linkiem `alternate`.
// - `src/lib/queries/liveBlogs.ts` biegnie tu PRAWDZIWY (atrapowany jest
//   wyłącznie klient PostgREST), więc klucz cache, limit 600 wpisów
//   i składanie `href` z `page_full_path` są tymi z produkcji.
// - REALTIME WPISÓW RELACJI: kanał `liveblog:<post>:<blok>` żyje w bloku
//   treści `LiveBlogBlock` i ma pełny kontrakt (subskrypcja, push INSERT/
//   UPDATE/DELETE, zamknięcie kanału) w
//   `src/components/blocks/__tests__/liveBlogBlock.test.tsx`. Poniżej jest
//   za to ZAPADKA na tym, że INDEKS kanału NIE otwiera - patrz uzasadnienie.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  /** Wiersze `live_blog_entries` (post_id, occurred_at). */
  entries: [] as Record<string, unknown>[],
  /** Wiersze `posts` ze WSZYSTKICH obszarów roboczych. */
  posts: [] as Record<string, unknown>[],
  /** Ścieżki zwracane przez RPC `page_full_path` per identyfikator rodzica. */
  paths: {} as Record<string, string>,
  /** Tenant PRZEGLĄDANEJ domeny - atrapa polityki `public_tenant_id()`. */
  tenantId: "tenant-a",
  /** Tabele, których odczyt ma paść (blip backendu). */
  broken: new Set<string>(),
  /** Adres żądania widziany przez `head()`. */
  requestUrl: "https://nes.example.org/live",
  /** Nagłówki `Cache-Control`, jakie ustawił loader. */
  cacheControl: [] as string[],
  /** Nazwy kanałów realtime otwartych podczas montażu tej trasy. */
  channelNames: [] as string[],
  /** Ile kanałów zostało zamkniętych przez `removeChannel`. */
  removedChannels: 0,
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, ok, fail } = await import("@/test/supabase/chain");
  const { realtimeStub } = await import("@/test/supabase/realtime");
  const stub = supabaseFromStub();
  const rt = realtimeStub();

  stub.setResponse("live_blog_entries", () => {
    if (h.broken.has("live_blog_entries")) return fail("test: tabela wpisow niedostepna");
    return ok(h.entries);
  });
  stub.setResponse("posts", () => {
    if (h.broken.has("posts")) return fail("test: tabela posts niedostepna");
    // Polityka publiczna: tylko wiersze tenanta przeglądanej domeny.
    return ok(h.posts.filter((row) => row.tenant_id === h.tenantId));
  });

  return {
    supabase: {
      from: stub.from,
      rpc: async (name: string, args?: Record<string, unknown>) => {
        if (name !== "page_full_path") return { data: null, error: null };
        const id = typeof args?._page_id === "string" ? args._page_id : "";
        return { data: h.paths[id] ?? null, error: null };
      },
      // `.bind(rt)` jest KONIECZNY - bez niego `this` w atrapie gubi rejestr
      // kanałów i zapadka na wycieku przestaje cokolwiek mierzyć.
      channel: (name: string, config?: Record<string, unknown>) => {
        h.channelNames.push(name);
        return rt.channel(name, config);
      },
      removeChannel: async (channel: Parameters<typeof rt.removeChannel>[0]) => {
        h.removedChannels += 1;
        return rt.removeChannel(channel);
      },
    },
  };
});

vi.mock("@/lib/seo/request", () => ({
  getRequestUrl: () => h.requestUrl,
  getOrigin: () => "https://nes.example.org",
}));

vi.mock("@/lib/http/responseHeaders", () => ({
  setCacheControlHeader: (value: string) => void h.cacheControl.push(value),
  appendLinkHeader: () => {},
  readRouteCacheDirective: () => null,
}));

import "@/test/i18nReal";
import { QueryClient } from "@tanstack/react-query";
import i18n from "@/lib/i18n";
import { renderRoute, routeHead } from "@/test/routeHarness";
import type { RouteHeadResult } from "@/test/routeHarness";
import { axeViolations, summarize } from "@/test/axe";
import { LIVE_WINDOW_MS } from "@/lib/queries/liveBlogs";
import { Route as LiveRoute } from "@/routes/live";

const PATH = "/live";
const POST_ID = "11111111-1111-4111-8111-111111111111";
const PARENT_ID = "22222222-2222-4222-8222-222222222222";

// ── fixtures (RODO: wszystkie tytuły i zajawki są ZMYŚLONE) ─────────────────

function post(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: POST_ID,
    tenant_id: "tenant-a",
    slug: "szczyt-energetyczny",
    title_pl: "Szczyt energetyczny - relacja",
    title_en: "Energy summit - live",
    excerpt_pl: "Minuta po minucie z obrad.",
    excerpt_en: "Minute by minute from the talks.",
    cover_image_url: null,
    published_at: "2026-06-01T08:00:00.000Z",
    parent_page_id: PARENT_ID,
    is_sponsored: false,
    sponsored_kind: null,
    sponsored_affiliate: false,
    ...patch,
  };
}

/** Wpis relacji sprzed `minutesAgo` minut - decyduje o plakietce LIVE. */
function entry(minutesAgo: number, postId = POST_ID): Record<string, unknown> {
  return {
    post_id: postId,
    occurred_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  };
}

function freshClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

async function mount(queryClient?: QueryClient) {
  return renderRoute({ route: LiveRoute, path: PATH, initialEntry: PATH, queryClient });
}

/**
 * Karta relacji o danym tytule. Scope jest tu WARUNKIEM SENSU: okruszki
 * nawigacji też niosą napis „Na żywo" / „Live", więc asercja na całym
 * dokumencie przechodziłaby na samych okruszkach i nie mówiłaby nic
 * o plakietce karty.
 */
function liveCard(title: string): HTMLElement {
  const card = screen.getByRole("heading", { level: 2, name: title }).closest("li");
  if (!(card instanceof HTMLElement)) throw new Error(`test: brak karty "${title}"`);
  return card;
}

/** Wartość `content` wpisu meta - z twardym błędem, gdy wpisu nie ma. */
function metaContent(
  head: RouteHeadResult,
  key: "name" | "property" | "httpEquiv",
  value: string,
): string {
  const found = (head.meta ?? []).find((entry_) => entry_[key] === value);
  const content = found?.content;
  if (typeof content !== "string") throw new Error(`test: brak meta ${key}="${value}"`);
  return content;
}

/** Tytuł dokumentu z `head()` - z twardym błędem, gdy go nie ma. */
function headTitle(head: RouteHeadResult): string {
  const found = (head.meta ?? []).find((entry_) => typeof entry_.title === "string");
  if (typeof found?.title !== "string") throw new Error("test: head() nie niesie tytulu");
  return found.title;
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.entries = [entry(10)];
  h.posts = [post()];
  h.paths = { [PARENT_ID]: "aktualnosci" };
  h.tenantId = "tenant-a";
  h.broken = new Set<string>();
  h.requestUrl = "https://nes.example.org/live";
  h.cacheControl = [];
  h.channelNames = [];
  h.removedChannels = 0;
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
  vi.restoreAllMocks();
});

describe("trasa /live - lista relacji", () => {
  it("pokazuje tytuł, zajawkę i link złożony ze ŚCIEŻKI RODZICA", async () => {
    // `href` powstaje z `page_full_path(parent_page_id)` + slug. Zapasowe
    // „blog" bez tego wywołania dawałoby martwy link na każdej relacji, którą
    // redakcja umieściła pod inną stroną nadrzędną.
    await mount();

    expect(
      screen.getByRole("heading", { level: 1, name: /Relacje na żywo/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Szczyt energetyczny - relacja" })).toBeInTheDocument();
    expect(screen.getByText("Minuta po minucie z obrad.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Szczyt energetyczny/ })).toHaveAttribute(
      "href",
      "/aktualnosci/szczyt-energetyczny",
    );
  });

  it("relacja bez ścieżki rodzica spada na /blog, a nie na adres z `undefined`", async () => {
    // RPC może nie zwrócić ścieżki (strona nadrzędna usunięta). Zapas jest
    // jedyną rzeczą, która trzyma link klikalny.
    h.paths = {};
    await mount();

    expect(screen.getByRole("link", { name: /Szczyt energetyczny/ })).toHaveAttribute(
      "href",
      "/blog/szczyt-energetyczny",
    );
  });

  it("liczba wpisów ma polskie formy: 1 wpis, 2-4 wpisy, 5+ wpisów", async () => {
    // Licznik jest jedyną informacją o „gęstości" relacji. Jedna forma dla
    // każdej liczby czyta się jak automat.
    h.entries = [entry(5)];
    const one = await mount();
    expect(one.container.textContent).toContain("1 wpis");
    cleanup();

    h.entries = [entry(5), entry(6), entry(7)];
    const three = await mount(freshClient());
    expect(three.container.textContent).toContain("3 wpisy");
    cleanup();

    h.entries = [entry(1), entry(2), entry(3), entry(4), entry(5)];
    const five = await mount(freshClient());
    expect(five.container.textContent).toContain("5 wpisów");
  });

  it("po angielsku bierze angielski tytuł, zajawkę i etykiety", async () => {
    await i18n.changeLanguage("en");
    await mount();

    expect(screen.getByRole("heading", { level: 1, name: /Live coverage/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Energy summit - live" })).toBeInTheDocument();
    expect(screen.getByText("Minute by minute from the talks.")).toBeInTheDocument();
    expect(screen.queryByText("Minuta po minucie z obrad.")).not.toBeInTheDocument();
  });

  it("relacja bez angielskiego tytułu spada na polski, a nie na sam slug", async () => {
    await i18n.changeLanguage("en");
    h.posts = [post({ title_en: "" })];
    await mount();

    expect(
      screen.getByRole("heading", { level: 2, name: "Szczyt energetyczny - relacja" }),
    ).toBeInTheDocument();
  });

  it("nie zostawia indeksu relacji z wadami dostępności", async () => {
    const view = await mount();
    await screen.findByRole("heading", { level: 1 });

    const violations = await axeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("trasa /live - plakietka „na żywo” kontra „zakończona”", () => {
  it("PIERWSZY render (serwer + hydratacja) NIE zgaduje - relacja jest „zakończona”", async () => {
    // `useNowMs` oddaje `null` do montażu, więc SSR i pierwszy render klienta
    // są IDENTYCZNE. Bez tego gałąź „na żywo" (trzy dodatkowe elementy
    // z animacją) rozjeżdżałaby strukturę i React 19 porzucałby poddrzewo SSR.
    h.entries = [entry(1)];
    await mount();

    // Po montażu efekt już wstawił prawdziwą chwilę, więc plakietka LIVE jest.
    await waitFor(() =>
      expect(
        within(liveCard("Szczyt energetyczny - relacja")).getByText("Na żywo"),
      ).toBeInTheDocument(),
    );
  });

  it("relacja starsza niż okno LIVE dostaje plakietkę „Zakończona”", async () => {
    // Okno bierzemy z modułu danych, nie z liczby wpisanej w test - inaczej
    // zmiana progu w produkcji zostawiłaby ten test zielonym i nieprawdziwym.
    h.entries = [entry(LIVE_WINDOW_MS / 60_000 + 30)];
    await mount();

    const card = liveCard("Szczyt energetyczny - relacja");
    expect(within(card).getByText("Zakończona")).toBeInTheDocument();
    expect(within(card).queryByText("Na żywo")).toBeNull();
  });

  it("po angielsku plakietki są angielskie", async () => {
    await i18n.changeLanguage("en");
    h.entries = [entry(1)];
    await mount();

    await waitFor(() =>
      expect(within(liveCard("Energy summit - live")).getByText("Live")).toBeInTheDocument(),
    );
  });
});

describe("trasa /live - stan pusty i render zdegradowany", () => {
  it("brak relacji daje uczciwy komunikat „zajrzyj później”, a nie pustą stronę", async () => {
    h.entries = [];
    await mount();

    expect(
      screen.getByText("Obecnie nie prowadzimy żadnej relacji na żywo. Zajrzyj później."),
    ).toBeInTheDocument();
  });

  it("po angielsku komunikat pustki też jest angielski", async () => {
    await i18n.changeLanguage("en");
    h.entries = [];
    await mount();

    expect(
      screen.getByText("No live coverage is running right now. Check back later."),
    ).toBeInTheDocument();
  });

  it("awaria odczytu NIE wywraca trasy i mówi PRAWDĘ, a nie „brak relacji”", async () => {
    // `loadResilient` zamienia blip bazy w HTTP 200 z pustą listą - ale sam
    // w sobie KŁAMIE w warstwie treści, więc widok MUSI pokazać degradację.
    h.broken.add("live_blog_entries");
    await mount();

    expect(await screen.findByText(/Nie udało się załadować relacji/)).toBeInTheDocument();
    expect(
      screen.queryByText("Obecnie nie prowadzimy żadnej relacji na żywo. Zajrzyj później."),
    ).toBeNull();
  });

  it("po angielsku komunikat degradacji też jest angielski", async () => {
    await i18n.changeLanguage("en");
    h.broken.add("live_blog_entries");
    await mount();

    expect(await screen.findByText(/Couldn't load live coverage/)).toBeInTheDocument();
  });

  it("KONTROLA DODATNIA: czysty render NIE pokazuje komunikatu degradacji", async () => {
    await mount();

    expect(screen.queryByText(/Nie udało się załadować relacji/)).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: /Szczyt energetyczny/ })).toBeInTheDocument();
  });
});

describe("trasa /live - polityka świeżości", () => {
  it("czysty render deklaruje ŻYWĄ politykę (s-maxage=30), nie domyślne 900", async () => {
    // To jedyna trasa treściowa z własną polityką. Nadpisanie jej domyślnym
    // `contentCacheControl()` dawałoby czytelnikowi trwającej relacji wpis
    // sprzed 15 minut - i nie byłoby tego widać w żadnym renderze.
    await mount();

    expect(h.cacheControl.at(-1)).toContain("s-maxage=30");
    expect(h.cacheControl.at(-1)).not.toContain("s-maxage=900");
  });

  it("zdegradowany render ZDEJMUJE stronę ze wspólnego cache'a", async () => {
    // Bez tego brzeg CDN zapamiętałby pustkę i serwował ją kolejnym
    // czytelnikom przez cały okres świeżości - także po powrocie bazy.
    h.broken.add("live_blog_entries");
    await mount();

    expect(h.cacheControl.at(-1)).toContain("no-store");
  });
});

describe("trasa /live - izolacja obszarów roboczych", () => {
  it("relacja innego obszaru roboczego nie pojawia się na tym hoście", async () => {
    // Wpisy `live_blog_entries` przechodzą przez ZŁĄCZENIE z `posts`, więc
    // odsiew tenanta dzieje się na poście. Ten test pilnuje SKUTKU: obcy wpis
    // znika razem z postem, a nie zostaje jako karta bez tytułu.
    h.posts = [post({ tenant_id: "tenant-b", title_pl: "Relacja obcego obszaru" })];
    await mount();

    expect(screen.queryByText("Relacja obcego obszaru")).not.toBeInTheDocument();
    expect(
      screen.getByText("Obecnie nie prowadzimy żadnej relacji na żywo. Zajrzyj później."),
    ).toBeInTheDocument();
  });

  it("KONTROLA DODATNIA: ta sama relacja na WŁASNYM hoście renderuje się", async () => {
    h.posts = [post({ tenant_id: "tenant-b", title_pl: "Relacja obcego obszaru" })];
    h.tenantId = "tenant-b";
    await mount();

    expect(
      screen.getByRole("heading", { level: 2, name: "Relacja obcego obszaru" }),
    ).toBeInTheDocument();
  });
});

// ── KANAŁ REALTIME: CZEGO TA TRASA NIE MA I DLACZEGO ────────────────────────
//
// USTALENIE, NIE PRZEOCZENIE. `/live` NIE otwiera kanału `postgres_changes`.
// Świeżość tej strony jest domknięta POLITYKĄ CACHE'A (`s-maxage=30`,
// `liveCacheControl()`), a nie subskrypcją, i to jest rozstrzygnięcie spójne
// z resztą modułu: kanał wpisów relacji żyje w bloku treści
// (`liveblog:<post>:<blok>` w `LiveBlogBlock`), czyli tam, gdzie czytelnik
// naprawdę czyta minutę po minucie. Indeks jest powierzchnią ODKRYWANIA -
// otwarcie tu kanału na każdą kartę pomnożyłoby liczbę połączeń na trasie
// publicznej bez zysku, jaki daje trzydziestosekundowa świeżość brzegu.
//
// DLACZEGO TO JEST ZAPADKA, A NIE KOMENTARZ. Kanał otwarty i NIEZAMKNIĘTY na
// trasie publicznej nie psuje niczego od razu: dopiero po kilku przejściach
// między trasami kończy się limit kanałów i przestają przychodzić zdarzenia -
// także w tych widokach, które realtime naprawdę potrzebują. Zapadka mierzy
// więc jedno i drugie: że kanał się tu nie otwiera ORAZ że gdyby ktoś go
// dopisał, ma go zamknąć przy odmontowaniu.
describe("trasa /live - kanały realtime (zapadka na wycieku)", () => {
  it("indeks relacji NIE otwiera żadnego kanału - świeżość niesie polityka cache'a", async () => {
    // Gdyby ktoś dopisał tu subskrypcję per karta, ta asercja padnie i wymusi
    // decyzję: albo kanał JEDEN (nie N), albo świeżość zostaje na brzegu.
    await mount();
    await screen.findByRole("heading", { level: 2, name: /Szczyt energetyczny/ });

    expect(h.channelNames, `otwarte kanały: ${h.channelNames.join(", ")}`).toEqual([]);
  });

  it("odmontowanie trasy nie zostawia ANI JEDNEGO otwartego kanału", async () => {
    // Para do testu wyżej, ale mierzy INNĄ rzecz: bilans otwarć i zamknięć.
    // Zostaje prawdziwa także wtedy, gdy trasa kiedyś dostanie subskrypcję -
    // wtedy przestanie być trywialna i zacznie pilnować `removeChannel`.
    const view = await mount();
    await screen.findByRole("heading", { level: 2, name: /Szczyt energetyczny/ });

    view.unmount();

    await waitFor(() => expect(h.channelNames.length - h.removedChannels).toBe(0));
  });

  it("KONTROLA DODATNIA: atrapa kanałów DZIAŁA - liczy otwarcia i zamknięcia", async () => {
    // Bez tej pary dwa testy wyżej przechodziłyby też wtedy, gdyby atrapa
    // `channel`/`removeChannel` w ogóle nie była podłączona do klienta -
    // czyli gdyby zapadka mierzyła tylko własną pustą tablicę.
    const { supabase } = await import("@/integrations/supabase/client");
    const client = supabase as unknown as {
      channel: (name: string) => { subscribe: () => unknown };
      removeChannel: (channel: unknown) => Promise<unknown>;
    };

    const probe = client.channel("test-probe");
    expect(h.channelNames).toEqual(["test-probe"]);
    await client.removeChannel(probe);
    expect(h.removedChannels).toBe(1);
  });
});

describe("trasa /live - nagłówek dokumentu", () => {
  it("po polsku niesie polski tytuł, opis i znacznik języka", () => {
    const head = routeHead(LiveRoute);

    expect(headTitle(head)).toBe("Relacje na żywo - New European Strategies");
    expect(metaContent(head, "name", "description")).toBe(
      "Trwające i niedawne relacje na żywo z kluczowych wydarzeń europejskich.",
    );
    expect(metaContent(head, "httpEquiv", "content-language")).toBe("pl");
  });

  it("prefiks /en w ADRESIE daje angielski tytuł i opis", () => {
    h.requestUrl = "https://nes.example.org/en/live";
    const head = routeHead(LiveRoute);

    expect(headTitle(head)).toBe("Live coverage - New European Strategies");
    expect(metaContent(head, "name", "description")).toBe(
      "Ongoing and recent live coverage of key European events.",
    );
    expect(metaContent(head, "httpEquiv", "content-language")).toBe("en");
  });

  it("GŁOSI kanał relacji linkiem alternate - czytelnik dostaje wpisy pushem", () => {
    // Bez tego linku kanał `/live/rss.xml` istnieje, ale nikt go nie znajdzie:
    // czytnik RSS odkrywa kanał wyłącznie przez autodiscovery w `<head>`.
    const feed = (routeHead(LiveRoute).links ?? []).find(
      (l) => l.rel === "alternate" && l.type === "application/rss+xml",
    );

    expect(feed?.href).toBe("https://nes.example.org/live/rss.xml");
    expect(feed?.title).toBe("Relacje na żywo - RSS");
  });

  it("po angielsku tytuł kanału RSS też jest angielski", () => {
    h.requestUrl = "https://nes.example.org/en/live";
    const feed = (routeHead(LiveRoute).links ?? []).find(
      (l) => l.rel === "alternate" && l.type === "application/rss+xml",
    );

    expect(feed?.title).toBe("Live coverage - RSS");
  });

  it("pusty adres żądania nie gubi ani kanonicznego, ani adresu kanału", () => {
    // Gałąź `||` w `live.tsx`. Pusty kanoniczny na stronie w indeksie jest
    // groźniejszy niż brak: wyszukiwarka sama wybiera adres reprezentatywny.
    h.requestUrl = "";
    const head = routeHead(LiveRoute);

    expect((head.links ?? []).find((l) => l.rel === "canonical")?.href).toBe(PATH);
    const feed = (head.links ?? []).find((l) => l.type === "application/rss+xml");
    expect(typeof feed?.href).toBe("string");
    expect(String(feed?.href)).toContain("/live/rss.xml");
  });

  it("NIE wyłącza indeksu relacji z wyszukiwarki", () => {
    const robots = (routeHead(LiveRoute).meta ?? []).filter((e) => e.name === "robots");

    expect(robots).toEqual([]);
  });
});
