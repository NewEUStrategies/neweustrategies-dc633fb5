// Komentarze - `src/lib/comments/api.ts`, 266 linii, większość funkcji bez
// ani jednego wywołania w suicie (`canEditComment`, `collectAuthorIds`,
// `fetchAuthorsById`, `fetchRepliesOf`, `fetchPostComments`).
//
// DLACZEGO TA GARSTKA FUNKCJI JEST WARTA OSOBNEGO PLIKU. To najmniejsza
// powierzchnia modułu 16 z realnym ryzykiem dla użytkownika, i to ryzykiem
// dwojakiego rodzaju:
//
//   1. `canEditComment` JEST REGUŁĄ WIDOCZNĄ DLA LUDZI - decyduje, komu
//      pokazać ołówek przy komentarzu i do kiedy. Reguła nie jest granicą
//      bezpieczeństwa (tą jest `comments_guard_update` w bazie), ale rozjazd
//      z nią daje przycisk, który zawsze kończy się błędem - a to gorzej niż
//      brak przycisku.
//
//   2. `fetchPostComments` składa DRZEWO z trzech zapytań i dwóch liczników
//      z RÓŻNYCH źródeł. Poprzednia wersja okienkowała płaską listę rodziców
//      i odpowiedzi razem, więc na granicy okna wątki „gubiły" odpowiedzi -
//      przy składaniu drzewa odpowiedź bez rodzica wypadała. Paginacja idzie
//      dziś po WĄTKACH i to jest gwarancja, którą trzeba przypiąć.
//
// Odczyt komentarzy jest ŁAŃCUCHOWY (`from("comments").select()...`), więc
// atrapa to `supabaseFromStub` ze wspólnego harnessu - w odróżnieniu od
// klubów, które są RPC-only.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "@/integrations/supabase/client",
  async () => (await import("@/test/comments/fixtures")).commentsSupabaseMock,
);

import {
  COMMENT_ID,
  POST_ID,
  USER_ID,
  authorRow,
  commentRow,
  commentsDb,
  postRow,
  resetCommentsDb,
  setCommentsSession,
  withAuthor,
} from "@/test/comments/fixtures";
import { ok } from "@/test/supabase";
import {
  COMMENT_EDIT_WINDOW_MS,
  bulkModerateComments,
  canEditComment,
  createComment,
  editComment,
  fetchAdminComments,
  fetchPostComments,
  moderateComment,
  softDeleteComment,
} from "@/lib/comments/api";

beforeEach(() => resetCommentsDb());

// ---------------------------------------------------------------------------
// Okno edycji
// ---------------------------------------------------------------------------

