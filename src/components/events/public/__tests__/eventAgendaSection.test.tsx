// Agenda publiczna: to, co po zepsuciu kosztuje uczestnika miejsce na sesji.
//
// SPRAWDZAMY KONTRAKT, NIE NAPISY. i18n jest zamockowane kluczami (parytet
// PL/EN pilnuje osobna bramka słowników). Tu chodzi o siedem rzeczy:
// 1. dni są ZAKŁADKAMI - sesje z drugiego dnia nie mieszają się z pierwszym,
// 2. zapis wysyła DOKŁADNIE `session_id` + `status`, bo tego chce RPC,
// 3. gość bez konta nie strzela w bazę, tylko dostaje podpowiedź logowania,
// 4. komplet miejsc daje kontrolkę REZERWY, a nie odmowę po kliknięciu,
// 5. pole „Wyszukiwanie” zawęża listę, a nie tylko zapamiętuje literę,
// 6. „Twój harmonogram” pokazuje WYŁĄCZNIE sesje wołającego i znika u gościa -
//    kolumna liczy się z `my_signup_status`, więc pomyłka tutaj pokazałaby
//    jednemu uczestnikowi zapisy drugiego,
// 7. sesja bez obsady nie zostawia pustego rzędu prelegentów.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { AgendaSession } from "@/lib/events/agendaSurface";
import type { SessionSignupResult } from "@/lib/events/publicEventApi";

const fetchAgenda = vi.fn<(slug: string) => Promise<AgendaSession[]>>();
const submitSignup =
  vi.fn<(input: { sessionId: string; status: string }) => Promise<SessionSignupResult>>();
const infoToast = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "pl", exists: () => true, changeLanguage: () => Promise.resolve() },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: (message: string) => infoToast(message),
  },
}));

const authState = { user: null as { id: string } | null };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => authState,
}));

vi.mock("@/lib/events/publicEventApi", () => ({
  fetchEventAgenda: (slug: string) => fetchAgenda(slug),
  submitSessionSignup: (input: { sessionId: string; status: string }) => submitSignup(input),
  fetchEventSections: vi.fn(),
  fetchEventSponsors: vi.fn(),
  fetchEventSponsorMaterials: vi.fn(),
  fetchSessionAccess: vi.fn(),
  toggleEventBookmark: vi.fn(),
  fetchMyBookmarks: vi.fn(),
  BOOKMARK_SCOPES: ["upcoming", "past", "all"],
}));

const { EventAgendaSection } =
  await import("@/components/events/public/organisms/EventAgendaSection");

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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EventAgendaSection slug="kongres" />
    </QueryClientProvider>,
  );
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

