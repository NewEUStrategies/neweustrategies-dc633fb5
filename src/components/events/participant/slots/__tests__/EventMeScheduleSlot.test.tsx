// GNIAZDO „Harmonogram" panelu „Moje" - `EventMeScheduleSlot`.
//
// WŁAŚCICIEL: tor A (osobisty plan). Do tego czasu gniazdo trzyma dzisiejszy
// harmonogram (`MyAgendaList` nad `event_my_agenda`), a ten plik przejął
// asercje zakładki harmonogramu z `EventMePanel.test.tsx` (spec B.11, BLK-5):
// test hosta sprawdza już tylko MIEJSCE montażu i właściwości gniazda, a
// zachowanie gniazda mieszka tutaj.
//
// CO TEN PLIK DOWODZI:
//  1. Gniazdo pyta `event_my_agenda` o SLUG z właściwości - zły slug pokazałby
//     uczestnikowi cudze zapisy.
//  2. „Wczytujemy", „pusto" i „baza odmówiła" to TRZY różne ekrany. Dawny
//     `it.fails` („odmowa wygląda jak pusta agenda") jest tu zwykłym `it` -
//     gniazdo ma gałąź błędu z przyciskiem ponowienia.
//  3. Zapytanie osobiste rusza dopiero po rozstrzygnięciu sesji: gość i stan
//     `useAuth().loading` nie pytają bazy (R-UI/SSR).
//
// `MyAgendaList` jedzie PRAWDZIWY, bo to on rozstrzyga o różnicy między
// „wczytujemy" a „pusto"; atrapą jest wyłącznie warstwa odczytu.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import type { MyAgendaSession } from "@/lib/events/myEventProfileApi";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { axeViolations, summarize } from "@/test/axe";
import {
  PARTICIPANT_EVENT_SLUG,
  makeEventParticipantOptions,
  makeMyEventRegistrationSummary,
} from "@/test/events/participantFixtures";

const h = vi.hoisted(() => ({
  auth: {
    current: { session: { user: { id: "u-1" } }, loading: false } as {
      session: { user: { id: string } } | null;
      loading: boolean;
    },
  },
  pobierzAgende: vi.fn<(slug: string) => Promise<MyAgendaSession[]>>(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-cart", () => ({ ensureI18n: () => {} }));
vi.mock("@/lib/i18n-event-participant", () => ({ ensureI18n: () => {} }));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    session: h.auth.current.session,
    user: h.auth.current.session?.user ?? null,
    loading: h.auth.current.loading,
  }),
}));

vi.mock("@/lib/events/myEventProfileApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/myEventProfileApi")>()),
  fetchMyAgenda: (slug: string) => h.pobierzAgende(slug),
}));

const { EventMeScheduleSlot } =
  await import("@/components/events/participant/slots/EventMeScheduleSlot");

function sesjaAgendy(over: Partial<MyAgendaSession> = {}): MyAgendaSession {
  return {
    sessionId: "33333333-3333-4333-8333-333333333333",
    titlePl: "Panel: sieci przesyłowe",
    titleEn: "Panel: transmission grids",
    startsAt: "2026-09-15T08:30:00.000Z",
    endsAt: "2026-09-15T09:30:00.000Z",
    format: "panel",
    roomName: "Sala Bałtycka",
    roomFloor: null,
    roomNamePl: "Sala Bałtycka",
    roomNameEn: "Sala Bałtycka",
    trackNamePl: null,
    trackNameEn: null,
    signupStatus: "registered",
    sessionStatus: "published",
    timezone: "Europe/Warsaw",
    ...over,
  };
}

function pokaz() {
  return renderWithQueryClient(
    <EventMeScheduleSlot
      slug={PARTICIPANT_EVENT_SLUG}
      registration={makeMyEventRegistrationSummary()}
      options={makeEventParticipantOptions()}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.current = { session: { user: { id: "u-1" } }, loading: false };
  h.pobierzAgende.mockResolvedValue([sesjaAgendy()]);
});

describe("EventMeScheduleSlot - dzisiejszy harmonogram", () => {
  it("pokazuje sesje z `event_my_agenda` dla sluga z właściwości", async () => {
    pokaz();

    expect(await screen.findByText("Panel: sieci przesyłowe")).toBeTruthy();
    expect(h.pobierzAgende).toHaveBeenCalledWith(PARTICIPANT_EVENT_SLUG);
  });

  it("pusta agenda to zdanie o braku zapisów, a nie awaria", async () => {
    h.pobierzAgende.mockResolvedValue([]);
    pokaz();

    expect(await screen.findByText("eventMe.agendaEmpty")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("dopóki agenda się wczytuje, stoją szkielety - a NIE zdanie o pustce", async () => {
    h.pobierzAgende.mockReturnValue(new Promise<MyAgendaSession[]>(() => {}));
    const { container } = pokaz();

    await waitFor(() =>
      expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0),
    );
    expect(screen.queryByText("eventMe.agendaEmpty")).toBeNull();
  });

  it("odmowa `event_my_agenda` NIE wygląda jak pusta agenda - ma własne zdanie i ponowienie", async () => {
    // Dawny `it.fails` z `EventMePanel.test.tsx`: panel podawał
    // `sessions={agenda.data ?? []}`, więc po odmowie uczestnik czytał „nie masz
    // jeszcze żadnych zapisów”. Gniazdo ma gałąź `isError`.
    h.pobierzAgende.mockRejectedValue(new Error("auth_required: sign in to see your agenda"));
    const { container } = pokaz();

    await waitFor(() => expect(h.pobierzAgende).toHaveBeenCalled());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("eventParticipant.agenda.loadError");
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(0);
    expect(screen.queryByText("eventMe.agendaEmpty")).toBeNull();
  });

  it("przycisk ponowienia pyta bazę jeszcze raz i po sukcesie pokazuje sesje", async () => {
    h.pobierzAgende.mockRejectedValueOnce(new Error("network: offline"));
    pokaz();

    fireEvent.click(await screen.findByRole("button", { name: "eventParticipant.agenda.retry" }));

    expect(await screen.findByText("Panel: sieci przesyłowe")).toBeTruthy();
    expect(h.pobierzAgende).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("EventMeScheduleSlot - zapytanie osobiste dopiero po rozstrzygnięciu sesji", () => {
  it("gość NIE pyta bazy - RPC i tak odmówiłoby", () => {
    h.auth.current = { session: null, loading: false };
    const { container } = pokaz();

    expect(h.pobierzAgende).not.toHaveBeenCalled();
    // Nie wiemy, co jest w agendzie, więc nie twierdzimy, że jest pusta.
    expect(screen.queryByText("eventMe.agendaEmpty")).toBeNull();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("dopóki sesja się rozstrzyga (`loading`), zapytanie nie rusza", () => {
    h.auth.current = { session: { user: { id: "u-1" } }, loading: true };
    pokaz();

    expect(h.pobierzAgende).not.toHaveBeenCalled();
  });
});

describe("EventMeScheduleSlot - dostępność", () => {
  it("lista sesji nie ma naruszeń axe", async () => {
    const { container } = pokaz();

    await screen.findByText("Panel: sieci przesyłowe");
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("stan błędu nie ma naruszeń axe", async () => {
    h.pobierzAgende.mockRejectedValue(new Error("network: offline"));
    const { container } = pokaz();

    await screen.findByRole("alert");
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
