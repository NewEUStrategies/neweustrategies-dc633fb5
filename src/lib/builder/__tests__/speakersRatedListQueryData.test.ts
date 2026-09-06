// SCIEZKA DANYCH prelegentow i listy ocenianej - dwa najwieksze queryFn
// wiersza "CMS: zapytania danych widgetow", oba dotad bez ani jednego
// wywolania z podstawiona baza.
//
// CO TU JEST DO OBRONY
//
// 1. DWA FILTRY TOZSAMOSCI, KTORE SA SOBIE PRZECIWNE - I OBA MAJA RACJE.
//    W projekcji KATALOGU (`get_public_speakers`) pusty `user_id` znaczy
//    wiersz USZKODZONY i wypada. W projekcji WYDARZENIA
//    (`event_speakers_public`) pusty `user_id` znaczy PRELEGENTA BEZ KONTA -
//    czyli dokladnie ten wiersz, dla ktorego cala funkcja powstala - i musi
//    przetrwac; wypada tylko wiersz bez JAKIEJKOLWIEK tozsamosci. Asymetria
//    jest calym sensem obu filtrow i dzis nic jej nie pilnuje, choc pomylka
//    w ktorakolwiek strone jest cicha: albo znika prelegent z kartoteki, albo
//    pojawia sie karta bez nazwiska i z kluczem pustego napisu.
//
// 2. FILTR AUTORA ZAWEZA ZAPYTANIE, A NIE JEGO WYNIK. Filtrowanie po stronie
//    klienta dzialo sie PO `.range(offset, offset+limit-1)`, wiec widget
//    oddawal mniej wierszy niz zamowiono (a przy autorze spoza pierwszej
//    strony - zero). Test pilnuje, ze nazwy autorow rozwiazuja sie na
//    identyfikatory i wchodza do `.in("author_id", ...)`.
//
// 3. ALGEBRA include/exclude JEST PRZECIECIEM, NIE SUMA. Kategorie i tagi
//    podane naraz musza sie PRZECIAC; puste przeciecie konczy sie [] i wtedy
//    zapytanie o wpisy NIE WYCHODZI (lancuch jest juz zbudowany, ale nigdy
//    nie zostaje wyslany - dlatego liczymy wywolania respondera, a nie
//    zapisane lancuchy).
//
// 4. ODMOWA ODCZYTU WPISOW JEST CELOWO POLYKANA. Naglowek fabryki
//    (ratedListQuery.ts:353-354) nazywa to swiadomym wyborem: pusta lista jest
//    poprawnym stanem widgetu, a rzucenie wywrocilo by cala sekcje. Musi byc
//    PRZYPIETE, zeby nastepny refaktor nie zamienil tego w rzucanie - ani
//    odwrotnie.
//
// GRANICA DOWODU: `edgeTtlCache` pod happy-dom przepuszcza fetcher bez
// cache'owania (`window` istnieje), wiec kazde wywolanie queryFn realnie
// schodzi do atrapy i kolejne wywolania sa liczone.
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
import {
  speakerEngagementsQueryOptions,
  speakerProfileQueryOptions,
  speakersByIdsQueryOptions,
  speakersQueryOptions,
  type PublicSpeakerRow,
  type SpeakerEngagement,
} from "@/lib/builder/speakersQuery";
import {
  RATED_LIST_POST_COLUMNS,
  RATED_LIST_PROFILE_COLUMNS,
  ratedListQueryOptions,
  type RatedListItem,
} from "@/lib/builder/ratedListQuery";

const db = (): SupabaseFromStub => {
  if (!sb.from) throw new Error("atrapa `from` nie zostala zamontowana");
  return sb.from;
};
const rpc = (): SupabaseRpcStub => {
  if (!sb.rpc) throw new Error("atrapa `rpc` nie zostala zamontowana");
  return sb.rpc;
};

async function run<T>(options: { queryFn?: unknown }): Promise<T> {
  const fn = options.queryFn as () => Promise<T>;
  return fn();
}

