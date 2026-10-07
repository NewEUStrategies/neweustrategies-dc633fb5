// Komentowanie WPROST ZE STRUMIENIA klubu - hooki warstwy danych.
//
// CO TU JEST WARTE TESTU (warstwa danych jest atrapą - jej kontrakt z RPC ma
// własne testy w `postsApi.test.ts` i `api.test.ts`):
//
//   1. KOLEJNOŚĆ CZYTANIA. RPC komentarzy oddaje strony NAJNOWSZE PIERWSZE,
//      a karta czyta się od góry. Hook ma oddać listę chronologiczną - także
//      po doczytaniu wcześniejszych, które lądują NAD dotychczasowymi.
//   2. KURSOR I KONIEC LISTY. Kursor to para (czas, id) z NAJSTARSZEGO
//      wiersza ostatniej strony; wpis z dokładnie trzema komentarzami nie
//      może pokazywać „Wczytaj wcześniejsze", które odda pustą stronę.
//   3. PODGLĄD NAJNOWSZYCH ODPOWIEDZI. `club_replies_list` zna tylko sort
//      rosnący i offset; licznik z listy wątków jest PODPOWIEDZIĄ offsetu,
//      a podgląd ma być poprawny także wtedy, gdy podpowiedź chybia.
//   4. SKUTEK ODPOWIEDZI Z KARTY. Ma odświeżyć podgląd i kartę wątku, ale NIE
//      przeładować list wątków - inaczej strumień przetasowuje karty pod
//      kursorem czytelnika. Licznik na liście poprawia się w miejscu.
//   5. SKUTEK KOMENTARZA. Ten sam wzorzec dla ściany: odświeżają się komentarze
//      TEGO wpisu, a `comment_count` w karcie zmienia się w miejscu - ściana
//      nie przeładowuje się (wypchnęłaby kartę spod pola komentarza).
//   6. NIC, CO CZYTELNIK JUŻ WIDZI, NIE ZNIKA: ani najstarszy doczytany
//      komentarz po odświeżeniu, ani cała lista po nieudanym doczytaniu.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider, type InfiniteData } from "@tanstack/react-query";

const { postsApiMock } = vi.hoisted(() => ({
  postsApiMock: {
    fetchClubPosts: vi.fn(),
    createClubPost: vi.fn(),
    deleteClubPost: vi.fn(),
    toggleClubPostLike: vi.fn(),
    signClubMediaUrls: vi.fn(),
    fetchClubPostComments: vi.fn(),
    createClubPostComment: vi.fn(),
    deleteClubPostComment: vi.fn(),
    moderateClubPostComment: vi.fn(),
  },
}));

vi.mock("@/lib/clubs/postsApi", () => postsApiMock);
vi.mock("@/lib/clubs/api", () => clubApiMock);

import { clubApiMock, resetClubApiMock } from "@/test/clubs/apiMock";
import { clubIsoOffset, clubThreadListRow } from "@/test/clubs/fixtures";
import { clubPostCommentRow, clubPostRow, clubReplyRow } from "@/test/clubs/hubFixtures";
import { clubKeys } from "@/lib/clubs/queryKeys";
import { feedReplyKeys, postCommentKeys } from "@/lib/clubs/clubInvalidations";
import type { ClubPostCommentRow } from "@/lib/clubs/postTypes";
import type {
  ClubPostCommentsCursor,
  ClubPostCommentsPage,
  ClubPostsPage,
} from "@/lib/clubs/postsApi";
import type { ClubRepliesPage, ClubThreadsPage } from "@/lib/clubs/api";
import type { ClubReplyRow } from "@/lib/clubs/types";
import {
  useClubPostComments,
  useCreateClubPostComment,
  useDeleteClubPostComment,
  useModerateClubPostComment,
} from "@/lib/clubs/useClubPosts";
import { useClubReplyPreview, useReplyFromFeed } from "@/lib/clubs/useClubThreadsData";

const CLUB = "club-1";
const POST = "post-1";
const THREAD = "thread-1";
const SLUG = "temat-pierwszy";

function harness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidated: unknown[] = [];
  const original = queryClient.invalidateQueries.bind(queryClient);
  queryClient.invalidateQueries = (filters?: { queryKey?: unknown }) => {
    invalidated.push(filters?.queryKey);
    return original(filters as Parameters<typeof original>[0]);
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper, invalidated };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  resetClubApiMock();
  for (const fn of Object.values(postsApiMock)) fn.mockReset();
});

// ---------------------------------------------------------------------------
// Atrapa serwera komentarzy: najnowsze pierwsze, kursor keyset (czas, id).
// ---------------------------------------------------------------------------

/** `count` komentarzy wpisu, `c1` najstarszy, co minutę kolejny. */
function commentsOnServer(count: number): ClubPostCommentRow[] {
  return Array.from({ length: count }, (_, index) =>
    clubPostCommentRow({
      id: `c${index + 1}`,
      body: `Komentarz ${index + 1}`,
      created_at: clubIsoOffset(index),
      total_count: count,
    }),
  );
}

