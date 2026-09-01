// Kalendarz klubu (`ClubCalendar`) i harmonogram prac (`ClubSchedule`) - dwie
// powierzchnie robocze, które czytają CZAS.
//
// CO TEN PLIK DOWODZI.
//
//   1. ZAKRES ZAPYTANIA JEST ZAKRESEM SIATKI, nie miesiąca kalendarzowego.
//      Siatka rysuje sześć pełnych tygodni od poniedziałku, więc zapytanie musi
//      objąć także dni z miesiąca poprzedniego i następnego - inaczej komórka
//      widoczna na ekranie byłaby pusta z powodu granicy zapytania, a nie
//      z powodu braku terminu. Przewinięcie miesiąca to NOWE zapytanie.
//   2. TYDZIEŃ ZACZYNA SIĘ W PONIEDZIAŁEK, a nazwy dni idą z `Intl` - test
//      porównuje je z `Intl`, nie z wpisanym napisem, więc nie ma tu drugiego
//      słownika do utrzymania.
//   3. AGENDA DOMYŚLNA PATRZY W PRZÓD. Termin, który się skończył, nie jest
//      „tym, co mnie czeka”; ten sam termin MUSI być widoczny po kliknięciu
//      jego dnia w siatce. Kubełek dnia i horyzont „od dziś” to dwie różne
//      odpowiedzi na dwa różne pytania.
//   4. PIĘĆ POSTACI TERMINU: przeszły, trwający, przyszły, całodniowy (bez
//      godziny) i punktowy (bez `ends_at`). Wpis bez końca NIE jest wiecznym
//      „teraz” - to jedyna reguła, która odróżnia znacznik od transmisji.
//   5. LIMIT MIEJSC BLOKUJE WEJŚCIE, NIGDY ZEJŚCIE. Pełne wydarzenie wyłącza
//      „będę”, ale osobie już zapisanej nie wolno odebrać możliwości zmiany.
//   6. PASEK KURATORSKI ISTNIEJE TYLKO DLA KURATORA, a usunięcie przechodzi
//      przez potwierdzenie; odmowa bazy wraca toastem błędu, nie ciszą.
//   7. WIERSZ Z NIEPOPRAWNĄ DATĄ nie wywraca siatki - wypada z niej.
//   8. SPÓŹNIENIE JEST WYLICZANE: `done` i `cancelled` z minionym terminem nie
//      są spóźnione, a pasek postępu pojawia się tylko tam, gdzie postęp niesie
//      informację ponad odznakę stanu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - REGUŁ z `workspaceTypes` (`isEventLive`, `isEventFull`, `isMilestoneOverdue`,
//   `toEventKind`, `toRsvpState`): mają własne tabele przypadków. Tutaj
//   dowodzimy, że organizm je WOŁA i respektuje wynik.
// - MOLEKUŁY `ClubEventForm`: jej walidacja i kształt patcha mają zakres
//   w `clubWorkspaceForms.test.tsx` / `clubEventForm.test.tsx`. Tu jest atrapą
//   wystawiającą swoje callbacki - dowodzimy WPIĘCIA, nie formularza.
// - ATOMÓW `ClubEventDot`, `ClubEventKindChip`, `ClubMilestoneMarker`,
//   `ClubMilestoneStateChip` (zakres: `clubWorkspaceAtoms.test.tsx`) i skeletonów.
// - WARSTWY DANYCH: kluczy cache'u i zakresu unieważnień (`useClubWorkspace`).
// - TRAS: to, że zakładka podaje `clubId`/`canManage`, ma zakres
//   w `clubWorkspaceRoutes.test.tsx`.
//
// CZAS STOI. Oba organizmy wołają `new Date()` i `Date.now()` bez argumentu
// (kotwica miesiąca, „dziś” w siatce, granica agendy, spóźnienie etapu), więc
// bez zamrożonego zegara wynik zależałby od godziny uruchomienia testu.
// Zamrażamy WYŁĄCZNIE `Date` - `setTimeout` zostaje prawdziwy, bo `waitFor`
// react-query go używa.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { workspaceApiMock, resetWorkspaceApiMock } from "@/test/clubs/workspaceApiMock";
import { CLUB_BASE_ISO, CLUB_IDS, clubIsoOffset } from "@/test/clubs/fixtures";
import { CLUB_BASE_DAY, clubEventRow, clubMilestoneRow } from "@/test/clubs/hubFixtures";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import type { ClubEventUpsertInput } from "@/lib/clubs/workspaceTypes";
import { ClubCalendar } from "@/components/clubs/organisms/ClubCalendar";
import { ClubSchedule } from "@/components/clubs/organisms/ClubSchedule";