describe("canEditComment - kto i do kiedy", () => {
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

  it("AUTOR w oknie edycji - wolno", () => {
    const comment = withAuthor(commentRow({ user_id: USER_ID.author, created_at: minutesAgo(5) }));

    expect(canEditComment(comment, USER_ID.author)).toBe(true);
  });

  it("AUTOR po oknie - nie wolno (baza i tak odrzuci)", () => {
    const comment = withAuthor(commentRow({ user_id: USER_ID.author, created_at: minutesAgo(16) }));

    expect(canEditComment(comment, USER_ID.author)).toBe(false);
  });

  it("granica okna: tuż przed 15 minutą wolno, tuż po - nie", () => {
    const justInside = withAuthor(
      commentRow({
        user_id: USER_ID.author,
        created_at: new Date(Date.now() - (COMMENT_EDIT_WINDOW_MS - 1_000)).toISOString(),
      }),
    );
    const justOutside = withAuthor(
      commentRow({
        user_id: USER_ID.author,
        created_at: new Date(Date.now() - (COMMENT_EDIT_WINDOW_MS + 1_000)).toISOString(),
      }),
    );

    expect(canEditComment(justInside, USER_ID.author)).toBe(true);
    expect(canEditComment(justOutside, USER_ID.author)).toBe(false);
  });

  it("okno lustrzane wobec guarda w bazie: 15 minut", () => {
    // Rozjazd tej stałej z `comments_guard_update` daje ołówek, który zawsze
    // kończy się błędem 'comments: edit window expired'.
    expect(COMMENT_EDIT_WINDOW_MS).toBe(15 * 60 * 1000);
  });

  it("komentarz USUNIĘTY nie jest edytowalny nawet dla autora w oknie", () => {
    const comment = withAuthor(
      commentRow({ user_id: USER_ID.author, created_at: minutesAgo(1), status: "deleted" }),
    );

    expect(canEditComment(comment, USER_ID.author)).toBe(false);
  });

  it("status oczekujący NIE blokuje edycji własnego komentarza", () => {
    const comment = withAuthor(
      commentRow({ user_id: USER_ID.author, created_at: minutesAgo(1), status: "pending" }),
    );

    // Komentarz w moderacji to nadal komentarz autora - poprawka literówki
    // przed zatwierdzeniem jest sensowna.
    expect(canEditComment(comment, USER_ID.author)).toBe(true);
  });

  it("OBCY użytkownik nie edytuje cudzego komentarza", () => {
    const comment = withAuthor(commentRow({ user_id: USER_ID.author, created_at: minutesAgo(1) }));

    expect(canEditComment(comment, USER_ID.stranger)).toBe(false);
  });

  it("MODERATOR też nie - jego drogą jest moderacja, nie edycja", () => {
    const comment = withAuthor(commentRow({ user_id: USER_ID.author, created_at: minutesAgo(1) }));

    // Ta funkcja odpowiada wyłącznie na pytanie „czy pokazać ołówek AUTOROWI".
    // Personel ma osobną ścieżkę (`moderateComment`), która zostawia ślad.
    expect(canEditComment(comment, USER_ID.moderator)).toBe(false);
  });

  it("GOŚĆ (wiersz z user_id NULL) nie ma czego edytować", () => {
    const guest = withAuthor(
      commentRow({ user_id: null, author_name: "Anonim", created_at: minutesAgo(1) }),
    );

    // Komentarz gościa nie ma właściciela w sensie konta, więc żadna tożsamość
    // nie pasuje - w tym `null`, którym jest sam gość.
    expect(canEditComment(guest, null)).toBe(false);
    expect(canEditComment(guest, USER_ID.author)).toBe(false);
  });

  it("NIEZALOGOWANY czytelnik nie edytuje niczego", () => {
    const comment = withAuthor(commentRow({ user_id: USER_ID.author, created_at: minutesAgo(1) }));

    expect(canEditComment(comment, null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Drzewo komentarzy
// ---------------------------------------------------------------------------

describe("fetchPostComments - paginacja po WĄTKACH", () => {
  it("pobiera trzy piętra: rodzice, odpowiedzi, odpowiedzi na odpowiedzi", async () => {
    const parent = commentRow({ id: "c-parent", parent_id: null });
    const child = commentRow({ id: "c-child", parent_id: "c-parent" });
    const grandchild = commentRow({ id: "c-grand", parent_id: "c-child" });
    commentsDb.setThreads([parent], [child], [grandchild]);

    const page = await fetchPostComments(POST_ID);

    expect(page.comments.map((c) => c.id)).toEqual(["c-parent", "c-child", "c-grand"]);
  });

  it("REGRESJA: odpowiedź NIGDY nie jest pobrana bez swojego rodzica", async () => {
    // Poprzednia wersja okienkowała PŁASKĄ listę rodziców i odpowiedzi razem,
    // więc na granicy okna wątek gubił odpowiedzi - przy składaniu drzewa
    // sierota wypadała bez śladu.
    const parents = Array.from({ length: 2 }, (_, i) =>
      commentRow({ id: `p${i}`, parent_id: null }),
    );
    const replies = parents.map((p) => commentRow({ id: `r-${p.id}`, parent_id: p.id }));
    commentsDb.setThreads(parents, replies, []);

    const page = await fetchPostComments(POST_ID, 2);

    const ids = new Set(page.comments.map((c) => c.id));
    for (const reply of page.comments.filter((c) => c.parent_id !== null)) {
      expect(ids.has(reply.parent_id as string), `sierota ${reply.id}`).toBe(true);
    }
  });

  it("zapytanie o rodziców zawęża po wpisie, statusie i BRAKU rodzica", async () => {
    commentsDb.setThreads([], [], []);

    await fetchPostComments(POST_ID);

    const chain = commentsDb.stub.chainsFor("comments")[0];
    expect(chain?.argsOf("eq")).toEqual(["post_id", POST_ID]);
    expect(chain?.argsOf("is")).toEqual(["parent_id", null]);
    expect(chain?.argsOf("in")).toEqual(["status", ["approved", "pending"]]);
  });

  it("rodzice są sortowani po czasie ORAZ po id - bez tiebreakera kolejność dryfuje", async () => {
    commentsDb.setThreads([], [], []);

    await fetchPostComments(POST_ID);

    const chain = commentsDb.stub.chainsFor("comments")[0];
    const orders = chain?.calls.filter((c) => c.method === "order").map((c) => c.args) ?? [];
    expect(orders).toEqual([
      ["created_at", { ascending: true }],
      ["id", { ascending: true }],
    ]);
  });

  it("limit wątków dojeżdża do zapytania (domyślnie 50)", async () => {
    commentsDb.setThreads([], [], []);

    await fetchPostComments(POST_ID);
    expect(commentsDb.stub.chainsFor("comments")[0]?.argsOf("limit")).toEqual([50]);

    commentsDb.stub.reset();
    commentsDb.setThreads([], [], []);
    await fetchPostComments(POST_ID, 10);
    expect(commentsDb.stub.chainsFor("comments")[0]?.argsOf("limit")).toEqual([10]);
  });

  it("BRAK odpowiedzi = brak zapytania o odpowiedzi (puste `.in()` to pełny skan)", async () => {
    commentsDb.setThreads([], [], []);

    await fetchPostComments(POST_ID);

    // Rodziców zero, więc drugie i trzecie piętro nie mają o co pytać.
    // Zapytanie `.in("parent_id", [])` byłoby rundą po pewne zero wierszy.
    const chains = commentsDb.stub.chainsFor("comments");
    expect(chains.filter((c) => c.has("in") && c.argsOf("in")?.[0] === "parent_id")).toHaveLength(
      0,
    );
  });

  it("puste drzewo oddaje zera i nie pyta o autorów", async () => {
    commentsDb.setThreads([], [], []);

    const page = await fetchPostComments(POST_ID);

    expect(page).toEqual({ comments: [], topLevelCount: 0, approvedCount: 0 });
    expect(commentsDb.stub.chainsFor("profiles")).toHaveLength(0);
  });

  it("DWA LICZNIKI z RÓŻNYCH źródeł: wątki z `count`, zatwierdzone z osobnego zapytania", async () => {
    const parent = commentRow({ id: "p1", parent_id: null });
    commentsDb.setThreads([parent], [], [], { topLevelCount: 120, approvedCount: 315 });

    const page = await fetchPostComments(POST_ID);

    // `topLevelCount` steruje przyciskiem „pokaż więcej" (liczy WĄTKI),
    // a `approvedCount` to uczciwa liczba w nagłówku (liczy WSZYSTKIE
    // zatwierdzone, także spoza okna). Zlanie ich w jedną liczbę dałoby albo
    // martwy przycisk, albo kłamliwy nagłówek.
    expect(page.topLevelCount).toBe(120);
    expect(page.approvedCount).toBe(315);
  });

  it("licznik zatwierdzonych czyta się zapytaniem LICZĄCYM, bez pobierania wierszy", async () => {
    commentsDb.setThreads([commentRow({ id: "p1" })], [], []);

    await fetchPostComments(POST_ID);

    const counting = commentsDb.stub
      .chainsFor("comments")
      .find((c) => c.argsOf("eq")?.[0] === "status" || c.argsOf("select")?.[0] === "id");
    expect(counting?.argsOf("select")?.[1]).toEqual({ count: "exact", head: true });
  });

  it("brak `count` z bazy schodzi na liczbę pobranych rodziców, nie na NaN", async () => {
    const parent = commentRow({ id: "p1", parent_id: null });
    commentsDb.setThreads([parent], [], [], { topLevelCount: null, approvedCount: null });

    const page = await fetchPostComments(POST_ID);

    expect(page.topLevelCount).toBe(1);
    expect(page.approvedCount).toBe(0);
  });

  it("autorzy są dociągani JEDNYM zapytaniem dla całego drzewa", async () => {
    const parent = commentRow({ id: "p1", user_id: USER_ID.author });
    const child = commentRow({ id: "c1", parent_id: "p1", user_id: USER_ID.stranger });
    commentsDb.setThreads([parent], [child], []);
    commentsDb.setAuthors([
      authorRow({ id: USER_ID.author, display_name: "Anna" }),
      authorRow({ id: USER_ID.stranger, display_name: "Piotr" }),
    ]);

    const page = await fetchPostComments(POST_ID);

    expect(commentsDb.stub.chainsFor("profiles")).toHaveLength(1);
    expect(page.comments.map((c) => c.author?.display_name)).toEqual(["Anna", "Piotr"]);
  });

  it("identyfikatory autorów są DEDUPLIKOWANE", async () => {
    const a = commentRow({ id: "p1", user_id: USER_ID.author });
    const b = commentRow({ id: "p2", user_id: USER_ID.author });
    commentsDb.setThreads([a, b], [], []);
    commentsDb.setAuthors([authorRow({ id: USER_ID.author })]);

    await fetchPostComments(POST_ID);

    expect(commentsDb.stub.chainsFor("profiles")[0]?.argsOf("in")).toEqual([
      "id",
      [USER_ID.author],
    ]);
  });

  it("wiersz GOŚCIA nie trafia do zapytania o profile i ma autora null", async () => {
    const guest = commentRow({ id: "g1", user_id: null, author_name: "Anonim" });
    const member = commentRow({ id: "m1", user_id: USER_ID.author });
    commentsDb.setThreads([guest, member], [], []);
    commentsDb.setAuthors([authorRow({ id: USER_ID.author })]);

    const page = await fetchPostComments(POST_ID);

    // `user_id` NULL nie jest identyfikatorem profilu - wysłanie go w `.in()`
    // byłoby zapytaniem o profil, którego nie ma.
    expect(commentsDb.stub.chainsFor("profiles")[0]?.argsOf("in")).toEqual([
      "id",
      [USER_ID.author],
    ]);
    expect(page.comments.find((c) => c.id === "g1")?.author).toBeNull();
  });

  it("autor bez wiersza profilu daje null, a nie pustą kartę", async () => {
    commentsDb.setThreads([commentRow({ id: "p1", user_id: USER_ID.author })], [], []);
    commentsDb.setAuthors([]);

    const page = await fetchPostComments(POST_ID);

    expect(page.comments[0]?.author).toBeNull();
  });

  it("błąd zapytania o rodziców przerywa całość", async () => {
    commentsDb.failTable("comments", "denied");

    await expect(fetchPostComments(POST_ID)).rejects.toThrow("denied");
  });
});

// ---------------------------------------------------------------------------
// Zapis, edycja, moderacja
// ---------------------------------------------------------------------------

describe("createComment", () => {
  it("bez sesji rzuca auth_required i NIE dotyka bazy", async () => {
    setCommentsSession(null);

    await expect(createComment({ postId: POST_ID, body: "Treść" })).rejects.toThrow(
      "auth_required",
    );
    expect(commentsDb.stub.chainsFor("comments")).toHaveLength(0);
  });

  it("pusta i sama-białoznakowa treść nie idzie do bazy", async () => {
    for (const body of ["", "   ", "\n\t"]) {
      await expect(createComment({ postId: POST_ID, body })).rejects.toThrow("invalid_length");
    }
    expect(commentsDb.stub.chainsFor("comments")).toHaveLength(0);
  });

  it("treść powyżej 5000 znaków nie idzie do bazy", async () => {
    await expect(createComment({ postId: POST_ID, body: "a".repeat(5001) })).rejects.toThrow(
      "invalid_length",
    );
  });

  it("dokładnie 5000 znaków przechodzi (granica jest inkluzywna)", async () => {
    commentsDb.stub.setResponse("comments", () => ok(commentRow()));

    await expect(createComment({ postId: POST_ID, body: "a".repeat(5000) })).resolves.toBeDefined();
  });

  it("treść jest PRZYCINANA przed zapisem i stemplowana tożsamością z sesji", async () => {
    commentsDb.stub.setResponse("comments", () => ok(commentRow()));

    await createComment({ postId: POST_ID, body: "  Treść  ", parentId: "c-parent" });

    // `user_id` bierze się z SESJI, nie z argumentu - inaczej klient mógłby
    // podpisać komentarz cudzym kontem.
    expect(commentsDb.stub.lastChain("comments")?.argsOf("insert")).toEqual([
      {
        post_id: POST_ID,
        user_id: USER_ID.author,
        parent_id: "c-parent",
        body: "Treść",
      },
    ]);
  });

  it("brak rodzica zapisuje się jako NULL, nie jako undefined", async () => {
    commentsDb.stub.setResponse("comments", () => ok(commentRow()));

    await createComment({ postId: POST_ID, body: "Treść" });

    const insert = commentsDb.stub.lastChain("comments")?.argsOf("insert")?.[0] as {
      parent_id: unknown;
    };
    expect(insert.parent_id).toBeNull();
  });

  it("odmowa bazy leci wyżej", async () => {
    commentsDb.failTable("comments", "rls denied", "42501");

    await expect(createComment({ postId: POST_ID, body: "Treść" })).rejects.toThrow("rls denied");
  });
});

describe("editComment", () => {
  it("waliduje długość TAK SAMO jak zapis", async () => {
    await expect(editComment(COMMENT_ID, "   ")).rejects.toThrow("invalid_length");
    await expect(editComment(COMMENT_ID, "a".repeat(5001))).rejects.toThrow("invalid_length");
  });

  it("zapisuje przyciętą treść zawężoną do JEDNEGO wiersza", async () => {
    commentsDb.stub.setResponse("comments", () => ok(commentRow()));

    await editComment(COMMENT_ID, "  Poprawka  ");

    const chain = commentsDb.stub.lastChain("comments");
    expect(chain?.argsOf("update")).toEqual([{ body: "Poprawka" }]);
    expect(chain?.argsOf("eq")).toEqual(["id", COMMENT_ID]);
  });

  it("błąd guarda okna edycji wraca do wywołującego", async () => {
    commentsDb.failTable("comments", "comments: edit window expired");

    await expect(editComment(COMMENT_ID, "Poprawka")).rejects.toThrow("edit window expired");
  });
});

describe("softDeleteComment / moderateComment", () => {
  it("usunięcie jest MIĘKKIE - ustawia status, nie kasuje wiersza", async () => {
    commentsDb.stub.setResponse("comments", () => ok(null));

    await softDeleteComment(COMMENT_ID);

    const chain = commentsDb.stub.lastChain("comments");
    // Twarde `delete()` zabrałoby wątek odpowiedziom pod tym komentarzem.
    expect(chain?.has("delete")).toBe(false);
    expect(chain?.argsOf("update")).toEqual([{ status: "deleted" }]);
  });

  it("moderacja ustawia wskazany status na wskazanym wierszu", async () => {
    commentsDb.stub.setResponse("comments", () => ok(null));

    for (const status of ["approved", "spam", "deleted", "pending"] as const) {
      await moderateComment(COMMENT_ID, status);
      expect(commentsDb.stub.lastChain("comments")?.argsOf("update")).toEqual([{ status }]);
    }
  });

  it("obie funkcje rzucają przy odmowie", async () => {
    commentsDb.failTable("comments", "denied");

    await expect(softDeleteComment(COMMENT_ID)).rejects.toThrow("denied");
    await expect(moderateComment(COMMENT_ID, "spam")).rejects.toThrow("denied");
  });
});

describe("bulkModerateComments", () => {
  it("pusty zestaw NIE woła bazy i zwraca zero", async () => {
    expect(await bulkModerateComments([], "approved")).toBe(0);
    expect(commentsDb.stub.chainsFor("comments")).toHaveLength(0);
  });

  it("deduplikuje identyfikatory i wysyła JEDNO zapytanie", async () => {
    commentsDb.stub.setResponse("comments", () => ok(null));

    const affected = await bulkModerateComments(["a", "b", "a"], "spam");

    expect(affected).toBe(2);
    expect(commentsDb.stub.chainsFor("comments")).toHaveLength(1);
    expect(commentsDb.stub.lastChain("comments")?.argsOf("in")).toEqual(["id", ["a", "b"]]);
  });
});

// ---------------------------------------------------------------------------
// Lista panelu
// ---------------------------------------------------------------------------

describe("fetchAdminComments", () => {
  it("domyślnie 200 najnowszych, bez filtra statusu", async () => {
    commentsDb.setAdminList([]);

    await fetchAdminComments({});

    const chain = commentsDb.stub.chainsFor("comments")[0];
    expect(chain?.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(chain?.argsOf("limit")).toEqual([200]);
    expect(chain?.has("eq")).toBe(false);
  });

  it("status 'all' NIE zawęża - to nie jest wartość kolumny", async () => {
    commentsDb.setAdminList([]);

    await fetchAdminComments({ status: "all" });

    expect(commentsDb.stub.chainsFor("comments")[0]?.has("eq")).toBe(false);
  });

  it("konkretny status zawęża po kolumnie", async () => {
    commentsDb.setAdminList([]);

    await fetchAdminComments({ status: "spam" });

    expect(commentsDb.stub.chainsFor("comments")[0]?.argsOf("eq")).toEqual(["status", "spam"]);
  });

  it("fraza jedzie jako ILIKE z otaczającymi procentami i jest przycięta", async () => {
    commentsDb.setAdminList([]);

    await fetchAdminComments({ q: "  spam  " });

    expect(commentsDb.stub.chainsFor("comments")[0]?.argsOf("ilike")).toEqual(["body", "%spam%"]);
  });

  it("pusta i biała fraza NIE zawęża", async () => {
    commentsDb.setAdminList([]);

    await fetchAdminComments({ q: "   " });

    expect(commentsDb.stub.chainsFor("comments")[0]?.has("ilike")).toBe(false);
  });

  it("pusta lista nie pyta ani o autorów, ani o wpisy", async () => {
    commentsDb.setAdminList([]);

    expect(await fetchAdminComments({})).toEqual([]);
    expect(commentsDb.stub.chainsFor("profiles")).toHaveLength(0);
    expect(commentsDb.stub.chainsFor("posts")).toHaveLength(0);
  });

  it("dokleja autora i wpis, po jednym zapytaniu na każde", async () => {
    commentsDb.setAdminList([
      commentRow({ id: "c1", user_id: USER_ID.author, post_id: POST_ID }),
      commentRow({ id: "c2", user_id: null, post_id: POST_ID }),
    ]);
    commentsDb.setAuthors([authorRow({ id: USER_ID.author, display_name: "Anna" })]);
    commentsDb.setPosts([postRow({ id: POST_ID, slug: "wpis", title_pl: "Wpis" })]);

    const rows = await fetchAdminComments({});

    expect(commentsDb.stub.chainsFor("profiles")).toHaveLength(1);
    expect(commentsDb.stub.chainsFor("posts")).toHaveLength(1);
    expect(rows[0]?.author?.display_name).toBe("Anna");
    expect(rows[0]?.post?.slug).toBe("wpis");
    // Komentarz gościa ma autora null, ale WPIS nadal doklejony - moderator
    // musi wiedzieć, pod czym stoi zgłoszony wpis.
    expect(rows[1]?.author).toBeNull();
    expect(rows[1]?.post?.slug).toBe("wpis");
  });

  it("identyfikatory wpisów są deduplikowane", async () => {
    commentsDb.setAdminList([
      commentRow({ id: "c1", post_id: POST_ID }),
      commentRow({ id: "c2", post_id: POST_ID }),
    ]);
    commentsDb.setAuthors([]);
    commentsDb.setPosts([]);

    await fetchAdminComments({});

    expect(commentsDb.stub.chainsFor("posts")[0]?.argsOf("in")).toEqual(["id", [POST_ID]]);
  });

  it("komentarz do NIEZNANEGO wpisu ma post null, a nie wywraca listy", async () => {
    commentsDb.setAdminList([commentRow({ id: "c1", post_id: "post-znikniety" })]);
    commentsDb.setAuthors([]);
    commentsDb.setPosts([]);

    expect((await fetchAdminComments({}))[0]?.post).toBeNull();
  });

  it("rzuca przy odmowie", async () => {
    commentsDb.failTable("comments", "not staff", "42501");

    await expect(fetchAdminComments({})).rejects.toThrow("not staff");
  });
});
