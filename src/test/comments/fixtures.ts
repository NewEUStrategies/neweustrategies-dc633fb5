// Atomy testowe KOMENTARZY - fabryki wierszy plus routing odpowiedzi po
// kształcie łańcucha PostgREST.
//
// DLACZEGO ROUTER, A NIE POJEDYNCZA ODPOWIEDŹ NA TABELĘ. `fetchPostComments`
// woła tabelę `comments` CZTERY RAZY w jednym przebiegu i za każdym razem
// pyta o co innego: rodziców wątków, odpowiedzi pierwszego piętra, odpowiedzi
// drugiego piętra i licznik zatwierdzonych. Wspólna odpowiedź na całą tabelę
// oddawałaby te same wiersze każdemu z tych zapytań, a wtedy test „drzewo ma
// trzy piętra" przechodziłby także wtedy, gdyby kod pobrał jedno piętro
// trzy razy - czyli nie dowodziłby niczego.
//
// Router rozstrzyga po OGNIWACH łańcucha, bo to jedyne, czym te cztery
// zapytania się różnią:
//   * `.is("parent_id", null)`        -> rodzice wątków,
//   * `.in("parent_id", [...])`       -> jedno piętro odpowiedzi,
//   * `head: true` w `select`         -> zapytanie liczące,
//   * brak powyższych                 -> lista panelu.
import {
  ok,
  okCount,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseFromStub,
} from "@/test/supabase";
import type { Database } from "@/integrations/supabase/types";
import type { CommentAuthor, CommentWithAuthor } from "@/lib/comments/api";

type CommentRow = Database["public"]["Tables"]["comments"]["Row"];

export const POST_ID = "post-1";
export const COMMENT_ID = "comment-1";
export const TENANT_ID = "tenant-alfa";

export const USER_ID = {
  author: "user-author",
  moderator: "user-moderator",
  stranger: "user-stranger",
} as const;

export const COMMENTS_BASE_ISO = "2026-08-18T10:00:00.000Z";

/** Wiersz `comments` 1:1 z wygenerowanym typem - bez rzutowań. */
export function commentRow(overrides: Partial<CommentRow> = {}): CommentRow {
  return {
    id: COMMENT_ID,
    post_id: POST_ID,
    tenant_id: TENANT_ID,
    user_id: USER_ID.author,
    author_name: null,
    parent_id: null,
    body: "Treść komentarza",
    status: "approved",
    created_at: COMMENTS_BASE_ISO,
    updated_at: COMMENTS_BASE_ISO,
    edited_at: null,
    ...overrides,
  };
}

/** Wiersz profilu w kształcie, w jakim czyta go `fetchAuthorsById`. */
export function authorRow(overrides: Partial<CommentAuthor> = {}): CommentAuthor {
  return {
    id: USER_ID.author,
    display_name: "Anna Nowak",
    avatar_url: null,
    slug: "anna-nowak",
    ...overrides,
  };
}

/** Wiersz `posts` w kształcie, w jakim czyta go lista panelu. */
export function postRow(
  overrides: Partial<{
    id: string;
    slug: string;
    title_pl: string | null;
    title_en: string | null;
  }> = {},
) {
  return { id: POST_ID, slug: "wpis", title_pl: "Wpis", title_en: "Post", ...overrides };
}

/** Komentarz z doklejonym autorem - wejście reguł widoku (`canEditComment`). */
export function withAuthor(
  row: CommentRow,
  author: CommentAuthor | null = authorRow(),
): CommentWithAuthor {
  return { ...row, author };
}

// --- router odpowiedzi -------------------------------------------------------

const stub: SupabaseFromStub = supabaseFromStub();

const session: { userId: string | null } = { userId: USER_ID.author };

/** Ustaw zalogowanego (albo `null` = gość) na potrzeby jednego testu. */
export function setCommentsSession(userId: string | null): void {
  session.userId = userId;
}

function isCountingQuery(chain: RecordedChain): boolean {
  const options = chain.argsOf("select")?.[1];
  return typeof options === "object" && options !== null && "head" in options;
}