/** Pierwsza wartosc ogniwa `.in` dla danej kolumny w lancuchu. */
function inArgs(chain: RecordedChain | undefined, column: string): unknown {
  return chain?.calls.find((c) => c.method === "in" && c.args[0] === column)?.args[1];
}

beforeEach(() => {
  db().reset();
  rpc().reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("prelegenci: dwa zrodla, dwa RPC", () => {
  it("tryb katalogowy pyta get_public_speakers bez wydarzenia i bez listy id", async () => {
    rpc().setData("get_public_speakers", []);

    await run(speakersQueryOptions({ source: "directory" }, "pl"));

    const call = rpc().lastCall("get_public_speakers");
    expect(call?.arg("p_event_id")).toBeNull();
    expect(call?.arg("p_user_ids")).toBeNull();
    expect(call?.arg("p_limit")).toBe(24);
  });

  it("tryb wydarzenia pyta event_speakers_public ladunkiem z event_id", async () => {
    rpc().setData("event_speakers_public", []);

    await run(speakersQueryOptions({ source: "event", eventId: "e-1" }, "pl"));

    expect(rpc().names()).toEqual(["event_speakers_public"]);
    expect(rpc().lastCall("event_speakers_public")?.arg("p_payload")).toEqual({
      event_id: "e-1",
      limit: 24,
    });
  });

  it("tryb wydarzenia BEZ wybranego wydarzenia to stan nieskonfigurowany: [] i ZERO RPC", async () => {
    // Regresja "pusty widget pokazuje caly katalog" jest kosztowna i cicha -
    // strona wydarzenia pokazywalaby wszystkich prelegentow serwisu.
    await expect(run(speakersQueryOptions({ source: "event" }, "pl"))).resolves.toEqual([]);
    expect(rpc().calls).toHaveLength(0);
  });

  it("klucze obu trybow sa ROZNE - inny ksztalt wiersza nie moze dzielic wpisu cache", () => {
    const katalog = speakersQueryOptions({ source: "directory" }, "pl").queryKey;
    const wydarzenie = speakersQueryOptions({ source: "event", eventId: "e-1" }, "pl").queryKey;
    expect(katalog).not.toEqual(wydarzenie);
  });

  it("PRELEGENT BEZ KONTA przezywa filtr wydarzenia, wiersz bez tozsamosci wypada", async () => {
    // Serce modulu: `person_id` bez `user_id` to prelegent z kartoteki, a nie
    // wiersz uszkodzony. Trzeci wiersz nie ma zadnej tozsamosci, wiec nie da
    // sie z niego zrobic karty (ani klucza listy).
    rpc().setData("event_speakers_public", [
      { user_id: "u-1" },
      { person_id: "p-1", display_name: "Anna Przykladowa" },
      {},
    ]);

    const rows = await run<PublicSpeakerRow[]>(
      speakersQueryOptions({ source: "event", eventId: "e-1" }, "pl"),
    );

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.user_id)).toEqual(["u-1", ""]);
    expect(rows[1].person_id).toBe("p-1");
  });

  it("w KATALOGU pusty user_id znaczy wiersz uszkodzony i wypada (odwrotnie niz w wydarzeniu)", async () => {
    rpc().setData("get_public_speakers", [null, "x", [], { user_id: "" }, { user_id: "u-1" }]);

    const rows = await run<PublicSpeakerRow[]>(speakersQueryOptions({ source: "directory" }, "pl"));

    expect(rows.map((r) => r.user_id)).toEqual(["u-1"]);
  });

  it("odmowa obu RPC RZUCA komunikatem SERWERA, a nie-tablicowe data daje []", async () => {
    rpc().setError("get_public_speakers", "permission denied for function");
    await expect(run(speakersQueryOptions({ source: "directory" }, "pl"))).rejects.toThrow(
      "permission denied for function",
    );

    rpc().setError("event_speakers_public", "insufficient capability");
    await expect(
      run(speakersQueryOptions({ source: "event", eventId: "e-1" }, "pl")),
    ).rejects.toThrow("insufficient capability");

    rpc().setData("get_public_speakers", null);
    await expect(run(speakersQueryOptions({ source: "directory" }, "pl"))).resolves.toEqual([]);

    rpc().setData("get_public_speakers", {});
    await expect(run(speakersQueryOptions({ source: "directory" }, "pl"))).resolves.toEqual([]);

    // To samo dla projekcji WYDARZENIA - drugie RPC ma wlasny straznik ksztaltu.
    rpc().setData("event_speakers_public", null);
    await expect(
      run(speakersQueryOptions({ source: "event", eventId: "e-1" }, "pl")),
    ).resolves.toEqual([]);
  });
});

