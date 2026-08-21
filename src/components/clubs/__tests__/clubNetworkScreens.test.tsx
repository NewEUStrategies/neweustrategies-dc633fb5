// Dwa PEŁNE ekrany sieciujące klubu: tablica "szukam / oferuję"
// (`ClubBoardScreen`) i katalog ekspertów (`ClubExpertsScreen`).
//
// PO CO RAZEM. To jest ten sam organizm w dwóch wcieleniach: zawężenie
// (zakładka / chip / fraza) -> zapytanie -> strona wyników -> paginacja. Reguły,
// które muszą trzymać w obu, trzymają się tu obok siebie, a nie w dwóch
// plikach, w których druga kopia zestarzeje się cicho.
//
// CO TEN PLIK DOWODZI.
// (1) ZAWĘŻENIE DOJEŻDŻA DO WARSTWY DANYCH, a nie tylko podświetla chip.
//     Ekran filtrujący "na oczy" pokazuje pełną listę i wygląda jak zepsuty
//     filtr; dlatego asercje idą na ARGUMENTY `fetchClubBoardNotices`
//     i `fetchClubExperts`. Zakładka to nie filtr tej samej listy - trzy
//     zakładki to trzy różne pary flag (`mine`, `includeClosed`) i pomyłka
//     w nich pokazuje archiwum całego klubu tam, gdzie autor prosił o SWOJE.
// (2) KAŻDA ZMIANA ZAWĘŻENIA WRACA NA PIERWSZĄ STRONĘ. Bez tego filtr z trzema
//     wynikami pokazuje pustkę, bo czytelnik stał na stronie czwartej - a to
//     wygląda jak brak treści, nie jak koniec listy.
// (3) CZTERY STANY DANYCH, NIE JEDEN: zapytanie w locie (szkielety), awaria
//     (komunikat plus ponowienie, NIGDY "brak ogłoszeń"), pustka i pełna
//     strona. Pustka mówi TRZY różne rzeczy: "nic w twojej zakładce", "nic dla
//     tego zawężenia", "nic w klubie" - i to są trzy różne komunikaty.
// (4) WYNIK OGŁOSZENIA JEST INFORMACJĄ ZWROTNĄ: załatwione / wygasło / zdjęte
//     mają OSOBNE znaczniki, a ogłoszenie zamknięte nie dostaje przycisku
//     odpowiedzi ani przycisku zamknięcia (sprawa jest skończona, pisanie do
//     autora jest tylko kosztem dla niego).
// (5) UPRAWNIENIA DECYDUJĄ O TYM, CO EKRAN OFERUJE. Bez `canPost` nie ma
//     kompozytora, bez `canDeclare` nie ma edytora kompetencji, a przycisk
//     zamknięcia stoi WYŁĄCZNIE tam, gdzie RPC oddało `can_close` - inaczej
//     ekran obiecuje akcję, którą baza odrzuci.
// (6) ZAMKNIĘCIE MÓWI DWOMA GŁOSAMI: autor "załatwione", moderator "zdjęte" -
//     ten sam przycisk, dwa różne fakty, dwa różne komunikaty. Awaria mutacji
//     nie może zniknąć w ciszy.
// (7) CHIP FILTRA ISTNIEJE TYLKO DLA OBSZARU, KTÓRY MA CO POKAZAĆ - filtr
//     obiecujący pustkę jest gorszy niż brak filtra.
// (8) DOROBEK OBOK DEKLARACJI: karta eksperta niesie sumę wątków i odpowiedzi
//     oraz ostatnią aktywność, a osoba, która nigdy się nie odezwała, dostaje
//     WŁASNY komunikat, a nie datę zero.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// (a) Reguł czystych z `networkTypes.ts`: `noticeOutcome`, `noticeDaysLeft`,
//     `isNoticeExpiringSoon`, `toClubNoticeKind`, `expertContribution` mają
//     własny test jednostkowy. Tutaj widać ich SKUTEK na ekranie.
// (b) Hooków `useClubBoardNotices` / `useClubExperts` (klucze cache, `enabled`,
//     `staleTime`, mapowanie flag zakresu) - warstwa danych ma własne testy;
//     tu dowodzimy, że ekran WOŁA je z tym, co pokazuje.
// (c) Molekuł podrzędnych: `ClubBoardComposer`, `ClubExpertiseEditor`,
//     `ClubPersonCard`, `MessageOrConnectButton` są ATRAPAMI - każda ma własny
//     plik testowy, a tu przedmiotem dowodu jest to, CO ekran im podaje.
// (d) `ClubTopicChip` / `ClubTopicFilterChip` / `ClubNoticeKindPill` /
//     `ClubErrorNotice` - atomy z własnymi testami, użyte tu PRAWDZIWE, bo
//     asercje dotyczą ich stanu (`aria-pressed`), nie wyglądu.
// (e) Formatów daty i liczby - `Intl` zależy od ICU, nie od produktu. Asercje
//     idą na klucze i18n z parametrami.
//
// DETERMINIZM. `noticeDaysLeft`, `isNoticeExpiringSoon` i próg świeżości
// eksperta czytają zegar, więc czas jest ZAMROŻONY na `NET_BASE_ISO`
// (`toFake: ["Date"]` - liczniki `waitFor` zostają prawdziwe).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ClubBoardNoticeRow, ClubExpertRow } from "@/lib/clubs/networkTypes";

