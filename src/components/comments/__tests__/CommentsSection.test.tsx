// Sekcja komentarzy pod wpisem - 716 linii, 0% pokrycia do dziś.
//
// CO TU JEST WARTE TESTU. Nie „czy się renderuje", tylko cztery decyzje,
// które widzi czytelnik i których nie widać w warstwie danych:
//
//   1. KIEDY SEKCJI NIE MA W OGÓLE. Wyłączona dyskusja bez ani jednego
//      zatwierdzonego komentarza nie ma renderować martwego kompozytora ani
//      pustego nagłówka - ma zniknąć. Ale wyłączona dyskusja Z historią musi
//      pokazać archiwum i powiedzieć, że jest zamknięte.
//
//   2. KTÓRY KOMPOZYTOR. Zalogowany dostaje swój, gość - swój (z podpisem
//      i honeypotem), a gdy komentarze gościa są wyłączone - zaproszenie do
//      logowania. Trzy stany, jedna decyzja.
//
//   3. UCZCIWY LICZNIK I UCZCIWY TOAST. Nagłówek liczy WSZYSTKIE zatwierdzone
//      (także spoza okna), a nie pobrane wiersze. Komentarz, który trafił do
//      kolejki moderacji, dostaje komunikat „czeka na zatwierdzenie", a nie
//      „opublikowano" - to rozstrzyga baza, nie klient.
//
//   4. MAPOWANIE BŁĘDÓW NA COPY. Limit tempa, wygasłe okno edycji i wymagane
//      logowanie mają własne komunikaty; reszta - ogólny.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  user: null as { id: string } | null,
  discussion: { allow_comments: true, require_login_to_comment: true, moderate_new_comments: true },
  page: {
    comments: [] as unknown[],
    topLevelCount: 0,
    approvedCount: 0,
  },
  createComment: vi.fn(),
  guestCreate: vi.fn(),
  editComment: vi.fn(),
  softDelete: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  confirm: vi.fn(),
  unsubscribe: vi.fn(),
  subscribe: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options === undefined ? key : `${key}|${JSON.stringify(options)}`,
    i18n: { language: "pl" },
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children?: unknown; to?: string }) => (
    <a href={to}>{children as never}</a>
  ),
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => h.guestCreate }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock("@/lib/useSiteSetting", () => ({ useSiteSetting: () => h.discussion }));
vi.mock("@/lib/appDialogs", () => ({ confirmDialog: h.confirm }));
vi.mock("@/lib/realtime/tableChannelHub", () => ({
  subscribeToTable: (...args: unknown[]) => {
    h.subscribe(...args);
    return h.unsubscribe;
  },
}));
vi.mock("@/lib/comments/guest.functions", () => ({ createGuestComment: h.guestCreate }));
vi.mock("@/lib/comments/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/comments/api")>("@/lib/comments/api");
  return {
    ...actual,
    fetchPostComments: async () => h.page,
    createComment: h.createComment,
    editComment: h.editComment,
    softDeleteComment: h.softDelete,
  };
});
vi.mock("@/components/mentions/MentionText", () => ({
  MentionText: ({ body }: { body: string }) => <span>{body}</span>,
}));
vi.mock("@/components/mentions/MentionTextarea", () => ({
  MentionTextarea: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import { CommentsSection } from "@/components/comments/CommentsSection";
import { commentRow, POST_ID, USER_ID } from "@/test/comments/fixtures";

function section() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<CommentsSection postId={POST_ID} lang="pl" />, { wrapper });
}

function hasKey(key: string): boolean {
  return screen.queryAllByText((text) => text.includes(key)).length > 0;
}

function withAuthorRow(over: Parameters<typeof commentRow>[0] = {}) {
  return { ...commentRow(over), author: null };
}

beforeEach(() => {
  h.user = null;
  h.discussion = {
    allow_comments: true,
    require_login_to_comment: true,
    moderate_new_comments: true,
  };
  h.page = { comments: [], topLevelCount: 0, approvedCount: 0 };
  h.createComment.mockReset().mockResolvedValue(commentRow({ status: "approved" }));
  h.guestCreate.mockReset().mockResolvedValue({ ok: true, status: "approved" });
  h.editComment.mockReset().mockResolvedValue(commentRow());
  h.softDelete.mockReset().mockResolvedValue(undefined);
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.confirm.mockReset().mockResolvedValue(true);
  h.subscribe.mockReset();
  h.unsubscribe.mockReset();
});

describe("kiedy sekcja w ogóle się pojawia", () => {
  it("dyskusja WYŁĄCZONA i zero zatwierdzonych: sekcji NIE MA", async () => {
    h.discussion = { ...h.discussion, allow_comments: false };

    const { container } = section();

    // Martwy kompozytor pod wpisem bez komentarzy jest gorszy niż jego brak.
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("dyskusja WYŁĄCZONA, ale z historią: archiwum widoczne z notką o zamknięciu", async () => {
    h.discussion = { ...h.discussion, allow_comments: false };
    h.page = { comments: [withAuthorRow()], topLevelCount: 1, approvedCount: 1 };

    section();

    await waitFor(() => expect(hasKey("comments.closed")).toBe(true));
    expect(screen.getByRole("note")).toBeTruthy();
    // Zamknięcie dyskusji nie kasuje tego, co ludzie już napisali.
    expect(hasKey("Treść komentarza")).toBe(true);
  });

  it("dyskusja WŁĄCZONA bez komentarzy: sekcja jest, z komunikatem o pustce", async () => {
    section();

    await waitFor(() => expect(hasKey("comments.empty")).toBe(true));
  });
});

describe("który kompozytor", () => {
  it("ZALOGOWANY dostaje własny kompozytor", async () => {
    h.user = { id: USER_ID.author };

    section();

    await waitFor(() => expect(document.querySelector("textarea")).toBeTruthy());
    expect(hasKey("comments.signInPrompt")).toBe(false);
  });

  it("GOŚĆ przy wymaganym logowaniu widzi zaproszenie do logowania", async () => {
    section();

    await waitFor(() => expect(hasKey("comments.signInPrompt")).toBe(true));
    expect(screen.getByRole("link", { name: /comments\.signInLink/ })).toBeTruthy();
  });

  it("GOŚĆ przy otwartych komentarzach gościa dostaje kompozytor z PODPISEM", async () => {
    h.discussion = { ...h.discussion, require_login_to_comment: false };

    section();

    await waitFor(() => expect(hasKey("comments.signInPrompt")).toBe(false));
    // Podpis to osobne pole tekstowe obok treści - gość musi się jakoś nazwać.
    expect(document.querySelectorAll("input").length).toBeGreaterThan(0);
  });

  it("kompozytor gościa niesie UKRYTY honeypot", async () => {
    h.discussion = { ...h.discussion, require_login_to_comment: false };

    const { container } = section();

    await waitFor(() => expect(container.querySelector("form")).toBeTruthy());
    // Filtr botów działa tylko wtedy, gdy pole naprawdę jest w formularzu -
    // bot odtwarzający formularz bez JS ma je wypełnić.
    const hidden = container.querySelector('input[tabindex="-1"], input[aria-hidden="true"]');
    expect(hidden).toBeTruthy();
  });
});

describe("licznik i realtime", () => {
  it("nagłówek liczy WSZYSTKIE zatwierdzone, nie pobrane wiersze", async () => {
    h.page = { comments: [withAuthorRow()], topLevelCount: 1, approvedCount: 137 };

    section();

    // Wcześniej licznik brał długość listy i kłamał poza oknem paginacji.
    await waitFor(() => expect(hasKey('comments.title|{"count":137}')).toBe(true));
  });

  it("subskrybuje zmiany TEGO wpisu i sprząta przy odmontowaniu", async () => {
    const { unmount } = section();

    await waitFor(() => expect(h.subscribe).toHaveBeenCalled());
    expect(h.subscribe.mock.calls[0]?.[0]).toEqual({
      table: "comments",
      filter: `post_id=eq.${POST_ID}`,
    });

    unmount();
    // Zgubiony `unsubscribe` kończy się wyczerpaniem limitu kanałów po kilku
    // przejściach między wpisami.
    expect(h.unsubscribe).toHaveBeenCalled();
  });

  it("'pokaż więcej' pojawia się dopiero, gdy WĄTKÓW jest więcej niż okno", async () => {
    h.page = { comments: [withAuthorRow()], topLevelCount: 1, approvedCount: 1 };
    const { unmount } = section();
    await waitFor(() => expect(hasKey("comments.loadMore")).toBe(false));
    unmount();

    h.page = { comments: [withAuthorRow()], topLevelCount: 120, approvedCount: 120 };
    section();

    await waitFor(() => expect(hasKey("comments.loadMore")).toBe(true));
  });
});

describe("uczciwy komunikat o losie komentarza", () => {
  async function submitAs(user: { id: string } | null, body = "Nowy komentarz") {
    h.user = user;
    section();
    await waitFor(() => expect(document.querySelector("textarea")).toBeTruthy());
    fireEvent.change(document.querySelector("textarea")!, { target: { value: body } });
    fireEvent.submit(document.querySelector("form")!);
  }

  it("komentarz PRZYJĘTY od razu: potwierdzenie publikacji", async () => {
    h.createComment.mockResolvedValue(commentRow({ status: "approved" }));

    await submitAs({ id: USER_ID.author });

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("comments.submitted"));
  });

  it("komentarz do KOLEJKI: komunikat o oczekiwaniu, nie o publikacji", async () => {
    // Moderację rozstrzyga baza. Klient nie może obiecywać, że wpis „jest już
    // widoczny", skoro trafił do kolejki.
    h.createComment.mockResolvedValue(commentRow({ status: "pending" }));

    await submitAs({ id: USER_ID.author });

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("comments.submittedPending"));
  });

  it("gość: status z serwera też rozstrzyga komunikat", async () => {
    h.discussion = { ...h.discussion, require_login_to_comment: false };
    h.guestCreate.mockResolvedValue({ ok: true, status: "pending" });
    section();
    await waitFor(() => expect(document.querySelector("textarea")).toBeTruthy());

    fireEvent.change(document.querySelector("textarea")!, {
      target: { value: "Komentarz gościa" },
    });
    for (const input of document.querySelectorAll("input")) {
      if (input.type === "text") fireEvent.change(input, { target: { value: "Jan" } });
    }
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("comments.submittedPending"));
  });
});

describe("mapowanie błędów na komunikaty", () => {
  async function failWith(error: Error) {
    h.user = { id: USER_ID.author };
    h.createComment.mockRejectedValue(error);
    section();
    await waitFor(() => expect(document.querySelector("textarea")).toBeTruthy());
    fireEvent.change(document.querySelector("textarea")!, { target: { value: "Treść" } });
    fireEvent.submit(document.querySelector("form")!);
  }

  it("brak sesji -> komunikat o logowaniu", async () => {
    await failWith(new Error("auth_required"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("comments.errors.authRequired"));
  });

  it("wyłączona dyskusja -> własny komunikat", async () => {
    await failWith(new Error("comments_disabled"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("comments.errors.disabled"));
  });

  it("limit tempa z triggera -> przyjazne copy zamiast surowego komunikatu bazy", async () => {
    // Trigger odrzuca powyżej pięciu komentarzy na minutę komunikatem
    // technicznym; czytelnik ma zobaczyć zdanie, nie treść wyjątku.
    await failWith(new Error("comments: rate limited (5/min)"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("comments.errors.rateLimited"));
  });

  it("nieznany błąd -> komunikat ogólny", async () => {
    await failWith(new Error("cokolwiek innego"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("comments.errors.generic"));
  });
});
