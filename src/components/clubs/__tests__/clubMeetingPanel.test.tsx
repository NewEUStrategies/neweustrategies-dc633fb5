// Molekuła „Najbliższe spotkanie + kto będzie” (`ClubMeetingPanel`).
//
// CO TEN PLIK DOWODZI.
// (1) UKŁAD JEST HIERARCHIĄ, NIE LISTĄ: pełną kartę z twarzami i potwierdzeniem
//     dostaje TYLKO najbliższy termin, kolejne dwa - po jednej linijce. Czwarty
//     nie istnieje, bo panel nie jest drugim kalendarzem.
// (2) LISTA NAZWISK JEST PRZYWILEJEM, LICZBA - NIE. Klub ukrywający skład oddaje
//     zero wierszy uczestników, ale `going_count` jedzie dalej: panel pokazuje
//     wtedy samą liczbę i to jest POPRAWNY stan, a nie awaria. Zapytanie
//     o nazwiska w takim klubie nie leci wcale.
// (3) LICZNIK Z WIERSZA WYDARZENIA JEST ŹRÓDŁEM PRAWDY o liczbie - lista bywa
//     przycięta limitem, więc panel bierze `max(going_count, długość listy)`,
//     a dopisek „i N innych” liczy się od tej samej liczby.
// (4) TRZY STANY DANYCH: pełny termin, termin bez pól opcjonalnych (bez miejsca,
//     bez linku, bez potwierdzeń) i BRAK terminów. Ostatni znaczy dwie różne
//     rzeczy: dla czytelnika panel znika, dla kuratora zostaje z zaproszeniem do
//     dodania terminu - bo panel „nic nie ma” u kogoś, kto może to zmienić,
//     jest jedynym miejscem, w którym da się to zrobić z huba.
// (5) POTWIERDZENIE MA TRZY STANY („może” jest prawdziwą odpowiedzią), dojeżdża
//     do warstwy danych z identyfikatorem TEGO wydarzenia, a awaria nie ginie
//     w ciszy. Bez `canRsvp` i przy wyłączonym RSVP przełącznika nie ma wcale.
// (6) KURATOR ROBI WSZYSTKO Z SZYNY: dodaje, redaguje i usuwa. Formularz dostaje
//     KLUCZ zależny od trybu (`edytuj` po `dodaj` nie może pokazać pustych pól),
//     a usunięcie przechodzi przez potwierdzenie i mówi osobno o sukcesie
//     i o awarii.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// (a) `ClubEventForm` - pełny formularz terminu ma własny plik testowy
//     (`clubEventForm.test.tsx`); tutaj jest ATRAPĄ, bo przedmiotem dowodu jest
//     to, CO panel mu podaje (tryb, `pending`, wynik `onSubmit`).
// (b) Reguł czystych: `toEventKind`, `clubEventToneClass`, `pickLocalized` mają
//     własne testy.
// (c) Hooków `useClubEventAttendees` / `useUpsertClubEvent` / `useDeleteClubEvent`
//     / `useClubEventRsvp` (klucze cache, inwalidacja) - warstwa danych ma
//     własne testy; tu dowodzimy, że panel woła je z tym, co pokazuje.
// (d) Atomów `ClubFaceStack`, `ClubEventKindIcon` - użyte PRAWDZIWE, bo asercje
//     dotyczą tego, ile twarzy i jakich nazwisk panel im podał.
// (e) Formatu daty - `Intl` zależy od ICU, nie od produktu. Asercja o dacie
//     sprawdza WYŁĄCZNIE to, co jest decyzją produktu: czy w linijce jest
//     godzina (termin całodniowy jej nie ma).
//
// DETERMINIZM. Czas jest ZAMROŻONY na `NET_BASE_ISO` (`toFake: ["Date"]`),
// bo `formatDate` i wiersze fixture'ów liczą się od niego.
//
// RADIX POD HAPPY-DOM. `AlertDialog` nie działa bez pełnego pointer API, więc
// jest podmieniony na atrapę z kontekstem otwarcia - dokładnie jak w
// `clubInvitationInbox.test.tsx`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ClubEventRow, ClubEventUpsertInput } from "@/lib/clubs/workspaceTypes";
import type { ClubEventAttendeeRow } from "@/lib/clubs/networkTypes";