const h = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-club", () => ({ ensureClubI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));

vi.mock(
  "@/lib/clubs/networkApi",
  async () => (await import("@/test/clubs/workspaceApiMock")).networkApiMock,
);

// Katalog obszarów: ekran rysuje chipy Z ETYKIETAMI, a etykieta pusta znaczy
// "chip nie istnieje" (`ClubTopicChip` zwraca `null`) - więc atrapa katalogu
// jest warunkiem widoczności filtra obszaru, a nie ozdobą.
vi.mock("@/lib/clubs/topicsApi", () => ({
  fetchActiveClubTopics: vi.fn(async () => [
    { key: "energy", label_pl: "Energetyka", label_en: "Energy", sort_order: 10 },
    { key: "transport", label_pl: "Transport", label_en: "Transport", sort_order: 20 },
  ]),
  fetchAdminClubTopics: vi.fn(),
  upsertClubTopic: vi.fn(),
  setClubTopicActive: vi.fn(),
  deleteClubTopic: vi.fn(),
}));

// Fraza leci do RPC bez opóźnienia: `useDebouncedValue` opiera się na
// `setTimeout`, a testy tego modułu nie sterują zegarem timerów.
vi.mock("@/hooks/useDebouncedValue", () => ({
  useDebouncedValue: <T,>(value: T): T => value,
}));

vi.mock("@/components/network/MessageOrConnectButton", async () =>
  (await import("@/test/clubs/networkScreenStubs")).messageOrConnectStub(),
);
vi.mock("@/components/clubs/molecules/ClubPersonCard", async () =>
  (await import("@/test/clubs/networkScreenStubs")).personCardStub(),
);
vi.mock("@/components/clubs/molecules/ClubBoardPanel", () => ({
  ClubBoardComposer: ({ clubId, variant }: { clubId: string; variant?: string }) => (
    <div data-testid="kompozytor" data-club-id={clubId} data-variant={variant ?? ""} />
  ),
  ClubBoardPanel: (): ReactNode => null,
}));
vi.mock("@/components/clubs/molecules/ClubRosterPanel", () => ({
  ClubExpertiseEditor: ({ clubId, variant }: { clubId: string; variant?: string }) => (
    <div data-testid="edytor-kompetencji" data-club-id={clubId} data-variant={variant ?? ""} />
  ),
  ClubRosterPanel: (): ReactNode => null,
}));

import { ClubBoardScreen } from "@/components/clubs/organisms/ClubBoardScreen";
import { ClubExpertsScreen } from "@/components/clubs/organisms/ClubExpertsScreen";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { networkApiMock, resetNetworkApiMock } from "@/test/clubs/workspaceApiMock";
import {
  boardNoticeRow,
  expertiseArea,
  expertRow,
  NET_BASE_ISO,
  NET_IDS,
  netIsoDays,
  netIsoOffset,
} from "@/test/clubs/networkScreenFixtures";

