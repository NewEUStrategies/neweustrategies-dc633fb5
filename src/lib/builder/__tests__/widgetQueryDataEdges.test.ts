// PIETRO DANYCH malych zapytan widgetowych - te, ktorych queryFn nie wolal
// dotad ZADEN test.
//
// Piec modulow z wiersza "CMS: zapytania danych widgetow" mialo pokrycie
// wylacznie od strony KLUCZA: `sectionPrefetch.test.ts` porownuje `queryKey`
// i na tym konczy. Sam odczyt - i, co wazniejsze, ODMOWA odczytu - nie byl
// uruchamiany ani razu. Ten plik wchodzi w nie publicznym wejsciem
// (`...QueryOptions().queryFn()`), dokladnie tak, jak zrobilby to react-query.
//
// TRZY KONTRAKTY, KTORE TU SIEDZA
//
// 1. CO ZNACZY ODMOWA. Kazdy z tych modulow rozstrzyga to inaczej i KAZDY ma
//    powod: taksonomia i okladki zapasowe polykaja blad (pusty rzad chipow
//    i brak zdjecia zapasowego sa poprawnymi stanami widoku), a licznik odslon
//    zwraca `null`, a NIE zero - "0 odslon" byloby klamstwem nieodroznialnym
//    od prawdy. Zaden z tych wyborow nie jest wyrazony w typach, wiec bez
//    testu nastepny refaktor moze je zamienic miejscami i nic nie zaprotestuje.
//
// 2. KOERCJA, KTORA WCHODZI DO KLUCZA. `podcastLatestLimit` jest CELOWO
//    surowsza od wspolnego `asNum` (odrzuca " 4 ", "4.5", "-2"), bo wynik
//    laduje w kluczu zapytania: kazda roznica wobec widoku daje rozgrzany wpis,
//    w ktory widget nigdy nie trafi. To jest caly powod istnienia tej funkcji.
//
// 3. KOLEJNOSC JAKO CZESC KLUCZA. `sliderAuthorIds` musi oddac te sama liste
//    co widget - zdeduplikowana i w kolejnosci slajdow - inaczej prefetch SSR
//    grzeje jeden wpis, a hero po hydratacji czyta drugi.
//
// GRANICA DOWODU: `edgeTtlCache` (ssrCache.ts:91) pod happy-dom PRZEPUSZCZA
// fetcher bez cache'owania, bo `window` istnieje. Kazde wywolanie queryFn
// realnie schodzi do atrapy i nie trzeba rozbrajac TTL.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseFromStub, SupabaseRpcStub } from "@/test/supabase";

const sb = vi.hoisted(() => ({
  from: null as SupabaseFromStub | null,
  rpc: null as SupabaseRpcStub | null,
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, supabaseRpcStub } = await import("@/test/supabase");
  const fromStub = supabaseFromStub();
  const rpcStub = supabaseRpcStub();
  sb.from = fromStub;
  sb.rpc = rpcStub;
  return { supabase: { from: fromStub.from, rpc: rpcStub.rpc } };
});

import { fail, ok } from "@/test/supabase";
import type { WidgetContent } from "@/lib/builder/types";
import { WIDGET_LIVE_QUERY_PREFIXES, WIDGET_QUERY_ROOTS } from "@/lib/builder/queryKeys";
import {
  sliderAuthorIds,
  sliderAuthorsQueryOptions,
  type SliderAuthorInfo,
} from "@/lib/builder/sliderAuthorsQuery";
import type { SliderPostRow } from "@/lib/builder/sliderPostsQuery";
import { sliderFallbackImagesQueryOptions } from "@/lib/builder/sliderFallbackQuery";
import { postViewCountQueryOptions } from "@/lib/builder/postViewCountQuery";
import {
  CATEGORY_CHIP_COLUMNS,
  TAG_CHIP_COLUMNS,
  categoriesQueryOptions,
  tagsQueryOptions,
} from "@/lib/builder/taxonomyQuery";
import { podcastLatestLimit, webStoriesCarouselLimit } from "@/lib/builder/mediaListQuery";
import { pricingUsesPlansSource } from "@/lib/builder/pricingPlansQuery";
import { ratedListUsesDynamicSource } from "@/lib/builder/ratedListQuery";

