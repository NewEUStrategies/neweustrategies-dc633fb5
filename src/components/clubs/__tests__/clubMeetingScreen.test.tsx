// Strona JEDNEGO spotkania klubu (`ClubMeetingScreen`).
//
// CO TEN PLIK DOWODZI.
// (1) LISTA POTWIERDZONYCH JEST TREŚCIĄ, NIE OZDOBĄ - to jedyny powód, dla
//     którego ta trasa istnieje osobno od kalendarza. Dlatego "będę" i "może"
//     stoją w DWÓCH grupach, a nie w jednej wymieszanej liście, a osoba, która
//     to ja, nie dostaje przycisku wiadomości do siebie samej.
// (2) BRAK PRAWA DO SKŁADU NIE MOŻE UDAWAĆ PUSTEGO SPOTKANIA. Przy
//     `canSeeMembers = false` strona mówi WPROST, że nazwiska są ukryte, i NIE
//     odpytuje RPC z nazwiskami. To jest dokładnie defekt opisany w nagłówku
//     trasy `club.$clubSlug.e.$eventSlug.tsx`: w klubie `public`
//     `can_see_members` jest prawdziwe także dla niezalogowanego, RPC oddaje
//     42501, a strona pokazywała wtedy "nikt nie potwierdził" - czyli kłamała
//     o pustym spotkaniu. Test pilnuje obu połów: komunikatu I braku odczytu.
// (3) LICZBA I NAZWISKA TO DWIE RÓŻNE INFORMACJE. `going_count` liczy
//     wszystkich, lista nazwisk pomija ukrytych w katalogu - dlatego licznik
//     stoi NAD listą i pokazuje się także wtedy, gdy nazwisk nie ma wcale.
// (4) UPRAWNIENIA DECYDUJĄ O OFERCIE: pasek obecności pojawia się WYŁĄCZNIE
//     przy prawie odpowiedzi, włączonym RSVP i spotkaniu, które się odbędzie.
//     Odwołane spotkanie nie zbiera potwierdzeń - baza je odrzuci.
// (5) TRZY STANY DANYCH SPOTKANIA: odczyt w locie (szkielet), awaria
//     (komunikat plus ponowienie), brak spotkania o tym adresie (droga POWROTU
//     do kalendarza, a nie pusty ekran). Do tego stan częściowy: bez opisu, bez
//     miejsca, bez linku, bez rozmowy źródłowej, bez limitu miejsc - strona nie
//     ma prawa pokazać ani gołego `undefined`, ani pustej etykiety.
// (6) SPOTKANIE CAŁODNIOWE NIE MA GODZIN. Godzina zero-zero na spotkaniu
//     całodniowym to fałszywa precyzja, a zakres "od 00:00 do 00:00" - usterka
//     do pokazania.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// (a) `ClubPersonCard` i `MessageOrConnectButton` są ATRAPAMI (mają własne
//     pliki testowe) - asercje dotyczą tego, CO strona im podaje: nazwisko,
//     stanowisko, slug profilu, przygaszenie grupy "może".
// (b) `toEventKind`, `clubEventToneClass`, `pickLocalized` - reguły czyste
//     z własnymi testami; tutaj widać ich skutek.
// (c) Hooków `useClubEvent` / `useClubEventAttendees` / `useClubEventRsvp`
//     (klucze, `enabled`, unieważnienia) - warstwa danych ma własne testy.
//     Tu dowodzimy, że strona woła je z tym, co pokazuje, i że bramka
//     `enabled` NAPRAWDĘ wstrzymuje odczyt nazwisk.
// (d) Formatu daty z `Intl` - asercje idą na obecność roku i na to, czy
//     w napisie jest godzina, a nie na dokładny napis (ten zależy od ICU).
//
// UWAGA O JEDNYM WARUNKU. `description !== null` jest obroną bez treści:
// `description` pochodzi z `pickLocalized`, którego typ zwrotny to `string`,
// więc `null` nie ma jak tam dojechać. Stan "opisu nie ma" jedzie przez DRUGI
// członek koniunkcji (`trim() !== ""`) i to jego pokrywa test danych
// częściowych - z obu stron.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ClubEventAttendeeRow, ClubEventViewRow } from "@/lib/clubs/networkTypes";

