// Podpis komentarza oczami GOŚCIA - prawdziwa warstwa danych (`fetchPostComments`)
// na atrapie klienta Supabase z routerem odpowiedzi (`@/test/comments/fixtures`).
//
// DEFEKT, KTÓRY TEN PLIK PRZYPINA. Gość (anon) nie ma SELECT na kolumnach
// `profiles`, więc dociąganie autorów kończyło się 42501, błąd był połykany,
// a KAŻDY komentarz członka redakcji, autora czy eksperta podpisywał się
// „Anonim" - bez awatara i bez linku do profilu. Gość czyta teraz publiczną
// projekcję `profiles_public` (te same osoby, które pokazuje strona autora);
// zalogowany - `profiles` jak dotąd.
//
// Sekcja jest renderowana serwerowo, ale lista komentarzy przychodzi z
// zapytania klienta (żaden loader jej nie dociąga) - pierwszy render po obu
// stronach to ten sam stan „wczytywanie", więc zmiana źródła autorów nie
// dotyka hydratacji.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  user: null as { id: string } | null,
}));

vi.mock(
  "@/integrations/supabase/client",
  async () => (await import("@/test/comments/fixtures")).commentsSupabaseMock,
);
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options === undefined ? key : `${key}|${JSON.stringify(options)}`,
    i18n: { language: "pl" },
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
  }: {
    children?: unknown;
    to?: string;
    params?: Record<string, string>;
  }) => {
    const href = Object.entries(params ?? {}).reduce(
      (acc, [key, value]) => acc.replace(`$${key}`, value),
      to ?? "",
    );
    return <a href={href}>{children as never}</a>;
  },
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock("@/lib/useSiteSetting", () => ({
  useSiteSetting: () => ({
    allow_comments: true,
    require_login_to_comment: true,
    moderate_new_comments: true,
  }),
}));
vi.mock("@/lib/realtime/tableChannelHub", () => ({ subscribeToTable: () => () => {} }));
vi.mock("@/lib/comments/guest.functions", () => ({ createGuestComment: vi.fn() }));
vi.mock("@/components/mentions/MentionText", () => ({
  MentionText: ({ body }: { body: string }) => <span>{body}</span>,
}));
vi.mock("@/components/mentions/MentionTextarea", () => ({
  MentionTextarea: ({ label }: { label: string }) => <textarea aria-label={label} />,
}));

import { CommentsSection } from "@/components/comments/CommentsSection";
import {
  POST_ID,
  USER_ID,
  authorRow,
  commentRow,
  commentsDb,
  resetCommentsDb,
  setCommentsSession,
} from "@/test/comments/fixtures";

function section() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<CommentsSection postId={POST_ID} lang="pl" />, { wrapper });
}

beforeEach(() => {
  resetCommentsDb();
  // Komentarz zarejestrowanego autora: trigger `comments_before_insert`
  // zeruje `author_name`, więc podpis bierze się WYŁĄCZNIE z profilu.
  commentsDb.setThreads(
    [
      commentRow({ id: "c-expert", user_id: USER_ID.author, body: "Komentarz eksperta" }),
      commentRow({ id: "c-member", user_id: USER_ID.stranger, body: "Komentarz członka" }),
    ],
    [],
    [],
    { approvedCount: 2 },
  );
});

afterEach(() => cleanup());

describe("CommentsSection - podpis autora", () => {
  it("GOŚĆ widzi nazwisko i link autora z publiczną obecnością, bez zapytania o `profiles`", async () => {
    h.user = null;
    setCommentsSession(null);
    commentsDb.setPublicAuthors([
      authorRow({ id: USER_ID.author, display_name: "Anna Nowak", slug: "anna-nowak" }),
    ]);

    section();

    const link = await screen.findByRole("link", { name: "Anna Nowak" });
    expect(link.getAttribute("href")).toBe("/people/anna-nowak");
    // Zwykły członek bez publicznej obecności zostaje u gościa anonimowy -
    // pełna zgodność to decyzja właściciela (RPC), nie kodu klienta.
    expect(screen.getAllByText("comments.anonymous")).toHaveLength(1);
    expect(commentsDb.stub.chainsFor("profiles")).toHaveLength(0);
  });

  it("REDAKCJA widzi podpisy z `profiles` jak dotąd (oba komentarze z nazwiskiem)", async () => {
    h.user = { id: USER_ID.moderator };
    setCommentsSession(USER_ID.moderator);
    commentsDb.setAuthors([
      authorRow({ id: USER_ID.author, display_name: "Anna Nowak", slug: "anna-nowak" }),
      authorRow({ id: USER_ID.stranger, display_name: "Piotr Zieliński", slug: "piotr" }),
    ]);

    section();

    expect(await screen.findByRole("link", { name: "Anna Nowak" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Piotr Zieliński" })).toBeInTheDocument();
    expect(screen.queryByText("comments.anonymous")).toBeNull();
    expect(commentsDb.stub.chainsFor("profiles_public")).toHaveLength(0);
  });
});
