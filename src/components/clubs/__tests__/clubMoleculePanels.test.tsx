// Trzy molekuły SIECIUJĄCE prawej szyny klubu: tablica ogłoszeń
// (`ClubBoardPanel` + `ClubBoardComposer`), skład z sygnałem obecności
// (`ClubRosterPanel` + `ClubExpertiseEditor`) i moduł „poznaj członka”
// (`ClubSpotlightPanel`).
//
// PO CO RAZEM. To są trzy panele tej samej szyny, czytające tę samą warstwę
// (`networkApi`) i podlegające tej samej doktrynie: panel bez treści ZNIKA,
// chyba że pustka sama jest informacją o klubie. Reguła „kiedy panel istnieje”
// trzyma się tu obok siebie w trzech wariantach, a nie w trzech plikach,
// w których dwie kopie zestarzeją się cicho.
//
// CO TEN PLIK DOWODZI.
// (1) KAŻDY PANEL MA CZTERY STANY, NIE JEDEN: zapytanie w locie (szkielet, a nie
//     komunikat o pustce), dane pełne, dane puste i dane CZĘŚCIOWE (brak
//     nagłówka osoby, brak opisu, brak twarzy, brak obszaru). Panel, który przy
//     braku pola opcjonalnego wypisuje gołe `undefined` albo znika, jest
//     usterką - i to jest tu asercja, nie komentarz.
// (2) PUSTA TABLICA OGŁOSZEŃ ZOSTAJE DLA TEGO, KTO MOŻE PISAĆ, a znika dla
//     widza: zaproszenie do napisania jest treścią, ukryty moduł nie jest
//     niczym. Dla widza panel milczy DOPIERO po odpowiedzi bazy - w locie
//     pokazuje szkielet, bo jeszcze nie wiadomo, czy tablica jest pusta.
// (3) LICZBA BEZ TWARZY JEST POPRAWNYM STANEM składu (klub ukrywający skład
//     oddaje liczby i zero awatarów), a sygnał „ktoś tu dziś był” dostaje
//     wyróżnienie WYŁĄCZNIE gdy jest niezerowy.
// (4) UPRAWNIENIA DECYDUJĄ O TYM, CO PANEL OFERUJE: bez `canPost` nie ma
//     kompozytora, bez `canDeclare` nie ma deklaracji kompetencji, bez
//     `canSeeMembers` nie ma skrótu do pełnego składu, a przycisk zdjęcia
//     cudzego ogłoszenia stoi TYLKO tam, gdzie RPC oddało `can_close`.
// (5) KAŻDY HANDLER JEST REALNIE WOŁANY: przełącznik kierunku, filtr kierunku,
//     pole treści, Enter w polu, publikacja, anulowanie, „załatwione”,
//     „zdejmij”, przełącznik obszaru kompetencji i zapis deklaracji. Panel,
//     w którym handler tylko się renderuje, jest panelem nieprzetestowanym.
// (6) MUTACJA MÓWI DWOMA GŁOSAMI - sukces i awaria mają OSOBNE komunikaty,
//     a limit otwartych ogłoszeń („too many open notices”) własny, bo to jedyna
//     awaria, którą autor może sam naprawić.
// (7) OGŁOSZENIE NA WYGAŚNIĘCIU mówi o tym wprost, a świeże milczy - tablica
//     bez wygaszania to tablica z zeszłego roku.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// (a) Reguł czystych z `networkTypes.ts`: `normalizeNoticeBody`,
//     `isNoticeBodyValid`, `noticeDaysLeft`, `isNoticeExpiringSoon`,
//     `toClubNoticeKind`, `spotlightBlurb`, `firstSentences`, `hasRosterContent`
//     i `rotateRosterFaces` mają własne testy jednostkowe. Tutaj widać ich
//     SKUTEK na ekranie.
// (b) Reguły limitu deklaracji - `src/lib/clubs/expertiseDraft.ts` ma tabelę
//     przypadków we własnym pliku; tu dowodzimy, że formularz jej używa
//     (wyłączony przycisk przy limicie, zwolnione miejsce po odznaczeniu).
// (c) Hooków `useClubBoardNotices` / `useClubRosterSignal` / `useClubSpotlight`
//     (klucze cache, `staleTime`, `enabled`) - warstwa danych ma własne testy.
// (d) `ClubRosterFaces` (rotacja twarzy, plakietka pod kursorem) i
//     `ClubTopicSelect` (Radix Select) są ATRAPAMI: pierwsza czyta zegar
//     i Radiksowy tooltip, druga nie działa pod happy-dom bez pointer API.
//     Obie mają własne pliki testowe, a przedmiotem dowodu jest tu to, CO
//     panel im podaje.
// (e) `MessageOrConnectButton` - atrapa, bo prawdziwy przycisk ciągnie stan
//     połączeń; sprawdzamy, KOMU panel go stawia.
// (f) Formatów liczby - `Intl` zależy od ICU, nie od produktu; liczby
//     w asercjach są jednocyfrowe i dwucyfrowe, więc separator nie wchodzi
//     w grę.
//
// ETYKIETY OBSZARÓW są DANYMI (wiersz `club_topics`), a nie tłumaczeniem -
// dlatego asercje o obszarze idą na atrybut `data-club-topic`, a tam gdzie
// widać sam napis, pochodzi on z atrapy katalogu w tym pliku.
//
// DETERMINIZM. `noticeDaysLeft` i `isNoticeExpiringSoon` czytają zegar, więc
// czas jest ZAMROŻONY na `NET_BASE_ISO` (`toFake: ["Date"]` - liczniki
// `waitFor` zostają prawdziwe).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type {
  ClubBoardNoticeRow,
  ClubRosterFace,
  ClubRosterSignal,
} from "@/lib/clubs/networkTypes";

