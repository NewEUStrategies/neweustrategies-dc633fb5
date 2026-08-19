// SCALANIE DANYCH GOŚCIA PO ZALOGOWANIU - 3,52% linii i 0 z 8 funkcji.
//
// To jedyna ścieżka, na której użytkownik może STRACIĆ DANE: zainteresowania
// wybrane przed rejestracją i artykuły zapisane jako gość żyją wyłącznie
// w localStorage tej przeglądarki. Jeśli merge skasuje je przed potwierdzonym
// zapisem, nie ma ich skąd odtworzyć.
//
// Komentarz w module wymienia trzy defekty, które ta wersja naprawiła - i to
// właśnie one są tu utrwalone testem, bo bez niego nic nie broni przed
// powrotem do poprzedniego zachowania:
//   1. merge odpalał się tylko przy zamontowanym widżecie,
//   2. zwykły insert wywracał całą partię na duplikacie,
//   3. localStorage czyszczony NAWET gdy zapis się nie powiódł.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";

import { ok, fail, supabaseFromStub, type SupabaseFromStub } from "@/test/supabase/chain";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { GUEST_SAVED_ARTICLES_KEY } from "@/lib/storageKeys";

const ANON_KEY = "nes.interests.anon.v1";
const SAVED_KEY = GUEST_SAVED_ARTICLES_KEY.key;
const USER = "77777777-7777-4777-8777-777777777777";
const DAY = 86_400_000;

let chain: SupabaseFromStub;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => chain.from(table) },
}));

const { mergeAnonPersonalization, hasAnonPersonalization, readAnonInterestIds } =
  await import("@/lib/personalization/anonMerge");

function seedInterests(categoryIds: string[], tagIds: string[]) {
  window.localStorage.setItem(ANON_KEY, JSON.stringify({ categoryIds, tagIds }));
}

function seedSaved(items: Array<{ url: string; title: string; savedAt?: number }>) {
  window.localStorage.setItem(SAVED_KEY, JSON.stringify(items));
}

function readSaved(): Array<{ url: string }> {
  return JSON.parse(window.localStorage.getItem(SAVED_KEY) ?? "[]");
}

/** Klient z podstawionymi ustawieniami - `ensureQueryData` nie idzie do sieci. */
function clientWithTtl(guestExpirationDays: number): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(siteSettingsQueryOptions.queryKey, {
    personalized_system: { guestExpirationDays },
  });
  return qc;
}

