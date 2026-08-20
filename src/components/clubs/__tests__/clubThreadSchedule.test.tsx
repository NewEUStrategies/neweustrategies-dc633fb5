// Harmonogram wątku: panel („Harmonogram”) i jego druga prezentacja - SIATKA
// MIESIĄCA (`ClubThreadCalendar`).
//
// CO TEN PLIK DOWODZI.
//
//   1. JEDEN ZBIÓR DANYCH, DWIE PREZENTACJE. Przełącznik widoku nie pobiera
//      niczego ponownie, więc lista i siatka NIE MOGĄ pokazać dwóch różnych
//      harmonogramów. Test przełącza widok bez zmiany atrapy RPC i sprawdza,
//      że po obu stronach stoi ten sam wiersz - a licznik wywołań RPC się nie
//      rusza.
//   2. KOLEJNOŚĆ KUBEŁKÓW JEST TEZĄ: „dziś”, „wkrótce”, „minione”, a minione
//      od NAJNOWSZYCH. Harmonogram odpowiada na pytanie „co dalej”, nie „co
//      było”, a ostatnie ustalenie waży więcej niż spotkanie sprzed pół roku.
//   3. KOMÓRKA DNIA MA STAŁĄ WYSOKOŚĆ, więc piąte spotkanie nie może rozpychać
//      tygodnia: dwie pozycje plus licznik reszty.
//   4. SIATKA JEST TABELĄ, nie gridem z divów - nagłówki dni mają `scope="col"`,
//      a miesiąc ma podpis. Nazwy dni idą z `Intl` od PONIEDZIAŁKU (tak wygląda
//      tydzień w PL i w instytucjach UE), więc nie ma tu słownika do
//      utrzymania - i test porównuje je z `Intl`, a nie z wpisanym napisem.
//   5. KALENDARZ BEZ PRAWA KURATORSKIEGO JEST TYLKO DO CZYTANIA. Panel podaje
//      `onSelect` WYŁĄCZNIE kuratorowi, więc kliknięcie w kafelek dnia u
//      czytelnika nie ma prawa nic otworzyć.
//   6. USUNIĘCIE PRZECHODZI PRZEZ POTWIERDZENIE, a odmowa bazy wraca jako KOD
//      błędu (`club.workspace.error.<kod>`), nie jako polski napis.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - `groupSchedule` i `buildCalendarGrid` mają tabele przypadków w zakresie
//   `threadWorkspaceTypes` (granica doby, zakresy rozpięte na dwa dni, pełne
//   tygodnie). Tutaj dowodzimy, że panel je WOŁA i respektuje wynik - kubełki
//   sprawdzamy w KOLEJNOŚCI, nie w rachunku.
// - MOLEKUŁ: `ClubMilestoneRow` (komponent) i `ClubMilestoneForm` są atrapami
//   wystawiającymi swoje callbacki; ich walidacja i kształt patcha mają zakres
//   w `clubWorkspaceForms.test.tsx`. `milestoneWhen` zostaje PRAWDZIWA, bo
//   siatka liczy z niej nazwę dostępną kafelka.
// - WARSTWY DANYCH: klucze cache'u i zakres unieważnień ma
//   `clubWorkspaceHooks.test.tsx`.
//
// CZAS STOI. Oba organizmy wołają `new Date()` bez argumentu (chwila
// odniesienia kubełków i „dziś” w siatce), więc bez zamrożonego zegara pozycja
// na granicy doby wpadałaby raz tu, raz tam.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  toasts: [] as { level: "success" | "error"; key: string }[],
  confirmed: true,
  /** Wiersze przekazane render-propowi siatki przez `onSelect`. */
  wybrane: [] as string[],
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-club", () => ({ ensureClubI18n: () => undefined }));
vi.mock("sonner", () => ({
  toast: {
    success: (key: string) => h.toasts.push({ level: "success", key }),
    error: (key: string) => h.toasts.push({ level: "error", key }),
  },
}));
vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
vi.mock("@/lib/clubs/threadWorkspaceApi", () => threadApiMock);

