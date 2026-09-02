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
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  fetch: vi.fn(),
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
  // `params` są interpolowane, bo test „autor z profilem" mierzy DOCELOWY adres
  // (`/author/anna-nowak`), a nie sam wzorzec trasy.
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
    fetchPostComments: (_postId: string, limit: number) => h.fetch(limit),
    createComment: h.createComment,
    editComment: h.editComment,
    softDeleteComment: h.softDelete,
  };
});
vi.mock("@/components/mentions/MentionText", () => ({
  MentionText: ({ body }: { body: string }) => <span>{body}</span>,
}));
vi.mock("@/components/mentions/MentionTextarea", () => ({
  // Atrapa NIESIE etykietę, bo prawdziwe pole (FloatingTextarea) renderuje
  // <label for>. Bez tego audyt axe poniżej mierzyłby brak w atrapie, a nie
  // w komponencie. Prawdziwy stos wzmianek dowodzi CommentsSectionComposer.
  MentionTextarea: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
  }) => <textarea aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />,
}));

import { CommentsSection } from "@/components/comments/CommentsSection";
import { axeViolations, summarize } from "@/test/axe";
import {
  authorRow,
  commentRow,
  COMMENT_ID,
  POST_ID,
  THREAD_ID,
  threadRows,
  USER_ID,
  viewRow,
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

function hasKey(key: string): boolean {
  return screen.queryAllByText((text) => text.includes(key)).length > 0;
}

// Obudowa wiersza mieszka w `@/test/comments/fixtures` - oba pliki testowe
// sekcji muszą karmić komponent DOKŁADNIE tym samym kształtem.
function withAuthorRow(over: Parameters<typeof commentRow>[0] = {}) {
  return viewRow(over);
}

beforeEach(() => {
  h.user = null;
  h.discussion = {
    allow_comments: true,
    require_login_to_comment: true,
    moderate_new_comments: true,
  };
  h.page = { comments: [], topLevelCount: 0, approvedCount: 0 };
  // Domyślnie każde okno paginacji dostaje ten sam zestaw; testy paginacji
  // podmieniają implementację, żeby zobaczyć ARGUMENT `limit`.
  h.fetch.mockReset().mockImplementation(async () => h.page);
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

  it("odrzucenie czymś, co nie jest Error, nie wysypuje mapowania", async () => {
    // PostgREST bywa odrzucany surowym obiektem; `err instanceof Error` musi
    // mieć drugie ramię, inaczej odczyt `.message` rzuciłby w handlerze błędu.
    h.user = { id: USER_ID.author };
    h.createComment.mockRejectedValue({ code: "PGRST301" });
    section();
    await waitFor(() => expect(document.querySelector("textarea")).toBeTruthy());
    fireEvent.change(document.querySelector("textarea")!, { target: { value: "Treść" } });
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("comments.errors.generic"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DRUGA WARSTWA DOWODU: WĄTEK, MODERACJA I WIERSZ
//
// Powyżej rozstrzygnięto, KTÓRA sekcja się pojawia i JAKI komunikat dostaje
// autor. Poniżej - to, czego tamte przypadki nie dotykały: rekurencja drzewa
// odpowiedzi (i jej twardy limit), okno odpowiedzi, tryb edycji z blokadą
// podwójnego zapisu, potwierdzenie przed nieodwracalnym usunięciem oraz stany
// pojedynczego wiersza. `MentionTextarea` jest tu nadal atrapą - prawdziwy stos
// kompozytora i wzmianek dowodzi osobny plik `CommentsSectionComposer.test.tsx`,
// bo tam potrzebna jest inna atrapa (podpowiedzi RPC) i inny tłumacz.
// ─────────────────────────────────────────────────────────────────────────────

/** Świeży wiersz - mieści się w 15-minutowym oknie edycji (`canEditComment`). */
function freshRow(over: Parameters<typeof commentRow>[0] = {}) {
  return viewRow({ created_at: new Date().toISOString(), ...over });
}

function replyButtons() {
  return screen.queryAllByRole("button", { name: "comments.reply" });
}

function textareas() {
  return Array.from(document.querySelectorAll("textarea"));
}

function forms() {
  return Array.from(document.querySelectorAll("form"));
}

describe("rekurencja drzewa odpowiedzi", () => {
  beforeEach(() => {
    h.user = { id: USER_ID.author };
    // Czwarty wiersz leży PONAD limitem - patrz `threadRows`.
    h.page = { comments: threadRows(), topLevelCount: 1, approvedCount: 4 };
  });

  it("odpowiedzi renderują się ZAGNIEŻDŻONE, a nie jako płaska lista", async () => {
    const { container } = section();

    await waitFor(() => expect(screen.getByText("Odpowiedź druga")).toBeTruthy());
    const articles = Array.from(container.querySelectorAll("article"));
    // Trzy piętra, każde wewnątrz poprzedniego - dowód, że komponent woła sam
    // siebie na `node.children`, zamiast rozwijać listę w jednym poziomie.
    expect(articles).toHaveLength(3);
    expect(articles[0]!.contains(articles[1]!)).toBe(true);
    expect(articles[1]!.contains(articles[2]!)).toBe(true);
  });

  it("wiersz PONAD MAX_COMMENT_DEPTH nie ma gdzie się pojawić", async () => {
    section();

    await waitFor(() => expect(screen.getByText("Wątek główny")).toBeTruthy());
    // Baza oddała cztery wiersze; reguła drzewa ma miejsce dla trzech.
    expect(screen.getByText("Odpowiedź druga")).toBeTruthy();
    expect(screen.queryByText("Piętro ponad limitem")).toBeNull();
  });

  it("na OSTATNIM dozwolonym piętrze znika przycisk odpowiedzi", async () => {
    section();

    await waitFor(() => expect(screen.getByText("Odpowiedź druga")).toBeTruthy());
    // Trzy komentarze, dwa przyciski: odpowiedź na trzeci wylądowałaby na
    // piętrze, którego trigger `comments_before_insert` i tak by nie przyjął.
    expect(replyButtons()).toHaveLength(2);
  });

  it("ZAMKNIĘTA dyskusja z archiwum nie oferuje odpowiedzi na ŻADNYM piętrze", async () => {
    h.discussion = { ...h.discussion, allow_comments: false };

    section();

    await waitFor(() => expect(hasKey("comments.closed")).toBe(true));
    expect(replyButtons()).toHaveLength(0);
  });

  it("GOŚĆ bez prawa komentowania nie dostaje przycisku odpowiedzi", async () => {
    h.user = null; // require_login_to_comment = true

    section();

    await waitFor(() => expect(hasKey("comments.signInPrompt")).toBe(true));
    expect(replyButtons()).toHaveLength(0);
  });
});

describe("okno odpowiedzi", () => {
  beforeEach(() => {
    h.page = { comments: [threadRows()[0]!], topLevelCount: 1, approvedCount: 1 };
  });

  async function openReply() {
    section();
    await waitFor(() => expect(screen.getByText("Wątek główny")).toBeTruthy());
    const button = replyButtons()[0]!;
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    return button;
  }

  it("przycisk odpowiedzi OGŁASZA stan okna przez aria-expanded", async () => {
    h.user = { id: USER_ID.author };

    const button = await openReply();

    await waitFor(() => expect(button.getAttribute("aria-expanded")).toBe("true"));
    fireEvent.click(button);
    await waitFor(() => expect(button.getAttribute("aria-expanded")).toBe("false"));
  });

  it("ZALOGOWANY odpowiada z parentId, a po sukcesie okno się zamyka", async () => {
    h.user = { id: USER_ID.author };
    await openReply();

    await waitFor(() => expect(textareas()).toHaveLength(2));
    const box = textareas()[1]!;
    fireEvent.change(box, { target: { value: "Odpowiadam na wątek" } });
    fireEvent.submit(box.closest("form")!);

    await waitFor(() =>
      expect(h.createComment).toHaveBeenCalledWith({
        postId: POST_ID,
        body: "Odpowiadam na wątek",
        parentId: THREAD_ID.root,
      }),
    );
    // Zamknięcie okna jest POTWIERDZENIEM zapisu, nie reakcją na klik.
    await waitFor(() => expect(textareas()).toHaveLength(1));
  });

  it("BŁĄD odpowiedzi ZALOGOWANEGO zostawia okno otwarte i treść w polu", async () => {
    h.user = { id: USER_ID.author };
    h.createComment.mockRejectedValue(new Error("comments: rate limited (5/min)"));
    await openReply();

    await waitFor(() => expect(textareas()).toHaveLength(2));
    const box = textareas()[1]!;
    fireEvent.change(box, { target: { value: "Odpowiedź, której nie wolno zgubić" } });
    fireEvent.submit(box.closest("form")!);

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("comments.errors.rateLimited"));
    expect(textareas()).toHaveLength(2);
    expect(box.value).toBe("Odpowiedź, której nie wolno zgubić");
  });

  it("GOŚĆ odpowiada podpisem i parentId, a honeypot leci pusty", async () => {
    h.discussion = { ...h.discussion, require_login_to_comment: false };
    await openReply();

    await waitFor(() => expect(forms()).toHaveLength(2));
    const replyForm = forms()[1]!;
    fireEvent.change(replyForm.querySelector("textarea")!, {
      target: { value: "Gość odpowiada" },
    });
    const nameInput = Array.from(replyForm.querySelectorAll("input")).find(
      (input) => input.getAttribute("name") !== "website",
    )!;
    fireEvent.change(nameInput, { target: { value: "Kasia Zmyślona" } });
    fireEvent.submit(replyForm);

    await waitFor(() =>
      expect(h.guestCreate).toHaveBeenCalledWith({
        data: {
          postId: POST_ID,
          body: "Gość odpowiada",
          authorName: "Kasia Zmyślona",
          parentId: THREAD_ID.root,
          website: "",
        },
      }),
    );
    await waitFor(() => expect(forms()).toHaveLength(1));
  });

  it("BŁĄD odpowiedzi GOŚCIA zostawia okno otwarte i treść w polu", async () => {
    // Kontrakt zapisany wprost w kodzie produkcyjnym: „Zamykamy odpowiedź
    // DOPIERO po sukcesie; błąd zostawia okno i treść". Inaczej limit tempa
    // kasowałby gościowi napisany komentarz bez śladu.
    h.discussion = { ...h.discussion, require_login_to_comment: false };
    h.guestCreate.mockRejectedValue(new Error("rate limited"));
    await openReply();

    await waitFor(() => expect(forms()).toHaveLength(2));
    const replyForm = forms()[1]!;
    const box = replyForm.querySelector("textarea")!;
    fireEvent.change(box, { target: { value: "Treść nie do zgubienia" } });
    const nameInput = Array.from(replyForm.querySelectorAll("input")).find(
      (input) => input.getAttribute("name") !== "website",
    )!;
    fireEvent.change(nameInput, { target: { value: "Kasia Zmyślona" } });
    fireEvent.submit(replyForm);

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("comments.errors.rateLimited"));
    expect(forms()).toHaveLength(2);
    expect(box.value).toBe("Treść nie do zgubienia");
  });

  it("ANULUJ zamyka okno bez wysyłki", async () => {
    h.user = { id: USER_ID.author };
    await openReply();

    await waitFor(() => expect(forms()).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));

    await waitFor(() => expect(forms()).toHaveLength(1));
    expect(h.createComment).not.toHaveBeenCalled();
  });

  it("ANULUJ w oknie odpowiedzi GOŚCIA też je zamyka", async () => {
    // Osobna ścieżka: gość ma inny kompozytor, więc i własny przycisk anuluj.
    h.discussion = { ...h.discussion, require_login_to_comment: false };
    await openReply();

    await waitFor(() => expect(forms()).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));

    await waitFor(() => expect(forms()).toHaveLength(1));
    expect(h.guestCreate).not.toHaveBeenCalled();
  });
});

describe("mapowanie błędów GOŚCIA na komunikaty", () => {
  async function guestFailWith(error: Error) {
    h.discussion = { ...h.discussion, require_login_to_comment: false };
    h.guestCreate.mockRejectedValue(error);
    section();
    await waitFor(() => expect(textareas()).toHaveLength(1));
    fireEvent.change(textareas()[0]!, { target: { value: "Treść gościa" } });
    const nameInput = Array.from(forms()[0]!.querySelectorAll("input")).find(
      (input) => input.getAttribute("name") !== "website",
    )!;
    fireEvent.change(nameInput, { target: { value: "Kasia Zmyślona" } });
    fireEvent.submit(forms()[0]!);
  }

  it("serwer żąda logowania -> komunikat o logowaniu", async () => {
    await guestFailWith(new Error("auth required"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("comments.errors.authRequired"));
  });

  it("nieznany błąd gościa -> komunikat ogólny", async () => {
    await guestFailWith(new Error("tenant unresolved"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("comments.errors.generic"));
  });

  it("odrzucenie gościa czymś, co nie jest Error, też mapuje się na ogólny", async () => {
    await guestFailWith(new Error("x"));
    h.guestCreate.mockRejectedValue("boom");

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    h.toastError.mockClear();
    fireEvent.submit(forms()[0]!);

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("comments.errors.generic"));
  });
});

describe("edycja własnego komentarza", () => {
  beforeEach(() => {
    h.user = { id: USER_ID.author };
    h.page = { comments: [freshRow({ id: "c-fresh" })], topLevelCount: 1, approvedCount: 1 };
  });

  async function openEditor() {
    section();
    await waitFor(() => expect(screen.getByRole("button", { name: "comments.edit" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "comments.edit" }));
    await waitFor(() => expect(textareas()).toHaveLength(2));
    return textareas()[1]!;
  }

  it("edycję dostaje tylko WŁASNY komentarz", async () => {
    h.page = {
      comments: [
        freshRow({ id: "c-fresh" }),
        freshRow({ id: "c-other", user_id: USER_ID.stranger, body: "Cudzy komentarz" }),
      ],
      topLevelCount: 2,
      approvedCount: 2,
    };

    section();

    await waitFor(() => expect(screen.getByText("Cudzy komentarz")).toBeTruthy());
    expect(screen.getAllByRole("button", { name: "comments.edit" })).toHaveLength(1);
  });

  it("po WYGAŚNIĘCIU okna edycji akcji nie ma", async () => {
    // `commentRow` stoi na dacie sprzed dni - 15-minutowe okno dawno minęło.
    h.page = { comments: [viewRow()], topLevelCount: 1, approvedCount: 1 };

    section();

    await waitFor(() => expect(screen.getByText("Treść komentarza")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "comments.edit" })).toBeNull();
  });

  it("edytor startuje z BIEŻĄCĄ treścią i zapisuje poprawkę", async () => {
    const box = await openEditor();

    // Pusty edytor kasowałby komentarz zamiast go poprawiać.
    expect(box.value).toBe("Treść komentarza");
    expect(hasKey("comments.saveEdit")).toBe(true);

    fireEvent.change(box, { target: { value: "Treść po poprawce" } });
    fireEvent.submit(box.closest("form")!);

    await waitFor(() => expect(h.editComment).toHaveBeenCalledWith("c-fresh", "Treść po poprawce"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("comments.editSaved"));
    await waitFor(() => expect(textareas()).toHaveLength(1));
  });

  it("`saving` BLOKUJE drugie wysłanie tej samej poprawki", async () => {
    const deferred: { resolve: () => void } = { resolve: () => {} };
    h.editComment.mockImplementation(
      () =>
        new Promise<void>((res) => {
          deferred.resolve = () => res();
        }),
    );
    const box = await openEditor();
    fireEvent.change(box, { target: { value: "Poprawka" } });
    const form = box.closest("form")!;
    fireEvent.submit(form);

    await waitFor(() => expect(h.editComment).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "comments.saveEdit" })).toBeDisabled(),
    );
    // Dwuklik albo Enter w trakcie zapisu nie może wysłać drugiej mutacji.
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(h.editComment).toHaveBeenCalledTimes(1);

    await act(async () => {
      deferred.resolve();
    });
    await waitFor(() => expect(textareas()).toHaveLength(1));
  });

  it("ANULOWANIE edycji wraca do treści bez zapisu", async () => {
    const box = await openEditor();
    fireEvent.change(box, { target: { value: "Poprawka porzucona" } });

    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));

    await waitFor(() => expect(textareas()).toHaveLength(1));
    expect(screen.getByText("Treść komentarza")).toBeTruthy();
    expect(h.editComment).not.toHaveBeenCalled();
  });

  it("WYGASŁE okno edycji po stronie bazy: własny komunikat i edytor zostaje", async () => {
    h.editComment.mockRejectedValue(new Error("comments: edit window expired"));
    const box = await openEditor();
    fireEvent.change(box, { target: { value: "Poprawka po czasie" } });
    fireEvent.submit(box.closest("form")!);

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("comments.errors.editExpired"));
    // Odrzucona poprawka nie może zniknąć razem z edytorem.
    expect(textareas()).toHaveLength(2);
    expect(box.value).toBe("Poprawka po czasie");
  });

  it("inny błąd zapisu edycji -> komunikat ogólny", async () => {
    h.editComment.mockRejectedValue(new Error("network"));
    const box = await openEditor();
    fireEvent.change(box, { target: { value: "Poprawka" } });
    fireEvent.submit(box.closest("form")!);

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("comments.errors.generic"));
  });

  it("odrzucenie edycji czymś, co nie jest Error, też mapuje się na ogólny", async () => {
    h.editComment.mockRejectedValue({ code: "PGRST204" });
    const box = await openEditor();
    fireEvent.change(box, { target: { value: "Poprawka" } });
    fireEvent.submit(box.closest("form")!);

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("comments.errors.generic"));
  });
});

