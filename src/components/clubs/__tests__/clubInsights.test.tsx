// Pomiar klubu (`ClubInsights`) - kafelki i trzy wykresy nad jednym zakresem dni.
//
// CO TEN PLIK DOWODZI.
//
//   1. ZAKRES JEST WSPÓLNY DLA OBU ODCZYTÓW. Kafelki i szereg dzienny to dwa
//      różne RPC; gdyby zakres jechał tylko do jednego, ekran pokazywałby
//      „30 dni” nad wykresem z 90. Test czyta argumenty OBU wywołań.
//   2. ZEROWE DANE NIE PRODUKUJĄ `NaN` ANI PUSTEGO WYKRESU. Klub bez ruchu ma
//      zera na kafelkach, kreskę tam, gdzie mediany NIE MA (żaden wątek nie
//      doczekał się odpowiedzi), i napis „brak danych” w miejscu każdego
//      z trzech wykresów - a nie oś bez serii.
//   3. BRAK WIERSZA PRZEKROJU TO NIE PUSTY KLUB, a brak prawa odczytu -
//      i dlatego ekran mówi jedno zdanie zamiast rysować zera.
//   4. PRZEKROJE JSONB SĄ CZYTANE ODPORNIE: wpis bez nazwy albo bez klucza
//      wypada, a przekrój nie znika w całości z powodu jednego wiersza.
//   5. RANKING POJAWIA SIĘ TYLKO WTEDY, GDY RPC COŚ ODDAŁO. Pusty nagłówek
//      „Najaktywniejsi” w klubie pod regułą Chatham House sugerowałby, że nikt
//      nie pisze - a RPC po prostu nie ma prawa oddać nazwisk.
//   6. WYKRES RODZAJÓW JEST SORTOWANY ROSNĄCO (słupki poziome), a wykres
//      działów niesie nazwy przez `pickLocalized`, nie przez własny wybór języka.
//   7. „PUSTY WYKRES AKTYWNOŚCI” LICZY SIĘ Z WĄTKÓW I ODPOWIEDZI, nie z liczby
//      punktów: sto dni z zerami to brak danych, jeden dzień z odpowiedzią - nie.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - `parseKindBreakdown` / `parseGroupBreakdown` / `parseContributors` mają
//   tabele przypadków w zakresie `workspaceTypes`. Tutaj dowodzimy, że ekran je
//   WOŁA i respektuje wynik (pusty przekrój chowa sekcję albo wykres).
// - `EChart` jest atrapą: prawdziwy ECharts to leniwy klient bez layoutu pod
//   happy-dom, a jego rysowanie nie jest regułą produktu tego ekranu. Atrapa
//   odsłania OPCJĘ, czyli dokładnie to, co ten organizm produkuje.
// - Skeletonu `ClubInsightsSkeleton` i atomów kafelka - zakres w testach atomów.
// - Kluczy cache'u i `staleTime` - zakres w `useClubWorkspace`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { workspaceApiMock, resetWorkspaceApiMock } from "@/test/clubs/workspaceApiMock";
import { CLUB_IDS } from "@/test/clubs/fixtures";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import type { ClubActivityPoint, ClubWorkspaceStatsRow } from "@/lib/clubs/workspaceTypes";
import { ClubInsights } from "@/components/clubs/organisms/ClubInsights";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-club", () => ({ ensureClubI18n: () => undefined }));
vi.mock("@/lib/clubs/workspaceApi", () => workspaceApiMock);

// Prawdziwy `EChart` to leniwa granica klienta ładująca ECharts dynamicznym
// importem - pod happy-dom nie ma czego rysować. Atrapa wystawia OPCJĘ, czyli
// jedyną rzecz, którą ten organizm naprawdę wytwarza.
vi.mock("@/components/admin/analytics/EChart", () => ({
  EChart: ({ option, height }: { option: unknown; height?: number | string }) => (
    <div data-testid="wykres" data-height={String(height)}>
      {JSON.stringify(option)}
    </div>
  ),
}));

const LICZBY = new Intl.NumberFormat("pl-PL");

