// ZYWE REFERENCJE TRESCI WIDGETOW - warstwa danych, ktorej dotad nikt nie uruchomil.
//
// `contentRefs.ts` obiecuje w naglowku jedna rzecz: widget trzyma w JSON tylko
// `postId`, a tytul, zajawka, okladka, href i autor sa DOCIAGANE z bazy, zeby
// edycja wpisu propagowala sie natychmiast. Dotad jedynym wykonaniem tego pliku
// w calej suicie bylo zbudowanie obiektu opcji przez `prefetch.ts` - `queryFn`
// nie startowal ani razu, wiec RPC, fallback, mapowanie jezykowe, autor i caly
// hook byly martwe pomiarowo (3,57% galezi). Ten plik wchodzi w nie PUBLICZNYM
// wejsciem: `postRefQueryOptions(...).queryFn()` wolane tak, jak zrobilby to
// react-query, oraz `useResolvedPostRefs` przez `renderHookWithQueryClient`.
//
// CO TU JEST NAPRAWDE DO OBRONY
//
// 1. JEDEN ROUND-TRIP ZAMIAST DWOCH. Sciezka glowna to RPC `get_post_refs`
//    (migracja 20260724151000, join wpis + publiczny profil autora po stronie
//    bazy). Fallback `posts` -> `profiles_public` zostal WYLACZNIE na okno
//    wdrozeniowe migracji. Skoro udany RPC ma tabel NIE dotykac, to musi byc
//    przypiete - inaczej nastepny refaktor cicho przywroci dwa sekwencyjne
//    round-tripy na kazdy slajd slidera i nikt tego nie zobaczy.
//
// 2. ODMOWA TO NIE PUSTKA. Trzy rozne odpowiedzi znacza trzy rozne rzeczy:
//    pusty wynik RPC ("RLS nie pokazuje wpisu") daje `null`; odmowa `posts`
//    daje `null`; odmowa `profiles_public` gubi WYLACZNIE autora, a wpis
//    zostaje. Ostatnie to swiadoma degradacja "autor znika, slajd zostaje"
//    i jako swiadoma musi miec dowod, a nie tylko komentarz.
//
// 3. KONTRAKT KSZTALTU. Wszystkie pola tekstowe `PostRefData` sa STRINGAMI,
//    nigdy `null` - konsument (`sliderVariants.tsx:716`) robi na nich
//    `cur && cur.trim()`, wiec `null` z joinu bez autora wysypalby render.
//
// 4. WIAZANIE WYNIKOW Z IDENTYFIKATORAMI w hooku. Pomylka `results[i]` vs
//    `uniqueIds[i]` podmienilaby slajdy miejscami bez ZADNEGO bledu typu.
//
// GRANICA DOWODU: `edgeTtlCache` w srodowisku przegladarki (happy-dom definiuje
// `window`) przepuszcza fetcher bez cache'owania, wiec kolejne wywolania sa tu
// liczone jeden do jednego i cache NIE jest tu dowodzony. Semantyke samego
// cache (jeden wpis TTL na oba jezyki, zakres po hoscie najemcy) dowodzi plik
// siostrzany `contentRefsEdgeCache.test.ts`, ktory w pierwszej linii przelacza
// srodowisko vitest na `node` - ten sam podzial, ktory repo stosuje juz dla
// `publicQueries.test.ts` / `publicQueriesEdgeCache.test.ts`.
//
// CZEGO TEN PLIK SWIADOMIE NIE DUBLUJE: ksztaltu klucza pod katem jezyka
// (bramka `localizedQueryKeys.gate.test.ts`), kompletu zbioru inwalidacji
// (`queryKeys.test.ts`), mechaniki `edgeTtlCache` (`ssrCacheHostScope.test.ts`),
// renderowania slidera (`sliderDisplaySettings.test.tsx`).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
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
import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
import {
  postRefQueryOptions,
  useResolvedPostRefs,
  WIDGET_LIVE_QUERY_PREFIXES,
  type Lang,
  type PostRefData,
} from "@/lib/builder/contentRefs";
import {
  WIDGET_LIVE_QUERY_PREFIXES as PREFIXES_Z_QUERYKEYS,
  WIDGET_QUERY_ROOTS,
} from "@/lib/builder/queryKeys";