describe("prelegenci po identyfikatorach i profil pojedynczy", () => {
  it("klucz deduplikuje i sortuje id - kolejnosc w tresci nie unieważnia cache", () => {
    expect(speakersByIdsQueryOptions(["b", "a", "b"]).queryKey[1]).toEqual(["a", "b"]);
  });

  it("pusta lista id konczy sie [] bez ANI JEDNEGO wywolania RPC", async () => {
    await expect(run(speakersByIdsQueryOptions([]))).resolves.toEqual([]);
    expect(rpc().calls).toHaveLength(0);
  });

  it("niepusta lista id trafia do p_user_ids z limitem 200", async () => {
    rpc().setData("get_public_speakers", []);

    await run(speakersByIdsQueryOptions(["u-2", "u-1"]));

    expect(rpc().lastCall("get_public_speakers")?.arg("p_user_ids")).toEqual(["u-1", "u-2"]);
    expect(rpc().lastCall("get_public_speakers")?.arg("p_limit")).toBe(200);
  });

  it("dialog profilu: pusty userId nie puka do bazy, a brak wiersza daje null", async () => {
    await expect(run(speakerProfileQueryOptions(""))).resolves.toBeNull();
    expect(rpc().calls).toHaveLength(0);

    rpc().setData("get_public_speakers", []);
    await expect(run(speakerProfileQueryOptions("u-1"))).resolves.toBeNull();

    rpc().setData("get_public_speakers", [{ user_id: "u-1", display_name: "Jan" }]);
    const profil = await run<PublicSpeakerRow | null>(speakerProfileQueryOptions("u-1"));
    expect(profil?.display_name).toBe("Jan");
  });
});

describe("wystapienia prelegenta", () => {
  it("pusty userId nie puka do bazy", async () => {
    await expect(run(speakerEngagementsQueryOptions(""))).resolves.toEqual([]);
    expect(db().chains).toHaveLength(0);
  });

  it("prelegent bez zadnego powiazania konczy sie [] BEZ drugiego zapytania", async () => {
    db().setResponse("event_speakers", () => ok([]));

    await expect(run(speakerEngagementsQueryOptions("u-1"))).resolves.toEqual([]);
    expect(db().lastChain("events")).toBeUndefined();
  });

  it("brak wierszy powiazan (data null) tez konczy sie [] bez drugiego zapytania", async () => {
    db().setResponse("event_speakers", () => ok(null));

    await expect(run(speakerEngagementsQueryOptions("u-1"))).resolves.toEqual([]);
    expect(db().lastChain("events")).toBeUndefined();
  });

  it("odmowa odczytu powiazan RZUCA (program prelegenta to nie 'brak wystapien')", async () => {
    db().setResponse("event_speakers", () => fail("permission denied", "42501"));
    await expect(run(speakerEngagementsQueryOptions("u-1"))).rejects.toThrow(/permission denied/);

    db().setResponse("event_speakers", () => ok([{ event_id: "e-1" }]));
    db().setResponse("events", () => fail("permission denied for table events", "42501"));
    await expect(run(speakerEngagementsQueryOptions("u-1"))).rejects.toThrow(/permission denied/);
  });

  it("domyslny limit osmiu wystapien trafia do zapytania, a jawny go nadpisuje", async () => {
    db().setResponse("event_speakers", () => ok([{ event_id: "e-1" }]));
    db().setResponse("events", () => ok([]));

    await run(speakerEngagementsQueryOptions("u-1"));
    expect(db().lastChain("events")?.argsOf("limit")?.[0]).toBe(8);

    await run(speakerEngagementsQueryOptions("u-1", 3));
    expect(db().lastChain("events")?.argsOf("limit")?.[0]).toBe(3);
    expect(speakerEngagementsQueryOptions("u-1", 3).queryKey).not.toEqual(
      speakerEngagementsQueryOptions("u-1").queryKey,
    );
  });

  it("brak wierszy wydarzen daje pusta liste", async () => {
    db().setResponse("event_speakers", () => ok([{ event_id: "e-1" }]));
    db().setResponse("events", () => ok(null));

    await expect(run<SpeakerEngagement[]>(speakerEngagementsQueryOptions("u-1"))).resolves.toEqual(
      [],
    );
  });
});

