// ŚCIEŻKA DANYCH WIDGETÓW KLUBOWYCH - odmowy, pustki i normalizacja wejścia.
//
// CZEGO TU BRONIMY (i dlaczego akurat gałęzi, a nie linii)
//
// `clubsQuery.ts` to pięć fabryk `queryOptions`, w których cała logika siedzi
// w rozgałęzieniach: `enabled` liczone z pustego adresu, `if (error) throw`,
// `data?.[0]`, `data ?? []`, `retry: false`, `Number(x ?? 0)` i
// `row.verified === true`. Wywołanie fabryki wykonuje LINIE, ale nie dotyka
// ANI JEDNEJ z tych gałęzi - dopiero uruchomienie `queryFn` przy podstawionej
// bazie rozstrzyga, czy odmowa uprawnień kończy się błędem widgetu, czy cichą
// pustką nieodróżnialną od klubu bez treści.
//
// TRZY KLASY ZACHOWANIA, KTÓRE MUSZĄ ZOSTAĆ ROZRÓŻNIONE
//   1. ODMOWA (RLS / brak `club_capabilities`) -> `throw`, żeby widget pokazał
//      stan błędu. Zamiana tego na `[]` zrobiłaby z braku uprawnień „pusty
//      klub" - najgroźniejszy wariant, bo wygląda jak poprawna odpowiedź.
//   2. PUSTKA (`data === null` albo `[]`) -> `null` / `[]` BEZ wyjątku. Klub
//      bez wątków jest poprawnym stanem, nie awarią.
//   3. STAN NIESKONFIGUROWANY (pusty adres / nierozwiązany identyfikator) ->
//      `enabled === false`, czyli zero pukania do bazy.
//
// IZOLACJA NAJEMCY: te widgety NIE budują własnych zapytań tabelarycznych -
// każda sekcja idzie przez RPC `SECURITY DEFINER` (`club_view`,
// `club_activity_feed`, `club_threads_list`, `club_posts_list`,
// `club_members_list`), które liczą widoczność i najemcę PO STRONIE BAZY.
// Dlatego w argumentach nie ma (i nie może być) `tenant_id` - test pilnuje
// kompletu nazw argumentów, bo zgubiony `p_club_id` byłby równoważny utracie
// zawężenia.
//
// DANE: wyłącznie fikcyjne, adresy w domenie example.com (RODO).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { SupabaseRpcStub } from "@/test/supabase";

const sb = vi.hoisted(() => ({ rpc: null as SupabaseRpcStub | null }));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseRpcStub } = await import("@/test/supabase");
  const rpcStub = supabaseRpcStub();
  sb.rpc = rpcStub;
  return { supabase: { rpc: rpcStub.rpc } };
});

import { fail, ok } from "@/test/supabase";
import {
  clubCardQueryOptions,
  clubHubArticlesQueryOptions,
  clubHubCommentsQueryOptions,
  clubHubMembersQueryOptions,
  clubThreadsQueryOptions,
  type ClubCardRow,
  type ClubHubArticleRow,
  type ClubHubCommentRow,
  type ClubHubMemberRow,
  type ClubThreadTeaserRow,
} from "@/lib/builder/clubsQuery";

function rpc(): SupabaseRpcStub {
  if (sb.rpc === null) throw new Error("test: atrapa `rpc` nie zostala utworzona");
  return sb.rpc;
}

/** Uruchamia `queryFn` opcji dokładnie tak, jak zrobiłby to react-query. */
function run<T>(options: { queryFn?: unknown }): Promise<T> {
  const fn = options.queryFn as (() => Promise<T>) | undefined;
  if (typeof fn !== "function") throw new Error("test: fabryka nie oddala `queryFn`");
  return fn();
}

const CLUB_ID = "11111111-1111-4111-a111-111111111111";

function cardRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CLUB_ID,
    slug: "klub-energii",
    name_pl: "Klub Energii",
    name_en: "Energy Club",
    tagline_pl: null,
    tagline_en: null,
    icon: null,
    accent_color: null,
    cover_image_url: null,
    policy_area: "energy",
    member_count: 12,
    thread_count: 3,
    visibility: "public",
    ...overrides,
  };
}