function serveComments(all: readonly ClubPostCommentRow[]) {
  postsApiMock.fetchClubPostComments.mockImplementation(
    async (params: {
      postId: string;
      limit: number;
      before: ClubPostCommentsCursor | null;
    }): Promise<ClubPostCommentsPage> => {
      const newestFirst = [...all].sort(
        (a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
      );
      const before = params.before;
      const page = newestFirst
        .filter(
          (row) =>
            before === null ||
            row.created_at < before.createdAt ||
            (row.created_at === before.createdAt && row.id < before.id),
        )
        .slice(0, params.limit);
      return { rows: page, total: all.length };
    },
  );
}

describe("useClubPostComments - kolejność i doczytywanie", () => {
  it("bez wpisu, bez klubu albo wyłączony NIE pyta bazy", async () => {
    const { wrapper } = harness();
    serveComments(commentsOnServer(2));

    renderHook(() => useClubPostComments({ clubId: CLUB, postId: undefined }), { wrapper });
    renderHook(() => useClubPostComments({ clubId: undefined, postId: POST }), { wrapper });
    const off = renderHook(
      () => useClubPostComments({ clubId: CLUB, postId: POST, enabled: false }),
      { wrapper },
    );

    await tick();
    expect(postsApiMock.fetchClubPostComments).not.toHaveBeenCalled();
    // Wyłączone zapytanie nie udaje ładowania - karta nie pokazuje szkieletu.
    expect(off.result.current.isLoading).toBe(false);
    expect(off.result.current.comments).toEqual([]);
  });

  it("pierwsza strona: trzy NAJNOWSZE, ułożone chronologicznie (najnowszy na dole)", async () => {
    const { wrapper } = harness();
    serveComments(commentsOnServer(7));

    const { result } = renderHook(() => useClubPostComments({ clubId: CLUB, postId: POST }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.comments).toHaveLength(3));
    expect(result.current.comments.map((c) => c.id)).toEqual(["c5", "c6", "c7"]);
    expect(result.current.total).toBe(7);
    expect(result.current.olderCount).toBe(4);
    expect(result.current.hasOlder).toBe(true);
    expect(postsApiMock.fetchClubPostComments).toHaveBeenCalledWith({
      postId: POST,
      limit: 3,
      before: null,
    });
  });

  it("„wcześniejsze” lądują NAD dotychczasowymi, kursor to najstarszy wiersz strony", async () => {
    const { wrapper } = harness();
    serveComments(commentsOnServer(7));
    const { result } = renderHook(() => useClubPostComments({ clubId: CLUB, postId: POST }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.comments).toHaveLength(3));

    act(() => result.current.loadOlder());
    await waitFor(() => expect(result.current.comments).toHaveLength(6));

    expect(postsApiMock.fetchClubPostComments).toHaveBeenLastCalledWith({
      postId: POST,
      limit: 3,
      before: { createdAt: clubIsoOffset(4), id: "c5" },
    });
    expect(result.current.comments.map((c) => c.id)).toEqual(["c2", "c3", "c4", "c5", "c6", "c7"]);
    expect(result.current.olderCount).toBe(1);

    act(() => result.current.loadOlder());
    await waitFor(() => expect(result.current.comments).toHaveLength(7));
    expect(result.current.comments[0].id).toBe("c1");
    expect(result.current.hasOlder).toBe(false);
    expect(result.current.olderCount).toBe(0);
  });

  it("DOKŁADNIE pełna strona i nic więcej: brak „wcześniejszych” (bez pustego żądania)", async () => {
    const { wrapper } = harness();
    serveComments(commentsOnServer(3));
    const { result } = renderHook(() => useClubPostComments({ clubId: CLUB, postId: POST }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.comments).toHaveLength(3));
    expect(result.current.hasOlder).toBe(false);
    act(() => result.current.loadOlder());
    await tick();
    expect(postsApiMock.fetchClubPostComments).toHaveBeenCalledTimes(1);
  });

  it("niepełna strona kończy listę", async () => {
    const { wrapper } = harness();
    serveComments(commentsOnServer(2));
    const { result } = renderHook(() => useClubPostComments({ clubId: CLUB, postId: POST }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.comments).toHaveLength(2));
    expect(result.current.hasOlder).toBe(false);
    expect(result.current.total).toBe(2);
  });

  it("podwójne kliknięcie „wcześniejszych” w trakcie doczytywania to JEDNO żądanie", async () => {
    const { wrapper } = harness();
    serveComments(commentsOnServer(9));
    const { result } = renderHook(() => useClubPostComments({ clubId: CLUB, postId: POST }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.comments).toHaveLength(3));

    // Starsza strona wisi, dopóki test jej nie zwolni - drugie kliknięcie
    // trafia DOKŁADNIE w okno doczytywania.
    let release: (page: ClubPostCommentsPage) => void = () => {};
    postsApiMock.fetchClubPostComments.mockImplementationOnce(
      () =>
        new Promise<ClubPostCommentsPage>((resolve) => {
          release = resolve;
        }),
    );
    act(() => result.current.loadOlder());
    await waitFor(() => expect(result.current.isLoadingOlder).toBe(true));
    act(() => result.current.loadOlder());
    await tick();
    expect(postsApiMock.fetchClubPostComments).toHaveBeenCalledTimes(2);

    const older = commentsOnServer(9).slice(3, 6).reverse();
    await act(async () => release({ rows: older, total: 9 }));
    await waitFor(() => expect(result.current.comments).toHaveLength(6));
    expect(postsApiMock.fetchClubPostComments).toHaveBeenCalledTimes(2);
  });

  it("rozmiar strony jest częścią klucza - dwa widoki, dwa wpisy cache", async () => {
    const { wrapper, queryClient } = harness();
    serveComments(commentsOnServer(7));

    const three = renderHook(() => useClubPostComments({ clubId: CLUB, postId: POST }), {
      wrapper,
    });
    const five = renderHook(
      () => useClubPostComments({ clubId: CLUB, postId: POST, pageSize: 5 }),
      { wrapper },
    );

    await waitFor(() => expect(three.result.current.comments).toHaveLength(3));
    await waitFor(() => expect(five.result.current.comments).toHaveLength(5));
    expect(queryClient.getQueryData(clubKeys.postCommentsPage(CLUB, POST, 3))).toBeDefined();
    expect(queryClient.getQueryData(clubKeys.postCommentsPage(CLUB, POST, 5))).toBeDefined();
  });

  it("błąd odczytu jest widoczny, nie udaje pustej rozmowy", async () => {
    const { wrapper } = harness();
    postsApiMock.fetchClubPostComments.mockRejectedValue(new Error("permission denied"));
    const { result } = renderHook(() => useClubPostComments({ clubId: CLUB, postId: POST }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("permission denied");
    expect(result.current.comments).toEqual([]);
  });
});

describe("useClubPostComments - odświeżenie i błędy nie zabierają tego, co widać", () => {
  const ids = (rows: readonly ClubPostCommentRow[]) => rows.map((row) => row.id);

  /** Nowy komentarz dopisany „na serwerze” przez mutację, jak RPC. */
  function addOnCreate(server: ClubPostCommentRow[], id: string, minute: number) {
    postsApiMock.createClubPostComment.mockImplementation(async () => {
      server.push(clubPostCommentRow({ id, created_at: clubIsoOffset(minute) }));
      return { id, queued: false };
    });
  }

  it("lista rozwinięta do końca: nowy komentarz NIE wypycha najstarszego doczytanego", async () => {
    // Odświeżenie listy nieskończonej pobiera tyle samo stron od nowej
    // pierwszej - bez granicy c1 spadałby z dołu łańcucha i nad listą wracało
    // „Wczytaj wcześniejsze (1)”.
    const { wrapper } = harness();
    const server = commentsOnServer(6);
    serveComments(server);
    const list = renderHook(() => useClubPostComments({ clubId: CLUB, postId: POST }), {
      wrapper,
    });
    await waitFor(() => expect(list.result.current.comments).toHaveLength(3));
    act(() => list.result.current.loadOlder());
    await waitFor(() => expect(list.result.current.comments).toHaveLength(6));
    expect(list.result.current.hasOlder).toBe(false);

    addOnCreate(server, "c7", 6);
    const create = renderHook(() => useCreateClubPostComment(CLUB), { wrapper });
    await act(() => create.result.current.mutateAsync({ postId: POST, body: "Siódmy" }));

    await waitFor(() =>
      expect(ids(list.result.current.comments)).toEqual(["c1", "c2", "c3", "c4", "c5", "c6", "c7"]),
    );
    expect(list.result.current.hasOlder).toBe(false);
    expect(list.result.current.olderCount).toBe(0);
  });

  it("sama pierwsza strona to okno najnowszych - przesuwa się bez doczytywania", async () => {
    // Doczytanie całej strony po każdym komentarzu powiększałoby kartę o trzy
    // wiersze, o które nikt nie prosił.
    const { wrapper } = harness();
    const server = commentsOnServer(7);
    serveComments(server);
    const list = renderHook(() => useClubPostComments({ clubId: CLUB, postId: POST }), {
      wrapper,
    });
    await waitFor(() => expect(list.result.current.comments).toHaveLength(3));

    addOnCreate(server, "c8", 7);
    const create = renderHook(() => useCreateClubPostComment(CLUB), { wrapper });
    await act(() => create.result.current.mutateAsync({ postId: POST, body: "Ósmy" }));

    await waitFor(() => expect(ids(list.result.current.comments)).toEqual(["c6", "c7", "c8"]));
    await tick();
    expect(postsApiMock.fetchClubPostComments).toHaveBeenCalledTimes(2);
    expect(list.result.current.olderCount).toBe(5);
  });

  it("komentarz dopisany MIĘDZY stronami nie daje „Wczytaj wcześniejsze (0)” z pustą stroną", async () => {
    const { wrapper } = harness();
    const server = commentsOnServer(6);
    serveComments(server);
    const { result } = renderHook(() => useClubPostComments({ clubId: CLUB, postId: POST }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.comments).toHaveLength(3));

    // Serwer liczy już siedem, ale nowy jest NOWSZY od całego łańcucha kursorów.
    server.push(clubPostCommentRow({ id: "c7", created_at: clubIsoOffset(6) }));
    act(() => result.current.loadOlder());
    await waitFor(() => expect(result.current.comments).toHaveLength(6));

    expect(result.current.hasOlder).toBe(false);
    expect(result.current.olderCount).toBe(0);
    act(() => result.current.loadOlder());
    await tick();
    expect(postsApiMock.fetchClubPostComments).toHaveBeenCalledTimes(2);
  });

  it("nieudane „wcześniejsze” zostawiają listę; błąd dotyczy tylko doczytania i da się ponowić", async () => {
    const { wrapper } = harness();
    serveComments(commentsOnServer(7));
    const { result } = renderHook(() => useClubPostComments({ clubId: CLUB, postId: POST }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.comments).toHaveLength(3));

    postsApiMock.fetchClubPostComments.mockRejectedValueOnce(new Error("network down"));
    act(() => result.current.loadOlder());
    await waitFor(() => expect(result.current.olderError).toBe(true));

    expect(result.current.isError).toBe(false);
    expect(ids(result.current.comments)).toEqual(["c5", "c6", "c7"]);
    // „Wczytaj wcześniejsze” zostaje - to ono jest ponowieniem.
    expect(result.current.hasOlder).toBe(true);

    act(() => result.current.retryOlder());
    await waitFor(() => expect(result.current.comments).toHaveLength(6));
    expect(result.current.olderError).toBe(false);
    expect(result.current.isError).toBe(false);
  });

  it("nieudane odświeżenie w tle też nie kasuje pokazanych komentarzy", async () => {
    const { wrapper, queryClient } = harness();
    serveComments(commentsOnServer(2));
    const { result } = renderHook(() => useClubPostComments({ clubId: CLUB, postId: POST }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.comments).toHaveLength(2));

    postsApiMock.fetchClubPostComments.mockRejectedValue(new Error("network down"));
    await act(() => queryClient.invalidateQueries({ queryKey: clubKeys.postComments(CLUB, POST) }));
    await waitFor(() => expect(result.current.query.isRefetchError).toBe(true));

    expect(result.current.isError).toBe(false);
    expect(result.current.olderError).toBe(false);
    expect(ids(result.current.comments)).toEqual(["c1", "c2"]);
  });
});

describe("useCreateClubPostComment / useDeleteClubPostComment", () => {
  it("dodanie przekazuje wpis, treść i migawkę; wynik wraca do widoku", async () => {
    const { wrapper } = harness();
    postsApiMock.createClubPostComment.mockResolvedValue({ id: "c9", queued: true });
    const { result } = renderHook(() => useCreateClubPostComment(CLUB), { wrapper });

    const snapshot = {
      url: "https://energia.example",
      title: null,
      description: null,
      image: null,
      siteName: null,
    };
    const outcome = await result.current.mutateAsync({
      postId: POST,
      body: "Dobra uwaga",
      linkPreview: snapshot,
    });

    expect(outcome).toEqual({ id: "c9", queued: true });
    expect(postsApiMock.createClubPostComment).toHaveBeenCalledWith({
      postId: POST,
      body: "Dobra uwaga",
      linkPreview: snapshot,
    });
  });

  it("dodanie unieważnia WYŁĄCZNIE komentarze tego wpisu - nie ścianę", async () => {
    const { wrapper, invalidated } = harness();
    postsApiMock.createClubPostComment.mockResolvedValue({ id: "c9", queued: false });
    const { result } = renderHook(() => useCreateClubPostComment(CLUB), { wrapper });

    await result.current.mutateAsync({ postId: POST, body: "x" });

    expect(invalidated).toEqual([...postCommentKeys(CLUB, POST)]);
    expect(invalidated).toEqual([clubKeys.postComments(CLUB, POST)]);
    expect(invalidated).not.toContainEqual(clubKeys.postsAll(CLUB));
  });

  it("po dodaniu rozwinięta lista komentarzy pyta bazę ponownie", async () => {
    const { wrapper } = harness();
    const server = commentsOnServer(2);
    serveComments(server);
    const list = renderHook(() => useClubPostComments({ clubId: CLUB, postId: POST }), {
      wrapper,
    });
    await waitFor(() => expect(list.result.current.comments).toHaveLength(2));

    postsApiMock.createClubPostComment.mockImplementation(async () => {
      server.push(clubPostCommentRow({ id: "c3", created_at: clubIsoOffset(5) }));
      return { id: "c3", queued: false };
    });
    const create = renderHook(() => useCreateClubPostComment(CLUB), { wrapper });
    await create.result.current.mutateAsync({ postId: POST, body: "Trzeci" });

    await waitFor(() =>
      expect(list.result.current.comments.map((c) => c.id)).toEqual(["c1", "c2", "c3"]),
    );
  });

  it("usunięcie idzie po SAMYM identyfikatorze komentarza i ma ten sam skutek", async () => {
    const { wrapper, invalidated } = harness();
    postsApiMock.deleteClubPostComment.mockResolvedValue(true);
    const { result } = renderHook(() => useDeleteClubPostComment(CLUB), { wrapper });

    await expect(
      result.current.mutateAsync({ postId: POST, commentId: "c2", status: "visible" }),
    ).resolves.toBe(true);

    expect(postsApiMock.deleteClubPostComment).toHaveBeenCalledWith("c2");
    expect(invalidated).toEqual([...postCommentKeys(CLUB, POST)]);
  });

  it("odmowa bazy nie unieważnia niczego", async () => {
    const { wrapper, invalidated } = harness();
    postsApiMock.createClubPostComment.mockRejectedValue(new Error("clubs: comment burst limit"));
    const { result } = renderHook(() => useCreateClubPostComment(CLUB), { wrapper });

    await expect(result.current.mutateAsync({ postId: POST, body: "x" })).rejects.toThrow(
      "clubs: comment burst limit",
    );
    expect(invalidated).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Licznik komentarzy w karcie ściany - w miejscu, bez przeładowania ściany
// ---------------------------------------------------------------------------

type PostsData = InfiniteData<ClubPostsPage>;

const WALL = clubKeys.posts(CLUB, null, null);
const THREAD_WALL = clubKeys.posts(CLUB, null, THREAD);

function seedWall(queryClient: QueryClient, key: readonly unknown[] = WALL): PostsData {
  const data: PostsData = {
    pages: [
      {
        rows: [
          clubPostRow({ id: POST, comment_count: 2 }),
          clubPostRow({ id: "post-2", comment_count: 5 }),
        ],
        total: 3,
      },
      { rows: [clubPostRow({ id: "post-3", comment_count: 1 })], total: 3 },
    ],
    pageParams: [null, clubIsoOffset(1)],
  };
  queryClient.setQueryData(key, data);
  return data;
}

function countOf(queryClient: QueryClient, postId: string, key: readonly unknown[] = WALL) {
  const data = queryClient.getQueryData<PostsData>(key);
  return data?.pages.flatMap((page) => page.rows).find((row) => row.id === postId)?.comment_count;
}

describe("komentarz a licznik w karcie ściany", () => {
  it("widoczny komentarz: +1 na KAŻDYM wariancie ściany, bez unieważnienia ściany", async () => {
    const { wrapper, queryClient, invalidated } = harness();
    const before = seedWall(queryClient);
    seedWall(queryClient, THREAD_WALL);
    postsApiMock.createClubPostComment.mockResolvedValue({ id: "c9", queued: false });
    const { result } = renderHook(() => useCreateClubPostComment(CLUB), { wrapper });

    await result.current.mutateAsync({ postId: POST, body: "x" });

    expect(countOf(queryClient, POST)).toBe(3);
    expect(countOf(queryClient, POST, THREAD_WALL)).toBe(3);
    expect(countOf(queryClient, "post-2")).toBe(5);
    const after = queryClient.getQueryData<PostsData>(WALL);
    // Strona bez tego wpisu zostaje TĄ SAMĄ referencją; kursory nietknięte.
    expect(after?.pages[1]).toBe(before.pages[1]);
    expect(after?.pageParams).toEqual(before.pageParams);
    expect(invalidated).not.toContainEqual(clubKeys.postsAll(CLUB));
    expect(invalidated).not.toContainEqual(WALL);
  });

  it("komentarz w kolejce premoderacji nie podbija licznika (liczy tylko widoczne)", async () => {
    const { wrapper, queryClient } = harness();
    const before = seedWall(queryClient);
    postsApiMock.createClubPostComment.mockResolvedValue({ id: "c9", queued: true });
    const { result } = renderHook(() => useCreateClubPostComment(CLUB), { wrapper });

    await result.current.mutateAsync({ postId: POST, body: "x" });

    expect(queryClient.getQueryData(WALL)).toBe(before);
  });

  it("ściana INNEGO klubu zostaje nietknięta", async () => {
    const { wrapper, queryClient } = harness();
    const foreign = seedWall(queryClient, clubKeys.posts("club-2", null, null));
    postsApiMock.createClubPostComment.mockResolvedValue({ id: "c9", queued: false });
    const { result } = renderHook(() => useCreateClubPostComment(CLUB), { wrapper });

    await result.current.mutateAsync({ postId: POST, body: "x" });

    expect(queryClient.getQueryData(clubKeys.posts("club-2", null, null))).toBe(foreign);
  });

  it("usunięcie WIDOCZNEGO: -1; usunięcie z kolejki albo już usuniętego: bez zmiany", async () => {
    const { wrapper, queryClient } = harness();
    seedWall(queryClient);
    postsApiMock.deleteClubPostComment.mockResolvedValue(true);
    const { result } = renderHook(() => useDeleteClubPostComment(CLUB), { wrapper });

    await result.current.mutateAsync({ postId: POST, commentId: "c1", status: "visible" });
    expect(countOf(queryClient, POST)).toBe(1);

    const afterVisible = queryClient.getQueryData(WALL);
    await result.current.mutateAsync({ postId: POST, commentId: "c2", status: "pending" });
    expect(queryClient.getQueryData(WALL)).toBe(afterVisible);

    // `false` = komentarza już nie było - licznika nie zgadujemy.
    postsApiMock.deleteClubPostComment.mockResolvedValue(false);
    await result.current.mutateAsync({ postId: POST, commentId: "c3", status: "visible" });
    expect(countOf(queryClient, POST)).toBe(1);
  });

  it("licznik nie schodzi poniżej zera", async () => {
    const { wrapper, queryClient } = harness();
    queryClient.setQueryData<PostsData>(WALL, {
      pages: [{ rows: [clubPostRow({ id: POST, comment_count: 0 })], total: 1 }],
      pageParams: [null],
    });
    postsApiMock.deleteClubPostComment.mockResolvedValue(true);
    const { result } = renderHook(() => useDeleteClubPostComment(CLUB), { wrapper });

    await result.current.mutateAsync({ postId: POST, commentId: "c1", status: "visible" });

    expect(countOf(queryClient, POST)).toBe(0);
  });
});

describe("useModerateClubPostComment - decyzja moderatora z karty", () => {
  it("zatwierdzenie z kolejki: RPC po samym id i akcji, licznik +1, odświeżone komentarze wpisu", async () => {
    const { wrapper, queryClient, invalidated } = harness();
    seedWall(queryClient);
    postsApiMock.moderateClubPostComment.mockResolvedValue(true);
    const { result } = renderHook(() => useModerateClubPostComment(CLUB), { wrapper });

    await expect(
      result.current.mutateAsync({
        postId: POST,
        commentId: "c5",
        action: "approve",
        status: "pending",
      }),
    ).resolves.toBe(true);

    expect(postsApiMock.moderateClubPostComment).toHaveBeenCalledWith({
      commentId: "c5",
      action: "approve",
    });
    expect(countOf(queryClient, POST)).toBe(3);
    expect(invalidated).toEqual([...postCommentKeys(CLUB, POST)]);
  });

  it("ukrycie widocznego: -1; ukrycie z kolejki: licznik bez zmian", async () => {
    const { wrapper, queryClient } = harness();
    seedWall(queryClient);
    postsApiMock.moderateClubPostComment.mockResolvedValue(true);
    const { result } = renderHook(() => useModerateClubPostComment(CLUB), { wrapper });

    await result.current.mutateAsync({
      postId: POST,
      commentId: "c1",
      action: "hide",
      status: "visible",
    });
    expect(countOf(queryClient, POST)).toBe(1);

    const afterHide = queryClient.getQueryData(WALL);
    await result.current.mutateAsync({
      postId: POST,
      commentId: "c2",
      action: "hide",
      status: "pending",
    });
    expect(queryClient.getQueryData(WALL)).toBe(afterHide);
  });

  it("`false` (komentarza już nie ma) nie rusza licznika, ale odświeża listę", async () => {
    const { wrapper, queryClient, invalidated } = harness();
    const before = seedWall(queryClient);
    postsApiMock.moderateClubPostComment.mockResolvedValue(false);
    const { result } = renderHook(() => useModerateClubPostComment(CLUB), { wrapper });

    await result.current.mutateAsync({
      postId: POST,
      commentId: "c5",
      action: "approve",
      status: "pending",
    });

    expect(queryClient.getQueryData(WALL)).toBe(before);
    expect(invalidated).toEqual([...postCommentKeys(CLUB, POST)]);
  });

  it("odmowa bazy (brak prawa moderacji) nie dotyka cache", async () => {
    const { wrapper, queryClient, invalidated } = harness();
    const before = seedWall(queryClient);
    postsApiMock.moderateClubPostComment.mockRejectedValue(new Error("clubs: forbidden"));
    const { result } = renderHook(() => useModerateClubPostComment(CLUB), { wrapper });

    await expect(
      result.current.mutateAsync({
        postId: POST,
        commentId: "c5",
        action: "approve",
        status: "pending",
      }),
    ).rejects.toThrow("clubs: forbidden");
    expect(invalidated).toEqual([]);
    expect(queryClient.getQueryData(WALL)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Podgląd najnowszych odpowiedzi wątku
// ---------------------------------------------------------------------------

/** `count` odpowiedzi wątku, `r1` najstarsza. */
function repliesOnServer(count: number): ClubReplyRow[] {
  return Array.from({ length: count }, (_, index) =>
    clubReplyRow({
      id: `r${index + 1}`,
      created_at: clubIsoOffset(index),
      total_count: count,
    }),
  );
}

/** Atrapa `fetchClubReplies`: offset i limit jak RPC; pusta strona nie niesie `total`. */
function serveReplies(all: readonly ClubReplyRow[]) {
  clubApiMock.fetchClubReplies.mockImplementation(
    async (params: { offset: number; limit: number }): Promise<ClubRepliesPage> => {
      const rows = all.slice(params.offset, params.offset + params.limit);
      return { rows, total: rows.length > 0 ? all.length : 0 };
    },
  );
}

function offsetsAsked(): number[] {
  return clubApiMock.fetchClubReplies.mock.calls.map(([params]) => params.offset);
}

describe("useClubReplyPreview - najnowsze odpowiedzi w karcie", () => {
  it("trafna podpowiedź licznika: JEDNO żądanie o dwie ostatnie", async () => {
    const { wrapper } = harness();
    serveReplies(repliesOnServer(5));
    const { result } = renderHook(() => useClubReplyPreview({ threadId: THREAD, replyCount: 5 }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.rows.map((r) => r.id)).toEqual(["r4", "r5"]);
    expect(result.current.data?.total).toBe(5);
    expect(clubApiMock.fetchClubReplies).toHaveBeenCalledTimes(1);
    expect(clubApiMock.fetchClubReplies).toHaveBeenCalledWith({
      threadId: THREAD,
      sort: "chronological",
      limit: 2,
      offset: 3,
    });
  });

  it("nieświeży licznik (za MAŁY) - drugie żądanie o właściwy koniec listy", async () => {
    // Własna odpowiedź z karty nie przeładowuje listy wątków, więc licznik
    // listy zostaje o jeden w tyle - podgląd i tak ma pokazać tę odpowiedź.
    const { wrapper } = harness();
    serveReplies(repliesOnServer(4));
    const { result } = renderHook(() => useClubReplyPreview({ threadId: THREAD, replyCount: 3 }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(offsetsAsked()).toEqual([1, 2]);
    expect(result.current.data?.rows.map((r) => r.id)).toEqual(["r3", "r4"]);
  });

  it("licznik ZA DUŻY (moderacja ukryła odpowiedzi) - wraca od początku po `total`", async () => {
    const { wrapper } = harness();
    serveReplies(repliesOnServer(3));
    const { result } = renderHook(() => useClubReplyPreview({ threadId: THREAD, replyCount: 10 }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(offsetsAsked()).toEqual([8, 0, 1]);
    expect(result.current.data?.rows.map((r) => r.id)).toEqual(["r2", "r3"]);
  });

  it("mniej odpowiedzi niż limit: offset zero, jedno żądanie", async () => {
    const { wrapper } = harness();
    serveReplies(repliesOnServer(1));
    const { result } = renderHook(() => useClubReplyPreview({ threadId: THREAD, replyCount: 1 }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(offsetsAsked()).toEqual([0]);
    expect(result.current.data?.rows.map((r) => r.id)).toEqual(["r1"]);
  });

  it("pusty wątek: pusty podgląd bez dodatkowych żądań", async () => {
    const { wrapper } = harness();
    serveReplies([]);
    const { result } = renderHook(() => useClubReplyPreview({ threadId: THREAD, replyCount: 0 }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(offsetsAsked()).toEqual([0]);
    expect(result.current.data).toEqual({ rows: [], total: 0 });
  });

  it("podgląd czyta się po CZASIE, a ukryte i usunięte odpadają", async () => {
    // Sort chronologiczny wynosi rozstrzygnięcie na górę, więc koniec listy
    // nie zawsze idzie po czasie.
    const { wrapper } = harness();
    clubApiMock.fetchClubReplies.mockResolvedValue({
      rows: [
        clubReplyRow({ id: "late", created_at: clubIsoOffset(9) }),
        clubReplyRow({ id: "early", created_at: clubIsoOffset(1), status: "pending" }),
        clubReplyRow({ id: "gone", created_at: clubIsoOffset(5), status: "deleted" }),
      ],
      total: 5,
    });
    const { result } = renderHook(
      () => useClubReplyPreview({ threadId: THREAD, replyCount: 5, limit: 3 }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.rows.map((r) => r.id)).toEqual(["early", "late"]);
  });

  it("moderator: ukryte i usunięte na końcu nie dają pustego podglądu - cofamy się po żywe", async () => {
    // Moderator dostaje z RPC także ukryte i usunięte, a `total` je liczy -
    // ostatnie dwa wiersze mogą nie mieć ani jednej żywej odpowiedzi.
    const { wrapper } = harness();
    const all = repliesOnServer(7).map((row, index) =>
      index === 5
        ? { ...row, status: "hidden" }
        : index === 6
          ? { ...row, status: "deleted" }
          : row,
    );
    serveReplies(all);
    const { result } = renderHook(() => useClubReplyPreview({ threadId: THREAD, replyCount: 5 }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.rows.map((r) => r.id)).toEqual(["r4", "r5"]);
    expect(result.current.data?.total).toBe(7);
    // Podpowiedź (3), właściwy koniec (5), jedno okno wstecz od początku.
    expect(offsetsAsked()).toEqual([3, 5, 0]);
  });

  it("dwie najnowsze ukryte: podgląd pokazuje dwie wcześniejsze żywe, `total` z serwera", async () => {
    const { wrapper } = harness();
    const all = repliesOnServer(5).map((row, index) =>
      index >= 3 ? { ...row, status: "hidden" } : row,
    );
    serveReplies(all);
    const { result } = renderHook(() => useClubReplyPreview({ threadId: THREAD, replyCount: 3 }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.rows.map((r) => r.id)).toEqual(["r2", "r3"]);
    expect(result.current.data?.total).toBe(5);
  });

  it("same ukryte: cofanie kończy się na początku listy, podgląd pusty", async () => {
    const { wrapper } = harness();
    serveReplies(repliesOnServer(40).map((row) => ({ ...row, status: "hidden" })));
    const { result } = renderHook(() => useClubReplyPreview({ threadId: THREAD, replyCount: 40 }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ rows: [], total: 40 });
    // Okna rosną: 8 wierszy wstecz, potem reszta do początku.
    expect(offsetsAsked()).toEqual([38, 30, 0]);
  });

  it("cofanie ma limit kroków - ogromny ukryty ogon nie zasypuje bazy żądaniami", async () => {
    const { wrapper } = harness();
    serveReplies(repliesOnServer(2000).map((row) => ({ ...row, status: "deleted" })));
    const { result } = renderHook(
      () => useClubReplyPreview({ threadId: THREAD, replyCount: 2000 }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(offsetsAsked()).toEqual([1998, 1990, 1958, 1830, 1330]);
    expect(result.current.data?.rows).toEqual([]);
  });

  it("okna, które się zazębiły (nowa odpowiedź między żądaniami), nie dublują wiersza", async () => {
    const { wrapper } = harness();
    // Atrapa oddaje te same wiersze na każde pytanie - najgorszy przypadek zazębienia.
    clubApiMock.fetchClubReplies.mockResolvedValue({
      rows: [
        clubReplyRow({ id: "a", created_at: clubIsoOffset(1) }),
        clubReplyRow({ id: "x", created_at: clubIsoOffset(2), status: "hidden" }),
      ],
      total: 6,
    });
    const { result } = renderHook(() => useClubReplyPreview({ threadId: THREAD, replyCount: 6 }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.rows.map((r) => r.id)).toEqual(["a"]);
  });

  it("bez wątku albo wyłączony NIE pyta bazy", async () => {
    const { wrapper } = harness();
    renderHook(() => useClubReplyPreview({ threadId: undefined, replyCount: 4 }), { wrapper });
    renderHook(() => useClubReplyPreview({ threadId: THREAD, replyCount: 4, enabled: false }), {
      wrapper,
    });

    await tick();
    expect(clubApiMock.fetchClubReplies).not.toHaveBeenCalled();
  });

  it("wpis cache jest pod `replyPreview`, a NIE pod kluczem strony wątku", async () => {
    const { wrapper, queryClient } = harness();
    serveReplies(repliesOnServer(3));
    const { result } = renderHook(() => useClubReplyPreview({ threadId: THREAD, replyCount: 3 }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(clubKeys.replyPreview(THREAD, 2))).toBeDefined();
    expect(queryClient.getQueryData(clubKeys.replies(THREAD, "chronological"))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Odpowiedź w wątku z karty strumienia
// ---------------------------------------------------------------------------

type ThreadsData = InfiniteData<ClubThreadsPage>;

function seedThreads(queryClient: QueryClient): ThreadsData {
  const data: ThreadsData = {
    pages: [
      {
        rows: [
          clubThreadListRow({ id: THREAD, slug: SLUG, reply_count: 4 }),
          clubThreadListRow({ id: "thread-2", slug: "drugi", reply_count: 9 }),
        ],
        nextCursor: "c",
      },
      {
        rows: [clubThreadListRow({ id: "thread-3", slug: "trzeci", reply_count: 1 })],
        nextCursor: null,
      },
    ],
    pageParams: [null, "c"],
  };
  queryClient.setQueryData(clubKeys.threads(CLUB, null, "hot", null), data);
  return data;
}

describe("useReplyFromFeed - odpowiedź z karty", () => {
  it("odpowiedź GŁÓWNA, bez anonimowości, z przyciętą treścią", async () => {
    const { wrapper } = harness();
    clubApiMock.replyToClubThread.mockResolvedValue({ id: "r9", queued: false });
    const { result } = renderHook(() => useReplyFromFeed(CLUB), { wrapper });

    const outcome = await result.current.mutateAsync({
      threadId: THREAD,
      threadSlug: SLUG,
      body: "  Zgoda.\n",
    });

    expect(outcome).toEqual({ id: "r9", queued: false });
    expect(clubApiMock.replyToClubThread).toHaveBeenCalledWith({
      threadId: THREAD,
      body: "Zgoda.",
      parentId: null,
      anonymous: false,
    });
  });

  it("unieważnia WYŁĄCZNIE odpowiedzi wątku i jego kartę - nie poddrzewo klubu", async () => {
    const { wrapper, invalidated } = harness();
    clubApiMock.replyToClubThread.mockResolvedValue({ id: "r9", queued: false });
    const { result } = renderHook(() => useReplyFromFeed(CLUB), { wrapper });

    await result.current.mutateAsync({ threadId: THREAD, threadSlug: SLUG, body: "x" });

    expect(invalidated).toEqual([...feedReplyKeys(CLUB, SLUG, THREAD)]);
    expect(invalidated).not.toContainEqual(clubKeys.club(CLUB));
  });

  it("licznik na listach wątków +1 w miejscu, bez zmiany kolejności i `last_reply_at`", async () => {
    const { wrapper, queryClient } = harness();
    const before = seedThreads(queryClient);
    clubApiMock.replyToClubThread.mockResolvedValue({ id: "r9", queued: false });
    const { result } = renderHook(() => useReplyFromFeed(CLUB), { wrapper });

    await result.current.mutateAsync({ threadId: THREAD, threadSlug: SLUG, body: "x" });

    const after = queryClient.getQueryData<ThreadsData>(clubKeys.threads(CLUB, null, "hot", null));
    expect(after?.pages[0].rows.map((r) => [r.id, r.reply_count])).toEqual([
      [THREAD, 5],
      ["thread-2", 9],
    ]);
    expect(after?.pages[0].rows[0].last_reply_at).toBe(before.pages[0].rows[0].last_reply_at);
    // Strona bez tego wątku zostaje TĄ SAMĄ referencją - bez zbędnego renderu.
    expect(after?.pages[1]).toBe(before.pages[1]);
    expect(after?.pageParams).toEqual([null, "c"]);
  });

  it("odpowiedź w kolejce premoderacji NIE podbija licznika", async () => {
    const { wrapper, queryClient } = harness();
    const before = seedThreads(queryClient);
    clubApiMock.replyToClubThread.mockResolvedValue({ id: "r9", queued: true });
    const { result } = renderHook(() => useReplyFromFeed(CLUB), { wrapper });

    await result.current.mutateAsync({ threadId: THREAD, threadSlug: SLUG, body: "x" });

    expect(queryClient.getQueryData(clubKeys.threads(CLUB, null, "hot", null))).toBe(before);
  });

  it("listy wątków INNEGO klubu zostają nietknięte", async () => {
    const { wrapper, queryClient } = harness();
    const foreign: ThreadsData = {
      pages: [{ rows: [clubThreadListRow({ id: THREAD, reply_count: 4 })], nextCursor: null }],
      pageParams: [null],
    };
    queryClient.setQueryData(clubKeys.threads("club-2", null, "hot", null), foreign);
    clubApiMock.replyToClubThread.mockResolvedValue({ id: "r9", queued: false });
    const { result } = renderHook(() => useReplyFromFeed(CLUB), { wrapper });

    await result.current.mutateAsync({ threadId: THREAD, threadSlug: SLUG, body: "x" });

    expect(queryClient.getQueryData(clubKeys.threads("club-2", null, "hot", null))).toBe(foreign);
  });

  it("po odpowiedzi podgląd w karcie pyta bazę ponownie", async () => {
    const { wrapper } = harness();
    const server = repliesOnServer(2);
    serveReplies(server);
    const preview = renderHook(() => useClubReplyPreview({ threadId: THREAD, replyCount: 2 }), {
      wrapper,
    });
    await waitFor(() => expect(preview.result.current.data?.rows).toHaveLength(2));

    clubApiMock.replyToClubThread.mockImplementation(async () => {
      server.push(clubReplyRow({ id: "r3", created_at: clubIsoOffset(5) }));
      return { id: "r3", queued: false };
    });
    const reply = renderHook(() => useReplyFromFeed(CLUB), { wrapper });
    await reply.result.current.mutateAsync({ threadId: THREAD, threadSlug: SLUG, body: "Trzecia" });

    await waitFor(() =>
      expect(preview.result.current.data?.rows.map((r) => r.id)).toEqual(["r2", "r3"]),
    );
  });

  it("odmowa bazy nie dotyka cache", async () => {
    const { wrapper, queryClient, invalidated } = harness();
    const before = seedThreads(queryClient);
    clubApiMock.replyToClubThread.mockRejectedValue(new Error("clubs: thread locked"));
    const { result } = renderHook(() => useReplyFromFeed(CLUB), { wrapper });

    await expect(
      result.current.mutateAsync({ threadId: THREAD, threadSlug: SLUG, body: "x" }),
    ).rejects.toThrow("clubs: thread locked");
    expect(invalidated).toEqual([]);
    expect(queryClient.getQueryData(clubKeys.threads(CLUB, null, "hot", null))).toBe(before);
  });
});