describe("lista oceniana: filtr autora", () => {
  it("autor o nieistniejacej nazwie konczy sie [] BEZ round-tripu do wpisow", async () => {
    db().setResponse("profiles_public", () => ok([]));

    await expect(
      run(ratedListQueryOptions({ source: "dynamic", authorFilter: "Nikt Taki" }, "pl")),
    ).resolves.toEqual([]);
    expect(db().lastChain("posts")).toBeUndefined();

    // `null` zamiast pustej tablicy (odmowa odczytu bez rzucania) - ten sam skutek.
    db().setResponse("profiles_public", () => ok(null));
    await expect(
      run(ratedListQueryOptions({ source: "dynamic", authorFilter: "Nikt Taki" }, "pl")),
    ).resolves.toEqual([]);
  });

  it("wiersz profilu z id === null wypada, ale profil bez nazwy WCHODZI do filtra", async () => {
    // Widok publiczny typuje `id` jako nullowalne - taki wiersz nie jest
    // autorem. Profil z nullowa nazwa jest jednak nadal autorem WPISU: jego id
    // musi zawezic zapytanie, choc do mapy nazwisk nie wchodzi.
    db().setResponse("profiles_public", (chain) =>
      inArgs(chain, "display_name") !== undefined
        ? ok([
            { id: null, display_name: "Widmo", avatar_url: null },
            { id: "u-1", display_name: null, avatar_url: null },
            { id: "u-2", display_name: "Ala Przykladowa", avatar_url: null },
          ])
        : ok([]),
    );
    db().setResponse("posts", () =>
      ok([
        {
          id: "p-1",
          slug: "wpis",
          title_pl: "Wpis",
          title_en: "Post",
          excerpt_pl: null,
          excerpt_en: null,
          published_at: null,
          post_format: null,
          author_id: "u-1",
        },
      ]),
    );

    const rows = await run<RatedListItem[]>(
      ratedListQueryOptions({ source: "dynamic", authorFilter: "Ala Przykladowa, Nikt" }, "pl"),
    );

    expect(inArgs(db().lastChain("posts"), "author_id")).toEqual(["u-1", "u-2"]);
    // Autor bez nazwy renderuje sie PUSTYM napisem, a nie literalem "null".
    expect(rows[0].author).toBe("");
    expect(rows[0].authorAvatar).toBeUndefined();
  });

  it("autor JUZ zdobyty przez filtr NIE wywoluje drugiego zapytania o profile", async () => {
    db().setResponse("profiles_public", () =>
      ok([{ id: "u-2", display_name: "Ala Przykladowa", avatar_url: null }]),
    );
    db().setResponse("posts", () =>
      ok([
        {
          id: "p-1",
          slug: "wpis",
          title_pl: "Wpis",
          title_en: "Post",
          excerpt_pl: null,
          excerpt_en: null,
          published_at: null,
          post_format: null,
          author_id: "u-2",
        },
      ]),
    );

    const rows = await run<RatedListItem[]>(
      ratedListQueryOptions({ source: "dynamic", authorFilter: "Ala Przykladowa" }, "pl"),
    );

    expect(db().chainsFor("profiles_public")).toHaveLength(1);
    expect(rows[0].author).toBe("Ala Przykladowa");
  });

  it("czyta widok profiles_public i DOKLADNIE te kolumny, ktore pilnuje bramka dryfu", async () => {
    db().setResponse("profiles_public", () => ok([]));

    await run(ratedListQueryOptions({ source: "dynamic", authorFilter: "Ala" }, "pl"));

    expect(db().lastChain("profiles_public")?.argsOf("select")?.[0]).toBe(
      RATED_LIST_PROFILE_COLUMNS,
    );
  });
});