function db(): SupabaseFromStub {
  if (sb.from === null) throw new Error("test: atrapa `from` nie zostala utworzona");
  return sb.from;
}

function rpc(): SupabaseRpcStub {
  if (sb.rpc === null) throw new Error("test: atrapa `rpc` nie zostala utworzona");
  return sb.rpc;
}

/** Wiersz RPC `get_post_refs` - dwanascie kolumn z migracji 20260724151000. */
interface RefRow {
  id: string;
  slug: string;
  title_pl: string | null;
  title_en: string | null;
  excerpt_pl: string | null;
  excerpt_en: string | null;
  cover_image_url: string | null;
  published_at: string | null;
  author_id: string | null;
  author_name: string | null;
  author_avatar: string | null;
  author_slug: string | null;
}

/** Wiersz tabeli `posts` w zakresie, ktory czyta fallback - dziewiec kolumn. */
type PostsRow = Omit<RefRow, "author_name" | "author_avatar" | "author_slug">;

function refRow(over: Partial<RefRow> = {}): RefRow {
  return {
    id: "p1",
    slug: "raport-o-ue",
    title_pl: "Tytul PL",
    title_en: "Title EN",
    excerpt_pl: "Zajawka PL",
    excerpt_en: "Excerpt EN",
    cover_image_url: "https://cdn.example.com/okladka.jpg",
    published_at: "2026-03-01T10:00:00Z",
    author_id: "a1",
    author_name: "Redakcja Testowa",
    author_avatar: "https://cdn.example.com/awatar.jpg",
    author_slug: "redakcja-testowa",
    ...over,
  };
}

function postsRow(over: Partial<PostsRow> = {}): PostsRow {
  const full = refRow();
  return {
    id: full.id,
    slug: full.slug,
    title_pl: full.title_pl,
    title_en: full.title_en,
    excerpt_pl: full.excerpt_pl,
    excerpt_en: full.excerpt_en,
    cover_image_url: full.cover_image_url,
    published_at: full.published_at,
    author_id: full.author_id,
    ...over,
  };
}

/** Uruchamia `queryFn` opcji tak, jak zrobilby to react-query. */
function runQueryFn(id: string | null | undefined, lang: Lang = "pl"): Promise<PostRefData | null> {
  const options = postRefQueryOptions(id, lang);
  return (options.queryFn as () => Promise<PostRefData | null>)();
}

/**
 * Odpowiedz RPC zalezna od `_post_ids`: wiersz wraca tylko dla identyfikatora,
 * ktory naprawde zostal o niego zapytany. Bez tego "wynik trafil pod swoj
 * identyfikator" bylby niedowodliwy - stala odpowiedz pasuje do kazdego id.
 */
function respondByIds(rows: Readonly<Record<string, RefRow>>): void {
  rpc().setResponse("get_post_refs", (call) => {
    const asked = call.arg("_post_ids");
    const ids = Array.isArray(asked) ? asked.filter((v): v is string => typeof v === "string") : [];
    return ok(ids.map((id) => rows[id]).filter((row): row is RefRow => row !== undefined));
  });
}

beforeEach(() => {
  db().reset();
  rpc().reset();
});

