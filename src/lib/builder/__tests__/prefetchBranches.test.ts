// GALEZIE ODMOWY w rejestrze prefetchu SSR (`lib/builder/prefetch.ts`).
//
// `sectionPrefetch.test.ts` opisuje sciezki SZCZESLIWE: widget skonfigurowany,
// drzewo dokumentu zdrowe, zapytanie rozgrzane. Ten plik bierze druga polowe -
// wejscia, przy ktorych rejestr ma SWIADOMIE nic nie robic - bo to wlasnie one
// decyduja o tym, czy strona wyjdzie z serwera z trescia, czy z pustka.
//
// CZTERY KLASY, KTORE TU SIEDZA
//
// 1. DZIURY W DRZEWIE DOKUMENTU. `collectSectionWidgets` chodzi po JSON-ie
//    z bazy, a nie po strukturze gwarantowanej przez kompilator: sekcja bez
//    dzieci, kolumna bez `children`, `null` w tablicy po skasowanym widgecie.
//    Kazdy z tych ksztaltow ma wlasna galaz i kazdy naprawde wystepuje
//    w zapisanych dokumentach. Wyjatek stad wywrocilby loader trasy, a razem
//    z nim zdehydratowany payload `$_TSR.router` - czyli cala strone, nie
//    jeden widget.
//
// 2. WIDGET NIESKONFIGUROWANY. `club-card` / `club-hub` bez adresu klubu,
//    `world-map` bez ekspertow, `event-schedule` bez prelegentow z kontem.
//    Wszystkie MUSZA dac pusta liste zapytan: rozgrzanie klucza z pustym
//    wejsciem to zapytanie do bazy o nic (i wpis cache, w ktory widget
//    i tak nie trafi).
//
// 3. LANCUCH AUTOROW SLIDERA (prefetch.ts:376-392). Jedyne miejsce w tym
//    module, gdzie rozgrzanie jednego zapytania ZALEZY od wyniku innego. Dotad
//    nie bylo wolane ani razu: warunek `sliderUsesPostsSource` byl w tym pliku
//    wylacznie falszywy, wiec ani nazwiska autorow hero, ani ich pominiecie
//    przy wpisach bez autora nie mialy pokrycia.
//
// 4. CZAPKA CZASU (`raceBudget`). Budzet ma zwrocic sterowanie loaderowi
//    ZANIM najwolniejsze zapytanie sie rozstrzygnie - i nie zostawic po sobie
//    ani drugiego `resolve`, ani timera trzymajacego petle zdarzen.
//
// GRANICA DOWODU: `queryClient.prefetchQuery` jest wszedzie podmieniane, wiec
// zaden przypadek nie schodzi do Supabase. Sprawdzamy KTORE klucze rejestr
// zamawia, a nie co baza na nie odpowiada - piętro danych ma wlasne pliki.
import { describe, it, expect, vi, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import type { BuilderDocument, SectionNode, WidgetContent, WidgetNode } from "@/lib/builder/types";
import {
  collectAboveFoldWidgets,
  collectSectionWidgets,
  prefetchAboveFoldQueries,
  prefetchSectionQueries,
  widgetCacheTargets,
  widgetQueryOptionsList,
} from "@/lib/builder/prefetch";
import { clubThreadsQueryOptions } from "@/lib/builder/clubsQuery";
import { menuWithItemsQueryOptions } from "@/lib/menus/queries";
import { postRefQueryOptions } from "@/lib/builder/contentRefs";
import { sliderFallbackImagesQueryOptions } from "@/lib/builder/sliderFallbackQuery";
import { sliderAuthorsQueryOptions } from "@/lib/builder/sliderAuthorsQuery";
import { sliderPostsQueryOptions, type SliderPostRow } from "@/lib/builder/sliderPostsQuery";

function widget(type: WidgetNode["type"], content: WidgetContent = {}): WidgetNode {
  return {
    kind: "widget",
    id: `w-${type}`,
    type,
    content,
    style: {},
    advanced: {},
  } as WidgetNode;
}

/** Sekcja z jedna kolumna - najprostsze zdrowe drzewo. */
function sectionOf(widgets: WidgetNode[], id = "s1"): SectionNode {
  return {
    id,
    children: [{ kind: "column", id: `${id}-c`, span: { desktop: 12 }, children: widgets }],
  } as unknown as SectionNode;
}

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("dziury w drzewie dokumentu", () => {
  it("sekcja bez tablicy dzieci i z null-em wsrod dzieci nie wywraca zbierania", () => {
    // `children: null` - dokument sprzed migracji sekcji; `null` w tablicy -
    // slad po skasowanej kolumnie, ktorego edytor nie zageszcza.
    const bezDzieci = { id: "s0" } as unknown as SectionNode;
    expect(collectSectionWidgets(bezDzieci)).toEqual([]);

    const zDziura = {
      id: "s1",
      children: [null, { kind: "column", id: "c1", children: [widget("post-list")] }],
    } as unknown as SectionNode;
    expect(collectSectionWidgets(zDziura).map((w) => w.type)).toEqual(["post-list"]);
  });

  it("kolumna bez `children` i z null-em w srodku oddaje tylko realne widgety", () => {
    const section = {
      id: "s2",
      children: [
        { kind: "column", id: "c-pusta" },
        { kind: "column", id: "c-dziurawa", children: [null, widget("carousel"), undefined] },
      ],
    } as unknown as SectionNode;

    expect(collectSectionWidgets(section).map((w) => w.type)).toEqual(["carousel"]);
  });

  it("sekcja wewnetrzna bez kolumn, z null-owa kolumna i z null-em w kolumnie", () => {
    const section = {
      id: "s3",
      children: [
        { kind: "inner-section", id: "is-0" },
        { kind: "inner-section", id: "is-1", columns: [null, { kind: "column", id: "ic-0" }] },
        {
          kind: "inner-section",
          id: "is-2",
          columns: [{ kind: "column", id: "ic-1", children: [null, widget("news-ticker")] }],
        },
      ],
    } as unknown as SectionNode;

    expect(collectSectionWidgets(section).map((w) => w.type)).toEqual(["news-ticker"]);
  });

  it("wezly inne niz widget (kolumna zagniezdzona w kolumnie) sa odsiewane", () => {
    const section = {
      id: "s4",
      children: [
        {
          kind: "column",
          id: "c",
          children: [{ kind: "column", id: "c-zagniezdzona" }, widget("tags")],
        },
      ],
    } as unknown as SectionNode;

    expect(collectSectionWidgets(section).map((w) => w.type)).toEqual(["tags"]);
  });
});

describe("wejscia klubowe: clubWidgetSlug i clubThreadsInput", () => {
  it("adres klubu innego typu niz napis znaczy WIDGET NIESKONFIGUROWANY, a nie zapytanie o pustke", () => {
    // `clubSlug: 42` powstaje z recznej edycji JSON-a albo ze zmiany schematu.
    // Bez koercji do "" poszloby zapytanie `club_view` z p_slug === "42".
    const liczbowy = widget("club-card", { clubSlug: 42 });
    expect(widgetQueryOptionsList(liczbowy, "pl")).toEqual([]);
    expect(widgetCacheTargets(liczbowy, "pl")).toEqual([]);

    const bezAdresu = widget("club-card", {});
    expect(widgetQueryOptionsList(bezAdresu, "pl")).toEqual([]);
    expect(widgetCacheTargets(bezAdresu, "pl")).toEqual([]);

    // Same spacje tez sa pustka - `clubWidgetSlug` trymuje przed porownaniem.
    const spacje = widget("club-card", { clubSlug: "   " });
    expect(widgetQueryOptionsList(spacje, "pl")).toEqual([]);
    expect(widgetCacheTargets(spacje, "pl")).toEqual([]);
  });

  it("club-hub bez adresu klubu tez nie grzeje naglowka", () => {
    const hub = widget("club-hub", { clubSlug: "  " });
    expect(widgetQueryOptionsList(hub, "pl")).toEqual([]);
    expect(widgetCacheTargets(hub, "pl")).toEqual([]);
  });

  it("club-threads przenosi JAWNE sort/policyArea/limit do tej samej fabryki, po ktora siega widok", () => {
    const jawny = widget("club-threads", { sort: "new", policyArea: "klimat", limit: 9 });
    const [opts] = widgetQueryOptionsList(jawny, "pl");

    expect(opts.queryKey).toEqual(
      clubThreadsQueryOptions({ sort: "new", policyArea: "klimat", limit: 9 }).queryKey,
    );
    expect(widgetCacheTargets(jawny, "pl")[0].key).toEqual(opts.queryKey);
  });

  it("club-threads bez treści spada na hot / bez obszaru / 4 - te same domyslne, co widok", () => {
    const domyslny = widget("club-threads", {});
    const [opts] = widgetQueryOptionsList(domyslny, "pl");

    expect(opts.queryKey).toEqual(
      clubThreadsQueryOptions({ sort: "hot", policyArea: "", limit: 4 }).queryKey,
    );

    // Wartosci zlego TYPU (a nie brakujace) musza spasc na te same domyslne:
    // inaczej `limit: "9"` z panelu dalby klucz z napisem zamiast liczby.
    const zleTypy = widget("club-threads", {
      sort: 1,
      policyArea: ["klimat"],
      limit: "9",
    } as unknown as WidgetContent);
    expect(widgetQueryOptionsList(zleTypy, "pl")[0].queryKey).toEqual(opts.queryKey);
  });
});

describe("widgety bez wejscia: mapa swiata, harmonogram, menu", () => {
  it("world-map bez ekspertow nie zamawia zapytania o profile", () => {
    const mapa = widget("world-map", { source: "experts", connections: [] });
    expect(widgetQueryOptionsList(mapa, "pl")).toEqual([]);
    expect(widgetCacheTargets(mapa, "pl")).toEqual([]);
  });

  it("event-schedule bez prelegentow z kontem nie zamawia zapytania o profile", () => {
    const harmonogram = widget("event-schedule", { days: [] });
    expect(widgetQueryOptionsList(harmonogram, "pl")).toEqual([]);
    expect(widgetCacheTargets(harmonogram, "pl")).toEqual([]);
  });

  it("menu bez klucza spada na 'main' - w OBU rejestrach tak samo", () => {
    const bezKlucza = widget("menu", {});
    const oczekiwany = menuWithItemsQueryOptions("main").queryKey;

    expect(widgetQueryOptionsList(bezKlucza, "pl")[0].queryKey).toEqual(oczekiwany);
    expect(widgetCacheTargets(bezKlucza, "pl")[0].key).toEqual(oczekiwany);

    // Pusty napis to NIE jest wybrane menu - inaczej klucz niosl by "" i widok
    // (ktory liczy fallback tak samo) nigdy by w ten wpis nie trafil.
    expect(widgetCacheTargets(widget("menu", { menu_key: "" }), "pl")[0].key).toEqual(oczekiwany);
    expect(widgetCacheTargets(widget("menu", { menu_key: 7 }), "pl")[0].key).toEqual(oczekiwany);
  });
});

describe("slider w trybie recznym - cele cache", () => {
  it("smieci w tablicy slajdow wypadaja, a powtorzone id daje JEDNA referencje", () => {
    const slider = widget("slider", {
      items: [{ postId: "p-1" }, { postId: "p-1" }, { postId: "" }],
    } as unknown as WidgetContent);

    const targets = widgetCacheTargets(slider, "pl");
    expect(targets.map((t) => t.key)).toEqual([
      postRefQueryOptions("p-1", "pl").queryKey,
      // trzy pozycje w tresci -> Math.max(3, 3) = 3 okladki zapasowe
      sliderFallbackImagesQueryOptions(3).queryKey,
    ]);
    // Rejestr zapytan i rejestr celow cache MUSZA sie zgadzac klucz w klucz -
    // rozjazd po cichu wylacza bramke SWR `isSectionFresh` dla calej sekcji.
    expect(widgetQueryOptionsList(slider, "pl").map((o) => o.queryKey)).toEqual(
      targets.map((t) => t.key),
    );
  });

  it("pozycje nie bedace obiektami (napis, null, tablica) nie licza sie do okladek zapasowych", () => {
    // Tablica z wlasnym polem `image` jest tu celowo: `sliderUsesPostsSource`
    // liczy ja jako slajd zwiazany (typeof [] === "object"), a `contentItems`
    // ja odsiewa (`!Array.isArray`). Ta asymetria wysyla widget w tryb RECZNY
    // z ZEREM pozycji - i wtedy dopiero dziala zapasowa trojka w `|| 3`.
    const slajdTablicowy: unknown[] = [];
    (slajdTablicowy as unknown as { image: string }).image = "https://example.com/hero.jpg";

    const slider = widget("slider", {
      items: [slajdTablicowy, "smiec", null],
    } as unknown as WidgetContent);

    expect(widgetCacheTargets(slider, "pl").map((t) => t.key)).toEqual([
      sliderFallbackImagesQueryOptions(3).queryKey,
    ]);
    expect(widgetQueryOptionsList(slider, "pl").map((o) => o.queryKey)).toEqual([
      sliderFallbackImagesQueryOptions(3).queryKey,
    ]);
  });
});

describe("lancuch autorow slidera z postow", () => {
  const trescSlidera: WidgetContent = { source: "posts", limit: 4 };

  /**
   * Podmienia `prefetchQuery` na rejestrator i - dla klucza wpisow slidera -
   * zasiewa cache podanymi wierszami, dokladnie tak, jak zrobiloby to prawdziwe
   * zapytanie. To jedyny sposob, by lancuch (wpisy -> autorzy) w ogole ruszyl,
   * bo drugie ogniwo czyta WYNIK pierwszego przez `getQueryData`.
   */
  /** Pelny wiersz slidera - `sliderAuthorIds` czyta z niego tylko `author_id`. */
  function slajd(id: string, author_id: string | null): SliderPostRow {
    return {
      id,
      slug: `wpis-${id}`,
      title_pl: `Tytul ${id}`,
      title_en: `Title ${id}`,
      excerpt_pl: null,
      excerpt_en: null,
      cover_image_url: null,
      published_at: null,
      author_id,
    };
  }

  function harness(rows: SliderPostRow[] | undefined) {
    const qc = newClient();
    const postsKey = sliderPostsQueryOptions(trescSlidera, "pl").queryKey;
    const zamowione: QueryKey[] = [];
    vi.spyOn(qc, "prefetchQuery").mockImplementation(async (options) => {
      const key = (options as { queryKey: QueryKey }).queryKey;
      zamowione.push(key);
      if (JSON.stringify(key) === JSON.stringify(postsKey) && rows !== undefined) {
        qc.setQueryData(postsKey, rows);
      }
      return undefined;
    });
    return { qc, zamowione, postsKey };
  }

  it("po rozstrzygnieciu wpisow grzeje DOKLADNIE ten wpis autorow, ktory odczyta hero", async () => {
    const { qc, zamowione } = harness([
      slajd("p-1", "u-1"),
      slajd("p-2", null),
      slajd("p-3", "u-1"),
    ]);

    await prefetchSectionQueries(qc, sectionOf([widget("slider", trescSlidera)]), "pl");

    // Kolejnosc id jest CZESCIA klucza (sliderAuthorIds), wiec porownujemy
    // z fabryka, a nie z recznie zapisana tablica.
    expect(zamowione).toContainEqual(sliderAuthorsQueryOptions(["u-1"]).queryKey);
  });

  it("wpisy bez autorow NIE wywoluja drugiego zapytania", async () => {
    const { qc, zamowione } = harness([slajd("p-1", null), slajd("p-2", null)]);

    await prefetchSectionQueries(qc, sectionOf([widget("slider", trescSlidera)]), "pl");

    expect(zamowione.some((k) => k[0] === sliderAuthorsQueryOptions([]).queryKey[0])).toBe(false);
  });

  it("odmowa rozgrzania wpisow nie wypuszcza odrzucenia z lancucha autorow", async () => {
    // Lancuch dokleja `.catch` do WLASNEJ obietnicy, nie tylko do pierwszego
    // ogniwa: bez tego nieudane rozgrzanie hero byloby nieobsluzonym
    // odrzuceniem w loaderze SSR (w Node - ostrzezenie i ryzyko ubicia procesu).
    const qc = newClient();
    vi.spyOn(qc, "prefetchQuery").mockRejectedValue(new Error("odmowa odczytu wpisow"));

    await expect(
      prefetchSectionQueries(qc, sectionOf([widget("slider", trescSlidera)]), "pl"),
    ).resolves.toBeUndefined();
  });

  it("gdy zapytanie o wpisy nic nie zostawilo w cache, lancuch konczy sie cicho", async () => {
    // `undefined` = rozgrzanie nie doszlo do skutku (odmowa, budzet, offline).
    const { qc, zamowione } = harness(undefined);

    await prefetchSectionQueries(qc, sectionOf([widget("slider", trescSlidera)]), "pl");

    expect(zamowione.some((k) => k[0] === sliderAuthorsQueryOptions([]).queryKey[0])).toBe(false);
    // Same wpisy i okladki zapasowe zostaly zamowione - lancuch nie skasowal
    // rozgrzania, ktore i tak mialo sie odbyc.
    expect(zamowione.length).toBeGreaterThanOrEqual(2);
  });
});

describe("izolacja bledow i czapka czasu", () => {
  it("widget o uszkodzonej tresci jest POMIJANY, a nastepny nadal sie rozgrzewa", async () => {
    // Rzucajacy getter odwzorowuje kazdy wyjatek w budowniczym opcji: gdyby
    // wyleciał, zabralby ze soba loader trasy i zdehydratowany payload routera,
    // czyli cala strone - a nie jeden widget.
    const uszkodzony = {
      kind: "widget",
      id: "w-broken",
      type: "post-list",
    } as unknown as WidgetNode;
    Object.defineProperty(uszkodzony, "content", {
      get() {
        throw new Error("uszkodzona tresc widgetu");
      },
    });

    const qc = newClient();
    const spy = vi.spyOn(qc, "prefetchQuery").mockResolvedValue(undefined);

    await expect(
      prefetchSectionQueries(qc, sectionOf([uszkodzony, widget("categories")]), "pl"),
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("dokument bez widgetow konczy sie przed uruchomieniem czapki czasu", async () => {
    const qc = newClient();
    const spy = vi.spyOn(qc, "prefetchQuery").mockResolvedValue(undefined);
    const pusty = { version: 1, sections: [] } as unknown as BuilderDocument;

    expect(collectAboveFoldWidgets(pusty, 3)).toEqual([]);
    await prefetchAboveFoldQueries(qc, pusty, "pl", { budgetMs: 25 });

    expect(spy).not.toHaveBeenCalled();
  });

  it("spozniona praca po wyczerpanym budzecie NIE rozwiazuje obietnicy drugi raz", async () => {
    const qc = newClient();
    let dokonczone = 0;
    vi.spyOn(qc, "prefetchQuery").mockImplementation(
      () =>
        new Promise<void>((r) =>
          setTimeout(() => {
            dokonczone += 1;
            r();
          }, 60),
        ),
    );
    const doc = {
      version: 1,
      sections: [sectionOf([widget("post-list")], "s0")],
    } as unknown as BuilderDocument;

    const start = Date.now();
    await prefetchAboveFoldQueries(qc, doc, "pl", { budgetMs: 1 });
    // Wrocilismy z BUDZETU, a nie z rozstrzygniecia zapytania.
    expect(dokonczone).toBe(0);
    expect(Date.now() - start).toBeLessThan(50);

    // Praca dobiega konca PO powrocie i wola `finish` po raz drugi. Straznik
    // `if (settled) return` jest jedynym, co dzieli ten przypadek od podwojnego
    // `resolve` na tej samej obietnicy.
    await new Promise((r) => setTimeout(r, 120));
    expect(dokonczone).toBe(1);
  });

  it("timer bez `unref` (runtime brzegowy) nie wywraca wyscigu z budzetem", async () => {
    // Node oddaje z `setTimeout` obiekt `Timeout` z metoda `unref`; Workers
    // i Deno Deploy oddaja goly numer. Kod ma to sprawdzic PRZED wywolaniem -
    // inaczej kazde rozgrzanie above-the-fold na brzegu konczy sie TypeError.
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    const uchwyty = new Map<number, ReturnType<typeof globalThis.setTimeout>>();
    let kolejny = 0;
    vi.stubGlobal("setTimeout", (fn: () => void, ms?: number) => {
      const id = (kolejny += 1);
      uchwyty.set(id, realSetTimeout(fn, ms));
      return id;
    });
    vi.stubGlobal("clearTimeout", (id: unknown) => {
      const uchwyt = uchwyty.get(id as number);
      if (uchwyt !== undefined) realClearTimeout(uchwyt);
    });

    const qc = newClient();
    const spy = vi.spyOn(qc, "prefetchQuery").mockResolvedValue(undefined);
    const doc = {
      version: 1,
      sections: [sectionOf([widget("post-list")], "s0")],
    } as unknown as BuilderDocument;

    await expect(
      prefetchAboveFoldQueries(qc, doc, "pl", { budgetMs: 500 }),
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
