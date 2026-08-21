// Molekuły mówiące o LUDZIACH i o wejściu w tematykę: rząd twarzy składu,
// karta osoby, wiersz uczestnika wątku i nawigacja po obszarach.
//
// CO TEN PLIK DOWODZI.
//  (1) TWARZ BEZ PUBLICZNEGO PROFILU NADAL MUSI BYĆ DOSIĘGALNA. Profil ukryty
//      nie dostaje LINKU (katalog klubu nie obchodzi ustawienia widoczności),
//      ale dostaje `<button>` - bo plakietka niesie rolę, kompetencje i stan
//      obecności, a `<span>` zamknąłby ją przed klawiaturą.
//  (2) OPIS DLA CZYTNIKA EKRANU JEST PRZY AWATARZE, NIE W DYMKU. Tooltip bywa
//      nieosiągalny przy dotyku, więc nazwa, rola, stanowisko i stan obecności
//      lecą także do warstwy `sr-only` - w TEJ kolejności i bez pustych członów.
//  (3) STAN OBECNOŚCI MA PIERWSZEŃSTWO: „aktywny dziś” bije „nowy tutaj”, a ono
//      bije datę dołączenia; brak wszystkich trzech znaczy CISZĘ, nie `null`
//      na ekranie.
//  (4) ROLA NIEZNANA Z NOWSZEJ MIGRACJI DEGRADUJE DO DOMYŚLNEJ, a rola domyślna
//      (`member`) nie dostaje plakietki - inaczej każdy ma plakietkę i plakietka
//      przestaje znaczyć.
//  (5) ROTACJA NIE GUBI SYGNAŁU: pula większa niż liczba miejsc pokazuje
//      dokładnie tyle twarzy, ile jest miejsc, a osoby aktywne w ostatniej
//      dobie są PRZYPIĘTE (są zawsze, niezależnie od okna rotacji).
//  (6) WKŁAD UCZESTNIKA JEST ROZBITY, NIE ZSUMOWANY, i licznik zerowy w ogóle
//      nie wchodzi na ekran - „0 pytań” to nie informacja o dyskusji.
//  (7) KARTA OSOBY TNIE KOMPETENCJE NA CZTERECH i dokłada „+N” dopiero od
//      piątej (granica sprawdzona dokładnie na progu i po obu stronach).
//  (8) PASEK OBSZARÓW NIE ISTNIEJE PRZY JEDNYM OBSZARZE (jeden przycisk to nie
//      wybór), a kliknięcie w już wybrany obszar go ODZNACZA.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//  (a) Czystych reguł z `src/lib/clubs`: `rotateRosterFaces`/`rosterRotationTick`
//      (networkTypes), `countClubTopics` (topics), `topicLabel` (topicCatalog)
//      mają własne tabele przypadków. Tutaj widać ich SKUTEK na ekranie.
//  (b) Atomów `ClubPersonBadge`, `ClubPresenceAvatar`, `ClubExpertiseChip`,
//      `ClubStatusPill`, `ClubTopicFilterChip` - mają własne pliki
//      (`clubNetworkPrimitives.test.tsx`, `clubAtomChips.test.tsx`); tutaj
//      przedmiotem dowodu jest to, CO molekuła im podaje.
//  (c) Hooka `useClubTopics` (klucz cache, `staleTime`) - warstwa danych ma
//      własne testy; tu sprawdzamy tylko, że katalog z organizacji WYGRYWA
//      z listą awaryjną, gdy dojedzie.
//  (d) Paneli, które te molekuły składają (`ClubRosterPanel`, ekrany sieci) -
//      mają własne pliki i tam molekuły są atrapami.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

const katalogRpc = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/clubs/topicsApi", () => ({
  fetchActiveClubTopics: katalogRpc.fetch,
  fetchAdminClubTopics: vi.fn(),
  upsertClubTopic: vi.fn(),
  setClubTopicActive: vi.fn(),
  deleteClubTopic: vi.fn(),
}));

