// Agenda publiczna, DRUGA warstwa: to, czego `eventAgendaSection.test.tsx` nie
// domyka - niepełne dane redakcyjne, pusty dzień, filtry i odmowy zapisu.
//
// PO CO OSOBNY PLIK. Sąsiad pilnuje szkieletu (dni jako zakładki, ładunek RPC,
// gość bez konta, komplet miejsc). Tutaj stoją przypadki, w których agenda
// przestaje być listą, a zaczyna być odpowiedzią na pytanie „gdzie mam teraz
// być" - i w których po cichu gubi się dzień albo sesja.
//
// SIEDEM RZECZY, KTÓRE MUSZĄ TRZYMAĆ:
// 1. sesja BEZ SALI i BEZ NURTU nadal ma tytuł, godzinę i przycisk zapisu -
//    kartoteka redakcyjna bywa niepełna, a niepełny wiersz nie może kosztować
//    uczestnika miejsca,
// 2. sesja bez godziny zakończenia (RPC oddaje wtedy `ends_at` = `starts_at`)
//    też się rysuje, zamiast wypaść z programu,
// 3. PUSTY DZIEŃ NIE ZNIKA PO CICHU: zakładka dnia zostaje, a uczestnik dostaje
//    zdanie mówiące, KTÓRY filtr opróżnił listę (fraza / „tylko moje" / nurt),
// 4. „Twój harmonogram" celuje w sesję z INNEGO dnia i zdejmuje filtry, które
//    ją ukrywały - inaczej klik kończy się pustą listą,
// 5. długi harmonogram chowa nadmiar za odnośnikiem i potrafi go pokazać,
// 6. odmowa bazy dochodzi do uczestnika ZDANIEM ze słownika, a nie surowym
//    komunikatem plpgsql (ogon `overlap_conflict` niesie TYTUŁ CUDZEJ SESJI),
// 7. rezerwa, rezygnacja i awans z rezerwy mówią KAŻDE SWOJE - jeden komunikat
//    na trzy stany obiecywałby miejsce, którego uczestnik może nie mieć.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { AgendaSession } from "@/lib/events/agendaSurface";
import type { SessionSignupResult } from "@/lib/events/publicEventApi";

const fetchAgenda = vi.fn<(slug: string) => Promise<AgendaSession[]>>();
const submitSignup =
  vi.fn<(input: { sessionId: string; status: string }) => Promise<SessionSignupResult>>();
const successToast = vi.fn<(message: string) => void>();
const errorToast = vi.fn<(message: string) => void>();
const infoToast = vi.fn<(message: string) => void>();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options === undefined ? key : `${key}:${JSON.stringify(options)}`,
    i18n: { language: "pl", exists: () => true, changeLanguage: () => Promise.resolve() },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("sonner", () => ({
  toast: {
    success: (message: string) => successToast(message),
    error: (message: string) => errorToast(message),
    info: (message: string) => infoToast(message),
  },
}));

const authState = { user: null as { id: string } | null };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => authState }));

// Granica bazy: dwa wołania RPC tej powierzchni. Reszta modułu (parsery,
// reguła kontrolki zapisu, grupowanie w dni) jedzie PRAWDZIWA - to ona
// decyduje, co uczestnik zobaczy.
vi.mock("@/lib/events/publicEventApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/events/publicEventApi")>(
    "@/lib/events/publicEventApi",
  );
  return {
    ...actual,
    fetchEventAgenda: (slug: string) => fetchAgenda(slug),
    submitSessionSignup: (input: { sessionId: string; status: string }) => submitSignup(input),
  };
});

const { EventAgendaSection } =
  await import("@/components/events/public/organisms/EventAgendaSection");
const { browserTimeZone } = await import("@/lib/events/timezone");
const i18n = (await import("@/lib/i18n")).default;