describe("fabryka opcji: klucz, brama enabled, swiezosc", () => {
  it("klucz niesie korzen ze wspolnej stalej, identyfikator i jezyk", () => {
    expect(postRefQueryOptions("p1", "pl").queryKey).toEqual([
      WIDGET_QUERY_ROOTS.postRef,
      "p1",
      "pl",
    ]);
  });

  it("PL i EN nie dziela wpisu cache react-query", () => {
    // Mapowanie jezykowe robi dopiero `toPostRef`, wiec gdyby klucz nie niosl
    // jezyka, drugi jezyk dostalby zapamietany wynik pierwszego.
    expect(postRefQueryOptions("p1", "pl").queryKey).not.toEqual(
      postRefQueryOptions("p1", "en").queryKey,
    );
  });

  it("brak wybranego wpisu daje jeden neutralny klucz i wylaczona brame", () => {
    const nul = postRefQueryOptions(null, "pl");
    const undef = postRefQueryOptions(undefined, "pl");
    const pusty = postRefQueryOptions("", "pl");

    expect(nul.queryKey).toEqual([WIDGET_QUERY_ROOTS.postRef, "", "pl"]);
    expect(undef.queryKey).toEqual(nul.queryKey);
    expect(pusty.queryKey).toEqual(nul.queryKey);
    expect([nul.enabled, undef.enabled, pusty.enabled]).toEqual([false, false, false]);
  });

  it("wybrany wpis otwiera brame", () => {
    expect(postRefQueryOptions("p1", "pl").enabled).toBe(true);
  });

  it("swiezosc i czas zycia sa takie, jak obiecuje komentarz modulu", () => {
    const options = postRefQueryOptions("p1", "pl");

    // "1 min - agresywnie na tyle, zeby bylo czuc, ze zyje" (contentRefs.ts:30).
    expect(options.staleTime).toBe(60_000);
    expect(options.gcTime).toBe(5 * 60_000);
  });

  it("queryFn bez identyfikatora nie pyta bazy ANI RAZU", async () => {
    // `prefetchQuery` i `ensureQueryData` IGNORUJA `enabled`, wiec ta galaz
    // jest osiagalna produkcyjnie, a nie tylko teoretycznie.
    await expect(runQueryFn(null)).resolves.toBeNull();
    await expect(runQueryFn(undefined)).resolves.toBeNull();
    await expect(runQueryFn("")).resolves.toBeNull();

    expect(rpc().calls).toHaveLength(0);
    expect(db().chains).toHaveLength(0);
  });
});

describe("sciezka glowna: jeden round-trip przez get_post_refs", () => {
  it("udany RPC wystarcza - tabele NIE sa dotykane", async () => {
    respondByIds({ p1: refRow() });

    await runQueryFn("p1");

    expect(rpc().names()).toEqual(["get_post_refs"]);
    expect(rpc().lastCall("get_post_refs")?.arg("_post_ids")).toEqual(["p1"]);
    // Sedno obietnicy z contentRefs.ts:94-99: dwa sekwencyjne round-tripy
    // (wpis -> autor) zastapione jednym.
    expect(db().chains).toHaveLength(0);
  });

  it("pelne mapowanie wiersza na PostRefData w PL", async () => {
    respondByIds({ p1: refRow() });

    await expect(runQueryFn("p1", "pl")).resolves.toEqual({
      id: "p1",
      slug: "raport-o-ue",
      title: "Tytul PL",
      excerpt: "Zajawka PL",
      cover: "https://cdn.example.com/okladka.jpg",
      // Prefiks /en dokłada dopiero `AppLink` po stronie renderera - tu href
      // jest jezykowo neutralny.
      href: "/post/raport-o-ue",
      publishedAt: "2026-03-01T10:00:00Z",
      authorName: "Redakcja Testowa",
      authorAvatar: "https://cdn.example.com/awatar.jpg",
      authorSlug: "redakcja-testowa",
    });
  });

  it("ten sam wiersz w EN oddaje kolumny angielskie, reszte bez zmian", async () => {
    respondByIds({ p1: refRow() });

    const ref = await runQueryFn("p1", "en");

    expect(ref?.title).toBe("Title EN");
    expect(ref?.excerpt).toBe("Excerpt EN");
    expect(ref?.href).toBe("/post/raport-o-ue");
  });

  it("brak autora w joinie schodzi do PUSTYCH STRINGOW, nie do null", async () => {
    // `sliderVariants.tsx:716` robi `cur && cur.trim()` na tych polach - `null`
    // przeszedlby przez typy (join zwraca nullable) i wysypal render.
    respondByIds({
      p1: refRow({ author_name: null, author_avatar: null, author_slug: null }),
    });

    const ref = await runQueryFn("p1");

    expect(ref?.authorName).toBe("");
    expect(ref?.authorAvatar).toBe("");
    expect(ref?.authorSlug).toBe("");
  });

  it("pusty wynik RPC to BRAK wpisu, a nie wpis z pustymi polami", async () => {
    // Stan "RLS nie pokazuje wpisu": widget ma zostac przy swoim ladunku
    // z JSON-a, wiec resolver musi oddac `null`, a nie atrape wpisu.
    rpc().setData("get_post_refs", []);

    await expect(runQueryFn("p1")).resolves.toBeNull();
    // Pusty wynik to POPRAWNA odpowiedz RPC - fallback nie ma tu czego szukac.
    expect(db().chains).toHaveLength(0);
  });
});