const h = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  // Katalog obszarów jest DŁUŻSZY niż limit deklaracji (12), bo bez trzynastej
  // pozycji nie da się pokazać wyłączonego przycisku przy limicie.
  topics: [
    { key: "energy", label_pl: "Energetyka", label_en: "Energy", sort_order: 10 },
    { key: "transport", label_pl: "Transport", label_en: "Transport", sort_order: 20 },
    { key: "cyber", label_pl: "Cyber", label_en: "Cyber", sort_order: 30 },
    { key: "finance", label_pl: "Finanse", label_en: "Finance", sort_order: 40 },
    { key: "economy", label_pl: "Gospodarka", label_en: "Economy", sort_order: 50 },
    { key: "diplomacy", label_pl: "Dyplomacja", label_en: "Diplomacy", sort_order: 60 },
    { key: "culture", label_pl: "Kultura", label_en: "Culture", sort_order: 70 },
    { key: "health", label_pl: "Zdrowie", label_en: "Health", sort_order: 80 },
    { key: "climate", label_pl: "Klimat", label_en: "Climate", sort_order: 90 },
    { key: "defence", label_pl: "Obrona", label_en: "Defence", sort_order: 100 },
    { key: "digital", label_pl: "Cyfryzacja", label_en: "Digital", sort_order: 110 },
    { key: "trade", label_pl: "Handel", label_en: "Trade", sort_order: 120 },
    { key: "agriculture", label_pl: "Rolnictwo", label_en: "Agriculture", sort_order: 130 },
  ],
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
vi.mock(
  "@/lib/clubs/networkApi",
  async () => (await import("@/test/clubs/workspaceApiMock")).networkApiMock,
);
vi.mock("@/lib/clubs/topicsApi", () => ({
  fetchActiveClubTopics: vi.fn(async () => h.topics),
  fetchAdminClubTopics: vi.fn(),
  upsertClubTopic: vi.fn(),
  setClubTopicActive: vi.fn(),
  deleteClubTopic: vi.fn(),
}));
vi.mock("@/components/network/MessageOrConnectButton", async () =>
  (await import("@/test/clubs/networkScreenStubs")).messageOrConnectStub(),
);
// Radix Select nie działa pod happy-dom bez pełnego pointer API - atom
// zamieniamy na natywny `<select>`, bo dowodzimy tylko tego, że wybrany obszar
// dojeżdża do ładunku ogłoszenia.
vi.mock("@/components/clubs/molecules/ClubTopicSelect", () => ({
  ClubTopicSelect: ({
    value,
    onChange,
    disabled,
  }: {
    value: string | null;
    onChange: (value: string | null) => void;
    disabled?: boolean;
  }) => (
    <select
      data-testid="wybor-obszaru"
      disabled={disabled === true}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
    >
      <option value="" />
      <option value="energy">energy</option>
      <option value="transport">transport</option>
    </select>
  ),
}));
// Rząd twarzy czyta zegar (okno rotacji) i Radiksowy tooltip - ma własny plik
// testowy. Tu liczy się WYŁĄCZNIE to, co panel składu mu podaje.
vi.mock("@/components/clubs/molecules/ClubRosterFaces", () => ({
  ClubRosterFaces: ({
    faces,
    topicCatalog,
    className,
  }: {
    faces: readonly { userId: string }[];
    topicCatalog: readonly { key: string }[];
    className?: string;
  }) => (
    <div
      data-testid="twarze"
      data-liczba={String(faces.length)}
      data-katalog={String(topicCatalog.length)}
      data-class={className ?? ""}
    />
  ),
}));

import { ClubBoardComposer, ClubBoardPanel } from "@/components/clubs/molecules/ClubBoardPanel";
import { ClubExpertiseEditor, ClubRosterPanel } from "@/components/clubs/molecules/ClubRosterPanel";
import { ClubSpotlightPanel } from "@/components/clubs/molecules/ClubSpotlightPanel";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { networkApiMock, resetNetworkApiMock } from "@/test/clubs/workspaceApiMock";
import {
  boardNoticeRow,
  NET_BASE_ISO,
  NET_IDS,
  netIsoDays,
  spotlightRow,
} from "@/test/clubs/networkScreenFixtures";

const SLUG = "klub-energetyczny";

/** Zapytanie, które NIGDY nie odpowiada - stan „w locie” bez sterowania czasem. */
function nigdy(): Promise<never> {
  return new Promise<never>(() => undefined);
}

/** Strona tablicy w kształcie, jaki oddaje `fetchClubBoardNotices`. */
function stronaTablicy(rows: readonly ClubBoardNoticeRow[], total = rows.length) {
  return { rows: [...rows], total };
}

/** Jedna twarz składu - kształt `parseRosterFaces`, nie wiersz RPC. */
function twarz(overrides: Partial<ClubRosterFace> = {}): ClubRosterFace {
  return {
    userId: NET_IDS.member,
    name: "Anna Nowak",
    avatarUrl: null,
    slug: "anna-nowak",
    headline: "Analityk - NES",
    role: "member",
    joinedAt: NET_BASE_ISO,
    isNew: false,
    isActive: true,
    topics: ["energy"],
    ...overrides,
  };
}