function session(over: Partial<AgendaSession>): AgendaSession {
  return {
    id: "s1",
    eventId: "e1",
    parentSessionId: null,
    titlePl: "Sesja otwarcia",
    titleEn: "Opening",
    descriptionPl: null,
    descriptionEn: null,
    startsAt: "2026-09-01T08:00:00Z",
    endsAt: "2026-09-01T09:00:00Z",
    timezone: "Europe/Warsaw",
    format: "onsite",
    status: "published",
    sortOrder: 1,
    chathamHouse: false,
    minTierRank: 0,
    requiresSignup: true,
    capacity: 40,
    registeredCount: 10,
    seatsLeft: 30,
    track: null,
    room: null,
    hasStream: false,
    hasRecording: false,
    mySignupStatus: null,
    accessState: "signup_required",
    speakers: [],
    ...over,
  };
}

function renderAgenda() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <EventAgendaSection slug="kongres" />
    </QueryClientProvider>,
  );
}

/** Karta „Twój harmonogram" w lewej kolumnie - jedyna, która ma ten nagłówek. */
function scheduleCard(): HTMLElement {
  const card = screen.getByText("eventFront.agenda.myScheduleTitle").closest("section");
  if (card === null) throw new Error("brak karty harmonogramu");
  return card;
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.user = { id: "u1" };
  submitSignup.mockResolvedValue({
    status: "registered",
    promoted: false,
    registered: 11,
    seatsLeft: 29,
  });
});

describe("EventAgendaSection - niepełne dane redakcyjne", () => {
  it("sesja bez sali i bez nurtu nadal ma tytuł, godzinę i przycisk zapisu", async () => {
    fetchAgenda.mockResolvedValue([
      session({ id: "a", titlePl: "Panel bez sali", room: null, track: null }),
    ]);
    renderAgenda();

    expect(await screen.findByText("Panel bez sali")).toBeInTheDocument();
    // Program przyjeżdża z RPC `event_agenda` wołanego SLUGIEM wydarzenia -
    // zawężenie najemcem siedzi w SQL (pilnuje go bramka
    // `check:sql-tenant-scope`).
    expect(fetchAgenda).toHaveBeenCalledWith("kongres");
    // Godzina jest tym, po co uczestnik przychodzi na tę stronę - musi zostać
    // nawet wtedy, gdy sali nikt nie wpisał.
    expect(screen.getByText("eventFront.formats.onsite")).toBeInTheDocument();
    expect(screen.getByText("eventFront.agenda.actions.signup")).toBeInTheDocument();
    // Podpis sali nie pojawia się PUSTY: rząd „Sala:" bez nazwy czyta się jak
    // uszkodzone dane, a nie jak brak danych.
    expect(screen.queryByText("eventFront.agenda.roomLabel")).not.toBeInTheDocument();
  });

  it("sala z piętrem prowadzi do drzwi, a sala bez piętra nie dostaje pustego nawiasu", async () => {
    fetchAgenda.mockResolvedValue([
      session({
        id: "a",
        titlePl: "Panel z salą",
        room: { id: "r1", name: "Sala Kolumnowa", floor: "1 piętro" },
      }),
      session({
        id: "b",
        titlePl: "Panel bez piętra",
        startsAt: "2026-09-01T10:00:00Z",
        endsAt: "2026-09-01T11:00:00Z",
        room: { id: "r2", name: "Sala Błękitna", floor: null },
      }),
    ]);
    renderAgenda();

    expect(await screen.findByText("Sala Kolumnowa (1 piętro)")).toBeInTheDocument();
    expect(screen.getByText("Sala Błękitna")).toBeInTheDocument();
  });

  it("sesja bez godziny zakończenia nie wypada z programu", async () => {
    // RPC oddaje wtedy `ends_at` równe `starts_at` (parser domyka brak) - blok
    // ma się narysować, bo inaczej redakcja gubi sesję jednym pustym polem.
    fetchAgenda.mockResolvedValue([
      session({
        id: "a",
        titlePl: "Panel bez końca",
        startsAt: "2026-09-01T08:00:00Z",
        endsAt: "2026-09-01T08:00:00Z",
      }),
    ]);
    renderAgenda();

    expect(await screen.findByText("Panel bez końca")).toBeInTheDocument();
    expect(document.getElementById("event-session-a")).not.toBeNull();
    expect(screen.getByText("eventFront.agenda.actions.signup")).toBeInTheDocument();
  });

  it("obca strefa czasowa dostaje dopisek o przeliczeniu, a własna go nie dostaje", async () => {
    // Uczestnik czytający program spoza strefy wydarzenia przychodzi o złej
    // porze, jeśli nikt mu nie powie, że godziny są lokalne dla sali.
    const foreign = browserTimeZone() === "Pacific/Auckland" ? "Europe/Warsaw" : "Pacific/Auckland";
    fetchAgenda.mockResolvedValue([session({ id: "a", timezone: foreign })]);
    const view = renderAgenda();
    expect(await screen.findByText("eventFront.agenda.timezoneForeign")).toBeInTheDocument();

    view.unmount();
    fetchAgenda.mockResolvedValue([session({ id: "a", timezone: browserTimeZone() })]);
    renderAgenda();
    await screen.findByText("Sesja otwarcia");
    expect(screen.queryByText("eventFront.agenda.timezoneForeign")).not.toBeInTheDocument();
  });
});