const h = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-club", () => ({ ensureClubI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
vi.mock(
  "@/lib/clubs/networkApi",
  async () => (await import("@/test/clubs/workspaceApiMock")).networkApiMock,
);
vi.mock(
  "@/lib/clubs/workspaceApi",
  async () => (await import("@/test/clubs/workspaceApiMock")).workspaceApiMock,
);
vi.mock("@/components/network/MessageOrConnectButton", async () =>
  (await import("@/test/clubs/networkScreenStubs")).messageOrConnectStub(),
);
vi.mock("@/components/clubs/molecules/ClubPersonCard", async () =>
  (await import("@/test/clubs/networkScreenStubs")).personCardStub(),
);

import { ClubMeetingScreen } from "@/components/clubs/organisms/ClubMeetingScreen";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import {
  networkApiMock,
  resetNetworkApiMock,
  resetWorkspaceApiMock,
  workspaceApiMock,
} from "@/test/clubs/workspaceApiMock";
import {
  eventAttendeeRow,
  eventViewRow,
  NET_BASE_ISO,
  NET_IDS,
} from "@/test/clubs/networkScreenFixtures";

const CLUB_SLUG = "klub-energetyczny";
const EVENT_SLUG = "trilog-gazowy";

function nigdy(): Promise<never> {
  return new Promise<never>(() => undefined);
}

function renderMeeting(options: { canRsvp?: boolean; canSeeMembers?: boolean } = {}) {
  const { canRsvp = true, canSeeMembers = true } = options;
  return renderWithQueryClient(
    <ClubMeetingScreen
      clubId={NET_IDS.club}
      clubSlug={CLUB_SLUG}
      eventSlug={EVENT_SLUG}
      canRsvp={canRsvp}
      canSeeMembers={canSeeMembers}
    />,
  );
}

/** Ustawia odpowiedzi warstwy danych dla jednego spotkania i jego składu. */
function given(
  event: ClubEventViewRow | null,
  attendees: readonly ClubEventAttendeeRow[] = [],
): void {
  networkApiMock.fetchClubEvent.mockResolvedValue(event);
  networkApiMock.fetchClubEventAttendees.mockResolvedValue([...attendees]);
}

/** Wiersz opisu terminu - jedyne miejsce, w którym stoi data spotkania. */
function whenText(): string {
  const term = screen.getByText("club.network.meeting.when");
  const value = term.parentElement?.querySelector("dd");
  return value?.textContent ?? "";
}

beforeEach(() => {
  cleanup();
  resetNetworkApiMock();
  resetWorkspaceApiMock();
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(NET_BASE_ISO) });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ClubMeetingScreen - stany odczytu spotkania", () => {
  it("odczyt w locie pokazuje szkielet, a nie komunikat o braku spotkania", () => {
    networkApiMock.fetchClubEvent.mockImplementation(nigdy);
    renderMeeting();

    expect(screen.getByRole("generic", { busy: true })).toBeInTheDocument();
    expect(screen.queryByText("club.network.meeting.notFound")).not.toBeInTheDocument();
  });

  it("awaria odczytu daje komunikat i ponowienie, nigdy pustego spotkania", async () => {
    networkApiMock.fetchClubEvent.mockRejectedValue(new Error("42501"));
    renderMeeting();

    await waitFor(() => expect(screen.getByText("club.error.title")).toBeInTheDocument());
    expect(screen.queryByText("club.network.meeting.nobodyYet")).not.toBeInTheDocument();

    const przed = networkApiMock.fetchClubEvent.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /club\.error\.retry/ }));
    await waitFor(() =>
      expect(networkApiMock.fetchClubEvent.mock.calls.length).toBeGreaterThan(przed),
    );
  });

  it("brak spotkania o tym adresie daje drogę POWROTU do kalendarza", async () => {
    given(null);
    renderMeeting();

    await waitFor(() =>
      expect(screen.getByText("club.network.meeting.notFound")).toBeInTheDocument(),
    );
    expect(screen.getByRole("link", { name: "club.network.meeting.toCalendar" })).toHaveAttribute(
      "href",
      `/club/${CLUB_SLUG}/calendar`,
    );
    // Bez spotkania nie ma czego odpytywać o nazwiska.
    expect(networkApiMock.fetchClubEventAttendees).not.toHaveBeenCalled();
  });
});