describe("lista oceniana: algebra include/exclude", () => {
  /** Zwraca licznik REALNYCH wyslan zapytania o wpisy (nie zapisanych lancuchow). */
  function licznikPostow(rows: unknown = []): () => number {
    let n = 0;
    db().setResponse("posts", () => {
      n += 1;
      return ok(rows);
    });
    return () => n;
  }

  it("postFormatFilter 'all' NIE jest filtrem", async () => {
    licznikPostow();

    await run(ratedListQueryOptions({ source: "dynamic", postFormatFilter: "all" }, "pl"));
    const wszystkie = db().lastChain("posts");
    expect(wszystkie?.calls.filter((c) => c.method === "eq")).toHaveLength(1);

    await run(ratedListQueryOptions({ source: "dynamic", postFormatFilter: "video" }, "pl"));
    expect(
      db()
        .lastChain("posts")
        ?.calls.filter((c) => c.method === "eq"),
    ).toHaveLength(2);
  });

  it("sam filtr kategorii albo sam filtr tagow USTAWIA zbior dozwolonych id", async () => {
    licznikPostow();
    db().setResponse("post_categories", () => ok([{ post_id: "p-1" }]));
    db().setResponse("post_tags", () => ok([{ post_id: "p-7" }]));

    await run(ratedListQueryOptions({ source: "dynamic", categoriesFilter: "ue" }, "pl"));
    expect(inArgs(db().lastChain("posts"), "id")).toEqual(["p-1"]);

    await run(ratedListQueryOptions({ source: "dynamic", tagsFilter: "klimat" }, "pl"));
    expect(inArgs(db().lastChain("posts"), "id")).toEqual(["p-7"]);
  });

  it("kategorie i tagi naraz sie PRZECINAJA, a puste przeciecie nie wysyla zapytania", async () => {
    const ilePostow = licznikPostow();
    db().setResponse("post_categories", () => ok([{ post_id: "p-1" }, { post_id: "p-2" }]));
    db().setResponse("post_tags", () => ok([{ post_id: "p-9" }]));

    await expect(
      run(
        ratedListQueryOptions(
          { source: "dynamic", categoriesFilter: "ue", tagsFilter: "klimat" },
          "pl",
        ),
      ),
    ).resolves.toEqual([]);
    // Lancuch `posts` jest juz zbudowany, ale NIGDY nie zostal wyslany.
    expect(ilePostow()).toBe(0);

    db().setResponse("post_tags", () => ok([{ post_id: "p-2" }]));
    await run(
      ratedListQueryOptions(
        { source: "dynamic", categoriesFilter: "ue", tagsFilter: "klimat" },
        "pl",
      ),
    );
    expect(inArgs(db().lastChain("posts"), "id")).toEqual(["p-2"]);
    expect(ilePostow()).toBe(1);
  });

  it("jawna lista identyfikatorow wpisow zaweza zapytanie osobnym ogniwem .in", async () => {
    licznikPostow();

    await run(ratedListQueryOptions({ source: "dynamic", postIdsFilter: "p-1, p-2" }, "pl"));

    expect(inArgs(db().lastChain("posts"), "id")).toEqual(["p-1", "p-2"]);
  });

  it("brak wierszy (data null) w rozwiazaniu kategorii i tagow daje przeciecie puste", async () => {
    const ilePostow = licznikPostow();

    db().setResponse("post_categories", () => ok(null));
    await expect(
      run(ratedListQueryOptions({ source: "dynamic", categoriesFilter: "ue" }, "pl")),
    ).resolves.toEqual([]);

    db().setResponse("post_tags", () => ok(null));
    await expect(
      run(ratedListQueryOptions({ source: "dynamic", tagsFilter: "klimat" }, "pl")),
    ).resolves.toEqual([]);

    expect(ilePostow()).toBe(0);
  });

  it("wykluczenia sumuja sie w JEDNO ogniwo .not, a bez nich ogniwa nie ma", async () => {
    licznikPostow();
    db().setResponse("post_categories", () => ok([{ post_id: "p-8" }]));

    db().setResponse("post_tags", () => ok([{ post_id: "p-9" }]));

    await run(
      ratedListQueryOptions(
        {
          source: "dynamic",
          excludeCategories: "sponsorowane",
          excludeTags: "archiwum",
          excludePostIds: "p-1",
        },
        "pl",
      ),
    );
    const args = db().lastChain("posts")?.argsOf("not");
    expect(args?.[0]).toBe("id");
    expect(args?.[1]).toBe("in");
    // Trzy zrodla wykluczen (jawne id, kategoria, tag) sumuja sie w JEDNO ogniwo.
    expect(String(args?.[2])).toContain("p-1");
    expect(String(args?.[2])).toContain("p-8");
    expect(String(args?.[2])).toContain("p-9");

    await run(ratedListQueryOptions({ source: "dynamic" }, "pl"));
    expect(db().lastChain("posts")?.has("not")).toBe(false);
  });
});