vi.mock("@/components/clubs/molecules/ClubMilestoneRow", async (importOriginal) => ({
  // `milestoneWhen` PRAWDZIWA: siatka składa z niej `aria-label` kafelka.
  ...(await importOriginal<typeof import("@/components/clubs/molecules/ClubMilestoneRow")>()),
  ClubMilestoneRow: ({
    row,
    onEdit,
    onRemove,
  }: {
    row: { id: string; title: string };
    onEdit?: (row: { id: string; title: string }) => void;
    onRemove?: (row: { id: string; title: string }) => void;
  }) => (
    <li data-testid={`ms-${row.id}`}>
      {row.title}
      <button type="button" onClick={() => onEdit?.(row)}>{`edytuj ${row.id}`}</button>
      <button type="button" onClick={() => onRemove?.(row)}>{`usun ${row.id}`}</button>
    </li>
  ),
}));

vi.mock("@/components/clubs/molecules/ClubMilestoneForm", () => ({
  ClubMilestoneForm: (props: {
    initial: { id: string } | null;
    pending: boolean;
    onCancel: () => void;
    onSubmit: (input: { title_pl: string }) => void;
  }) => (
    <div
      data-testid="ms-form"
      data-initial={props.initial?.id ?? ""}
      data-pending={String(props.pending)}
    >
      <button type="button" onClick={() => props.onSubmit({ title_pl: "Nowy termin" })}>
        zapisz termin
      </button>
      <button type="button" onClick={props.onCancel}>
        anuluj termin
      </button>
    </div>
  ),
}));

// KOLEJNOŚĆ IMPORTÓW JEST ZNACZĄCA - patrz `clubThreadPanels.test.tsx`.
import { resetThreadApiMock, threadApiMock } from "@/test/clubs/workspaceApiMock";
import { WS_BASE_ISO, threadMilestoneRow, wsIsoOffset } from "@/test/clubs/threadWorkspaceFixtures";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ClubThreadCalendar } from "@/components/clubs/organisms/ClubThreadCalendar";
import { ClubThreadSchedulePanel } from "@/components/clubs/organisms/ClubThreadSchedulePanel";
import { milestoneWhen } from "@/components/clubs/molecules/ClubMilestoneRow";
import { uiLocale } from "@/lib/i18n/format";
import type { ClubThreadMilestoneRow } from "@/lib/clubs/workspaceTypes";

const THREAD = "thread-1";
const DZIEN = 60 * 24;

const wLocie = () => new Promise<never>(() => {});
const odmowa = () => Promise.reject(new Error("club_thread_forbidden"));

function ladunek(mock: { mock: { calls: unknown[][] } }, index = 0): unknown {
  return mock.mock.calls[index]?.[0];
}