const h = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
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

// Formularz terminu: atrapa wypisuje TRYB (klucz), stan wysyłki i daje dwa
// przyciski - jeden zgłasza ładunek, drugi zamknięcie okna.
vi.mock("@/components/clubs/molecules/ClubEventForm", () => ({
  ClubEventForm: ({
    open,
    initial,
    pending,
    onOpenChange,
    onSubmit,
  }: {
    open: boolean;
    initial: ClubEventRow | null;
    pending: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (input: ClubEventUpsertInput) => void;
  }) => (
    <div
      data-testid="formularz"
      data-open={String(open)}
      data-tryb={initial === null ? "nowy" : initial.id}
      data-pending={String(pending)}
    >
      <button
        type="button"
        data-testid="formularz-zapisz"
        onClick={() => onSubmit({ id: initial?.id, title_pl: "Nowy termin" })}
      >
        zapisz
      </button>
      <button type="button" data-testid="formularz-zamknij" onClick={() => onOpenChange(false)}>
        zamknij
      </button>
    </div>
  ),
}));

vi.mock("@/components/ui/alert-dialog", async () => {
  const React = await import("react");
  const Ctx = React.createContext<{ open: boolean; close: () => void }>({
    open: false,
    close: () => undefined,
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
      <Ctx.Provider value={{ open: open === true, close: () => onOpenChange?.(false) }}>
        <div data-testid="potwierdzenie" data-open={String(open === true)}>
          {children}
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
        <button type="button" data-testid="potwierdzenie-anuluj" onClick={ctx.close}>
          {children}
        </button>
      );
    },
    AlertDialogAction: ({
      children,
      onClick,
      disabled,
    }: {
      children?: ReactNode;
      onClick?: () => void;
      disabled?: boolean;
    }) => (
      <button type="button" data-testid="potwierdzenie-tak" disabled={disabled} onClick={onClick}>
        {children}
      </button>
    ),
  };
});

import { ClubMeetingPanel } from "@/components/clubs/molecules/ClubMeetingPanel";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import {
  networkApiMock,
  resetNetworkApiMock,
  resetWorkspaceApiMock,
  workspaceApiMock,
} from "@/test/clubs/workspaceApiMock";
import { clubEventRow } from "@/test/clubs/hubFixtures";
import { CLUB_IDS } from "@/test/clubs/fixtures";
import {
  eventAttendeeRow,
  NET_BASE_ISO,
  NET_IDS,
  netIsoDays,
} from "@/test/clubs/networkScreenFixtures";

const SLUG = "klub-energetyczny";

/** Zapytanie, które NIGDY nie odpowiada - stan „w locie” bez sterowania czasem. */
function nigdy(): Promise<never> {
  return new Promise<never>(() => undefined);
}

/** Najbliższy termin: pełny wiersz z miejscem, linkiem i włączonym RSVP. */
function najblizszy(overrides: Partial<ClubEventRow> = {}): ClubEventRow {
  return clubEventRow({
    id: "event-1",
    slug: "trilog-gazowy",
    title_pl: "Trilog gazowy",
    title_en: "Gas trilogue",
    starts_at: netIsoDays(3),
    location: "Bruksela, Rue Belliard 40",
    meeting_url: "https://spotkanie.example/trilog",
    going_count: 7,
    ...overrides,
  });
}

function renderPanel(
  props: {
    events?: readonly ClubEventRow[];
    canSeeMembers?: boolean;
    canRsvp?: boolean;
    canManage?: boolean;
  } = {},
) {
  return renderWithQueryClient(
    <ClubMeetingPanel
      clubSlug={SLUG}
      clubId={CLUB_IDS.club}
      events={props.events ?? [najblizszy()]}
      canSeeMembers={props.canSeeMembers ?? true}
      canRsvp={props.canRsvp ?? true}
      canManage={props.canManage}
    />,
  );
}

/** Linijka daty najbliższego terminu - pierwszy akapit karty. */
function linijkaDaty(): string {
  const akapit = document.querySelector("section p");
  return akapit?.textContent ?? "";
}

