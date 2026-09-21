// Głosowania w wątku: JEDNA ankieta (`ClubThreadPoll`) i panel wielu ankiet
// (`ClubThreadPollsPanel`).
//
// CO TEN PLIK DOWODZI.
//
//   1. KLUB NIE MA WŁASNEGO SILNIKA GŁOSOWANIA. Wątek `kind='poll'` i panel
//      „Głosowania” reużywają `polls`/`poll_votes` i ten sam `PollCard`, co
//      strona /polls - więc `ClubThreadPoll` jest ZŁĄCZEM, a jego reguła
//      brzmi: który wiersz z listy publicznej i który wpis z mapy wyników
//      trafia do karty. Tego dowodzimy tutaj, razem ze skutkami, które ten
//      wybór ma na ekranie.
//   2. ANTI-ANCHORING DZIAŁA OD PIERWSZEGO DNIA. Dopóki `vote_poll` nie
//      odda `visible`, rozkład głosów NIE MOŻE stać na ekranie - w klubie
//      deliberacyjnym to jest ważniejsze niż gdziekolwiek indziej, bo tu
//      głosuje się po przeczytaniu argumentów, a nie po zobaczeniu większości.
//   3. WYNIK PRZY ZERZE GŁOSÓW NIE DZIELI PRZEZ ZERO. Ankieta widoczna, ale
//      bez ani jednego głosu, pokazuje zera - nie `NaN%` i nie puste słupki.
//   4. ANKIETA ZAMKNIĘTA JEST DO CZYTANIA. Zamknięcie zdejmuje możliwość
//      oddania głosu, ale NIE zabiera wyniku - i mówi to wprost plakietką.
//   5. ANKIETA ZNIKNIĘTA Z LISTY PUBLICZNEJ TO NIE BŁĄD. Wątek zostaje,
//      głosowanie się skończyło - mówimy to zdaniem, a nie pustką.
//   6. FORMULARZ ZNA GRANICE BAZY: dwa do ośmiu wariantów i OBA języki pytania
//      (`polls.question_en` jest NOT NULL), więc odmowa nie przychodzi dopiero
//      po wysłaniu i po stracie tego, co redakcja wpisała.
//   7. ODPIĘCIE ANKIETY PRZECHODZI PRZEZ POTWIERDZENIE, a odmowa bazy wraca
//      jako KOD błędu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - MECHANIKI SAMEJ ANKIETY POZA KLUBEM: `PollCard` renderuje się PRAWDZIWY,
//   bo bez niego nie da się dowieść ani anti-anchoringu, ani zera głosów - ale
//   asercje dotyczą tego, co widzi CZŁONEK KLUBU, a nie wewnętrznego układu
//   karty. Warstwa danych (`fetchPublicPolls`, `fetchPollResults`, `votePoll`)
//   jest atrapą; jej kontrakt RPC ma własny zakres w Community.
// - `toClubWorkspaceError`: tabela przypadków w zakresie `threadWorkspaceTypes`.
//   Tutaj dowodzimy, że panel woła ją i pokazuje KLUCZ, nie napis z bazy.
// - KLUCZY CACHE'U: `clubWorkspaceHooks.test.tsx`. Tu sprawdzamy tylko to, że
//   ankieta klubowa czyta ten sam wpis, co strona /polls (jedno zapytanie na
//   listę publiczną niezależnie od liczby ankiet w wątku).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  toasts: [] as { level: "success" | "error"; key: string }[],
  confirmed: true,
  /** Lista publiczna ankiet - jedna atrapa dla wszystkich ankiet wątku. */
  polls: vi.fn(),
  /** Mapa wyników per identyfikator ankiety. */
  results: vi.fn(),
  /** Oddanie głosu: para (ankieta, indeks wariantu). */
  vote: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-club", () => ({ ensureClubI18n: () => undefined }));