describe("EventAgendaSection", () => {
  it("pokazuje sesje pierwszego dnia i nie miesza ich z drugim", async () => {
    fetchAgenda.mockResolvedValue([
      session({ id: "a", titlePl: "Dzien pierwszy" }),
      session({ id: "b", titlePl: "Dzien drugi", startsAt: "2026-09-02T08:00:00Z" }),
    ]);
    renderAgenda();
    expect(await screen.findByText("Dzien pierwszy")).toBeInTheDocument();
    expect(screen.queryByText("Dzien drugi")).not.toBeInTheDocument();
  });

  it("zapis wysyla dokladnie identyfikator sesji i stan", async () => {
    fetchAgenda.mockResolvedValue([session({ id: "s9" })]);
    renderAgenda();
    fireEvent.click(await screen.findByText("eventFront.agenda.actions.signup"));
    await waitFor(() => expect(submitSignup).toHaveBeenCalledTimes(1));
    expect(submitSignup).toHaveBeenCalledWith({ sessionId: "s9", status: "registered" });
  });

  it("gosc bez konta dostaje podpowiedz logowania, a baza NIE dostaje zadania", async () => {
    authState.user = null;
    fetchAgenda.mockResolvedValue([session({})]);
    renderAgenda();
    fireEvent.click(await screen.findByText("eventFront.agenda.actions.signIn"));
    await waitFor(() => expect(infoToast).toHaveBeenCalled());
    expect(submitSignup).not.toHaveBeenCalled();
  });

  it("komplet miejsc daje kontrolke REZERWY, nie odmowe po kliknieciu", async () => {
    fetchAgenda.mockResolvedValue([session({ accessState: "full", seatsLeft: 0 })]);
    renderAgenda();
    expect(await screen.findByText("eventFront.agenda.actions.joinWaitlist")).toBeInTheDocument();
  });

  it("zapisany widzi rezygnacje, a nie drugi zapis", async () => {
    fetchAgenda.mockResolvedValue([
      session({ mySignupStatus: "registered", accessState: "signed_up" }),
    ]);
    renderAgenda();
    expect(await screen.findByText("eventFront.agenda.actions.cancel")).toBeInTheDocument();
  });

  it("fraza z pola wyszukiwania zaweza liste sesji dnia", async () => {
    fetchAgenda.mockResolvedValue([
      session({ id: "a", titlePl: "Bezpieczenstwo energetyczne" }),
      session({ id: "b", titlePl: "Rynek pracy" }),
    ]);
    renderAgenda();
    const field = await screen.findByPlaceholderText("eventFront.agenda.search");
    fireEvent.change(field, { target: { value: "rynek" } });
    expect(screen.getByText("Rynek pracy")).toBeInTheDocument();
    expect(screen.queryByText("Bezpieczenstwo energetyczne")).not.toBeInTheDocument();
  });

  it("harmonogram po lewej pokazuje MOJE sesje, a gosc go nie widzi", async () => {
    fetchAgenda.mockResolvedValue([
      session({ id: "a", titlePl: "Moja sesja", mySignupStatus: "registered" }),
      session({ id: "b", titlePl: "Obca sesja" }),
    ]);
    const view = renderAgenda();
    const card = (await screen.findByText("eventFront.agenda.myScheduleTitle")).closest("section");
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByText("Moja sesja")).toBeInTheDocument();
    expect(within(card as HTMLElement).queryByText("Obca sesja")).toBeNull();

    // Gosc nie ma zapisow, wiec karta harmonogramu nie ma czego pokazac.
    view.unmount();
    authState.user = null;
    fetchAgenda.mockResolvedValue([session({ id: "a", titlePl: "Moja sesja" })]);
    renderAgenda();
    expect(await screen.findByText("Moja sesja")).toBeInTheDocument();
    expect(screen.queryByText("eventFront.agenda.myScheduleTitle")).not.toBeInTheDocument();
  });

  it("sesja bez obsady nie rysuje pustego rzedu prelegentow", async () => {
    fetchAgenda.mockResolvedValue([session({ id: "a", speakers: [] })]);
    renderAgenda();
    await screen.findByText("Sesja otwarcia");
    expect(screen.queryByRole("list", { name: "eventFront.agenda.speakersLabel" })).toBeNull();
  });

  it("prelegent sesji ma nazwisko i organizacje w bloku sesji", async () => {
    fetchAgenda.mockResolvedValue([
      session({
        id: "a",
        speakers: [
          {
            userId: "u1",
            slug: null,
            displayName: "Anna Zablocka",
            avatarUrl: null,
            headlinePl: "Glowna ekonomistka, PwC",
            headlineEn: null,
            role: "speaker",
            sortOrder: 0,
          },
        ],
      }),
    ]);
    renderAgenda();
    expect(await screen.findByText("Anna Zablocka")).toBeInTheDocument();
    expect(screen.getByText("Glowna ekonomistka, PwC")).toBeInTheDocument();
  });

  it("pusty program mowi o programie, a nie o bledzie", async () => {
    fetchAgenda.mockResolvedValue([]);
    renderAgenda();
    expect(await screen.findByText("eventFront.sections.agenda.empty")).toBeInTheDocument();
  });
});