beforeEach(() => {
  window.localStorage.clear();
  chain = supabaseFromStub();
  chain.setResponse("user_follows", ok(null));
  chain.setResponse("user_bookmarks", ok(null));
  chain.setResponse("posts", ok([]));
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-08-19T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("readAnonInterestIds - odczyt odporny na śmieci w pamięci", () => {
  it("brak wpisu daje puste tablice, nie `null`", () => {
    const res = readAnonInterestIds();

    expect(res.categoryIds).toEqual([]);
    expect(res.tagIds).toEqual([]);
  });

  it("USZKODZONY JSON nie wywala logowania", () => {
    // Ten odczyt biegnie w AuthProviderze przy każdym SIGNED_IN; wyjątek tutaj
    // zablokowałby zalogowanie się na tej przeglądarce na stałe.
    window.localStorage.setItem(ANON_KEY, "{to nie jest json");

    const res = readAnonInterestIds();

    expect(res.categoryIds).toEqual([]);
    expect(res.tagIds).toEqual([]);
  });

  it("wartość o złym TYPIE jest odrzucana, nie przepuszczana dalej", () => {
    window.localStorage.setItem(ANON_KEY, JSON.stringify({ categoryIds: "kat", tagIds: 7 }));

    const res = readAnonInterestIds();

    expect(res.categoryIds).toEqual([]);
    expect(res.tagIds).toEqual([]);
  });

  it("zwraca zapisane identyfikatory", () => {
    seedInterests(["kat-1", "kat-2"], ["tag-1"]);

    const res = readAnonInterestIds();

    expect(res.categoryIds).toEqual(["kat-1", "kat-2"]);
    expect(res.tagIds).toEqual(["tag-1"]);
  });

  it("bez `window` odczyt zwraca pustkę zamiast rzucać", () => {
    vi.stubGlobal("window", undefined);

    const res = readAnonInterestIds();

    expect(res.categoryIds).toEqual([]);
    expect(res.tagIds).toEqual([]);
  });
});

describe("hasAnonPersonalization - czy w ogóle jest co scalać", () => {
  it("czysta przeglądarka: nie ma", () => {
    expect(hasAnonPersonalization()).toBe(false);
    expect(readAnonInterestIds().categoryIds).toEqual([]);
  });

  it("same zainteresowania wystarczą", () => {
    seedInterests(["kat-1"], []);

    expect(hasAnonPersonalization()).toBe(true);
    expect(readSaved()).toEqual([]);
  });

  it("same zapisane artykuły wystarczą", () => {
    seedSaved([{ url: "/analizy/artykul", title: "Artykuł" }]);

    expect(hasAnonPersonalization()).toBe(true);
    expect(readAnonInterestIds().tagIds).toEqual([]);
  });

  it("wpis bez `url` nie liczy się jako dane gościa", () => {
    seedSaved([{ title: "Bez adresu" } as { url: string; title: string }]);

    expect(hasAnonPersonalization()).toBe(false);
  });
});

describe("mergeAnonPersonalization - zainteresowania", () => {
  it("scala kategorie i tagi jednym upsertem odpornym na duplikaty", () => {
    // `ignoreDuplicates` to punkt 2 z komentarza modułu: zwykły insert
    // wywracał CAŁĄ partię, gdy jedna pozycja już była na koncie.
    seedInterests(["kat-1"], ["tag-1"]);

    return mergeAnonPersonalization(USER).then((res) => {
      expect(res.mergedInterests).toBe(2);
      const args = chain.lastChain("user_follows")!.argsOf("upsert")!;
      expect(args[0]).toEqual([
        { user_id: USER, target_type: "category", target_id: "kat-1" },
        { user_id: USER, target_type: "tag", target_id: "tag-1" },
      ]);
      expect(args[1]).toEqual({
        onConflict: "user_id,target_type,target_id",
        ignoreDuplicates: true,
      });
    });
  });

  it("po POTWIERDZONYM zapisie czyści dane z urządzenia", async () => {
    seedInterests(["kat-1"], []);

    await mergeAnonPersonalization(USER);

    expect(JSON.parse(window.localStorage.getItem(ANON_KEY)!)).toEqual({
      categoryIds: [],
      tagIds: [],
    });
  });

  it("BŁĄD zapisu ZOSTAWIA dane na urządzeniu - to jest ta utrata danych", async () => {
    // Punkt 3 z komentarza modułu. Wyczyszczenie tu skasowałoby wybór
    // użytkownika bezpowrotnie: na koncie go nie ma, w przeglądarce już też nie.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    seedInterests(["kat-1"], ["tag-1"]);
    chain.setResponse("user_follows", fail("row level security"));

    const res = await mergeAnonPersonalization(USER);

    expect(res.mergedInterests).toBe(0);
    expect(JSON.parse(window.localStorage.getItem(ANON_KEY)!)).toEqual({
      categoryIds: ["kat-1"],
      tagIds: ["tag-1"],
    });
    warn.mockRestore();
  });

  it("brak zainteresowań nie generuje zapytania", async () => {
    const res = await mergeAnonPersonalization(USER);

    expect(res.mergedInterests).toBe(0);
    expect(chain.chainsFor("user_follows")).toHaveLength(0);
  });
});

describe("mergeAnonPersonalization - zakładki gościa", () => {
  it("rozwiązuje slug z adresu i scala zakładkę", async () => {
    seedSaved([{ url: "https://example.test/analizy/reforma-ue", title: "Reforma" }]);
    chain.setResponse("posts", ok([{ id: "post-1", slug: "reforma-ue" }]));

    const res = await mergeAnonPersonalization(USER);

    expect(res.mergedBookmarks).toBe(1);
    expect(chain.lastChain("posts")!.argsOf("in")).toEqual(["slug", ["reforma-ue"]]);
    expect(chain.lastChain("user_bookmarks")!.argsOf("upsert")![0]).toEqual([
      { user_id: USER, entity_type: "post", entity_id: "post-1" },
    ]);
  });

  it("wpis PO TTL nie wraca na konto i znika z urządzenia", async () => {
    // TTL gościa to decyzja redakcyjna: pozycje starsze niż limit wygasły.
    seedSaved([
      { url: "/analizy/stary", title: "Stary", savedAt: Date.now() - 20 * DAY },
      { url: "/analizy/swiezy", title: "Świeży", savedAt: Date.now() - 2 * DAY },
    ]);
    chain.setResponse("posts", ok([{ id: "post-2", slug: "swiezy" }]));

    const res = await mergeAnonPersonalization(USER, clientWithTtl(14));

    expect(res.mergedBookmarks).toBe(1);
    expect(chain.lastChain("posts")!.argsOf("in")).toEqual(["slug", ["swiezy"]]);
  });

  it("wpis BEZ znacznika czasu jest traktowany jak świeży, nie jak wygasły", async () => {
    // Brak `savedAt` to stary format zapisu, a nie dowód, że wpis jest stary.
    seedSaved([{ url: "/analizy/bez-daty", title: "Bez daty" }]);
    chain.setResponse("posts", ok([{ id: "post-3", slug: "bez-daty" }]));

    const res = await mergeAnonPersonalization(USER, clientWithTtl(14));

    expect(res.mergedBookmarks).toBe(1);
    expect(readSaved()).toEqual([]);
  });

  it("pozycja NIEROZWIĄZANA zostaje na urządzeniu", async () => {
    // Post z innego tenanta albo usunięty - nie wolno go po cichu skasować.
    seedSaved([
      { url: "/analizy/jest", title: "Jest" },
      { url: "/analizy/nie-ma", title: "Nie ma" },
    ]);
    chain.setResponse("posts", ok([{ id: "post-4", slug: "jest" }]));

    const res = await mergeAnonPersonalization(USER);

    expect(res.mergedBookmarks).toBe(1);
    expect(readSaved().map((s) => s.url)).toEqual(["/analizy/nie-ma"]);
  });

  it("BŁĄD zapisu zakładek ZOSTAWIA wszystko na urządzeniu", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    seedSaved([{ url: "/analizy/reforma", title: "Reforma" }]);
    chain.setResponse("posts", ok([{ id: "post-5", slug: "reforma" }]));
    chain.setResponse("user_bookmarks", fail("row level security"));

    const res = await mergeAnonPersonalization(USER);

    expect(res.mergedBookmarks).toBe(0);
    expect(readSaved().map((s) => s.url)).toEqual(["/analizy/reforma"]);
    warn.mockRestore();
  });

  it("BŁĄD rozwiązywania slugów nie rusza urządzenia", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    seedSaved([{ url: "/analizy/reforma", title: "Reforma" }]);
    chain.setResponse("posts", fail("timeout"));

    const res = await mergeAnonPersonalization(USER);

    expect(res.mergedBookmarks).toBe(0);
    expect(readSaved()).toHaveLength(1);
    warn.mockRestore();
  });

  it("DUPLIKAT adresu nie dubluje zakładki", async () => {
    // Dwa różne linki do tego samego posta (kanoniczny i bezpośredni).
    seedSaved([
      { url: "/analizy/reforma-ue", title: "Reforma" },
      { url: "/post/reforma-ue", title: "Reforma" },
    ]);
    chain.setResponse("posts", ok([{ id: "post-6", slug: "reforma-ue" }]));

    const res = await mergeAnonPersonalization(USER);

    expect(res.mergedBookmarks).toBe(1);
    expect(chain.lastChain("posts")!.argsOf("in")).toEqual(["slug", ["reforma-ue"]]);
  });

  it("czyta też wartość spod POPRZEDNIEJ nazwy klucza", async () => {
    // Migracja nazw kluczy nie może zjeść zakładek zebranych wcześniej.
    window.localStorage.setItem(
      GUEST_SAVED_ARTICLES_KEY.legacy[0]!,
      JSON.stringify([{ url: "/analizy/legacy", title: "Legacy" }]),
    );
    chain.setResponse("posts", ok([{ id: "post-7", slug: "legacy" }]));

    const res = await mergeAnonPersonalization(USER);

    expect(res.mergedBookmarks).toBe(1);
    expect(chain.lastChain("posts")!.argsOf("in")).toEqual(["slug", ["legacy"]]);
  });

  it("wpis, z którego nie da się wyłuskać sluga, nie generuje zapytania", async () => {
    seedSaved([{ url: "/", title: "Strona główna" }]);

    const res = await mergeAnonPersonalization(USER);

    expect(res.mergedBookmarks).toBe(0);
    expect(chain.chainsFor("posts")).toHaveLength(0);
  });

  it("adres z USZKODZONYM kodowaniem procentowym jest pomijany, nie wywala scalania", async () => {
    // `decodeURIComponent` rzuca na niedokończonej sekwencji - gość mógł
    // zapisać taki link z ręcznie sklejonego adresu.
    seedSaved([
      { url: "/analizy/%E0%A4%A", title: "Uszkodzony" },
      { url: "/analizy/dobry", title: "Dobry" },
    ]);
    chain.setResponse("posts", ok([{ id: "post-9", slug: "dobry" }]));

    const res = await mergeAnonPersonalization(USER);

    expect(res.mergedBookmarks).toBe(1);
    expect(chain.lastChain("posts")!.argsOf("in")).toEqual(["slug", ["dobry"]]);
  });

  it("TTL ustawiony na zero znaczy BEZ wygasania, a nie „wszystko wygasło”", async () => {
    // Redakcja wyłącza wygasanie wpisując 0; potraktowanie tego jako „cutoff
    // = teraz” skasowałoby gościom całą listę przy pierwszym zalogowaniu.
    seedSaved([{ url: "/analizy/prastary", title: "Prastary", savedAt: Date.now() - 900 * DAY }]);
    chain.setResponse("posts", ok([{ id: "post-10", slug: "prastary" }]));

    const res = await mergeAnonPersonalization(USER, clientWithTtl(0));

    expect(res.mergedBookmarks).toBe(1);
    expect(chain.lastChain("posts")!.argsOf("in")).toEqual(["slug", ["prastary"]]);
  });

  it("pusta lista postów z bazy nie czyści urządzenia", async () => {
    seedSaved([{ url: "/analizy/reforma", title: "Reforma" }]);
    chain.setResponse("posts", ok([]));

    const res = await mergeAnonPersonalization(USER);

    expect(res.mergedBookmarks).toBe(0);
    expect(readSaved()).toHaveLength(1);
  });
});

