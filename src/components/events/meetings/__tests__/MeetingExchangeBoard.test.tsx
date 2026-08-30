// PŁASZCZYZNA UCZESTNIKA giełdy 1-1 - organizm, który decyduje, CZY i JAKI
// ekran uczestnik w ogóle zobaczy.
//
// CO TEN PLIK DOWODZI I DLACZEGO TO WAŻNE:
//
//  1. BLOKADY SĄ STOPNIOWANE, A NIE BINARNE. Każdy powód, dla którego nie da
//     się umawiać rozmów, ma INNE następne działanie: „giełda nieskonfigurowana"
//     - czekaj, „nie jesteś zapisany" - zapisz się, „zapisy zamknięte" - zgłoś
//     dostępność już teraz. Jeden komunikat „brak dostępu" kasowałby te różnice
//     i generował pytania do organizatora. To jest jedyne miejsce, w którym
//     ta gradacja jest rozstrzygana.
//
//  2. PRZY ZAMKNIĘTYCH ZAPISACH EKRAN NADAL DZIAŁA. Deklaracja dostępności
//     jest warunkiem WSTĘPNYM giełdy, nie jej częścią - organizator otwiera
//     zaproszenia na tydzień przed kongresem, a terminarz uczestnik układa
//     wcześniej. Blokada `closed` wycisza zaproszenia, ale nie ma prawa
//     zabrać okien dostępności.
//
//  3. BRAK ZAPISU TO BRAK `registration_id`, CZYLI BRAK CZEGOKOLWIEK DO
//     POKAZANIA. Ani okno dostępności, ani lista spotkań nie mają wtedy do
//     czego się przypiąć - zakładki muszą być NIEZAMONTOWANE, a nie puste.
//
//  4. `null` W LIMICIE ZAPROSZEŃ ZNACZY „BRAK LIMITU", A ZERO - „LIMIT
//     WYCZERPANY". Sklejenie ich jest różnicą między „wysyłaj dalej"
//     a „nie wyślesz już nic"; RPC celowo oddaje tam SQL-owy NULL.
//
//  5. ODMOWA ODCZYTU STANU NIE JEST PUSTĄ GIEŁDĄ. `not_registered` z bazy
//     musi dojść jako SWOJE zdanie - pusty ekran mówiłby „nikt się tu nie
//     umawia", czyli nieprawdę o wydarzeniu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Trzech paneli-dzieci (`MyMeetingsPanel`,
// `ParticipantDirectoryPanel`, `MyAvailabilityPanel`) i strony błędu - mają
// własne pliki testowe; tutaj są atrapami, bo przedmiotem dowodu jest to,
// KTÓRY z nich jest zamontowany i Z CZYM. Nie dubluje też parsera
// `parseMeetingExchange` ani tabeli `exchangeBlock` (`meetingExchange.test.ts`) -
// oba są tu PRAWDZIWE, żeby test przechodził przez ten sam `select`, co produkcja.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import { axeViolations, summarize } from "@/test/axe";
import type { Json } from "@/integrations/supabase/types";

