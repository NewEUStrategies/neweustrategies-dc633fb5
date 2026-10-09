// PO CO. Ten moduł istnieje po to, żeby loader trasy głównej (prefetch SSR)
// i `<TrendingTicker/>` (useQuery) trafiały w TEN SAM wpis cache. Cała ta
// obietnica opiera się na jednym kluczu układanym z konfiguracji - i jest
// zerojedynkowa: gdy klucz serwera rozjedzie się z kluczem klienta o JEDEN
// element, nic się nie wywala. Pasek po prostu wraca do stanu sprzed poprawki,
// czyli dociąga się po hydracji i zepycha całą stronę o ~40 px w dół. Testu
// wizualnego na to nie ma, typów na to nie ma - jest ten plik.
//
// Drugi ciężar niosą tu gałęzie `queryFn`: pięć źródeł paska schodzi do DWÓCH
// różnych server functions o różnych ładunkach. Pomyłka w gałęzi nie jest
// błędem typu (obie zwracają `TrendingPost[]`), tylko cicho innym paskiem.
//
// Trzeci: `resolveTickerSource` to jedyne miejsce, w którym WYGASA przypinka.
// Bez zegara podanego z zewnątrz nie da się tego sprawdzić inaczej niż
// czekaniem, więc test podaje `now` jawnie i pilnuje, że wygaśnięcie zmienia
// KLUCZ, a nie tylko dane - inaczej pasek po wygaśnięciu serwuje z cache
// wpis, który miał zniknąć.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, keepPreviousData } from "@tanstack/react-query";
import { langForPath } from "@/lib/i18n/localeRuntime";
import { LANG_COOKIE, readLangCookieClient, readLangCookieFromHeader } from "@/lib/i18n/langCookie";

interface TickerPost {
  id: string;
  slug: string;
  title_pl: string;
  title_en: string;
  href?: string | null;
}

const h = vi.hoisted(() => ({
  trending: vi.fn<(arg: unknown) => Promise<unknown>>(),
  ticker: vi.fn<(arg: unknown) => Promise<unknown>>(),
}));

vi.mock("@/lib/views/postViews.functions", () => ({
  getTrendingPosts: (arg: unknown) => h.trending(arg),
  getTickerPosts: (arg: unknown) => h.ticker(arg),
}));

import {
  headerTickerQueryOptions,
  projectHeaderTickerPosts,
  resolveTickerSource,
  type TickerConfig,
} from "../headerTickerQuery";
import type { TrendingPost } from "@/lib/views/postViews.functions";

const NOW = Date.parse("2026-09-01T12:00:00.000Z");
const YESTERDAY = "2026-08-31T12:00:00.000Z";
const TOMORROW = "2026-09-02T12:00:00.000Z";
const PINNED = "11111111-1111-4111-8111-111111111111";
const SEL = ["a1111111-1111-4111-8111-111111111111", "b2222222-2222-4222-8222-222222222222"];

function post(id: string): TickerPost {
  return { id, slug: id, title_pl: `Wpis ${id}`, title_en: `Post ${id}` };
}