function statsRow(overrides: Partial<ClubWorkspaceStatsRow> = {}): ClubWorkspaceStatsRow {
  return {
    threads_window: 12,
    threads_total: 1240,
    replies_window: 55,
    replies_total: 210,
    active_participants: 7,
    median_first_reply_hours: 4.5,
    unanswered: 2,
    documents_count: 9,
    upcoming_events: 3,
    open_milestones: 4,
    kind_breakdown: [
      { key: "poll", count: 2 },
      { key: "discussion", count: 9 },
      { key: "announcement", count: 5 },
    ],
    group_breakdown: [
      { id: "g-1", name_pl: "Dyskusje", name_en: "Discussions", count: 8 },
      { id: "g-2", name_pl: "Analizy", name_en: "Analyses", count: 3 },
    ],
    top_contributors: [
      {
        name: "Anna Nowak",
        slug: "anna-nowak",
        avatar_url: "https://obrazy.example/a.png",
        count: 14,
      },
      { name: "bogdan zieliński", slug: null, avatar_url: null, count: 6 },
    ],
    ...overrides,
  };
}

function punkt(overrides: Partial<ClubActivityPoint> = {}): ClubActivityPoint {
  return { day: "2026-08-18", threads: 0, replies: 0, participants: 0, ...overrides };
}

function wykresy(): HTMLElement[] {
  return screen.queryAllByTestId("wykres");
}

function pustki(): HTMLElement[] {
  return screen.queryAllByText("club.insights.noData");
}

beforeEach(() => {
  resetWorkspaceApiMock();
  workspaceApiMock.fetchClubActivitySeries.mockResolvedValue([]);
  workspaceApiMock.fetchClubWorkspaceStats.mockResolvedValue(statsRow());
});

afterEach(() => {
  cleanup();
});

describe("ClubInsights - stany zapytania", () => {
  it("szereg dzienny w locie pokazuje skeleton pulpitu", () => {
    workspaceApiMock.fetchClubActivitySeries.mockReturnValue(new Promise<never>(() => undefined));
    const { container } = renderWithQueryClient(<ClubInsights clubId={CLUB_IDS.club} />);

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText("club.insights.rangeLabel")).toBeNull();
  });

  it("przekrój w locie też pokazuje skeleton - kafelki bez liczb byłyby kłamstwem", () => {
    workspaceApiMock.fetchClubWorkspaceStats.mockReturnValue(new Promise<never>(() => undefined));
    const { container } = renderWithQueryClient(<ClubInsights clubId={CLUB_IDS.club} />);

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("awaria szeregu dziennego pokazuje błąd, a ponowienie odświeża OBA odczyty", async () => {
    workspaceApiMock.fetchClubActivitySeries.mockRejectedValue(new Error("rpc padlo"));
    renderWithQueryClient(<ClubInsights clubId={CLUB_IDS.club} />);

    await waitFor(() => expect(screen.getByText("club.error.title")).toBeInTheDocument());
    const szeregPrzed = workspaceApiMock.fetchClubActivitySeries.mock.calls.length;
    const przekrojPrzed = workspaceApiMock.fetchClubWorkspaceStats.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "club.error.retry" }));
    await waitFor(() => {
      expect(workspaceApiMock.fetchClubActivitySeries.mock.calls.length).toBeGreaterThan(
        szeregPrzed,
      );
      expect(workspaceApiMock.fetchClubWorkspaceStats.mock.calls.length).toBeGreaterThan(
        przekrojPrzed,
      );
    });
  });

  it("awaria przekroju też zdejmuje pulpit - jedna połowa pomiaru to nie pomiar", async () => {
    workspaceApiMock.fetchClubWorkspaceStats.mockRejectedValue(new Error("rpc padlo"));
    renderWithQueryClient(<ClubInsights clubId={CLUB_IDS.club} />);

    await waitFor(() => expect(screen.getByText("club.error.title")).toBeInTheDocument());
    expect(screen.queryByText("club.insights.kpi.threads")).toBeNull();
  });

  it("brak wiersza przekroju to brak prawa odczytu, a nie zera na kafelkach", async () => {
    workspaceApiMock.fetchClubWorkspaceStats.mockResolvedValue(null);
    renderWithQueryClient(<ClubInsights clubId={CLUB_IDS.club} />);

    await waitFor(() => expect(screen.getByText("club.insights.empty")).toBeInTheDocument());
    expect(screen.queryByText("club.insights.kpi.threads")).toBeNull();
    expect(wykresy()).toHaveLength(0);
  });
});