beforeEach(() => {
  rpc().reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("clubCardQueryOptions - karta jednego klubu", () => {
  it("pusty adres (same spacje) wyłącza zapytanie i trafia do klucza jako pusty napis", () => {
    const options = clubCardQueryOptions("   ");

    expect(options.enabled).toBe(false);
    expect(options.queryKey).toEqual(["builder-club-card", ""]);
  });

  it("adres jest trymowany PRZED kluczem, więc dwa zapisy tego samego klubu dzielą wpis cache", () => {
    expect(clubCardQueryOptions("  klub-energii  ").queryKey).toEqual(
      clubCardQueryOptions("klub-energii").queryKey,
    );
    expect(clubCardQueryOptions("  klub-energii  ").enabled).toBe(true);
  });

  it("odmowa RPC club_view kończy się BŁĘDEM, a nie pustą kartą", async () => {
    rpc().setResponse("club_view", () => fail("permission denied for function club_view", "42501"));

    await expect(run(clubCardQueryOptions("klub-energii"))).rejects.toThrow(/permission denied/);
  });

  it("brak wiersza (data null) daje null - klub nieistniejący to nie awaria", async () => {
    rpc().setResponse("club_view", () => ok(null));

    await expect(run<ClubCardRow | null>(clubCardQueryOptions("klub-energii"))).resolves.toBeNull();
  });

  it("pusta tablica wierszy też daje null, a nie kartę z pustymi polami", async () => {
    rpc().setResponse("club_view", () => ok([]));

    await expect(run<ClubCardRow | null>(clubCardQueryOptions("klub-energii"))).resolves.toBeNull();
  });

  it("pierwszy wiersz jest przepisywany na kartę, a do RPC idzie adres PO trymowaniu", async () => {
    rpc().setResponse("club_view", () => ok([cardRow(), cardRow({ id: "drugi" })]));

    const card = await run<ClubCardRow | null>(clubCardQueryOptions("  klub-energii  "));

    expect(card).toEqual({
      id: CLUB_ID,
      slug: "klub-energii",
      name_pl: "Klub Energii",
      name_en: "Energy Club",
      tagline_pl: null,
      tagline_en: null,
      icon: null,
      accent_color: null,
      cover_image_url: null,
      policy_area: "energy",
      member_count: 12,
      thread_count: 3,
      visibility: "public",
    });
    expect(rpc().lastCall("club_view")?.arg("p_slug")).toBe("klub-energii");
    expect(rpc().lastCall("club_view")?.keys()).toEqual(["p_slug"]);
  });
});

describe("clubThreadsQueryOptions - strumień wątków ponad klubami", () => {
  it("nieznana wartość sortowania spada na 'hot', pusty obszar na pusty napis, limit 0 na 1", () => {
    const options = clubThreadsQueryOptions({ sort: "bzdura", policyArea: "  ", limit: 0 });

    expect(options.queryKey).toEqual(["builder-club-threads", "hot", "", 1]);
  });

  it("'new' jest jedyną alternatywą dla 'hot', a limit ponad 12 jest zaciskany", () => {
    expect(
      clubThreadsQueryOptions({ sort: "new", policyArea: "energy", limit: 99 }).queryKey,
    ).toEqual(["builder-club-threads", "new", "energy", 12]);
  });

  it("pusty obszar polityki idzie do RPC jako undefined, a nie pusty napis", async () => {
    // Pusty napis ZAWĘZIŁBY wynik do nieistniejącego obszaru, czyli zamieniłby
    // „bez filtra" w „zawsze pusto" - i to jest cała stawka tej gałęzi.
    rpc().setResponse("club_activity_feed", () => ok([]));

    await run(clubThreadsQueryOptions({ sort: "hot", policyArea: "   ", limit: 5 }));

    const call = rpc().lastCall("club_activity_feed");
    expect(call?.arg("p_policy_area")).toBeUndefined();
    expect(call?.arg("p_sort")).toBe("hot");
    expect(call?.arg("p_limit")).toBe(5);
  });

  it("niepusty obszar polityki idzie do RPC po trymowaniu", async () => {
    rpc().setResponse("club_activity_feed", () => ok([]));

    await run(clubThreadsQueryOptions({ sort: "new", policyArea: "  energy  ", limit: 3 }));

    expect(rpc().lastCall("club_activity_feed")?.arg("p_policy_area")).toBe("energy");
  });

  it("odmowa RPC club_activity_feed kończy się BŁĘDEM", async () => {
    rpc().setResponse("club_activity_feed", () => fail("permission denied", "42501"));

    await expect(
      run(clubThreadsQueryOptions({ sort: "hot", policyArea: "", limit: 5 })),
    ).rejects.toThrow(/permission denied/);
  });

  it("brak wierszy (data null) daje pustą listę, a nie wyjątek", async () => {
    rpc().setResponse("club_activity_feed", () => ok(null));

    await expect(
      run<ClubThreadTeaserRow[]>(
        clubThreadsQueryOptions({ sort: "hot", policyArea: "", limit: 5 }),
      ),
    ).resolves.toEqual([]);
  });

  it("wiersze są przepisywane na zapowiedzi wątków w kolejności z bazy", async () => {
    rpc().setResponse("club_activity_feed", () =>
      ok([
        {
          thread_id: "watek-1",
          thread_slug: "pierwszy-watek",
          title: "Pierwszy wątek",
          kind: "discussion",
          club_slug: "klub-energii",
          club_name_pl: "Klub Energii",
          club_name_en: "Energy Club",
          reply_count: 4,
          last_reply_at: "2026-09-01T10:00:00.000Z",
        },
      ]),
    );

    const rows = await run<ClubThreadTeaserRow[]>(
      clubThreadsQueryOptions({ sort: "hot", policyArea: "", limit: 5 }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].thread_slug).toBe("pierwszy-watek");
    expect(rows[0].reply_count).toBe(4);
  });
});

describe("clubHubArticlesQueryOptions - sekcja artykułów widgetu 'Klub: strona'", () => {
  it("nierozwiązany identyfikator klubu wyłącza zapytanie", () => {
    const options = clubHubArticlesQueryOptions("   ", 5);

    expect(options.enabled).toBe(false);
    expect(options.queryKey).toEqual(["builder-club-hub-articles", "", 5]);
  });

  it("retry: false to ŚWIADOMA odmowa ponawiania - odmowa uprawnień leci do bazy raz, nie cztery razy", async () => {
    // Dowód zachowaniem, nie kształtem obiektu: klient ma domyślnie trzy
    // ponowienia, a mimo to RPC zostaje wywołane dokładnie raz. Gdyby ktoś
    // usunął `retry: false`, ta asercja spadłaby na 4 - a produkcja dostałaby
    // czterokrotny strzał do bazy za każdy odrzucony odczyt.
    rpc().setResponse("club_threads_list", () => fail("insufficient capability", "42501"));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: 3, retryDelay: 0 } },
    });

    await expect(client.fetchQuery(clubHubArticlesQueryOptions(CLUB_ID, 5))).rejects.toThrow(
      /insufficient capability/,
    );

    expect(rpc().callsFor("club_threads_list")).toHaveLength(1);
    client.clear();
  });

  it("brak wierszy (data null) daje pustą sekcję bez wyjątku", async () => {
    rpc().setResponse("club_threads_list", () => ok(null));

    await expect(
      run<ClubHubArticleRow[]>(clubHubArticlesQueryOptions(CLUB_ID, 5)),
    ).resolves.toEqual([]);
  });

  it("puste liczniki odpowiedzi i reakcji stają się zerami, a nie NaN", async () => {
    rpc().setResponse("club_threads_list", () =>
      ok([
        {
          id: "watek-1",
          slug: "pierwszy-watek",
          title: "Pierwszy wątek",
          excerpt: null,
          author_name: null,
          created_at: null,
          last_reply_at: null,
          reply_count: null,
          reaction_count: undefined,
        },
      ]),
    );

    const rows = await run<ClubHubArticleRow[]>(clubHubArticlesQueryOptions(`  ${CLUB_ID}  `, 5));

    expect(rows[0].reply_count).toBe(0);
    expect(rows[0].reaction_count).toBe(0);
    expect(Number.isNaN(rows[0].reply_count)).toBe(false);
    const call = rpc().lastCall("club_threads_list");
    expect(call?.arg("p_club_id")).toBe(CLUB_ID);
    expect(call?.arg("p_sort")).toBe("new");
    expect(call?.arg("p_limit")).toBe(5);
  });

  it("liczniki podane napisem (bigint z PostgREST) są koercjonowane do liczby", async () => {
    rpc().setResponse("club_threads_list", () =>
      ok([
        {
          id: "watek-2",
          slug: "drugi-watek",
          title: "Drugi wątek",
          excerpt: "Zajawka",
          author_name: "Autorka Testowa",
          created_at: "2026-09-01T10:00:00.000Z",
          last_reply_at: "2026-09-02T10:00:00.000Z",
          reply_count: "7",
          reaction_count: "11",
        },
      ]),
    );

    const rows = await run<ClubHubArticleRow[]>(clubHubArticlesQueryOptions(CLUB_ID, 5));

    expect(rows[0].reply_count).toBe(7);
    expect(rows[0].reaction_count).toBe(11);
  });
});