describe("fallback dwuetapowy: okno wdrozeniowe migracji", () => {
  function fallbackDataOk(row: PostsRow = postsRow()): void {
    db().setResponse("posts", () => ok(row));
    db().setResponse("profiles_public", () =>
      ok({
        display_name: "Redakcja Testowa",
        avatar_url: "https://cdn.example.com/awatar.jpg",
        slug: "redakcja-testowa",
      }),
    );
  }

  it("odmowa RPC przelacza na posts + profiles_public i daje IDENTYCZNY wynik", async () => {
    rpc().setError("get_post_refs", "function get_post_refs does not exist", "42883");
    fallbackDataOk();

    // Ten sam obiekt co na sciezce glownej: okno wdrozeniowe migracji NIE
    // zmienia kontraktu widgetu.
    await expect(runQueryFn("p1", "pl")).resolves.toEqual({
      id: "p1",
      slug: "raport-o-ue",
      title: "Tytul PL",
      excerpt: "Zajawka PL",
      cover: "https://cdn.example.com/okladka.jpg",
      href: "/post/raport-o-ue",
      publishedAt: "2026-03-01T10:00:00Z",
      authorName: "Redakcja Testowa",
      authorAvatar: "https://cdn.example.com/awatar.jpg",
      authorSlug: "redakcja-testowa",
    });
  });

  it("RPC oddajace NIE-TABLICE tez schodzi na fallback", async () => {
    // Drugi czlon warunku `!error && Array.isArray(data)` osobno od pierwszego:
    // funkcja o tej samej nazwie, ale innym ksztalcie wyniku, nie moze byc
    // brana za poprawny wsad.
    rpc().setData("get_post_refs", { id: "p1" });
    fallbackDataOk();

    const ref = await runQueryFn("p1");

    expect(ref?.title).toBe("Tytul PL");
    expect(db().chainsFor("posts")).toHaveLength(1);
  });

  it("wpis bez autora NIE pyta o profil", async () => {
    rpc().setError("get_post_refs", "function get_post_refs does not exist", "42883");
    db().setResponse("posts", () => ok(postsRow({ author_id: null })));

    const ref = await runQueryFn("p1");

    expect(db().chainsFor("profiles_public")).toHaveLength(0);
    expect(ref?.authorName).toBe("");
    expect(ref?.authorSlug).toBe("");
  });

  it("odmowa tabeli posts daje null, a nie wpis z pustymi polami", async () => {
    rpc().setError("get_post_refs", "function get_post_refs does not exist", "42883");
    db().setResponse("posts", () => fail("permission denied for table posts", "42501"));

    await expect(runQueryFn("p1")).resolves.toBeNull();
  });

  it("brak wiersza w posts (data null) tez daje null", async () => {
    rpc().setError("get_post_refs", "function get_post_refs does not exist", "42883");
    db().setResponse("posts", () => ok(null));

    await expect(runQueryFn("p1")).resolves.toBeNull();
    // Nie ma wiersza, wiec nie ma o kogo pytac w profilach.
    expect(db().chainsFor("profiles_public")).toHaveLength(0);
  });

  it("odmowa profiles_public gubi AUTORA, ale zostawia wpis", async () => {
    // Swiadoma degradacja: slajd bez nazwiska jest lepszy niz slajd, ktorego
    // nie ma. Kod celowo nie czyta `error` z tego odczytu (contentRefs.ts:70).
    rpc().setError("get_post_refs", "function get_post_refs does not exist", "42883");
    db().setResponse("posts", () => ok(postsRow()));
    db().setResponse("profiles_public", () =>
      fail("permission denied for view profiles_public", "42501"),
    );

    const ref = await runQueryFn("p1");

    expect(ref?.title).toBe("Tytul PL");
    expect(ref?.authorName).toBe("");
    expect(ref?.authorAvatar).toBe("");
    expect(ref?.authorSlug).toBe("");
  });

  it("kontrakt kolumn i filtrow fallbacku - publiczna projekcja, nie tabela profiles", async () => {
    rpc().setError("get_post_refs", "function get_post_refs does not exist", "42883");
    fallbackDataOk();

    await runQueryFn("p1");

    const posts = db().lastChain("posts");
    expect(posts?.argsOf("eq")).toEqual(["id", "p1"]);
    expect(posts?.has("maybeSingle")).toBe(true);

    const profil = db().lastChain("profiles_public");
    expect(profil?.argsOf("select")).toEqual(["display_name, avatar_url, slug"]);
    expect(profil?.argsOf("eq")).toEqual(["id", "a1"]);
    // `profiles` to tabela, ktorej anon nie widzi - czytamy publiczna
    // projekcje o spojnym kontrakcie widocznosci (contentRefs.ts:67-69).
    expect(db().chainsFor("profiles")).toHaveLength(0);
  });
});

