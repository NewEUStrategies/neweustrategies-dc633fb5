// PASEK AKCJI PRZY WIZYTÓWCE UCZESTNIKA - „dodaj do znajomych”, „umów
// spotkanie 1-1”, „napisz wiadomość”.
//
// CO TEN PLIK DOWODZI I DLACZEGO TO WAŻNE:
//
//  1. NIEZALOGOWANY WIDZ NIE DOSTAJE PRZYCISKÓW, TYLKO ZACHĘTĘ. Przycisk,
//     który i tak skończy się odmową bazy, jest gorszy niż zdanie „zaloguj
//     się”: uczestnik klika, dostaje błąd i nie wie, czy zawinił on, czy serwis.
//
//  2. WŁASNEJ WIZYTÓWKI NIE DA SIĘ ZAPROSIĆ DO ZNAJOMYCH. Podgląd „jak widzą
//     mnie inni” pokazuje NOTKĘ zamiast uzbrojonych przycisków - klik na
//     podglądzie wysłałby zaproszenie do samego siebie.
//
//  3. KONTO PLATFORMY JEST WARUNKIEM CZATU I SIECI KONTAKTÓW. Uczestnik
//     istniejący wyłącznie w kartotece wydarzenia (bez `user_id`) nie ma
//     skrzynki ani profilu - zostaje mu samo spotkanie 1-1.
//
//  4. SPOTKANIE WYMAGA KOMPLETU ADRESU: sluga wydarzenia ORAZ kartoteki
//     adresata. Bez nich nie ma do czego przypiąć zaproszenia, więc przycisku
//     nie ma - zamiast wysyłać zaproszenie donikąd.
//
//  5. ZAPROSZONY I POTWIERDZONY TO DWA RÓŻNE ZDANIA, a oba prowadzą do LISTY
//     SPOTKAŃ, nie do drugiego zaproszenia - powtórka zrobiłaby duplikat
//     w kalendarzu obu stron.
//
//  6. ODMOWA MÓWI SWOIM KODEM. Zajęty termin, brak okna dostępności, cofnięta zgoda -
//     `meetingErrorI18nKey` zamienia je na osobne zdania; jedno „nie udało się”
//     nie mówi, czy zmienić godzinę, czy odpuścić.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. `ConnectButton`, `DirectMessageButton`
// i `MeetingInviteDialog` mają WŁASNE pliki testowe - tutaj stoją atrapy,
// bo przedmiotem dowodu jest KIEDY pasek je pokazuje i CO im podaje.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";

import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { axeViolations, summarize } from "@/test/axe";

interface WejscieZaproszenia {
  eventSlug: string;
  counterpartRegistrationId: string;
  startsAt: string;
  topic: string | null;
  message: string | null;
}

type UchwytyMutacji = {
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
};

const h = vi.hoisted(() => ({
  uzytkownik: { current: { id: "u-1" } as { id: string } | null },
  /** Zapisane wywołania `invite.mutate(...)` - ładunek i uchwyty. */
  zaproszenia: [] as { input: WejscieZaproszenia; handlers: UchwytyMutacji }[],
  slugHooka: [] as (string | null)[],
  /** Czy zaproszenie jest właśnie w drodze - sterowane per przypadek. */
  wTrakcie: { current: false },
  sukces: vi.fn(),
  blad: vi.fn(),
  otworzSpotkania: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("@/lib/i18n-cart", () => ({ ensureI18n: () => {} }));

vi.mock("sonner", () => ({ toast: { success: h.sukces, error: h.blad } }));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.uzytkownik.current }) }));

vi.mock("@/lib/events/useMyMeetings", () => ({
  useInviteToMeeting: (slug: string | null) => {
    h.slugHooka.push(slug);
    return {
      isPending: h.wTrakcie.current,
      mutate: (input: WejscieZaproszenia, handlers: UchwytyMutacji) => {
        h.zaproszenia.push({ input, handlers });
      },
    };
  },
}));

vi.mock("@/components/network/ConnectButton", () => ({
  ConnectButton: ({ userId }: { userId: string }) => (
    <button type="button" data-testid="dodaj-do-sieci" data-user={userId}>
      connect
    </button>
  ),
}));

