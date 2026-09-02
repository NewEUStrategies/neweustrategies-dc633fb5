// Sekcja komentarzy - PRAWDZIWY stos kompozytora: `CommentComposerShell`
// (licznik znaków, limit 5000, `validateComposerValue`) plus `MentionTextarea`
// z podpowiedziami @wzmianek.
//
// DLACZEGO OSOBNY PLIK, A NIE KOLEJNE `describe` OBOK. Sąsiedni
// `CommentsSection.test.tsx` ATRAPUJE `MentionTextarea` gołą textareą - i słusznie,
// bo tam przedmiotem dowodu są decyzje wątku i moderacji, a prawdziwe pole tylko
// by je zaciemniło. Tu przedmiot jest odwrotny: chodzi o to, czy kompozytor
// komentarza NAPRAWDĘ spina pole wzmianek z wysyłką. Dwa różne przedmioty
// wymagają dwóch różnych zestawów atrap, a `vi.mock` obowiązuje CAŁY plik -
// stąd podział. Wspólne wiersze mieszkają w `@/test/comments/fixtures`.
//
// CO JEST TU ATRAPĄ I DLACZEGO:
//   * `useMentionSuggestions` - jedyne wyjście do sieci (RPC szukania osób).
//     Podpowiedzi są sterowane z testu; samo RPC pokrywa jego własny test.
//   * warstwa danych komentarzy, `useAuth`, ustawienia dyskusji, realtime,
//     toasty - jak w pliku sąsiednim.
//   * `react-i18next` NIE jest atrapowany w OGÓLE: etykieta pola wzmianek
//     i komunikat o limicie to napisy ze słownika, więc test ma je mierzyć,
//     a nie powtarzać za kodem. Skrót `vi.mock("react-i18next", ... i18nReal)`
//     jest tu NIEDOSTĘPNY - fabryka tego mocka importuje `@/lib/i18n`, a ten
//     importuje `react-i18next`, czyli moduł właśnie mockowany; przebieg wisi
//     bez jednej linii logu aż do zabicia procesu (sprawdzone na tym pliku,
//     ta sama pułapka co w `ConsentsPanel.test.tsx`). Czytamy więc TĘ SAMĄ
//     instancję i18next, której używa aplikacja, i pinujemy język.
//
// GRANICA DOWODU. Nie ma tu warstwy układu: happy-dom nie liczy pikseli, więc
// pozycja listy podpowiedzi i zawijanie licznika nie są przedmiotem asercji.
// Zakres znaków `maxLength` egzekwuje też przeglądarka - test sprawdza regułę
// aplikacji (blokada wysyłki), a nie zachowanie natywnego pola.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MentionSuggestion } from "@/lib/mentions/useMentionSuggestions";

const h = vi.hoisted(() => ({
  user: null as { id: string } | null,
  discussion: { allow_comments: true, require_login_to_comment: true, moderate_new_comments: true },
  page: { comments: [] as unknown[], topLevelCount: 0, approvedCount: 0 },
  suggestions: { rows: [] as MentionSuggestion[], fetching: false },
  createComment: vi.fn(),
  guestCreate: vi.fn(),
  editComment: vi.fn(),
  softDelete: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  confirm: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children?: unknown; to?: string }) => (
    <a href={to}>{children as never}</a>
  ),
}));
// Mock CZĘŚCIOWY: `@/lib/i18n` (ładowany tu naprawdę) sięga po
// `createIsomorphicFn` z tego samego pakietu, więc pełna podmiana zabiłaby
// tłumacza. Podmieniamy wyłącznie `useServerFn` - bramkę do server fn gościa.
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return { ...actual, useServerFn: () => h.guestCreate };
});
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock("@/lib/useSiteSetting", () => ({ useSiteSetting: () => h.discussion }));
vi.mock("@/lib/appDialogs", () => ({ confirmDialog: h.confirm }));
vi.mock("@/lib/realtime/tableChannelHub", () => ({ subscribeToTable: () => h.unsubscribe }));
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
vi.mock("@/lib/mentions/useMentionSuggestions", () => ({
  MENTION_SUGGESTION_LIMIT: 6,
  useMentionSuggestions: (query: string | null) => ({
    data: query === null ? [] : h.suggestions.rows,
    isFetching: h.suggestions.fetching,
  }),
}));