function sygnalSkladu(overrides: Partial<ClubRosterSignal> = {}): ClubRosterSignal {
  return { membersTotal: 12, new7d: 2, active24h: 3, active7d: 5, faces: [twarz()], ...overrides };
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

// ===========================================================================
// 1) Tablica ogłoszeń - panel w szynie
// ===========================================================================

function renderTablice(canPost = true, className?: string) {
  return renderWithQueryClient(
    <ClubBoardPanel
      clubSlug={SLUG}
      clubId={NET_IDS.club}
      canPost={canPost}
      className={className}
    />,
  );
}

describe("ClubBoardPanel - stany zapytania i prawo głosu", () => {
  it("zapytanie w locie pokazuje szkielety, a nie komunikat o pustej tablicy", () => {
    networkApiMock.fetchClubBoardNotices.mockImplementation(nigdy);
    renderTablice();

    const busy = screen.getByRole("generic", { busy: true });
    expect(busy.children).toHaveLength(2);
    expect(screen.queryByText("club.network.board.empty")).not.toBeInTheDocument();
  });

  it("widz bez prawa głosu widzi szkielet w locie, a znika mu panel DOPIERO po pustej odpowiedzi", async () => {
    networkApiMock.fetchClubBoardNotices.mockImplementation(nigdy);
    const { container, unmount } = renderTablice(false);
    // Milczenie „na wszelki wypadek” schowałoby panel, który za chwilę ma treść.
    expect(screen.getByRole("generic", { busy: true })).toBeInTheDocument();
    unmount();

    networkApiMock.fetchClubBoardNotices.mockResolvedValue(stronaTablicy([]));
    const puste = renderTablice(false);
    await waitFor(() => expect(puste.container).toBeEmptyDOMElement());
    expect(container).toBeEmptyDOMElement();
  });

  it("pusta tablica ZOSTAJE dla tego, kto może pisać - zaproszenie jest treścią", async () => {
    networkApiMock.fetchClubBoardNotices.mockResolvedValue(stronaTablicy([]));
    renderTablice(true, "mt-3");

    await waitFor(() => expect(screen.getByText("club.network.board.empty")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /club\.network\.board\.add/ })).toBeInTheDocument();
    expect(document.querySelector("section")).toHaveClass("mt-3");
    // Skrót do pełnej tablicy stoi zawsze - także nad pustką.
    expect(screen.getByRole("link", { name: "club.hub.more" })).toHaveAttribute(
      "href",
      `/club/${SLUG}/board`,
    );
  });

  it("widz bez prawa głosu nie dostaje przycisku dodawania, ale widzi ogłoszenia", async () => {
    networkApiMock.fetchClubBoardNotices.mockResolvedValue(stronaTablicy([boardNoticeRow()]));
    renderTablice(false);

    await waitFor(() => expect(screen.getByText(boardNoticeRow().body)).toBeInTheDocument());
    expect(
      screen.queryByRole("button", { name: /club\.network\.board\.add/ }),
    ).not.toBeInTheDocument();
  });

  it("przycisk dodawania OTWIERA i ZAMYKA kompozytor, zmieniając własną etykietę", async () => {
    networkApiMock.fetchClubBoardNotices.mockResolvedValue(stronaTablicy([]));
    networkApiMock.fetchMyClubExpertise.mockResolvedValue([]);
    renderTablice();

    const dodaj = await screen.findByRole("button", { name: /club\.network\.board\.add/ });
    expect(dodaj).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(dodaj);

    expect(
      screen.getByRole("button", { name: /club\.network\.board\.cancel/, expanded: true }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("wybor-obszaru")).toBeInTheDocument();

    // Kompozytor ma WŁASNE anulowanie (bez `aria-expanded`) i ono też musi
    // zamknąć warstwę - inaczej „anuluj” w formularzu nic nie robi.
    const anulujWKompozytorze = screen
      .getAllByRole("button", { name: "club.network.board.cancel" })
      .find((node) => !node.hasAttribute("aria-expanded"));
    expect(anulujWKompozytorze).toBeDefined();
    fireEvent.click(anulujWKompozytorze!);
    expect(screen.queryByTestId("wybor-obszaru")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /club\.network\.board\.add/ }));
    fireEvent.click(
      screen.getByRole("button", { name: /club\.network\.board\.cancel/, expanded: true }),
    );
    expect(screen.queryByTestId("wybor-obszaru")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /club\.network\.board\.add/ })).toBeInTheDocument();
  });
});

describe("ClubBoardPanel - filtr kierunku", () => {
  const cztery = [
    boardNoticeRow({ id: "n-1", total_count: 4 }),
    boardNoticeRow({ id: "n-2", kind: "offering", total_count: 4 }),
    boardNoticeRow({ id: "n-3", total_count: 4 }),
    boardNoticeRow({ id: "n-4", total_count: 4 }),
  ];

  it("filtr pojawia się dopiero, gdy jest co odsiać, i DOJEŻDŻA do warstwy danych", async () => {
    networkApiMock.fetchClubBoardNotices.mockImplementation(
      async (params: { kind?: string | null }) =>
        params.kind === null || params.kind === undefined
          ? stronaTablicy(cztery, 4)
          : stronaTablicy([], 0),
    );
    renderTablice();

    const filtrWszystkie = await screen.findByRole("button", {
      name: "club.network.board.filterAll",
    });
    expect(filtrWszystkie).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "club.network.board.kind.offering" }));
    await waitFor(() =>
      expect(screen.getByText("club.network.board.emptyFiltered")).toBeInTheDocument(),
    );
    const ostatnie = networkApiMock.fetchClubBoardNotices.mock.calls.at(-1)?.[0];
    expect(ostatnie).toMatchObject({ clubId: NET_IDS.club, kind: "offering" });
    // Pustka po zawężeniu to INNA wiadomość niż pusty klub.
    expect(screen.queryByText("club.network.board.empty")).not.toBeInTheDocument();
  });

  it("krótka tablica nie dostaje filtra - filtr obiecujący pustkę jest gorszy niż jego brak", async () => {
    networkApiMock.fetchClubBoardNotices.mockResolvedValue(
      stronaTablicy([boardNoticeRow({ total_count: 3 })], 3),
    );
    renderTablice();

    await waitFor(() => expect(screen.getByText(boardNoticeRow().body)).toBeInTheDocument());
    expect(
      screen.queryByRole("button", { name: "club.network.board.filterAll" }),
    ).not.toBeInTheDocument();
  });

  it("powrót na „wszystkie” zdejmuje zawężenie BEZ ponownego pytania bazy", async () => {
    networkApiMock.fetchClubBoardNotices.mockResolvedValue(stronaTablicy(cztery, 4));
    renderTablice();

    fireEvent.click(await screen.findByRole("button", { name: "club.network.board.kind.seeking" }));
    await waitFor(() =>
      expect(networkApiMock.fetchClubBoardNotices.mock.calls.at(-1)?.[0]).toMatchObject({
        kind: "seeking",
      }),
    );
    // Nowe zawężenie to nowe zapytanie, więc filtr wraca dopiero z odpowiedzią.
    const wszystkie = await screen.findByRole("button", {
      name: "club.network.board.filterAll",
    });
    expect(wszystkie).toHaveAttribute("aria-pressed", "false");
    const wywolania = networkApiMock.fetchClubBoardNotices.mock.calls.length;

    fireEvent.click(wszystkie);
    await waitFor(() => expect(wszystkie).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    // Kierunek jedzie w KLUCZU zapytania, więc powrót do pełnej listy sięga po
    // wynik już wczytany - filtr, który za każdym powrotem odpytuje bazę,
    // miga pustką na powierzchni, na której świeżość jest treścią.
    expect(networkApiMock.fetchClubBoardNotices.mock.calls.length).toBe(wywolania);
  });
});