const h = vi.hoisted(() => ({
  exchange: vi.fn(),
  meetings: vi.fn(),
  /** Propsy, z jakimi organizm zamontował panele-dzieci. */
  moje: { mounted: false, rows: 0, timezone: "" },
  katalog: { mounted: false, timezone: "" },
  dostepnosc: { mounted: false, canEdit: false, okien: 0, timezone: "" },
  blad: { mounted: false, title: "", footer: "" },
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("@/components/ui/tabs", async () =>
  (await import("@/test/reactStubs")).radixTabsStub(await import("react")),
);

vi.mock("@/components/events/meetings/MyMeetingsPanel", () => ({
  MyMeetingsPanel: ({ rows, timezone }: { rows: unknown[]; timezone: string }) => {
    h.moje.mounted = true;
    h.moje.rows = rows.length;
    h.moje.timezone = timezone;
    return <div>atrapa-moje-spotkania</div>;
  },
}));

vi.mock("@/components/events/meetings/ParticipantDirectoryPanel", () => ({
  ParticipantDirectoryPanel: ({
    timezone,
    onOpenMeetings,
  }: {
    timezone: string;
    onOpenMeetings: () => void;
  }) => {
    h.katalog.mounted = true;
    h.katalog.timezone = timezone;
    return (
      <div>
        atrapa-katalog
        <button type="button" onClick={onOpenMeetings}>
          atrapa-wroc-do-spotkan
        </button>
      </div>
    );
  },
}));

vi.mock("@/components/events/meetings/MyAvailabilityPanel", () => ({
  MyAvailabilityPanel: ({
    canEdit,
    windows,
    timezone,
  }: {
    canEdit: boolean;
    windows: unknown[];
    timezone: string;
  }) => {
    h.dostepnosc.mounted = true;
    h.dostepnosc.canEdit = canEdit;
    h.dostepnosc.okien = windows.length;
    h.dostepnosc.timezone = timezone;
    return <div>atrapa-dostepnosc</div>;
  },
}));

// Strona błędu ma własne testy; tu liczy się WYŁĄCZNIE to, że organizm oddaje
// jej klucz odmowy, a nie surowy komunikat z bazy.
vi.mock("@/components/error/FriendlyErrorPage", () => ({
  FriendlyErrorPage: ({ title, footer }: { title: string; footer: string }) => {
    h.blad.mounted = true;
    h.blad.title = title;
    h.blad.footer = footer;
    return (
      <div role="alert">
        <h1>{title}</h1>
        <p>{footer}</p>
      </div>
    );
  },
}));

vi.mock("@/lib/events/meetingsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/meetingsApi")>()),
  fetchMeetingExchange: (input: unknown) => h.exchange(input),
  fetchMyMeetings: (input: unknown) => h.meetings(input),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: () => Promise.resolve({ data: null, error: null }) },
}));

const { MeetingExchangeBoard } = await import("@/components/events/meetings/MeetingExchangeBoard");

const SLUG = "kongres-2026";
const BAZA = "eventMeetings.participant";

/**
 * Odpowiedź `event_meeting_exchange`. Kształt jest SUROWY (snake_case) -
 * dokładnie taki, jaki dostaje `parseMeetingExchange`. Fixture w camelCase
 * udawałby, że parser już zadziałał, i przepuściłby zmianę nazwy pola w SQL-u.
 *
 * Domyślnie: giełda skonfigurowana, włączona, otwarta, uczestnik zapisany
 * i uprawniony - czyli stan BEZ blokady, z którego każdy test odejmuje jedną
 * rzecz naraz.
 */
function stan(over: Record<string, Json> = {}): Json {
  return {
    event_id: "e-1",
    configured: true,
    is_enabled: true,
    visibility: "everyone",
    open_now: true,
    slot_minutes: 20,
    break_minutes: 5,
    day_start_time: "09:00",
    day_end_time: "17:00",
    meeting_days: ["2026-09-14"],
    timezone: "Europe/Warsaw",
    invites_open_at: null,
    invites_close_at: null,
    intro_pl: "Zapraszamy na rozmowy 1-1.",
    intro_en: "Join our 1-1 meetings.",
    invite_expires_after_hours: 48,
    max_invites_per_person: 10,
    max_meetings_per_day: 6,
    my_registration_id: "reg-1",
    can_meet: true,
    invites_used: 3,
    invites_left: 7,
    tables_count: 4,
    my_availability: [
      {
        id: "w-1",
        starts_at: "2026-09-14T07:30:00.000Z",
        ends_at: "2026-09-14T11:00:00.000Z",
        is_open: true,
        note: null,
      },
    ],
    my_meetings_summary: { incoming_pending: 2, outgoing_pending: 1, accepted: 5, held: 3 },
    ...over,
  };
}

function renderBoard(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
    queryClient,
  };
}

function board() {
  return renderBoard(<MeetingExchangeBoard slug={SLUG} />);
}

/** Czeka na pierwszy render po odczycie stanu giełdy. */
async function poOdczycie(): Promise<void> {
  await screen.findByText(`${BAZA}.heading`);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.exchange.mockResolvedValue(stan());
  h.meetings.mockResolvedValue([]);
  h.moje.mounted = false;
  h.katalog.mounted = false;
  h.dostepnosc.mounted = false;
  h.blad.mounted = false;
});