import { CommentsSection } from "@/components/comments/CommentsSection";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";
import { commentRow, POST_ID, USER_ID } from "@/test/comments/fixtures";

const t = realT("pl");

/** Zmyślone osoby do podpowiedzi - żadnych prawdziwych danych. */
const PEOPLE: MentionSuggestion[] = [
  { slug: "jan-testowy", name: "Jan Testowy", avatarUrl: null, subtitle: "Analityk" },
  { slug: "ola-przykladowa", name: "Ola Przykładowa", avatarUrl: null, subtitle: null },
];

function section() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<CommentsSection postId={POST_ID} lang="pl" />, { wrapper });
}

/**
 * Zmiana treści z JAWNĄ pozycją kursora. Przeglądarka przesuwa karetkę sama,
 * happy-dom nie - a bez karetki `findActiveMentionQuery` nie wie, czy token
 * „@..." jest tym, który użytkownik właśnie pisze.
 */
function type(box: HTMLElement, value: string) {
  fireEvent.change(box, {
    target: { value, selectionStart: value.length, selectionEnd: value.length },
  });
}

function composer(): HTMLTextAreaElement {
  return screen.getByRole("combobox");
}

function submitButton(): HTMLElement {
  return screen.getByRole("button", { name: t("comments.submit") });
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.user = { id: USER_ID.author };
  h.discussion = {
    allow_comments: true,
    require_login_to_comment: true,
    moderate_new_comments: true,
  };
  h.page = { comments: [], topLevelCount: 0, approvedCount: 0 };
  h.suggestions.rows = PEOPLE;
  h.suggestions.fetching = false;
  h.createComment.mockReset().mockResolvedValue(commentRow({ status: "approved" }));
  h.guestCreate.mockReset().mockResolvedValue({ ok: true, status: "approved" });
  h.editComment.mockReset().mockResolvedValue(commentRow());
  h.softDelete.mockReset().mockResolvedValue(undefined);
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.confirm.mockReset().mockResolvedValue(true);
});