beforeEach(() => {
  // Zegar stoi na 2026-08-18 10:00 UTC (wtorek) - „dziś” w obu organizmach.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(WS_BASE_ISO));
  resetThreadApiMock();
  h.toasts = [];
  h.confirmed = true;
  h.wybrane = [];
  Object.defineProperty(window, "confirm", {
    configurable: true,
    writable: true,
    value: () => h.confirmed,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Siatka miesiąca
// ---------------------------------------------------------------------------

describe("ClubThreadCalendar", () => {
  const renderGrid = (
    rows: ClubThreadMilestoneRow[],
    onSelect?: (row: ClubThreadMilestoneRow) => void,
  ) => render(<ClubThreadCalendar rows={rows} lang="pl" onSelect={onSelect} />);

  /** Ten sam rachunek, co w organizmie - napis liczy `Intl`, nie słownik. */
  const etykietaMiesiaca = (date: Date) =>
    new Intl.DateTimeFormat(uiLocale("pl"), { month: "long", year: "numeric" }).format(date);

  it("nagłówki dni idą z Intl i zaczynają się od PONIEDZIAŁKU", () => {
    renderGrid([]);

    const naglowki = screen.getAllByRole("columnheader");
    expect(naglowki).toHaveLength(7);
    const formatter = new Intl.DateTimeFormat(uiLocale("pl"), { weekday: "short" });
    expect(naglowki.map((node) => node.textContent)).toEqual(
      Array.from({ length: 7 }, (_, i) => formatter.format(new Date(2024, 0, 1 + i))),
    );
    expect(naglowki[0]).toHaveAttribute("scope", "col");
  });

  it("miesiąc ma podpis dla czytnika ekranu i pełne tygodnie", () => {
    const { container } = renderGrid([]);

    // Sierpień 2026 zaczyna się w sobotę, więc siatka ma sześć pełnych rzędów.
    expect(container.querySelectorAll("tbody tr")).toHaveLength(6);
    expect(container.querySelectorAll("tbody td")).toHaveLength(42);
    expect(container.querySelector("caption")).toHaveTextContent(
      `club.workspace.calendar.caption(month=${etykietaMiesiaca(new Date(2026, 7, 1))})`,
    );
  });

  it("dzisiejsza komórka jest wyróżniona, a dni z sąsiednich miesięcy przygaszone", () => {
    const { container } = renderGrid([]);

    const wyroznione = Array.from(container.querySelectorAll("tbody span")).filter((node) =>
      node.className.includes("bg-primary"),
    );
    expect(wyroznione).toHaveLength(1);
    expect(wyroznione[0]).toHaveTextContent("18");
    // Pięć dni z lipca i sześć z września w pełnych tygodniach = 11 komórek.
    const obce = Array.from(container.querySelectorAll("tbody td")).filter((node) =>
      node.className.includes("bg-muted/20"),
    );
    expect(obce).toHaveLength(11);
  });

  it("kafelek dnia nazywa się tytułem I terminem, a klik oddaje CAŁY wiersz", () => {
    const row = threadMilestoneRow({ starts_at: wsIsoOffset(120) });
    renderGrid([row], (wybrany) => h.wybrane.push(wybrany.id));

    const kafelek = screen.getByRole("button", {
      name: `${row.title} - ${milestoneWhen(row, "pl")}`,
    });
    fireEvent.click(kafelek);

    expect(h.wybrane).toEqual(["milestone-1"]);
  });

  it("trzy pozycje w jednym dniu pokazują dwie i LICZNIK reszty", () => {
    const dzien = wsIsoOffset(120);
    renderGrid([
      threadMilestoneRow({ id: "m-1", title: "Pierwsze", starts_at: dzien }),
      threadMilestoneRow({ id: "m-2", title: "Drugie", starts_at: dzien }),
      threadMilestoneRow({ id: "m-3", title: "Trzecie", starts_at: dzien }),
    ]);

    expect(screen.getByText("Pierwsze")).toBeInTheDocument();
    expect(screen.getByText("Drugie")).toBeInTheDocument();
    expect(screen.queryByText("Trzecie")).toBeNull();
    expect(screen.getByText("club.workspace.calendar.more(count=1)")).toBeInTheDocument();
  });

  it.each([
    ["cancelled", "line-through"],
    ["done", "emerald"],
    ["planned", "bg-primary/15"],
  ] as const)("status %s ma własny wygląd kafelka", (status, fragment) => {
    renderGrid([threadMilestoneRow({ status, starts_at: wsIsoOffset(120) })]);

    expect(screen.getByText("Posiedzenie zespołu").className).toContain(fragment);
  });

  it("status spoza słownika degraduje się do zaplanowanego, a nie wywraca kafelka", () => {
    renderGrid([threadMilestoneRow({ status: "z_nowszej_migracji", starts_at: wsIsoOffset(120) })]);

    expect(screen.getByText("Posiedzenie zespołu").className).toContain("bg-primary/15");
  });

  it("strzałki przestawiają miesiąc, a pozycje zostają w swoim", () => {
    renderGrid([threadMilestoneRow({ starts_at: wsIsoOffset(120) })]);

    fireEvent.click(screen.getByRole("button", { name: "club.workspace.calendar.next" }));

    expect(screen.getByText(etykietaMiesiaca(new Date(2026, 8, 1)))).toBeInTheDocument();
    expect(screen.queryByText("Posiedzenie zespołu")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "club.workspace.calendar.previous" }));

    expect(screen.getByText(etykietaMiesiaca(new Date(2026, 7, 1)))).toBeInTheDocument();
    expect(screen.getByText("Posiedzenie zespołu")).toBeInTheDocument();
  });

  it("cofnięcie za styczeń przechodzi do grudnia POPRZEDNIEGO roku", () => {
    renderGrid([]);

    // Osiem cofnięć z sierpnia 2026 wypada na grudzień 2025.
    for (let i = 0; i < 8; i += 1) {
      fireEvent.click(screen.getByRole("button", { name: "club.workspace.calendar.previous" }));
    }

    expect(screen.getByText(etykietaMiesiaca(new Date(2025, 11, 1)))).toBeInTheDocument();
  });

  it("siatka BEZ `onSelect` jest tylko do czytania - klik nie zmienia niczego", () => {
    const { container } = renderGrid([threadMilestoneRow({ starts_at: wsIsoOffset(120) })]);
    const przed = container.innerHTML;

    fireEvent.click(screen.getByText("Posiedzenie zespołu"));

    expect(container.innerHTML).toBe(przed);
  });

  it("legenda wypisuje wszystkie trzy stany terminu", () => {
    renderGrid([]);

    expect(screen.getByText("club.workspace.milestoneStatus.planned")).toBeInTheDocument();
    expect(screen.getByText("club.workspace.milestoneStatus.done")).toBeInTheDocument();
    expect(screen.getByText("club.workspace.milestoneStatus.cancelled")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Panel harmonogramu
// ---------------------------------------------------------------------------

describe("ClubThreadSchedulePanel", () => {
  const renderPanel = (canCurate = true) =>
    renderWithQueryClient(
      <ClubThreadSchedulePanel threadId={THREAD} lang="pl" canCurate={canCurate} />,
    );

  it("zapytanie w locie pokazuje szkielet", () => {
    threadApiMock.fetchClubThreadMilestones.mockReturnValue(wLocie());

    const { container } = renderPanel();

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("awaria RPC daje komunikat z ponowieniem", async () => {
    threadApiMock.fetchClubThreadMilestones.mockImplementation(odmowa);

    renderPanel();

    expect(await screen.findByText("club.error.title")).toBeInTheDocument();
    const przed = threadApiMock.fetchClubThreadMilestones.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "club.error.retry" }));
    await waitFor(() =>
      expect(threadApiMock.fetchClubThreadMilestones.mock.calls.length).toBeGreaterThan(przed),
    );
  });

  it("pusty harmonogram zaprasza KURATORA do pierwszego terminu", async () => {
    threadApiMock.fetchClubThreadMilestones.mockResolvedValue([]);

    renderPanel(true);

    expect(await screen.findByText("club.workspace.schedule.empty")).toBeInTheDocument();
    expect(screen.getByText("club.workspace.schedule.emptyHint")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "club.workspace.schedule.addFirst" }),
    ).toBeInTheDocument();
  });

  it("pusty harmonogram czytelnika nie zaprasza do niczego", async () => {
    threadApiMock.fetchClubThreadMilestones.mockResolvedValue([]);

    renderPanel(false);

    expect(await screen.findByText("club.workspace.schedule.emptyReadonly")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /schedule\.add/ })).toBeNull();
  });

  it("lista dzieli terminy na dziś / wkrótce / minione, a minione od NAJNOWSZYCH", async () => {
    threadApiMock.fetchClubThreadMilestones.mockResolvedValue([
      threadMilestoneRow({ id: "dawne", title: "Dawne", starts_at: wsIsoOffset(-30 * DZIEN) }),
      threadMilestoneRow({ id: "wkrotce", title: "Wkrótce", starts_at: wsIsoOffset(2 * DZIEN) }),
      threadMilestoneRow({ id: "dzis", title: "Dziś", starts_at: wsIsoOffset(120) }),
      threadMilestoneRow({ id: "wczoraj", title: "Wczoraj", starts_at: wsIsoOffset(-DZIEN) }),
    ]);

    const { container } = renderPanel();

    await screen.findByTestId("ms-dzis");
    expect(
      Array.from(container.querySelectorAll("section > h3")).map((node) => node.textContent),
    ).toEqual([
      "club.workspace.schedule.group.today",
      "club.workspace.schedule.group.upcoming",
      "club.workspace.schedule.group.past",
    ]);
    // W kubełku „minione” bliska przeszłość stoi przed dawną.
    expect(
      Array.from(container.querySelectorAll("li[data-testid]")).map((node) =>
        node.getAttribute("data-testid"),
      ),
    ).toEqual(["ms-dzis", "ms-wkrotce", "ms-wczoraj", "ms-dawne"]);
  });

  it("przełączenie widoku NIE pobiera danych ponownie i pokazuje ten sam wiersz", async () => {
    threadApiMock.fetchClubThreadMilestones.mockResolvedValue([
      threadMilestoneRow({ starts_at: wsIsoOffset(120) }),
    ]);

    renderPanel();
    await screen.findByTestId("ms-milestone-1");
    const przed = threadApiMock.fetchClubThreadMilestones.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "club.workspace.schedule.view.calendar" }));

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("Posiedzenie zespołu")).toBeInTheDocument();
    expect(screen.queryByTestId("ms-milestone-1")).toBeNull();
    expect(threadApiMock.fetchClubThreadMilestones.mock.calls.length).toBe(przed);

    fireEvent.click(screen.getByRole("button", { name: "club.workspace.schedule.view.list" }));

    expect(screen.getByTestId("ms-milestone-1")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("wybrany widok jest ogłoszony przez aria-pressed, nie tylko kolorem", async () => {
    threadApiMock.fetchClubThreadMilestones.mockResolvedValue([threadMilestoneRow()]);

    renderPanel();
    await screen.findByTestId("ms-milestone-1");

    expect(
      screen.getByRole("button", { name: "club.workspace.schedule.view.list" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "club.workspace.schedule.view.calendar" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("group", { name: "club.workspace.schedule.viewLabel" }),
    ).toBeInTheDocument();
  });

  it("kafelek dnia otwiera edycję TEGO terminu, gdy patrzy kurator", async () => {
    threadApiMock.fetchClubThreadMilestones.mockResolvedValue([
      threadMilestoneRow({ starts_at: wsIsoOffset(120) }),
    ]);

    renderPanel(true);
    await screen.findByTestId("ms-milestone-1");
    fireEvent.click(screen.getByRole("button", { name: "club.workspace.schedule.view.calendar" }));
    fireEvent.click(screen.getByText("Posiedzenie zespołu"));

    expect(screen.getByTestId("ms-form")).toHaveAttribute("data-initial", "milestone-1");
  });

  it("kafelek dnia u czytelnika nie otwiera niczego", async () => {
    threadApiMock.fetchClubThreadMilestones.mockResolvedValue([
      threadMilestoneRow({ starts_at: wsIsoOffset(120) }),
    ]);

    renderPanel(false);
    await screen.findByTestId("ms-milestone-1");
    fireEvent.click(screen.getByRole("button", { name: "club.workspace.schedule.view.calendar" }));
    fireEvent.click(screen.getByText("Posiedzenie zespołu"));

    expect(screen.queryByTestId("ms-form")).toBeNull();
  });

  it("„dodaj” otwiera formularz pusty i chowa własny przycisk", async () => {
    threadApiMock.fetchClubThreadMilestones.mockResolvedValue([threadMilestoneRow()]);

    renderPanel(true);
    await screen.findByTestId("ms-milestone-1");
    fireEvent.click(screen.getByRole("button", { name: "club.workspace.schedule.add" }));

    expect(screen.getByTestId("ms-form")).toHaveAttribute("data-initial", "");
    expect(screen.queryByRole("button", { name: "club.workspace.schedule.add" })).toBeNull();
  });

  it("„edytuj” wiersza otwiera formularz z TYM wierszem", async () => {
    threadApiMock.fetchClubThreadMilestones.mockResolvedValue([threadMilestoneRow()]);

    renderPanel(true);
    fireEvent.click(await screen.findByRole("button", { name: "edytuj milestone-1" }));

    expect(screen.getByTestId("ms-form")).toHaveAttribute("data-initial", "milestone-1");
  });

  it("zapis udany zamyka formularz i potwierdza go komunikatem", async () => {
    threadApiMock.fetchClubThreadMilestones.mockResolvedValue([threadMilestoneRow()]);
    threadApiMock.upsertClubThreadMilestone.mockResolvedValue("milestone-9");

    renderPanel(true);
    fireEvent.click(await screen.findByRole("button", { name: "edytuj milestone-1" }));
    fireEvent.click(screen.getByRole("button", { name: "zapisz termin" }));

    await waitFor(() => expect(screen.queryByTestId("ms-form")).toBeNull());
    expect(h.toasts).toEqual([{ level: "success", key: "club.workspace.schedule.saved" }]);
  });

  it("odmowa zapisu ZOSTAWIA formularz i pokazuje KOD błędu", async () => {
    threadApiMock.fetchClubThreadMilestones.mockResolvedValue([threadMilestoneRow()]);
    threadApiMock.upsertClubThreadMilestone.mockRejectedValue(new Error("club_thread_forbidden"));

    renderPanel(true);
    fireEvent.click(await screen.findByRole("button", { name: "edytuj milestone-1" }));
    fireEvent.click(screen.getByRole("button", { name: "zapisz termin" }));

    await waitFor(() => expect(h.toasts).toHaveLength(1));
    expect(h.toasts[0].level).toBe("error");
    expect(h.toasts[0].key).toMatch(/^club\.workspace\.error\./);
    expect(screen.getByTestId("ms-form")).toBeInTheDocument();
  });

  it("anulowanie zamyka formularz bez wysyłki", async () => {
    threadApiMock.fetchClubThreadMilestones.mockResolvedValue([threadMilestoneRow()]);

    renderPanel(true);
    fireEvent.click(await screen.findByRole("button", { name: "edytuj milestone-1" }));
    fireEvent.click(screen.getByRole("button", { name: "anuluj termin" }));

    expect(screen.queryByTestId("ms-form")).toBeNull();
    expect(threadApiMock.upsertClubThreadMilestone).not.toHaveBeenCalled();
  });

  it("odmowa w okienku potwierdzenia NIE usuwa terminu", async () => {
    h.confirmed = false;
    threadApiMock.fetchClubThreadMilestones.mockResolvedValue([threadMilestoneRow()]);

    renderPanel(true);
    fireEvent.click(await screen.findByRole("button", { name: "usun milestone-1" }));

    expect(threadApiMock.removeClubThreadMilestone).not.toHaveBeenCalled();
  });

  it("potwierdzone usunięcie woła RPC identyfikatorem i potwierdza komunikatem", async () => {
    threadApiMock.fetchClubThreadMilestones.mockResolvedValue([threadMilestoneRow()]);
    threadApiMock.removeClubThreadMilestone.mockResolvedValue(undefined);

    renderPanel(true);
    fireEvent.click(await screen.findByRole("button", { name: "usun milestone-1" }));

    await waitFor(() => expect(threadApiMock.removeClubThreadMilestone).toHaveBeenCalled());
    expect(ladunek(threadApiMock.removeClubThreadMilestone)).toBe("milestone-1");
    expect(h.toasts).toEqual([{ level: "success", key: "club.workspace.schedule.removed" }]);
  });

  it("odmowa usunięcia wraca jako KOD błędu", async () => {
    threadApiMock.fetchClubThreadMilestones.mockResolvedValue([threadMilestoneRow()]);
    threadApiMock.removeClubThreadMilestone.mockRejectedValue(new Error("club_thread_forbidden"));

    renderPanel(true);
    fireEvent.click(await screen.findByRole("button", { name: "usun milestone-1" }));

    await waitFor(() => expect(h.toasts).toHaveLength(1));
    expect(h.toasts[0].level).toBe("error");
    expect(h.toasts[0].key).toMatch(/^club\.workspace\.error\./);
  });

  it("otwarty formularz zabiera zaproszenie z pustki", async () => {
    threadApiMock.fetchClubThreadMilestones.mockResolvedValue([]);

    renderPanel(true);
    fireEvent.click(
      await screen.findByRole("button", { name: "club.workspace.schedule.addFirst" }),
    );

    expect(screen.getByTestId("ms-form")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "club.workspace.schedule.addFirst" })).toBeNull();
  });
});