describe("clubHubCommentsQueryOptions - sekcja komentarzy widgetu 'Klub: strona'", () => {
  it("nierozwiązany identyfikator klubu wyłącza zapytanie i nie ponawia odmowy", () => {
    const options = clubHubCommentsQueryOptions("", 4);

    expect(options.enabled).toBe(false);
    expect(options.retry).toBe(false);
  });

  it("odmowa RPC club_posts_list kończy się BŁĘDEM", async () => {
    rpc().setResponse("club_posts_list", () => fail("insufficient capability", "42501"));

    await expect(run(clubHubCommentsQueryOptions(CLUB_ID, 4))).rejects.toThrow(
      /insufficient capability/,
    );
  });

  it("brak wierszy (data null) daje pustą sekcję", async () => {
    rpc().setResponse("club_posts_list", () => ok(null));

    await expect(
      run<ClubHubCommentRow[]>(clubHubCommentsQueryOptions(CLUB_ID, 4)),
    ).resolves.toEqual([]);
  });

  it("pusty licznik polubień staje się zerem, a komplet argumentów RPC jest przekazany", async () => {
    rpc().setResponse("club_posts_list", () =>
      ok([
        {
          id: "wpis-1",
          body: "Treść wpisu na ścianie",
          author_name: null,
          author_avatar: null,
          author_slug: null,
          thread_slug: null,
          thread_title: null,
          created_at: null,
          like_count: null,
        },
      ]),
    );

    const rows = await run<ClubHubCommentRow[]>(clubHubCommentsQueryOptions(CLUB_ID, 4));

    expect(rows[0].like_count).toBe(0);
    expect(rpc().lastCall("club_posts_list")?.keys()).toEqual(["p_club_id", "p_limit"]);
  });
});