describe("usunięcie komentarza wymaga potwierdzenia", () => {
  const order: string[] = [];

  beforeEach(() => {
    order.length = 0;
    h.user = { id: USER_ID.author };
    h.page = { comments: [viewRow()], topLevelCount: 1, approvedCount: 1 };
    h.confirm.mockImplementation(async () => {
      order.push("confirm");
      return true;
    });
    h.softDelete.mockImplementation(async () => {
      order.push("softDelete");
    });
  });

  async function clickDelete() {
    section();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "comments.delete" })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "comments.delete" }));
  }

  it("dialog pada PRZED wywołaniem softDeleteComment", async () => {
    await clickDelete();

    await waitFor(() => expect(h.softDelete).toHaveBeenCalled());
    // Kolejność JEST kontraktem - usunięcie jest nieodwracalne.
    expect(order).toEqual(["confirm", "softDelete"]);
    expect(h.confirm).toHaveBeenCalledWith({
      title: "comments.deleteConfirmTitle",
      description: "comments.deleteConfirmBody",
      confirmLabel: "comments.delete",
      destructive: true,
    });
  });

  it("POTWIERDZENIE kasuje wskazany wiersz i potwierdza toastem", async () => {
    await clickDelete();

    // React Query dokleja własny kontekst jako drugi argument - kontraktem jest
    // pierwszy: identyfikator wiersza, który idzie do bazy.
    await waitFor(() => expect(h.softDelete.mock.calls[0]?.[0]).toBe(COMMENT_ID));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("comments.deleted"));
  });

  it("ODMOWA w dialogu nie kasuje niczego", async () => {
    h.confirm.mockImplementation(async () => {
      order.push("confirm");
      return false;
    });

    await clickDelete();

    await waitFor(() => expect(h.confirm).toHaveBeenCalled());
    expect(h.softDelete).not.toHaveBeenCalled();
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("ZAMKNIĘCIE dialogu bez decyzji (undefined) też nie kasuje", async () => {
    // `ok === true` jest jedynym wejściem do usunięcia; wszystko inne to „nie".
    h.confirm.mockImplementation(async () => undefined);

    await clickDelete();

    await waitFor(() => expect(h.confirm).toHaveBeenCalled());
    expect(h.softDelete).not.toHaveBeenCalled();
  });

  it("odmowa bazy przy usuwaniu -> komunikat ogólny", async () => {
    h.softDelete.mockRejectedValue(new Error("row-level security"));

    await clickDelete();

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("comments.errors.generic"));
  });
});