describe("EventAgendaSection - pusty dzień i filtry", () => {
  it("dzień opróżniony frazą zostaje zakładką i mówi, że to fraza", async () => {
    fetchAgenda.mockResolvedValue([
      session({ id: "a", titlePl: "Bezpieczeństwo energetyczne" }),
      session({
        id: "b",
        titlePl: "Rynek pracy",
        startsAt: "2026-09-02T08:00:00Z",
        endsAt: "2026-09-02T09:00:00Z",
      }),
    ]);
    renderAgenda();

    const field = await screen.findByPlaceholderText("eventFront.agenda.search");
    fireEvent.change(field, { target: { value: "rynek" } });

    // Zdanie mówi o FRAZIE, a nie o programie - inaczej uczestnik czyta pustkę
    // jako „drugiego dnia nie ma".
    expect(screen.getByText("eventFront.agenda.emptyQuery")).toBeInTheDocument();
    // Zakładka dnia NIE ZNIKA: drugi dzień nadal jest jednym kliknięciem stąd.
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.queryByText("Bezpieczeństwo energetyczne")).not.toBeInTheDocument();
  });

  it("„tylko moje” na dniu bez moich sesji mówi o filtrze, nie o pustym programie", async () => {
    fetchAgenda.mockResolvedValue([
      session({ id: "a", titlePl: "Panel otwarcia" }),
      session({
        id: "b",
        titlePl: "Moja sesja",
        startsAt: "2026-09-02T08:00:00Z",
        endsAt: "2026-09-02T09:00:00Z",
        mySignupStatus: "registered",
        accessState: "signed_up",
      }),
    ]);
    renderAgenda();
    await screen.findByText("Panel otwarcia");

    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getByText("eventFront.agenda.emptyMine")).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(2);

    // Powrót przełącznika oddaje program tego samego dnia.
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getByText("Panel otwarcia")).toBeInTheDocument();
  });

  it("nurt bez sesji tego dnia mówi o filtrze i wraca po „wszystkie nurty”", async () => {
    fetchAgenda.mockResolvedValue([
      session({
        id: "a",
        titlePl: "Panel energetyczny",
        track: { id: "t1", key: "energia", namePl: "Energia", nameEn: "Energy", accentColor: null },
      }),
      session({
        id: "b",
        titlePl: "Panel pracy",
        startsAt: "2026-09-02T08:00:00Z",
        endsAt: "2026-09-02T09:00:00Z",
        track: { id: "t2", key: "praca", namePl: "Praca", nameEn: "Work", accentColor: "#2563eb" },
      }),
    ]);
    renderAgenda();
    await screen.findByText("Panel energetyczny");

    fireEvent.click(screen.getByRole("button", { name: /Praca/ }));
    expect(screen.getByText("eventFront.agenda.emptyFiltered")).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "eventFront.agenda.allTracks" }));
    expect(screen.getByText("Panel energetyczny")).toBeInTheDocument();
  });

  it("zakładka drugiego dnia pokazuje jego sesje zamiast wczorajszych", async () => {
    fetchAgenda.mockResolvedValue([
      session({ id: "a", titlePl: "Dzień pierwszy" }),
      session({
        id: "b",
        titlePl: "Dzień drugi",
        startsAt: "2026-09-02T08:00:00Z",
        endsAt: "2026-09-02T09:00:00Z",
      }),
    ]);
    renderAgenda();
    await screen.findByText("Dzień pierwszy");

    fireEvent.click(screen.getAllByRole("tab")[1]);
    expect(screen.getByText("Dzień drugi")).toBeInTheDocument();
    expect(screen.queryByText("Dzień pierwszy")).not.toBeInTheDocument();
  });
});

