// Cztery panele LISTOWE przestrzeni roboczej wątku: „Dokumenty”, „Pytania”,
// „Uczestnicy” i „Powiązane wątki”.
//
// CO TEN PLIK DOWODZI. Wszystkie cztery czytają jedno RPC i mają ten sam
// kształt propsów, więc łatwo je uznać za jeden komponent w czterech kopiach.
// Nie są - każdy niesie własną regułę produktu i ona jest tu przedmiotem
// dowodu:
//
//   1. TRZY STANY ZBIORU, NIE JEDEN. Każdy panel jedzie w wariancie „dane
//      pełne”, „dane puste” i „dane częściowe” (brak pola opcjonalnego), a
//      ponad tym w stanie „zapytanie w locie” i „awaria RPC”. To nie jest
//      kosmetyka: pusta lista i awaria muszą wyglądać INACZEJ, bo prowadzą do
//      innego działania - jedna zaprasza do wniesienia pozycji, druga do
//      ponowienia.
//   2. PUSTKA MÓWI, CO WOLNO. Podpowiedź pod „brak pozycji” zależy od prawa
//      zapisu: kto nie może nic dodać, nie ma dostać zaproszenia do dodania.
//   3. FILTR ROZJEŻDŻA SIĘ Z LISTĄ, GDY GO ZAWĘZISZ. Droplista rodzaju
//      dokumentu pojawia się dopiero przy dwóch rodzajach, ale po zawężeniu
//      MUSI zostać na ekranie - inaczej wybranie rodzaju kasuje kontrolkę,
//      którą właśnie kliknięto, i nie da się jej cofnąć.
//   4. USUNIĘCIE PRZECHODZI PRZEZ POTWIERDZENIE, a odmowa w okienku NIE
//      wysyła mutacji. Pozycja bibliograficzna cytowana w dyskusji znika
//      natychmiast, a cofnięcie wymaga moderatora.
//   5. ODMOWA BAZY WRACA JAKO KOD, nie jako polski napis: panele tłumaczą
//      błąd przez `toClubWorkspaceError`, więc test asertuje KLUCZ.
//   6. LICZNIK NAD LISTĄ PYTAŃ LICZY TO, CO WYMAGA DZIAŁANIA (bez odpowiedzi),
//      a nie wszystkiego.
//   7. KIERUNEK POWIĄZANIA JEST WIDOCZNY I DECYDUJE O PRAWIE: krawędź zdejmuje
//      się od strony wątku, który ją założył - przychodzącej nie skasujemy
//      stąd i baza też na to nie pozwoli.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - CZYSTYCH FUNKCJI: `toContributionBars`, `toClubDocumentKind`,
//   `toClubThreadRelation`, `toClubWorkspaceError` mają tabele przypadków
//   w zakresie `threadWorkspaceTypes`. Tutaj dowodzimy, że panel je WOŁA
//   i respektuje wynik.
// - MOLEKUŁ WIERSZA I FORMULARZA (`ClubDocumentRow`, `ClubQuestionCard`,
//   `ClubParticipantRow`, `ClubDocumentForm`): są atrapami wystawiającymi
//   swoje callbacki. Ich własne zachowanie (walidacja, kształt patcha,
//   formatowanie) ma zakres w `clubWorkspaceForms.test.tsx`
//   i `workspaceFormatting.test.ts`. `participantName` i `milestoneWhen`
//   zostają PRAWDZIWE, bo panele liczą z nich dane, nie tylko je rysują.
// - WARSTWY DANYCH: kluczy cache'u, bramek `enabled` i zakresu unieważnień
//   dowodzi `clubWorkspaceHooks.test.tsx`. Tutaj patrzymy wyłącznie na to,
//   z jakimi ARGUMENTAMI panel woła RPC i co robi z odpowiedzią.
// - RADIKSA: `Select` i `Switch` są podmienione na natywne odpowiedniki, bo
//   pod happy-dom nie otwierają listy ani nie przełączają się bez pełnego API
//   wskaźnika. Podmiana jest wierna w tym, na czym stoją asercje.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  /** Zebrane toasty - klucz i poziom, bo panel tłumaczy kod błędu. */
  toasts: [] as { level: "success" | "error"; key: string }[],
  /** Odpowiedź okienka potwierdzenia usunięcia. */
  confirmed: true,
  /** Propsy zapisane przez atrapę formularza dokumentu. */
  documentForm: null as Record<string, unknown> | null,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-club", () => ({ ensureClubI18n: () => undefined }));
vi.mock("sonner", () => ({
  toast: {
    success: (key: string) => h.toasts.push({ level: "success", key }),
    error: (key: string) => h.toasts.push({ level: "error", key }),
  },
}));
vi.mock("@/components/ui/select", async () =>
  (await import("@/test/reactStubs")).radixSelectStub(await import("react")),
);
vi.mock("@/components/ui/switch", async () =>
  (await import("@/test/reactStubs")).radixSwitchStub(await import("react")),
);
vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
vi.mock("@/lib/clubs/threadWorkspaceApi", () => threadApiMock);