describe("MeetingExchangeBoard - trzy stany wejściowe", () => {
  it("czekanie na stan giełdy pokazuje szkielet OPISANY jako zajęty", async () => {
    h.exchange.mockReturnValue(new Promise(() => undefined));
    const { container } = board();
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeTruthy());
    expect(screen.queryByText(`${BAZA}.heading`)).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("ODMOWA odczytu stanu oddaje SWÓJ klucz stronie błędu, a nie pustą giełdę", async () => {
    // Pusty ekran mówiłby „nikt się tu nie umawia", czyli nieprawdę
    // o wydarzeniu. `not_registered` prowadzi do zapisu, a nie do czekania.
    h.exchange.mockRejectedValue(
      new Error("not_registered: only a participant of this event can use the meeting exchange"),
    );
    board();
    await waitFor(() => expect(h.blad.mounted).toBe(true));
    expect(h.blad.footer).toBe("eventMeetings.errors.not_registered");
    expect(h.blad.title).toBe(`${BAZA}.heading`);
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("odmowa, której słownik NIE ZNA, degraduje do zdania ogólnego", async () => {
    h.exchange.mockRejectedValue(new Error("Failed to fetch"));
    board();
    await waitFor(() => expect(h.blad.mounted).toBe(true));
    expect(h.blad.footer).toBe("eventMeetings.errors.unknown");
  });

  it("odczytany stan montuje nagłówek i podsumowanie", async () => {
    board();
    await poOdczycie();
    expect(h.exchange).toHaveBeenCalledWith({ eventSlug: SLUG });
    expect(screen.getByRole("tablist")).toBeTruthy();
  });
});

describe("MeetingExchangeBoard - blokady są stopniowane, nie binarne", () => {
  it.each([
    ["giełda w ogóle nieskonfigurowana", { configured: false }, "notConfigured"],
    ["giełda wyłączona przełącznikiem", { is_enabled: false }, "disabled"],
    ["reguła widoczności ustawiona na `disabled`", { visibility: "disabled" }, "disabled"],
    ["uczestnik NIEZAPISANY na wydarzenie", { my_registration_id: null }, "notRegistered"],
    ["grupa uczestnika nie umawia rozmów", { can_meet: false }, "notAllowed"],
    ["zapisy chwilowo zamknięte", { open_now: false }, "closed"],
  ])("%s ma własne zdanie", async (_opis, nadpisanie, klucz) => {
    h.exchange.mockResolvedValue(stan(nadpisanie as Record<string, Json>));
    board();
    await poOdczycie();
    expect(screen.getByText(`${BAZA}.blocks.${klucz}`)).toBeTruthy();
  });

  it("stan BEZ blokady nie pokazuje żadnego komunikatu blokującego", async () => {
    board();
    await poOdczycie();
    expect(screen.queryByText(new RegExp(`${BAZA}\\.blocks\\.`))).toBeNull();
  });

  it("BRAK ZAPISU nie montuje ani zakładek, ani podsumowania", async () => {
    // Bez `registration_id` baza nie wie, czyje to spotkania - pusta zakładka
    // „Moje spotkania" udawałaby, że uczestnik po prostu nikogo nie zaprosił.
    h.exchange.mockResolvedValue(stan({ my_registration_id: null }));
    board();
    await poOdczycie();

    expect(screen.getByText(`${BAZA}.blocks.notRegistered`)).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(h.moje.mounted).toBe(false);
    expect(h.dostepnosc.mounted).toBe(false);
  });
});

describe("MeetingExchangeBoard - zapytania puszczane mimo blokady", () => {
  it.fails("DEFEKT: lista spotkań jest odpytywana także dla osoby NIEZAPISANEJ", async () => {
    // `useMyMeetings(slug)` stoi obok `useMeetingExchange(slug)` i rusza
    // BEZWARUNKOWO - decyzja „czy ten człowiek w ogóle ma tu spotkania"
    // zapada dopiero z odpowiedzi PIERWSZEGO zapytania, a drugie już poszło.
    // Dla gościa bez zapisu `event_meetings_mine` odmawia z `not_registered`
    // (migracja `20260823190000_event_meetings.sql`), więc każde wejście na
    // adres giełdy przez osobę spoza wydarzenia to jedno RPC z góry skazane
    // na odmowę - a odmowa jest połykana przez `meetings.data ?? []`,
    // czyli nie widać jej ani na ekranie, ani w kodzie wywołującym.
    //
    // Ekran i tak nie montuje wtedy zakładki „Moje spotkania", więc odpowiedź
    // nie jest do niczego potrzebna. Bramka `enabled` po `myRegistrationId`
    // (albo odroczenie hooka za `registered`) kosztowałaby jedną linijkę.
    h.exchange.mockResolvedValue(stan({ my_registration_id: null }));
    h.meetings.mockRejectedValue(
      new Error("not_registered: only a participant of this event has meetings here"),
    );
    board();
    await poOdczycie();

    expect(screen.queryByRole("tablist")).toBeNull();
    expect(h.meetings).not.toHaveBeenCalled();
  });
});

describe("MeetingExchangeBoard - zamknięte zapisy nie zamykają ekranu", () => {
  it("KOLIZJA: przy zamkniętych zapisach okna dostępności NADAL są edytowalne", async () => {
    // To nie jest niedopatrzenie, tylko reguła: terminarz układa się PRZED
    // otwarciem zaproszeń. Gdyby `closed` blokowało też ten ekran, uczestnik
    // dostawałby zaproszenia na terminy, których nie zdążył zadeklarować -
    // i każde odbijałoby się o `invitee_unavailable`.
    h.exchange.mockResolvedValue(stan({ open_now: false }));
    board();
    await poOdczycie();

    expect(screen.getByText(`${BAZA}.blocks.closed`)).toBeTruthy();
    fireEvent.click(screen.getByText(`${BAZA}.tabs.availability`));
    expect(h.dostepnosc.mounted).toBe(true);
    expect(h.dostepnosc.canEdit).toBe(true);
  });

  it("giełda WYŁĄCZONA odbiera prawo edycji okien, choć ekran zostaje", async () => {
    h.exchange.mockResolvedValue(stan({ is_enabled: false }));
    board();
    await poOdczycie();

    fireEvent.click(screen.getByText(`${BAZA}.tabs.availability`));
    expect(h.dostepnosc.mounted).toBe(true);
    expect(h.dostepnosc.canEdit).toBe(false);
  });

  it("grupa BEZ prawa do rozmów też traci edycję okien, a nie widok", async () => {
    h.exchange.mockResolvedValue(stan({ can_meet: false }));
    board();
    await poOdczycie();

    fireEvent.click(screen.getByText(`${BAZA}.tabs.availability`));
    expect(h.dostepnosc.mounted).toBe(true);
    expect(h.dostepnosc.canEdit).toBe(false);
    expect(h.dostepnosc.okien).toBe(1);
  });

  it("okno bez identyfikatora nie dojeżdża do panelu dostępności", async () => {
    h.exchange.mockResolvedValue(
      stan({
        my_availability: [
          { starts_at: "2026-09-14T07:30:00.000Z", ends_at: "2026-09-14T11:00:00.000Z" },
          {
            id: "w-2",
            starts_at: "2026-09-14T12:00:00.000Z",
            ends_at: "2026-09-14T14:00:00.000Z",
            is_open: false,
            note: "Panel",
          },
        ],
      }),
    );
    board();
    await poOdczycie();
    fireEvent.click(screen.getByText(`${BAZA}.tabs.availability`));
    expect(h.dostepnosc.okien).toBe(1);
  });
});

describe("MeetingExchangeBoard - odznaki nagłówka", () => {
  it("komplet parametrów giełdy jedzie do odznak z liczbami", async () => {
    board();
    await poOdczycie();

    expect(screen.getByText(`${BAZA}.badges.slot(count=20)`)).toBeTruthy();
    expect(screen.getByText(`${BAZA}.badges.tables(count=4)`)).toBeTruthy();
    expect(screen.getByText(`${BAZA}.badges.timezone(zone=Europe/Warsaw)`)).toBeTruthy();
    expect(screen.getByText(`${BAZA}.badges.expiry(count=48)`)).toBeTruthy();
    expect(screen.getByText("eventMeetings.hints.invitesLeft(count=7)")).toBeTruthy();
    expect(screen.getByText("eventMeetings.hints.dailyLimit(count=6)")).toBeTruthy();
  });

  it("KOLIZJA: `null` znaczy BRAK LIMITU i nie rysuje odznaki wcale", async () => {
    // Odznaka „pozostało 0 zaproszeń" przy braku limitu zatrzymałaby uczestnika,
    // który może wysyłać dalej. To jest różnica między dwiema decyzjami.
    h.exchange.mockResolvedValue(
      stan({
        slot_minutes: null,
        invite_expires_after_hours: null,
        invites_left: null,
        max_meetings_per_day: null,
      }),
    );
    board();
    await poOdczycie();

    expect(screen.queryByText(new RegExp(`${BAZA}\\.badges\\.slot`))).toBeNull();
    expect(screen.queryByText(new RegExp(`${BAZA}\\.badges\\.expiry`))).toBeNull();
    expect(screen.queryByText(/hints\.invitesLeft/)).toBeNull();
    expect(screen.queryByText(/hints\.dailyLimit/)).toBeNull();
    // Liczba stolików i strefa nie są opcjonalne - są zawsze.
    expect(screen.getByText(`${BAZA}.badges.tables(count=4)`)).toBeTruthy();
    expect(screen.getByText(`${BAZA}.badges.timezone(zone=Europe/Warsaw)`)).toBeTruthy();
  });

  it("ZERO pozostałych zaproszeń MA odznakę - limit wyczerpany to nie brak limitu", async () => {
    h.exchange.mockResolvedValue(stan({ invites_left: 0 }));
    board();
    await poOdczycie();
    expect(screen.getByText("eventMeetings.hints.invitesLeft(count=0)")).toBeTruthy();
  });

  it("BRAK strefy w bazie degraduje do strefy domyślnej, a nie do pustej odznaki", async () => {
    h.exchange.mockResolvedValue(stan({ timezone: null }));
    board();
    await poOdczycie();
    expect(screen.getByText(`${BAZA}.badges.timezone(zone=Europe/Warsaw)`)).toBeTruthy();
  });

  it("strefa, której `Intl` nie zna, też degraduje - a nie opisuje godziny nieistniejącą nazwą", async () => {
    h.exchange.mockResolvedValue(stan({ timezone: "Europe/Nowhere" }));
    board();
    await poOdczycie();
    expect(screen.getByText(`${BAZA}.badges.timezone(zone=Europe/Warsaw)`)).toBeTruthy();
  });
});

describe("MeetingExchangeBoard - wstęp i podsumowanie", () => {
  it("wstęp w języku interfejsu trafia nad zakładki", async () => {
    board();
    await poOdczycie();
    expect(screen.getByText("Zapraszamy na rozmowy 1-1.")).toBeTruthy();
  });

  it("PUSTY wstęp w języku interfejsu degraduje do drugiego języka, a nie do pustki", async () => {
    h.exchange.mockResolvedValue(stan({ intro_pl: "   " }));
    board();
    await poOdczycie();
    expect(screen.getByText("Join our 1-1 meetings.")).toBeTruthy();
  });

  it("brak wstępu w OBU językach nie zostawia pustego akapitu", async () => {
    h.exchange.mockResolvedValue(stan({ intro_pl: "", intro_en: "" }));
    const { container } = board();
    await poOdczycie();
    const puste = Array.from(container.querySelectorAll("p")).filter(
      (node) => (node.textContent ?? "").trim() === "",
    );
    expect(puste.length).toBe(0);
  });

  it("cztery liczby podsumowania są wypisane osobno, a nie zsumowane", async () => {
    board();
    await poOdczycie();
    for (const klucz of ["incoming", "outgoing", "accepted", "held"]) {
      expect(screen.getByText(`${BAZA}.summary.${klucz}`)).toBeTruthy();
    }
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("brak podsumowania w odpowiedzi degraduje do zer, a nie do wysypanego ekranu", async () => {
    h.exchange.mockResolvedValue(stan({ my_meetings_summary: null }));
    board();
    await poOdczycie();
    expect(screen.getAllByText("0").length).toBe(4);
  });
});

describe("MeetingExchangeBoard - zakładki", () => {
  it("domyślnie stoi na „Moje spotkania” i montuje TYLKO ten panel", async () => {
    h.meetings.mockResolvedValue([{ id: "m-1" }, { id: "m-2" }]);
    board();
    await poOdczycie();

    await waitFor(() => expect(h.moje.mounted).toBe(true));
    expect(h.moje.rows).toBe(2);
    expect(h.moje.timezone).toBe("Europe/Warsaw");
    expect(h.katalog.mounted).toBe(false);
    expect(h.dostepnosc.mounted).toBe(false);
  });

  it("lista spotkań ma własny szkielet, zanim dojedzie", async () => {
    h.meetings.mockReturnValue(new Promise(() => undefined));
    board();
    await poOdczycie();
    expect(h.moje.mounted).toBe(false);
    expect(screen.queryByText("atrapa-moje-spotkania")).toBeNull();
  });

  it("ODMOWA listy spotkań nie wysadza ekranu - panel dostaje pustą listę", async () => {
    // Stan giełdy i lista spotkań to dwa różne zapytania; padnięcie drugiego
    // nie może zabrać nagłówka, odznak i zakładki dostępności.
    h.meetings.mockRejectedValue(new Error("not_registered: ..."));
    board();
    await poOdczycie();

    await waitFor(() => expect(h.moje.mounted).toBe(true));
    expect(h.moje.rows).toBe(0);
    expect(screen.getByRole("tablist")).toBeTruthy();
  });

  it("katalog uczestników montuje się dopiero po wejściu na jego zakładkę", async () => {
    board();
    await poOdczycie();
    expect(h.katalog.mounted).toBe(false);

    fireEvent.click(screen.getByText(`${BAZA}.tabs.directory`));
    expect(h.katalog.mounted).toBe(true);
    expect(h.katalog.timezone).toBe("Europe/Warsaw");
  });

  it("„Zobacz moje spotkania” z katalogu WRACA na zakładkę spotkań", async () => {
    // Zakładka jest STANEM właśnie po to: po wysłaniu zaproszenia katalog musi
    // mieć dokąd odesłać uczestnika, inaczej przycisk nie prowadzi donikąd.
    board();
    await poOdczycie();

    fireEvent.click(screen.getByText(`${BAZA}.tabs.directory`));
    fireEvent.click(screen.getByText("atrapa-wroc-do-spotkan"));

    await waitFor(() => expect(screen.getByText("atrapa-moje-spotkania")).toBeTruthy());
    expect(screen.queryByText("atrapa-katalog")).toBeNull();
  });

  it("zakładka dostępności niesie podpowiedź o braku kontaktu", async () => {
    board();
    await poOdczycie();
    fireEvent.click(screen.getByText(`${BAZA}.tabs.availability`));
    expect(screen.getByText("eventMeetings.hints.noContact")).toBeTruthy();
  });
});

describe("MeetingExchangeBoard - dostępność", () => {
  it("pełny ekran giełdy nie ma naruszeń axe", async () => {
    const { container } = board();
    await poOdczycie();
    await waitFor(() => expect(h.moje.mounted).toBe(true));
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("ekran z blokadą i bez zakładek też nie ma naruszeń axe", async () => {
    h.exchange.mockResolvedValue(stan({ my_registration_id: null, configured: false }));
    const { container } = board();
    await poOdczycie();
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("szkielet ładowania też nie ma naruszeń axe", async () => {
    h.exchange.mockReturnValue(new Promise(() => undefined));
    const { container } = board();
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeTruthy());
    // Przebieg axe trwa setki milisekund, w trakcie których react-query zdąży
    // powiadomić subskrybentów o wejściu w `fetching`. Bez wypchnięcia tej
    // aktualizacji PRZED pomiarem React zgłasza ją jako zmianę poza `act`.
    await act(async () => {
      await Promise.resolve();
    });
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
