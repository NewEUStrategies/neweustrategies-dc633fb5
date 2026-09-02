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
import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";

interface TickerPost {
  id: string;
  slug: string;
  title_pl: string;
  title_en: string;
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
  resolveTickerSource,
  type TickerConfig,
} from "../headerTickerQuery";

const NOW = Date.parse("2026-09-01T12:00:00.000Z");
const YESTERDAY = "2026-08-31T12:00:00.000Z";
const TOMORROW = "2026-09-02T12:00:00.000Z";
const PINNED = "11111111-1111-4111-8111-111111111111";
const SEL = ["a1111111-1111-4111-8111-111111111111", "b2222222-2222-4222-8222-222222222222"];

function post(id: string): TickerPost {
  return { id, slug: id, title_pl: `Wpis ${id}`, title_en: `Post ${id}` };
}

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeEach(() => {
  h.trending.mockReset();
  h.ticker.mockReset();
  h.trending.mockResolvedValue([post("t1")]);
  h.ticker.mockResolvedValue([post("k1")]);
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
    expect(headerTickerQueryOptions(cfg).queryKey).toEqual([
      "header_ticker",
      "mixed",
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
    expect(headerTickerQueryOptions({}).queryKey).toEqual([
      "header_ticker",
      "trending",
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
    expect(key[5]).toBe([SEL[1], SEL[0], "c3333333-3333-4333-8333-333333333333"].join(","));
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
    expect(expired[4]).toBe(PINNED);
  });

  it("loader SSR i klient budują ten sam klucz, więc druga strona NIE strzela do serwera", async () => {
    const qc = client();
    const cfgSsr: TickerConfig = { source: "trending", days: 3, limit: 6 };
    const cfgClient: TickerConfig = { source: "trending", days: 3, limit: 6 };

    await qc.fetchQuery(headerTickerQueryOptions(cfgSsr));
    const fromCache = await qc.fetchQuery(headerTickerQueryOptions(cfgClient));

    expect(h.trending).toHaveBeenCalledTimes(1);
    expect(fromCache).toEqual([post("t1")]);
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
    const rows = await client().fetchQuery(headerTickerQueryOptions({ source: "latest" }));

    expect(h.ticker).toHaveBeenCalledWith({
      data: { source: "latest", limit: 8, pinnedPostId: undefined },
    });
    expect(rows).toEqual([post("k1")]);
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