// --- atrapy molekuł ---------------------------------------------------------
// Każda wystawia DOKŁADNIE te callbacki, które panel jej podaje, i nic więcej.
// Asercje stoją na tym, co panel z nimi robi.

vi.mock("@/components/clubs/molecules/ClubDocumentRow", () => ({
  ClubDocumentRow: ({
    row,
    lang,
    onEdit,
    onRemove,
  }: {
    row: { id: string; title: string; kind: string };
    lang: string;
    onEdit: (row: { id: string; title: string; kind: string }) => void;
    onRemove: (row: { id: string; title: string; kind: string }) => void;
  }) => (
    <li data-testid={`doc-${row.id}`} data-kind={row.kind} data-lang={lang}>
      {row.title}
      <button type="button" onClick={() => onEdit(row)}>{`edytuj ${row.id}`}</button>
      <button type="button" onClick={() => onRemove(row)}>{`usun ${row.id}`}</button>
    </li>
  ),
}));

vi.mock("@/components/clubs/molecules/ClubDocumentForm", () => ({
  ClubDocumentForm: (props: {
    threadId: string;
    initial: { id: string } | null;
    canCurate: boolean;
    pending: boolean;
    onCancel: () => void;
    onSubmit: (input: { title_pl: string }) => void;
  }) => {
    h.documentForm = { ...props };
    return (
      <div data-testid="doc-form" data-initial={props.initial?.id ?? ""}>
        <button type="button" onClick={() => props.onSubmit({ title_pl: "Nowa analiza" })}>
          zapisz dokument
        </button>
        <button type="button" onClick={props.onCancel}>
          anuluj dokument
        </button>
      </div>
    );
  },
}));

vi.mock("@/components/clubs/molecules/ClubQuestionCard", () => ({
  ClubQuestionCard: ({
    row,
    votePending,
    answerPending,
    onVote,
    onAnswer,
  }: {
    row: { id: string; body: string; status: string };
    votePending: boolean;
    answerPending: boolean;
    onVote: (on: boolean) => void;
    onAnswer: (text: string) => void;
  }) => (
    <li
      data-testid={`q-${row.id}`}
      data-status={row.status}
      data-vote-pending={String(votePending)}
      data-answer-pending={String(answerPending)}
    >
      {row.body}
      <button type="button" onClick={() => onVote(true)}>{`glosuj ${row.id}`}</button>
      <button type="button" onClick={() => onAnswer("Bo tak liczy operator.")}>
        {`odpowiedz ${row.id}`}
      </button>
    </li>
  ),
}));

vi.mock("@/components/clubs/molecules/ClubParticipantRow", async (importOriginal) => ({
  // `participantName` zostaje PRAWDZIWA: panel liczy z niej etykiety słupków
  // rozkładu wkładu, więc atrapa zabrałaby przedmiot dowodu.
  ...(await importOriginal<typeof import("@/components/clubs/molecules/ClubParticipantRow")>()),
  ClubParticipantRow: ({
    row,
  }: {
    row: { participant_key: string; display_name: string | null };
  }) => <li data-testid={`p-${row.participant_key}`}>{row.display_name ?? "?"}</li>,
}));

// KOLEJNOŚĆ IMPORTÓW JEST ZNACZĄCA: atrapa warstwy danych musi być
// zainicjalizowana, ZANIM graf modułów panelu pociągnie `threadWorkspaceApi`
// i odpali fabrykę `vi.mock`.
import { resetThreadApiMock, threadApiMock } from "@/test/clubs/workspaceApiMock";
import {
  threadDocumentRow,
  threadLinkRow,
  threadParticipantRow,
  threadQuestionRow,
  wsIsoOffset,
} from "@/test/clubs/threadWorkspaceFixtures";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ClubThreadDocumentsPanel } from "@/components/clubs/organisms/ClubThreadDocumentsPanel";
import { ClubThreadLinksPanel } from "@/components/clubs/organisms/ClubThreadLinksPanel";
import { ClubThreadParticipantsPanel } from "@/components/clubs/organisms/ClubThreadParticipantsPanel";
import { ClubThreadQuestionsPanel } from "@/components/clubs/organisms/ClubThreadQuestionsPanel";
import { CLUB_THREAD_DOCUMENT_KINDS } from "@/lib/clubs/workspaceTypes";

const THREAD = "thread-1";

/** Obietnica, która nigdy się nie rozwiązuje - stan „zapytanie w locie” bez zegarów. */
const wLocie = () => new Promise<never>(() => {});

/** Odmowa bazy w kształcie, jaki oddaje PostgREST. */
const odmowa = () => Promise.reject(new Error("club_thread_forbidden"));

/**
 * Pierwszy argument N-tego wywołania atrapy. `mutationFn` dostaje od
 * react-query DRUGI argument (kontekst z klientem), który nie należy do
 * kontraktu panelu - `toHaveBeenCalledWith` porównywałoby go razem z ładunkiem.
 */