describe("ClubMeetingScreen - dane pełne", () => {
  beforeEach(() => {
    given(eventViewRow(), [
      eventAttendeeRow({ user_id: NET_IDS.member, display_name: "Anna Nowak" }),
      eventAttendeeRow({
        user_id: NET_IDS.me,
        display_name: "Ja Sam",
        is_me: true,
        headline: null,
        profile_slug: null,
      }),
      eventAttendeeRow({
        user_id: NET_IDS.otherMember,
        display_name: "Jan Kowalski",
        state: "maybe",
      }),
    ]);
  });

  it("pokazuje rodzaj, tytuł z języka interfejsu, termin z godziną, miejsce i opis", async () => {
    renderMeeting();

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Trilog gazowy - przygotowanie stanowiska" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("club.calendar.kind.meeting")).toBeInTheDocument();
    expect(screen.getByText("Bruksela, Rue Belliard 40")).toBeInTheDocument();
    expect(screen.getByText("Omawiamy stanowisko klubu przed trilogiem.")).toBeInTheDocument();
    // Termin ma rok i godzinę, a zakres jest zakresem (dwie godziny w napisie).
    const when = whenText();
    expect(when).toContain("2026");
    expect(when.match(/\d{1,2}:\d{2}/g) ?? []).toHaveLength(2);
    expect(screen.queryByText("club.calendar.status.cancelled")).not.toBeInTheDocument();
  });

  it("prowadzi do rozmowy sali i do rozmowy, z której spotkanie wyrosło", async () => {
    renderMeeting();

    await waitFor(() =>
      expect(screen.getByRole("link", { name: /club\.network\.meeting\.join/ })).toHaveAttribute(
        "href",
        "https://spotkanie.example/trilog",
      ),
    );
    expect(screen.getByRole("link", { name: /club\.network\.meeting\.toThread/ })).toHaveAttribute(
      "href",
      `/club/${CLUB_SLUG}/t/temat-pierwszy`,
    );
  });

  it("licznik obecności stoi nad listą razem z limitem miejsc", async () => {
    renderMeeting();

    await waitFor(() =>
      expect(screen.getByText(/club\.network\.meeting\.goingCount\(count=7\)/)).toHaveTextContent(
        "club.network.meeting.capacity(count=20)",
      ),
    );
  });

  it("dzieli skład na DWIE grupy, a mnie samego nie zaprasza do rozmowy ze sobą", async () => {
    renderMeeting();

    await waitFor(() => expect(screen.getAllByTestId("karta-osoby")).toHaveLength(3));
    // Nagłówki grup, nie etykiety przycisków obecności - te same klucze i18n
    // stoją w obu miejscach i tylko rola je rozróżnia.
    expect(
      screen.getByRole("heading", { level: 3, name: "club.calendar.rsvp.going" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "club.calendar.rsvp.maybe" }),
    ).toBeInTheDocument();

    const cards = screen.getAllByTestId("karta-osoby");
    const anna = cards.find((card) => card.getAttribute("data-name") === "Anna Nowak");
    const ja = cards.find((card) => card.getAttribute("data-name") === "Ja Sam");
    const jan = cards.find((card) => card.getAttribute("data-name") === "Jan Kowalski");
    if (anna === undefined || ja === undefined || jan === undefined) {
      throw new Error("Brak karty osoby w składzie");
    }

    // Obecny ktoś inny: stanowisko, slug profilu i droga do rozmowy.
    expect(anna).toHaveAttribute("data-headline", "Analityk - NES");
    expect(anna).toHaveAttribute("data-slug", "anna-nowak");
    expect(within(anna).getByTestId("kontakt")).toHaveAttribute("data-user-id", NET_IDS.member);
    expect(anna).toHaveAttribute("data-meta", "brak");

    // Ja: podpis "to ja" zamiast przycisku wiadomości do siebie.
    expect(ja).toHaveAttribute("data-meta", "jest");
    expect(ja).toHaveTextContent("club.network.meeting.you");
    expect(ja).toHaveAttribute("data-actions", "brak");
    expect(within(ja).queryByTestId("kontakt")).not.toBeInTheDocument();

    // Grupa "może" jest przygaszona i BEZ akcji - to nie jest potwierdzenie.
    expect(jan).toHaveAttribute("data-class", "opacity-80");
    expect(jan).toHaveAttribute("data-actions", "brak");
  });
});