import { ClubRosterFaces } from "@/components/clubs/molecules/ClubRosterFaces";
import { ClubPersonCard } from "@/components/clubs/molecules/ClubPersonCard";
import {
  ClubParticipantRow,
  participantName,
} from "@/components/clubs/molecules/ClubParticipantRow";
import { ClubTopicNav } from "@/components/clubs/molecules/ClubTopicNav";
import { CLUB_ROSTER_FACE_SLOTS, type ClubRosterFace } from "@/lib/clubs/networkTypes";
import type { ClubTopicOption } from "@/lib/clubs/topicCatalog";
import {
  threadParticipantRow,
  WS_BASE_ISO,
  wsIsoOffset,
} from "@/test/clubs/threadWorkspaceFixtures";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

/** Katalog organizacji - jedna pozycja nazwana INACZEJ niż lista awaryjna,
 *  żeby było widać, które źródło etykiety wygrało. */
const KATALOG: readonly ClubTopicOption[] = [
  {
    key: "energy",
    label_pl: "Energetyka i klimat",
    label_en: "Energy and climate",
    sort_order: 10,
  },
];

function face(overrides: Partial<ClubRosterFace> = {}): ClubRosterFace {
  return {
    userId: "user-member",
    name: "Anna Nowak",
    avatarUrl: null,
    slug: "anna-nowak",
    headline: "Analityczka rynku energii",
    role: "member",
    joinedAt: null,
    isNew: false,
    isActive: false,
    topics: [],
    ...overrides,
  };
}

/** Pula większa niż liczba miejsc - do sprawdzenia rotacji i przypięć. */
function pula(count: number, overrides: (index: number) => Partial<ClubRosterFace> = () => ({})) {
  return Array.from({ length: count }, (_, index) =>
    face({
      userId: `user-${index}`,
      name: `Osoba ${index}`,
      slug: null,
      headline: null,
      ...overrides(index),
    }),
  );
}

beforeEach(() => {
  // Zegar zamrożony: numer okna rotacji liczy się z `Date.now()`, a skład,
  // który zależy od chwili uruchomienia testu, nie jest testem.
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(WS_BASE_ISO) });
  katalogRpc.fetch.mockReset();
  katalogRpc.fetch.mockReturnValue(new Promise<ClubTopicOption[]>(() => undefined));
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// ClubRosterFaces
// ---------------------------------------------------------------------------