function ladunek(mock: { mock: { calls: unknown[][] } }, index = 0): unknown {
  return mock.mock.calls[index]?.[0];
}

beforeEach(() => {
  resetThreadApiMock();
  h.toasts = [];
  h.confirmed = true;
  h.documentForm = null;
  // Panele pytają `window.confirm`, a happy-dom go nie implementuje.
  // Definiujemy WŁASNOŚĆ okna (a nie tylko globalną), bo tak brzmi wywołanie
  // w produkcji - `vi.stubGlobal` nie trafiłby w `window.confirm`.
  Object.defineProperty(window, "confirm", {
    configurable: true,
    writable: true,
    value: () => h.confirmed,
  });
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Dokumenty
// ---------------------------------------------------------------------------

describe("ClubThreadDocumentsPanel", () => {
  const renderPanel = (canContribute = true, canCurate = false) =>
    renderWithQueryClient(
      <ClubThreadDocumentsPanel
        threadId={THREAD}
        lang="pl"
        canContribute={canContribute}
        canCurate={canCurate}
      />,
    );

  it("zapytanie w locie pokazuje szkielet, a nie pustą bibliotekę", () => {
    threadApiMock.fetchClubThreadDocuments.mockReturnValue(wLocie());

    const { container } = renderPanel();

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText("club.workspace.documents.empty")).toBeNull();
  });

  it("awaria RPC daje komunikat z ponowieniem, nie pustkę", async () => {
    threadApiMock.fetchClubThreadDocuments.mockImplementation(odmowa);

    renderPanel();

    expect(await screen.findByText("club.error.title")).toBeInTheDocument();
    const przed = threadApiMock.fetchClubThreadDocuments.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "club.error.retry" }));
    await waitFor(() =>
      expect(threadApiMock.fetchClubThreadDocuments.mock.calls.length).toBeGreaterThan(przed),
    );
  });

  it("pusta biblioteka ZAPRASZA piszącego do wniesienia pierwszej pozycji", async () => {
    threadApiMock.fetchClubThreadDocuments.mockResolvedValue([]);

    renderPanel(true);

    expect(await screen.findByText("club.workspace.documents.empty")).toBeInTheDocument();
    expect(screen.getByText("club.workspace.documents.emptyHint")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "club.workspace.documents.addFirst" }),
    ).toBeInTheDocument();
  });

  it("pusta biblioteka czytelnika BEZ prawa zapisu nie zaprasza do niczego", async () => {
    threadApiMock.fetchClubThreadDocuments.mockResolvedValue([]);

    renderPanel(false);

    expect(await screen.findByText("club.workspace.documents.emptyReadonly")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "club.workspace.documents.addFirst" })).toBeNull();
    expect(screen.queryByRole("button", { name: /documents\.add$/ })).toBeNull();
  });

  it("jeden rodzaj na liście nie pokazuje droplisty, bo nie ma czego zawężać", async () => {
    threadApiMock.fetchClubThreadDocuments.mockResolvedValue([
      threadDocumentRow(),
      threadDocumentRow({ id: "doc-2", kind: "document", title: "Druga analiza" }),
    ]);

    renderPanel();

    await screen.findByTestId("doc-doc-1");
    expect(screen.queryByLabelText("club.workspace.documents.filterLabel")).toBeNull();
  });

  it("dwa rodzaje włączają droplistę z PEŁNYM słownikiem rodzajów", async () => {
    threadApiMock.fetchClubThreadDocuments.mockResolvedValue([
      threadDocumentRow(),
      threadDocumentRow({ id: "doc-2", kind: "note", title: "Notatka" }),
    ]);

    renderPanel();

    const filtr = await screen.findByLabelText("club.workspace.documents.filterLabel");
    const wartosci = Array.from(filtr.querySelectorAll("option")).map((o) => o.value);
    expect(wartosci).toEqual(["all", ...CLUB_THREAD_DOCUMENT_KINDS]);
  });

  it("zawężenie rodzaju idzie do RPC i ZOSTAWIA droplistę na ekranie", async () => {
    threadApiMock.fetchClubThreadDocuments.mockResolvedValue([
      threadDocumentRow(),
      threadDocumentRow({ id: "doc-2", kind: "note", title: "Notatka" }),
    ]);

    renderPanel();
    const filtr = await screen.findByLabelText("club.workspace.documents.filterLabel");

    // Po zawężeniu RPC dostaje JEDEN rodzaj, a lista schodzi do jednego wpisu.
    threadApiMock.fetchClubThreadDocuments.mockResolvedValue([
      threadDocumentRow({ id: "doc-2", kind: "note", title: "Notatka" }),
    ]);
    fireEvent.change(filtr, { target: { value: "note" } });

    await waitFor(() =>
      expect(threadApiMock.fetchClubThreadDocuments).toHaveBeenCalledWith(
        expect.objectContaining({ threadId: THREAD, kind: "note" }),
      ),
    );
    // Zawężenie to NOWY klucz cache'u, więc panel przechodzi przez szkielet -
    // czekamy na dojechanie zawężonej listy, zanim spytamy o kontrolkę.
    expect(await screen.findByTestId("doc-doc-2")).toBeInTheDocument();
    expect(screen.queryByTestId("doc-doc-1")).toBeNull();
    // Kontrolka MUSI zostać, choć w zawężonym zbiorze jest już JEDEN rodzaj:
    // inaczej nie dałoby się cofnąć własnego zawężenia.
    expect(screen.getByLabelText("club.workspace.documents.filterLabel")).toBeInTheDocument();
  });

  it("powrót do „wszystkie rodzaje” wysyła do RPC brak zawężenia", async () => {
    threadApiMock.fetchClubThreadDocuments.mockResolvedValue([
      threadDocumentRow(),
      threadDocumentRow({ id: "doc-2", kind: "note", title: "Notatka" }),
    ]);

    renderPanel();
    const filtr = await screen.findByLabelText("club.workspace.documents.filterLabel");
    fireEvent.change(filtr, { target: { value: "note" } });
    await waitFor(() => expect(threadApiMock.fetchClubThreadDocuments).toHaveBeenCalledTimes(2));

    fireEvent.change(await screen.findByLabelText("club.workspace.documents.filterLabel"), {
      target: { value: "all" },
    });

    await waitFor(() =>
      expect(threadApiMock.fetchClubThreadDocuments).toHaveBeenCalledWith(
        expect.objectContaining({ kind: null }),
      ),
    );
  });

  it("„dodaj” otwiera formularz PUSTY i chowa własny przycisk", async () => {
    threadApiMock.fetchClubThreadDocuments.mockResolvedValue([threadDocumentRow()]);

    renderPanel(true, true);
    await screen.findByTestId("doc-doc-1");

    fireEvent.click(screen.getByRole("button", { name: "club.workspace.documents.add" }));

    expect(screen.getByTestId("doc-form")).toHaveAttribute("data-initial", "");
    expect(screen.queryByRole("button", { name: "club.workspace.documents.add" })).toBeNull();
    // Prawo kuratorskie jedzie do formularza - od niego zależy `is_primary`.
    expect(h.documentForm).toMatchObject({ threadId: THREAD, canCurate: true, pending: false });
  });

  it("„edytuj” otwiera formularz Z WIERSZEM, a nie drugi pusty", async () => {
    threadApiMock.fetchClubThreadDocuments.mockResolvedValue([threadDocumentRow()]);

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "edytuj doc-1" }));

    expect(screen.getByTestId("doc-form")).toHaveAttribute("data-initial", "doc-1");
  });

  it("zapis udany zamyka formularz i potwierdza go komunikatem", async () => {
    threadApiMock.fetchClubThreadDocuments.mockResolvedValue([threadDocumentRow()]);
    threadApiMock.upsertClubThreadDocument.mockResolvedValue("doc-9");

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "edytuj doc-1" }));
    fireEvent.click(screen.getByRole("button", { name: "zapisz dokument" }));

    await waitFor(() => expect(screen.queryByTestId("doc-form")).toBeNull());
    expect(h.toasts).toEqual([{ level: "success", key: "club.workspace.documents.saved" }]);
  });

  it("odmowa zapisu ZOSTAWIA formularz otwarty i pokazuje KOD błędu", async () => {
    threadApiMock.fetchClubThreadDocuments.mockResolvedValue([threadDocumentRow()]);
    threadApiMock.upsertClubThreadDocument.mockRejectedValue(new Error("club_thread_forbidden"));

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "edytuj doc-1" }));
    fireEvent.click(screen.getByRole("button", { name: "zapisz dokument" }));

    await waitFor(() => expect(h.toasts).toHaveLength(1));
    expect(h.toasts[0].level).toBe("error");
    expect(h.toasts[0].key).toMatch(/^club\.workspace\.error\./);
    expect(screen.getByTestId("doc-form")).toBeInTheDocument();
  });

  it("anulowanie zamyka formularz bez wysyłki", async () => {
    threadApiMock.fetchClubThreadDocuments.mockResolvedValue([threadDocumentRow()]);

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "edytuj doc-1" }));
    fireEvent.click(screen.getByRole("button", { name: "anuluj dokument" }));

    expect(screen.queryByTestId("doc-form")).toBeNull();
    expect(threadApiMock.upsertClubThreadDocument).not.toHaveBeenCalled();
  });

  it("odmowa w okienku potwierdzenia NIE usuwa pozycji", async () => {
    h.confirmed = false;
    threadApiMock.fetchClubThreadDocuments.mockResolvedValue([threadDocumentRow()]);

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "usun doc-1" }));

    expect(threadApiMock.removeClubThreadDocument).not.toHaveBeenCalled();
    expect(h.toasts).toHaveLength(0);
  });

  it("potwierdzone usunięcie woła RPC z identyfikatorem wiersza", async () => {
    threadApiMock.fetchClubThreadDocuments.mockResolvedValue([threadDocumentRow()]);
    threadApiMock.removeClubThreadDocument.mockResolvedValue(undefined);

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "usun doc-1" }));

    await waitFor(() => expect(threadApiMock.removeClubThreadDocument).toHaveBeenCalled());
    expect(ladunek(threadApiMock.removeClubThreadDocument)).toBe("doc-1");
    expect(h.toasts).toEqual([{ level: "success", key: "club.workspace.documents.removed" }]);
  });

  it("odmowa usunięcia wraca jako KOD błędu", async () => {
    threadApiMock.fetchClubThreadDocuments.mockResolvedValue([threadDocumentRow()]);
    threadApiMock.removeClubThreadDocument.mockRejectedValue(new Error("club_thread_forbidden"));

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "usun doc-1" }));

    await waitFor(() => expect(h.toasts).toHaveLength(1));
    expect(h.toasts[0].level).toBe("error");
    expect(h.toasts[0].key).toMatch(/^club\.workspace\.error\./);
  });

  it("otwarty formularz zabiera zaproszenie z pustki - jedna droga wejścia naraz", async () => {
    threadApiMock.fetchClubThreadDocuments.mockResolvedValue([]);

    renderPanel(true);
    fireEvent.click(
      await screen.findByRole("button", { name: "club.workspace.documents.addFirst" }),
    );

    expect(screen.getByTestId("doc-form")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "club.workspace.documents.addFirst" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Pytania
// ---------------------------------------------------------------------------

describe("ClubThreadQuestionsPanel", () => {
  const renderPanel = (canContribute = true, canGoAnonymous = false) =>
    renderWithQueryClient(
      <ClubThreadQuestionsPanel
        threadId={THREAD}
        lang="pl"
        canContribute={canContribute}
        canGoAnonymous={canGoAnonymous}
      />,
    );

  it("zapytanie w locie pokazuje szkielet listy", () => {
    threadApiMock.fetchClubThreadQuestions.mockReturnValue(wLocie());

    const { container } = renderPanel();

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("awaria RPC daje komunikat z ponowieniem", async () => {
    threadApiMock.fetchClubThreadQuestions.mockImplementation(odmowa);

    renderPanel();

    expect(await screen.findByText("club.error.title")).toBeInTheDocument();
    const przed = threadApiMock.fetchClubThreadQuestions.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "club.error.retry" }));
    await waitFor(() =>
      expect(threadApiMock.fetchClubThreadQuestions.mock.calls.length).toBeGreaterThan(przed),
    );
  });

  it("licznik nad listą liczy pytania BEZ odpowiedzi, a nie wszystkie", async () => {
    threadApiMock.fetchClubThreadQuestions.mockResolvedValue([
      threadQuestionRow(),
      threadQuestionRow({ id: "question-2", status: "answered" }),
      threadQuestionRow({ id: "question-3", status: "open" }),
    ]);

    renderPanel();

    expect(
      await screen.findByText("club.workspace.questions.openCount(count=2)"),
    ).toBeInTheDocument();
  });

  it("brak pytań otwartych mówi to WPROST, a nie zerem", async () => {
    threadApiMock.fetchClubThreadQuestions.mockResolvedValue([
      threadQuestionRow({ status: "answered", answer_body: "Bo tak." }),
    ]);

    renderPanel();

    expect(await screen.findByText("club.workspace.questions.allAnswered")).toBeInTheDocument();
  });

  it("jedno pytanie nie dostaje droplisty sortowania - nie ma czego sortować", async () => {
    threadApiMock.fetchClubThreadQuestions.mockResolvedValue([threadQuestionRow()]);

    renderPanel();

    await screen.findByTestId("q-question-1");
    expect(screen.queryByLabelText("club.workspace.questions.sortLabel")).toBeNull();
  });

  it("domyślny sort to „najważniejsze”, a zmiana idzie do RPC", async () => {
    threadApiMock.fetchClubThreadQuestions.mockResolvedValue([
      threadQuestionRow(),
      threadQuestionRow({ id: "question-2" }),
    ]);

    renderPanel();
    const sort = await screen.findByLabelText("club.workspace.questions.sortLabel");

    expect(threadApiMock.fetchClubThreadQuestions).toHaveBeenCalledWith(
      expect.objectContaining({ sort: "top" }),
    );
    expect(Array.from(sort.querySelectorAll("option")).map((o) => o.value)).toEqual([
      "top",
      "newest",
      "unanswered",
    ]);

    fireEvent.change(sort, { target: { value: "unanswered" } });

    await waitFor(() =>
      expect(threadApiMock.fetchClubThreadQuestions).toHaveBeenCalledWith(
        expect.objectContaining({ sort: "unanswered" }),
      ),
    );
  });

  it("pusta lista zaprasza piszącego, a czytelnika informuje", async () => {
    threadApiMock.fetchClubThreadQuestions.mockResolvedValue([]);

    const { unmount } = renderPanel(true);
    expect(await screen.findByText("club.workspace.questions.emptyHint")).toBeInTheDocument();
    unmount();

    renderPanel(false);
    expect(await screen.findByText("club.workspace.questions.emptyReadonly")).toBeInTheDocument();
    // Bez prawa zapisu nie ma pola do zadania pytania.
    expect(screen.queryByLabelText("club.workspace.questions.askLabel")).toBeNull();
  });

  it("głos na pytanie idzie do RPC z identyfikatorem i kierunkiem", async () => {
    threadApiMock.fetchClubThreadQuestions.mockResolvedValue([threadQuestionRow()]);
    threadApiMock.voteClubThreadQuestion.mockResolvedValue(3);

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "glosuj question-1" }));

    await waitFor(() => expect(threadApiMock.voteClubThreadQuestion).toHaveBeenCalled());
    expect(ladunek(threadApiMock.voteClubThreadQuestion)).toEqual({
      questionId: "question-1",
      on: true,
    });
    // Udany głos nie krzyczy - liczba na karcie mówi wszystko.
    expect(h.toasts).toHaveLength(0);
  });

  it("odmowa głosu wraca jako KOD błędu", async () => {
    threadApiMock.fetchClubThreadQuestions.mockResolvedValue([threadQuestionRow()]);
    threadApiMock.voteClubThreadQuestion.mockRejectedValue(new Error("club_thread_forbidden"));

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "glosuj question-1" }));

    await waitFor(() => expect(h.toasts).toHaveLength(1));
    expect(h.toasts[0].level).toBe("error");
    expect(h.toasts[0].key).toMatch(/^club\.workspace\.error\./);
  });

  it("odpowiedź prowadzącego idzie do RPC i jest potwierdzana", async () => {
    threadApiMock.fetchClubThreadQuestions.mockResolvedValue([threadQuestionRow()]);
    threadApiMock.answerClubThreadQuestion.mockResolvedValue(undefined);

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "odpowiedz question-1" }));

    await waitFor(() => expect(threadApiMock.answerClubThreadQuestion).toHaveBeenCalled());
    expect(ladunek(threadApiMock.answerClubThreadQuestion)).toEqual({
      questionId: "question-1",
      body: "Bo tak liczy operator.",
    });
    expect(h.toasts).toEqual([{ level: "success", key: "club.workspace.questions.answerSaved" }]);
  });

  it("odmowa odpowiedzi wraca jako KOD błędu", async () => {
    threadApiMock.fetchClubThreadQuestions.mockResolvedValue([threadQuestionRow()]);
    threadApiMock.answerClubThreadQuestion.mockRejectedValue(new Error("club_thread_forbidden"));

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "odpowiedz question-1" }));

    await waitFor(() => expect(h.toasts).toHaveLength(1));
    expect(h.toasts[0].level).toBe("error");
  });

  it("pytanie krótsze niż pięć znaków nie da się wysłać", async () => {
    threadApiMock.fetchClubThreadQuestions.mockResolvedValue([]);

    renderPanel(true);
    const pole = await screen.findByLabelText("club.workspace.questions.askLabel");

    expect(screen.getByRole("button", { name: "club.workspace.questions.ask" })).toBeDisabled();
    fireEvent.change(pole, { target: { value: "  ok  " } });
    // Licznik liczy po obcięciu spacji - tak samo, jak walidacja.
    expect(screen.getByText("2 / 2000")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "club.workspace.questions.ask" })).toBeDisabled();
  });

  it("wysłane pytanie jedzie OBCIĘTE, a pole i alias wracają do zera", async () => {
    threadApiMock.fetchClubThreadQuestions.mockResolvedValue([]);
    threadApiMock.askClubThreadQuestion.mockResolvedValue("question-9");

    renderPanel(true, true);
    const pole = await screen.findByLabelText("club.workspace.questions.askLabel");
    fireEvent.change(pole, { target: { value: "  Jak liczycie koszt?  " } });
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "club.workspace.questions.ask" }));

    await waitFor(() => expect(threadApiMock.askClubThreadQuestion).toHaveBeenCalled());
    expect(ladunek(threadApiMock.askClubThreadQuestion)).toEqual({
      threadId: THREAD,
      body: "Jak liczycie koszt?",
      anonymous: true,
    });
    expect(h.toasts).toEqual([{ level: "success", key: "club.workspace.questions.asked" }]);
    await waitFor(() => expect(pole).toHaveValue(""));
    expect(screen.getByRole("switch")).not.toBeChecked();
  });

  it("odmowa wysyłki pytania NIE czyści tego, co wpisano", async () => {
    threadApiMock.fetchClubThreadQuestions.mockResolvedValue([]);
    threadApiMock.askClubThreadQuestion.mockRejectedValue(new Error("club_thread_forbidden"));

    renderPanel(true);
    const pole = await screen.findByLabelText("club.workspace.questions.askLabel");
    fireEvent.change(pole, { target: { value: "Jak liczycie koszt?" } });
    fireEvent.click(screen.getByRole("button", { name: "club.workspace.questions.ask" }));

    await waitFor(() => expect(h.toasts).toHaveLength(1));
    expect(h.toasts[0].level).toBe("error");
    expect(pole).toHaveValue("Jak liczycie koszt?");
  });

  it("klub bez atrybucji anonimowej nie pokazuje przełącznika aliasu", async () => {
    threadApiMock.fetchClubThreadQuestions.mockResolvedValue([]);

    renderPanel(true, false);

    await screen.findByLabelText("club.workspace.questions.askLabel");
    expect(screen.queryByRole("switch")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Uczestnicy
// ---------------------------------------------------------------------------

describe("ClubThreadParticipantsPanel", () => {
  const renderPanel = () =>
    renderWithQueryClient(<ClubThreadParticipantsPanel threadId={THREAD} lang="pl" />);

  it("zapytanie w locie pokazuje szkielet", () => {
    threadApiMock.fetchClubThreadParticipants.mockReturnValue(wLocie());

    const { container } = renderPanel();

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("awaria RPC daje komunikat z ponowieniem", async () => {
    threadApiMock.fetchClubThreadParticipants.mockImplementation(odmowa);

    renderPanel();

    expect(await screen.findByText("club.error.title")).toBeInTheDocument();
    const przed = threadApiMock.fetchClubThreadParticipants.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "club.error.retry" }));
    await waitFor(() =>
      expect(threadApiMock.fetchClubThreadParticipants.mock.calls.length).toBeGreaterThan(przed),
    );
  });

  it("wątek bez wypowiedzi mówi, że uczestników nie ma", async () => {
    threadApiMock.fetchClubThreadParticipants.mockResolvedValue([]);

    renderPanel();

    expect(await screen.findByText("club.workspace.participants.empty")).toBeInTheDocument();
    expect(screen.getByText("club.workspace.participants.emptyHint")).toBeInTheDocument();
  });

  it("jeden uczestnik NIE dostaje rozkładu wkładu - nie ma co porównywać", async () => {
    threadApiMock.fetchClubThreadParticipants.mockResolvedValue([threadParticipantRow()]);

    renderPanel();

    expect(await screen.findByTestId("p-user-member")).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "club.workspace.participants.distribution" }),
    ).toBeNull();
  });

  it("dwóch uczestników dostaje rozkład: udział liczony wobec SZCZYTU", async () => {
    threadApiMock.fetchClubThreadParticipants.mockResolvedValue([
      threadParticipantRow({ reply_count: 8 }),
      threadParticipantRow({
        participant_key: "user-lead",
        user_id: "user-lead",
        display_name: "Jan Kowalski",
        reply_count: 2,
      }),
    ]);

    const { container } = renderPanel();

    await screen.findByTestId("p-user-member");
    const slupki = Array.from(container.querySelectorAll("span[style]")).map((node) =>
      node.getAttribute("style"),
    );
    // Osiem wobec ośmiu to 100%, dwa wobec ośmiu to 25% - udział liczy się
    // wobec SZCZYTU, nie wobec sumy (dziesięciu) wypowiedzi.
    expect(slupki).toEqual(["width: 100%;", "width: 25%;"]);
    // Kolejność malejąca: rozkład odpowiada na „kto niesie tę rozmowę”.
    const rozklad = screen.getByRole("region", {
      name: "club.workspace.participants.distribution",
    });
    expect(
      Array.from(rozklad.querySelectorAll("li > span:first-child")).map((n) => n.textContent),
    ).toEqual(["Anna Nowak", "Jan Kowalski"]);
  });

  it("uczestnik bez nazwiska wchodzi do rozkładu pod aliasem albo etykietą braku", async () => {
    threadApiMock.fetchClubThreadParticipants.mockResolvedValue([
      threadParticipantRow({
        participant_key: "alias-1",
        user_id: null,
        display_name: null,
        alias: "Uczestnik A",
        reply_count: 5,
      }),
      threadParticipantRow({
        participant_key: "usuniety-1",
        user_id: null,
        display_name: null,
        alias: null,
        reply_count: 1,
      }),
    ]);

    renderPanel();

    await screen.findByTestId("p-alias-1");
    // `club.anonymousAuthor` nie ma w atrapie i18n miejsca na `{{alias}}`,
    // więc etykietą zostaje sam klucz - dowodem jest to, KTÓRY klucz.
    expect(screen.getByText("club.anonymousAuthor")).toBeInTheDocument();
    expect(screen.getByText("club.deletedAuthor")).toBeInTheDocument();
  });

  it("uczestnik z zerowym wkładem nie zaśmieca rozkładu", async () => {
    threadApiMock.fetchClubThreadParticipants.mockResolvedValue([
      threadParticipantRow({ reply_count: 4 }),
      threadParticipantRow({
        participant_key: "widz-1",
        user_id: "widz-1",
        display_name: "Widz",
        reply_count: 0,
        question_count: 0,
        document_count: 0,
      }),
    ]);

    const { container } = renderPanel();

    await screen.findByTestId("p-widz-1");
    // Dwa wiersze listy, ale rozkładu nie ma wcale: został jeden słupek.
    expect(container.querySelectorAll("span[style]")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Powiązane wątki
// ---------------------------------------------------------------------------

describe("ClubThreadLinksPanel", () => {
  const renderPanel = () =>
    renderWithQueryClient(<ClubThreadLinksPanel threadId={THREAD} lang="pl" />);

  it("zapytanie w locie pokazuje szkielet", () => {
    threadApiMock.fetchClubThreadLinks.mockReturnValue(wLocie());

    const { container } = renderPanel();

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("awaria RPC daje komunikat z ponowieniem", async () => {
    threadApiMock.fetchClubThreadLinks.mockImplementation(odmowa);

    renderPanel();

    expect(await screen.findByText("club.error.title")).toBeInTheDocument();
    const przed = threadApiMock.fetchClubThreadLinks.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "club.error.retry" }));
    await waitFor(() =>
      expect(threadApiMock.fetchClubThreadLinks.mock.calls.length).toBeGreaterThan(przed),
    );
  });

  it("brak powiązań mówi to wprost", async () => {
    threadApiMock.fetchClubThreadLinks.mockResolvedValue([]);

    renderPanel();

    expect(await screen.findByText("club.workspace.links.empty")).toBeInTheDocument();
    expect(screen.getByText("club.workspace.links.emptyHint")).toBeInTheDocument();
  });

  it("krawędź WYCHODZĄCA czyta się inaczej niż przychodząca i prowadzi do wątku", async () => {
    threadApiMock.fetchClubThreadLinks.mockResolvedValue([
      threadLinkRow({ note: "Wątek domykający ustalenia", last_reply_at: wsIsoOffset(-120) }),
    ]);

    renderPanel();

    expect(
      await screen.findByText("club.workspace.relation.outgoing.continues"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ciąg dalszy dyskusji" })).toHaveAttribute(
      "href",
      "/club/klub-energetyczny/t/ciag-dalszy",
    );
    expect(screen.getByText("club.kind.debate")).toBeInTheDocument();
    expect(screen.getByText("Wątek domykający ustalenia")).toBeInTheDocument();
    // Nazwa klubu i licznik odpowiedzi stoją w jednym akapicie z datą.
    expect(screen.getByText(/Klub energetyczny/)).toHaveTextContent("club.repliesCount(count=4)");
  });

  it("krawędź PRZYCHODZĄCA nie daje się skasować z tej strony", async () => {
    threadApiMock.fetchClubThreadLinks.mockResolvedValue([
      threadLinkRow({ direction: "incoming", can_remove: true }),
    ]);

    renderPanel();

    expect(
      await screen.findByText("club.workspace.relation.incoming.continues"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "club.workspace.remove" })).toBeNull();
  });

  it("wiersz bez notatki i bez ostatniej odpowiedzi nie rysuje pustych bloków", async () => {
    threadApiMock.fetchClubThreadLinks.mockResolvedValue([
      threadLinkRow({ note: "", last_reply_at: null, can_remove: false }),
    ]);

    const { container } = renderPanel();

    await screen.findByRole("link", { name: "Ciąg dalszy dyskusji" });
    // Dwa akapity byłyby, gdyby pusta notatka trafiła na ekran; jest jeden.
    expect(container.querySelectorAll("li p")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "club.workspace.remove" })).toBeNull();
  });

  it("relacja spoza słownika degraduje się, a nie wywraca ekranu", async () => {
    threadApiMock.fetchClubThreadLinks.mockResolvedValue([
      threadLinkRow({ relation: "z_nowszej_migracji" }),
    ]);

    renderPanel();

    expect(await screen.findByText("club.workspace.relation.outgoing.context")).toBeInTheDocument();
  });

  it("odmowa w okienku potwierdzenia NIE zdejmuje krawędzi", async () => {
    h.confirmed = false;
    threadApiMock.fetchClubThreadLinks.mockResolvedValue([threadLinkRow()]);

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "club.workspace.remove" }));

    expect(threadApiMock.removeClubThreadLink).not.toHaveBeenCalled();
  });

  it("potwierdzone zdjęcie krawędzi woła RPC i potwierdza komunikatem", async () => {
    threadApiMock.fetchClubThreadLinks.mockResolvedValue([threadLinkRow()]);
    threadApiMock.removeClubThreadLink.mockResolvedValue(undefined);

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "club.workspace.remove" }));

    await waitFor(() => expect(threadApiMock.removeClubThreadLink).toHaveBeenCalled());
    expect(ladunek(threadApiMock.removeClubThreadLink)).toBe("link-1");
    expect(h.toasts).toEqual([{ level: "success", key: "club.workspace.links.removed" }]);
  });

  it("odmowa zdjęcia krawędzi wraca jako KOD błędu", async () => {
    threadApiMock.fetchClubThreadLinks.mockResolvedValue([threadLinkRow()]);
    threadApiMock.removeClubThreadLink.mockRejectedValue(new Error("club_thread_forbidden"));

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "club.workspace.remove" }));

    await waitFor(() => expect(h.toasts).toHaveLength(1));
    expect(h.toasts[0].level).toBe("error");
    expect(h.toasts[0].key).toMatch(/^club\.workspace\.error\./);
  });
});