/** Wpis paska po projekcji PL (P3.7b, T4): tytuł języka klucza, `slug` tylko bez `href`. */
function projectedPl(id: string) {
  return { id, slug: id, title_pl: `Wpis ${id}` };
}

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeEach(() => {
  // ZEGAR ZAMROŻONY NA `NOW`, bo `headerTickerQueryOptions` nie przyjmuje
  // żadnego zegara - woła `resolveTickerSource(cfg)`, a ta domyślnie czyta
  // `Date.now()`. Dopóki data ustawiona w teście była w przyszłości, gałąź
  // „przypinka w terminie" przechodziła przypadkiem; po 2026-09-02 `TOMORROW`
  // stał się przeszłością i ten sam przypadek zaczął dostawać `latest`. Bez
  // zamrożenia plik jest bombą zegarową, a nie testem. Podmieniamy WYŁĄCZNIE
  // `Date` - timery muszą tykać realnie, bo `fetchQuery` niżej jest
  // asynchroniczne.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  h.trending.mockReset();
  h.ticker.mockReset();
  h.trending.mockResolvedValue([post("t1")]);
  h.ticker.mockResolvedValue([post("k1")]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("resolveTickerSource - które źródło naprawdę zagra", () => {
  it("pusta konfiguracja to `trending` - pasek nie może zostać bez źródła", () => {
    expect(resolveTickerSource({}, NOW)).toBe("trending");
  });

  it("`latest` i `mixed` przechodzą bez zmian", () => {
    expect(resolveTickerSource({ source: "latest" }, NOW)).toBe("latest");
    expect(resolveTickerSource({ source: "mixed" }, NOW)).toBe("mixed");
  });

  it("`pinned` bez identyfikatora wpisu spada na `latest`, zamiast pokazać pustkę", () => {
    expect(resolveTickerSource({ source: "pinned" }, NOW)).toBe("latest");
  });

  it("`pinned` bez terminu ważności trwa bezterminowo", () => {
    expect(resolveTickerSource({ source: "pinned", pinnedPostId: PINNED }, NOW)).toBe("pinned");
    expect(
      resolveTickerSource({ source: "pinned", pinnedPostId: PINNED, pinnedUntil: null }, NOW),
    ).toBe("pinned");
  });

  it("przypinka z terminem w PRZYSZŁOŚCI zostaje, z terminem w PRZESZŁOŚCI wygasa", () => {
    const base = { source: "pinned", pinnedPostId: PINNED } as const;
    expect(resolveTickerSource({ ...base, pinnedUntil: TOMORROW }, NOW)).toBe("pinned");
    expect(resolveTickerSource({ ...base, pinnedUntil: YESTERDAY }, NOW)).toBe("latest");
  });

  it("bez podanego zegara mierzy „teraz” - przeszła przypinka wygasa i tak", () => {
    // Gałąź domyślnego argumentu: tak woła to `headerTickerQueryOptions`.
    expect(
      resolveTickerSource({ source: "pinned", pinnedPostId: PINNED, pinnedUntil: YESTERDAY }),
    ).toBe("latest");
  });

  it("`selected` bez ani jednego użytecznego identyfikatora spada na `latest`", () => {
    expect(resolveTickerSource({ source: "selected" }, NOW)).toBe("latest");
    expect(resolveTickerSource({ source: "selected", selectedPostIds: [] }, NOW)).toBe("latest");
    // Puste napisy to nie wybór - panel potrafi zostawić po sobie taki wiersz.
    expect(resolveTickerSource({ source: "selected", selectedPostIds: ["", ""] }, NOW)).toBe(
      "latest",
    );
  });

  it("`selected` z choćby jednym wpisem zostaje `selected`", () => {
    expect(resolveTickerSource({ source: "selected", selectedPostIds: ["", SEL[0]] }, NOW)).toBe(
      "selected",
    );
  });
});

describe("headerTickerQueryOptions - klucz wspólny dla SSR i klienta", () => {
  it("klucz niesie WSZYSTKIE wejścia zmieniające wynik i nic ponadto", () => {
    const cfg: TickerConfig = {
      source: "mixed",
      days: 14,
      limit: 5,
      pinnedPostId: PINNED,
      selectedPostIds: SEL,
      mixedFill: "latest",
    };
    expect(headerTickerQueryOptions(cfg, "pl").queryKey).toEqual([
      "header_ticker",
      "mixed",
      "pl",
      14,
      5,
      PINNED,
      SEL.join(","),
      "latest",
    ]);
  });

  it("brakujące pokrętła dostają domyślne 7 dni / 8 wpisów JUŻ W KLUCZU", () => {
    // Domyślne wartości muszą wejść do klucza, a nie dopiero do zapytania -
    // inaczej `{}` i `{ days: 7 }` byłyby dwoma wpisami cache na te same dane.
    expect(headerTickerQueryOptions({}, "pl").queryKey).toEqual([
      "header_ticker",
      "trending",
      "pl",
      7,
      8,
      null,
      "",
      "trending",
    ]);
    expect(headerTickerQueryOptions({ days: 7, limit: 8 }).queryKey).toEqual(
      headerTickerQueryOptions({}).queryKey,
    );
  });

  it("wygląd paska NIE dzieli cache - kolory i etykiety nie zmieniają klucza", () => {
    // Zmiana koloru w panelu nie może kasować pobranych wpisów.
    const plain: TickerConfig = { source: "latest", limit: 4 };
    const dressed: TickerConfig = {
      ...plain,
      labelPl: "Na czasie",
      labelEn: "Trending",
      layoutStyle: "glassLive",
      iconAnimation: "spin",
      scrollSpeed: 200,
      fullWidth: false,
    };
    expect(headerTickerQueryOptions(dressed).queryKey).toEqual(
      headerTickerQueryOptions(plain).queryKey,
    );
  });

  it("wybrane wpisy w kluczu: bez pustych, przycięte do trzech, w kolejności z panelu", () => {
    const four = [SEL[1], "", SEL[0], "c3333333-3333-4333-8333-333333333333", "d4"];
    const key = headerTickerQueryOptions({ source: "selected", selectedPostIds: four }).queryKey;
    expect(key[6]).toBe([SEL[1], SEL[0], "c3333333-3333-4333-8333-333333333333"].join(","));
  });

  it("kolejność wyboru JEST istotna - odwrócona lista to inny klucz", () => {
    const forward = headerTickerQueryOptions({ source: "selected", selectedPostIds: SEL }).queryKey;
    const backward = headerTickerQueryOptions({
      source: "selected",
      selectedPostIds: [...SEL].reverse(),
    }).queryKey;
    expect(forward).not.toEqual(backward);
  });

  it("wygaśnięcie przypinki zmienia KLUCZ, nie tylko dane pod starym kluczem", () => {
    const expired = headerTickerQueryOptions({
      source: "pinned",
      pinnedPostId: PINNED,
      pinnedUntil: YESTERDAY,
    }).queryKey;
    expect(expired[1]).toBe("latest");
    // Identyfikator zostaje w kluczu, choć źródło już go nie użyje - dzięki
    // temu zdjęcie przypinki w panelu też unieważnia wpis.
    expect(expired[5]).toBe(PINNED);
  });

  it("loader SSR i klient budują ten sam klucz, więc druga strona NIE strzela do serwera", async () => {
    // Loader biegnie na serwerze: wpis w cache to projekcja (stan odwodniony).
    vi.stubEnv("SSR", true);
    const qc = client();
    const cfgSsr: TickerConfig = { source: "trending", days: 3, limit: 6 };
    const cfgClient: TickerConfig = { source: "trending", days: 3, limit: 6 };

    await qc.fetchQuery(headerTickerQueryOptions(cfgSsr));
    const fromCache = await qc.fetchQuery(headerTickerQueryOptions(cfgClient));

    expect(h.trending).toHaveBeenCalledTimes(1);
    expect(fromCache).toEqual([projectedPl("t1")]);
  });

  it("okno świeżości i czas życia w cache przeżywają hydrację (5 min / 30 min)", () => {
    // `staleTime` krótszy niż hydracja kazałby klientowi pobrać pasek ponownie
    // mimo trafienia w klucz - czyli dokładnie ten przeskok, który ten moduł
    // miał usunąć.
    const opts = headerTickerQueryOptions({});
    expect(opts.staleTime).toBe(5 * 60_000);
    expect(opts.gcTime).toBe(30 * 60_000);
  });
});

describe("headerTickerQueryOptions - gałęzie pobrania", () => {
  it("`trending` idzie do RPC trendów z oknem dni, a NIE do listy paskowej", async () => {
    await client().fetchQuery(headerTickerQueryOptions({ source: "trending", days: 30, limit: 2 }));

    expect(h.trending).toHaveBeenCalledWith({ data: { days: 30, limit: 2 } });
    expect(h.ticker).not.toHaveBeenCalled();
  });

  it("`selected` wysyła WYŁĄCZNIE przycięty wybór - bez dni, bez przypinki", async () => {
    await client().fetchQuery(
      headerTickerQueryOptions({
        source: "selected",
        selectedPostIds: [...SEL, "c3333333-3333-4333-8333-333333333333", "nadmiar"],
        days: 30,
        pinnedPostId: PINNED,
        limit: 3,
      }),
    );

    expect(h.trending).not.toHaveBeenCalled();
    expect(h.ticker).toHaveBeenCalledWith({
      data: {
        source: "selected",
        limit: 3,
        selectedPostIds: [...SEL, "c3333333-3333-4333-8333-333333333333"],
      },
    });
  });

  it("`mixed` przekazuje komplet: czym dopełnić, przypinkę, wybór i okno dni", async () => {
    await client().fetchQuery(
      headerTickerQueryOptions({
        source: "mixed",
        mixedFill: "latest",
        pinnedPostId: PINNED,
        selectedPostIds: SEL,
        days: 10,
        limit: 9,
      }),
    );

    expect(h.ticker).toHaveBeenCalledWith({
      data: {
        source: "mixed",
        limit: 9,
        days: 10,
        mixedFill: "latest",
        pinnedPostId: PINNED,
        selectedPostIds: SEL,
      },
    });
  });

  it("`mixed` bez wskazanego dopełnienia domyślnie dobiera trendy", async () => {
    await client().fetchQuery(headerTickerQueryOptions({ source: "mixed" }));
    expect(h.ticker).toHaveBeenCalledWith({
      data: {
        source: "mixed",
        limit: 8,
        days: 7,
        mixedFill: "trending",
        pinnedPostId: undefined,
        selectedPostIds: [],
      },
    });
  });

  it("`pinned` w terminie pobiera przypięty wpis", async () => {
    await client().fetchQuery(
      headerTickerQueryOptions({
        source: "pinned",
        pinnedPostId: PINNED,
        pinnedUntil: TOMORROW,
        limit: 1,
      }),
    );

    expect(h.ticker).toHaveBeenCalledWith({
      data: { source: "pinned", limit: 1, pinnedPostId: PINNED },
    });
  });

  it("przypinka po terminie pobiera NAJNOWSZE, choć identyfikator jedzie dalej w ładunku", async () => {
    await client().fetchQuery(
      headerTickerQueryOptions({
        source: "pinned",
        pinnedPostId: PINNED,
        pinnedUntil: YESTERDAY,
      }),
    );

    expect(h.ticker).toHaveBeenCalledWith({
      data: { source: "latest", limit: 8, pinnedPostId: PINNED },
    });
  });

  it("`latest` bez przypinki pobiera najnowsze wpisy", async () => {
    vi.stubEnv("SSR", true);
    const rows = await client().fetchQuery(headerTickerQueryOptions({ source: "latest" }));

    expect(h.ticker).toHaveBeenCalledWith({
      data: { source: "latest", limit: 8, pinnedPostId: undefined },
    });
    expect(rows).toEqual([projectedPl("k1")]);
  });

  it("awaria server function nie jest zamieniana na pusty pasek - błąd idzie w górę", async () => {
    // Pasek ma prawo zniknąć, ale decyzję podejmuje komponent na podstawie
    // stanu zapytania. Połknięty tu błąd byłby nieodróżnialny od „brak wpisów".
    h.ticker.mockRejectedValue(new Error("trending_posts failed"));
    await expect(
      client().fetchQuery(headerTickerQueryOptions({ source: "latest" })),
    ).rejects.toThrow("trending_posts failed");
  });
});

// JĘZYK W KLUCZU I JEDEN TYTUŁ W PRZESYŁCE (P3.7b, T4a/T4b - przekazanie z P2.5).
describe("headerTickerQueryOptions - język w kluczu (P3.7b, T4)", () => {
  function row(id: string, patch: Partial<TrendingPost> = {}): TrendingPost {
    return {
      id,
      slug: `wpis-${id}`,
      title_pl: `Wpis ${id}`,
      title_en: `Post ${id}`,
      cover_image_url: "https://cdn.test/okladka.jpg",
      published_at: "2026-09-01T10:00:00Z",
      parent_page_id: "strona",
      views_count: 12,
      href: `/analizy/wpis-${id}`,
      author_display_name: "Autor",
      author_avatar_url: null,
      ...patch,
    };
  }

  it("PL i EN to dwa wpisy cache; domyślny język = `currentLang()` (tu: brak żądania -> pl)", () => {
    const pl = headerTickerQueryOptions({}, "pl").queryKey;
    const en = headerTickerQueryOptions({}, "en").queryKey;
    expect(pl).not.toEqual(en);
    expect(headerTickerQueryOptions({}).queryKey).toEqual(pl);
    // Etykieta w logu dokumentu (dwa wiodące napisy) zostaje `header_ticker.<źródło>`.
    expect(pl.slice(0, 3)).toEqual(["header_ticker", "trending", "pl"]);
  });

  it("projekcja: tytuł w języku klucza z łańcuchem `itemTitle`, pole drugiego języka zdjęte", () => {
    const rows = [
      row("a"),
      row("b", { title_pl: "" }),
      row("c", { title_en: "" }),
      row("d", { title_pl: "", title_en: "" }),
    ];
    const pl = projectHeaderTickerPosts(rows, "pl");
    expect(pl.map((r) => r.title_pl)).toEqual(["Wpis a", "Post b", "Wpis c", ""]);
    const en = projectHeaderTickerPosts(rows, "en");
    expect(en.map((r) => r.title_en)).toEqual(["Post a", "Post b", "Wpis c", ""]);
    for (const r of pl) expect(r).not.toHaveProperty("title_en");
    for (const r of en) expect(r).not.toHaveProperty("title_pl");
  });

  it("T4a: `slug` jedzie WYŁĄCZNIE przy wierszu bez `href` (zapas adresu paska)", () => {
    const [withHref, withoutHref] = projectHeaderTickerPosts(
      [row("a"), row("b", { href: null as unknown as string })],
      "pl",
    );
    expect(withHref).not.toHaveProperty("slug");
    expect(withHref.href).toBe("/analizy/wpis-a");
    expect(withoutHref.slug).toBe("wpis-b");
    expect(Object.keys(withHref).sort()).toEqual([
      "author_avatar_url",
      "author_display_name",
      "href",
      "id",
      "title_pl",
    ]);
  });

  it("queryFn na SERWERZE rzutuje na język KLUCZA", async () => {
    vi.stubEnv("SSR", true);
    h.trending.mockResolvedValue([row("t1")]);
    const rows = await client().fetchQuery(headerTickerQueryOptions({}, "en"));
    expect(rows).toEqual([
      {
        id: "t1",
        title_en: "Post t1",
        href: "/analizy/wpis-t1",
        author_display_name: "Autor",
        author_avatar_url: null,
      },
    ]);
  });

  // Runda poprawek 9 (budżet domknięcia bootu): projekcja stoi za bramką
  // `import.meta.env.SSR`, więc jej kod nie trafia do chunku wejściowego. Klient
  // trzyma pełny wiersz - pasek liczy z niego ten sam tytuł (`itemTitle`) i adres
  // (`itemHref`), co z wiersza zrzutowanego (test miękkiej zmiany języka w
  // `TrendingTicker.langSwitch.test.tsx` renderuje z pełnych wierszy).
  it("queryFn na KLIENCIE oddaje pełny wiersz z server fn (projekcja tylko na serwerze)", async () => {
    vi.stubEnv("SSR", false);
    h.trending.mockResolvedValue([row("t1")]);
    const rows = await client().fetchQuery(headerTickerQueryOptions({}, "en"));
    expect(rows).toEqual([row("t1")]);
  });

  it("miękka zmiana języka: poprzedni wpis jest `placeholderData`, pasek się nie zapada", () => {
    expect(headerTickerQueryOptions({}, "en").placeholderData).toBe(keepPreviousData);
  });

  // KRYTYKA L4: klucz SSR (język z adresu żądania, dla stron bez prefiksu z
  // ciasteczka żądania) i klucz klienta (żywy język wyprowadzony przy starcie
  // z `location` i `document.cookie`) są równe także dla strony BEZ prefiksu
  // językowego z ciasteczkiem `en` - oba używają jednej reguły `langForPath`.
  it("parytet klucza SSR/klient: strona bez prefiksu z ciasteczkiem `en`", () => {
    const cookie = `${LANG_COOKIE}=en`;
    document.cookie = cookie;
    try {
      for (const path of ["/profile", "/login", "/", "/en/analizy"]) {
        const server = langForPath(path, () => readLangCookieFromHeader(cookie));
        const browser = langForPath(path, readLangCookieClient);
        expect(browser, path).toBe(server);
        expect(headerTickerQueryOptions({}, browser).queryKey).toEqual(
          headerTickerQueryOptions({}, server).queryKey,
        );
      }
      expect(langForPath("/profile", () => readLangCookieFromHeader(cookie))).toBe("en");
      expect(langForPath("/", () => readLangCookieFromHeader(cookie))).toBe("pl");
    } finally {
      document.cookie = `${LANG_COOKIE}=; max-age=0`;
    }
  });
});