// Import side-effectowy słownika Community: w produkcji rejestruje fragment
// i18n, w teście nie ma czego rejestrować - `t` jest echem klucza.
vi.mock("@/lib/i18n-community", () => ({}));
vi.mock("sonner", () => ({
  toast: {
    success: (key: string) => h.toasts.push({ level: "success", key }),
    error: (key: string) => h.toasts.push({ level: "error", key }),
  },
}));
vi.mock("@/lib/community/publicQueries", () => ({
  publicPollsQueryOptions: () => ({ queryKey: ["public-polls"], queryFn: () => h.polls() }),
  pollResultsQueryOptions: (pollIds: string[], userId: string | null) => ({
    queryKey: ["public-poll-results", pollIds.join(","), userId ?? "anon"],
    queryFn: () => h.results(),
  }),
  votePoll: (pollId: string, optionIdx: number) => h.vote(pollId, optionIdx),
}));
vi.mock("@/lib/clubs/threadWorkspaceApi", () => threadApiMock);

// KOLEJNOŚĆ IMPORTÓW JEST ZNACZĄCA - patrz `clubThreadPanels.test.tsx`.
import { resetThreadApiMock, threadApiMock } from "@/test/clubs/workspaceApiMock";
import { threadPollRow } from "@/test/clubs/threadWorkspaceFixtures";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ClubThreadPoll } from "@/components/clubs/organisms/ClubThreadPoll";
import { ClubThreadPollsPanel } from "@/components/clubs/organisms/ClubThreadPollsPanel";
import type { PollResults, PublicPoll } from "@/lib/community/publicQueries";

const THREAD = "thread-1";
const ME = "user-me";

const wLocie = () => new Promise<never>(() => {});
const odmowa = () => Promise.reject(new Error("club_thread_forbidden"));

function ladunek(mock: { mock: { calls: unknown[][] } }, index = 0): unknown {
  return mock.mock.calls[index]?.[0];
}

function publicPoll(overrides: Partial<PublicPoll> = {}): PublicPoll {
  return {
    id: "poll-1",
    question_pl: "Czy popierasz reformę?",
    question_en: "Do you support the reform?",
    options: [
      { pl: "Tak", en: "Yes" },
      { pl: "Nie", en: "No" },
    ],
    status: "open",
    ends_at: null,
    ...overrides,
  };
}

function pollResults(overrides: Partial<PollResults> = {}): PollResults {
  return { visible: false, my_vote: null, total: 0, counts: [], ...overrides };
}

/** Mapa wyników w kształcie, jaki oddaje `fetchPollResults`. */
function resultsMap(entries: [string, PollResults][]): Map<string, PollResults> {
  return new Map(entries);
}