describe("clubHubMembersQueryOptions - sekcja zapisów widgetu 'Klub: strona'", () => {
  it("nierozwiązany identyfikator klubu wyłącza zapytanie i nie ponawia odmowy", () => {
    const options = clubHubMembersQueryOptions("   ", 6);

    expect(options.enabled).toBe(false);
    expect(options.retry).toBe(false);
    expect(options.queryKey).toEqual(["builder-club-hub-members", "", 6]);
  });

  it("odmowa RPC club_members_list kończy się BŁĘDEM", async () => {
    rpc().setResponse("club_members_list", () => fail("insufficient capability", "42501"));

    await expect(run(clubHubMembersQueryOptions(CLUB_ID, 6))).rejects.toThrow(
      /insufficient capability/,
    );
  });

  it("brak wierszy (data null) daje pustą listę członków", async () => {
    rpc().setResponse("club_members_list", () => ok(null));

    await expect(run<ClubHubMemberRow[]>(clubHubMembersQueryOptions(CLUB_ID, 6))).resolves.toEqual(
      [],
    );
  });

  it("napis 'true' NIE robi z członka zweryfikowanego, a pusty total_count staje się zerem", async () => {
    // `verified` steruje odznaką wiarygodności w interfejsie. Porównanie
    // ścisłe jest tu jedyną poprawną formą: każda wartość „prawdziwa"
    // w sensie JS (napis, 1, obiekt) przyznawałaby odznakę wierszowi, który
    // w bazie zweryfikowany nie jest.
    rpc().setResponse("club_members_list", () =>
      ok([
        {
          user_id: "czlonek-1",
          display_name: "Osoba Testowa",
          avatar_url: "https://cdn.example.com/awatar-1.png",
          slug: "osoba-testowa",
          job_title: null,
          current_company: null,
          role: "member",
          joined_at: null,
          verified: "true",
          total_count: null,
        },
        {
          user_id: "czlonek-2",
          display_name: null,
          avatar_url: null,
          slug: null,
          job_title: null,
          current_company: null,
          role: "owner",
          joined_at: "2026-09-01T10:00:00.000Z",
          verified: true,
          total_count: "2",
        },
      ]),
    );

    const rows = await run<ClubHubMemberRow[]>(clubHubMembersQueryOptions(CLUB_ID, 6));

    expect(rows[0].verified).toBe(false);
    expect(rows[0].total_count).toBe(0);
    expect(rows[1].verified).toBe(true);
    expect(rows[1].total_count).toBe(2);
    const call = rpc().lastCall("club_members_list");
    expect(call?.arg("p_status")).toBe("active");
    expect(call?.keys()).toEqual(["p_club_id", "p_status", "p_limit"]);
  });
});