describe("stany pojedynczego wiersza", () => {
  function show(rows: ReturnType<typeof viewRow>[]) {
    h.page = { comments: rows, topLevelCount: rows.length, approvedCount: rows.length };
    return section();
  }

  beforeEach(() => {
    h.user = { id: USER_ID.author };
  });

  it("PENDING niesie plakietkę oczekiwania na moderację", async () => {
    show([viewRow({ status: "pending" })]);

    await waitFor(() => expect(hasKey("comments.pendingBadge")).toBe(true));
  });

  it("USUNIĘTY pokazuje zaślepkę i traci CAŁĄ stopkę akcji", async () => {
    show([viewRow({ status: "deleted", body: "Treść skasowana" })]);

    await waitFor(() => expect(hasKey("comments.deletedPlaceholder")).toBe(true));
    // Treść skasowanego wpisu nie może wracać tylnymi drzwiami.
    expect(screen.queryByText("Treść skasowana")).toBeNull();
    expect(screen.queryByRole("button", { name: "comments.delete" })).toBeNull();
    expect(replyButtons()).toHaveLength(0);
  });

  it("EDYTOWANY niesie znacznik edycji, USUNIĘTY - nie, mimo edited_at", async () => {
    show([
      viewRow({ id: "c-edited", edited_at: "2026-08-18T11:00:00.000Z" }),
      viewRow({
        id: "c-edited-deleted",
        status: "deleted",
        edited_at: "2026-08-18T11:00:00.000Z",
      }),
    ]);

    await waitFor(() => expect(hasKey("comments.edited")).toBe(true));
    // Jeden znacznik na dwa wiersze: skasowany wpis nie chwali się historią.
    expect(screen.queryAllByText((text) => text.includes("comments.edited"))).toHaveLength(1);
  });

  it("GOŚĆ: podpis z author_name plus plakietka gościa", async () => {
    show([viewRow({ user_id: null, author_name: "Kasia Zmyślona" })]);

    await waitFor(() => expect(screen.getByText("Kasia Zmyślona")).toBeTruthy());
    expect(hasKey("comments.guestBadge")).toBe(true);
  });

  it("BEZ ŻADNEJ nazwy: anonim ze słownika", async () => {
    show([viewRow({ user_id: null, author_name: null })]);

    await waitFor(() => expect(hasKey("comments.anonymous")).toBe(true));
  });

  it("autor Z PROFILEM linkuje do strony autora, autor BEZ profilu nie", async () => {
    show([
      viewRow({ id: "c-linked" }, authorRow()),
      viewRow(
        { id: "c-plain", user_id: USER_ID.stranger },
        authorRow({ id: USER_ID.stranger, display_name: "Piotr Bezprofilu", slug: null }),
      ),
    ]);

    await waitFor(() => expect(screen.getByText("Piotr Bezprofilu")).toBeTruthy());
    expect(screen.getByRole("link", { name: "Anna Nowak" }).getAttribute("href")).toBe(
      "/author/anna-nowak",
    );
    expect(screen.queryByRole("link", { name: "Piotr Bezprofilu" })).toBeNull();
  });

  it("AVATAR zastępuje inicjały; bez avatara zostają inicjały", async () => {
    show([
      viewRow({ id: "c-avatar" }, authorRow({ avatar_url: "https://cdn.example.com/a.png" })),
      viewRow(
        { id: "c-initials", user_id: USER_ID.stranger },
        authorRow({ id: USER_ID.stranger, display_name: "Ola Testowa", slug: null }),
      ),
    ]);

    await waitFor(() => expect(screen.getByText("Ola Testowa")).toBeTruthy());
    const avatar = document.querySelector('img[src="https://cdn.example.com/a.png"]');
    expect(avatar).toBeTruthy();
    // Awatar jest dekoracją obok podpisanego nazwiskiem nagłówka - pusty alt.
    expect(avatar?.getAttribute("alt")).toBe("");
    expect(screen.getByText("OL")).toBeTruthy();
  });
});