describe("mergeAnonPersonalization - TTL z ustawień i unieważnianie cache", () => {
  it("bez QueryClienta używa wartości domyślnej (14 dni), nie blokuje logowania", async () => {
    seedSaved([
      { url: "/analizy/stary", title: "Stary", savedAt: Date.now() - 20 * DAY },
      { url: "/analizy/swiezy", title: "Świeży", savedAt: Date.now() - 5 * DAY },
    ]);
    chain.setResponse("posts", ok([{ id: "post-8", slug: "swiezy" }]));

    const res = await mergeAnonPersonalization(USER);

    expect(res.mergedBookmarks).toBe(1);
    expect(chain.lastChain("posts")!.argsOf("in")).toEqual(["slug", ["swiezy"]]);
  });

  it("TTL z ustawień redakcji nadpisuje domyślny", async () => {
    seedSaved([{ url: "/analizy/piec-dni", title: "Pięć dni", savedAt: Date.now() - 5 * DAY }]);

    const res = await mergeAnonPersonalization(USER, clientWithTtl(3));

    // 5 dni > 3 dni TTL - pozycja wygasła i nie ma czego rozwiązywać.
    expect(res.mergedBookmarks).toBe(0);
    expect(chain.chainsFor("posts")).toHaveLength(0);
  });

  it("BŁĄD odczytu ustawień schodzi na domyślny TTL zamiast blokować merge", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Brak danych w cache + zapytanie, które padnie -> `guestTtlDays` łapie błąd.
    chain.setResponse("site_settings", fail("timeout"));
    seedInterests(["kat-1"], []);

    const res = await mergeAnonPersonalization(USER, qc);

    expect(res.mergedInterests).toBe(1);
    expect(chain.chainsFor("user_follows")).toHaveLength(1);
  });

  it("po UDANYM scaleniu unieważnia widoki czytające obie tabele", async () => {
    const qc = clientWithTtl(14);
    const spy = vi.spyOn(qc, "invalidateQueries").mockResolvedValue();
    seedInterests(["kat-1"], []);

    await mergeAnonPersonalization(USER, qc);

    const keys = spy.mock.calls.map(([arg]) => (arg as { queryKey: string[] }).queryKey[0]);
    expect(keys).toContain("my-interests");
    expect(keys).toContain("bookmarks");
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(6);
  });

  it("gdy NIC nie scalono, cache nie jest ruszany", async () => {
    const qc = clientWithTtl(14);
    const spy = vi.spyOn(qc, "invalidateQueries").mockResolvedValue();

    const res = await mergeAnonPersonalization(USER, qc);

    expect(res).toEqual({ mergedInterests: 0, mergedBookmarks: 0 });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("mergeAnonPersonalization - runda zapis, odczyt, scalenie", () => {
  it("nie gubi i nie dubluje: wszystko z urządzenia ląduje na koncie dokładnie raz", async () => {
    seedInterests(["kat-1", "kat-2"], ["tag-1"]);
    seedSaved([
      { url: "/analizy/pierwszy", title: "Pierwszy", savedAt: Date.now() - DAY },
      { url: "/post/pierwszy", title: "Pierwszy (duplikat)", savedAt: Date.now() - DAY },
      { url: "/analizy/drugi", title: "Drugi" },
    ]);
    chain.setResponse(
      "posts",
      ok([
        { id: "post-a", slug: "pierwszy" },
        { id: "post-b", slug: "drugi" },
      ]),
    );

    const res = await mergeAnonPersonalization(USER, clientWithTtl(14));

    expect(res).toEqual({ mergedInterests: 3, mergedBookmarks: 2 });
    const bookmarks = chain.lastChain("user_bookmarks")!.argsOf("upsert")![0] as Array<{
      entity_id: string;
    }>;
    expect(bookmarks.map((b) => b.entity_id).sort()).toEqual(["post-a", "post-b"]);
    // Nic nie zostało na urządzeniu i nic nie poszło dwa razy.
    expect(readSaved()).toEqual([]);
    expect(JSON.parse(window.localStorage.getItem(ANON_KEY)!).categoryIds).toEqual([]);
  });

  it("drugie wywołanie po udanym scaleniu nie powtarza zapisów", async () => {
    seedInterests(["kat-1"], []);
    await mergeAnonPersonalization(USER);
    const afterFirst = chain.chainsFor("user_follows").length;

    const res = await mergeAnonPersonalization(USER);

    expect(res.mergedInterests).toBe(0);
    expect(chain.chainsFor("user_follows")).toHaveLength(afterFirst);
  });

  it("dwa RÓWNOLEGŁE wywołania dzielą jedną robotę", async () => {
    // SIGNED_IN potrafi przyjść dwa razy (powrót fokusa na kartę).
    seedInterests(["kat-1"], []);

    const [a, b] = await Promise.all([
      mergeAnonPersonalization(USER),
      mergeAnonPersonalization(USER),
    ]);

    expect(a).toEqual(b);
    expect(chain.chainsFor("user_follows")).toHaveLength(1);
  });
});