describe("lista oceniana: sortowanie, okno i mapowanie", () => {
  const postRow = (over: Record<string, unknown> = {}) => ({
    id: "p-1",
    slug: "wpis",
    title_pl: "Tytul PL",
    title_en: "Title EN",
    excerpt_pl: "Zajawka PL",
    excerpt_en: "Excerpt EN",
    published_at: "2026-05-01T10:00:00Z",
    post_format: "video",
    author_id: null,
    ...over,
  });

  it("kolumna sortowania idzie za jezykiem, a domyslna galaz sortuje po swiezosci", async () => {
    db().setResponse("posts", () => ok([]));

    await run(ratedListQueryOptions({ source: "dynamic", orderBy: "title_asc" }, "pl"));
    expect(db().lastChain("posts")?.argsOf("order")?.[0]).toBe("title_pl");
    expect(
      (db().lastChain("posts")?.argsOf("order")?.[1] as { ascending: boolean }).ascending,
    ).toBe(true);

    await run(ratedListQueryOptions({ source: "dynamic", orderBy: "title_desc" }, "en"));
    expect(db().lastChain("posts")?.argsOf("order")?.[0]).toBe("title_en");
    expect(
      (db().lastChain("posts")?.argsOf("order")?.[1] as { ascending: boolean }).ascending,
    ).toBe(false);

    await run(ratedListQueryOptions({ source: "dynamic", orderBy: "last_published" }, "pl"));
    expect(db().lastChain("posts")?.argsOf("order")?.[0]).toBe("published_at");
  });

  it("okno wynikow liczy sie z limitu i przesuniecia, a kolumny sa te z bramki dryfu", async () => {
    db().setResponse("posts", () => ok([]));

    await run(ratedListQueryOptions({ source: "dynamic", numberOfPosts: 5, postOffset: 10 }, "pl"));

    expect(db().lastChain("posts")?.argsOf("range")).toEqual([10, 14]);
    expect(db().lastChain("posts")?.argsOf("select")?.[0]).toBe(RATED_LIST_POST_COLUMNS);
  });

  it("tasowanie 'random' zachowuje ZBIOR wierszy, zmienia tylko kolejnosc", async () => {
    db().setResponse("posts", () =>
      ok([postRow({ id: "p-1", slug: "a" }), postRow({ id: "p-2", slug: "b" })]),
    );

    const rows = await run<RatedListItem[]>(
      ratedListQueryOptions({ source: "dynamic", orderBy: "random" }, "pl"),
    );

    expect(rows.map((r) => r.href).sort()).toEqual(["/post/a", "/post/b"]);
  });

  it("lancuch zapasowych wartosci: tytul, zajawka, data i format", async () => {
    db().setResponse("posts", () =>
      ok([
        postRow({
          title_en: "",
          excerpt_pl: null,
          excerpt_en: null,
          published_at: null,
          post_format: null,
        }),
      ]),
    );

    const [item] = await run<RatedListItem[]>(ratedListQueryOptions({ source: "dynamic" }, "en"));

    // Pusty tytul angielski spada na polski - karta bez tytulu nie jest karta.
    expect(item.title).toBe("Tytul PL");
    expect(item.excerpt).toBe("");
    expect(item.date).toBe("");
    expect(item.format).toBe("standard");
    expect(item.rating).toBe(0);
  });

  it("odmowa odczytu wpisow jest CELOWO polykana - pusta lista, nie blad sekcji", async () => {
    // POWOD (naglowek ratedListQuery.ts:353-354): pusta lista jest poprawnym
    // stanem widgetu, a rzucenie wywrocilo by cala sekcje strony. Ten test
    // istnieje po to, zeby za pol roku nikt nie "naprawil" tego na throw bez
    // swiadomej decyzji - i zeby nikt nie zamienil throw-a w polykanie tam,
    // gdzie odmowa MUSI byc widoczna (wydarzenia, sloty spotkan).
    db().setResponse("posts", () => fail("permission denied for table posts", "42501"));

    await expect(run(ratedListQueryOptions({ source: "dynamic" }, "pl"))).resolves.toEqual([]);
  });

  it("ponowne zapytanie o profile dotyczy TYLKO autorow spoza mapy", async () => {
    db().setResponse("posts", () =>
      ok([postRow({ author_id: "u-1" }), postRow({ id: "p-2", slug: "b", author_id: "u-1" })]),
    );
    db().setResponse("profiles_public", () =>
      ok([{ id: "u-1", display_name: "Jan Przykladowy", avatar_url: "https://example.com/a.png" }]),
    );

    const rows = await run<RatedListItem[]>(ratedListQueryOptions({ source: "dynamic" }, "pl"));

    // Dwa wiersze, jeden autor - jedno zapytanie o profile.
    expect(db().chainsFor("profiles_public")).toHaveLength(1);
    expect(inArgs(db().lastChain("profiles_public"), "id")).toEqual(["u-1"]);
    expect(rows[0].author).toBe("Jan Przykladowy");
    expect(rows[0].authorAvatar).toBe("https://example.com/a.png");
  });

  it("drugie zapytanie o profile bez wierszy albo z niepelnym wierszem daje pusty byline", async () => {
    // Autor, ktorego profil zniknal (albo jest ukryty przez izolacje najemcy),
    // renderuje sie PUSTYM napisem - nigdy identyfikatorem ani literalem null.
    db().setResponse("posts", () => ok([postRow({ author_id: "u-7" })]));

    db().setResponse("profiles_public", () => ok(null));
    const brakWierszy = await run<RatedListItem[]>(
      ratedListQueryOptions({ source: "dynamic" }, "pl"),
    );
    expect(brakWierszy[0].author).toBe("");

    // Wiersz JEST, ale bez nazwy - do mapy nazwisk nie wchodzi.
    db().setResponse("profiles_public", () =>
      ok([{ id: "u-7", display_name: null, avatar_url: null }]),
    );
    const bezNazwy = await run<RatedListItem[]>(ratedListQueryOptions({ source: "dynamic" }, "pl"));
    expect(bezNazwy[0].author).toBe("");
  });

  it("brak author_id we wszystkich wierszach omija zapytanie o profile", async () => {
    db().setResponse("posts", () => ok([postRow()]));

    await run(ratedListQueryOptions({ source: "dynamic" } as WidgetContent, "pl"));

    expect(db().lastChain("profiles_public")).toBeUndefined();
  });
});