describe("EventAgendaSection - harmonogram uczestnika", () => {
  it("wiersz harmonogramu odsłania sesję z innego dnia i zdejmuje frazę, która ją ukrywała", async () => {
    fetchAgenda.mockResolvedValue([
      session({ id: "a", titlePl: "Panel otwarcia" }),
      session({
        id: "b",
        titlePl: "Moja sesja",
        startsAt: "2026-09-02T08:00:00Z",
        endsAt: "2026-09-02T09:00:00Z",
        mySignupStatus: "registered",
        accessState: "signed_up",
      }),
    ]);
    renderAgenda();

    const field = await screen.findByPlaceholderText("eventFront.agenda.search");
    fireEvent.change(field, { target: { value: "nie ma takiej sesji" } });
    // Póki co „Moja sesja" istnieje TYLKO w kolumnie harmonogramu.
    expect(screen.getAllByText("Moja sesja")).toHaveLength(1);

    fireEvent.click(within(scheduleCard()).getByText("Moja sesja"));

    // Klik ma ODSŁONIĆ sesję, a nie tylko przełączyć zakładkę: fraza znika,
    // a blok sesji pojawia się w kolumnie programu.
    expect(field).toHaveValue("");
    expect(screen.getAllByText("Moja sesja")).toHaveLength(2);
    expect(document.getElementById("event-session-b")).not.toBeNull();
  });

  it("długi harmonogram chowa nadmiar za odnośnikiem, który pokazuje resztę", async () => {
    fetchAgenda.mockResolvedValue(
      ["1", "2", "3", "4"].map((nr, index) =>
        session({
          id: `m${nr}`,
          titlePl: `Moja sesja ${nr}`,
          startsAt: `2026-09-01T0${index + 8}:00:00Z`,
          endsAt: `2026-09-01T0${index + 8}:30:00Z`,
          mySignupStatus: "registered",
          accessState: "signed_up",
        }),
      ),
    );
    renderAgenda();
    await screen.findByText("eventFront.agenda.myScheduleTitle");

    // Kolumna jest RZUTEM OKA, nie drugą kopią agendy - czwarty termin czeka
    // za odnośnikiem, zamiast spychać program pod ekran.
    expect(within(scheduleCard()).queryByText("Moja sesja 4")).toBeNull();

    fireEvent.click(screen.getByText("eventFront.agenda.myScheduleShowAll"));
    expect(within(scheduleCard()).getByText("Moja sesja 4")).toBeInTheDocument();
    expect(screen.queryByText("eventFront.agenda.myScheduleShowAll")).not.toBeInTheDocument();
  });
});