describe("okno paginacji i stany ładowania", () => {
  it("dopóki nie przyszła pierwsza odpowiedź, lista mówi o ŁADOWANIU", async () => {
    h.fetch.mockImplementation(() => new Promise(() => {}));

    section();

    await waitFor(() => expect(hasKey("comments.loading")).toBe(true));
    expect(hasKey("comments.empty")).toBe(false);
  });

  it("'pokaż więcej' ZWIĘKSZA okno - drugie zapytanie idzie z większym limitem", async () => {
    h.page = { comments: [withAuthorRow()], topLevelCount: 120, approvedCount: 120 };
    section();
    await waitFor(() => expect(hasKey("comments.loadMore")).toBe(true));
    expect(h.fetch.mock.calls.map((call) => call[0])).toEqual([50]);

    fireEvent.click(screen.getByRole("button", { name: "comments.loadMore" }));

    // Sam przycisk to za mało - okno ma naprawdę urosnąć o stronę.
    await waitFor(() => expect(h.fetch.mock.calls.map((call) => call[0])).toEqual([50, 100]));
  });

  it("odświeżenie w tle blokuje przycisk i zamienia go w 'ładowanie'", async () => {
    h.page = { comments: [withAuthorRow()], topLevelCount: 120, approvedCount: 120 };
    section();
    await waitFor(() => expect(hasKey("comments.loadMore")).toBe(true));

    const deferred: { resolve: () => void } = { resolve: () => {} };
    h.fetch.mockImplementation(
      () =>
        new Promise((res) => {
          deferred.resolve = () => res(h.page);
        }),
    );
    // Realtime: wstawka innego czytelnika unieważnia TO SAMO okno, więc lista
    // zostaje na ekranie, a przycisk „pokaż więcej" mówi, że trwa pobieranie.
    const notify = h.subscribe.mock.calls[0]?.[1];
    if (typeof notify !== "function") throw new Error("subskrypcja bez callbacku");
    await act(async () => {
      notify();
    });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "comments.loading" })).toBeDisabled(),
    );
    await act(async () => {
      deferred.resolve();
    });
  });
});

describe("dostępność sekcji komentarzy", () => {
  it("drzewo odpowiedzi z akcjami autora nie ma naruszeń axe", async () => {
    h.user = { id: USER_ID.author };
    h.page = { comments: threadRows(), topLevelCount: 1, approvedCount: 3 };

    const { container } = section();

    await waitFor(() => expect(screen.getByText("Odpowiedź druga")).toBeTruthy());
    const violations = await axeViolations(container);
    expect(summarize(violations)).toBe("");
  });

  it("kompozytor gościa z honeypotem i otwartym oknem odpowiedzi nie ma naruszeń axe", async () => {
    h.discussion = { ...h.discussion, require_login_to_comment: false };
    h.page = { comments: [threadRows()[0]!], topLevelCount: 1, approvedCount: 1 };

    const { container } = section();

    await waitFor(() => expect(screen.getByText("Wątek główny")).toBeTruthy());
    fireEvent.click(replyButtons()[0]!);
    await waitFor(() => expect(forms()).toHaveLength(2));

    const violations = await axeViolations(container);
    expect(summarize(violations)).toBe("");
  });
});