describe("mapowanie jezykowe wiersza na wariant PL/EN", () => {
  it("brakujacy tytul EN spada na PL", async () => {
    respondByIds({ p1: refRow({ title_en: null, excerpt_en: null }) });

    const ref = await runQueryFn("p1", "en");

    expect(ref?.title).toBe("Tytul PL");
    expect(ref?.excerpt).toBe("Zajawka PL");
  });

  it("brakujacy tytul PL spada na EN", async () => {
    // Trzeci czlon lancucha - nieosiagalny przez przypadek powyzej.
    respondByIds({ p1: refRow({ title_pl: null, excerpt_pl: null }) });

    const ref = await runQueryFn("p1", "pl");

    expect(ref?.title).toBe("Title EN");
    expect(ref?.excerpt).toBe("Excerpt EN");
  });

  it("wiersz bez zadnej tresci daje PUSTE STRINGI, nigdy null", async () => {
    respondByIds({
      p1: refRow({
        title_pl: null,
        title_en: null,
        excerpt_pl: null,
        excerpt_en: null,
        cover_image_url: null,
        published_at: null,
      }),
    });

    const ref = await runQueryFn("p1", "pl");

    expect(ref?.title).toBe("");
    expect(ref?.excerpt).toBe("");
    expect(ref?.cover).toBe("");
    // `publishedAt` to JEDYNE pole kontraktu, ktore wolno oddac jako null -
    // wpis nieopublikowany nie ma daty i data nie jest tekstem do renderu.
    expect(ref?.publishedAt).toBeNull();
  });

  // NAPRAWIONE 2026-10-18 (byl `it.fails`): pusty tytul w zadanym jezyku nie
  // spadal na drugi jezyk, bo `toPostRef` skladal fallback operatorem `??`.
  //
  // KONTRAKT: pusty napis to BRAK tlumaczenia - ten sam fallback `||`, co
  // `pickI18n` (contentValue.ts) i `postRefsForLang` (emailDocResolve.ts).
  // Slajd na stronie EN wpisu z pelna trescia PL dostaje tytul PL zamiast
  // dziury, ktorej `pickStr` w `sliderVariants.tsx` juz nie uratuje.
  it("PUSTY tytul EN spada na tytul PL", async () => {
    respondByIds({ p1: refRow({ title_en: "" }) });

    const ref = await runQueryFn("p1", "en");

    expect(ref?.title).toBe("Tytul PL");
  });

  // NAPRAWIONE 2026-10-18 (byl `it.fails`): pusta zajawka EN nie spadala na PL
  // (osobny lancuch `??` niz tytul). KONTRAKT: ten sam fallback `||`, wiec
  // warianty slidera z podtytulem (`subtitle_en`) nie traca polowy tresci.
  it("PUSTA zajawka EN spada na zajawke PL", async () => {
    respondByIds({ p1: refRow({ excerpt_en: "" }) });

    const ref = await runQueryFn("p1", "en");

    expect(ref?.excerpt).toBe("Zajawka PL");
  });

  it("PUSTE oba warianty daja pusty napis, a PL z samym EN spada na EN", async () => {
    respondByIds({ p1: refRow({ title_pl: "", title_en: "", excerpt_pl: "", excerpt_en: "X" }) });

    const ref = await runQueryFn("p1", "pl");

    expect(ref?.title).toBe("");
    expect(ref?.excerpt).toBe("X");
  });
});