/** Zapytanie, które NIGDY nie odpowiada - stan "w locie" bez sterowania czasem. */
function nigdy(): Promise<never> {
  return new Promise<never>(() => undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Ostatnie argumenty atrapy - kontrakt zawężenia. */
function lastArgs(mock: { mock: { calls: unknown[][] } }): Record<string, unknown> {
  const calls = mock.mock.calls;
  const args = calls[calls.length - 1]?.[0];
  if (!isRecord(args)) throw new Error("Brak wywołania warstwy danych z obiektem argumentów");
  return args;
}

beforeEach(() => {
  cleanup();
  resetNetworkApiMock();
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(NET_BASE_ISO) });
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tablica "szukam / oferuję"
// ---------------------------------------------------------------------------

function boardPage(rows: readonly ClubBoardNoticeRow[], total = rows.length) {
  return { rows: [...rows], total };
}

function renderBoard(canPost = true) {
  return renderWithQueryClient(<ClubBoardScreen clubId={NET_IDS.club} canPost={canPost} />);
}

describe("ClubBoardScreen - stany zapytania", () => {
  it("zapytanie w locie pokazuje szkielety, a nie komunikat o braku ogłoszeń", () => {
    networkApiMock.fetchClubBoardNotices.mockImplementation(nigdy);
    renderBoard();

    const busy = screen.getByRole("generic", { busy: true });
    expect(busy.children).toHaveLength(4);
    expect(screen.queryByText("club.network.board.empty")).not.toBeInTheDocument();
    expect(screen.queryByText(/club\.network\.board\.total/)).not.toBeInTheDocument();
  });

  it("awaria odczytu pokazuje komunikat błędu, a ponowienie odpytuje jeszcze raz", async () => {
    networkApiMock.fetchClubBoardNotices.mockRejectedValue(new Error("42501"));
    renderBoard();

    await waitFor(() => expect(screen.getByText("club.error.title")).toBeInTheDocument());
    // Awaria NIE MOŻE wyglądać jak pusta tablica - to dwie różne wiadomości.
    expect(screen.queryByText("club.network.board.empty")).not.toBeInTheDocument();

    const przed = networkApiMock.fetchClubBoardNotices.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /club\.error\.retry/ }));
    await waitFor(() =>
      expect(networkApiMock.fetchClubBoardNotices.mock.calls.length).toBeGreaterThan(przed),
    );
  });

  it("pusta tablica bez zawężenia mówi o pustym klubie", async () => {
    networkApiMock.fetchClubBoardNotices.mockResolvedValue(boardPage([]));
    renderBoard();

    await waitFor(() => expect(screen.getByText("club.network.board.empty")).toBeInTheDocument());
    expect(screen.queryByText("club.network.board.emptyFiltered")).not.toBeInTheDocument();
  });
});

describe("ClubBoardScreen - uprawnienia", () => {
  it("bez prawa pisania nie ma kompozytora", async () => {
    networkApiMock.fetchClubBoardNotices.mockResolvedValue(boardPage([]));
    renderBoard(false);

    await waitFor(() => expect(screen.getByText("club.network.board.empty")).toBeInTheDocument());
    expect(screen.queryByTestId("kompozytor")).not.toBeInTheDocument();
  });

  it("z prawem pisania kompozytor stoi OTWARTY na górze, w wariancie strony", async () => {
    networkApiMock.fetchClubBoardNotices.mockResolvedValue(boardPage([]));
    renderBoard(true);

    const composer = screen.getByTestId("kompozytor");
    expect(composer).toHaveAttribute("data-variant", "page");
    expect(composer).toHaveAttribute("data-club-id", NET_IDS.club);
    await waitFor(() => expect(screen.getByText("club.network.board.empty")).toBeInTheDocument());
  });
});