vi.mock("@/components/network/DirectMessageButton", () => ({
  DirectMessageButton: ({ userId }: { userId: string }) => (
    <button type="button" data-testid="napisz-wiadomosc" data-user={userId}>
      message
    </button>
  ),
}));

// Okno wyboru terminu ma własny plik testowy; tutaj potrzebujemy wyłącznie
// sterowalnego `onSubmit`, żeby sprawdzić, CO pasek robi z jego wyjściem.
vi.mock("@/components/events/meetings/MeetingInviteDialog", () => ({
  MeetingInviteDialog: ({
    open,
    counterpartRegistrationId,
    onSubmit,
  }: {
    open: boolean;
    counterpartRegistrationId: string | null;
    onSubmit: (input: { startsAt: string; topic: string | null; message: string | null }) => void;
  }) =>
    open ? (
      <div data-testid="okno-zaproszenia" data-adresat={counterpartRegistrationId ?? ""}>
        <button
          type="button"
          onClick={() =>
            onSubmit({
              startsAt: "2026-09-15T09:00:00.000Z",
              topic: "Współpraca przy projekcie",
              message: null,
            })
          }
        >
          wyslij-zaproszenie
        </button>
      </div>
    ) : null,
}));

const { EventPersonActions } =
  await import("@/components/events/participant/molecules/EventPersonActions");

const SLUG = "kongres-cee-2026";
const REJESTRACJA = "11111111-1111-4111-8111-111111111111";
const KONTO = "22222222-2222-4222-8222-222222222222";

function pasek(over: Partial<Parameters<typeof EventPersonActions>[0]> = {}) {
  return renderWithQueryClient(
    <EventPersonActions
      slug={SLUG}
      userId={KONTO}
      displayName="Marek Nowak"
      registrationId={REJESTRACJA}
      onOpenMeetings={h.otworzSpotkania}
      {...over}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.uzytkownik.current = { id: "u-1" };
  h.zaproszenia.length = 0;
  h.slugHooka.length = 0;
  h.wTrakcie.current = false;
});

describe("EventPersonActions - kto w ogóle dostaje przyciski", () => {
  it("podgląd WŁASNEJ wizytówki pokazuje notkę zamiast uzbrojonych akcji", () => {
    pasek({ self: true });

    expect(screen.getByText("eventMe.publicPreview.actionsSelf")).toBeTruthy();
    expect(screen.queryByTestId("dodaj-do-sieci")).toBeNull();
    expect(screen.queryByTestId("napisz-wiadomosc")).toBeNull();
    expect(screen.queryByRole("button", { name: "eventMe.publicPreview.meeting" })).toBeNull();
  });

  it("niezalogowany widz dostaje ZACHĘTĘ DO LOGOWANIA, a nie przyciski do odmowy", () => {
    h.uzytkownik.current = null;
    pasek();

    expect(screen.getByText("eventMe.publicPreview.actionsSignIn")).toBeTruthy();
    expect(screen.queryByTestId("dodaj-do-sieci")).toBeNull();
  });

  it("zalogowany widz dostaje komplet: sieć kontaktów, spotkanie i wiadomość", () => {
    pasek();

    expect(screen.getByTestId("dodaj-do-sieci").getAttribute("data-user")).toBe(KONTO);
    expect(screen.getByTestId("napisz-wiadomosc").getAttribute("data-user")).toBe(KONTO);
    expect(screen.getByRole("button", { name: "eventMe.publicPreview.meeting" })).toBeTruthy();
  });

  it("uczestnik BEZ konta platformy dostaje samo spotkanie - nie ma skrzynki ani profilu", () => {
    pasek({ userId: null });

    expect(screen.queryByTestId("dodaj-do-sieci")).toBeNull();
    expect(screen.queryByTestId("napisz-wiadomosc")).toBeNull();
    expect(screen.getByRole("button", { name: "eventMe.publicPreview.meeting" })).toBeTruthy();
  });
});