describe("EventAgendaSection - odmowy i wynik zapisu", () => {
  it("nieosiągalny program mówi zdaniem ze słownika, a nie komunikatem bazy", async () => {
    fetchAgenda.mockRejectedValue(new Error("permission denied for function event_agenda"));
    renderAgenda();

    expect(await screen.findByText(i18n.t("eventFront.errors.unknown"))).toBeInTheDocument();
    expect(screen.queryByText(/permission denied/)).not.toBeInTheDocument();
  });

  it("odmowa zapisu nie zostawia przycisku w stanie „pracuję” i nie zdradza cudzej sesji", async () => {
    fetchAgenda.mockResolvedValue([session({ id: "s9" })]);
    // Ogon komunikatu plpgsql niesie TYTUŁ CUDZEJ SESJI - do zdania dla
    // uczestnika wchodzi wyłącznie klucz z głowy komunikatu.
    submitSignup.mockRejectedValue(
      new Error('overlap_conflict: you are already signed up for "Kolacja partnerów"'),
    );
    renderAgenda();

    fireEvent.click(await screen.findByText("eventFront.agenda.actions.signup"));
    await waitFor(() => expect(errorToast).toHaveBeenCalledTimes(1));
    expect(errorToast).toHaveBeenCalledWith(i18n.t("eventFront.errors.overlapConflict"));
    expect(errorToast.mock.calls[0][0]).not.toContain("Kolacja partnerów");
    // Przycisk wraca do zapisu - inaczej uczestnik zostaje przed kontrolką,
    // która na zawsze mówi „pracuję".
    expect(await screen.findByText("eventFront.agenda.actions.signup")).toBeInTheDocument();
  });

  it("zapis na rezerwę nie udaje zapisu na salę", async () => {
    fetchAgenda.mockResolvedValue([session({ id: "s9", accessState: "full", seatsLeft: 0 })]);
    submitSignup.mockResolvedValue({
      status: "waitlist",
      promoted: false,
      registered: 40,
      seatsLeft: 0,
    });
    renderAgenda();

    fireEvent.click(await screen.findByText("eventFront.agenda.actions.joinWaitlist"));
    await waitFor(() => expect(successToast).toHaveBeenCalledTimes(1));
    // Front prosi o ZAPIS, a o rezerwie rozstrzyga baza. Wysłanie stąd
    // „waitlist" oznaczałoby, że przeglądarka sama sobie przyznaje miejsce na
    // sali albo poza nią - a liczbę wolnych miejsc zna tylko SQL.
    expect(submitSignup).toHaveBeenCalledWith({ sessionId: "s9", status: "registered" });
    expect(successToast).toHaveBeenCalledWith("eventFront.agenda.toasts.waitlist");
    // Zdanie o rezerwie NIE MOŻE być zdaniem o zapisie: obiecywałoby miejsce,
    // którego uczestnik może nigdy nie dostać.
    expect(successToast).not.toHaveBeenCalledWith("eventFront.agenda.toasts.registered");
  });

  it("rezygnacja mówi o zwolnionym miejscu, a awans z rezerwy dostaje osobne zdanie", async () => {
    fetchAgenda.mockResolvedValue([
      session({ id: "s9", mySignupStatus: "registered", accessState: "signed_up" }),
    ]);
    submitSignup.mockResolvedValue({
      status: "cancelled",
      promoted: true,
      registered: 40,
      seatsLeft: 0,
    });
    renderAgenda();

    fireEvent.click(await screen.findByText("eventFront.agenda.actions.cancel"));
    await waitFor(() => expect(successToast).toHaveBeenCalledTimes(1));
    expect(submitSignup).toHaveBeenCalledWith({ sessionId: "s9", status: "cancelled" });
    expect(successToast).toHaveBeenCalledWith("eventFront.agenda.toasts.cancelled");
    // Awans kogoś z rezerwy to DRUGA informacja, nie odcień pierwszej.
    expect(infoToast).toHaveBeenCalledWith("eventFront.agenda.toasts.promoted");
  });
});