describe("pole treści jest prawdziwym polem wzmianek", () => {
  it("etykieta pola pochodzi ze SŁOWNIKA i jest z polem spięta", async () => {
    section();

    // getByLabelText przechodzi tylko wtedy, gdy <label for> naprawdę wskazuje
    // to pole - czytnik ekranu przeczyta dokładnie ten napis.
    const box = await screen.findByLabelText(t("comments.placeholder"));
    expect(box).toBe(composer());
    expect(box.getAttribute("aria-autocomplete")).toBe("list");
    expect(box.getAttribute("aria-expanded")).toBe("false");
  });

  it("wpisanie @ otwiera listę osób, a wybór WSTAWIA slug do treści i do WYSYŁKI", async () => {
    section();
    const box = await waitFor(() => composer());

    type(box, "Zgadzam się z @jan");

    await waitFor(() => expect(screen.getByRole("listbox")).toBeTruthy());
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      expect.stringContaining("Jan Testowy"),
      expect.stringContaining("Ola Przykładowa"),
    ]);
    expect(box.getAttribute("aria-expanded")).toBe("true");

    fireEvent.mouseDown(screen.getByText("Jan Testowy"));

    await waitFor(() => expect(box.value).toBe("Zgadzam się z @jan-testowy "));
    fireEvent.submit(box.closest("form")!);

    // To jest właściwy dowód: `onChange` z MentionTextarea steruje stanem
    // kompozytora, więc wybrana wzmianka trafia do bazy, a nie tylko na ekran.
    await waitFor(() =>
      expect(h.createComment).toHaveBeenCalledWith({
        postId: POST_ID,
        body: "Zgadzam się z @jan-testowy ",
        parentId: null,
      }),
    );
  });

  it("bez aktywnej wzmianki lista nie wyskakuje", async () => {
    section();
    const box = await waitFor(() => composer());

    type(box, "Napisz do mnie na kontakt@example.com");

    await waitFor(() => expect(box.value).toContain("@example.com"));
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("limit długości i walidacja kompozytora", () => {
  it("licznik znaków pokazuje długość wobec limitu 5000", async () => {
    section();
    const box = await waitFor(() => composer());

    type(box, "Krótki komentarz");

    await waitFor(() => expect(screen.getByText("16/5000")).toBeTruthy());
  });

  it("PRZEKROCZENIE limitu blokuje wysyłkę i mówi dlaczego", async () => {
    section();
    const box = await waitFor(() => composer());

    type(box, "x".repeat(5001));

    await waitFor(() => expect(submitButton()).toBeDisabled());
    expect(screen.getByText(t("composer.status.tooLong", { count: 5000 }))).toBeTruthy();

    fireEvent.submit(box.closest("form")!);
    expect(h.createComment).not.toHaveBeenCalled();
  });

  it("dokładnie 5000 znaków JESZCZE przechodzi (kontrola dodatnia limitu)", async () => {
    section();
    const box = await waitFor(() => composer());

    type(box, "y".repeat(5000));

    await waitFor(() => expect(submitButton()).not.toBeDisabled());
  });

  it("sam BIAŁY ZNAK to pusto - wysyłka zablokowana", async () => {
    section();
    const box = await waitFor(() => composer());

    type(box, "   \n\t  ");

    await waitFor(() => expect(submitButton()).toBeDisabled());
    fireEvent.submit(box.closest("form")!);
    expect(h.createComment).not.toHaveBeenCalled();
  });

  it("pusty kompozytor startuje z zablokowaną wysyłką", async () => {
    section();

    await waitFor(() => expect(submitButton()).toBeDisabled());
  });
});

describe("kompozytor gościa: podpis obok treści", () => {
  beforeEach(() => {
    h.user = null;
    h.discussion = { ...h.discussion, require_login_to_comment: false };
  });

  function nameField(): HTMLElement {
    return screen.getByLabelText(t("comments.guestName"));
  }

  it("sama treść bez PODPISU nie wystarcza do wysyłki", async () => {
    section();
    const box = await waitFor(() => composer());

    type(box, "Komentarz bez podpisu");

    await waitFor(() => expect(submitButton()).toBeDisabled());
    // Jednoliterowy podpis to wciąż za mało (serwer wymaga dwóch znaków).
    fireEvent.change(nameField(), { target: { value: "K" } });
    await waitFor(() => expect(submitButton()).toBeDisabled());

    fireEvent.submit(box.closest("form")!);
    expect(h.guestCreate).not.toHaveBeenCalled();
  });

  it("podpis i treść razem odblokowują wysyłkę - z honeypotem w komplecie", async () => {
    section();
    const box = await waitFor(() => composer());

    type(box, "Komentarz gościa");
    fireEvent.change(nameField(), { target: { value: "Kasia Zmyślona" } });

    await waitFor(() => expect(submitButton()).not.toBeDisabled());
    fireEvent.submit(box.closest("form")!);

    await waitFor(() =>
      expect(h.guestCreate).toHaveBeenCalledWith({
        data: {
          postId: POST_ID,
          body: "Komentarz gościa",
          authorName: "Kasia Zmyślona",
          parentId: null,
          website: "",
        },
      }),
    );
  });
});

describe("dostępność prawdziwego kompozytora", () => {
  // ZNALEZISKO A11Y - ZGŁOSZONE, NIE UKRYTE, NIE NAPRAWIANE W TYM PAKIECIE.
  //
  // `useMentionAutocomplete` nakłada na <textarea> `role="combobox"`. ARIA nie
  // dopuszcza tej roli na polu wieloliniowym (jego rola własna to `textbox`),
  // więc axe zgłasza `aria-allowed-role` - i zgłasza ją ZAWSZE, także przy
  // zamkniętej liście podpowiedzi, bo rola jest stała.
  //
  // Dlaczego nie poprawka tutaj: rola pochodzi ze WSPÓŁDZIELONEGO hooka, z
  // którego korzysta również `MessageComposerField` (pole „wiadomość" w
  // widgetach formularzy). Zdjęcie roli oznacza przeprojektowanie sposobu
  // ogłaszania podpowiedzi (region `aria-live` zamiast wzorca combobox) oraz
  // przepisanie testów tamtego pakietu - to osobna praca, nie „minimalna
  // etykieta". Poniżej: dowód usterki i KONTROLA DODATNIA, że poza tą jedną
  // regułą kompozytor jest czysty.
  it.fails("pole wzmianek przechodzi audyt axe BEZ wyłączania reguł", async () => {
    const { container } = section();
    await waitFor(() => expect(composer()).toBeTruthy());

    const violations = await axeViolations(container);

    expect(summarize(violations)).toBe("");
  });

  it("KONTROLA DODATNIA: poza rolą pola wzmianek kompozytor zalogowanego jest czysty", async () => {
    const { container } = section();
    const box = await waitFor(() => composer());

    type(box, "@jan");
    await waitFor(() => expect(screen.getByRole("listbox")).toBeTruthy());

    // Etykieta pola, nazwy przycisków paska, lista opcji i powiązania ARIA -
    // wszystko poza samą rolą pola przechodzi audyt.
    const violations = await axeViolations(container, {
      "aria-allowed-role": { enabled: false },
    });
    expect(summarize(violations)).toBe("");
  });

  it("KONTROLA DODATNIA: kompozytor gościa z podpisem i honeypotem jest czysty", async () => {
    h.user = null;
    h.discussion = { ...h.discussion, require_login_to_comment: false };

    const { container } = section();
    await waitFor(() => expect(composer()).toBeTruthy());

    // Ukryte pole-pułapka nie może trafić do drzewa dostępności ani zabrać
    // fokusu - inaczej czytnik ekranu kazałby je wypełnić.
    const violations = await axeViolations(container, {
      "aria-allowed-role": { enabled: false },
    });
    expect(summarize(violations)).toBe("");
  });

  // DRUGIE ZNALEZISKO. `CommentsSection` liczy `bodyValidation.invalid` i
  // podaje je do `MentionTextarea` jako `invalid`, a ta ustawia
  // `aria-invalid` na `FloatingTextarea`. Atrybut GINIE: `FloatingTextarea`
  // rozwija `{...rest}` PRZED własnym `aria-invalid={error ? true : undefined}`,
  // więc późniejszy `undefined` kasuje przekazaną wartość. Skutek: czytnik
  // ekranu nie dowiaduje się, że treść przekroczyła limit - widzi tylko
  // nieaktywny przycisk. Naprawa jest w `src/components/ui/floating-input.tsx`,
  // czyli poza tym pakietem.
  it.fails("przekroczony limit oznacza pole jako aria-invalid", async () => {
    section();
    const box = await waitFor(() => composer());

    type(box, "x".repeat(5001));
    await waitFor(() => expect(submitButton()).toBeDisabled());

    expect(box.getAttribute("aria-invalid")).toBe("true");
  });

  it("KONTROLA DODATNIA: ten sam stan MA widoczny komunikat i blokadę wysyłki", async () => {
    section();
    const box = await waitFor(() => composer());

    type(box, "x".repeat(5001));

    await waitFor(() => expect(submitButton()).toBeDisabled());
    expect(screen.getByText(t("composer.status.tooLong", { count: 5000 }))).toBeTruthy();
  });
});