const db = (): SupabaseFromStub => {
  if (!sb.from) throw new Error("atrapa `from` nie zostala zamontowana");
  return sb.from;
};
const rpc = (): SupabaseRpcStub => {
  if (!sb.rpc) throw new Error("atrapa `rpc` nie zostala zamontowana");
  return sb.rpc;
};

/** Uruchamia `queryFn` fabryki tak, jak zrobilby to react-query. */
async function run<T>(options: { queryFn?: unknown }): Promise<T> {
  const fn = options.queryFn as () => Promise<T>;
  return fn();
}

beforeEach(() => {
  db().reset();
  rpc().reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("autorzy slajdow: sliderAuthorIds", () => {
  const row = (author_id: string | null): SliderPostRow =>
    ({ id: `p-${author_id ?? "brak"}`, author_id }) as unknown as SliderPostRow;

  it("brak wierszy (undefined) daje pusta liste, a nie wyjatek", () => {
    expect(sliderAuthorIds(undefined)).toEqual([]);
    expect(sliderAuthorIds([])).toEqual([]);
  });

  it("odsiewa wpisy bez autora i deduplikuje ZACHOWUJAC kolejnosc slajdow", () => {
    // Kolejnosc jest czescia klucza zapytania: prefetch SSR i widget musza
    // wyprowadzic identyczna liste z tych samych wierszy, inaczej klient po
    // hydratacji chybi rozgrzany wpis i zaplaci drugie zapytanie.
    expect(sliderAuthorIds([row(null), row("u-2"), row("u-1"), row("u-2")])).toEqual([
      "u-2",
      "u-1",
    ]);
    expect(sliderAuthorIds([row("u-1"), row("u-2")])).not.toEqual(["u-2", "u-1"]);
  });

  it("pusty napis w author_id NIE jest autorem", () => {
    expect(sliderAuthorIds([row(""), row("u-1")])).toEqual(["u-1"]);
  });
});

describe("autorzy slajdow: odczyt profiles_public", () => {
  it("sklada nazwe trzystopniowo: display_name -> imie+nazwisko -> pusty napis", async () => {
    db().setResponse("profiles_public", () =>
      ok([
        {
          id: "u-1",
          display_name: "  ",
          first_name: "Jan",
          last_name: null,
          avatar_url: null,
          slug: null,
        },
        {
          id: "u-2",
          display_name: null,
          first_name: null,
          last_name: null,
          avatar_url: null,
          slug: null,
        },
        {
          id: "u-3",
          display_name: "Redakcja",
          first_name: "Ignorowane",
          last_name: "Ignorowane",
          avatar_url: "https://example.com/a.png",
          slug: "redakcja",
        },
      ]),
    );

    const map = await run<Record<string, SliderAuthorInfo>>(
      sliderAuthorsQueryOptions(["u-1", "u-2", "u-3"]),
    );

    // display_name z samych spacji NIE jest nazwiskiem - inaczej byline hero
    // renderowaloby pusty pasek zamiast zlozonego imienia i nazwiska.
    expect(map["u-1"]).toEqual({ name: "Jan", avatar: "", slug: "" });
    expect(map["u-2"]).toEqual({ name: "", avatar: "", slug: "" });
    expect(map["u-3"].name).toBe("Redakcja");
    expect(map["u-3"].avatar).toBe("https://example.com/a.png");
    expect(db().lastChain("profiles_public")?.argsOf("in")?.[0]).toBe("id");
  });

  it("odmowa odczytu profili daje PUSTA mape, a nie wyjatek", async () => {
    // Slider ma sie wyrenderowac bez byline; rzucenie wywrocilo by cale hero.
    db().setResponse("profiles_public", () => fail("permission denied", "42501"));

    await expect(run(sliderAuthorsQueryOptions(["u-1"]))).resolves.toEqual({});
  });

  // DEFEKT: KORZEN KLUCZA AUTOROW STOI POZA REJESTREM KORZENI.
  //
  // WEJSCIE: dowolny slider czytajacy wpisy z bazy (hero strony glownej),
  //   plus zmiana nazwiska albo awatara autora w panelu profilu.
  // CO PSUJE: `sliderAuthorsQuery.ts:64` buduje klucz z GOLEGO literalu
  //   "builder-slider-authors", zamiast siegnac po `WIDGET_QUERY_ROOTS`.
  //   Skoro korzenia nie ma w tym obiekcie, nie ma go tez w
  //   `LIVE_INVALIDATED_ROOTS` ani w `WIDGET_LIVE_QUERY_PREFIXES`, po ktorych
  //   chodzi predykat `invalidateQueries` w `widgetCacheInvalidation.tsx`.
  // KONSEKWENCJA: `builder-slider-posts` unieważnia sie poprawnie, wiec slajdy
  //   pokazuja nowy tytul i okladke, ale byline obok nich zostaje ze STARYM
  //   nazwiskiem i starym awatarem az do wygasniecia `staleTime` (60 s) albo
  //   przeladowania karty. Awaria jest cicha w obie strony: nic nie zglasza
  //   bledu, a widget nadal "cos" pokazuje. To dokladnie ta klasa rozjazdu,
  //   dla ktorej powstal `queryKeys.ts` (naglowek, linie 3-14) - tylko ominieta,
  //   bo `queryKeys.test.ts` sprawdza kierunek korzen -> uzycie, a nie
  //   uzycie -> korzen.
  // WYMAGANA POPRAWKA: dopisac `sliderAuthors: "builder-slider-authors"` do
  //   `WIDGET_QUERY_ROOTS`, uzyc tej stalej w `sliderAuthorsQueryOptions`
  //   i dodac ja do `LIVE_INVALIDATED_ROOTS` (zapytanie zalezy od tresci
  //   redakcyjnej - profilu autora opublikowanego wpisu).
  it.fails(
    "DEFEKT: korzen klucza autorow slidera MUSI byc w rejestrze i w inwalidacji live",
    () => {
      const korzen = sliderAuthorsQueryOptions(["u-1"]).queryKey[0];

      expect(Object.values(WIDGET_QUERY_ROOTS)).toContain(korzen);
      expect(WIDGET_LIVE_QUERY_PREFIXES.has(korzen)).toBe(true);
    },
  );
});

describe("okladki zapasowe slidera", () => {
  it("zaciska liczbe okladek do minimum trzech - w kluczu I w zapytaniu", async () => {
    expect(sliderFallbackImagesQueryOptions(0).queryKey[1]).toBe(3);
    expect(sliderFallbackImagesQueryOptions(Number.NaN).queryKey[1]).toBe(3);
    expect(sliderFallbackImagesQueryOptions(1).queryKey[1]).toBe(3);
    expect(sliderFallbackImagesQueryOptions(8).queryKey[1]).toBe(8);

    db().setResponse("posts", () => ok([]));
    await run(sliderFallbackImagesQueryOptions(1));

    // Do bazy MUSI pojsc wartosc zacisnieta, nie surowa: inaczej klucz mowilby
    // "3", a wpis cache trzymalby jedno zdjecie.
    expect(db().lastChain("posts")?.argsOf("limit")?.[0]).toBe(3);
  });

  it("odsiewa adresy puste i niebezpieczne, zostawiajac tylko realne obrazy", async () => {
    db().setResponse("posts", () =>
      ok([
        { cover_image_url: null },
        { cover_image_url: "javascript:alert(1)" },
        { cover_image_url: "https://example.com/okladka.jpg" },
      ]),
    );

    await expect(run(sliderFallbackImagesQueryOptions(3))).resolves.toEqual([
      "https://example.com/okladka.jpg",
    ]);
  });

  it("odmowa odczytu okladek daje PUSTA liste, a nie wyjatek", async () => {
    // Slider bez wlasnych zdjec pokaze placeholder; wyjatek wywrocilby sekcje.
    db().setResponse("posts", () => fail("permission denied for table posts", "42501"));

    await expect(run(sliderFallbackImagesQueryOptions(3))).resolves.toEqual([]);
  });
});

describe("licznik odslon wpisu", () => {
  it("pusty identyfikator wpisu NIE puka do bazy", async () => {
    await expect(run(postViewCountQueryOptions(""))).resolves.toBeNull();
    expect(rpc().calls).toHaveLength(0);
  });

  it("odmowa RPC daje null (a NIE zero) i zostawia slad w konsoli", async () => {
    // "0 odslon" byloby klamstwem nieodroznialnym od prawdy - widget ma wtedy
    // nie pokazac licznika w ogole.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    rpc().setError("post_view_count", "function post_view_count does not exist", "42883");

    await expect(run(postViewCountQueryOptions("post-1"))).resolves.toBeNull();
    expect(String(warn.mock.calls[0]?.[0])).toContain("[post-meta]");
  });

  it("runtime bez obiektu `console` tez oddaje null, a nie wyjatek", async () => {
    // Straznik `typeof console !== "undefined"` nie jest ozdoba: ten sam modul
    // biegnie w loaderze SSR na brzegu, gdzie konsola nie musi istniec. Gdyby
    // straznika nie bylo, odmowa RPC zamieniala by sie w TypeError wewnatrz
    // queryFn - czyli widget wchodzilby w stan bledu zamiast ukryc licznik.
    rpc().setError("post_view_count", "function post_view_count does not exist", "42883");
    vi.stubGlobal("console", undefined);

    let wynik: number | null | undefined;
    let blad: unknown;
    try {
      wynik = await run<number | null>(postViewCountQueryOptions("post-1"));
    } catch (e) {
      blad = e;
    } finally {
      // Konsola wraca PRZED asercjami - inaczej niepowodzenie testu nie mialoby
      // czym sie zaraportowac.
      vi.unstubAllGlobals();
    }

    expect(blad).toBeUndefined();
    expect(wynik).toBeNull();
  });

  it("koercja bigint z PostgREST: liczba, napis, tablica i smiec", async () => {
    const przypadki: Array<[unknown, number | null]> = [
      [42, 42],
      [" 42 ", 42],
      ["abc", null],
      [Number.POSITIVE_INFINITY, null],
      [true, null],
      [null, null],
      [[{ post_view_count: "7" }], 7],
      [[9], 9],
      [[], null],
    ];

    for (const [odpowiedz, oczekiwane] of przypadki) {
      rpc().setData("post_view_count", odpowiedz);
      await expect(run(postViewCountQueryOptions("post-1"))).resolves.toBe(oczekiwane);
    }

    expect(rpc().lastCall("post_view_count")?.arg("_post_id")).toBe("post-1");
  });
});

describe("taksonomie: kategorie i tagi", () => {
  it("odmowa odczytu daje PUSTY rzad chipow, a nie blad sekcji", async () => {
    db().setResponse("categories", () => fail("permission denied for table categories", "42501"));
    db().setResponse("tags", () => fail("permission denied for table tags", "42501"));

    await expect(run(categoriesQueryOptions())).resolves.toEqual([]);
    await expect(run(tagsQueryOptions())).resolves.toEqual([]);
  });

  it("brak wierszy (data null) tez daje pusta liste", async () => {
    db().setResponse("categories", () => ok(null));
    db().setResponse("tags", () => ok(null));

    await expect(run(categoriesQueryOptions())).resolves.toEqual([]);
    await expect(run(tagsQueryOptions())).resolves.toEqual([]);
  });

  it("czyta DOKLADNIE te kolumny, ktore porownuje bramka dryfu z widokami", async () => {
    db().setResponse("categories", () =>
      ok([{ id: "c-1", slug: "ue", name_pl: "UE", name_en: "EU" }]),
    );
    db().setResponse("tags", () => ok([{ id: "t-1", slug: "klimat", name: "Klimat" }]));

    await run(categoriesQueryOptions());
    await run(tagsQueryOptions());

    expect(db().lastChain("categories")?.argsOf("select")?.[0]).toBe(CATEGORY_CHIP_COLUMNS);
    expect(db().lastChain("tags")?.argsOf("select")?.[0]).toBe(TAG_CHIP_COLUMNS);
  });
});

describe("limity widgetow mediow", () => {
  it("podcastLatestLimit jest CELOWO surowszy od wspolnego asNum", () => {
    // Wynik laduje w kluczu ["podcasts","latest",N]. Kazda tolerancja, ktorej
    // nie ma widok, daje inny klucz - czyli rozgrzany wpis bez odbiorcy.
    expect(podcastLatestLimit({ limit: 4 } as WidgetContent)).toBe(4);
    expect(podcastLatestLimit({ limit: "4" } as WidgetContent)).toBe(4);
    expect(podcastLatestLimit({ limit: " 4 " } as WidgetContent)).toBe(4);
    expect(podcastLatestLimit({ limit: "4.5" } as WidgetContent)).toBe(4);
    expect(podcastLatestLimit({ limit: "-2" } as WidgetContent)).toBe(4);
    expect(podcastLatestLimit({ limit: null } as unknown as WidgetContent)).toBe(4);
    expect(podcastLatestLimit({} as WidgetContent)).toBe(4);
  });

  it("podcastLatestLimit NIE zaciska - klamra siedzi w queryFn, czyli poza kluczem", () => {
    // Widok wstawia do klucza wartosc surowa, wiec rejestr musi zrobic to samo.
    expect(podcastLatestLimit({ limit: 999 } as WidgetContent)).toBe(999);
  });

  it("webStoriesCarouselLimit zaciska OBUSTRONNIE, bo tu klamra JEST czescia klucza", () => {
    expect(webStoriesCarouselLimit({ limit: 1 } as WidgetContent)).toBe(2);
    expect(webStoriesCarouselLimit({ limit: 99 } as WidgetContent)).toBe(20);
    expect(webStoriesCarouselLimit({} as WidgetContent)).toBe(8);
    // Zero to LICZBA, a nie brak wartosci: `widgetNum` oddaje je bez zmian
    // i dopiero dolny zacisk podnosi je do 2. Domyslna osemka NIE wchodzi -
    // gdyby wchodzila, "0 historii" z panelu renderowaloby osiem kafelkow.
    expect(webStoriesCarouselLimit({ limit: 0 } as WidgetContent)).toBe(2);
    expect(webStoriesCarouselLimit({ limit: "0" } as WidgetContent)).toBe(2);
  });
});

describe("bramki zrodla: cennik kontra lista oceniana", () => {
  it("cennik porownuje SCISLE - spacja albo inny typ znaczy tryb reczny", () => {
    expect(pricingUsesPlansSource({ source: "plans" } as WidgetContent)).toBe(true);
    expect(pricingUsesPlansSource({} as WidgetContent)).toBe(false);
    expect(pricingUsesPlansSource({ source: "manual" } as WidgetContent)).toBe(false);
    expect(pricingUsesPlansSource({ source: "plans " } as WidgetContent)).toBe(false);
    expect(pricingUsesPlansSource({ source: 1 } as unknown as WidgetContent)).toBe(false);
  });

  it("lista oceniana idzie przez asOneOf, wiec spacje TOLERUJE - roznica jest swiadoma", () => {
    // Obie bramki decyduja o tym samym: czy sekcja zglasza sie jako "z danymi".
    // Roznia sie tolerancja na spacje, bo `pricing` odwzorowuje `getStr` z
    // SimpleWidgets, a `rated-list` - `asOneOf` ze wspolnego content-model.
    // Dopoki obie sa mirrorem SWOJEGO widoku, roznica jest poprawna; ten test
    // ma ja UTRWALIC, zeby ujednolicenie bramek bylo swiadoma decyzja, a nie
    // skutkiem ubocznym.
    expect(ratedListUsesDynamicSource({ source: "dynamic" } as WidgetContent)).toBe(true);
    expect(ratedListUsesDynamicSource({ source: " dynamic " } as WidgetContent)).toBe(true);
    expect(ratedListUsesDynamicSource({} as WidgetContent)).toBe(false);
    expect(ratedListUsesDynamicSource({ source: "manual" } as WidgetContent)).toBe(false);
    expect(ratedListUsesDynamicSource({ source: 1 } as unknown as WidgetContent)).toBe(false);
  });
});