const h = vi.hoisted(() => ({
  toasts: [] as { level: "success" | "error"; key: string }[],
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
vi.mock("@/lib/clubs/workspaceApi", () => workspaceApiMock);

// Radix AlertDialog nie działa pod happy-dom bez pełnego pointer API - atrapa
// odsłania to samo, co niesie kontrakt: widoczność, akcję i zgłoszenie zmiany
// stanu otwarcia w OBU kierunkach.
vi.mock("@/components/ui/alert-dialog", async () => {
  const React = await import("react");
  const Ctx = React.createContext<{ open: boolean; set: (next: boolean) => void }>({
    open: false,
    set: () => undefined,
  });
  return {
    AlertDialog: ({
      open,
      onOpenChange,
      children,
    }: {
      open?: boolean;
      onOpenChange?: (next: boolean) => void;
      children?: ReactNode;
    }) => (
      <Ctx.Provider value={{ open: open === true, set: (next) => onOpenChange?.(next) }}>
        <div data-testid="potwierdzenie">
          {children}
          <button
            type="button"
            data-testid="potwierdzenie-zglos-otwarcie"
            onClick={() => onOpenChange?.(true)}
          >
            zglos otwarcie
          </button>
        </div>
      </Ctx.Provider>
    ),
    AlertDialogContent: ({ children }: { children?: ReactNode }) => {
      const ctx = React.useContext(Ctx);
      return ctx.open ? <div data-testid="potwierdzenie-tresc">{children}</div> : null;
    },
    AlertDialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    AlertDialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    AlertDialogTitle: ({ children }: { children?: ReactNode }) => <h3>{children}</h3>,
    AlertDialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
    AlertDialogCancel: ({ children }: { children?: ReactNode }) => {
      const ctx = React.useContext(Ctx);
      return (
        <button type="button" data-testid="potwierdzenie-anuluj" onClick={() => ctx.set(false)}>
          {children}
        </button>
      );
    },
    AlertDialogAction: ({
      children,
      disabled,
      onClick,
    }: {
      children?: ReactNode;
      disabled?: boolean;
      onClick?: () => void;
    }) => (
      <button type="button" data-testid="potwierdzenie-tak" disabled={disabled} onClick={onClick}>
        {children}
      </button>
    ),
  };
});

// Formularz wydarzenia: Radix Dialog + Select. Atrapa wystawia dokładnie te
// callbacki, które organizm wpina - i nic więcej.
vi.mock("@/components/clubs/molecules/ClubEventForm", () => ({
  ClubEventForm: ({
    open,
    initial,
    pending,
    onOpenChange,
    onSubmit,
  }: {
    open: boolean;
    initial: { id: string } | null;
    pending: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (input: ClubEventUpsertInput) => void;
  }) => (
    <div
      data-testid="formularz-wydarzenia"
      data-open={String(open)}
      data-initial={initial?.id ?? "nowe"}
      data-pending={String(pending)}
    >
      <button
        type="button"
        data-testid="formularz-zapisz"
        onClick={() => onSubmit({ title_pl: "Nowy termin", starts_at: CLUB_BASE_ISO })}
      >
        zapisz
      </button>
      <button type="button" data-testid="formularz-zamknij" onClick={() => onOpenChange(false)}>
        zamknij
      </button>
    </div>
  ),
}));

const SLUG = "klub-energetyczny";
const DZIEN_MS = 86_400_000;

function nieskonczoneZapytanie(): Promise<never> {
  return new Promise<never>(() => undefined);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(CLUB_BASE_ISO));
  h.toasts.length = 0;
  resetWorkspaceApiMock();
  workspaceApiMock.fetchClubEvents.mockResolvedValue([]);
  workspaceApiMock.fetchClubMilestones.mockResolvedValue([]);
  workspaceApiMock.setClubEventRsvp.mockResolvedValue(true);
  workspaceApiMock.upsertClubEvent.mockResolvedValue("event-1");
  workspaceApiMock.deleteClubEvent.mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Kalendarz
// ---------------------------------------------------------------------------

describe("ClubCalendar - stany zapytania", () => {
  it("zapytanie w locie pokazuje skeleton kalendarza, a nie pustą agendę", () => {
    workspaceApiMock.fetchClubEvents.mockReturnValue(nieskonczoneZapytanie());
    const { container } = renderWithQueryClient(
      <ClubCalendar clubId={CLUB_IDS.club} clubSlug={SLUG} />,
    );

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText("club.calendar.empty")).toBeNull();
  });

  it("awaria odczytu pokazuje komunikat błędu, a ponowienie strzela zapytaniem jeszcze raz", async () => {
    workspaceApiMock.fetchClubEvents.mockRejectedValue(new Error("rpc padlo"));
    renderWithQueryClient(<ClubCalendar clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    await waitFor(() => expect(screen.getByText("club.error.title")).toBeInTheDocument());
    const przed = workspaceApiMock.fetchClubEvents.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "club.error.retry" }));
    await waitFor(() =>
      expect(workspaceApiMock.fetchClubEvents.mock.calls.length).toBeGreaterThan(przed),
    );
  });

  it("puste dane pokazują zachętę „nadchodzące puste”, a nie gołe undefined", async () => {
    renderWithQueryClient(<ClubCalendar clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    await waitFor(() => expect(screen.getByText("club.calendar.empty")).toBeInTheDocument());
    expect(screen.queryAllByTestId("club-event-card")).toHaveLength(0);
  });
});

describe("ClubCalendar - siatka miesiąca", () => {
  it("pyta o CAŁY widoczny zakres siatki: od poniedziałku pierwszego tygodnia do końca szóstego", async () => {
    renderWithQueryClient(<ClubCalendar clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    await waitFor(() => expect(workspaceApiMock.fetchClubEvents).toHaveBeenCalled());
    // Sierpień 2026 zaczyna się w sobotę, więc siatka otwiera się 27 lipca,
    // a szósty tydzień domyka się 6 września.
    expect(workspaceApiMock.fetchClubEvents).toHaveBeenCalledWith({
      clubId: CLUB_IDS.club,
      from: "2026-07-27T00:00:00.000Z",
      to: "2026-09-06T23:59:59.000Z",
      kind: null,
      limit: 200,
    });
  });

  it("nazwy dni idą od PONIEDZIAŁKU i pochodzą z Intl, a nie z tablicy napisów", async () => {
    renderWithQueryClient(<ClubCalendar clubId={CLUB_IDS.club} clubSlug={SLUG} />);
    await waitFor(() => expect(screen.getByText("club.calendar.empty")).toBeInTheDocument());

    const poniedzialek = new Date(2026, 7, 17);
    const oczekiwane = Array.from({ length: 7 }, (_, i) =>
      new Date(poniedzialek.getTime() + i * DZIEN_MS).toLocaleDateString("pl-PL", {
        weekday: "short",
      }),
    );
    for (const etykieta of oczekiwane) {
      expect(screen.getByText(etykieta)).toBeInTheDocument();
    }
  });

  it("komórka dnia niesie liczbę terminów w nazwie dostępnej - także zero", async () => {
    workspaceApiMock.fetchClubEvents.mockResolvedValue([
      clubEventRow({ id: "e-dzis", starts_at: CLUB_BASE_ISO }),
    ]);
    renderWithQueryClient(<ClubCalendar clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "18 sierpnia - club.calendar.dayEvents(count=1)" }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "19 sierpnia - club.calendar.dayEvents(count=0)" }),
    ).toBeInTheDocument();
  });

  it("komórka pokazuje najwyżej trzy kropki i licznik reszty", async () => {
    workspaceApiMock.fetchClubEvents.mockResolvedValue([
      clubEventRow({ id: "e1", title_pl: "Pierwszy", starts_at: CLUB_BASE_ISO }),
      clubEventRow({ id: "e2", title_pl: "Drugi", starts_at: CLUB_BASE_ISO }),
      clubEventRow({ id: "e3", title_pl: "Trzeci", starts_at: CLUB_BASE_ISO }),
      clubEventRow({ id: "e4", title_pl: "Czwarty", starts_at: CLUB_BASE_ISO }),
    ]);
    renderWithQueryClient(<ClubCalendar clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    await waitFor(() => expect(screen.getByLabelText("Pierwszy")).toBeInTheDocument());
    expect(screen.getByLabelText("Trzeci")).toBeInTheDocument();
    expect(screen.queryByLabelText("Czwarty")).toBeNull();
    expect(screen.getByText("+1")).toBeInTheDocument();
  });

  it("wiersz z niepoprawną datą wypada z siatki, a nie wywraca ekranu", async () => {
    workspaceApiMock.fetchClubEvents.mockResolvedValue([
      clubEventRow({ id: "e-zla", title_pl: "Wpis bez daty", starts_at: "nie-data" }),
    ]);
    renderWithQueryClient(<ClubCalendar clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    await waitFor(() => expect(screen.getByText("club.calendar.empty")).toBeInTheDocument());
    expect(screen.queryByLabelText("Wpis bez daty")).toBeNull();
  });

  it("przewinięcie miesiąca to NOWE zapytanie o nowy zakres, a powrót „dziś” wraca do bieżącego", async () => {
    renderWithQueryClient(<ClubCalendar clubId={CLUB_IDS.club} clubSlug={SLUG} />);
    await waitFor(() => expect(screen.getByText("club.calendar.empty")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "club.calendar.prevMonth" }));
    await waitFor(() =>
      expect(workspaceApiMock.fetchClubEvents).toHaveBeenCalledWith(
        expect.objectContaining({ from: "2026-06-29T00:00:00.000Z" }),
      ),
    );
    expect(await screen.findByText("lipiec 2026")).toBeInTheDocument();

    // Powrót na sierpień idzie z cache'u, więc dopiero wrzesień jest kolejnym
    // zapytaniem - i to jest właśnie teza o zakresie w kluczu.
    fireEvent.click(await screen.findByRole("button", { name: "club.calendar.nextMonth" }));
    fireEvent.click(await screen.findByRole("button", { name: "club.calendar.nextMonth" }));
    await waitFor(() =>
      expect(workspaceApiMock.fetchClubEvents).toHaveBeenCalledWith(
        expect.objectContaining({ from: "2026-08-31T00:00:00.000Z" }),
      ),
    );

    fireEvent.click(await screen.findByRole("button", { name: "club.calendar.today" }));
    expect(await screen.findByText("sierpień 2026")).toBeInTheDocument();
  });
});