beforeEach(() => {
  resetThreadApiMock();
  h.toasts = [];
  h.confirmed = true;
  h.polls.mockReset();
  h.results.mockReset();
  h.vote.mockReset();
  h.polls.mockResolvedValue([publicPoll()]);
  h.results.mockResolvedValue(resultsMap([["poll-1", pollResults()]]));
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
// Jedna ankieta
// ---------------------------------------------------------------------------

describe("ClubThreadPoll", () => {
  const renderPoll = (userId: string | null = ME) =>
    renderWithQueryClient(<ClubThreadPoll pollId="poll-1" lang="pl" userId={userId} />);

  it("lista publiczna w locie pokazuje zastępnik, a nie pustą kartę", () => {
    h.polls.mockReturnValue(wLocie());

    const { container } = renderPoll();

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("awaria LISTY ankiet daje komunikat awarii w wariancie sekcyjnym", async () => {
    h.polls.mockImplementation(odmowa);

    renderPoll();

    expect(await screen.findByRole("status")).toHaveTextContent("club.error.title");
    // Wariant `compact`: bez przycisku ponowienia, bo sondaż stoi wewnątrz wątku.
    expect(screen.queryByRole("button", { name: "club.error.retry" })).toBeNull();
  });

  it("awaria WYNIKÓW też jest awarią - karta bez rozkładu wprowadzałaby w błąd", async () => {
    h.results.mockImplementation(odmowa);

    renderPoll();

    expect(await screen.findByRole("status")).toHaveTextContent("club.error.title");
  });

  it("ankieta zniknięta z listy publicznej to koniec głosowania, nie błąd", async () => {
    h.polls.mockResolvedValue([publicPoll({ id: "poll-inna" })]);

    renderPoll();

    expect(await screen.findByText("club.poll.unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("przed oddaniem głosu rozkład jest UKRYTY - anti-anchoring", async () => {
    h.results.mockResolvedValue(resultsMap([["poll-1", pollResults({ visible: false })]]));

    renderPoll();

    expect(await screen.findByText("community.polls.resultsHidden")).toBeInTheDocument();
    expect(screen.queryByText(/totalVotes/)).toBeNull();
    // Warianty są klikalne, tylko bez liczb.
    expect(screen.getByRole("radio", { name: /Tak/ })).toBeEnabled();
  });

  it("klik na wariant oddaje głos DOKŁADNIE na ten indeks", async () => {
    h.vote.mockResolvedValue(pollResults({ visible: true, my_vote: 1, total: 1, counts: [0, 1] }));

    renderPoll();
    fireEvent.click(await screen.findByRole("radio", { name: /Nie/ }));

    await waitFor(() => expect(h.vote).toHaveBeenCalledWith("poll-1", 1));
  });

  it("zmiana głosu jedzie tym samym wywołaniem, tylko z innym indeksem", async () => {
    h.results.mockResolvedValue(
      resultsMap([
        ["poll-1", pollResults({ visible: true, my_vote: 0, total: 3, counts: [2, 1] })],
      ]),
    );
    h.vote.mockResolvedValue(pollResults({ visible: true, my_vote: 1, total: 3, counts: [1, 2] }));

    renderPoll();
    // Aktualny wybór jest ogłoszony przez `aria-checked` w grupie radiowej,
    // nie samym kolorem (opcje ankiety to wybór JEDNOKROTNY, nie przełączniki).
    const wybrany = await screen.findByRole("radio", { name: /Tak/ });
    expect(wybrany).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("radio", { name: /Nie/ }));

    await waitFor(() => expect(h.vote).toHaveBeenCalledWith("poll-1", 1));
  });

  it("odmowa oddania głosu wraca komunikatem, a nie ciszą", async () => {
    h.vote.mockRejectedValue(new Error("poll closed"));

    renderPoll();
    fireEvent.click(await screen.findByRole("radio", { name: /Tak/ }));

    await waitFor(() =>
      expect(h.toasts).toEqual([{ level: "error", key: "community.polls.voteError" }]),
    );
  });

  it("wynik widoczny PRZY ZERZE GŁOSÓW pokazuje zera, nie NaN", async () => {
    // Dzielenie przez zero: `total = 0` przy `visible = true`.
    h.results.mockResolvedValue(
      resultsMap([["poll-1", pollResults({ visible: true, total: 0, counts: [0, 0] })]]),
    );

    const { container } = renderPoll();

    expect(await screen.findByText("community.polls.totalVotes(count=0)")).toBeInTheDocument();
    expect(container.textContent).not.toContain("NaN");
    expect(
      Array.from(container.querySelectorAll("span[style]")).map((n) => n.getAttribute("style")),
    ).toEqual(["width: 0%;", "width: 0%;"]);
  });

  it("ankieta ZAMKNIĘTA mówi to plakietką i nie przyjmuje głosu", async () => {
    h.polls.mockResolvedValue([publicPoll({ status: "closed" })]);
    h.results.mockResolvedValue(
      resultsMap([["poll-1", pollResults({ visible: true, total: 4, counts: [3, 1] })]]),
    );

    renderPoll();

    expect(await screen.findByText("community.polls.closed")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Tak/ })).toBeDisabled();
    // Zamknięcie zdejmuje głosowanie, ale NIE zabiera wyniku.
    expect(screen.getByText("community.polls.totalVotes(count=4)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /Tak/ }));
    expect(h.vote).not.toHaveBeenCalled();
  });

  it("gość widzi ankietę, ale zamiast głosowania dostaje zaproszenie do logowania", async () => {
    renderPoll(null);

    expect(await screen.findByText("community.polls.signInHint")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Tak/ })).toBeDisabled();
  });

  it("pytanie i warianty idą w języku interfejsu", async () => {
    renderWithQueryClient(<ClubThreadPoll pollId="poll-1" lang="en" userId={ME} />);

    expect(
      await screen.findByRole("heading", { name: "Do you support the reform?" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Yes/ })).toBeInTheDocument();
  });

  it("brak wpisu w mapie wyników nie wywraca karty - rozkład zostaje ukryty", async () => {
    h.results.mockResolvedValue(resultsMap([]));

    renderPoll();

    expect(await screen.findByText("community.polls.resultsHidden")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Panel wielu ankiet
// ---------------------------------------------------------------------------

describe("ClubThreadPollsPanel", () => {
  const renderPanel = (canCurate = true, userId: string | null = ME) =>
    renderWithQueryClient(
      <ClubThreadPollsPanel threadId={THREAD} lang="pl" userId={userId} canCurate={canCurate} />,
    );

  it("zapytanie w locie pokazuje zastępnik panelu", () => {
    threadApiMock.fetchClubThreadPolls.mockReturnValue(wLocie());

    const { container } = renderPanel();

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("awaria RPC daje komunikat z ponowieniem", async () => {
    threadApiMock.fetchClubThreadPolls.mockImplementation(odmowa);

    renderPanel();

    expect(await screen.findByText("club.error.title")).toBeInTheDocument();
    const przed = threadApiMock.fetchClubThreadPolls.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "club.error.retry" }));
    await waitFor(() =>
      expect(threadApiMock.fetchClubThreadPolls.mock.calls.length).toBeGreaterThan(przed),
    );
  });

  it("brak ankiet zaprasza KURATORA do założenia pierwszej", async () => {
    threadApiMock.fetchClubThreadPolls.mockResolvedValue([]);

    renderPanel(true);

    expect(await screen.findByText("club.workspace.polls.empty")).toBeInTheDocument();
    expect(screen.getByText("club.workspace.polls.emptyHint")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "club.workspace.polls.create" })).toBeInTheDocument();
  });

  it("brak ankiet u czytelnika nie zaprasza do niczego", async () => {
    threadApiMock.fetchClubThreadPolls.mockResolvedValue([]);

    renderPanel(false);

    expect(await screen.findByText("club.workspace.polls.emptyReadonly")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "club.workspace.polls.create" })).toBeNull();
  });

  it("etykieta krawędzi stoi nad ankietą, a stan ankiety obok niej", async () => {
    threadApiMock.fetchClubThreadPolls.mockResolvedValue([
      threadPollRow({ label: "Rozstrzygnięcie nr 1" }),
    ]);

    renderPanel();

    expect(await screen.findByText("Rozstrzygnięcie nr 1")).toBeInTheDocument();
    expect(screen.getByText("club.workspace.polls.open")).toBeInTheDocument();
    // Karta ankiety dojechała z tej samej listy publicznej, co strona /polls.
    expect(
      await screen.findByRole("heading", { name: "Czy popierasz reformę?" }),
    ).toBeInTheDocument();
  });

  it("krawędź bez etykiety nie rysuje pustego napisu, a zamknięta ankieta ma swój stan", async () => {
    threadApiMock.fetchClubThreadPolls.mockResolvedValue([
      threadPollRow({ label: "", poll_status: "closed" }),
    ]);

    renderPanel();

    expect(await screen.findByText("club.workspace.polls.closed")).toBeInTheDocument();
    expect(screen.queryByText("club.workspace.polls.open")).toBeNull();
  });

  it("dwie ankiety w wątku czytają JEDNĄ listę publiczną, nie dwie", async () => {
    threadApiMock.fetchClubThreadPolls.mockResolvedValue([
      threadPollRow(),
      threadPollRow({ id: "thread-poll-2", poll_id: "poll-2" }),
    ]);
    h.polls.mockResolvedValue([
      publicPoll(),
      publicPoll({ id: "poll-2", question_pl: "Czy przyjąć stanowisko?" }),
    ]);
    h.results.mockResolvedValue(
      resultsMap([
        ["poll-1", pollResults()],
        ["poll-2", pollResults()],
      ]),
    );

    renderPanel();

    expect(
      await screen.findByRole("heading", { name: "Czy przyjąć stanowisko?" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Czy popierasz reformę?" })).toBeInTheDocument();
    // Wspólne `queryOptions` = jeden wpis cache'u na listę publiczną.
    expect(h.polls).toHaveBeenCalledTimes(1);
  });

  it("odmowa w okienku potwierdzenia NIE odpina ankiety", async () => {
    h.confirmed = false;
    threadApiMock.fetchClubThreadPolls.mockResolvedValue([threadPollRow()]);

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "club.workspace.polls.detach" }));

    expect(threadApiMock.detachClubThreadPoll).not.toHaveBeenCalled();
  });

  it("potwierdzone odpięcie woła RPC identyfikatorem KRAWĘDZI, nie ankiety", async () => {
    threadApiMock.fetchClubThreadPolls.mockResolvedValue([threadPollRow()]);
    threadApiMock.detachClubThreadPoll.mockResolvedValue(undefined);

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "club.workspace.polls.detach" }));

    await waitFor(() => expect(threadApiMock.detachClubThreadPoll).toHaveBeenCalled());
    expect(ladunek(threadApiMock.detachClubThreadPoll)).toBe("thread-poll-1");
    expect(h.toasts).toEqual([{ level: "success", key: "club.workspace.polls.detached" }]);
  });

  it("odmowa odpięcia wraca jako KOD błędu", async () => {
    threadApiMock.fetchClubThreadPolls.mockResolvedValue([threadPollRow()]);
    threadApiMock.detachClubThreadPoll.mockRejectedValue(new Error("club_thread_forbidden"));

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "club.workspace.polls.detach" }));

    await waitFor(() => expect(h.toasts).toHaveLength(1));
    expect(h.toasts[0].level).toBe("error");
    expect(h.toasts[0].key).toMatch(/^club\.workspace\.error\./);
  });

  it("krawędź bez prawa zdjęcia nie pokazuje przycisku odpięcia", async () => {
    threadApiMock.fetchClubThreadPolls.mockResolvedValue([threadPollRow({ can_remove: false })]);

    renderPanel();

    await screen.findByText("club.workspace.polls.open");
    expect(screen.queryByRole("button", { name: "club.workspace.polls.detach" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Formularz zakładania ankiety
// ---------------------------------------------------------------------------

describe("ClubThreadPollsPanel - zakładanie ankiety", () => {
  /** Otwiera panel z pustą listą i rozwija formularz. */
  async function otworzFormularz(): Promise<void> {
    threadApiMock.fetchClubThreadPolls.mockResolvedValue([]);
    renderWithQueryClient(
      <ClubThreadPollsPanel threadId={THREAD} lang="pl" userId={ME} canCurate />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "club.workspace.polls.create" }));
  }

  const przyciskZapisu = () =>
    screen.getAllByRole("button", { name: "club.workspace.polls.create" })[0];

  const warianty = () =>
    Array.from(document.querySelectorAll("fieldset input")) as HTMLInputElement[];

  it("formularz otwiera się z DWOMA wariantami - to minimum bazy", async () => {
    await otworzFormularz();

    expect(warianty()).toHaveLength(2);
    expect(screen.getByLabelText("club.workspace.polls.optionAria(index=1)")).toBeInTheDocument();
    // Przy minimum nie ma czego usuwać.
    expect(screen.queryByRole("button", { name: "club.workspace.polls.removeOption" })).toBeNull();
  });

  it("pytanie tylko po polsku NIE przechodzi - kolumna EN jest NOT NULL", async () => {
    await otworzFormularz();

    fireEvent.change(screen.getByLabelText("club.workspace.polls.questionPl"), {
      target: { value: "Czy popierasz reformę?" },
    });
    fireEvent.change(warianty()[0], { target: { value: "Tak" } });
    fireEvent.change(warianty()[1], { target: { value: "Nie" } });

    expect(przyciskZapisu()).toBeDisabled();
  });

  it("jeden wypełniony wariant NIE przechodzi - baza wymaga dwóch", async () => {
    await otworzFormularz();

    fireEvent.change(screen.getByLabelText("club.workspace.polls.questionPl"), {
      target: { value: "Czy popierasz reformę?" },
    });
    fireEvent.change(screen.getByLabelText("club.workspace.polls.questionEn"), {
      target: { value: "Do you support the reform?" },
    });
    fireEvent.change(warianty()[0], { target: { value: "Tak" } });
    fireEvent.change(warianty()[1], { target: { value: "   " } });

    expect(przyciskZapisu()).toBeDisabled();
  });

  it("wysyłka niepełnego formularza NIE woła RPC - `disabled` nie jest zabezpieczeniem", async () => {
    await otworzFormularz();

    const form = document.querySelector("form");
    if (form === null) throw new Error("brak formularza ankiety");
    fireEvent.submit(form);

    expect(threadApiMock.createClubThreadPoll).not.toHaveBeenCalled();
  });

  it("można dołożyć wariant i zdjąć DOKŁADNIE ten wskazany", async () => {
    await otworzFormularz();

    fireEvent.click(screen.getByRole("button", { name: "club.workspace.polls.addOption" }));
    expect(warianty()).toHaveLength(3);

    fireEvent.change(warianty()[0], { target: { value: "Pierwszy" } });
    fireEvent.change(warianty()[1], { target: { value: "Drugi" } });
    fireEvent.change(warianty()[2], { target: { value: "Trzeci" } });

    // Zdejmujemy ŚRODKOWY - zostają skrajne, a nie dwa pierwsze.
    fireEvent.click(
      screen.getAllByRole("button", { name: "club.workspace.polls.removeOption" })[1],
    );

    expect(warianty().map((input) => input.value)).toEqual(["Pierwszy", "Trzeci"]);
  });

  it("przy ośmiu wariantach nie ma jak dołożyć dziewiątego", async () => {
    await otworzFormularz();

    for (let i = 0; i < 6; i += 1) {
      fireEvent.click(screen.getByRole("button", { name: "club.workspace.polls.addOption" }));
    }

    expect(warianty()).toHaveLength(8);
    expect(screen.queryByRole("button", { name: "club.workspace.polls.addOption" })).toBeNull();
  });

  it("pełny formularz jedzie do RPC OBCIĘTY i bez wariantów pustych", async () => {
    threadApiMock.createClubThreadPoll.mockResolvedValue("poll-9");

    await otworzFormularz();
    fireEvent.click(screen.getByRole("button", { name: "club.workspace.polls.addOption" }));
    fireEvent.change(screen.getByLabelText("club.workspace.polls.questionPl"), {
      target: { value: "  Czy popierasz reformę?  " },
    });
    fireEvent.change(screen.getByLabelText("club.workspace.polls.questionEn"), {
      target: { value: "  Do you support the reform?  " },
    });
    fireEvent.change(warianty()[0], { target: { value: "  Tak  " } });
    fireEvent.change(warianty()[1], { target: { value: "Nie" } });
    fireEvent.change(warianty()[2], { target: { value: "  " } });

    fireEvent.click(przyciskZapisu());

    await waitFor(() => expect(threadApiMock.createClubThreadPoll).toHaveBeenCalled());
    expect(ladunek(threadApiMock.createClubThreadPoll)).toEqual({
      threadId: THREAD,
      questionPl: "Czy popierasz reformę?",
      questionEn: "Do you support the reform?",
      options: ["Tak", "Nie"],
    });
    await waitFor(() => expect(document.querySelector("form")).toBeNull());
    expect(h.toasts).toEqual([{ level: "success", key: "club.workspace.polls.created" }]);
  });

  it("odmowa założenia ZOSTAWIA formularz otwarty i pokazuje KOD błędu", async () => {
    threadApiMock.createClubThreadPoll.mockRejectedValue(new Error("club_thread_forbidden"));

    await otworzFormularz();
    fireEvent.change(screen.getByLabelText("club.workspace.polls.questionPl"), {
      target: { value: "Czy popierasz reformę?" },
    });
    fireEvent.change(screen.getByLabelText("club.workspace.polls.questionEn"), {
      target: { value: "Do you support the reform?" },
    });
    fireEvent.change(warianty()[0], { target: { value: "Tak" } });
    fireEvent.change(warianty()[1], { target: { value: "Nie" } });
    fireEvent.click(przyciskZapisu());

    await waitFor(() => expect(h.toasts).toHaveLength(1));
    expect(h.toasts[0].level).toBe("error");
    expect(h.toasts[0].key).toMatch(/^club\.workspace\.error\./);
    expect(document.querySelector("form")).not.toBeNull();
  });

  it("anulowanie zamyka formularz i przywraca przycisk założenia", async () => {
    await otworzFormularz();

    fireEvent.click(screen.getByRole("button", { name: "club.workspace.cancel" }));

    expect(document.querySelector("form")).toBeNull();
    expect(threadApiMock.createClubThreadPoll).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "club.workspace.polls.create" })).toBeInTheDocument();
  });
});