describe("useResolvedPostRefs: dedup, normalizacja i klucze mapy", () => {
  it("dwa razy ten sam identyfikator to JEDNO zapytanie", async () => {
    respondByIds({ p1: refRow() });

    const { result } = renderHookWithQueryClient(() => useResolvedPostRefs(["p1", "p1"], "pl"));
    await waitFor(() => expect(result.current.size).toBe(1));

    // Deduplikacja PRZED `useQueries`, a nie po niej: liczba round-tripow,
    // a nie liczba wpisow w mapie, jest tu dowodem.
    expect(rpc().callsFor("get_post_refs")).toHaveLength(1);
  });

  it("null, undefined, pusty i sam bialy znak NIE generuja zapytan", async () => {
    const { result } = renderHookWithQueryClient(() =>
      useResolvedPostRefs([null, undefined, "", "   "], "pl"),
    );

    await waitFor(() => expect(result.current.size).toBe(0));
    expect(rpc().calls).toHaveLength(0);
    expect(db().chains).toHaveLength(0);
  });

  it("pusta lista identyfikatorow nie stawia ani jednego zapytania", async () => {
    const { result } = renderHookWithQueryClient(() => useResolvedPostRefs([], "pl"));

    await waitFor(() => expect(result.current.size).toBe(0));
    expect(rpc().calls).toHaveLength(0);
  });

  it("identyfikator BEZ danych nie pojawia sie w mapie w ogole", async () => {
    // Brak klucza, a nie `undefined` pod kluczem - konsument robi
    // `if (!ref) return it`, wiec wpis musi zostac przy swoim ladunku.
    respondByIds({ p1: refRow() });

    const { result } = renderHookWithQueryClient(() => useResolvedPostRefs(["p1", "p2"], "pl"));
    await waitFor(() => expect(result.current.size).toBe(1));

    expect(result.current.has("p1")).toBe(true);
    expect(result.current.has("p2")).toBe(false);
  });

  it("wyniki trafiaja pod SWOJE identyfikatory", async () => {
    // Pomylka wiazania `results[i]` z `uniqueIds[i]` podmienilaby slajdy
    // miejscami bez zadnego bledu typu i bez zadnego bledu wykonania.
    respondByIds({
      p1: refRow({ id: "p1", slug: "pierwszy", title_pl: "Pierwszy" }),
      p2: refRow({ id: "p2", slug: "drugi", title_pl: "Drugi" }),
    });

    const { result } = renderHookWithQueryClient(() => useResolvedPostRefs(["p1", "p2"], "pl"));
    await waitFor(() => expect(result.current.size).toBe(2));

    expect(result.current.get("p1")?.title).toBe("Pierwszy");
    expect(result.current.get("p1")?.href).toBe("/post/pierwszy");
    expect(result.current.get("p2")?.title).toBe("Drugi");
    expect(result.current.get("p2")?.href).toBe("/post/drugi");
  });

  it("jezyk hooka schodzi az do mapowania wiersza", async () => {
    respondByIds({ p1: refRow() });

    const { result } = renderHookWithQueryClient(() => useResolvedPostRefs(["p1"], "en"));
    await waitFor(() => expect(result.current.size).toBe(1));

    expect(result.current.get("p1")?.title).toBe("Title EN");
  });

  // NAPRAWIONE 2026-10-18 (byl `it.fails`): mapa byla kluczowana id PO trim,
  // a jedyny konsument (`sliderVariants.tsx`) czyta `refMap.get(it.postId)`
  // identyfikatorem SUROWYM - dane z bazy byly wyrzucane, a slajd zostawal
  // przy zamrozonym ladunku z JSON-a.
  //
  // KONTRAKT: zapytanie idzie po id znormalizowanym (jedno na wpis), a mapa
  // niesie wynik pod identyfikatorem W POSTACI, W JAKIEJ GO PODANO.
  it("identyfikator z bialymi znakami jest odnajdywalny pod swoja surowa postacia", async () => {
    respondByIds({ p1: refRow() });

    const { result } = renderHookWithQueryClient(() => useResolvedPostRefs([" p1 "], "pl"));
    await waitFor(() => expect(result.current.size).toBe(1));

    expect(result.current.get(" p1 ")?.title).toBe("Tytul PL");
  });

  it("surowy i przyciety zapis tego samego id to JEDNO zapytanie i dwa klucze mapy", async () => {
    respondByIds({ p1: refRow() });

    const { result } = renderHookWithQueryClient(() => useResolvedPostRefs([" p1 ", "p1"], "pl"));
    await waitFor(() => expect(result.current.size).toBe(2));

    expect(rpc().callsFor("get_post_refs")).toHaveLength(1);
    expect(result.current.get(" p1 ")).toBe(result.current.get("p1"));
  });

  it("mapa jest STABILNA referencyjnie miedzy renderami przy tych samych id i danych", async () => {
    // Konsument liczy slajdy w `useMemo([rawItems, refMap])` - nowa mapa na
    // kazdym renderze (np. tyknieciu autoplay) przeliczalaby i odmontowywala
    // memo wszystkich slajdow. Nowa TABLICA o tej samej tresci tez nie moze
    // zmieniac wyniku, bo konsument buduje ja w `useMemo` z `rawItems`.
    respondByIds({ p1: refRow() });

    let ids: Array<string | null> = ["p1", null];
    const { result, rerender } = renderHookWithQueryClient(() => useResolvedPostRefs(ids, "pl"));
    await waitFor(() => expect(result.current.size).toBe(1));
    const first = result.current;

    ids = ["p1", null];
    rerender();

    expect(result.current).toBe(first);
  });
});