describe("ClubInsights - zakres dni", () => {
  it("otwiera się na dziewięćdziesięciu dniach i wysyła ten zakres do OBU odczytów", async () => {
    renderWithQueryClient(<ClubInsights clubId={CLUB_IDS.club} />);

    await waitFor(() => expect(screen.getByText("club.insights.rangeLabel")).toBeInTheDocument());
    expect(workspaceApiMock.fetchClubActivitySeries).toHaveBeenCalledWith(CLUB_IDS.club, 90);
    expect(workspaceApiMock.fetchClubWorkspaceStats).toHaveBeenCalledWith(CLUB_IDS.club, 90);
    expect(
      screen.getByRole("button", { name: "club.insights.rangeDays(count=90)" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("zmiana zakresu przestawia OBA odczyty i przełącza wskazanie przycisku", async () => {
    renderWithQueryClient(<ClubInsights clubId={CLUB_IDS.club} />);
    await waitFor(() => expect(screen.getByText("club.insights.rangeLabel")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "club.insights.rangeDays(count=30)" }));

    await waitFor(() =>
      expect(workspaceApiMock.fetchClubActivitySeries).toHaveBeenCalledWith(CLUB_IDS.club, 30),
    );
    expect(workspaceApiMock.fetchClubWorkspaceStats).toHaveBeenCalledWith(CLUB_IDS.club, 30);
    expect(
      await screen.findByRole("button", { name: "club.insights.rangeDays(count=30)" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "club.insights.rangeDays(count=90)" }),
    ).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: "club.insights.rangeDays(count=180)" }));
    await waitFor(() =>
      expect(workspaceApiMock.fetchClubWorkspaceStats).toHaveBeenCalledWith(CLUB_IDS.club, 180),
    );
  });
});

describe("ClubInsights - dane ZEROWE", () => {
  const zera = statsRow({
    threads_window: 0,
    threads_total: 0,
    replies_window: 0,
    replies_total: 0,
    active_participants: 0,
    median_first_reply_hours: null,
    unanswered: 0,
    documents_count: 0,
    upcoming_events: 0,
    open_milestones: 0,
    kind_breakdown: [],
    group_breakdown: [],
    top_contributors: [],
  });

  it("klub bez ruchu pokazuje zera, a nie `NaN` ani pustego kafelka", async () => {
    workspaceApiMock.fetchClubWorkspaceStats.mockResolvedValue(zera);
    const { container } = renderWithQueryClient(<ClubInsights clubId={CLUB_IDS.club} />);

    await waitFor(() => expect(screen.getByText("club.insights.kpi.threads")).toBeInTheDocument());
    expect(screen.getAllByText("0")).toHaveLength(7);
    expect(container.textContent).not.toContain("NaN");
    expect(container.textContent).not.toContain("undefined");
  });

  it("brak mediany pierwszej odpowiedzi to KRESKA, nie zero", async () => {
    workspaceApiMock.fetchClubWorkspaceStats.mockResolvedValue(zera);
    renderWithQueryClient(<ClubInsights clubId={CLUB_IDS.club} />);

    await waitFor(() =>
      expect(screen.getByText("club.insights.kpi.firstReply")).toBeInTheDocument(),
    );
    expect(screen.getByText("-")).toBeInTheDocument();
    expect(screen.queryByText(/club.insights.hours/)).toBeNull();
  });

  it("wszystkie trzy wykresy mówią „brak danych” zamiast rysować pustą oś", async () => {
    workspaceApiMock.fetchClubWorkspaceStats.mockResolvedValue(zera);
    renderWithQueryClient(<ClubInsights clubId={CLUB_IDS.club} />);

    await waitFor(() => expect(pustki()).toHaveLength(3));
    expect(wykresy()).toHaveLength(0);
  });

  it("ranking najaktywniejszych NIE POJAWIA SIĘ, gdy RPC nie oddało nazwisk", async () => {
    workspaceApiMock.fetchClubWorkspaceStats.mockResolvedValue(zera);
    renderWithQueryClient(<ClubInsights clubId={CLUB_IDS.club} />);

    await waitFor(() => expect(screen.getByText("club.insights.kpi.threads")).toBeInTheDocument());
    expect(screen.queryByText("club.insights.contributors")).toBeNull();
  });

  it("sto dni samych zer to nadal „brak danych” na wykresie aktywności", async () => {
    workspaceApiMock.fetchClubActivitySeries.mockResolvedValue([
      punkt({ day: "2026-08-16" }),
      punkt({ day: "2026-08-17" }),
      punkt({ day: "2026-08-18" }),
    ]);
    workspaceApiMock.fetchClubWorkspaceStats.mockResolvedValue(zera);
    renderWithQueryClient(<ClubInsights clubId={CLUB_IDS.club} />);

    await waitFor(() => expect(pustki()).toHaveLength(3));
  });

  it("jeden dzień z odpowiedzią wystarczy, by wykres aktywności PRZESTAŁ być pusty", async () => {
    workspaceApiMock.fetchClubActivitySeries.mockResolvedValue([
      punkt({ day: "2026-08-17" }),
      punkt({ day: "2026-08-18", threads: 0, replies: 4, participants: 2 }),
    ]);
    workspaceApiMock.fetchClubWorkspaceStats.mockResolvedValue(zera);
    renderWithQueryClient(<ClubInsights clubId={CLUB_IDS.club} />);

    await waitFor(() => expect(wykresy()).toHaveLength(1));
    expect(pustki()).toHaveLength(2);
  });
});

describe("ClubInsights - dane PEŁNE", () => {
  it("kafelki niosą liczby okna i podpowiedzi z liczbami całościowymi", async () => {
    renderWithQueryClient(<ClubInsights clubId={CLUB_IDS.club} />);

    await waitFor(() => expect(screen.getByText("club.insights.kpi.threads")).toBeInTheDocument());
    expect(screen.getByText(LICZBY.format(12))).toBeInTheDocument();
    expect(screen.getByText("club.insights.kpi.threadsHint(count=1240)")).toBeInTheDocument();
    expect(screen.getByText(LICZBY.format(55))).toBeInTheDocument();
    expect(screen.getByText("club.insights.kpi.repliesHint(count=210)")).toBeInTheDocument();
    expect(screen.getByText("club.insights.hours(value=4.5)")).toBeInTheDocument();
    expect(screen.getByText("club.insights.kpi.participantsHint")).toBeInTheDocument();
    expect(screen.getByText("club.insights.kpi.unansweredHint")).toBeInTheDocument();
  });

  it("kafelki bez podpowiedzi nie rysują pustego wiersza pod liczbą", async () => {
    renderWithQueryClient(<ClubInsights clubId={CLUB_IDS.club} />);

    await waitFor(() =>
      expect(screen.getByText("club.insights.kpi.documents")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/club.insights.kpi.documentsHint/)).toBeNull();
    expect(screen.queryByText(/club.insights.kpi.eventsHint/)).toBeNull();
    expect(screen.queryByText(/club.insights.kpi.milestonesHint/)).toBeNull();
  });

  it("szereg dzienny idzie na wykres z krótkimi etykietami osi i trzema seriami", async () => {
    workspaceApiMock.fetchClubActivitySeries.mockResolvedValue([
      punkt({ day: "2026-08-17", threads: 3, replies: 1, participants: 2 }),
      punkt({ day: "2026-08-18", threads: 1, replies: 6, participants: 4 }),
    ]);
    renderWithQueryClient(<ClubInsights clubId={CLUB_IDS.club} />);

    await waitFor(() => expect(wykresy()).toHaveLength(3));
    const aktywnosc = wykresy()[0]?.textContent ?? "";
    expect(aktywnosc).toContain('"17 sie"');
    expect(aktywnosc).toContain('"18 sie"');
    expect(aktywnosc).toContain('"club.insights.chart.threads"');
    expect(aktywnosc).toContain('"club.insights.chart.replies"');
    expect(aktywnosc).toContain('"club.insights.chart.participants"');
    expect(aktywnosc).toContain("[3,1]");
    expect(aktywnosc).toContain("[1,6]");
    expect(aktywnosc).toContain("[2,4]");
    expect(wykresy()[0]).toHaveAttribute("data-height", "280");
  });

  it("wykres rodzajów sortuje słupki ROSNĄCO i tłumaczy klucze rodzaju", async () => {
    // Wykres aktywności musi mieć czym się zapełnić, żeby trzy karty stały
    // w tej samej kolejności, w jakiej je składa organizm.
    workspaceApiMock.fetchClubActivitySeries.mockResolvedValue([
      punkt({ day: "2026-08-18", threads: 2, replies: 3, participants: 1 }),
    ]);
    renderWithQueryClient(<ClubInsights clubId={CLUB_IDS.club} />);

    await waitFor(() => expect(wykresy()).toHaveLength(3));
    const rodzaje = wykresy()[1]?.textContent ?? "";
    expect(rodzaje).toContain('["club.kind.poll","club.kind.announcement","club.kind.discussion"]');
    expect(rodzaje).toContain("[2,5,9]");
    expect(wykresy()[1]).toHaveAttribute("data-height", "240");
  });

  it("wykres działów bierze nazwy przez wspólny wybór języka", async () => {
    // Wykres aktywności musi mieć czym się zapełnić, żeby trzy karty stały
    // w tej samej kolejności, w jakiej je składa organizm.
    workspaceApiMock.fetchClubActivitySeries.mockResolvedValue([
      punkt({ day: "2026-08-18", threads: 2, replies: 3, participants: 1 }),
    ]);
    renderWithQueryClient(<ClubInsights clubId={CLUB_IDS.club} />);

    await waitFor(() => expect(wykresy()).toHaveLength(3));
    const dzialy = wykresy()[2]?.textContent ?? "";
    expect(dzialy).toContain('"name":"Dyskusje","value":8');
    expect(dzialy).toContain('"name":"Analizy","value":3');
  });

  it("ranking pokazuje nazwiska, liczby odpowiedzi i inicjały tam, gdzie nie ma awatara", async () => {
    renderWithQueryClient(<ClubInsights clubId={CLUB_IDS.club} />);

    await waitFor(() => expect(screen.getByText("club.insights.contributors")).toBeInTheDocument());
    const lista = within(screen.getByRole("list"));
    expect(lista.getByText("Anna Nowak")).toBeInTheDocument();
    expect(lista.getByText("bogdan zieliński")).toBeInTheDocument();
    expect(lista.getByText("club.insights.replyCount(count=14)")).toBeInTheDocument();
    expect(lista.getByText("club.insights.replyCount(count=6)")).toBeInTheDocument();
    // Zastępnik awatara to DWIE pierwsze litery wersalikami - także dla nazwy
    // zapisanej małymi literami.
    expect(lista.getByText("AN")).toBeInTheDocument();
    expect(lista.getByText("BO")).toBeInTheDocument();
  });
});

describe("ClubInsights - dane CZĘŚCIOWE", () => {
  it("wpis przekroju bez klucza wypada, a reszta przekroju zostaje", async () => {
    workspaceApiMock.fetchClubWorkspaceStats.mockResolvedValue(
      statsRow({
        kind_breakdown: [{ count: 4 }, { key: "question", count: 7 }],
        top_contributors: [],
      }),
    );
    renderWithQueryClient(<ClubInsights clubId={CLUB_IDS.club} />);

    await waitFor(() => expect(wykresy()).toHaveLength(2));
    const rodzaje = wykresy()[0]?.textContent ?? "";
    expect(rodzaje).toContain('["club.kind.question"]');
    expect(rodzaje).toContain("[7]");
  });

  it("przekrój działów w kształcie, którego nie da się przeczytać, chowa wykres działów", async () => {
    workspaceApiMock.fetchClubWorkspaceStats.mockResolvedValue(
      statsRow({ group_breakdown: "to nie jest tablica", top_contributors: [] }),
    );
    renderWithQueryClient(<ClubInsights clubId={CLUB_IDS.club} />);

    await waitFor(() => expect(pustki()).toHaveLength(2));
    expect(wykresy()).toHaveLength(1);
  });

  it("dział bez nazwy w drugim języku dostaje nazwę z pierwszego, a nie pustą etykietę", async () => {
    workspaceApiMock.fetchClubWorkspaceStats.mockResolvedValue(
      statsRow({
        group_breakdown: [{ id: "g-3", name_en: "Only English", count: 5 }],
        kind_breakdown: [],
        top_contributors: [],
      }),
    );
    renderWithQueryClient(<ClubInsights clubId={CLUB_IDS.club} />);

    await waitFor(() => expect(wykresy()).toHaveLength(1));
    expect(wykresy()[0]?.textContent ?? "").toContain('"name":"Only English","value":5');
  });

  it("wpis rankingu bez nazwy wypada, a ranking z jedną osobą nadal się rysuje", async () => {
    workspaceApiMock.fetchClubWorkspaceStats.mockResolvedValue(
      statsRow({
        top_contributors: [
          { slug: "brak-nazwy", count: 9 },
          { name: "Ewa Kowalska", count: 3 },
        ],
      }),
    );
    renderWithQueryClient(<ClubInsights clubId={CLUB_IDS.club} />);

    await waitFor(() => expect(screen.getByText("club.insights.contributors")).toBeInTheDocument());
    const lista = within(screen.getByRole("list"));
    expect(lista.getAllByRole("listitem")).toHaveLength(1);
    expect(lista.getByText("Ewa Kowalska")).toBeInTheDocument();
    expect(lista.getByText("club.insights.replyCount(count=3)")).toBeInTheDocument();
  });

  it("wpis rankingu z nieliczbowym licznikiem czyta się jako zero, a nie jako `NaN`", async () => {
    workspaceApiMock.fetchClubWorkspaceStats.mockResolvedValue(
      statsRow({ top_contributors: [{ name: "Jan Kowalski", count: "dużo" }] }),
    );
    const { container } = renderWithQueryClient(<ClubInsights clubId={CLUB_IDS.club} />);

    await waitFor(() =>
      expect(screen.getByText("club.insights.replyCount(count=0)")).toBeInTheDocument(),
    );
    expect(container.textContent).not.toContain("NaN");
  });
});