describe("EventPersonActions - spotkanie 1-1", () => {
  it("bez kartoteki adresata przycisku spotkania NIE MA", () => {
    pasek({ registrationId: null });

    expect(screen.queryByRole("button", { name: "eventMe.publicPreview.meeting" })).toBeNull();
    expect(screen.queryByTestId("okno-zaproszenia")).toBeNull();
    // Sieć kontaktów działa dalej - to inna relacja, nie ta sama bramka.
    expect(screen.getByTestId("dodaj-do-sieci")).toBeTruthy();
  });

  it("bez sluga wydarzenia też nie ma czego zapraszać", () => {
    pasek({ slug: null });

    expect(screen.queryByRole("button", { name: "eventMe.publicPreview.meeting" })).toBeNull();
    expect(h.slugHooka.at(-1)).toBeNull();
  });

  it("już zaproszony prowadzi do LISTY SPOTKAŃ, a nie do drugiego zaproszenia", () => {
    pasek({ meetingStatus: "invited" });

    const przycisk = screen.getByRole("button", {
      name: "eventMe.publicPreview.meetingInvited",
    });
    fireEvent.click(przycisk);

    expect(h.otworzSpotkania).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("okno-zaproszenia")).toBeNull();
    expect(h.zaproszenia).toHaveLength(0);
  });

  it("potwierdzone spotkanie ma INNE zdanie niż zaproszenie w toku", () => {
    pasek({ meetingStatus: "accepted" });

    expect(
      screen.getByRole("button", { name: "eventMe.publicPreview.meetingAccepted" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "eventMe.publicPreview.meetingInvited" }),
    ).toBeNull();
  });

  it("zaproszenie jedzie z KOMPLETEM adresu: slug wydarzenia i kartoteka adresata", () => {
    pasek();
    fireEvent.click(screen.getByRole("button", { name: "eventMe.publicPreview.meeting" }));

    expect(screen.getByTestId("okno-zaproszenia").getAttribute("data-adresat")).toBe(REJESTRACJA);
    fireEvent.click(screen.getByRole("button", { name: "wyslij-zaproszenie" }));

    expect(h.zaproszenia).toHaveLength(1);
    expect(h.zaproszenia[0]?.input).toEqual({
      eventSlug: SLUG,
      counterpartRegistrationId: REJESTRACJA,
      startsAt: "2026-09-15T09:00:00.000Z",
      topic: "Współpraca przy projekcie",
      message: null,
    });
  });

  it("zaproszenie W DRODZE zamienia ikonę kalendarza na wskaźnik pracy", () => {
    h.wTrakcie.current = true;
    const { container } = pasek();

    const przycisk = screen.getByRole("button", { name: "eventMe.publicPreview.meeting" });
    // Napis zostaje ten sam - zmienia się WYŁĄCZNIE sygnał, że coś trwa.
    expect(przycisk.querySelector(".animate-spin")).toBeTruthy();
    expect(container.querySelectorAll(".animate-spin")).toHaveLength(1);
  });

  it("udane zaproszenie ZAMYKA okno i potwierdza zdaniem", () => {
    pasek();
    fireEvent.click(screen.getByRole("button", { name: "eventMe.publicPreview.meeting" }));
    fireEvent.click(screen.getByRole("button", { name: "wyslij-zaproszenie" }));

    // `onSuccess` zamyka okno przez `setState` - bez `act` asercja czyta DOM
    // sprzed przerysowania.
    act(() => h.zaproszenia[0]?.handlers.onSuccess?.());

    expect(h.sukces).toHaveBeenCalledWith("eventMe.publicPreview.meetingSent");
    expect(screen.queryByTestId("okno-zaproszenia")).toBeNull();
  });

  it("odmowa mówi SWOIM kodem i ZOSTAWIA okno otwarte - termin da się poprawić", () => {
    pasek();
    fireEvent.click(screen.getByRole("button", { name: "eventMe.publicPreview.meeting" }));
    fireEvent.click(screen.getByRole("button", { name: "wyslij-zaproszenie" }));

    act(() => h.zaproszenia[0]?.handlers.onError?.(new Error("invitee_unavailable: no window")));

    expect(h.blad).toHaveBeenCalledWith("eventMeetings.errors.invitee_unavailable");
    expect(h.sukces).not.toHaveBeenCalled();
    expect(screen.getByTestId("okno-zaproszenia")).toBeTruthy();
  });
});

describe("EventPersonActions - dostępność", () => {
  it("pełny pasek akcji nie ma naruszeń axe", async () => {
    const { container } = pasek();

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("notka dla niezalogowanego widza nie ma naruszeń axe", async () => {
    h.uzytkownik.current = null;
    const { container } = pasek();

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