function parentIdsOf(chain: RecordedChain): string[] | null {
  const inCall = chain.calls.find((c) => c.method === "in" && c.args[0] === "parent_id");
  return inCall === undefined ? null : (inCall.args[1] as string[]);
}

interface CommentsState {
  parents: CommentRow[];
  replies: CommentRow[];
  grandchildren: CommentRow[];
  adminList: CommentRow[] | null;
  authors: CommentAuthor[];
  posts: ReturnType<typeof postRow>[];
  topLevelCount: number | null;
  approvedCount: number | null;
}

const state: CommentsState = {
  parents: [],
  replies: [],
  grandchildren: [],
  adminList: null,
  authors: [],
  posts: [],
  topLevelCount: null,
  approvedCount: null,
};

/**
 * Atrapa klienta. Router czyta zapisany łańcuch i oddaje odpowiedź pasującą
 * do TEGO zapytania - patrz nagłówek pliku.
 */
export const commentsSupabaseMock = {
  supabase: {
    from: (table: string) => stub.from(table),
    auth: {
      async getSession() {
        return {
          data: {
            session: session.userId === null ? null : { user: { id: session.userId } },
          },
          error: null,
        };
      },
    },
  },
};

function installRouter(): void {
  stub.setResponse("comments", (chain) => {
    if (isCountingQuery(chain)) return okCount(state.approvedCount ?? 0);

    const parentIds = parentIdsOf(chain);
    if (parentIds !== null) {
      // Piętro odpowiedzi: oddaj tylko dzieci wskazanych rodziców. Dzięki temu
      // test „sierota nigdy nie wraca bez rodzica" ma z czego wyjść.
      const pool = [...state.replies, ...state.grandchildren];
      return ok(pool.filter((row) => row.parent_id !== null && parentIds.includes(row.parent_id)));
    }

    if (chain.has("is")) {
      const limit = chain.argsOf("limit")?.[0];
      const rows = typeof limit === "number" ? state.parents.slice(0, limit) : [...state.parents];
      return { data: rows, error: null, count: state.topLevelCount };
    }

    // Zapis (insert/update) oddaje pojedynczy wiersz; lista panelu - tablicę.
    if (chain.has("insert") || chain.has("update")) return ok(commentRow());
    return ok(state.adminList ?? []);
  });
  stub.setResponse("profiles", () => ok(state.authors));
  stub.setResponse("posts", () => ok(state.posts));
}

/** Zestaw kontrolny testu: trzy piętra drzewa plus liczniki. */
export const commentsDb = {
  stub,
  setThreads(
    parents: CommentRow[],
    replies: CommentRow[],
    grandchildren: CommentRow[],
    counts: { topLevelCount?: number | null; approvedCount?: number | null } = {},
  ): void {
    state.parents = parents;
    state.replies = replies;
    state.grandchildren = grandchildren;
    state.topLevelCount = counts.topLevelCount ?? parents.length;
    state.approvedCount = counts.approvedCount ?? 0;
    installRouter();
  },
  setAdminList(rows: CommentRow[]): void {
    state.adminList = rows;
    installRouter();
  },
  setAuthors(rows: CommentAuthor[]): void {
    state.authors = rows;
    installRouter();
  },
  setPosts(rows: ReturnType<typeof postRow>[]): void {
    state.posts = rows;
    installRouter();
  },
  /** Odmowa bazy dla jednej tabeli - reszta routera zostaje. */
  failTable(table: string, message: string, code?: string): void {
    installRouter();
    stub.setResponse(table, () => {
      const error: Error & { code?: string } = new Error(message);
      error.name = "PostgrestError";
      if (code !== undefined) error.code = code;
      return { data: null, error };
    });
  },
};

/** Sprzątanie między testami. */
export function resetCommentsDb(): void {
  stub.reset();
  state.parents = [];
  state.replies = [];
  state.grandchildren = [];
  state.adminList = null;
  state.authors = [];
  state.posts = [];
  state.topLevelCount = null;
  state.approvedCount = null;
  session.userId = USER_ID.author;
  installRouter();
}