describe("re-eksport WIDGET_LIVE_QUERY_PREFIXES", () => {
  it("to TA SAMA instancja zbioru, co w queryKeys - przekierowanie, nie kopia", () => {
    // Rozjazd opisany w komentarzu contentRefs.ts:194-202 (piec korzeni bez
    // zadnego zywego zapytania) jest po tej zmianie NIEWYRAZALNY z konstrukcji.
    expect(WIDGET_LIVE_QUERY_PREFIXES).toBe(PREFIXES_Z_QUERYKEYS);
  });

  it("zbior zawiera korzen, ktory TEN plik realnie wystawia", () => {
    expect(WIDGET_LIVE_QUERY_PREFIXES.has(WIDGET_QUERY_ROOTS.postRef)).toBe(true);
  });
});

describe("wyjatek transportu to nie odmowa", () => {
  it("odrzucone wywolanie RPC (zerwane polaczenie) propaguje sie do react-query", async () => {
    // Odmowa PostgREST (`{ error }`) degraduje do `null` / fallbacku, ale
    // WYJATEK nie jest odpowiedzia bazy: ma dac stan bledu z ponowieniem,
    // a nie "wpisu nie ma" zamrozony w widgecie.
    rpc().setResponse("get_post_refs", () => {
      throw new Error("socket hang up");
    });

    await expect(runQueryFn("p1", "pl")).rejects.toThrow("socket hang up");
    expect(db().chains).toHaveLength(0);
  });
});
