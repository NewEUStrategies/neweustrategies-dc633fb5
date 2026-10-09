// SCIEZKA DANYCH post-listy - to, czego nie widac w czystych helperach.
//
// `postListQuery.ts` ma dwa piętra. Piętro czyste (`postListInput`,
// `postListOrderColumn`, `rankAndSlicePopular`, `dedupeAndSlice`) jest opisane
// w plikach siostrzanych. Piętro DANYCH - `fetchPopularPostIds`,
// `fetchPostListRows`, `attachAuthorNames` (plus wspolne
// `taxonomyConstraintsFromSlugs` z `lib/queries/taxonomyPivot.ts`) - jest
// modulo-prywatne i dotad nie mialo ani jednego wywolania. Ten plik wchodzi
// w nie PUBLICZNYM wejsciem, czyli `postListQueryOptions(...).queryFn()`,
// dokladnie tak, jak zrobilby to react-query.
//
// CO TU JEST NAPRAWDE DO OBRONY
//
// 1. DEGRADACJA RANKINGU (postListQuery.ts:344-357). Trzy wyniki RPC znacza
//    trzy ROZNE rzeczy i kod je rozroznia poprawnie:
//      * blad RPC          -> `null` -> sortowanie spada na "published_at",
//                             widget oddaje liste PO SWIEZOSCI, a NIE pusta;
//      * pusta lista       -> nikt nie jest popularny -> pusto jest pusto;
//      * niepusty ranking  -> wiersze ranguja sie wedlug niego, a zbior
//                             kandydatow zawezany jest do <=200 id z RPC.
//    To jest odwrotnosc defektu "awaria odczytu udaje pustke", ktory audyt
//    policzyl 12 razy w module 19. Skoro tutaj jest zrobione dobrze, musi byc
//    PRZYPIETE - inaczej nastepny refaktor zamieni `null` na `[]` i nikt tego
//    nie zauwazy, bo widget nadal "cos" pokazuje (nic).
//
// 2. OKNO WYNIKOW. Dla "popular" zapytanie CELOWO nie niesie `.range` - okno
//    tnie `rankAndSlicePopular` PO zrankowaniu, bo baza nie zna kolejnosci
//    popularnosci. Dla "random" jest odwrotnie: `.range` JEST, a `.order` nie,
//    wiec tasowanie dotyczy WYLACZNIE pobranego okna, a nie calego zbioru.
//    Obie asymetrie sa nieoczywiste i obie zmieniaja wynik widgetu.
//
// 3. ALGEBRA include/exclude - koniunkcja (a nie suma) kategorii, tagow
//    i jawnych id, liczona OD 03.10.2026 W BAZIE (osadzenia `!inner()`
//    i anty-zlaczenia `alias=is.null`, `lib/queries/taxonomyPivot.ts`), bez
//    przewozenia identyfikatorow wpisow przez adres URL.
//
// 4. "WZBOGACAMY, NIGDY NIE KASUJEMY" w `attachAuthorNames`: brak profilu
//    zostawia to, co wiersz juz niesie, zamiast nadpisac nazwisko null-em.
//
// GRANICA DOWODU: `edgeTtlCache` w srodowisku przegladarki (happy-dom definiuje
// `window`) przepuszcza fetcher bez cache'owania - jest na to osobny przypadek
// nizej, zeby nikt nie musial zgadywac, czy kolejne wywolania sa liczone.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordedChain, SupabaseFromStub, SupabaseRpcStub } from "@/test/supabase";

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
import { postListQueryOptions, type Lang, type PostRow } from "@/lib/builder/postListQuery";

function db(): SupabaseFromStub {
  if (sb.from === null) throw new Error("test: atrapa `from` nie zostala utworzona");
  return sb.from;
}

function rpc(): SupabaseRpcStub {
  if (sb.rpc === null) throw new Error("test: atrapa `rpc` nie zostala utworzona");
  return sb.rpc;
}

/** Uruchamia `queryFn` opcji tak, jak zrobilby to react-query. */
function runQueryFn(content: WidgetContent, lang: Lang = "pl"): Promise<PostRow[]> {
  const options = postListQueryOptions(content, lang, "list");
  return (options.queryFn as () => Promise<PostRow[]>)();
}