describe("ClubCalendar - agenda i postacie terminu", () => {
  const przeszly = clubEventRow({
    id: "e-przeszly",
    title_pl: "Termin miniony",
    starts_at: clubIsoOffset(-3 * 1440),
    ends_at: clubIsoOffset(-3 * 1440 + 60),
  });
  const trwajacy = clubEventRow({
    id: "e-trwajacy",
    title_pl: "Termin trwający",
    starts_at: clubIsoOffset(-30),
    ends_at: clubIsoOffset(30),
  });
  const przyszly = clubEventRow({
    id: "e-przyszly",
    title_pl: "Termin przyszły",
    starts_at: clubIsoOffset(2 * 1440),
    ends_at: clubIsoOffset(2 * 1440 + 90),
  });

  it("domyślna agenda patrzy w przód: termin zakończony wypada, trwający i przyszły zostają", async () => {
    workspaceApiMock.fetchClubEvents.mockResolvedValue([przeszly, trwajacy, przyszly]);
    renderWithQueryClient(<ClubCalendar clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    await waitFor(() => expect(screen.getAllByTestId("club-event-card")).toHaveLength(2));
    expect(screen.getByRole("heading", { name: "Termin trwający" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Termin przyszły" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Termin miniony" })).toBeNull();
    expect(screen.getByText("club.calendar.upcoming")).toBeInTheDocument();
  });

  it("kliknięcie dnia z minionym terminem pokazuje go w kubełku dnia, a ponowne kliknięcie wraca do horyzontu", async () => {
    workspaceApiMock.fetchClubEvents.mockResolvedValue([przeszly, przyszly]);
    renderWithQueryClient(<ClubCalendar clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    const komorka = await waitFor(() =>
      screen.getByRole("button", { name: "15 sierpnia - club.calendar.dayEvents(count=1)" }),
    );
    fireEvent.click(komorka);

    expect(screen.getByRole("heading", { name: "Termin miniony" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Termin przyszły" })).toBeNull();
    expect(screen.getByRole("heading", { name: "15 sierpnia" })).toBeInTheDocument();
    expect(komorka).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(komorka);
    expect(screen.getByRole("heading", { name: "Termin przyszły" })).toBeInTheDocument();
  });

  it("przycisk „pokaż nadchodzące” zdejmuje wybór dnia", async () => {
    workspaceApiMock.fetchClubEvents.mockResolvedValue([przeszly, przyszly]);
    renderWithQueryClient(<ClubCalendar clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    const komorka = await waitFor(() =>
      screen.getByRole("button", { name: "15 sierpnia - club.calendar.dayEvents(count=1)" }),
    );
    fireEvent.click(komorka);
    fireEvent.click(screen.getByRole("button", { name: "club.calendar.showUpcoming" }));

    expect(screen.getByText("club.calendar.upcoming")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Termin przyszły" })).toBeInTheDocument();
  });

  it("wybrany dzień bez terminów mówi „pusty dzień”, a nie „pusty klub”", async () => {
    workspaceApiMock.fetchClubEvents.mockResolvedValue([przyszly]);
    renderWithQueryClient(<ClubCalendar clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    const komorka = await waitFor(() =>
      screen.getByRole("button", { name: "19 sierpnia - club.calendar.dayEvents(count=0)" }),
    );
    fireEvent.click(komorka);

    expect(screen.getByText("club.calendar.emptyDay")).toBeInTheDocument();
    expect(screen.queryByText("club.calendar.empty")).toBeNull();
  });

  it("termin trwający dostaje znacznik „na żywo”, a termin bez godziny zakończenia go NIE dostaje", async () => {
    workspaceApiMock.fetchClubEvents.mockResolvedValue([
      trwajacy,
      clubEventRow({
        id: "e-punkt",
        title_pl: "Termin punktowy",
        starts_at: clubIsoOffset(-10),
        ends_at: null,
      }),
    ]);
    renderWithQueryClient(<ClubCalendar clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    // Oba terminy już się zaczęły, więc w horyzoncie „od dziś” nie ma ich obu -
    // kubełek dnia jest tu jedynym miejscem, w którym stoją obok siebie.
    fireEvent.click(
      await screen.findByRole("button", {
        name: "18 sierpnia - club.calendar.dayEvents(count=2)",
      }),
    );
    expect(screen.getAllByTestId("club-event-card")).toHaveLength(2);
    expect(screen.getAllByText("club.calendar.live")).toHaveLength(1);
  });

  it("termin całodniowy pokazuje samą datę z dopiskiem, a termin z godziną pełny znacznik czasu", async () => {
    workspaceApiMock.fetchClubEvents.mockResolvedValue([
      clubEventRow({
        id: "e-caly",
        title_pl: "Dzień konsultacji",
        all_day: true,
        starts_at: clubIsoOffset(1440),
        ends_at: null,
      }),
      clubEventRow({
        id: "e-godzina",
        title_pl: "Posiedzenie o dziesiątej UTC",
        all_day: false,
        starts_at: clubIsoOffset(1440),
        ends_at: null,
      }),
    ]);
    const { container } = renderWithQueryClient(
      <ClubCalendar clubId={CLUB_IDS.club} clubSlug={SLUG} />,
    );

    await waitFor(() => expect(screen.getAllByTestId("club-event-card")).toHaveLength(2));
    const tekst = container.textContent ?? "";
    // TERMIN CAŁODNIOWY nie przesuwa się o strefę: `formatDateOnly` zamyka
    // `DATE_ONLY_TIME_ZONE = "UTC"`, bo wartość dnia z bazy nie ma godziny
    // i doklejanie jej przesuwałoby datę przy północy.
    expect(tekst).toContain("19 sierpnia 2026");
    expect(tekst).toContain("club.calendar.allDay");
    // 10:00 -> 12:00 (2026-09-01): `formatDate` ZAMYKA odtąd strefę serwisu
    // (`SITE_TIME_ZONE = "Europe/Warsaw"`), a wcześniej brał strefę PROCESU -
    // czyli ta asercja mierzyła `TZ` maszyny testowej, nie zachowanie produktu.
    // `CLUB_BASE_ISO + 1440 min` to `2026-08-19T10:00:00Z`, a w sierpniu Warszawa
    // jest na CEST (UTC+2), więc czytelnik widzi POŁUDNIE - i to jest cała treść
    // naprawy D7: ten sam znacznik pokazuje tę samą godzinę niezależnie od tego,
    // gdzie stoi izolat, który wyrenderował dokument. Tytuł wiersza nazywa więc
    // instant (10:00 UTC), żeby nie kłamał o tym, co pokazuje karta.
    expect(tekst).toContain("19.08.2026, 12:00");
  });

  it("dane CZĘŚCIOWE: brak opisu, miejsca, adresu spotkania i wątku nie rysuje pustych rubryk", async () => {
    workspaceApiMock.fetchClubEvents.mockResolvedValue([
      clubEventRow({
        id: "e-chude",
        title_pl: "Termin bez szczegółów",
        starts_at: clubIsoOffset(1440),
        description_pl: null,
        description_en: null,
        location: "   ",
        meeting_url: "   ",
        thread_slug: null,
        rsvp_enabled: false,
      }),
    ]);
    renderWithQueryClient(<ClubCalendar clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    await waitFor(() => expect(screen.getAllByTestId("club-event-card")).toHaveLength(1));
    expect(screen.queryByText("club.calendar.join")).toBeNull();
    expect(screen.queryByText("club.calendar.linkedThread")).toBeNull();
    expect(screen.queryByRole("group", { name: "club.calendar.rsvpLabel" })).toBeNull();
  });

  it("dane PEŁNE: opis, miejsce, licznik z limitem, adres pokoju i link do wątku", async () => {
    workspaceApiMock.fetchClubEvents.mockResolvedValue([
      clubEventRow({
        id: "e-pelny",
        title_pl: "Posiedzenie plenarne",
        starts_at: clubIsoOffset(1440),
        description_pl: "Porządek obrad w załączniku.",
        location: "Bruksela, sala 3B",
        meeting_url: "https://spotkania.example/pokoj",
        capacity: 12,
        going_count: 5,
        thread_slug: "temat-pierwszy",
      }),
    ]);
    renderWithQueryClient(<ClubCalendar clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    await waitFor(() => expect(screen.getAllByTestId("club-event-card")).toHaveLength(1));
    expect(screen.getByText("Porządek obrad w załączniku.")).toBeInTheDocument();
    expect(screen.getByText("Bruksela, sala 3B")).toBeInTheDocument();
    expect(
      screen.getByText("club.calendar.goingOfCapacity(capacity=12,count=5)"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /club.calendar.join/ })).toHaveAttribute(
      "href",
      "https://spotkania.example/pokoj",
    );
    expect(screen.getByRole("link", { name: /club.calendar.linkedThread/ })).toHaveAttribute(
      "href",
      "/club/klub-energetyczny/t/temat-pierwszy",
    );
  });

  it("wydarzenie bez limitu miejsc pokazuje sam licznik obecnych", async () => {
    workspaceApiMock.fetchClubEvents.mockResolvedValue([
      clubEventRow({ id: "e-bez-limitu", starts_at: clubIsoOffset(1440), capacity: null }),
    ]);
    renderWithQueryClient(<ClubCalendar clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    await waitFor(() =>
      expect(screen.getByText("club.calendar.goingCount(count=2)")).toBeInTheDocument(),
    );
  });

  it("odwołany termin niesie odznakę stanu i traci pasek obecności", async () => {
    workspaceApiMock.fetchClubEvents.mockResolvedValue([
      clubEventRow({
        id: "e-odwolany",
        starts_at: clubIsoOffset(1440),
        status: "cancelled",
        rsvp_enabled: true,
      }),
    ]);
    renderWithQueryClient(<ClubCalendar clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    await waitFor(() =>
      expect(screen.getByText("club.calendar.status.cancelled")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("group", { name: "club.calendar.rsvpLabel" })).toBeNull();
  });
});

describe("ClubCalendar - obecność", () => {
  it("klik w stan obecności wysyła dokładnie ten stan dla tego wydarzenia", async () => {
    workspaceApiMock.fetchClubEvents.mockResolvedValue([
      clubEventRow({ id: "e-rsvp", starts_at: clubIsoOffset(1440), my_rsvp: "maybe" }),
    ]);
    renderWithQueryClient(<ClubCalendar clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    const maybe = await waitFor(() =>
      screen.getByRole("button", { name: "club.calendar.rsvp.maybe" }),
    );
    expect(maybe).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "club.calendar.rsvp.going" }));
    await waitFor(() =>
      expect(workspaceApiMock.setClubEventRsvp).toHaveBeenCalledWith("e-rsvp", "going"),
    );
    expect(workspaceApiMock.setClubEventRsvp).toHaveBeenCalledTimes(1);
  });

  it("mutacja w locie wyłącza wszystkie trzy przyciski obecności", async () => {
    workspaceApiMock.setClubEventRsvp.mockReturnValue(nieskonczoneZapytanie());
    workspaceApiMock.fetchClubEvents.mockResolvedValue([
      clubEventRow({ id: "e-rsvp", starts_at: clubIsoOffset(1440) }),
    ]);
    renderWithQueryClient(<ClubCalendar clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    const declined = await waitFor(() =>
      screen.getByRole("button", { name: "club.calendar.rsvp.declined" }),
    );
    fireEvent.click(declined);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "club.calendar.rsvp.going" })).toBeDisabled(),
    );
  });

  it("pełna lista obecnych blokuje WEJŚCIE na nią i mówi o tym wprost", async () => {
    workspaceApiMock.fetchClubEvents.mockResolvedValue([
      clubEventRow({
        id: "e-pelne",
        starts_at: clubIsoOffset(1440),
        capacity: 4,
        going_count: 4,
        my_rsvp: null,
      }),
    ]);
    renderWithQueryClient(<ClubCalendar clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    await waitFor(() => expect(screen.getByText("club.calendar.full")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "club.calendar.rsvp.going" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "club.calendar.rsvp.maybe" })).toBeEnabled();
  });

  it("pełna lista NIE blokuje zejścia z niej osobie już zapisanej", async () => {
    workspaceApiMock.fetchClubEvents.mockResolvedValue([
      clubEventRow({
        id: "e-pelne-moje",
        starts_at: clubIsoOffset(1440),
        capacity: 4,
        going_count: 4,
        my_rsvp: "going",
      }),
    ]);
    renderWithQueryClient(<ClubCalendar clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    const going = await waitFor(() =>
      screen.getByRole("button", { name: "club.calendar.rsvp.going" }),
    );
    expect(going).toBeEnabled();
    expect(screen.queryByText("club.calendar.full")).toBeNull();
    expect(screen.getByRole("button", { name: "club.calendar.rsvp.declined" })).toBeEnabled();
  });
});

describe("ClubCalendar - pasek kuratorski", () => {
  const termin = clubEventRow({
    id: "e-kurator",
    title_pl: "Posiedzenie wrześniowe",
    starts_at: clubIsoOffset(1440),
  });

  it("czytelnik nie widzi ani przycisku tworzenia, ani paska redakcji", async () => {
    workspaceApiMock.fetchClubEvents.mockResolvedValue([termin]);
    renderWithQueryClient(<ClubCalendar clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    await waitFor(() => expect(screen.getAllByTestId("club-event-card")).toHaveLength(1));
    expect(screen.queryByText("club.eventForm.createTitle")).toBeNull();
    expect(screen.queryByText("club.eventForm.edit")).toBeNull();
    expect(screen.queryByText("club.eventForm.delete")).toBeNull();
    expect(screen.queryByTestId("formularz-wydarzenia")).toBeNull();
  });

  it("kurator tworzy termin: formularz otwiera się bez wiersza wyjściowego, a zapis woła RPC i potwierdza toastem", async () => {
    workspaceApiMock.fetchClubEvents.mockResolvedValue([termin]);
    renderWithQueryClient(<ClubCalendar clubId={CLUB_IDS.club} clubSlug={SLUG} canManage />);

    fireEvent.click(
      await waitFor(() => screen.getByRole("button", { name: /club.eventForm.createTitle/ })),
    );
    expect(screen.getByTestId("formularz-wydarzenia")).toHaveAttribute("data-initial", "nowe");

    fireEvent.click(screen.getByTestId("formularz-zapisz"));
    await waitFor(() =>
      expect(workspaceApiMock.upsertClubEvent).toHaveBeenCalledWith(CLUB_IDS.club, {
        title_pl: "Nowy termin",
        starts_at: CLUB_BASE_ISO,
      }),
    );
    await waitFor(() => expect(screen.queryByTestId("formularz-wydarzenia")).toBeNull());
    expect(h.toasts).toEqual([{ level: "success", key: "club.eventForm.saved" }]);
  });

  it("odmowa zapisu zostawia formularz otwarty i wraca toastem błędu", async () => {
    workspaceApiMock.fetchClubEvents.mockResolvedValue([termin]);
    workspaceApiMock.upsertClubEvent.mockRejectedValue(new Error("club_forbidden"));
    renderWithQueryClient(<ClubCalendar clubId={CLUB_IDS.club} clubSlug={SLUG} canManage />);

    fireEvent.click(
      await waitFor(() => screen.getByRole("button", { name: /club.eventForm.createTitle/ })),
    );
    fireEvent.click(screen.getByTestId("formularz-zapisz"));

    await waitFor(() =>
      expect(h.toasts).toEqual([{ level: "error", key: "club.eventForm.failed" }]),
    );
    expect(screen.getByTestId("formularz-wydarzenia")).toBeInTheDocument();
  });

  it("redakcja podaje formularzowi WYBRANY wiersz, a zamknięcie chowa formularz", async () => {
    workspaceApiMock.fetchClubEvents.mockResolvedValue([termin]);
    renderWithQueryClient(<ClubCalendar clubId={CLUB_IDS.club} clubSlug={SLUG} canManage />);

    fireEvent.click(
      await waitFor(() => screen.getByRole("button", { name: /club.eventForm.edit/ })),
    );
    expect(screen.getByTestId("formularz-wydarzenia")).toHaveAttribute("data-initial", "e-kurator");

    fireEvent.click(screen.getByTestId("formularz-zamknij"));
    expect(screen.queryByTestId("formularz-wydarzenia")).toBeNull();
  });

  it("usunięcie przechodzi przez potwierdzenie z tytułem terminu, a potwierdzenie woła RPC", async () => {
    workspaceApiMock.fetchClubEvents.mockResolvedValue([termin]);
    renderWithQueryClient(<ClubCalendar clubId={CLUB_IDS.club} clubSlug={SLUG} canManage />);

    fireEvent.click(
      await waitFor(() => screen.getByRole("button", { name: /club.eventForm.delete/ })),
    );
    expect(
      screen.getByText("club.eventForm.deleteLead(title=Posiedzenie wrześniowe)"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("potwierdzenie-tak"));
    await waitFor(() => expect(workspaceApiMock.deleteClubEvent).toHaveBeenCalled());
    expect(workspaceApiMock.deleteClubEvent.mock.calls[0]?.[0]).toBe("e-kurator");
    await waitFor(() => expect(screen.queryByTestId("potwierdzenie")).toBeNull());
    expect(h.toasts).toEqual([{ level: "success", key: "club.eventForm.deleted" }]);
  });

  it("odmowa usunięcia zostawia potwierdzenie i wraca toastem błędu", async () => {
    workspaceApiMock.fetchClubEvents.mockResolvedValue([termin]);
    workspaceApiMock.deleteClubEvent.mockRejectedValue(new Error("club_forbidden"));
    renderWithQueryClient(<ClubCalendar clubId={CLUB_IDS.club} clubSlug={SLUG} canManage />);

    fireEvent.click(
      await waitFor(() => screen.getByRole("button", { name: /club.eventForm.delete/ })),
    );
    fireEvent.click(screen.getByTestId("potwierdzenie-tak"));

    await waitFor(() =>
      expect(h.toasts).toEqual([{ level: "error", key: "club.eventForm.failed" }]),
    );
    expect(screen.getByTestId("potwierdzenie-tresc")).toBeInTheDocument();
  });

  it("zamknięcie potwierdzenia porzuca zamiar, a zgłoszenie otwarcia go nie rusza", async () => {
    workspaceApiMock.fetchClubEvents.mockResolvedValue([termin]);
    renderWithQueryClient(<ClubCalendar clubId={CLUB_IDS.club} clubSlug={SLUG} canManage />);

    fireEvent.click(
      await waitFor(() => screen.getByRole("button", { name: /club.eventForm.delete/ })),
    );
    fireEvent.click(screen.getByTestId("potwierdzenie-zglos-otwarcie"));
    expect(screen.getByTestId("potwierdzenie-tresc")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("potwierdzenie-anuluj"));
    expect(screen.queryByTestId("potwierdzenie")).toBeNull();
    expect(workspaceApiMock.deleteClubEvent).not.toHaveBeenCalled();
  });

  it("usuwanie w locie wyłącza przycisk potwierdzenia", async () => {
    workspaceApiMock.fetchClubEvents.mockResolvedValue([termin]);
    workspaceApiMock.deleteClubEvent.mockReturnValue(nieskonczoneZapytanie());
    renderWithQueryClient(<ClubCalendar clubId={CLUB_IDS.club} clubSlug={SLUG} canManage />);

    fireEvent.click(
      await waitFor(() => screen.getByRole("button", { name: /club.eventForm.delete/ })),
    );
    fireEvent.click(screen.getByTestId("potwierdzenie-tak"));

    await waitFor(() => expect(screen.getByTestId("potwierdzenie-tak")).toBeDisabled());
  });

  it("przewinięcie miesiąca zdejmuje wybór dnia zrobiony wcześniej", async () => {
    workspaceApiMock.fetchClubEvents.mockResolvedValue([
      clubEventRow({ id: "e-dzis", title_pl: "Termin dzisiejszy", starts_at: CLUB_BASE_ISO }),
    ]);
    renderWithQueryClient(<ClubCalendar clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    fireEvent.click(
      await waitFor(() =>
        screen.getByRole("button", { name: "18 sierpnia - club.calendar.dayEvents(count=1)" }),
      ),
    );
    expect(screen.getByRole("heading", { name: "18 sierpnia" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "club.calendar.prevMonth" }));
    await waitFor(() => expect(screen.getByText("club.calendar.upcoming")).toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// Harmonogram
// ---------------------------------------------------------------------------

describe("ClubSchedule - stany zapytania", () => {
  it("zapytanie w locie pokazuje skeleton osi etapów", () => {
    workspaceApiMock.fetchClubMilestones.mockReturnValue(nieskonczoneZapytanie());
    const { container } = renderWithQueryClient(
      <ClubSchedule clubId={CLUB_IDS.club} clubSlug={SLUG} />,
    );

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText("club.schedule.empty")).toBeNull();
  });

  it("awaria odczytu pokazuje komunikat błędu i ponawia zapytanie", async () => {
    workspaceApiMock.fetchClubMilestones.mockRejectedValue(new Error("rpc padlo"));
    renderWithQueryClient(<ClubSchedule clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    await waitFor(() => expect(screen.getByText("club.error.title")).toBeInTheDocument());
    const przed = workspaceApiMock.fetchClubMilestones.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "club.error.retry" }));
    await waitFor(() =>
      expect(workspaceApiMock.fetchClubMilestones.mock.calls.length).toBeGreaterThan(przed),
    );
  });

  it("puste dane pokazują zachętę, a nie oś bez etapów", async () => {
    renderWithQueryClient(<ClubSchedule clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    await waitFor(() => expect(screen.getByText("club.schedule.empty")).toBeInTheDocument());
    expect(screen.queryAllByTestId("club-milestone-item")).toHaveLength(0);
  });
});

describe("ClubSchedule - licznik i spóźnienie", () => {
  it("nagłówek liczy zamknięte etapy do wszystkich i podaje liczbę spóźnionych", async () => {
    workspaceApiMock.fetchClubMilestones.mockResolvedValue([
      clubMilestoneRow({ id: "m-1", slug: "zamkniety", state: "done", due_on: "2026-07-01" }),
      clubMilestoneRow({ id: "m-2", slug: "spozniony", state: "active", due_on: "2026-08-01" }),
      clubMilestoneRow({ id: "m-3", slug: "biezacy", state: "active", due_on: "2026-09-01" }),
    ]);
    renderWithQueryClient(<ClubSchedule clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    await waitFor(() => expect(screen.getAllByTestId("club-milestone-item")).toHaveLength(3));
    expect(screen.getByText("1/3")).toBeInTheDocument();
    expect(screen.getByText("club.schedule.overdueCount(count=1)")).toBeInTheDocument();
    expect(screen.getAllByText("club.schedule.overdue")).toHaveLength(1);
  });

  it("harmonogram bez spóźnień nie rysuje ostrzeżenia", async () => {
    workspaceApiMock.fetchClubMilestones.mockResolvedValue([
      clubMilestoneRow({ id: "m-1", state: "planned", due_on: "2026-12-01", progress: 0 }),
    ]);
    renderWithQueryClient(<ClubSchedule clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    await waitFor(() => expect(screen.getByText("0/1")).toBeInTheDocument());
    expect(screen.queryByText(/club.schedule.overdueCount/)).toBeNull();
    expect(screen.queryByText("club.schedule.overdue")).toBeNull();
  });

  it("etap zamknięty i etap odwołany z minionym terminem NIE są spóźnione", async () => {
    workspaceApiMock.fetchClubMilestones.mockResolvedValue([
      clubMilestoneRow({ id: "m-done", state: "done", due_on: "2026-01-01" }),
      clubMilestoneRow({ id: "m-cancelled", state: "cancelled", due_on: "2026-01-01" }),
    ]);
    renderWithQueryClient(<ClubSchedule clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    await waitFor(() => expect(screen.getAllByTestId("club-milestone-item")).toHaveLength(2));
    expect(screen.queryByText("club.schedule.overdue")).toBeNull();
  });

  it("etap bez terminu nie może być spóźniony", async () => {
    workspaceApiMock.fetchClubMilestones.mockResolvedValue([
      clubMilestoneRow({ id: "m-bez-terminu", state: "blocked", due_on: null, starts_on: null }),
    ]);
    renderWithQueryClient(<ClubSchedule clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    await waitFor(() => expect(screen.getAllByTestId("club-milestone-item")).toHaveLength(1));
    expect(screen.queryByText("club.schedule.overdue")).toBeNull();
  });
});

describe("ClubSchedule - zakres dat etapu", () => {
  it("oba końce dają zakres „od - do”", async () => {
    workspaceApiMock.fetchClubMilestones.mockResolvedValue([
      clubMilestoneRow({ id: "m-zakres", starts_on: "2026-08-01", due_on: "2026-08-31" }),
    ]);
    renderWithQueryClient(<ClubSchedule clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    await waitFor(() => expect(screen.getByText("1 sie 2026 - 31 sie 2026")).toBeInTheDocument());
  });

  it("sam termin bez początku pokazuje termin", async () => {
    workspaceApiMock.fetchClubMilestones.mockResolvedValue([
      clubMilestoneRow({ id: "m-do", starts_on: null, due_on: "2026-08-31" }),
    ]);
    renderWithQueryClient(<ClubSchedule clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    await waitFor(() => expect(screen.getByText("31 sie 2026")).toBeInTheDocument());
  });

  it("sam początek bez terminu pokazuje początek", async () => {
    workspaceApiMock.fetchClubMilestones.mockResolvedValue([
      clubMilestoneRow({ id: "m-od", starts_on: "2026-08-01", due_on: null }),
    ]);
    renderWithQueryClient(<ClubSchedule clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    await waitFor(() => expect(screen.getByText("1 sie 2026")).toBeInTheDocument());
  });

  it("etap bez obu dat nie rysuje pustej rubryki zakresu", async () => {
    workspaceApiMock.fetchClubMilestones.mockResolvedValue([
      clubMilestoneRow({
        id: "m-bez-dat",
        starts_on: null,
        due_on: null,
        description_pl: "   ",
        description_en: "   ",
        thread_slug: null,
      }),
    ]);
    const { container } = renderWithQueryClient(
      <ClubSchedule clubId={CLUB_IDS.club} clubSlug={SLUG} />,
    );

    await waitFor(() => expect(screen.getAllByTestId("club-milestone-item")).toHaveLength(1));
    expect(container.textContent).not.toContain("2026");
    expect(screen.queryByText("club.schedule.linkedThread")).toBeNull();
  });
});

describe("ClubSchedule - postęp i oś", () => {
  it("etap w toku pokazuje pasek postępu z wartością", async () => {
    workspaceApiMock.fetchClubMilestones.mockResolvedValue([
      clubMilestoneRow({ id: "m-active", state: "active", progress: 40 }),
    ]);
    renderWithQueryClient(<ClubSchedule clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    const pasek = await waitFor(() =>
      screen.getByRole("progressbar", { name: "club.schedule.progress" }),
    );
    expect(pasek).toHaveAttribute("aria-valuenow", "40");
    expect(screen.getByText("club.schedule.progressValue(value=40)")).toBeInTheDocument();
  });

  it("etap zaplanowany z zerem i etap zamknięty ze setką nie rysują paska", async () => {
    workspaceApiMock.fetchClubMilestones.mockResolvedValue([
      clubMilestoneRow({ id: "m-zero", state: "planned", progress: 0 }),
      clubMilestoneRow({ id: "m-sto", state: "done", progress: 100 }),
    ]);
    renderWithQueryClient(<ClubSchedule clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    await waitFor(() => expect(screen.getAllByTestId("club-milestone-item")).toHaveLength(2));
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("etap wstrzymany z postępem w środku DOSTAJE pasek, mimo że nie jest „w toku”", async () => {
    workspaceApiMock.fetchClubMilestones.mockResolvedValue([
      clubMilestoneRow({ id: "m-blocked", state: "blocked", progress: 60, due_on: null }),
    ]);
    renderWithQueryClient(<ClubSchedule clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    await waitFor(() =>
      expect(screen.getByRole("progressbar", { name: "club.schedule.progress" })).toHaveAttribute(
        "aria-valuenow",
        "60",
      ),
    );
  });

  it("postęp spoza zakresu jest przycinany do 100% szerokości paska", async () => {
    workspaceApiMock.fetchClubMilestones.mockResolvedValue([
      clubMilestoneRow({ id: "m-przekroczony", state: "active", progress: 180 }),
    ]);
    const { container } = renderWithQueryClient(
      <ClubSchedule clubId={CLUB_IDS.club} clubSlug={SLUG} />,
    );

    await waitFor(() => expect(screen.getByRole("progressbar")).toBeInTheDocument());
    const wypelnienie = container.querySelector('[role="progressbar"] > span');
    expect(wypelnienie).not.toBeNull();
    expect(wypelnienie?.getAttribute("style")).toContain("width: 100%");
  });

  it("dane PEŁNE: opis, odznaka stanu i link do wątku etapu", async () => {
    workspaceApiMock.fetchClubMilestones.mockResolvedValue([
      clubMilestoneRow({
        id: "m-pelny",
        title_pl: "Pierwsze czytanie",
        description_pl: "Sprawozdawca przedstawia projekt.",
        state: "active",
        thread_slug: "temat-pierwszy",
        due_on: CLUB_BASE_DAY,
      }),
    ]);
    renderWithQueryClient(<ClubSchedule clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Pierwsze czytanie" })).toBeInTheDocument(),
    );
    expect(screen.getByText("Sprawozdawca przedstawia projekt.")).toBeInTheDocument();
    expect(screen.getByText("club.schedule.state.active")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /club.schedule.linkedThread/ })).toHaveAttribute(
      "href",
      "/club/klub-energetyczny/t/temat-pierwszy",
    );
  });

  it("oś kończy się na ostatnim etapie: kreska łącząca jest o jedną krótsza niż lista", async () => {
    workspaceApiMock.fetchClubMilestones.mockResolvedValue([
      clubMilestoneRow({ id: "m-1", slug: "a" }),
      clubMilestoneRow({ id: "m-2", slug: "b" }),
      clubMilestoneRow({ id: "m-3", slug: "c" }),
    ]);
    const { container } = renderWithQueryClient(
      <ClubSchedule clubId={CLUB_IDS.club} clubSlug={SLUG} />,
    );

    await waitFor(() => expect(screen.getAllByTestId("club-milestone-item")).toHaveLength(3));
    expect(container.querySelectorAll("li > div > span.w-px")).toHaveLength(2);
  });

  it("„dziś” liczy się z lokalnej doby: etap z terminem na dziś nie jest spóźniony", async () => {
    workspaceApiMock.fetchClubMilestones.mockResolvedValue([
      clubMilestoneRow({ id: "m-dzis", state: "active", due_on: CLUB_BASE_DAY }),
    ]);
    renderWithQueryClient(<ClubSchedule clubId={CLUB_IDS.club} clubSlug={SLUG} />);

    await waitFor(() => expect(screen.getAllByTestId("club-milestone-item")).toHaveLength(1));
    expect(screen.queryByText("club.schedule.overdue")).toBeNull();
  });
});