beforeEach(() => {
  cleanup();
  resetNetworkApiMock();
  resetWorkspaceApiMock();
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  networkApiMock.fetchClubEventAttendees.mockResolvedValue([]);
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(NET_BASE_ISO) });
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Brak terminów
// ---------------------------------------------------------------------------

describe("ClubMeetingPanel - klub bez terminów", () => {
  it("czytelnikowi panel ZNIKA - pusty kalendarz w szynie nie niesie nic", () => {
    const { container } = renderPanel({ events: [] });
    expect(container).toBeEmptyDOMElement();
    // Bez wydarzenia nie ma o kogo pytać.
    expect(networkApiMock.fetchClubEventAttendees).not.toHaveBeenCalled();
  });

  it("kuratorowi panel ZOSTAJE i daje jedyną drogę do dodania terminu z huba", () => {
    renderPanel({ events: [], canManage: true });

    expect(screen.getByText("club.network.meeting.emptyManage")).toBeInTheDocument();
    expect(screen.queryByTestId("formularz")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /club\.eventForm\.createTitle/ }));
    const formularz = screen.getByTestId("formularz");
    expect(formularz).toHaveAttribute("data-tryb", "nowy");
    expect(formularz).toHaveAttribute("data-open", "true");

    fireEvent.click(screen.getByTestId("formularz-zamknij"));
    expect(screen.queryByTestId("formularz")).not.toBeInTheDocument();
  });

  it("zapis nowego terminu z pustego panelu wysyła ładunek i mówi o sukcesie", async () => {
    workspaceApiMock.upsertClubEvent.mockResolvedValue("event-nowy");
    renderPanel({ events: [], canManage: true });

    fireEvent.click(screen.getByRole("button", { name: /club\.eventForm\.createTitle/ }));
    fireEvent.click(screen.getByTestId("formularz-zapisz"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("club.eventForm.saved"));
    expect(workspaceApiMock.upsertClubEvent).toHaveBeenCalledWith(CLUB_IDS.club, {
      id: undefined,
      title_pl: "Nowy termin",
    });
    expect(screen.queryByTestId("formularz")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Najbliższy termin
// ---------------------------------------------------------------------------

describe("ClubMeetingPanel - karta najbliższego terminu", () => {
  it("tytuł prowadzi na STRONĘ TEGO spotkania, a „więcej” do kalendarza", async () => {
    renderPanel();

    expect(screen.getByRole("link", { name: "Trilog gazowy" })).toHaveAttribute(
      "href",
      `/club/${SLUG}/e/trilog-gazowy`,
    );
    expect(screen.getByRole("link", { name: "club.hub.more" })).toHaveAttribute(
      "href",
      `/club/${SLUG}/calendar`,
    );
    await waitFor(() => expect(networkApiMock.fetchClubEventAttendees).toHaveBeenCalled());
  });

  it("miejsce i link do rozmowy pokazują się, gdy są treścią - a nie gdy są kolumną", () => {
    const { unmount } = renderPanel();
    expect(screen.getByText("Bruksela, Rue Belliard 40")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /club\.network\.meeting\.join/ })).toHaveAttribute(
      "href",
      "https://spotkanie.example/trilog",
    );
    unmount();

    // Białe znaki to nie miejsce i nie link - baza oddaje je jako „coś”,
    // a interfejs musi je czytać jako pustkę.
    renderPanel({ events: [najblizszy({ location: "   ", meeting_url: "  " })] });
    expect(screen.queryByText(/Bruksela/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /club\.network\.meeting\.join/ }),
    ).not.toBeInTheDocument();
  });

  it("termin bez miejsca i bez linku (kolumny `null`) nie zostawia pustych wierszy", () => {
    renderPanel({ events: [najblizszy({ location: null, meeting_url: null })] });

    expect(screen.queryByText(/Bruksela/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /club\.network\.meeting\.join/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Trilog gazowy" })).toBeInTheDocument();
  });

  it("termin całodniowy NIE ma godziny, zwykły ją ma", () => {
    const { unmount } = renderPanel();
    expect(linijkaDaty()).toMatch(/\d{1,2}:\d{2}/);
    unmount();

    renderPanel({ events: [najblizszy({ all_day: true })] });
    expect(linijkaDaty()).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it("kolejne dwa terminy dostają po jednej linijce, a czwarty nie istnieje", () => {
    renderPanel({
      events: [
        najblizszy(),
        clubEventRow({ id: "event-2", slug: "drugi", title_pl: "Drugi" }),
        clubEventRow({ id: "event-3", slug: "trzeci", title_pl: "Trzeci" }),
        clubEventRow({ id: "event-4", slug: "czwarty", title_pl: "Czwarty" }),
      ],
    });

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Drugi" })).toHaveAttribute(
      "href",
      `/club/${SLUG}/e/drugi`,
    );
    expect(screen.queryByRole("link", { name: "Czwarty" })).not.toBeInTheDocument();
  });

  it("jeden termin w klubie nie rysuje listy „kolejnych”", () => {
    renderPanel();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Kto będzie
// ---------------------------------------------------------------------------

describe("ClubMeetingPanel - kto będzie", () => {
  it("nikt jeszcze nie potwierdził - panel mówi to wprost, zamiast pokazywać zero", async () => {
    renderPanel({ events: [najblizszy({ going_count: 0 })] });

    await waitFor(() =>
      expect(screen.getByText("club.network.meeting.nobodyYet")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/club\.network\.meeting\.goingCount/)).not.toBeInTheDocument();
  });

  it("klub ukrywający skład pokazuje SAMĄ LICZBĘ i nie pyta bazy o nazwiska", async () => {
    renderPanel({ canSeeMembers: false });

    await waitFor(() =>
      expect(screen.getByText("club.network.meeting.goingCount(count=7)")).toBeInTheDocument(),
    );
    // Niewysłane żądanie jest szybsze niż puste - RPC i tak oddałoby zero wierszy.
    expect(networkApiMock.fetchClubEventAttendees).not.toHaveBeenCalled();
    expect(screen.queryByText(/Anna Nowak/)).not.toBeInTheDocument();
  });

  it("zapytanie o nazwiska w locie zostawia liczbę z wiersza wydarzenia", async () => {
    networkApiMock.fetchClubEventAttendees.mockImplementation(nigdy);
    renderPanel();

    await waitFor(() =>
      expect(screen.getByText("club.network.meeting.goingCount(count=7)")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Anna Nowak/)).not.toBeInTheDocument();
  });

  it("liczba idzie z wiersza wydarzenia, a nazwiska z listy - dwa pierwsze wprost", async () => {
    const attendees: ClubEventAttendeeRow[] = [
      eventAttendeeRow({ user_id: NET_IDS.member, display_name: "Anna Nowak" }),
      eventAttendeeRow({ user_id: NET_IDS.otherMember, display_name: "Jan Kowalski" }),
      eventAttendeeRow({ user_id: "user-trzeci", display_name: "Ewa Wójcik" }),
      // „Nie przyjdę” nie jest obecnością - nie może wejść ani do twarzy, ani
      // do nazwisk.
      eventAttendeeRow({ user_id: "user-nie", display_name: "Piotr Nieobecny", state: "declined" }),
    ];
    networkApiMock.fetchClubEventAttendees.mockResolvedValue(attendees);
    renderPanel();

    // Stos twarzy dostał TRZY obecności, nie cztery wiersze (jego warstwa dla
    // czytnika ekranu wypisuje pełny skład rzędu).
    await waitFor(() =>
      expect(screen.getByText("Anna Nowak, Jan Kowalski, Ewa Wójcik")).toBeInTheDocument(),
    );
    expect(networkApiMock.fetchClubEventAttendees).toHaveBeenCalledWith("event-1", 12);
    expect(screen.getByText("club.network.meeting.goingCount(count=7)")).toBeInTheDocument();
    // Dwa nazwiska wprost, a 7 z wiersza wygrywa nad 3 z listy - więc dopisek
    // liczy PIĘĆ pozostałych, nie jedną.
    expect(
      screen.getByText(/^Anna Nowak, Jan Kowalski club\.network\.meeting\.andMore\(count=5\)$/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Piotr Nieobecny/)).not.toBeInTheDocument();
  });

  it("gdy lista jest DŁUŻSZA niż licznik, wygrywa lista - i wtedy nie ma dopisku", async () => {
    networkApiMock.fetchClubEventAttendees.mockResolvedValue([
      eventAttendeeRow({ user_id: NET_IDS.member, display_name: "Anna Nowak" }),
      eventAttendeeRow({ user_id: NET_IDS.otherMember, display_name: "Jan Kowalski" }),
    ]);
    renderPanel({ events: [najblizszy({ going_count: 0 })] });

    await waitFor(() =>
      expect(screen.getByText("club.network.meeting.goingCount(count=2)")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/club\.network\.meeting\.andMore/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Potwierdzenie obecności
// ---------------------------------------------------------------------------

describe("ClubMeetingPanel - RSVP", () => {
  it("trzy stany potwierdzenia, z zapamiętanym wyborem członka", () => {
    renderPanel({ events: [najblizszy({ my_rsvp: "maybe" })] });

    const grupa = screen.getByRole("radiogroup", { name: "club.network.meeting.rsvpLabel" });
    const stany = within(grupa).getAllByRole("radio");
    expect(stany.map((node) => node.textContent)).toEqual([
      "club.calendar.rsvp.going",
      "club.calendar.rsvp.maybe",
      "club.calendar.rsvp.declined",
    ]);
    expect(stany[1]).toHaveAttribute("aria-checked", "true");
    expect(stany[0]).toHaveAttribute("aria-checked", "false");
  });

  it("wybór dojeżdża do warstwy danych z identyfikatorem TEGO wydarzenia", async () => {
    workspaceApiMock.setClubEventRsvp.mockResolvedValue(true);
    renderPanel();

    fireEvent.click(screen.getByRole("radio", { name: "club.calendar.rsvp.declined" }));
    await waitFor(() =>
      expect(workspaceApiMock.setClubEventRsvp).toHaveBeenCalledWith("event-1", "declined"),
    );
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("awaria potwierdzenia nie ginie w ciszy", async () => {
    workspaceApiMock.setClubEventRsvp.mockRejectedValue(new Error("42501"));
    renderPanel();

    fireEvent.click(screen.getByRole("radio", { name: "club.calendar.rsvp.going" }));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("club.network.meeting.rsvpFailed"),
    );
  });

  it("potwierdzenie w locie blokuje wszystkie trzy przyciski", async () => {
    workspaceApiMock.setClubEventRsvp.mockImplementation(nigdy);
    renderPanel();

    fireEvent.click(screen.getByRole("radio", { name: "club.calendar.rsvp.going" }));
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "club.calendar.rsvp.going" })).toBeDisabled(),
    );
    for (const stan of screen.getAllByRole("radio")) expect(stan).toBeDisabled();
    expect(workspaceApiMock.setClubEventRsvp).toHaveBeenCalledTimes(1);
  });

  it("bez prawa do potwierdzania i przy wyłączonym RSVP przełącznika NIE MA", () => {
    const { unmount } = renderPanel({ canRsvp: false });
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    unmount();

    renderPanel({ events: [najblizszy({ rsvp_enabled: false })] });
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Kurator klubu
// ---------------------------------------------------------------------------

describe("ClubMeetingPanel - kurator", () => {
  it("bez `canManage` nie ma ani dodawania, ani redakcji, ani usuwania", () => {
    renderPanel();

    expect(
      screen.queryByRole("button", { name: /club\.eventForm\.createTitle/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("club.eventForm.edit")).not.toBeInTheDocument();
    expect(screen.queryByText("club.eventForm.delete")).not.toBeInTheDocument();
    // Okno potwierdzenia nie istnieje nawet zamknięte - nie ma czego potwierdzać.
    expect(screen.queryByTestId("potwierdzenie")).not.toBeInTheDocument();
  });

  it("„edytuj” podaje formularzowi TEN termin, a „dodaj” przestawia go na pusty", () => {
    renderPanel({ canManage: true });

    fireEvent.click(screen.getByRole("button", { name: /club\.eventForm\.edit/ }));
    expect(screen.getByTestId("formularz")).toHaveAttribute("data-tryb", "event-1");

    // Klucz formularza zależy od trybu: „dodaj” po „edytuj” nie może pokazać
    // wypełnionych pól poprzedniego terminu.
    fireEvent.click(screen.getByRole("button", { name: /club\.eventForm\.createTitle/ }));
    expect(screen.getByTestId("formularz")).toHaveAttribute("data-tryb", "nowy");
  });

  it("zapis redakcji niesie identyfikator terminu, a awaria nie zamyka okna", async () => {
    workspaceApiMock.upsertClubEvent.mockRejectedValue(new Error("42501"));
    renderPanel({ canManage: true });

    fireEvent.click(screen.getByRole("button", { name: /club\.eventForm\.edit/ }));
    fireEvent.click(screen.getByTestId("formularz-zapisz"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("club.eventForm.failed"));
    expect(workspaceApiMock.upsertClubEvent).toHaveBeenCalledWith(CLUB_IDS.club, {
      id: "event-1",
      title_pl: "Nowy termin",
    });
    // Okno zostaje otwarte - poprawka jest w nim, nie w pamięci użytkownika.
    expect(screen.getByTestId("formularz")).toBeInTheDocument();
  });

  it("zapis w locie dojeżdża do formularza jako `pending`", async () => {
    workspaceApiMock.upsertClubEvent.mockImplementation(nigdy);
    renderPanel({ canManage: true });

    fireEvent.click(screen.getByRole("button", { name: /club\.eventForm\.edit/ }));
    fireEvent.click(screen.getByTestId("formularz-zapisz"));
    await waitFor(() =>
      expect(screen.getByTestId("formularz")).toHaveAttribute("data-pending", "true"),
    );
  });

  it("usunięcie idzie przez potwierdzenie, mówi o sukcesie i zamyka okno", async () => {
    workspaceApiMock.deleteClubEvent.mockResolvedValue(true);
    renderPanel({ canManage: true });

    expect(screen.getByTestId("potwierdzenie")).toHaveAttribute("data-open", "false");
    fireEvent.click(screen.getByRole("button", { name: /club\.eventForm\.delete/ }));
    expect(screen.getByTestId("potwierdzenie-tresc")).toBeInTheDocument();
    // Pytanie nazywa termin, którego dotyczy.
    expect(screen.getByText("club.eventForm.deleteLead(title=Trilog gazowy)")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("potwierdzenie-tak"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("club.eventForm.deleted"));
    expect(workspaceApiMock.deleteClubEvent.mock.calls.at(-1)?.[0]).toBe("event-1");
    expect(screen.queryByTestId("potwierdzenie-tresc")).not.toBeInTheDocument();
  });

  it("awaria usunięcia zostawia okno otwarte i mówi o niepowodzeniu", async () => {
    workspaceApiMock.deleteClubEvent.mockRejectedValue(new Error("42501"));
    renderPanel({ canManage: true });

    fireEvent.click(screen.getByRole("button", { name: /club\.eventForm\.delete/ }));
    fireEvent.click(screen.getByTestId("potwierdzenie-tak"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("club.eventForm.failed"));
    expect(screen.getByTestId("potwierdzenie-tresc")).toBeInTheDocument();
  });

  it("usuwanie w locie blokuje przycisk potwierdzenia", async () => {
    workspaceApiMock.deleteClubEvent.mockImplementation(nigdy);
    renderPanel({ canManage: true });

    fireEvent.click(screen.getByRole("button", { name: /club\.eventForm\.delete/ }));
    fireEvent.click(screen.getByTestId("potwierdzenie-tak"));
    await waitFor(() => expect(screen.getByTestId("potwierdzenie-tak")).toBeDisabled());
    expect(workspaceApiMock.deleteClubEvent).toHaveBeenCalledTimes(1);
  });

  it("rezygnacja z usunięcia zamyka okno bez ruszania bazy", () => {
    renderPanel({ canManage: true });

    fireEvent.click(screen.getByRole("button", { name: /club\.eventForm\.delete/ }));
    fireEvent.click(screen.getByTestId("potwierdzenie-anuluj"));

    expect(screen.queryByTestId("potwierdzenie-tresc")).not.toBeInTheDocument();
    expect(workspaceApiMock.deleteClubEvent).not.toHaveBeenCalled();
  });
});