function postRow(id: string, patch: Partial<PostRow> = {}): PostRow {
  return {
    id,
    slug: `wpis-${id}`,
    title_pl: `Tytul ${id}`,
    title_en: `Title ${id}`,
    excerpt_pl: null,
    excerpt_en: null,
    cover_image_url: null,
    published_at: "2026-01-01T09:00:00Z",
    post_format: null,
    author_id: null,
    ...patch,
  };
}

function setPosts(rows: PostRow[]): void {
  db().setResponse("posts", () => ok(rows));
}

function ids(rows: readonly PostRow[]): string[] {
  return rows.map((r) => r.id);
}

/** Zapytanie o posty - jedyne, ktore niesie filtry widgetu. */
function postsChain(): RecordedChain {
  const chain = db().lastChain("posts");
  if (!chain) throw new Error("test: zapytanie o `posts` w ogole nie poszlo");
  return chain;
}

/** Argumenty WSZYSTKICH wystapien ogniwa - `argsOf` oddaje tylko pierwsze. */
function callArgs(chain: RecordedChain, method: string): ReadonlyArray<unknown>[] {
  return chain.calls.filter((c) => c.method === method).map((c) => c.args);
}

/** Wartosci przekazane do `.in(kolumna, [...])` danego lancucha. */
function inValues(chain: RecordedChain): string[] {
  return (chain.argsOf("in")?.[1] as string[] | undefined) ?? [];
}

/** Atrapa `console.warn` - cicha degradacja rankingu musi zostawiac slad. */
function warn() {
  return vi.mocked(console.warn);
}