describe("ClubRosterFaces - rząd twarzy składu", () => {
  it("pusta pula nie zostawia pustej listy", () => {
    const { container } = render(<ClubRosterFaces faces={[]} topicCatalog={KATALOG} />);
    expect(container.firstChild).toBeNull();
  });

  it("twarz z publicznym profilem prowadzi do profilu i niesie pełny opis", () => {
    render(
      <ClubRosterFaces
        faces={[face({ role: "lead", isActive: true, topics: ["energy"] })]}
        topicCatalog={KATALOG}
        className="moja-klasa"
      />,
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/author/anna-nowak");
    // Kolejność członów opisu jest umową: nazwa, rola, stanowisko, obecność.
    expect(
      screen.getByText(
        "Anna Nowak - club.role.lead - Analityczka rynku energii - club.network.roster.activeToday",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("list")).toHaveClass("moja-klasa");
    expect(screen.getByRole("list")).toHaveAccessibleName("club.network.roster.facesLabel");
  });

  it("dymek pod fokusem niesie etykietę obszaru Z KATALOGU ORGANIZACJI", async () => {
    render(
      <ClubRosterFaces
        faces={[face({ role: "moderator", topics: ["energy"], isNew: true })]}
        topicCatalog={KATALOG}
      />,
    );
    fireEvent.focus(screen.getByRole("link"));
    const dymek = await screen.findByRole("tooltip");
    expect(within(dymek).getByText("Energetyka i klimat")).toBeInTheDocument();
    expect(within(dymek).getByText("club.role.moderator")).toBeInTheDocument();
    expect(within(dymek).getByText("club.network.roster.newHere")).toBeInTheDocument();
  });

  it("profil bez publicznej strony dostaje przycisk, a nie link", () => {
    render(
      <ClubRosterFaces
        faces={[face({ slug: null, joinedAt: WS_BASE_ISO })]}
        topicCatalog={KATALOG}
      />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByRole("button")).toBeInTheDocument();
    // Data dołączenia jest ostatnim z trzech sygnałów obecności.
    expect(screen.getByText(/club\.network\.roster\.memberSince\(date=.*2026/)).toBeInTheDocument();
  });

  it("rola nieznana degraduje do domyślnej, a brak sygnałów obecności milczy", () => {
    render(
      <ClubRosterFaces
        faces={[face({ role: "przewodniczacy", headline: null })]}
        topicCatalog={KATALOG}
      />,
    );
    // Ani plakietki roli, ani linijki o obecności - zostaje sama nazwa.
    expect(screen.getByText("Anna Nowak")).toBeInTheDocument();
    expect(screen.queryByText(/club\.role\./)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/club\.network\.roster\.(activeToday|newHere|memberSince)/),
    ).toBeNull();
  });

  it("pula większa niż liczba miejsc pokazuje dokładnie tyle twarzy, ile miejsc, i przypina aktywnych", () => {
    render(
      <ClubRosterFaces
        faces={pula(CLUB_ROSTER_FACE_SLOTS + 2, (index) => ({
          isActive: index === 0 || index === 1,
          name: index < 2 ? `Aktywny ${index}` : `Osoba ${index}`,
        }))}
        topicCatalog={KATALOG}
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(CLUB_ROSTER_FACE_SLOTS);
    expect(screen.getByText(/Aktywny 0/)).toBeInTheDocument();
    expect(screen.getByText(/Aktywny 1/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ClubPersonCard
// ---------------------------------------------------------------------------

describe("ClubPersonCard - karta osoby na pełnym ekranie", () => {
  it("dane pełne: link do profilu, plakietka roli, kompetencje, dopiski i akcje", () => {
    render(
      <ClubPersonCard
        name="Anna Nowak"
        avatarUrl="https://example.test/a.jpg"
        profileSlug="anna-nowak"
        headline="Analityczka rynku energii"
        role="lead"
        topics={["energy", "transport"]}
        topicCatalog={KATALOG}
        active
        meta={<span>W klubie od 2024</span>}
        actions={<button type="button">Poproś o zdanie</button>}
        className="moja-klasa"
      />,
    );
    expect(screen.getByRole("link", { name: "Anna Nowak" })).toHaveAttribute(
      "href",
      "/author/anna-nowak",
    );
    expect(screen.getByText("club.role.lead")).toBeInTheDocument();
    expect(screen.getByText("Analityczka rynku energii")).toBeInTheDocument();
    // Pierwszy obszar z katalogu organizacji, drugi z listy awaryjnej.
    expect(screen.getByText("Energetyka i klimat")).toBeInTheDocument();
    expect(screen.getByText("Transport")).toBeInTheDocument();
    expect(screen.getByText("W klubie od 2024")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Poproś o zdanie" })).toBeInTheDocument();
    // Kropka obecności to jedyny sygnał „ktoś tu dziś był”.
    expect(screen.getByRole("img", { name: "club.network.roster.activeDot" })).toBeInTheDocument();
  });

  it("dane częściowe: bez profilu, bez stanowiska, bez obszarów i bez akcji", () => {
    const { container } = render(
      <ClubPersonCard
        name="Jan Lis"
        avatarUrl={null}
        profileSlug={null}
        headline={null}
        role={null}
      />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("Jan Lis")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "club.network.roster.activeDot" })).toBeNull();
    // Rola nieustawiona nie zostawia po sobie pustej plakietki.
    expect(container.querySelectorAll("div.rounded-lg.text-\\[10px\\]")).toHaveLength(0);
  });

  it.each([
    ["rola domyślna", "member"],
    ["rola nieznana z nowszej migracji", "przewodniczacy"],
  ])("%s nie dostaje plakietki", (_nazwa, role: string) => {
    render(
      <ClubPersonCard
        name="Anna Nowak"
        avatarUrl={null}
        profileSlug={null}
        headline={null}
        role={role}
      />,
    );
    expect(screen.queryByText(/club\.role\./)).not.toBeInTheDocument();
  });

  it.each([
    ["puste kompetencje", [], null],
    [
      "dokładnie cztery - jeszcze bez nadwyżki",
      ["energy", "transport", "finance", "culture"],
      null,
    ],
    ["pięć - nadwyżka jeden", ["energy", "transport", "finance", "culture", "economy"], "+1"],
  ])("%s", (_nazwa, topics: string[], nadwyzka: string | null) => {
    render(
      <ClubPersonCard
        name="Anna Nowak"
        avatarUrl={null}
        profileSlug={null}
        headline={null}
        topics={topics}
      />,
    );
    if (nadwyzka === null) {
      expect(screen.queryByText(/^\+\d+$/)).not.toBeInTheDocument();
    } else {
      expect(screen.getByText(nadwyzka)).toBeInTheDocument();
    }
    // Nigdy więcej niż cztery chipy - reszta zwija się do licznika.
    expect(
      screen.queryAllByText(/^(Energetyka|Transport|Finanse|Kultura|Gospodarka)$/).length,
    ).toBe(Math.min(topics.length, 4));
  });
});

// ---------------------------------------------------------------------------
// ClubParticipantRow
// ---------------------------------------------------------------------------

describe("participantName - nazwa gotowa do renderu", () => {
  it.each([
    ["nazwa jawna wygrywa", { display_name: "Anna Nowak", alias: "Uczestnik 3" }, "Anna Nowak"],
    [
      "sam alias wchodzi do szablonu",
      { display_name: null, alias: "Uczestnik 3" },
      "anonim Uczestnik 3",
    ],
    [
      "nazwa pusta traktowana jak brak",
      { display_name: "", alias: "Uczestnik 3" },
      "anonim Uczestnik 3",
    ],
    [
      "alias pusty schodzi do konta usuniętego",
      { display_name: null, alias: "" },
      "konto usunięte",
    ],
    ["brak jednego i drugiego", { display_name: null, alias: null }, "konto usunięte"],
  ])("%s", (_nazwa, patch: Partial<Parameters<typeof participantName>[0]>, oczekiwane: string) => {
    expect(participantName(threadParticipantRow(patch), "anonim {{alias}}", "konto usunięte")).toBe(
      oczekiwane,
    );
  });
});

describe("ClubParticipantRow - jedna osoba w wątku", () => {
  it("dane pełne: plakietki autora, roli i stanowiska plus rozbity wkład", () => {
    render(
      <ClubParticipantRow
        row={threadParticipantRow({
          is_thread_author: true,
          club_role: "moderator",
          stance: "support",
          reply_count: 3,
          question_count: 2,
          document_count: 1,
          reactions_received: 7,
          avatar_url: "https://example.test/a.jpg",
        })}
        lang="pl"
      />,
    );
    expect(screen.getByText("club.workspace.participants.author")).toBeInTheDocument();
    expect(screen.getByText("club.role.moderator")).toBeInTheDocument();
    expect(screen.getByText("club.stance.support")).toBeInTheDocument();
    // Trzy liczby, nie jedna suma - to są trzy różne rodzaje obecności.
    expect(screen.getByText("club.workspace.participants.replies(count=3)")).toBeInTheDocument();
    expect(screen.getByText("club.workspace.participants.questions(count=2)")).toBeInTheDocument();
    expect(screen.getByText("club.workspace.participants.documents(count=1)")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(
      screen.getByText(/club\.workspace\.participants\.lastActive\(date=.*2026/),
    ).toBeInTheDocument();
  });

  it("tryb poufny: alias zamiast nazwy, bez roli i bez stanowiska", () => {
    render(
      <ClubParticipantRow
        row={threadParticipantRow({
          display_name: null,
          alias: "Uczestnik 3",
          club_role: null,
          stance: null,
          user_id: null,
          profile_slug: null,
        })}
        lang="en"
      />,
    );
    expect(screen.getByText("club.anonymousAuthor")).toBeInTheDocument();
    expect(screen.queryByText(/club\.role\./)).not.toBeInTheDocument();
    expect(screen.queryByText(/club\.stance\./)).not.toBeInTheDocument();
  });

  it("zerowy wkład i zerowe reakcje nie pokazują zer, a brak daty nie pokazuje pustej linijki", () => {
    render(
      <ClubParticipantRow
        row={threadParticipantRow({
          reply_count: 0,
          question_count: 0,
          document_count: 0,
          reactions_received: 0,
          last_at: null,
          is_thread_author: false,
        })}
        lang="pl"
      />,
    );
    expect(
      screen.queryByText(/club\.workspace\.participants\.(replies|questions|documents)/),
    ).toBeNull();
    expect(screen.queryByText("club.workspace.participants.reactions")).not.toBeInTheDocument();
    expect(screen.queryByText(/club\.workspace\.participants\.lastActive/)).toBeNull();
    expect(screen.queryByText("club.workspace.participants.author")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ClubTopicNav
// ---------------------------------------------------------------------------

describe("ClubTopicNav - wejście w klub „per tematyka”", () => {
  it.each([
    ["bez klubów", []],
    ["jeden obszar", [{ policy_area: "energy" }, { policy_area: "energy" }]],
    ["kluby bez obszaru", [{ policy_area: null }, { policy_area: "  " }]],
  ])("przy „%s” pasek nie powstaje", (_nazwa, clubs: { policy_area: string | null }[]) => {
    const { container } = renderWithQueryClient(
      <ClubTopicNav clubs={clubs} value={null} onChange={() => undefined} />,
    );
    expect(container.querySelector("nav")).toBeNull();
  });

  it("w locie po katalog etykiety idą z listy awaryjnej, a liczniki z danych", () => {
    renderWithQueryClient(
      <ClubTopicNav
        clubs={[
          { policy_area: "energy" },
          { policy_area: "energy" },
          { policy_area: "transport" },
          { policy_area: null },
        ]}
        value={null}
        onChange={() => undefined}
      />,
    );
    const nav = screen.getByRole("navigation", { name: "club.hub.topicsLabel" });
    // „Wszystkie” liczy WSZYSTKIE kluby, także te bez obszaru.
    expect(within(nav).getByRole("button", { name: /club\.hub\.allTopics/ })).toHaveTextContent(
      "4",
    );
    expect(within(nav).getByRole("button", { name: /^Energetyka 2$/ })).toHaveTextContent("2");
    expect(within(nav).getByRole("button", { name: /Transport/ })).toHaveTextContent("1");
    expect(within(nav).getByRole("button", { name: /club\.hub\.allTopics/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("katalog z organizacji wygrywa z listą awaryjną, gdy dojedzie", async () => {
    katalogRpc.fetch.mockResolvedValue([...KATALOG]);
    renderWithQueryClient(
      <ClubTopicNav
        clubs={[{ policy_area: "energy" }, { policy_area: "transport" }]}
        value={null}
        onChange={() => undefined}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Energetyka i klimat/ })).toBeInTheDocument(),
    );
  });

  it("kliknięcia: „wszystkie” zeruje filtr, obszar go ustawia, a wybrany odznacza", () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <ClubTopicNav
        clubs={[{ policy_area: "energy" }, { policy_area: "transport" }]}
        value="energy"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /club\.hub\.allTopics/ }));
    expect(onChange).toHaveBeenLastCalledWith(null);

    fireEvent.click(screen.getByRole("button", { name: /Transport/ }));
    expect(onChange).toHaveBeenLastCalledWith("transport");

    // Ten sam obszar drugi raz = odznaczenie, nie ponowne ustawienie.
    fireEvent.click(screen.getByRole("button", { name: /Energetyka/ }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("button", { name: /Energetyka/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("etykieta obszaru idzie z języka instancji i18n, a nie ze zgadywania", () => {
    renderWithQueryClient(
      <ClubTopicNav
        clubs={[{ policy_area: "energy" }, { policy_area: "transport" }]}
        value={null}
        onChange={() => undefined}
      />,
    );
    // Atrapa i18n mówi „pl”, więc etykiety są polskie - to jest dowód, że
    // molekuła pyta o język instancję i18n, a nie zgaduje.
    expect(screen.getByRole("button", { name: /Energetyka/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Energy/ })).not.toBeInTheDocument();
  });
});

// Osobny blok, bo dowodzi PIERWSZEŃSTWA sygnałów obecności: data dołączenia
// sprzed doby nie robi z człowieka „nowego tutaj” - to dwa różne fakty.
describe("ClubRosterFaces - data dołączenia z przesunięcia", () => {
  it("dzień wcześniej to nadal „członek od”, nie „nowy tutaj”", () => {
    render(
      <ClubRosterFaces
        faces={[face({ slug: null, joinedAt: wsIsoOffset(-60 * 24) })]}
        topicCatalog={[]}
      />,
    );
    expect(screen.getByText(/club\.network\.roster\.memberSince/)).toBeInTheDocument();
    expect(screen.queryByText(/club\.network\.roster\.newHere/)).not.toBeInTheDocument();
  });
});