describe("ClubBoardScreen - pełna strona wyników", () => {
  const pelne = [
    boardNoticeRow({
      id: "notice-open",
      kind: "offering",
      body: "Oferuję dane o kosztach bilansowania.",
      expires_at: netIsoDays(20),
    }),
    boardNoticeRow({
      id: "notice-expiring",
      body: "Szukam recenzenta stanowiska.",
      topic: "transport",
      author_headline: null,
      expires_at: netIsoOffset(2 * 24 * 60),
    }),
    boardNoticeRow({
      id: "notice-mine",
      body: "Moje ogłoszenie do zamknięcia.",
      is_mine: true,
      can_close: true,
      topic: null,
    }),
    boardNoticeRow({ id: "notice-closed", status: "closed", closed_at: NET_BASE_ISO }),
    boardNoticeRow({ id: "notice-expired", is_expired: true, expires_at: netIsoDays(-1) }),
    boardNoticeRow({ id: "notice-removed", status: "removed", closed_at: NET_BASE_ISO }),
  ];

  beforeEach(() => {
    networkApiMock.fetchClubBoardNotices.mockResolvedValue(boardPage(pelne, 6));
  });

  it("liczy wszystkie ogłoszenia i rysuje po jednej karcie na wiersz", async () => {
    renderBoard();

    await waitFor(() =>
      expect(screen.getByText("club.network.board.total(count=6)")).toBeInTheDocument(),
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getByText("Oferuję dane o kosztach bilansowania.")).toBeInTheDocument();
  });

  it("każdy wynik ogłoszenia ma WŁASNY znacznik, a otwarte nie ma żadnego", async () => {
    renderBoard();

    await waitFor(() =>
      expect(screen.getByText("club.network.board.outcome.resolved")).toBeInTheDocument(),
    );
    expect(screen.getByText("club.network.board.outcome.expired")).toBeInTheDocument();
    expect(screen.getByText("club.network.board.outcome.removed")).toBeInTheDocument();
    // Trzy zamknięte na sześć wierszy - pozostałe trzy są otwarte i milczą.
    expect(screen.getAllByText(/club\.network\.board\.outcome\./)).toHaveLength(3);
  });

  it("ogłoszenie na ostatniej prostej ostrzega o dniach, pozostałe otwarte nie", async () => {
    renderBoard();

    await waitFor(() =>
      expect(screen.getByText("club.network.board.expiresIn(count=2)")).toBeInTheDocument(),
    );
    expect(screen.getAllByText(/club\.network\.board\.expiresIn/)).toHaveLength(1);
  });

  it("odpowiedź stoi tylko przy OTWARTYM ogłoszeniu kogoś innego", async () => {
    renderBoard();

    await waitFor(() => expect(screen.getAllByTestId("kontakt")).toHaveLength(2));
    for (const button of screen.getAllByTestId("kontakt")) {
      expect(button).toHaveAttribute("data-user-id", NET_IDS.member);
      expect(button).toHaveAttribute("data-display-name", "Anna Nowak");
      expect(button).toHaveAttribute("data-compact", "true");
    }
  });

  it("stanowisko autora pokazuje się tylko wtedy, gdy profil je ma", async () => {
    renderBoard();

    await waitFor(() => expect(screen.getAllByText("Analityk - NES")).toHaveLength(5));
    // Szósty wiersz to profil bez stanowiska: nazwisko jest, drugiej linijki nie
    // ma - i nie ma tam też pustego akapitu udającego stanowisko.
    const bezStanowiska = screen.getByText("Szukam recenzenta stanowiska.").closest("li");
    if (bezStanowiska === null) throw new Error("Brak wiersza ogłoszenia");
    expect(within(bezStanowiska).getByText("Anna Nowak")).toBeInTheDocument();
    expect(within(bezStanowiska).queryByText("Analityk - NES")).not.toBeInTheDocument();
  });

  it("chip obszaru filtra istnieje tylko dla obszarów obecnych na tablicy", async () => {
    const { container } = renderBoard();

    await waitFor(() =>
      expect(container.querySelectorAll("button[data-club-topic]")).toHaveLength(2),
    );
    expect(container.querySelector('button[data-club-topic="energy"]')).not.toBeNull();
    expect(container.querySelector('button[data-club-topic="transport"]')).not.toBeNull();
    // Obszar spoza tablicy nie ma chipu, choć siedzi w katalogu.
    expect(container.querySelector('button[data-club-topic="geopolitics"]')).toBeNull();
  });
});