describe("ClubBoardPanel - wiersz ogłoszenia", () => {
  const moje = boardNoticeRow({
    id: "moje-1",
    is_mine: true,
    author_id: NET_IDS.me,
    author_name: "Ja Sam",
    author_headline: null,
    body: "Oferuję kontakt w DG ENER.",
    kind: "offering",
    topic: "transport",
    expires_at: netIsoDays(20),
  });
  const cudzeDoZdjecia = boardNoticeRow({
    id: "cudze-1",
    can_close: true,
    expires_at: netIsoDays(2),
  });
  const nieznanyKierunek = boardNoticeRow({
    id: "cudze-2",
    kind: "nieznany-kierunek",
    topic: null,
    expires_at: netIsoDays(20),
  });

  function renderWiersze() {
    networkApiMock.fetchClubBoardNotices.mockResolvedValue(
      stronaTablicy([moje, cudzeDoZdjecia, nieznanyKierunek], 3),
    );
    return renderTablice();
  }

  it("ogłoszenie na wygaśnięciu mówi o tym wprost, świeże milczy", async () => {
    renderWiersze();

    await waitFor(() =>
      expect(screen.getByText("club.network.board.expiresIn(count=2)")).toBeInTheDocument(),
    );
    // Trzy ogłoszenia, jedna adnotacja o wygaśnięciu.
    expect(screen.getAllByText(/club\.network\.board\.expiresIn/)).toHaveLength(1);
  });

  it("brak nagłówka autora i brak obszaru nie zostawiają pustych miejsc", async () => {
    renderWiersze();

    await waitFor(() => expect(screen.getByText(moje.body)).toBeInTheDocument());
    const wiersze = screen.getAllByRole("listitem");
    // Moje ogłoszenie: bez nagłówka autora, ale z obszarem „transport”.
    expect(within(wiersze[0]!).queryByText("Analityk - NES")).not.toBeInTheDocument();
    const chip = wiersze[0]!.querySelector("[data-club-topic]");
    expect(chip).toHaveAttribute("data-club-topic", "transport");
    expect(chip).toHaveTextContent("Transport");
    // Cudze z nagłówkiem, ostatnie bez obszaru - chip wtedy nie istnieje wcale.
    expect(within(wiersze[1]!).getByText("Analityk - NES")).toBeInTheDocument();
    expect(wiersze[2]!.querySelector("[data-club-topic]")).toBeNull();
  });

  it("nieznany kierunek z nowszej migracji degraduje do „szukam”, a nie wywraca wiersza", async () => {
    renderWiersze();

    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
    const pigulki = screen.getAllByText(/club\.network\.board\.kind\./);
    expect(pigulki.map((node) => node.textContent)).toEqual([
      "club.network.board.kind.offering",
      "club.network.board.kind.seeking",
      "club.network.board.kind.seeking",
    ]);
  });

  it("autor dostaje „załatwione”, obcy - przycisk kontaktu", async () => {
    renderWiersze();

    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
    const wiersze = screen.getAllByRole("listitem");
    expect(
      within(wiersze[0]!).getByRole("button", { name: "club.network.board.resolve" }),
    ).toBeInTheDocument();
    expect(within(wiersze[0]!).queryByTestId("kontakt")).not.toBeInTheDocument();

    const kontakt = within(wiersze[1]!).getByTestId("kontakt");
    expect(kontakt).toHaveAttribute("data-user-id", cudzeDoZdjecia.author_id);
    expect(kontakt).toHaveAttribute("data-compact", "true");
    expect(
      within(wiersze[1]!).queryByRole("button", { name: "club.network.board.resolve" }),
    ).not.toBeInTheDocument();
  });

  it("przycisk zdjęcia stoi WYŁĄCZNIE tam, gdzie RPC oddało `can_close`", async () => {
    renderWiersze();

    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
    const wiersze = screen.getAllByRole("listitem");
    expect(
      within(wiersze[1]!).getByRole("button", { name: "club.network.board.remove" }),
    ).toBeInTheDocument();
    expect(
      within(wiersze[2]!).queryByRole("button", { name: "club.network.board.remove" }),
    ).not.toBeInTheDocument();
    // Autor nie „zdejmuje” swojego - on je ZAŁATWIA.
    expect(
      within(wiersze[0]!).queryByRole("button", { name: "club.network.board.remove" }),
    ).not.toBeInTheDocument();
  });

  it("„załatwione” i „zdejmij” to DWA różne fakty i dwa różne komunikaty", async () => {
    networkApiMock.closeClubBoardNotice.mockResolvedValue(true);
    renderWiersze();

    fireEvent.click(await screen.findByRole("button", { name: "club.network.board.resolve" }));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("club.network.board.closed"));
    // Drugim argumentem `mutationFn` jest kontekst react-query - liczy się pierwszy.
    expect(networkApiMock.closeClubBoardNotice.mock.calls.at(-1)?.[0]).toBe(moje.id);

    fireEvent.click(screen.getByRole("button", { name: "club.network.board.remove" }));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("club.network.board.removed"));
    expect(networkApiMock.closeClubBoardNotice.mock.calls.at(-1)?.[0]).toBe(cudzeDoZdjecia.id);
  });

  it("awaria zamknięcia nie ginie w ciszy - i to ta sama wiadomość dla obu przycisków", async () => {
    networkApiMock.closeClubBoardNotice.mockRejectedValue(new Error("42501"));
    renderWiersze();

    fireEvent.click(await screen.findByRole("button", { name: "club.network.board.resolve" }));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("club.network.board.closeFailed"),
    );
    h.toastError.mockReset();

    fireEvent.click(screen.getByRole("button", { name: "club.network.board.remove" }));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("club.network.board.closeFailed"),
    );
  });

  it("zamykanie w locie blokuje OBA przyciski - podwójne kliknięcie nie zamyka dwa razy", async () => {
    networkApiMock.closeClubBoardNotice.mockImplementation(nigdy);
    renderWiersze();

    fireEvent.click(await screen.findByRole("button", { name: "club.network.board.resolve" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "club.network.board.resolve" })).toBeDisabled(),
    );
    expect(screen.getByRole("button", { name: "club.network.board.remove" })).toBeDisabled();
    expect(networkApiMock.closeClubBoardNotice).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// 2) Kompozytor ogłoszenia
// ===========================================================================

describe("ClubBoardComposer", () => {
  function renderKompozytor(onDone?: () => void, variant?: "rail" | "page") {
    return renderWithQueryClient(
      <ClubBoardComposer clubId={NET_IDS.club} onDone={onDone} variant={variant} />,
    );
  }

  const TRESC = "Szukam kontaktu w DG ENER na temat bilansowania.";

  it("na stronie kompozytor ma tytuł i lead, ale NIE MA czego anulować", () => {
    renderKompozytor(undefined, "page");

    expect(screen.getByText("club.network.board.composeTitle")).toBeInTheDocument();
    expect(screen.getByText("club.network.board.composeLead")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "club.network.board.cancel" }),
    ).not.toBeInTheDocument();
  });

  it("w szynie tytułu nie ma, a anulowanie oddaje sterowanie panelowi", () => {
    const onDone = vi.fn();
    renderKompozytor(onDone);

    expect(screen.queryByText("club.network.board.composeTitle")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "club.network.board.cancel" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("kierunek przestawia podpowiedź pola - to on przesądza, jak czyta się resztę", () => {
    renderKompozytor();

    const szukam = screen.getByRole("radio", { name: "club.network.board.kind.seeking" });
    const oferuje = screen.getByRole("radio", { name: "club.network.board.kind.offering" });
    expect(szukam).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("club.network.board.placeholder.seeking")).toBeInTheDocument();

    fireEvent.click(oferuje);
    expect(oferuje).toHaveAttribute("aria-checked", "true");
    expect(szukam).toHaveAttribute("aria-checked", "false");
    expect(screen.getByLabelText("club.network.board.placeholder.offering")).toBeInTheDocument();
  });

  it("licznik liczy treść PO normalizacji - to samo, co zobaczy baza", () => {
    renderKompozytor();

    const pole = screen.getByLabelText("club.network.board.placeholder.seeking");
    fireEvent.change(pole, { target: { value: "  dwa   slowa  " } });
    // „dwa slowa” = 9 znaków, a nie 15 wpisanych.
    expect(screen.getByText(/\/ 280/)).toHaveTextContent("9 / 280");
  });

  it("publikacja jest zablokowana, dopóki treść jest za krótka", () => {
    renderKompozytor();

    const publikuj = screen.getByRole("button", { name: "club.network.board.publish" });
    expect(publikuj).toBeDisabled();

    fireEvent.change(screen.getByLabelText("club.network.board.placeholder.seeking"), {
      target: { value: "krotkie" },
    });
    expect(publikuj).toBeDisabled();

    fireEvent.change(screen.getByLabelText("club.network.board.placeholder.seeking"), {
      target: { value: TRESC },
    });
    expect(publikuj).toBeEnabled();
  });

  it("ENTER publikuje, inny klawisz nie - jedna linia znaczy jeden gest", async () => {
    networkApiMock.createClubBoardNotice.mockResolvedValue("notice-nowe");
    renderKompozytor();

    const pole = screen.getByLabelText("club.network.board.placeholder.seeking");
    fireEvent.change(pole, { target: { value: TRESC } });
    fireEvent.keyDown(pole, { key: "a" });
    expect(networkApiMock.createClubBoardNotice).not.toHaveBeenCalled();

    fireEvent.keyDown(pole, { key: "Enter" });
    await waitFor(() => expect(networkApiMock.createClubBoardNotice).toHaveBeenCalledTimes(1));
  });

  it("ENTER na pustym polu nie wysyła niczego - próg treści obowiązuje oba wejścia", () => {
    renderKompozytor();

    fireEvent.keyDown(screen.getByLabelText("club.network.board.placeholder.seeking"), {
      key: "Enter",
    });
    expect(networkApiMock.createClubBoardNotice).not.toHaveBeenCalled();
  });

  it("ładunek niesie kierunek, treść PO normalizacji i wybrany obszar; po sukcesie pole jest puste", async () => {
    networkApiMock.createClubBoardNotice.mockResolvedValue("notice-nowe");
    const onDone = vi.fn();
    renderKompozytor(onDone);

    fireEvent.click(screen.getByRole("radio", { name: "club.network.board.kind.offering" }));
    fireEvent.change(screen.getByLabelText("club.network.board.placeholder.offering"), {
      target: { value: `   ${TRESC}   ` },
    });
    fireEvent.change(screen.getByTestId("wybor-obszaru"), { target: { value: "transport" } });
    fireEvent.click(screen.getByRole("button", { name: "club.network.board.publish" }));

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("club.network.board.published"),
    );
    expect(networkApiMock.createClubBoardNotice).toHaveBeenCalledWith({
      clubId: NET_IDS.club,
      kind: "offering",
      body: TRESC,
      topic: "transport",
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    // Pole i obszar wracają do stanu wyjściowego - kompozytor jest gotowy na
    // następne ogłoszenie, a nie na powtórzenie poprzedniego.
    expect(screen.getByLabelText("club.network.board.placeholder.offering")).toHaveValue("");
    expect(screen.getByTestId("wybor-obszaru")).toHaveValue("");
  });

  it("obszar można zdjąć z powrotem na „bez obszaru”", async () => {
    networkApiMock.createClubBoardNotice.mockResolvedValue("notice-nowe");
    renderKompozytor();

    fireEvent.change(screen.getByLabelText("club.network.board.placeholder.seeking"), {
      target: { value: TRESC },
    });
    const wybor = screen.getByTestId("wybor-obszaru");
    fireEvent.change(wybor, { target: { value: "energy" } });
    fireEvent.change(wybor, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "club.network.board.publish" }));

    await waitFor(() => expect(networkApiMock.createClubBoardNotice).toHaveBeenCalled());
    expect(networkApiMock.createClubBoardNotice).toHaveBeenCalledWith({
      clubId: NET_IDS.club,
      kind: "seeking",
      body: TRESC,
      topic: null,
    });
  });

  it("limit otwartych ogłoszeń dostaje WŁASNY komunikat - to jedyna awaria do samodzielnej naprawy", async () => {
    networkApiMock.createClubBoardNotice.mockRejectedValue(
      new Error("club_board_notice_create: too many open notices"),
    );
    renderKompozytor();

    fireEvent.change(screen.getByLabelText("club.network.board.placeholder.seeking"), {
      target: { value: TRESC },
    });
    fireEvent.click(screen.getByRole("button", { name: "club.network.board.publish" }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("club.network.board.tooMany"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("każda inna awaria mówi jednym głosem - także ta bez obiektu `Error`", async () => {
    networkApiMock.createClubBoardNotice.mockRejectedValue(new Error("42501"));
    const { unmount } = renderKompozytor();

    fireEvent.change(screen.getByLabelText("club.network.board.placeholder.seeking"), {
      target: { value: TRESC },
    });
    fireEvent.click(screen.getByRole("button", { name: "club.network.board.publish" }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("club.network.board.failed"));
    unmount();
    h.toastError.mockReset();

    // Awaria spoza `Error` (odrzucony napis z warstwy sieci) nie ma prawa
    // przemilczeć niepowodzenia.
    networkApiMock.createClubBoardNotice.mockRejectedValue("network down");
    renderKompozytor();
    fireEvent.change(screen.getByLabelText("club.network.board.placeholder.seeking"), {
      target: { value: TRESC },
    });
    fireEvent.click(screen.getByRole("button", { name: "club.network.board.publish" }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("club.network.board.failed"));
  });

  it("wysyłka w locie blokuje formularz i nie przyjmuje drugiego zgłoszenia", async () => {
    networkApiMock.createClubBoardNotice.mockImplementation(nigdy);
    const onDone = vi.fn();
    renderKompozytor(onDone);

    fireEvent.change(screen.getByLabelText("club.network.board.placeholder.seeking"), {
      target: { value: TRESC },
    });
    const publikuj = screen.getByRole("button", { name: "club.network.board.publish" });
    fireEvent.click(publikuj);

    await waitFor(() => expect(publikuj).toBeDisabled());
    expect(publikuj.querySelector("svg.animate-spin")).not.toBeNull();
    expect(screen.getByTestId("wybor-obszaru")).toBeDisabled();
    expect(screen.getByRole("button", { name: "club.network.board.cancel" })).toBeDisabled();

    // Enter w polu też nie ma prawa wysłać drugiego ogłoszenia.
    fireEvent.keyDown(screen.getByLabelText("club.network.board.placeholder.seeking"), {
      key: "Enter",
    });
    expect(networkApiMock.createClubBoardNotice).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3) Skład z sygnałem obecności
// ===========================================================================

function renderSklad(
  props: { canSeeMembers?: boolean; canDeclare?: boolean; locale?: string } = {},
) {
  return renderWithQueryClient(
    <ClubRosterPanel
      clubSlug={SLUG}
      clubId={NET_IDS.club}
      canSeeMembers={props.canSeeMembers ?? true}
      canDeclare={props.canDeclare ?? true}
      locale={props.locale ?? "pl"}
    />,
  );
}

describe("ClubRosterPanel", () => {
  it("zapytanie w locie pokazuje szkielet zamiast liczb", () => {
    networkApiMock.fetchClubRosterSignal.mockImplementation(nigdy);
    renderSklad();

    expect(screen.getByRole("generic", { busy: true })).toBeInTheDocument();
    expect(screen.queryByText("club.network.roster.total")).not.toBeInTheDocument();
  });

  it("klub bez składu (brak wiersza) nie zostawia po panelu ramki", async () => {
    networkApiMock.fetchClubRosterSignal.mockResolvedValue(null);
    const { container } = renderSklad();
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("sygnał bez ani jednej osoby i bez twarzy też znika - licznik zera nie jest treścią", async () => {
    networkApiMock.fetchClubRosterSignal.mockResolvedValue(
      sygnalSkladu({ membersTotal: 0, new7d: 0, active24h: 0, active7d: 0, faces: [] }),
    );
    const { container } = renderSklad();
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("LICZBY BEZ TWARZY są poprawnym stanem klubu, który ukrywa skład", async () => {
    networkApiMock.fetchClubRosterSignal.mockResolvedValue(sygnalSkladu({ faces: [] }));
    renderSklad({ canSeeMembers: false });

    await waitFor(() => expect(screen.getByText("club.network.roster.total")).toBeInTheDocument());
    expect(screen.getByTestId("twarze")).toHaveAttribute("data-liczba", "0");
    // Bez prawa do składu nie ma dokąd prowadzić skrótu.
    expect(screen.queryByRole("link", { name: "club.hub.more" })).not.toBeInTheDocument();
  });

  it("pełny sygnał podaje twarze rzędowi, katalog obszarów i wyróżnia niezerowe liczby", async () => {
    networkApiMock.fetchClubRosterSignal.mockResolvedValue(
      sygnalSkladu({ faces: [twarz(), twarz({ userId: NET_IDS.otherMember, name: "Jan" })] }),
    );
    renderSklad();

    await waitFor(() => expect(screen.getByTestId("twarze")).toBeInTheDocument());
    const twarze = screen.getByTestId("twarze");
    expect(twarze).toHaveAttribute("data-liczba", "2");
    expect(twarze).toHaveAttribute("data-katalog", String(h.topics.length));
    expect(twarze).toHaveAttribute("data-class", "mb-3");

    expect(screen.getByText("12")).toBeInTheDocument();
    // „Ktoś tu dziś był” jest SYGNAŁEM, więc dostaje wyróżnienie.
    expect(screen.getByText("3")).toHaveClass("text-primary");
    expect(screen.getByText("2")).toHaveClass("text-primary");
    expect(screen.getByRole("link", { name: "club.hub.more" })).toHaveAttribute(
      "href",
      `/club/${SLUG}/members`,
    );
  });

  it("cisza w klubie NIE dostaje wyróżnienia - zero nie jest sygnałem", async () => {
    networkApiMock.fetchClubRosterSignal.mockResolvedValue(
      sygnalSkladu({ active24h: 0, new7d: 0 }),
    );
    renderSklad();

    await waitFor(() => expect(screen.getByText("12")).toBeInTheDocument());
    const zera = screen.getAllByText("0");
    expect(zera).toHaveLength(2);
    for (const zero of zera) expect(zero).not.toHaveClass("text-primary");
  });

  it("deklaracja kompetencji jest dla członka, nie dla widza", async () => {
    networkApiMock.fetchClubRosterSignal.mockResolvedValue(sygnalSkladu());
    const { unmount } = renderSklad({ canDeclare: false });
    await waitFor(() => expect(screen.getByText("12")).toBeInTheDocument());
    expect(
      screen.queryByRole("button", { name: /club\.network\.expertise\.declare/ }),
    ).not.toBeInTheDocument();
    unmount();

    networkApiMock.fetchMyClubExpertise.mockResolvedValue([]);
    renderSklad({ canDeclare: true });
    const przycisk = await screen.findByRole("button", {
      name: /club\.network\.expertise\.declare/,
    });
    fireEvent.click(przycisk);

    // Formularz zastępuje przycisk, a nie stoi obok niego.
    expect(await screen.findByText("club.network.expertise.hint")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /club\.network\.expertise\.declare/ }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "club.network.board.cancel" }));
    expect(screen.queryByText("club.network.expertise.hint")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /club\.network\.expertise\.declare/ }),
    ).toBeInTheDocument();
  });
});

// ===========================================================================
// 4) Deklaracja kompetencji
// ===========================================================================

describe("ClubExpertiseEditor", () => {
  function renderEdytor(onDone?: () => void, variant?: "rail" | "page") {
    return renderWithQueryClient(
      <ClubExpertiseEditor clubId={NET_IDS.club} onDone={onDone} variant={variant} />,
    );
  }

  it("wariant stronowy ma własny tytuł i nie ma czego anulować", () => {
    networkApiMock.fetchMyClubExpertise.mockResolvedValue([]);
    renderEdytor(undefined, "page");

    expect(
      screen.getByRole("heading", { name: "club.network.expertise.declare" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "club.network.board.cancel" }),
    ).not.toBeInTheDocument();
  });

  it("lista opcji idzie z katalogu klubu w jego KOLEJNOŚCI, nie alfabetycznie", async () => {
    networkApiMock.fetchMyClubExpertise.mockResolvedValue([]);
    renderEdytor(vi.fn());

    await waitFor(() =>
      expect(screen.getAllByRole("button", { pressed: false })).toHaveLength(h.topics.length),
    );
    const etykiety = screen
      .getAllByRole("button", { pressed: false })
      .map((node) => node.textContent);
    expect(etykiety.slice(0, 3)).toEqual(["Energetyka", "Transport", "Cyber"]);
  });

  it("zapisane deklaracje wracają jako zaznaczone; zapytanie w locie zostawia pustą listę", async () => {
    networkApiMock.fetchMyClubExpertise.mockImplementation(nigdy);
    const { unmount } = renderEdytor(vi.fn());
    expect(screen.queryAllByRole("button", { pressed: true })).toHaveLength(0);
    unmount();

    networkApiMock.fetchMyClubExpertise.mockResolvedValue(["cyber"]);
    renderEdytor(vi.fn());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Cyber", pressed: true })).toBeInTheDocument(),
    );
  });

  it("przełącznik dodaje i zdejmuje obszar, a zapis wysyła CAŁY zbiór", async () => {
    networkApiMock.fetchMyClubExpertise.mockResolvedValue(["cyber"]);
    networkApiMock.setMyClubExpertise.mockResolvedValue(2);
    const onDone = vi.fn();
    renderEdytor(onDone);

    const cyber = await screen.findByRole("button", { name: "Cyber", pressed: true });
    fireEvent.click(screen.getByRole("button", { name: "Energetyka" }));
    expect(screen.getByRole("button", { name: "Energetyka", pressed: true })).toBeInTheDocument();

    fireEvent.click(cyber);
    expect(screen.getByRole("button", { name: "Cyber", pressed: false })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "club.network.expertise.save" }));
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("club.network.expertise.saved"),
    );
    expect(networkApiMock.setMyClubExpertise).toHaveBeenCalledWith(NET_IDS.club, ["energy"]);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("przy limicie deklaracji nieaktywne obszary są WYŁĄCZONE, a odznaczenie zwalnia miejsce", async () => {
    const dwanascie = h.topics.slice(0, 12).map((topic) => topic.key);
    networkApiMock.fetchMyClubExpertise.mockResolvedValue(dwanascie);
    renderEdytor(vi.fn());

    const trzynasty = await screen.findByRole("button", { name: "Rolnictwo" });
    expect(trzynasty).toBeDisabled();
    expect(trzynasty).toHaveClass("opacity-50");
    // Zaznaczone zostają klikalne - inaczej z limitu nie ma wyjścia.
    const cyber = screen.getByRole("button", { name: "Cyber", pressed: true });
    expect(cyber).toBeEnabled();

    fireEvent.click(cyber);
    expect(screen.getByRole("button", { name: "Rolnictwo" })).toBeEnabled();
  });

  it("awaria zapisu nie zamyka formularza i nie udaje sukcesu", async () => {
    networkApiMock.fetchMyClubExpertise.mockResolvedValue([]);
    networkApiMock.setMyClubExpertise.mockRejectedValue(new Error("42501"));
    const onDone = vi.fn();
    renderEdytor(onDone);

    fireEvent.click(screen.getByRole("button", { name: "club.network.expertise.save" }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("club.network.expertise.failed"));
    expect(onDone).not.toHaveBeenCalled();
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("zapis w locie blokuje oba przyciski i pokazuje, że coś się dzieje", async () => {
    networkApiMock.fetchMyClubExpertise.mockResolvedValue([]);
    networkApiMock.setMyClubExpertise.mockImplementation(nigdy);
    renderEdytor(vi.fn());

    const zapisz = screen.getByRole("button", { name: "club.network.expertise.save" });
    fireEvent.click(zapisz);

    await waitFor(() => expect(zapisz).toBeDisabled());
    expect(zapisz.querySelector("svg.animate-spin")).not.toBeNull();
    expect(screen.getByRole("button", { name: "club.network.board.cancel" })).toBeDisabled();
  });
});

// ===========================================================================
// 5) Poznaj członka
// ===========================================================================

describe("ClubSpotlightPanel", () => {
  function renderPoznaj() {
    return renderWithQueryClient(<ClubSpotlightPanel clubSlug={SLUG} clubId={NET_IDS.club} />);
  }

  it("moduł MILCZY, dopóki nie ma kogo pokazać - także w trakcie zapytania", async () => {
    networkApiMock.fetchClubSpotlight.mockImplementation(nigdy);
    const { container, unmount } = renderPoznaj();
    expect(container).toBeEmptyDOMElement();
    unmount();

    // Klub ukrywający skład, klub jednoosobowy i profil bez zdania to trzy różne
    // powody na ten sam wynik: brak wiersza.
    networkApiMock.fetchClubSpotlight.mockResolvedValue(null);
    const puste = renderPoznaj();
    await waitFor(() => expect(puste.container).toBeEmptyDOMElement());
  });

  it("pełny wiersz daje nazwisko z linkiem do profilu, trzy zdania i trzy obszary", async () => {
    networkApiMock.fetchClubSpotlight.mockResolvedValue(
      spotlightRow({ topics: ["energy", "transport", "cyber", "finance"] }),
    );
    renderPoznaj();

    const nazwisko = await screen.findByRole("link", { name: "Anna Nowak" });
    expect(nazwisko).toHaveAttribute("href", "/author/anna-nowak");
    expect(screen.getByText("Analityk - NES")).toBeInTheDocument();
    // Trzy zdania redakcji - cięcie po granicy zdania robi `firstSentences`.
    expect(
      screen.getByText("Trzy zdania redakcji o Annie. Zna rynek gazu. Pisze o bilansowaniu."),
    ).toBeInTheDocument();
    // Cztery obszary w danych, trzy chipy w szynie - czwarty by nie zmieścił się
    // w kolumnie 20 rem.
    expect(screen.getByText("Energetyka")).toBeInTheDocument();
    expect(screen.getByText("Cyber")).toBeInTheDocument();
    expect(screen.queryByText("Finanse")).not.toBeInTheDocument();

    const kontakt = screen.getByTestId("kontakt");
    expect(kontakt).toHaveAttribute("data-user-id", NET_IDS.member);
    expect(kontakt).toHaveAttribute("data-display-name", "Anna Nowak");
    expect(screen.getByRole("link", { name: "club.hub.more" })).toHaveAttribute(
      "href",
      `/club/${SLUG}/spotlight`,
    );
  });

  it("osoba bez profilu, bez nagłówka, bez opisu i bez obszarów nadal ma nazwisko i kontakt", async () => {
    networkApiMock.fetchClubSpotlight.mockResolvedValue(
      spotlightRow({
        profile_slug: null,
        headline: null,
        blurb_pl: null,
        blurb_en: null,
        bio_pl: null,
        bio_en: null,
        topics: [],
      }),
    );
    renderPoznaj();

    await waitFor(() => expect(screen.getByText("Anna Nowak")).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "Anna Nowak" })).not.toBeInTheDocument();
    expect(screen.getByTestId("kontakt")).toBeInTheDocument();
    // Bez ani jednego zdania i bez obszarów panel nie zostawia pustych akapitów:
    // zostaje jeden - ten z nazwiskiem, które nie ma dokąd prowadzić.
    const sekcja = document.querySelector("section");
    expect(sekcja?.querySelectorAll("p")).toHaveLength(1);
  });

  it("brak wpisu redakcji przełącza opis na bio z profilu, a nie gasi modułu", async () => {
    networkApiMock.fetchClubSpotlight.mockResolvedValue(
      spotlightRow({ blurb_pl: null, blurb_en: null }),
    );
    renderPoznaj();

    await waitFor(() =>
      expect(
        screen.getByText("Pracuje nad rynkiem energii. Doradzała m.in. MKiŚ. Prowadzi seminarium."),
      ).toBeInTheDocument(),
    );
  });
});
