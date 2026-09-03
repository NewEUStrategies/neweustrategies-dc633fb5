// Dwie POWŁOKI modułu klubów: powierzchnia klubu (`ClubWorkspaceLayout`)
// i przestrzeń robocza wątku (`ClubThreadWorkspace`).
//
// CO TEN PLIK DOWODZI.
//
//   1. PIĘĆ STANÓW POWŁOKI KLUBU I GRANICE MIĘDZY NIMI. To jest cała wartość
//      `ClubWorkspaceLayout` i jednocześnie jedyne miejsce, w którym pomyłka
//      jest wyciekiem, a nie usterką wizualną:
//        * awaria RPC to NIE 404 - użytkownik z poprawnym linkiem ma się
//          dowiedzieć, że problem jest po naszej stronie,
//        * zero wierszy z `club_view` to 404, NIE 403 - klub `secret` bez
//          dostępu nie ma prawa zdradzić, że istnieje,
//        * `can_read = false` pokazuje wizytówkę I POWÓD, nie pustą treść,
//        * render-prop `children(club)` wykonuje się WYŁĄCZNIE w stanie
//          „treść”. Wywołanie go w którymkolwiek z pozostałych stanów
//          zamontowałoby organizm czytający dane klubu, którego czytać nie
//          wolno - dlatego liczba wywołań jest tu asertowana wprost.
//   2. ZAPROSZENIE DO WEJŚCIA ZALEŻY OD POLITYKI WSTĘPU, nie od widoczności:
//      `open` prosi o dołączenie, `request` o wniosek, `invite` nie pokazuje
//      przycisku w ogóle, bo nie ma czego kliknąć.
//   3. BELKA ZAKŁADEK WĄTKU POKAZUJE TYLKO PANELE ISTNIEJĄCE. Zakładka bez
//      zbioru i bez prawa zapisu jest ślepą uliczką.
//   4. KAŻDY PANEL DOSTAJE SWÓJ ZESTAW UPRAWNIEŃ. To najgęstsze miejsce na
//      przeklejoną nazwę propsa w całym module: `canContribute`, `canCurate`,
//      `canGoAnonymous` i `userId` idą do RÓŻNYCH paneli, a pomyłka przechodzi
//      przez `tsc`, bo wszystkie są tego samego typu.
//   5. PANEL, KTÓRY ZNIKA Z BELKI MIĘDZY RENDERAMI, oddaje zaznaczenie
//      dyskusji - inaczej czytelnik stojący w „Głosowaniach” po usunięciu
//      ostatniej ankiety zostałby na pustym ekranie bez zaznaczonej zakładki.
//   6. GRANICA LENIWEGO ŁADOWANIA JEST WIDOCZNA: pierwsze wejście w panel
//      pokazuje zastępnik `aria-busy`, a nie pustkę.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - REGUŁY `visiblePanels` i `panelBadge`: to czyste funkcje z tabelą
//   przypadków w zakresie `threadWorkspaceTypes`. Tutaj dowodzimy, że powłoka
//   je WOŁA i respektuje wynik, a nie liczymy ich drugi raz.
// - ZAWARTOŚCI PANELI: ośmiu leniwych modułów nie renderujemy - są atrapami
//   zapisującymi propsy. Ich zachowanie ma własne pliki
//   (`clubThreadPanels.test.tsx`, `clubThreadPolls.test.tsx`).
// - SZYNY NAWIGACJI (`ClubWorkspaceRail`, `ClubHubSectionBar`): atrapy, bo to
//   molekuły z własnym zakresem (`clubHubRail.test.tsx`).
// - WYBORU JĘZYKA z bliźniaczych kolumn: `pickLocalized` ma własny zakres.
//   Tutaj jest JEDEN przypadek EN, który dowodzi wyłącznie tego, że powłoka
//   podaje mu `i18n.language`, a nie stałą.
// - KLAWIATURY BELKI (strzałki, Home/End): to molekuła `ClubWorkspaceTabs`.
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  /** Język widziany przez atrapę `useTranslation`. */
  lang: "pl",
  /** Propsy zapisane przez atrapy leniwych paneli, per nazwa panelu. */
  panel: {} as Record<string, Record<string, unknown>>,
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("@/lib/i18n-club", () => ({ ensureClubI18n: () => undefined }));
vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
vi.mock("@/lib/clubs/api", () => clubApiMock);
// Karta klubu czeka na rozstrzygniętą sesję (`useClubBySlug`), więc harness
// musi dostarczyć gotowy kontekst auth zamiast domyślnego `loading: true`.
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1" }, session: null, loading: false }),
}));
vi.mock("@/components/clubs/molecules/ClubHubRail", () => ({
  ClubHubRail: () => null,
  ClubWorkspaceRail: ({ club }: { club: { slug: string } }) => (
    <div data-testid="rail" data-slug={club.slug} />
  ),
  ClubHubSectionBar: ({
    clubSlug,
    canSeeMembers,
  }: {
    clubSlug: string;
    canSeeMembers: boolean;
  }) => <div data-testid="section-bar" data-slug={clubSlug} data-members={String(canSeeMembers)} />,
}));