describe("ClubMeetingScreen - dane częściowe", () => {
  it("spotkanie całodniowe nie ma godzin ani zakresu godzin", async () => {
    given(eventViewRow({ all_day: true }));
    renderMeeting();

    await waitFor(() => expect(screen.getByText("club.network.meeting.when")).toBeInTheDocument());
    const when = whenText();
    expect(when).toContain("2026");
    expect(when).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it("spotkanie bez godziny końca pokazuje jeden termin, nie zakres", async () => {
    given(eventViewRow({ ends_at: null }));
    renderMeeting();

    await waitFor(() => expect(screen.getByText("club.network.meeting.when")).toBeInTheDocument());
    expect(whenText().match(/\d{1,2}:\d{2}/g) ?? []).toHaveLength(1);
  });

  it("bez miejsca, opisu, linku, rozmowy i limitu nie zostaje ani jedna pusta etykieta", async () => {
    given(
      eventViewRow({
        location: "   ",
        description_pl: "",
        description_en: "  ",
        meeting_url: "",
        thread_slug: null,
        capacity: null,
      }),
    );
    renderMeeting();

    await waitFor(() =>
      expect(screen.getByText(/club\.network\.meeting\.goingCount/)).toBeInTheDocument(),
    );
    expect(screen.queryByText("club.network.meeting.where")).not.toBeInTheDocument();
    expect(screen.queryByText(/club\.network\.meeting\.capacity/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /club\.network\.meeting\.join/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /club\.network\.meeting\.toThread/ }),
    ).not.toBeInTheDocument();
  });

  it("brak linku jako `null` też nie rysuje przycisku wejścia", async () => {
    given(eventViewRow({ meeting_url: null, location: null }));
    renderMeeting();

    await waitFor(() =>
      expect(screen.getByText(/club\.network\.meeting\.goingCount/)).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("link", { name: /club\.network\.meeting\.join/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("club.network.meeting.where")).not.toBeInTheDocument();
  });

  it("sama grupa BĘDĘ nie rysuje nagłówka grupy MOŻE, a odmowa nie stoi w żadnej", async () => {
    given(eventViewRow(), [
      eventAttendeeRow({ state: "going" }),
      eventAttendeeRow({
        user_id: NET_IDS.otherMember,
        display_name: "Jan Kowalski",
        state: "declined",
      }),
    ]);
    renderMeeting();

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 3, name: "club.calendar.rsvp.going" }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("heading", { level: 3, name: "club.calendar.rsvp.maybe" }),
    ).not.toBeInTheDocument();
    // Kto odmówił, nie jest na liście obecnych - lista mówi, kto BĘDZIE.
    expect(screen.getAllByTestId("karta-osoby")).toHaveLength(1);
    expect(screen.queryByText("Jan Kowalski")).not.toBeInTheDocument();
  });

  it("sama grupa MOŻE nie rysuje nagłówka grupy BĘDĘ", async () => {
    given(eventViewRow(), [eventAttendeeRow({ state: "maybe" })]);
    renderMeeting();

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 3, name: "club.calendar.rsvp.maybe" }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("heading", { level: 3, name: "club.calendar.rsvp.going" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("club.network.meeting.nobodyYet")).not.toBeInTheDocument();
  });
});

describe("ClubMeetingScreen - prawo do składu", () => {
  it("bez prawa do składu strona MÓWI o ukrytych nazwiskach i nie odpytuje RPC", async () => {
    given(eventViewRow({ going_count: 7 }));
    renderMeeting({ canSeeMembers: false });

    await waitFor(() =>
      expect(screen.getByText("club.network.meeting.namesHidden")).toBeInTheDocument(),
    );
    // To jest cały sens tego testu: "nikt nie potwierdził" byłoby kłamstwem
    // o pustym spotkaniu, a licznik siedmiu osób stoi obok jako dowód.
    expect(screen.queryByText("club.network.meeting.nobodyYet")).not.toBeInTheDocument();
    expect(screen.getByText(/club\.network\.meeting\.goingCount\(count=7\)/)).toBeInTheDocument();
    expect(networkApiMock.fetchClubEventAttendees).not.toHaveBeenCalled();
    expect(screen.queryByTestId("karta-osoby")).not.toBeInTheDocument();
  });

  it("z prawem do składu, ale przed odpowiedzią RPC, stoją szkielety miejsc", async () => {
    networkApiMock.fetchClubEvent.mockResolvedValue(eventViewRow());
    networkApiMock.fetchClubEventAttendees.mockImplementation(nigdy);
    renderMeeting({ canSeeMembers: true });

    // Najpierw musi dojechać samo spotkanie - inaczej `aria-busy` należy jeszcze
    // do szkieletu całej strony, a nie do miejsca po liście nazwisk.
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Trilog gazowy - przygotowanie stanowiska" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("generic", { busy: true }).children).toHaveLength(2);
    expect(screen.queryByText("club.network.meeting.nobodyYet")).not.toBeInTheDocument();
    expect(screen.queryByText("club.network.meeting.namesHidden")).not.toBeInTheDocument();
  });

  it("puste potwierdzenia przy prawie do składu to JEST puste spotkanie", async () => {
    given(eventViewRow({ going_count: 0 }), []);
    renderMeeting({ canSeeMembers: true });

    await waitFor(() =>
      expect(screen.getByText("club.network.meeting.nobodyYet")).toBeInTheDocument(),
    );
    expect(networkApiMock.fetchClubEventAttendees).toHaveBeenCalled();
    expect(screen.queryByText("club.network.meeting.namesHidden")).not.toBeInTheDocument();
  });
});

describe("ClubMeetingScreen - deklaracja obecności", () => {
  it("bez prawa odpowiedzi nie ma paska obecności", async () => {
    given(eventViewRow());
    renderMeeting({ canRsvp: false });

    await waitFor(() =>
      expect(screen.getByText(/club\.network\.meeting\.goingCount/)).toBeInTheDocument(),
    );
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("spotkanie z wyłączonym RSVP nie zbiera potwierdzeń", async () => {
    given(eventViewRow({ rsvp_enabled: false }));
    renderMeeting({ canRsvp: true });

    await waitFor(() =>
      expect(screen.getByText(/club\.network\.meeting\.goingCount/)).toBeInTheDocument(),
    );
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("spotkanie ODWOŁANE nosi znacznik i nie zbiera potwierdzeń", async () => {
    given(eventViewRow({ status: "cancelled" }));
    renderMeeting({ canRsvp: true });

    await waitFor(() =>
      expect(screen.getByText("club.calendar.status.cancelled")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("trzy stany obecności, mój zaznaczony, a wybór jedzie do warstwy danych", async () => {
    given(eventViewRow({ my_rsvp: "maybe" }));
    workspaceApiMock.setClubEventRsvp.mockResolvedValue(true);
    renderMeeting();

    await waitFor(() => expect(screen.getByRole("radiogroup")).toBeInTheDocument());
    const states = screen.getAllByRole("radio");
    expect(states).toHaveLength(3);
    expect(screen.getByRole("radio", { name: "club.calendar.rsvp.maybe" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: "club.calendar.rsvp.going" })).toHaveAttribute(
      "aria-checked",
      "false",
    );

    fireEvent.click(screen.getByRole("radio", { name: "club.calendar.rsvp.going" }));

    await waitFor(() =>
      expect(workspaceApiMock.setClubEventRsvp).toHaveBeenCalledWith(NET_IDS.event, "going"),
    );
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("odmowa zapisu obecności nie znika w ciszy", async () => {
    given(eventViewRow());
    workspaceApiMock.setClubEventRsvp.mockRejectedValue(new Error("42501"));
    renderMeeting();

    await waitFor(() => expect(screen.getByRole("radiogroup")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("radio", { name: "club.calendar.rsvp.declined" }));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("club.network.meeting.rsvpFailed"),
    );
    expect(workspaceApiMock.setClubEventRsvp).toHaveBeenCalledWith(NET_IDS.event, "declined");
  });

  it("w trakcie zapisu wszystkie trzy stany są zablokowane - jeden gest, jedna odpowiedź", async () => {
    given(eventViewRow());
    workspaceApiMock.setClubEventRsvp.mockImplementation(nigdy);
    renderMeeting();

    await waitFor(() => expect(screen.getByRole("radiogroup")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("radio", { name: "club.calendar.rsvp.going" }));

    await waitFor(() => {
      for (const state of screen.getAllByRole("radio")) expect(state).toBeDisabled();
    });
  });

  it("termin spotkania jedzie z drugiego języka, gdy polski tytuł jest pusty", async () => {
    given(eventViewRow({ title_pl: "   " }));
    renderMeeting();

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Gas trilogue - position prep" }),
      ).toBeInTheDocument(),
    );
  });
});