describe("ClubBoardScreen - zawężanie", () => {
  const jeden = [boardNoticeRow({ topic: "energy" })];

  beforeEach(() => {
    networkApiMock.fetchClubBoardNotices.mockResolvedValue(boardPage(jeden, 30));
  });

  it("trzy zakładki to trzy różne pary flag zakresu", async () => {
    renderBoard();
    await waitFor(() => expect(networkApiMock.fetchClubBoardNotices).toHaveBeenCalled());
    expect(lastArgs(networkApiMock.fetchClubBoardNotices)).toMatchObject({
      clubId: NET_IDS.club,
      mine: false,
      includeClosed: false,
      limit: 24,
      offset: 0,
    });

    fireEvent.click(screen.getByRole("tab", { name: "club.network.board.scope.mine" }));
    await waitFor(() =>
      expect(lastArgs(networkApiMock.fetchClubBoardNotices)).toMatchObject({
        mine: true,
        includeClosed: true,
      }),
    );
    expect(screen.getByRole("tab", { name: "club.network.board.scope.mine" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "club.network.board.scope.open" })).toHaveAttribute(
      "aria-selected",
      "false",
    );

    fireEvent.click(screen.getByRole("tab", { name: "club.network.board.scope.archive" }));
    await waitFor(() =>
      expect(lastArgs(networkApiMock.fetchClubBoardNotices)).toMatchObject({
        mine: false,
        includeClosed: true,
      }),
    );
  });

  it("pusta zakładka MOJE mówi o mnie, a nie o klubie", async () => {
    renderBoard();
    await waitFor(() => expect(networkApiMock.fetchClubBoardNotices).toHaveBeenCalled());
    networkApiMock.fetchClubBoardNotices.mockResolvedValue(boardPage([]));

    fireEvent.click(screen.getByRole("tab", { name: "club.network.board.scope.mine" }));

    await waitFor(() =>
      expect(screen.getByText("club.network.board.emptyMine")).toBeInTheDocument(),
    );
    expect(screen.queryByText("club.network.board.empty")).not.toBeInTheDocument();
  });

  it("rodzaj przełącza się w obie strony: ustawiony i zdjęty ponownym kliknięciem", async () => {
    renderBoard();
    await waitFor(() => expect(networkApiMock.fetchClubBoardNotices).toHaveBeenCalled());

    const seeking = screen.getByRole("button", { name: "club.network.board.kind.seeking" });
    fireEvent.click(seeking);
    await waitFor(() =>
      expect(lastArgs(networkApiMock.fetchClubBoardNotices)).toMatchObject({ kind: "seeking" }),
    );
    expect(seeking).toHaveAttribute("aria-pressed", "true");

    // Ponowne kliknięcie ZDEJMUJE rodzaj. Nowego odczytu tu nie ma i nie ma
    // być: wynik dla pustego zawężenia siedzi w cache sprzed sekundy, więc
    // dowodem zdjęcia filtra jest stan chipów, a nie kolejne żądanie.
    fireEvent.click(seeking);
    await waitFor(() => expect(seeking).toHaveAttribute("aria-pressed", "false"));
    expect(screen.getByRole("button", { name: "club.network.board.filterAll" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("chip WSZYSTKIE zdejmuje rodzaj", async () => {
    renderBoard();
    await waitFor(() => expect(networkApiMock.fetchClubBoardNotices).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "club.network.board.kind.offering" }));
    await waitFor(() =>
      expect(lastArgs(networkApiMock.fetchClubBoardNotices)).toMatchObject({ kind: "offering" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "club.network.board.filterAll" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "club.network.board.kind.offering" }),
      ).toHaveAttribute("aria-pressed", "false"),
    );
    expect(screen.getByRole("button", { name: "club.network.board.filterAll" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("pusty wynik zawężenia mówi o ZAWĘŻENIU, nie o pustym klubie", async () => {
    const { container } = renderBoard();
    await waitFor(() =>
      expect(container.querySelector('button[data-club-topic="energy"]')).not.toBeNull(),
    );
    networkApiMock.fetchClubBoardNotices.mockResolvedValue(boardPage([]));

    const chip = container.querySelector('button[data-club-topic="energy"]');
    if (chip === null) throw new Error("Brak chipu obszaru");
    fireEvent.click(chip);

    await waitFor(() =>
      expect(lastArgs(networkApiMock.fetchClubBoardNotices)).toMatchObject({ topic: "energy" }),
    );
    await waitFor(() =>
      expect(screen.getByText("club.network.board.emptyFiltered")).toBeInTheDocument(),
    );
    expect(screen.queryByText("club.network.board.empty")).not.toBeInTheDocument();
  });

  it("zmiana zawężenia wraca na PIERWSZĄ stronę", async () => {
    renderBoard();
    await waitFor(() =>
      expect(screen.getByText("club.network.pageOf(page=1,pages=2)")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "club.network.next" }));
    await waitFor(() =>
      expect(lastArgs(networkApiMock.fetchClubBoardNotices)).toMatchObject({ offset: 24 }),
    );

    fireEvent.click(screen.getByRole("button", { name: "club.network.board.kind.seeking" }));
    await waitFor(() =>
      expect(lastArgs(networkApiMock.fetchClubBoardNotices)).toMatchObject({
        kind: "seeking",
        offset: 0,
      }),
    );
  });

  it("paginacja zna swoje krańce", async () => {
    renderBoard();
    await waitFor(() =>
      expect(screen.getByText("club.network.pageOf(page=1,pages=2)")).toBeInTheDocument(),
    );

    expect(screen.getByRole("button", { name: "club.network.prev" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "club.network.next" })).toBeEnabled();

    // Strona druga jest nowym kluczem odczytu, więc między kliknięciem
    // a wynikiem stoi szkielet - paginacja wraca dopiero z danymi.
    fireEvent.click(screen.getByRole("button", { name: "club.network.next" }));
    await waitFor(() =>
      expect(screen.getByText("club.network.pageOf(page=2,pages=2)")).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "club.network.next" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "club.network.prev" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "club.network.prev" }));
    await waitFor(() =>
      expect(screen.getByText("club.network.pageOf(page=1,pages=2)")).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "club.network.prev" })).toBeDisabled();
  });

  it("jedna strona wyników nie rysuje paginacji", async () => {
    networkApiMock.fetchClubBoardNotices.mockResolvedValue(boardPage(jeden, 1));
    renderBoard();

    await waitFor(() =>
      expect(screen.getByText("club.network.board.total(count=1)")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "club.network.next" })).not.toBeInTheDocument();
  });
});

describe("ClubBoardScreen - zamykanie ogłoszenia", () => {
  it("autor zamyka SWOJE jako załatwione", async () => {
    networkApiMock.fetchClubBoardNotices.mockResolvedValue(
      boardPage([boardNoticeRow({ is_mine: true, can_close: true })]),
    );
    networkApiMock.closeClubBoardNotice.mockResolvedValue(true);
    renderBoard();

    const button = await waitFor(() =>
      screen.getByRole("button", { name: "club.network.board.resolve" }),
    );
    fireEvent.click(button);

    // react-query dokłada mutacji drugi argument (kontekst) - kontraktem jest
    // PIERWSZY: identyfikator ogłoszenia, którego dotyczy gest.
    await waitFor(() =>
      expect(networkApiMock.closeClubBoardNotice.mock.calls[0]?.[0]).toBe(NET_IDS.notice),
    );
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("club.network.board.closed"));
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("moderator ZDEJMUJE cudze - ten sam przycisk, inny fakt", async () => {
    networkApiMock.fetchClubBoardNotices.mockResolvedValue(
      boardPage([boardNoticeRow({ is_mine: false, can_close: true })]),
    );
    networkApiMock.closeClubBoardNotice.mockResolvedValue(true);
    renderBoard();

    const button = await waitFor(() =>
      screen.getByRole("button", { name: "club.network.board.remove" }),
    );
    fireEvent.click(button);

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("club.network.board.removed"));
  });

  it("awaria zamknięcia nie znika w ciszy", async () => {
    networkApiMock.fetchClubBoardNotices.mockResolvedValue(
      boardPage([boardNoticeRow({ is_mine: true, can_close: true })]),
    );
    networkApiMock.closeClubBoardNotice.mockRejectedValue(new Error("42501"));
    renderBoard();

    fireEvent.click(
      await waitFor(() => screen.getByRole("button", { name: "club.network.board.resolve" })),
    );

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("club.network.board.closeFailed"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("bez `can_close` nie ma czym zamknąć - i nie ma przycisku", async () => {
    networkApiMock.fetchClubBoardNotices.mockResolvedValue(
      boardPage([boardNoticeRow({ is_mine: true, can_close: false })]),
    );
    renderBoard();

    await waitFor(() =>
      expect(screen.getByText("club.network.board.total(count=1)")).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "club.network.board.resolve" }),
    ).not.toBeInTheDocument();
    // Własne ogłoszenie nie dostaje też przycisku odpowiedzi do siebie samego.
    expect(screen.queryByTestId("kontakt")).not.toBeInTheDocument();
  });

  it("ogłoszenie ZAMKNIĘTE nie dostaje ani odpowiedzi, ani zamknięcia", async () => {
    networkApiMock.fetchClubBoardNotices.mockResolvedValue(
      boardPage([boardNoticeRow({ status: "closed", closed_at: NET_BASE_ISO, can_close: true })]),
    );
    renderBoard();

    await waitFor(() =>
      expect(screen.getByText("club.network.board.outcome.resolved")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("kontakt")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "club.network.board.remove" }),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Katalog ekspertów
// ---------------------------------------------------------------------------

function expertsPage(rows: readonly ClubExpertRow[], total = rows.length) {
  return { rows: [...rows], total };
}

function renderExperts(canDeclare = true) {
  return renderWithQueryClient(
    <ClubExpertsScreen clubId={NET_IDS.club} canDeclare={canDeclare} locale="pl-PL" />,
  );
}

describe("ClubExpertsScreen - stany zapytania", () => {
  beforeEach(() => {
    networkApiMock.fetchClubExpertiseAreas.mockResolvedValue([]);
  });

  it("zapytanie w locie pokazuje szkielety", () => {
    networkApiMock.fetchClubExperts.mockImplementation(nigdy);
    renderExperts();

    expect(screen.getByRole("generic", { busy: true }).children).toHaveLength(4);
    expect(screen.queryByText("club.network.experts.empty")).not.toBeInTheDocument();
  });

  it("awaria odczytu daje komunikat i ponowienie", async () => {
    networkApiMock.fetchClubExperts.mockRejectedValue(new Error("42501"));
    renderExperts();

    await waitFor(() => expect(screen.getByText("club.error.title")).toBeInTheDocument());
    const przed = networkApiMock.fetchClubExperts.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /club\.error\.retry/ }));
    await waitFor(() =>
      expect(networkApiMock.fetchClubExperts.mock.calls.length).toBeGreaterThan(przed),
    );
  });

  it("pusty katalog bez zawężenia mówi o klubie bez deklaracji", async () => {
    networkApiMock.fetchClubExperts.mockResolvedValue(expertsPage([]));
    renderExperts();

    await waitFor(() => expect(screen.getByText("club.network.experts.empty")).toBeInTheDocument());
    expect(screen.queryByText("club.network.experts.emptyFiltered")).not.toBeInTheDocument();
  });

  it("brak obszarów z licznikiem nie rysuje ANI JEDNEGO chipu filtra", async () => {
    networkApiMock.fetchClubExperts.mockResolvedValue(expertsPage([]));
    renderExperts();

    await waitFor(() => expect(screen.getByText("club.network.experts.empty")).toBeInTheDocument());
    expect(
      screen.queryByRole("button", { name: "club.network.experts.allAreas" }),
    ).not.toBeInTheDocument();
  });
});

describe("ClubExpertsScreen - uprawnienia", () => {
  beforeEach(() => {
    networkApiMock.fetchClubExpertiseAreas.mockResolvedValue([]);
    networkApiMock.fetchClubExperts.mockResolvedValue(expertsPage([]));
  });

  it("bez prawa deklaracji nie ma edytora kompetencji", async () => {
    renderExperts(false);

    await waitFor(() => expect(screen.getByText("club.network.experts.empty")).toBeInTheDocument());
    expect(screen.queryByTestId("edytor-kompetencji")).not.toBeInTheDocument();
  });

  it("z prawem deklaracji edytor stoi na górze, w wariancie strony", async () => {
    renderExperts(true);

    const editor = screen.getByTestId("edytor-kompetencji");
    expect(editor).toHaveAttribute("data-variant", "page");
    expect(editor).toHaveAttribute("data-club-id", NET_IDS.club);
    await waitFor(() => expect(screen.getByText("club.network.experts.empty")).toBeInTheDocument());
  });
});

describe("ClubExpertsScreen - karty i dorobek", () => {
  beforeEach(() => {
    networkApiMock.fetchClubExpertiseAreas.mockResolvedValue([
      expertiseArea({ topic: "energy", people: 3 }),
      expertiseArea({ topic: "transport", people: 1 }),
    ]);
  });

  it("dorobek to suma wątków i odpowiedzi, a ostatnia aktywność ma datę", async () => {
    networkApiMock.fetchClubExperts.mockResolvedValue(
      expertsPage([
        expertRow({ thread_count: 4, reply_count: 8, last_active_at: netIsoOffset(-60) }),
      ]),
    );
    renderExperts();

    await waitFor(() => expect(screen.getByTestId("karta-osoby")).toBeInTheDocument());
    const card = screen.getByTestId("karta-osoby");
    expect(card).toHaveAttribute("data-name", "Anna Nowak");
    expect(card).toHaveAttribute("data-headline", "Analityk - NES");
    expect(card).toHaveAttribute("data-slug", "anna-nowak");
    expect(card).toHaveAttribute("data-topics", "energy");
    expect(card).toHaveAttribute("data-role", "member");
    expect(card).toHaveTextContent("club.network.experts.contribution(count=12,value=12)");
    expect(card).toHaveTextContent(/club\.network\.experts\.lastActive/);
    // Odezwał się w ostatniej dobie - kropka obecności przy twarzy.
    expect(card).toHaveAttribute("data-active", "true");
    expect(within(card).getByTestId("kontakt")).toHaveAttribute("data-user-id", NET_IDS.member);
  });

  it("osoba, która nigdy się nie odezwała, dostaje WŁASNY komunikat, nie datę zero", async () => {
    networkApiMock.fetchClubExperts.mockResolvedValue(
      expertsPage([
        expertRow({ last_active_at: null, headline: null, profile_slug: null, topics: [] }),
      ]),
    );
    renderExperts();

    await waitFor(() => expect(screen.getByTestId("karta-osoby")).toBeInTheDocument());
    const card = screen.getByTestId("karta-osoby");
    expect(card).toHaveTextContent("club.network.experts.neverActive");
    expect(card).not.toHaveTextContent("club.network.experts.lastActive");
    expect(card).toHaveAttribute("data-active", "false");
    expect(card).toHaveAttribute("data-headline", "");
    expect(card).toHaveAttribute("data-slug", "");
    expect(card).toHaveAttribute("data-topics", "");
  });

  it("aktywność starsza niż doba nie zapala kropki obecności", async () => {
    networkApiMock.fetchClubExperts.mockResolvedValue(
      expertsPage([expertRow({ last_active_at: netIsoDays(-3) })]),
    );
    renderExperts();

    await waitFor(() => expect(screen.getByTestId("karta-osoby")).toBeInTheDocument());
    expect(screen.getByTestId("karta-osoby")).toHaveAttribute("data-active", "false");
    expect(screen.getByTestId("karta-osoby")).toHaveTextContent(
      /club\.network\.experts\.lastActive/,
    );
  });

  it("obszary jadą z licznikami, a filtr przełącza się w obie strony", async () => {
    networkApiMock.fetchClubExperts.mockResolvedValue(expertsPage([expertRow()], 1));
    renderExperts();

    const energy = await waitFor(() => screen.getByRole("button", { name: /Energetyka/ }));
    expect(energy).toHaveTextContent("3");
    expect(screen.getByRole("button", { name: /Transport/ })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: "club.network.experts.allAreas" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(energy);
    await waitFor(() =>
      expect(lastArgs(networkApiMock.fetchClubExperts)).toMatchObject({ topic: "energy" }),
    );
    expect(energy).toHaveAttribute("aria-pressed", "true");

    // Zdjęcie obszaru wraca do wyniku, który już jest w cache - dowodem jest
    // stan chipów, nie kolejne żądanie.
    fireEvent.click(energy);
    await waitFor(() => expect(energy).toHaveAttribute("aria-pressed", "false"));
    expect(screen.getByRole("button", { name: "club.network.experts.allAreas" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: /Transport/ }));
    await waitFor(() =>
      expect(lastArgs(networkApiMock.fetchClubExperts)).toMatchObject({ topic: "transport" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "club.network.experts.allAreas" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Transport/ })).toHaveAttribute(
        "aria-pressed",
        "false",
      ),
    );
  });
});

describe("ClubExpertsScreen - szukanie i paginacja", () => {
  beforeEach(() => {
    networkApiMock.fetchClubExpertiseAreas.mockResolvedValue([]);
    networkApiMock.fetchClubExperts.mockResolvedValue(expertsPage([expertRow()], 30));
  });

  it("fraza dojeżdża do RPC, a krzyżyk pojawia się dopiero z treścią pola", async () => {
    renderExperts();
    await waitFor(() => expect(networkApiMock.fetchClubExperts).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "club.searchClear" })).not.toBeInTheDocument();

    fireEvent.change(
      screen.getByRole("textbox", { name: "club.network.experts.searchPlaceholder" }),
      { target: { value: "bilansowanie" } },
    );

    await waitFor(() =>
      expect(lastArgs(networkApiMock.fetchClubExperts)).toMatchObject({ search: "bilansowanie" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "club.searchClear" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "club.searchClear" })).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("textbox", { name: "club.network.experts.searchPlaceholder" }),
    ).toHaveValue("");
  });

  it("pusty wynik frazy mówi o ZAWĘŻENIU, nie o pustym katalogu", async () => {
    renderExperts();
    await waitFor(() => expect(networkApiMock.fetchClubExperts).toHaveBeenCalled());
    networkApiMock.fetchClubExperts.mockResolvedValue(expertsPage([]));

    fireEvent.change(
      screen.getByRole("textbox", { name: "club.network.experts.searchPlaceholder" }),
      { target: { value: "nikt-taki" } },
    );

    await waitFor(() =>
      expect(screen.getByText("club.network.experts.emptyFiltered")).toBeInTheDocument(),
    );
    expect(screen.queryByText("club.network.experts.empty")).not.toBeInTheDocument();
  });

  it("nowa fraza wraca na PIERWSZĄ stronę", async () => {
    renderExperts();
    await waitFor(() =>
      expect(screen.getByText("club.network.pageOf(page=1,pages=2)")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "club.network.next" }));
    await waitFor(() =>
      expect(lastArgs(networkApiMock.fetchClubExperts)).toMatchObject({ offset: 24 }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "club.network.next" })).toBeDisabled(),
    );

    fireEvent.change(
      screen.getByRole("textbox", { name: "club.network.experts.searchPlaceholder" }),
      { target: { value: "energia" } },
    );
    await waitFor(() =>
      expect(lastArgs(networkApiMock.fetchClubExperts)).toMatchObject({
        search: "energia",
        offset: 0,
      }),
    );
  });

  it("cofnięcie strony wraca na poprzedni odcinek listy", async () => {
    renderExperts();
    await waitFor(() =>
      expect(screen.getByText("club.network.experts.total(count=30)")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "club.network.next" }));
    await waitFor(() =>
      expect(screen.getByText("club.network.pageOf(page=2,pages=2)")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "club.network.prev" }));
    await waitFor(() =>
      expect(screen.getByText("club.network.pageOf(page=1,pages=2)")).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "club.network.prev" })).toBeDisabled();
  });

  it("jedna strona wyników nie rysuje paginacji", async () => {
    networkApiMock.fetchClubExperts.mockResolvedValue(expertsPage([expertRow()], 1));
    renderExperts();

    await waitFor(() =>
      expect(screen.getByText("club.network.experts.total(count=1)")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "club.network.next" })).not.toBeInTheDocument();
  });
});