/** Atrapa leniwego panelu: marker w DOM-ie plus zapis propsów pod nazwą. */
function panelStub(name: string) {
  return (props: Record<string, unknown>) => {
    h.panel[name] = props;
    return <div data-testid={`panel-${name}`} />;
  };
}

vi.mock("@/components/clubs/organisms/ClubThreadParticipantsPanel", () => ({
  ClubThreadParticipantsPanel: panelStub("participants"),
}));
vi.mock("@/components/clubs/organisms/ClubThreadDocumentsPanel", () => ({
  ClubThreadDocumentsPanel: panelStub("documents"),
}));
vi.mock("@/components/clubs/organisms/ClubThreadSchedulePanel", () => ({
  ClubThreadSchedulePanel: panelStub("schedule"),
}));
vi.mock("@/components/clubs/organisms/ClubThreadQuestionsPanel", () => ({
  ClubThreadQuestionsPanel: panelStub("questions"),
}));
vi.mock("@/components/clubs/organisms/ClubThreadPollsPanel", () => ({
  ClubThreadPollsPanel: panelStub("polls"),
}));
vi.mock("@/components/clubs/organisms/ClubThreadLinksPanel", () => ({
  ClubThreadLinksPanel: panelStub("links"),
}));
vi.mock("@/components/clubs/organisms/ClubThreadInsightsPanel", () => ({
  ClubThreadInsightsPanel: panelStub("insights"),
}));
vi.mock("@/components/clubs/organisms/ClubThreadFinderPanel", () => ({
  ClubThreadFinderPanel: panelStub("search"),
}));

// KOLEJNOŚĆ IMPORTÓW JEST TU ZNACZĄCA: atrapa warstwy danych musi być
// zainicjalizowana, ZANIM graf modułów komponentu pociągnie `@/lib/clubs/api`
// i odpali fabrykę `vi.mock`. Odwrotna kolejność daje `Cannot access
// '__vi_import__' before initialization` - błąd, który wygląda jak problem
// z mockiem, a jest problemem z porządkiem.
import { clubApiMock, resetClubApiMock } from "@/test/clubs/apiMock";
import { CLUB_IDS, clubViewRow } from "@/test/clubs/fixtures";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ClubThreadWorkspace } from "@/components/clubs/organisms/ClubThreadWorkspace";
import { ClubWorkspaceLayout } from "@/components/clubs/organisms/ClubWorkspaceLayout";
import {
  EMPTY_WORKSPACE_SUMMARY,
  visiblePanels,
  type ClubWorkspacePanel,
  type ClubWorkspaceSummary,
} from "@/lib/clubs/workspaceTypes";
import type { ClubViewRow } from "@/lib/clubs/types";

// ---------------------------------------------------------------------------
// Powłoka powierzchni klubu
// ---------------------------------------------------------------------------

/** Karty klubu wystawione render-propowi - liczba wywołań JEST asercją. */
let handed: ClubViewRow[];

function renderLayout(
  overrides: {
    lead?: string;
    actions?: ReactNode;
  } = {},
): HTMLElement {
  const { container } = renderWithQueryClient(
    <ClubWorkspaceLayout
      clubSlug="klub-energetyczny"
      title="Biblioteka"
      lead={overrides.lead}
      actions={overrides.actions}
    >
      {(club) => {
        handed.push(club);
        return <div data-testid="tresc">{club.id}</div>;
      }}
    </ClubWorkspaceLayout>,
  );
  return container;
}