beforeEach(() => {
  db().reset();
  rpc().reset();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("degradacja rankingu popularnosci", () => {
  it("gdy RPC popular_post_ids ODMAWIA, widget oddaje liste po swiezosci, a NIE pusta", async () => {
    rpc().setError("popular_post_ids", "function popular_post_ids does not exist", "42883");
    setPosts([postRow("nowszy"), postRow("starszy")]);

    const rows = await runQueryFn({ orderBy: "popular" });

    expect(ids(rows)).toEqual(["nowszy", "starszy"]);
    // Degradacja jest WIDOCZNA w zapytaniu: sortowanie realnie spadlo na
    // kolumne swiezosci, a nie tylko "przestalo byc popularne".
    expect(postsChain().argsOf("order")).toEqual(["published_at", { ascending: false }]);
    // Skoro sortowanie nie jest juz "popular", okno tnie BAZA.
    expect(postsChain().argsOf("range")).toEqual([0, 5]);
    // Zadnego zawezenia do kandydatow - rankingu przeciez nie ma.
    expect(postsChain().has("in")).toBe(false);
  });

  it("odmowa RPC zostawia SLAD w konsoli (cicha degradacja jest nieodrozninalna od poprawnego wyniku)", async () => {
    rpc().setError("popular_post_ids", "permission denied for function popular_post_ids", "42501");
    setPosts([postRow("a")]);

    await runQueryFn({ orderBy: "popular" });

    expect(warn()).toHaveBeenCalledTimes(1);
    expect(String(warn().mock.calls[0]?.[0])).toContain("popular_post_ids");
    expect(String(warn().mock.calls[0]?.[1])).toContain("permission denied");
  });

  it("runtime BEZ obiektu console degraduje ranking tak samo - i nie rzuca", async () => {
    // Straznik `typeof console !== "undefined"` (postListQuery.ts:301) nie jest
    // ozdoba: ta sciezka biegnie w loaderze SSR na brzegu, gdzie konsoli nie
    // musi byc. Bez straznika odmowa RPC zamieniala by sie w TypeError wewnatrz
    // queryFn, czyli w BLAD SEKCJI - i widget nie oddal by nawet listy po
    // swiezosci, ktora cala ta degradacja ma ratowac.
    rpc().setError("popular_post_ids", "function popular_post_ids does not exist", "42883");
    setPosts([postRow("nowszy"), postRow("starszy")]);
    vi.stubGlobal("console", undefined);

    let rows: PostRow[] | undefined;
    let blad: unknown;
    try {
      rows = await runQueryFn({ orderBy: "popular" });
    } catch (e) {
      blad = e;
    } finally {
      // Konsola wraca PRZED asercjami - inaczej niepowodzenie testu nie mialoby
      // czym sie zaraportowac.
      vi.unstubAllGlobals();
    }

    expect(blad).toBeUndefined();
    expect(ids(rows ?? [])).toEqual(["nowszy", "starszy"]);
  });

  it("gdy ranking jest PUSTY, wynik jest pusty i zapytanie o posty w ogole nie leci", async () => {
    rpc().setData("popular_post_ids", []);

    const rows = await runQueryFn({ orderBy: "popular" });

    expect(rows).toEqual([]);
    expect(db().chainsFor("posts")).toHaveLength(0);
    // Pusto jest pusto - to NIE jest awaria, wiec nikt nie ostrzega.
    expect(warn()).not.toHaveBeenCalled();
  });

  it("niepusty ranking ustawia kolejnosc wynikow i ZAWEZA zapytanie do kandydatow z RPC", async () => {
    rpc().setData("popular_post_ids", [{ post_id: "c" }, { post_id: "a" }, { post_id: "b" }]);
    setPosts([postRow("a"), postRow("b"), postRow("c")]);

    const rows = await runQueryFn({ orderBy: "popular" });

    expect(ids(rows)).toEqual(["c", "a", "b"]);
    expect(postsChain().argsOf("in")).toEqual(["id", ["c", "a", "b"]]);
    expect(warn()).not.toHaveBeenCalled();
  });

  it("kierunek 'asc' ODWRACA ranking - od najmniej popularnych", async () => {
    rpc().setData("popular_post_ids", [{ post_id: "c" }, { post_id: "a" }, { post_id: "b" }]);
    setPosts([postRow("a"), postRow("b"), postRow("c")]);

    const rows = await runQueryFn({ orderBy: "popular", orderDir: "asc" });

    expect(ids(rows)).toEqual(["b", "a", "c"]);
    expect(inValues(postsChain())).toEqual(["b", "a", "c"]);
  });

  it("okno popularnosci pyta o 200 kandydatow, a liczbe dni ZACISKA i ZAOKRAGLA", async () => {
    rpc().setData("popular_post_ids", [{ post_id: "a" }]);
    setPosts([postRow("a")]);

    await runQueryFn({ orderBy: "popular", popularDays: 900 });
    expect(rpc().lastCall("popular_post_ids")?.arg("_days")).toBe(365);
    expect(rpc().lastCall("popular_post_ids")?.arg("_limit")).toBe(200);

    await runQueryFn({ orderBy: "popular", popularDays: 7.6 });
    expect(rpc().lastCall("popular_post_ids")?.arg("_days")).toBe(8);

    await runQueryFn({ orderBy: "popular", popularDays: 0 });
    expect(rpc().lastCall("popular_post_ids")?.arg("_days")).toBe(1);
  });

  it("brak danych z RPC (data null) czyta sie jak PUSTY ranking, a nie jak awarie", async () => {
    rpc().setData("popular_post_ids", null);

    const rows = await runQueryFn({ orderBy: "popular" });

    expect(rows).toEqual([]);
    expect(db().chainsFor("posts")).toHaveLength(0);
    expect(warn()).not.toHaveBeenCalled();
  });

  it("ranking rozlaczny z lista jawnych id konczy sie pusta lista BEZ zapytania o posty", async () => {
    // ZMIANA 03.10.2026: przeciecie jawnych id z rankingiem liczy sie PRZED
    // zapytaniem o posty (oba zbiory sa ograniczone: id z panelu i <=200
    // kandydatow z RPC), wiec puste przeciecie nie placi juz round-tripu
    // z pustym `.in("id", [])`, ktory poprzednia wersja tego przypadku
    // przypinala jako obserwacje.
    rpc().setData("popular_post_ids", [{ post_id: "a" }]);
    setPosts([]);

    const rows = await runQueryFn({ orderBy: "popular", includeIdsCsv: "z" });

    expect(rows).toEqual([]);
    expect(db().chainsFor("posts")).toHaveLength(0);
  });

  it("ranking przeciety z jawnymi id zaweza zapytanie do CZESCI WSPOLNEJ", async () => {
    rpc().setData("popular_post_ids", [{ post_id: "c" }, { post_id: "a" }, { post_id: "b" }]);
    setPosts([postRow("a"), postRow("b")]);

    const rows = await runQueryFn({ orderBy: "popular", includeIdsCsv: "b, a, z" });

    expect(inValues(postsChain())).toEqual(["b", "a"]);
    expect(ids(rows)).toEqual(["a", "b"]);
  });

  it("RPC rankingu biegnie w TEJ SAMEJ fali co slowniki taksonomii", async () => {
    // Optymalizacja 03.10.2026: ranking nie zalezy od taksonomii, wiec nie
    // czeka na odczyt `categories`. Dowod: RPC jest wolane, zanim odpowiedz
    // slownika zostanie rozwiazana.
    let releaseCategories: () => void = () => undefined;
    db().setResponse(
      "categories",
      () =>
        new Promise((resolve) => {
          releaseCategories = () => resolve(ok([{ id: "cat-1", slug: "polityka" }]));
        }),
    );
    rpc().setData("popular_post_ids", [{ post_id: "a" }]);
    setPosts([postRow("a")]);

    const pending = runQueryFn({ orderBy: "popular", categoriesCsv: "polityka" });
    await vi.waitFor(() => expect(rpc().lastCall("popular_post_ids")).toBeDefined());
    expect(db().chainsFor("posts")).toHaveLength(0);
    releaseCategories();

    await expect(pending).resolves.toHaveLength(1);
  });
});

describe("okno wynikow zaleznie od sortowania", () => {
  it("sortowanie 'popular' NIE niesie .range ani .order - okno tnie ranking po pobraniu", async () => {
    rpc().setData("popular_post_ids", [
      { post_id: "a" },
      { post_id: "b" },
      { post_id: "c" },
      { post_id: "d" },
    ]);
    setPosts([postRow("d"), postRow("c"), postRow("b"), postRow("a")]);

    const rows = await runQueryFn({ orderBy: "popular", limit: 2, offset: 1 });

    expect(postsChain().has("range")).toBe(false);
    expect(postsChain().has("order")).toBe(false);
    // Offset i limit dzialaja - tyle ze na WYNIKU, po zrankowaniu.
    expect(ids(rows)).toEqual(["b", "c"]);
  });

  it("sortowanie 'random' stosuje .range i NIE stosuje .order - tasuje WYLACZNIE pobrane okno", async () => {
    // Comparator `() => Math.random() - 0.5` jest z definicji niedeterministyczny;
    // ustalona wartosc czyni przebieg stabilnym.
    vi.spyOn(Math, "random").mockReturnValue(0);
    const okno = [postRow("r1"), postRow("r2"), postRow("r3")];
    setPosts(okno);

    const rows = await runQueryFn({ orderBy: "random", limit: 3, offset: 2 });

    expect(postsChain().argsOf("range")).toEqual([2, 4]);
    expect(postsChain().has("order")).toBe(false);
    // Tasowanie nie gubi ani nie dokłada wierszy: dostajemy DOKLADNIE okno.
    expect([...ids(rows)].sort()).toEqual(["r1", "r2", "r3"]);
    // ...ale w innej kolejnosci, czyli tasowanie naprawde poszlo.
    expect(ids(rows)).not.toEqual(["r1", "r2", "r3"]);
  });

  it("sortowanie po tytule wybiera kolumne JEZYKA i kierunek rosnacy", async () => {
    setPosts([postRow("a")]);

    await runQueryFn({ orderBy: "title", orderDir: "asc" }, "en");

    expect(postsChain().argsOf("order")).toEqual(["title_en", { ascending: true }]);
  });

  it("nadmiarowe pobranie uniqueOnPage POSZERZA zakres .range, a nie limit wyswietlania", async () => {
    setPosts([postRow("a")]);

    await runQueryFn({ limit: 6, uniqueOnPage: true });

    expect(postsChain().argsOf("range")).toEqual([0, 23]);
  });
});

/** Napis `select` zapytania o posty - osadzenia taksonomii siedza WLASNIE w nim. */
function selectOf(chain: RecordedChain): string {
  return String(chain.argsOf("select")?.[0]);
}

/** Ogniwa `.in("id", ...)` - po naprawie niosa WYLACZNIE id ograniczone z gory. */
function idInCalls(chain: RecordedChain): ReadonlyArray<unknown>[] {
  return callArgs(chain, "in").filter((args) => args[0] === "id");
}

describe("zawezenia zbioru wynikow (include / exclude)", () => {
  it("bez zadnych zawezen zapytanie NIE niesie ani .in po id, ani .not", async () => {
    setPosts([postRow("a")]);

    await runQueryFn({});

    expect(postsChain().has("in")).toBe(false);
    expect(postsChain().has("not")).toBe(false);
    expect(db().chains.map((c) => c.table)).toEqual(["posts"]);
  });

  it("kategorie, tagi i jawne id sa KONIUNKCJA w JEDNYM zapytaniu, a nie suma", async () => {
    // Przeciecie liczy baza: dwa osadzenia `!inner()` (wpis musi miec
    // kategorie ORAZ tag) plus `.in("id", ...)` z jawnymi id wpisanymi
    // w panelu - jedyna lista id wpisow, ktora zostaje, bo jest ograniczona
    // tym, co wpisze czlowiek.
    db().setResponse("categories", () => ok([{ id: "cat-1", slug: "polityka" }]));
    db().setResponse("tags", () => ok([{ id: "tag-1", slug: "ue" }]));
    setPosts([postRow("p2"), postRow("p3")]);

    const rows = await runQueryFn({
      categoriesCsv: "polityka",
      tagsCsv: "ue",
      includeIdsCsv: "p2, p3, p9",
    });

    expect(selectOf(postsChain())).toContain("tx_inc_category_0:post_categories!inner()");
    expect(selectOf(postsChain())).toContain("tx_inc_tag_1:post_tags!inner()");
    expect(callArgs(postsChain(), "in")).toEqual([
      ["tx_inc_category_0.category_id", ["cat-1"]],
      ["tx_inc_tag_1.tag_id", ["tag-1"]],
      ["id", ["p2", "p3", "p9"]],
    ]);
    expect(db().chainsFor("post_categories")).toHaveLength(0);
    expect(db().chainsFor("post_tags")).toHaveLength(0);
    expect(ids(rows)).toEqual(["p2", "p3"]);
  });

  it("kategoria nietrafiajaca w zaden termin konczy sie pusta lista BEZ zapytania o posty", async () => {
    db().setResponse("categories", () => ok([]));

    const rows = await runQueryFn({ categoriesCsv: "widmo", includeIdsCsv: "p9" });

    expect(rows).toEqual([]);
    expect(db().chainsFor("posts")).toHaveLength(0);
  });

  it("wykluczenia kategorii i tagow to ANTY-ZLACZENIE w bazie, a jawne id - jedno ogniwo .not", async () => {
    db().setResponse("categories", () => ok([{ id: "cat-x", slug: "sponsorowane" }]));
    db().setResponse("tags", () => ok([{ id: "tag-x", slug: "archiwum" }]));
    setPosts([postRow("p5")]);

    await runQueryFn({
      excludeCategoriesCsv: "sponsorowane",
      excludeTagsCsv: "archiwum",
      excludeIdsCsv: "p9",
    });

    // Osadzenie BEZ `!inner` + filtr po terminie + `alias=is.null` = "wpis nie
    // ma ani jednego przypisania do wykluczonych terminow".
    expect(selectOf(postsChain())).toContain("tx_exc_category_0:post_categories()");
    expect(selectOf(postsChain())).toContain("tx_exc_tag_1:post_tags()");
    expect(selectOf(postsChain())).not.toContain("!inner");
    expect(callArgs(postsChain(), "in")).toEqual([
      ["tx_exc_category_0.category_id", ["cat-x"]],
      ["tx_exc_tag_1.tag_id", ["tag-x"]],
    ]);
    expect(callArgs(postsChain(), "is")).toEqual([
      ["tx_exc_category_0", null],
      ["tx_exc_tag_1", null],
      ["deleted_at", null],
    ]);
    // Lista w `.not` niesie WYLACZNIE id wpisane w panelu - wpisy z
    // wykluczonych kategorii nie jada juz przez adres URL.
    expect(postsChain().argsOf("not")).toEqual(["id", "in", "(p9)"]);
    expect(idInCalls(postsChain())).toEqual([]);
  });

  it("wlaczenie i wykluczenie TEJ SAMEJ tabeli posredniej dostaja ROZNE aliasy", async () => {
    db().setResponse("categories", () =>
      ok([
        { id: "cat-a", slug: "polityka" },
        { id: "cat-b", slug: "sponsorowane" },
      ]),
    );
    setPosts([postRow("p1")]);

    await runQueryFn({ categoriesCsv: "polityka", excludeCategoriesCsv: "sponsorowane" });

    expect(selectOf(postsChain())).toContain("tx_inc_category_0:post_categories!inner()");
    expect(selectOf(postsChain())).toContain("tx_exc_category_1:post_categories()");
    expect(callArgs(postsChain(), "in")).toEqual([
      ["tx_inc_category_0.category_id", ["cat-a"]],
      ["tx_exc_category_1.category_id", ["cat-b"]],
    ]);
    // Jeden slownik kategorii na oba pola - nie dwa zapytania.
    expect(db().chainsFor("categories")).toHaveLength(1);
  });

  it("same jawne id (bez taksonomii) tez zawezaja zapytanie", async () => {
    setPosts([postRow("p1"), postRow("p2")]);

    await runQueryFn({ includeIdsCsv: "p1,p2" });

    expect(inValues(postsChain())).toEqual(["p1", "p2"]);
    expect(db().chainsFor("categories")).toHaveLength(0);
    expect(db().chainsFor("tags")).toHaveLength(0);
  });
});

describe("rozwiazywanie slugow taksonomii na id terminow", () => {
  it("puste csv taksonomii NIE pyta o tabele slownikowe", async () => {
    setPosts([postRow("a")]);

    await runQueryFn({ categoriesCsv: "", tagsCsv: "  ,  " });

    expect(db().chainsFor("categories")).toHaveLength(0);
    expect(db().chainsFor("tags")).toHaveLength(0);
  });

  it("kategoria bez dopasowanego sluga konczy sie pusta lista bez zapytania o posty", async () => {
    db().setResponse("categories", () => ok([]));

    const rows = await runQueryFn({ categoriesCsv: "nie-ma-takiej" });

    expect(rows).toEqual([]);
    expect(db().chainsFor("post_categories")).toHaveLength(0);
    expect(db().chainsFor("posts")).toHaveLength(0);
  });

  it("tag bez dopasowanego sluga konczy sie pusta lista bez zapytania o posty", async () => {
    db().setResponse("tags", () => ok([]));

    const rows = await runQueryFn({ tagsCsv: "nie-ma-takiego" });

    expect(rows).toEqual([]);
    expect(db().chainsFor("post_tags")).toHaveLength(0);
    expect(db().chainsFor("posts")).toHaveLength(0);
  });

  it("slugi jada do slownika, a id TERMINOW (nie wpisow) do osadzenia w zapytaniu o posty", async () => {
    db().setResponse("categories", () =>
      ok([
        { id: "cat-1", slug: "polityka" },
        { id: "cat-2", slug: "gospodarka" },
      ]),
    );
    setPosts([postRow("p1")]);

    await runQueryFn({ categoriesCsv: "polityka, gospodarka" });

    const dict = db().lastChain("categories");
    expect(dict?.argsOf("select")).toEqual(["id, slug"]);
    expect(dict?.argsOf("in")).toEqual(["slug", ["polityka", "gospodarka"]]);
    expect(postsChain().argsOf("in")).toEqual([
      "tx_inc_category_0.category_id",
      ["cat-1", "cat-2"],
    ]);
    expect(db().chainsFor("post_categories")).toHaveLength(0);
  });

  it("slugi tagow jada do `tags`, a ich id do osadzenia `post_tags`", async () => {
    db().setResponse("tags", () => ok([{ id: "tag-1", slug: "ue" }]));
    setPosts([postRow("p1")]);

    await runQueryFn({ tagsCsv: "ue" });

    expect(db().lastChain("tags")?.argsOf("in")).toEqual(["slug", ["ue"]]);
    expect(postsChain().argsOf("in")).toEqual(["tx_inc_tag_0.tag_id", ["tag-1"]]);
    expect(db().chainsFor("post_tags")).toHaveLength(0);
  });

  it("czesciowo trafione slugi wlaczajace zawezaja do TRAFIONYCH (alternatywa terminow)", async () => {
    db().setResponse("categories", () => ok([{ id: "cat-1", slug: "polityka" }]));
    setPosts([postRow("p1")]);

    await runQueryFn({ categoriesCsv: "polityka, widmo" });

    expect(postsChain().argsOf("in")).toEqual(["tx_inc_category_0.category_id", ["cat-1"]]);
  });

  it("nieznany slug WYKLUCZAJACY niczego nie wyklucza i nie zeruje listy", async () => {
    db().setResponse("categories", () => ok([]));
    setPosts([postRow("p1")]);

    const rows = await runQueryFn({ excludeCategoriesCsv: "widmo" });

    expect(ids(rows)).toEqual(["p1"]);
    expect(selectOf(postsChain())).not.toContain("post_categories");
    expect(callArgs(postsChain(), "is")).toEqual([["deleted_at", null]]);
  });

  it("brak wierszy w slowniku tagow (data null) daje PUSTA liste", async () => {
    db().setResponse("tags", () => ok(null));

    const rows = await runQueryFn({ tagsCsv: "ue" });

    expect(rows).toEqual([]);
    expect(db().chainsFor("post_tags")).toHaveLength(0);
    expect(db().chainsFor("posts")).toHaveLength(0);
  });

  // NAPRAWIONE 03.10.2026 (byl `it.fails`): ODMOWA ODCZYTU TAKSONOMII CICHO
  // KASOWALA WYKLUCZENIE.
  //
  // `fetchPostIdsBySlugs` destrukturyzowal WYLACZNIE `data` i ignorowal
  // `error`: nieudany odczyt `categories` dawal pusty zbior, ogniwo `.not`
  // w ogole nie powstawalo, a wpisy, ktore redakcja SWIADOMIE wykluczyla,
  // wracaly na publiczna strone. Slownik czyta teraz `taxonomyTermIdsBySlug`
  // (`lib/queries/taxonomyPivot.ts`), ktory RZUCA - `queryFn` konczy sie
  // bledem, a widget pokazuje stan bledu zamiast listy bez wykluczen.
  it("odmowa odczytu kategorii NIE kasuje cicho wykluczenia - queryFn RZUCA", async () => {
    db().setResponse("categories", () => fail("permission denied for table categories", "42501"));
    setPosts([postRow("p1")]);

    await expect(runQueryFn({ excludeCategoriesCsv: "sponsorowane" })).rejects.toThrow(
      /permission denied/,
    );
    expect(db().chainsFor("posts")).toHaveLength(0);
  });

  it("odmowa odczytu tagow przy filtrze WLACZAJACYM tez RZUCA, a nie udaje pustki", async () => {
    db().setResponse("tags", () => fail("permission denied for table tags", "42501"));

    await expect(runQueryFn({ tagsCsv: "ue" })).rejects.toThrow(/permission denied/);
  });
});

describe("filtry opcjonalne zapytania o posty", () => {
  it("format, autor i zakres dat trafiaja do zapytania jako osobne ogniwa", async () => {
    setPosts([postRow("a")]);

    await runQueryFn({
      postFormat: "video",
      authorId: "autor-1",
      dateFrom: "2026-01-01",
      dateTo: "2026-02-28",
    });

    expect(callArgs(postsChain(), "eq")).toEqual([
      ["status", "published"],
      ["post_format", "video"],
      ["author_id", "autor-1"],
    ]);
    // Granice dnia sa domykane po stronie zapytania - inaczej "do 28 lutego"
    // gubiloby wszystko opublikowane tego dnia.
    expect(postsChain().argsOf("gte")).toEqual(["published_at", "2026-01-01T00:00:00Z"]);
    expect(postsChain().argsOf("lte")).toEqual(["published_at", "2026-02-28T23:59:59Z"]);
  });

  it("BEZ filtrow opcjonalnych zapytanie niesie tylko status i brak usuniecia", async () => {
    setPosts([postRow("a")]);

    await runQueryFn({});

    expect(callArgs(postsChain(), "eq")).toEqual([["status", "published"]]);
    expect(postsChain().argsOf("is")).toEqual(["deleted_at", null]);
    expect(postsChain().has("gte")).toBe(false);
    expect(postsChain().has("lte")).toBe(false);
  });

  it("lista kolumn niesie oznaczenie komercyjne (obowiazek dotyczy TAKZE pozycji zestawienia)", async () => {
    setPosts([postRow("a")]);

    await runQueryFn({});

    const select = String(postsChain().argsOf("select")?.[0]);
    expect(select).toContain("is_sponsored");
    expect(select).toContain("sponsored_kind");
    expect(select).toContain("sponsored_affiliate");
  });

  it("odmowa odczytu postow JEST PRZEPUSZCZANA, a nie tluminona pusta lista", async () => {
    db().setResponse("posts", () => fail("permission denied for table posts", "42501"));

    await expect(runQueryFn({})).rejects.toThrow(/permission denied for table posts/);
  });

  it("brak wierszy (data null) czyta sie jako pusta liste", async () => {
    db().setResponse("posts", () => ok(null));

    await expect(runQueryFn({})).resolves.toEqual([]);
  });
});

describe("doklejanie autorow do wierszy", () => {
  const AUTOR = {
    id: "u-1",
    display_name: "Jan Kowalski",
    avatar_url: "https://cdn.example.com/u-1.png",
    slug: "jan-kowalski",
  };

  it("wariant z bylinem doklada nazwisko, awatar i slug autora", async () => {
    setPosts([postRow("a", { author_id: "u-1" }), postRow("b", { author_id: "u-1" })]);
    db().setResponse("profiles_public", () => ok([AUTOR]));

    const rows = await runQueryFn({ variant: "card" });

    expect(db().lastChain("profiles_public")?.argsOf("in")).toEqual(["id", ["u-1"]]);
    expect(rows[0]?.author_display_name).toBe("Jan Kowalski");
    expect(rows[0]?.author_avatar_url).toBe("https://cdn.example.com/u-1.png");
    expect(rows[0]?.author_slug).toBe("jan-kowalski");
    expect(rows[1]?.author_display_name).toBe("Jan Kowalski");
  });

  it("wariant 'numbered' (bez bylinu) NIE placi round-tripu do profiles_public", async () => {
    setPosts([postRow("a", { author_id: "u-1" })]);

    await runQueryFn({ variant: "numbered" });

    expect(db().chainsFor("profiles_public")).toHaveLength(0);
  });

  it("wylaczona prezentacja autora NIE placi round-tripu do profiles_public", async () => {
    setPosts([postRow("a", { author_id: "u-1" })]);

    await runQueryFn({ variant: "card", authorDisplay: "none" });

    expect(db().chainsFor("profiles_public")).toHaveLength(0);
  });

  it("ZERO wierszy NIE pyta o profile", async () => {
    setPosts([]);

    await expect(runQueryFn({ variant: "card" })).resolves.toEqual([]);
    expect(db().chainsFor("profiles_public")).toHaveLength(0);
  });

  it("wiersze BEZ author_id NIE pytaja o profile", async () => {
    setPosts([postRow("a"), postRow("b", { author_id: null })]);

    await runQueryFn({ variant: "card" });

    expect(db().chainsFor("profiles_public")).toHaveLength(0);
  });

  it("BRAKUJACY profil nie kasuje danych, ktore wiersz juz niesie", async () => {
    setPosts([
      postRow("a", { author_id: "u-1", author_display_name: "Stara Nazwa" }),
      postRow("b", { author_id: "u-2", author_display_name: "Druga Nazwa" }),
      postRow("c", { author_id: "u-3" }),
      postRow("d", { author_id: null }),
    ]);
    // Profile `u-1` i `u-3` istnieja, ale maja puste pola; `u-2` nie wraca wcale.
    db().setResponse("profiles_public", () =>
      ok([
        { id: "u-1", display_name: null, avatar_url: null, slug: null },
        { id: "u-3", display_name: null, avatar_url: null, slug: null },
      ]),
    );

    const rows = await runQueryFn({ variant: "card" });

    // Pusty profil NIE nadpisuje nazwiska, ktore wiersz juz mial.
    expect(rows[0]?.author_display_name).toBe("Stara Nazwa");
    expect(rows[0]?.author_avatar_url).toBeNull();
    // Wiersz bez odpowiadajacego profilu wraca nietkniety.
    expect(rows[1]?.author_display_name).toBe("Druga Nazwa");
    // Pusty profil i pusty wiersz - dopiero tu wolno zapisac null.
    expect(rows[2]?.author_display_name).toBeNull();
    // Wiersz BEZ autora przechodzi obok mapy profili w calosci.
    expect(rows[3]?.author_display_name).toBeUndefined();
  });

  it("odmowa odczytu profili NIE wywraca listy - wiersze wracaja ze swoimi danymi", async () => {
    setPosts([postRow("a", { author_id: "u-1", author_display_name: "Stara Nazwa" })]);
    db().setResponse("profiles_public", () => fail("permission denied", "42501"));

    const rows = await runQueryFn({ variant: "card" });

    expect(ids(rows)).toEqual(["a"]);
    expect(rows[0]?.author_display_name).toBe("Stara Nazwa");
  });
});

describe("cache TTL w srodowisku przegladarki", () => {
  it("edgeTtlCache PRZEPUSZCZA fetcher, gdy istnieje window - kazde wywolanie idzie do bazy", async () => {
    expect(typeof window).not.toBe("undefined");
    setPosts([postRow("a")]);

    await runQueryFn({ orderBy: "published_at" });
    await runQueryFn({ orderBy: "published_at" });

    expect(db().chainsFor("posts")).toHaveLength(2);
  });

  it("wariant 'random' omija cache CELOWO - zamrozona kolejnosc przestalaby byc losowa", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    setPosts([postRow("a"), postRow("b")]);

    await runQueryFn({ orderBy: "random" });
    await runQueryFn({ orderBy: "random" });

    expect(db().chainsFor("posts")).toHaveLength(2);
  });
});
