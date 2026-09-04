// SCIEZKA DANYCH post-listy - to, czego nie widac w czystych helperach.
//
// `postListQuery.ts` ma dwa piętra. Piętro czyste (`postListInput`,
// `postListOrderColumn`, `rankAndSlicePopular`, `dedupeAndSlice`) jest opisane
// w plikach siostrzanych. Piętro DANYCH - `fetchPopularPostIds`,
// `fetchPostListRows`, `fetchPostIdsBySlugs`, `attachAuthorNames` - jest
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
// 3. ALGEBRA ZBIOROW include/exclude - przeciecie (a nie suma) kategorii,
//    tagow i jawnych id, z wczesnym `return []` dla przeciecia pustego.
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
  const options = postListQueryOptions(content, lang);
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

  it("ranking rozlaczny z lista jawnych id konczy sie pusta lista", async () => {
    // OBSERWACJA (nie asercja o poprawnosci): wczesny `return []` dla pustego
    // przeciecia stoi PRZED zawezeniem rankingiem (postListQuery.ts:336 vs
    // :355), wiec przeciecie wyzerowane dopiero przez ranking nadal placi
    // round-trip do bazy z pustym `.in("id", [])`. Wynik jest poprawny, wiec
    // nie rejestruje tego jako defektu - ale przypinam liczbe zapytan, zeby
    // ewentualna zmiana byla widoczna.
    rpc().setData("popular_post_ids", [{ post_id: "a" }]);
    setPosts([]);

    const rows = await runQueryFn({ orderBy: "popular", includeIdsCsv: "z" });

    expect(rows).toEqual([]);
    expect(inValues(postsChain())).toEqual([]);
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

describe("zawezenia zbioru wynikow (include / exclude)", () => {
  it("bez zadnych zawezen zapytanie NIE niesie ani .in po id, ani .not", async () => {
    setPosts([postRow("a")]);

    await runQueryFn({});

    expect(postsChain().has("in")).toBe(false);
    expect(postsChain().has("not")).toBe(false);
    expect(db().chains.map((c) => c.table)).toEqual(["posts"]);
  });

  it("kategorie, tagi i jawne id sa PRZECIECIEM, a nie suma", async () => {
    db().setResponse("categories", () => ok([{ id: "cat-1" }]));
    db().setResponse("post_categories", () =>
      ok([{ post_id: "p1" }, { post_id: "p2" }, { post_id: "p3" }]),
    );
    db().setResponse("tags", () => ok([{ id: "tag-1" }]));
    db().setResponse("post_tags", () =>
      ok([{ post_id: "p2" }, { post_id: "p3" }, { post_id: "p4" }]),
    );
    setPosts([postRow("p2"), postRow("p3")]);

    const rows = await runQueryFn({
      categoriesCsv: "polityka",
      tagsCsv: "ue",
      includeIdsCsv: "p2, p3, p9",
    });

    expect(inValues(postsChain())).toEqual(["p2", "p3"]);
    expect(ids(rows)).toEqual(["p2", "p3"]);
  });

  it("PUSTE przeciecie konczy sie pusta lista BEZ zapytania o posty", async () => {
    db().setResponse("categories", () => ok([{ id: "cat-1" }]));
    db().setResponse("post_categories", () => ok([{ post_id: "p1" }]));

    const rows = await runQueryFn({ categoriesCsv: "polityka", includeIdsCsv: "p9" });

    expect(rows).toEqual([]);
    expect(db().chainsFor("posts")).toHaveLength(0);
  });

  it("wykluczenia z kategorii, tagow i jawnych id jada w JEDNYM filtrze .not", async () => {
    db().setResponse("categories", () => ok([{ id: "cat-x" }]));
    db().setResponse("post_categories", () => ok([{ post_id: "p1" }]));
    db().setResponse("tags", () => ok([{ id: "tag-x" }]));
    db().setResponse("post_tags", () => ok([{ post_id: "p2" }]));
    setPosts([postRow("p5")]);

    await runQueryFn({
      excludeCategoriesCsv: "sponsorowane",
      excludeTagsCsv: "archiwum",
      excludeIdsCsv: "p9",
    });

    expect(postsChain().argsOf("not")).toEqual(["id", "in", "(p1,p2,p9)"]);
    expect(postsChain().has("in")).toBe(false);
  });

  it("same jawne id (bez taksonomii) tez zawezaja zapytanie", async () => {
    setPosts([postRow("p1"), postRow("p2")]);

    await runQueryFn({ includeIdsCsv: "p1,p2" });

    expect(inValues(postsChain())).toEqual(["p1", "p2"]);
    expect(db().chainsFor("categories")).toHaveLength(0);
    expect(db().chainsFor("tags")).toHaveLength(0);
  });
});

describe("rozwiazywanie slugow taksonomii na id postow", () => {
  it("puste csv taksonomii NIE pyta o tabele slownikowe", async () => {
    setPosts([postRow("a")]);

    await runQueryFn({ categoriesCsv: "", tagsCsv: "  ,  " });

    expect(db().chainsFor("categories")).toHaveLength(0);
    expect(db().chainsFor("tags")).toHaveLength(0);
  });

  it("kategoria bez dopasowanego sluga NIE pyta o post_categories", async () => {
    db().setResponse("categories", () => ok([]));

    const rows = await runQueryFn({ categoriesCsv: "nie-ma-takiej" });

    expect(rows).toEqual([]);
    expect(db().chainsFor("post_categories")).toHaveLength(0);
    expect(db().chainsFor("posts")).toHaveLength(0);
  });

  it("tag bez dopasowanego sluga NIE pyta o post_tags", async () => {
    db().setResponse("tags", () => ok([]));

    const rows = await runQueryFn({ tagsCsv: "nie-ma-takiego" });

    expect(rows).toEqual([]);
    expect(db().chainsFor("post_tags")).toHaveLength(0);
    expect(db().chainsFor("posts")).toHaveLength(0);
  });

  it("slugi jada do tabeli slownikowej, a jej id do tabeli laczacej", async () => {
    db().setResponse("categories", () => ok([{ id: "cat-1" }, { id: "cat-2" }]));
    db().setResponse("post_categories", () => ok([{ post_id: "p1" }]));
    setPosts([postRow("p1")]);

    await runQueryFn({ categoriesCsv: "polityka, gospodarka" });

    const dict = db().lastChain("categories");
    expect(dict?.argsOf("select")).toEqual(["id"]);
    expect(dict?.argsOf("in")).toEqual(["slug", ["polityka", "gospodarka"]]);
    const link = db().lastChain("post_categories");
    expect(link?.argsOf("select")).toEqual(["post_id"]);
    expect(link?.argsOf("in")).toEqual(["category_id", ["cat-1", "cat-2"]]);
  });

  it("slugi tagow jada do `tags`, a ich id do `post_tags`", async () => {
    db().setResponse("tags", () => ok([{ id: "tag-1" }]));
    db().setResponse("post_tags", () => ok([{ post_id: "p1" }]));
    setPosts([postRow("p1")]);

    await runQueryFn({ tagsCsv: "ue" });

    expect(db().lastChain("tags")?.argsOf("in")).toEqual(["slug", ["ue"]]);
    expect(db().lastChain("post_tags")?.argsOf("in")).toEqual(["tag_id", ["tag-1"]]);
  });

  it("brak wierszy w tabeli laczacej (data null) daje PUSTY zbior, a nie wyjatek", async () => {
    db().setResponse("categories", () => ok([{ id: "cat-1" }]));
    db().setResponse("post_categories", () => ok(null));

    const rows = await runQueryFn({ categoriesCsv: "polityka" });

    expect(rows).toEqual([]);
    expect(db().chainsFor("posts")).toHaveLength(0);
  });

  it("brak wierszy w slowniku tagow (data null) tez daje PUSTY zbior", async () => {
    db().setResponse("tags", () => ok(null));

    const rows = await runQueryFn({ tagsCsv: "ue" });

    expect(rows).toEqual([]);
    expect(db().chainsFor("post_tags")).toHaveLength(0);
  });

  it("brak wierszy w post_tags (data null) tez daje PUSTY zbior", async () => {
    db().setResponse("tags", () => ok([{ id: "tag-1" }]));
    db().setResponse("post_tags", () => ok(null));

    const rows = await runQueryFn({ tagsCsv: "ue" });

    expect(rows).toEqual([]);
    expect(db().chainsFor("posts")).toHaveLength(0);
  });

  // DEFEKT: ODMOWA ODCZYTU TAKSONOMII CICHO KASUJE WYKLUCZENIE.
  //
  // WEJSCIE: widget z `excludeCategoriesCsv: "sponsorowane"`, przy ktorym
  //   odczyt `categories` konczy sie bledem (RLS, brak grantu, awaria sieci).
  // CO PSUJE: `fetchPostIdsBySlugs` (src/lib/builder/postListQuery.ts:233-237
  //   dla kategorii i :245-251 dla tagow) destrukturyzuje WYLACZNIE `data`
  //   i ignoruje `error`. Nieudany odczyt daje `undefined`, `(cats ?? [])`
  //   robi z tego pusta liste, funkcja zwraca pusty zbior, `excludeSet.size`
  //   jest zerowe - i ogniwo `.not("id", "in", ...)` (:376) w ogole nie
  //   powstaje.
  // KONSEKWENCJA: wpisy, ktore redakcja SWIADOMIE wykluczyla, wracaja na
  //   publiczna strone. To ta sama klasa co "awaria odczytu udaje pustke"
  //   z modulu 19, tyle ze skutkiem jest POKAZANIE tresci, a nie jej
  //   ukrycie - i dlatego jest grozniejsza: pusty widget widac, a widget
  //   z jednym wpisem za duzo nie.
  //   Ta sama luka po stronie `include` zamienia awarie odczytu w "pusto",
  //   czyli dokladnie w defekt, ktoremu reszta tego pliku ma zapobiegac.
  // WYMAGANA POPRAWKA: `fetchPostIdsBySlugs` musi czytac `error` i propagowac
  //   go (throw), zeby `queryFn` skonczyl sie bledem, a widget pokazal stan
  //   bledu zamiast listy bez wykluczen.
  it.fails("DEFEKT: odmowa odczytu kategorii NIE moze cicho kasowac wykluczenia", async () => {
    db().setResponse("categories", () => fail("permission denied for table categories", "42501"));
    setPosts([postRow("p1")]);

    await expect(runQueryFn({ excludeCategoriesCsv: "sponsorowane" })).rejects.toThrow(
      /permission denied/,
    );
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