describe("ClubWorkspaceLayout - pięć stanów powierzchni klubu", () => {
  beforeEach(() => {
    resetClubApiMock();
    handed = [];
    h.lang = "pl";
  });

  afterEach(() => {
    cleanup();
  });

  it("stan oczekiwania: szkielet i ANI JEDNO wywołanie render-propu", () => {
    // Obietnica, która nigdy się nie rozwiązuje - `isPending` bez zegarów.
    clubApiMock.fetchClubBySlug.mockReturnValue(new Promise(() => {}));

    const container = renderLayout();

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(handed).toHaveLength(0);
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("awaria RPC to NIE 404: komunikat awarii bez powodu „nie znaleziono”", async () => {
    clubApiMock.fetchClubBySlug.mockRejectedValue(new Error("club_view padło"));

    renderLayout();

    expect(await screen.findByText("club.error.title")).toBeInTheDocument();
    expect(screen.queryByText("club.reason.not_found")).toBeNull();
    expect(handed).toHaveLength(0);
  });

  it("ponowienie po awarii wraca do warstwy danych", async () => {
    clubApiMock.fetchClubBySlug.mockRejectedValue(new Error("club_view padło"));

    renderLayout();
    await screen.findByText("club.error.title");
    const przed = clubApiMock.fetchClubBySlug.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "club.error.retry" }));

    await waitFor(() =>
      expect(clubApiMock.fetchClubBySlug.mock.calls.length).toBeGreaterThan(przed),
    );
  });

  it("zero wierszy to 404 z drogą powrotną do katalogu, a nie 403", async () => {
    clubApiMock.fetchClubBySlug.mockResolvedValue(null);

    renderLayout();

    expect(await screen.findByText("club.reason.not_found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "club.title" })).toHaveAttribute("href", "/club");
    // Nie mieszamy 404 z awarią: to dwie różne odpowiedzi dla użytkownika.
    expect(screen.queryByText("club.error.title")).toBeNull();
    expect(handed).toHaveLength(0);
  });

  it("brak dostępu pokazuje wizytówkę i POWÓD z RPC, a nie pustą treść", async () => {
    clubApiMock.fetchClubBySlug.mockResolvedValue(
      clubViewRow({ can_read: false, reason: "secret", join_policy: "invite" }),
    );

    renderLayout();

    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Klub energetyczny");
    expect(screen.getByText("club.reason.secret")).toBeInTheDocument();
    expect(handed).toHaveLength(0);
  });

  it("brak dostępu bez powodu z RPC spada na „nie jesteś członkiem”", async () => {
    // `club_view` oddaje pusty napis, gdy nie ma czego wyjaśnić - to nie jest
    // powód i nie wolno go wstawić do klucza tłumaczenia.
    clubApiMock.fetchClubBySlug.mockResolvedValue(clubViewRow({ can_read: false, reason: "" }));

    renderLayout();

    expect(await screen.findByText("club.reason.not_member")).toBeInTheDocument();
  });

  it.each([
    ["open", "club.join"],
    ["request", "club.requestJoin"],
  ] as const)("polityka wstępu %s prowadzi na wizytówkę hasłem %s", async (policy, klucz) => {
    clubApiMock.fetchClubBySlug.mockResolvedValue(
      clubViewRow({ can_read: false, join_policy: policy }),
    );

    renderLayout();

    const cta = await screen.findByRole("link", { name: klucz });
    expect(cta).toHaveAttribute("href", "/club/klub-energetyczny/about");
  });

  it("polityka „tylko zaproszenia” nie pokazuje przycisku wejścia", async () => {
    clubApiMock.fetchClubBySlug.mockResolvedValue(
      clubViewRow({ can_read: false, join_policy: "invite" }),
    );

    renderLayout();

    await screen.findByText("club.reason.not_member");
    expect(screen.queryByRole("link", { name: "club.join" })).toBeNull();
    expect(screen.queryByRole("link", { name: "club.requestJoin" })).toBeNull();
  });

  it("stan treści: render-prop dostaje kartę klubu DOKŁADNIE raz", async () => {
    const club = clubViewRow();
    clubApiMock.fetchClubBySlug.mockResolvedValue(club);

    renderLayout({ lead: "Materiały klubu", actions: <button type="button">Dodaj</button> });

    expect(await screen.findByTestId("tresc")).toHaveTextContent(CLUB_IDS.club);
    expect(handed).toHaveLength(1);
    expect(handed[0].id).toBe(CLUB_IDS.club);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Biblioteka");
    expect(screen.getByText("Materiały klubu")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dodaj" })).toBeInTheDocument();
  });

  it("stan treści bez podtytułu i bez akcji nie rysuje tych bloków", async () => {
    clubApiMock.fetchClubBySlug.mockResolvedValue(clubViewRow());

    renderLayout({ lead: "" });

    await screen.findByTestId("tresc");
    // Pusty `lead` to brak podtytułu, nie pusty akapit.
    expect(screen.getByRole("main").querySelectorAll("header p")).toHaveLength(0);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("nazwa klubu jest nadtytułem i drogą powrotną, a szyna zna prawo do składu", async () => {
    clubApiMock.fetchClubBySlug.mockResolvedValue(clubViewRow({ can_see_members: false }));

    renderLayout();

    await screen.findByTestId("tresc");
    expect(screen.getByRole("link", { name: "Klub energetyczny" })).toHaveAttribute(
      "href",
      "/club/klub-energetyczny",
    );
    expect(screen.getByTestId("rail")).toHaveAttribute("data-slug", "klub-energetyczny");
    expect(screen.getByTestId("section-bar")).toHaveAttribute("data-members", "false");
  });

  it("nadtytuł czyta język interfejsu, a nie stałą kolumnę", async () => {
    h.lang = "en";
    clubApiMock.fetchClubBySlug.mockResolvedValue(clubViewRow());

    renderLayout();

    await screen.findByTestId("tresc");
    expect(screen.getByRole("link", { name: "Energy club" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Powłoka przestrzeni roboczej wątku
// ---------------------------------------------------------------------------

function summary(overrides: Partial<ClubWorkspaceSummary> = {}): ClubWorkspaceSummary {
  return { ...EMPTY_WORKSPACE_SUMMARY, threadId: CLUB_IDS.thread, ...overrides };
}

/** Podsumowanie, w którym KAŻDY panel ma prawo stać na belce. */
const PELNE = summary({
  documents: 3,
  milestones: 2,
  upcoming: 1,
  questions: 4,
  openQuestions: 2,
  polls: 1,
  openPolls: 1,
  links: 2,
  participants: 5,
  replies: 9,
  canContribute: true,
  canCurate: true,
});

function workspace(over: Partial<ClubWorkspaceSummary> | ClubWorkspaceSummary = PELNE) {
  const merged = "threadId" in over ? (over as ClubWorkspaceSummary) : summary(over);
  return (
    <ClubThreadWorkspace
      threadId={CLUB_IDS.thread}
      lang="pl"
      userId={CLUB_IDS.me}
      summary={merged}
      canGoAnonymous
    >
      <div data-testid="dyskusja" />
    </ClubThreadWorkspace>
  );
}

function tab(panel: ClubWorkspacePanel): HTMLElement {
  return screen.getByRole("tab", { name: new RegExp(`^club\\.workspace\\.panel\\.${panel}`) });
}

describe("ClubThreadWorkspace - belka, wybór panelu i granica leniwego ładowania", () => {
  beforeEach(() => {
    h.panel = {};
    h.lang = "pl";
  });

  afterEach(() => {
    cleanup();
  });

  it("pierwsze wejście w panel pokazuje zastępnik, potem treść panelu", async () => {
    const { container } = render(workspace());

    fireEvent.click(tab("documents"));

    // Granica `Suspense`: zanim moduł panelu dojedzie, stoi zastępnik.
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(await screen.findByTestId("panel-documents")).toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("domyślnie stoi dyskusja: treść z trasy, żaden panel nie jest montowany", () => {
    render(workspace());

    expect(screen.getByTestId("dyskusja")).toBeInTheDocument();
    expect(h.panel).toEqual({});
    expect(tab("discussion")).toHaveAttribute("aria-selected", "true");
  });

  it("panel dyskusji jest opisany zakładką, po której go wybrano", () => {
    render(workspace());

    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("id", "club-ws-panel-discussion");
    expect(panel).toHaveAttribute("aria-labelledby", "club-ws-tab-discussion");
    // Kontener przewijalny musi być osiągalny z klawiatury.
    expect(panel).toHaveAttribute("tabindex", "0");
  });

  it("belka pokazuje TYLKO panele, które mają co pokazać albo co zapełnić", () => {
    // Czytelnik bez praw i bez zbiorów: zostają trzy panele bez zbioru
    // własnego - dyskusja, dane i szukanie.
    render(workspace({}));

    const widoczne = screen.getAllByRole("tab").map((node) => node.getAttribute("id"));
    expect(widoczne).toEqual(visiblePanels(summary()).map((panel) => `club-ws-tab-${panel}`));
    expect(widoczne).toEqual([
      "club-ws-tab-discussion",
      "club-ws-tab-insights",
      "club-ws-tab-search",
    ]);
  });

  it("prawo zapisu dokłada panele puste, ale zapełnialne", () => {
    render(workspace({ canContribute: true }));

    const widoczne = screen.getAllByRole("tab").map((node) => node.getAttribute("id"));
    expect(widoczne).toContain("club-ws-tab-documents");
    expect(widoczne).toContain("club-ws-tab-questions");
    // Harmonogram i głosowania zakłada kurator, nie każdy piszący.
    expect(widoczne).not.toContain("club-ws-tab-schedule");
    expect(widoczne).not.toContain("club-ws-tab-polls");
  });

  it.each([
    ["participants", { threadId: CLUB_IDS.thread, lang: "pl" }],
    ["documents", { threadId: CLUB_IDS.thread, lang: "pl", canContribute: true, canCurate: true }],
    ["schedule", { threadId: CLUB_IDS.thread, lang: "pl", canCurate: true }],
    [
      "questions",
      { threadId: CLUB_IDS.thread, lang: "pl", canContribute: true, canGoAnonymous: true },
    ],
    ["polls", { threadId: CLUB_IDS.thread, lang: "pl", userId: CLUB_IDS.me, canCurate: true }],
    ["links", { threadId: CLUB_IDS.thread, lang: "pl" }],
    ["insights", { threadId: CLUB_IDS.thread, lang: "pl" }],
    ["search", { threadId: CLUB_IDS.thread, lang: "pl" }],
  ] as const)("panel %s dostaje DOKŁADNIE swój zestaw propsów", async (panel, oczekiwane) => {
    render(workspace());

    fireEvent.click(tab(panel as ClubWorkspacePanel));
    await screen.findByTestId(`panel-${panel}`);

    expect(h.panel[panel]).toEqual(oczekiwane);
    // Dyskusja schodzi z ekranu - panele nie stoją obok siebie.
    expect(screen.queryByTestId("dyskusja")).toBeNull();
  });

  it("wybrana zakładka ogłasza się czytnikowi ekranu nazwą panelu", async () => {
    // `role="tabpanel"` sam z siebie nie mówi, CO się zmieniło - stąd osobny
    // komunikat `aria-live`. Szukamy go po roli komunikatu, nie po tekście:
    // ten sam napis stoi też na zakładce.
    const { container } = render(workspace());

    fireEvent.click(tab("links"));
    await screen.findByTestId("panel-links");

    const ogloszenie = container.querySelector('[aria-live="polite"]');
    expect(ogloszenie).toHaveTextContent("club.workspace.panel.links");
    expect(ogloszenie).toHaveClass("sr-only");
  });

  it("panel usunięty z belki oddaje zaznaczenie dyskusji", async () => {
    const { rerender } = render(workspace());

    fireEvent.click(tab("polls"));
    await screen.findByTestId("panel-polls");

    // Ostatnia ankieta odpięta, a patrzący nie jest kuratorem: zakładka znika.
    rerender(workspace({ ...PELNE, polls: 0, canCurate: false }));

    await waitFor(() => expect(screen.getByTestId("dyskusja")).toBeInTheDocument());
    expect(screen.queryByRole("tab", { name: /club\.workspace\.panel\.polls/ })).toBeNull();
    expect(tab("discussion")).toHaveAttribute("aria-selected", "true");
  });

  it("panel, który na belce ZOSTAJE, nie traci zaznaczenia przy zmianie liczników", async () => {
    const { rerender } = render(workspace());

    fireEvent.click(tab("documents"));
    await screen.findByTestId("panel-documents");

    rerender(workspace({ ...PELNE, documents: 7 }));

    expect(screen.getByTestId("panel-documents")).toBeInTheDocument();
    expect(screen.queryByTestId("dyskusja")).toBeNull();
  });
});
