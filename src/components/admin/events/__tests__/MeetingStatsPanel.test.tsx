// Organizm „STATYSTYKI GIEŁDY 1-1" - jedyny ekran, z którego organizator
// odczytuje, czy giełda żyje, czy się zmieści i kto na niej zostaje sam.
//
// CO TEN PLIK DOWODZI I DLACZEGO TO WAŻNE:
//
//  1. BRAK PODSTAWY TO KRESKA, NIE ZERO PROCENT. `acceptance_rate = null`
//     znaczy „nikt jeszcze nie odpowiedział". Wydrukowane tam „0%" mówi
//     organizatorowi, że WSZYSCY odmówili - i każe ratować giełdę, która
//     dopiero wystartowała. To jest różnica między dwiema decyzjami, a nie
//     kosmetyka liczby.
//
//  2. OBCIĄŻENIE STOLIKA BEZ SIATKI SLOTÓW NIE JEST ZEREM. `slots_capacity = 0`
//     znaczy „nie ma czym dzielić" (giełda bez dni albo bez długości slotu),
//     więc wiersz mówi to wprost zamiast pokazywać „0 z 0" i sugerować pusty,
//     gotowy stolik.
//
//  3. STOLIK ZAJĘTY DO KOŃCA I MIEJSCE POZA POJEMNOŚCIĄ TO TEN SAM EKRAN.
//     Setka procent przy stoliku jest jedynym uprzedzeniem organizatora, że
//     następne `admin_event_meeting_arrange` odbije się o `no_free_table`
//     albo `table_seat_out_of_range` - a odmowa przychodzi dopiero po
//     kliknięciu w cudzym oknie.
//
//  4. ODWOŁANIE SPOTKANIA PO AKCEPTACJI ZWALNIA MIEJSCE, A EKRAN MA TO
//     POKAZAĆ. Ograniczenie `event_meetings_table_no_overlap` jest CZĘŚCIOWE
//     po statusie, więc `cancelled` naprawdę oddaje miejsce następnej parze
//     (harness `60_meetings.sql`, sekcja „ODWOLANIE ZWALNIA TERMIN").
//     Statystyki, które po odwołaniu nadal pokazują stolik jako pełny, kłamią
//     o przepustowości - dlatego dowodzimy, że wspólna gałąź unieważnienia
//     naprawdę przeciąga tę liczbę przez ekran.
//
//  5. TRZY LISTY MAJĄ TRZY STANY PUSTE, I „PUSTO" ≠ „NIE UDAŁO SIĘ".
//     Brak stolików, brak dni i brak samotnych uczestników to trzy różne
//     zdania; wspólne „brak danych" kasowałoby informację, że zerowa lista
//     samotnych jest DOBRĄ wiadomością, a zerowa lista stolików - złą.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Parsera `jsonb` -> model
// (`meetingsStats.test.ts`). (2) Mapowania odmów bazy
// (`adminMeetingErrors.test.ts`) - tutaj jest atrapą, bo przedmiotem dowodu
// jest to, że panel W OGÓLE przez nie przechodzi zamiast pokazać surowy
// wyjątek. (3) Kafelka metryki i sekcji formularza - to molekuły panelu.
//
// Hooki są PRAWDZIWE (`useMeetingStats` razem z `select`), atrapą jest wyłącznie
// warstwa sieciowa - inaczej test nie dotknąłby ani bramki `enabled`, ani
// wspólnej gałęzi unieważnienia.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import { axeViolations, summarize } from "@/test/axe";
import { formatNumber } from "@/lib/i18n/format";
import type { Json } from "@/integrations/supabase/types";

const h = vi.hoisted(() => ({
  stats: vi.fn(),
  setStatus: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

// Mapper odmów ma własny plik testowy; tutaj interesuje nas WYŁĄCZNIE to, że
// panel przez niego przechodzi, a nie jak brzmi zdanie.
vi.mock("@/lib/events/adminMeetingErrors", () => ({
  adminMeetingFailure: (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    return { key: `adminEventMeetings.errors.${message.split(":")[0]}`, params: {} };
  },
}));

vi.mock("@/lib/events/meetingsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/meetingsApi")>()),
  fetchMeetingStats: (eventId: string) => h.stats(eventId),
  setMeetingStatus: (input: unknown) => h.setStatus(input),
}));

// Klient Supabase nie ma w teście adresu ani sesji; żadna warstwa nie ma prawa
// tu dojść, ale gdyby doszła - ma się o czym odbić, a nie wyjść do sieci.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: () => Promise.resolve({ data: null, error: null }) },
}));

const { MeetingStatsPanel } = await import("@/components/admin/events/organisms/MeetingStatsPanel");
const { useSetMeetingStatus } = await import("@/lib/events/useMeetings");

const WYDARZENIE = "11111111-1111-4111-8111-111111111111";
const BAZA = "adminEventMeetings.stats";

/** Liczba tak, jak wypisze ją panel - stub i18n trzyma język na `pl`. */
function pl(value: number): string {
  return formatNumber(value, "pl");
}

/**
 * Odpowiedź `admin_event_meeting_stats`. RPC oddaje `jsonb`, więc kształt jest
 * SUROWY (snake_case) - dokładnie taki, jaki dostaje `parseMeetingStats`.
 * Fixture w camelCase udawałby, że parser już zadziałał, i przepuściłby zmianę
 * nazwy pola w SQL-u bez jednego czerwonego testu.
 */
function statystyki(over: Record<string, Json> = {}): Json {
  return {
    total: 12,
    invited: 3,
    expired: 1,
    accepted: 6,
    declined: 2,
    cancelled: 1,
    rescheduled: 0,
    held: 4,
    no_show: 1,
    confirmed: 6,
    acceptance_rate: 75,
    attendance_rate: 80,
    grid_slots: 16,
    seats_count: 4,
    timezone: "Europe/Warsaw",
    participants_count: 40,
    with_availability_count: 30,
    without_availability_count: 10,
    with_meeting_count: 34,
    without_meeting_count: 6,
    tables: [],
    by_day: [],
    without_meeting: [],
    ...over,
  };
}

/** Wiersz `tables[]` - obciążenie jednego stolika policzone przez bazę. */
function stolik(over: Record<string, Json> = {}): Json {
  return {
    table_id: "t-1",
    label: "Stolik 1",
    zone: "Sala A",
    capacity: 2,
    is_active: true,
    slots_taken: 4,
    slots_capacity: 16,
    utilisation_pct: 25,
    ...over,
  };
}

function osoba(over: Record<string, Json> = {}): Json {
  return {
    registration_id: "r-1",
    first_name: "Anna",
    last_name: "Kowalska",
    job_title: "Dyrektorka",
    company: "ACME",
    has_availability: true,
    ...over,
  };
}

function renderPanel(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
    queryClient,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.stats.mockResolvedValue(statystyki());
  h.setStatus.mockResolvedValue({});
});

describe("MeetingStatsPanel - trzy stany wejściowe ekranu", () => {
  it("czekanie na odpowiedź ma własny komunikat, a nie puste liczby", async () => {
    // Zero pokazane w trakcie odczytu jest nie do odróżnienia od zera
    // policzonego - a to dwie różne informacje o giełdzie.
    h.stats.mockReturnValue(new Promise(() => undefined));
    renderPanel(<MeetingStatsPanel eventId={WYDARZENIE} />);
    expect(await screen.findByText(`${BAZA}.loading`)).toBeTruthy();
    expect(screen.queryByText(`${BAZA}.title`)).toBeNull();
  });

  it("ODMOWA bazy kończy się zdaniem ze słownika, nie surowym wyjątkiem", async () => {
    h.stats.mockRejectedValue(new Error("forbidden: editor role required"));
    renderPanel(<MeetingStatsPanel eventId={WYDARZENIE} />);
    expect(await screen.findByText("adminEventMeetings.errors.forbidden")).toBeTruthy();
    // Angielskie zdanie o uprawnieniach nie ma prawa trafić na polski ekran.
    expect(screen.queryByText(/editor role required/)).toBeNull();
  });

  it("panel BEZ wybranego wydarzenia milczy i nie pyta bazy", async () => {
    // Studio wydarzenia montuje zakładki, zanim organizator wybierze wydarzenie.
    // Zapytanie z pustym identyfikatorem nie kończy się błędem, tylko liczbami
    // wyglądającymi na policzone - dlatego bramka `enabled` jest po stronie hooka,
    // a ekran musi umieć nie narysować nic.
    const { container } = renderPanel(<MeetingStatsPanel eventId="" />);
    await waitFor(() => expect(h.stats).not.toHaveBeenCalled());
    expect(container.textContent).toBe("");
    expect(screen.queryByText(`${BAZA}.loading`)).toBeNull();
  });
});

describe("MeetingStatsPanel - kreska zamiast zera procent", () => {
  it("brak rozstrzygniętych zaproszeń daje „-”, a nie „0%”", async () => {
    h.stats.mockResolvedValue(
      statystyki({ acceptance_rate: null, attendance_rate: null, total: 5, confirmed: 0 }),
    );
    renderPanel(<MeetingStatsPanel eventId={WYDARZENIE} />);
    await screen.findByText(`${BAZA}.title`);

    const kafelki = screen.getAllByText("-");
    // Dwa wskaźniki bez podstawy - akceptacja i frekwencja.
    expect(kafelki.length).toBe(2);
    expect(screen.queryByText("0%")).toBeNull();
  });

  it("policzony wskaźnik jest wypisany z procentem", async () => {
    h.stats.mockResolvedValue(statystyki({ acceptance_rate: 75, attendance_rate: 0 }));
    renderPanel(<MeetingStatsPanel eventId={WYDARZENIE} />);
    await screen.findByText(`${BAZA}.title`);

    expect(screen.getByText("75%")).toBeTruthy();
    // ZERO POLICZONE to nie jest brak podstawy: „0%” znaczy „nikt się nie
    // pojawił", a to informacja, którą organizator musi zobaczyć.
    expect(screen.getByText("0%")).toBeTruthy();
    expect(screen.queryByText("-")).toBeNull();
  });

  it("liczby jadą przez formatowanie językowe, a nie przez `String()`", async () => {
    h.stats.mockResolvedValue(statystyki({ total: 12_345, invited: 1000 }));
    const { container } = renderPanel(<MeetingStatsPanel eventId={WYDARZENIE} />);
    await screen.findByText(`${BAZA}.title`);

    // Asercja idzie po SUROWYM tekście węzła, a nie przez `getByText`:
    // `pl-PL` rozdziela tysiące spacją nierozdzielającą, którą normalizator
    // Testing Library zamienia na zwykłą - i porównanie z oryginałem przestaje
    // widzieć dokładnie tę różnicę, o którą w tym teście chodzi.
    // (`pl-PL` grupuje dopiero od pięciu cyfr - `minimumGroupingDigits: 2`.)
    expect(container.textContent).toContain(pl(12_345));
    expect(pl(12_345)).not.toBe("12345");
  });
});

describe("MeetingStatsPanel - obciążenie stolików", () => {
  it("stolik BEZ siatki slotów mówi „nie wiadomo”, a nie „0 z 0”", async () => {
    // `slots_capacity = 0` bierze się z giełdy bez dni albo bez długości slotu.
    // „0 z 0” czytałoby się jak pusty, gotowy stolik.
    h.stats.mockResolvedValue(
      statystyki({
        tables: [stolik({ slots_taken: 0, slots_capacity: 0, utilisation_pct: null })],
      }),
    );
    renderPanel(<MeetingStatsPanel eventId={WYDARZENIE} />);
    await screen.findByText(`${BAZA}.title`);

    expect(screen.getByText(`${BAZA}.tableUtilisationUnknown`)).toBeTruthy();
    expect(screen.queryByText(new RegExp(`${BAZA}\\.tableUtilisation\\(`))).toBeNull();
    // Bez podstawy odznaka też pokazuje kreskę, nie „0%”.
    expect(screen.getByText("-")).toBeTruthy();
  });

  it("stolik z siatką pokazuje ZAJĘTE i POJEMNOŚĆ, a nie sam procent", async () => {
    h.stats.mockResolvedValue(
      statystyki({
        tables: [stolik({ slots_taken: 4, slots_capacity: 16, utilisation_pct: 25 })],
      }),
    );
    renderPanel(<MeetingStatsPanel eventId={WYDARZENIE} />);
    await screen.findByText(`${BAZA}.title`);

    // Stub i18n dokleja parametry alfabetycznie - asercja czyta OBA, bo
    // sam procent nie mówi organizatorowi, ile jeszcze slotów zostało.
    expect(screen.getByText(`${BAZA}.tableUtilisation(capacity=16,taken=4)`)).toBeTruthy();
    expect(screen.getByText("25%")).toBeTruthy();
  });

  it("KOLIZJA: stolik zajęty DO KOŃCA jest widoczny jako pełny", async () => {
    // To jedyne uprzedzenie organizatora, że następne `admin_event_meeting_arrange`
    // w tym slocie odbije się o `no_free_table` - odmowa przychodzi dopiero
    // po kliknięciu, w cudzym oknie dialogowym.
    h.stats.mockResolvedValue(
      statystyki({
        tables: [
          stolik({ slots_taken: 16, slots_capacity: 16, utilisation_pct: 100 }),
          stolik({ table_id: "t-2", label: "Stolik 2", slots_taken: 2, utilisation_pct: 13 }),
        ],
      }),
    );
    renderPanel(<MeetingStatsPanel eventId={WYDARZENIE} />);
    await screen.findByText(`${BAZA}.title`);

    expect(screen.getByText("100%")).toBeTruthy();
    expect(screen.getByText(`${BAZA}.tableUtilisation(capacity=16,taken=16)`)).toBeTruthy();
    // Stolik zajęty do końca NIE wypycha z listy stolika, który ma jeszcze miejsce.
    expect(screen.getByText("13%")).toBeTruthy();
  });

  it("KOLIZJA: miejsca zajęte PONAD pojemność stolika nadal dają czytelny wiersz", async () => {
    // `table_seat_out_of_range` jest ostatnią bramką bazy, ale liczba z RPC może
    // już nieść stan sprzed jej dołożenia (import, ręczna korekta). Panel ma
    // wtedy pokazać, CO widzi, a nie wysypać się na procencie spoza skali:
    // `parseMeetingStats` odrzuca wartość poza 0-100 do `null`, czyli do kreski.
    h.stats.mockResolvedValue(
      statystyki({
        tables: [
          stolik({ capacity: 2, slots_taken: 20, slots_capacity: 16, utilisation_pct: 125 }),
        ],
      }),
    );
    renderPanel(<MeetingStatsPanel eventId={WYDARZENIE} />);
    await screen.findByText(`${BAZA}.title`);

    expect(screen.getByText(`${BAZA}.tableUtilisation(capacity=16,taken=20)`)).toBeTruthy();
    expect(screen.getByText("-")).toBeTruthy();
    expect(screen.queryByText("125%")).toBeNull();
  });

  it("stolik WYŁĄCZONY zostaje na liście - schowany zabrałby powód luki w grafiku", async () => {
    h.stats.mockResolvedValue(
      statystyki({
        tables: [
          stolik({
            table_id: "t-9",
            label: "Stolik zapasowy",
            is_active: false,
            slots_taken: 0,
            utilisation_pct: 0,
          }),
        ],
      }),
    );
    renderPanel(<MeetingStatsPanel eventId={WYDARZENIE} />);
    await screen.findByText(`${BAZA}.title`);

    expect(screen.getByText("Stolik zapasowy")).toBeTruthy();
    expect(screen.getByText("0%")).toBeTruthy();
  });

  it.fails(
    "DEFEKT: stolik WYŁĄCZONY niesie ten sam tekst co czynny - różni je wyłącznie wariant odznaki",
    async () => {
      // Molekuła `AdminMetricTile` w tym samym panelu ma to zapisane wprost:
      // „Ton jest DODATKIEM do treści, nie jej zamiennikiem". Lista samotnych
      // uczestników, dwie sekcje niżej, tej reguły przestrzega - stan
      // dostępności ma tam WŁASNE zdanie (`lonelyHasAvailability` /
      // `lonelyNoAvailability`). Lista stolików nie: `variant="secondary"`
      // zamiast `outline` to jedyna różnica między stolikiem czynnym
      // a wyłączonym, więc czytnik ekranu i wydruk ogłaszają oba identycznie.
      //
      // Koszt nie jest kosmetyczny. Wyłączony stolik jest najczęstszym powodem,
      // dla którego umawianie odbija się o `table_inactive` albo `no_free_table`,
      // a organizator szuka wtedy przyczyny właśnie na tym ekranie.
      h.stats.mockResolvedValue(
        statystyki({
          tables: [
            stolik({ table_id: "t-1", label: "Stolik 1", is_active: true }),
            stolik({ table_id: "t-2", label: "Stolik 1", is_active: false }),
          ],
        }),
      );
      const { container } = renderPanel(<MeetingStatsPanel eventId={WYDARZENIE} />);
      await screen.findByText(`${BAZA}.title`);

      // Oba wiersze mają CELOWO tę samą etykietę i te same liczby - zostaje
      // wyłącznie to, co panel dopisuje od siebie.
      const wiersze = Array.from(container.querySelectorAll("li"));
      expect(wiersze.length).toBe(2);
      expect(wiersze[1]?.textContent).not.toBe(wiersze[0]?.textContent);
    },
  );

  it("wiersz stolika BEZ identyfikatora jest pomijany, a nie renderowany pustym kluczem", async () => {
    h.stats.mockResolvedValue(
      statystyki({
        tables: [{ label: "Stolik widmo", capacity: 2 }, stolik({ label: "Stolik prawdziwy" })],
      }),
    );
    renderPanel(<MeetingStatsPanel eventId={WYDARZENIE} />);
    await screen.findByText(`${BAZA}.title`);

    expect(screen.queryByText("Stolik widmo")).toBeNull();
    expect(screen.getByText("Stolik prawdziwy")).toBeTruthy();
  });
});

describe("MeetingStatsPanel - trzy stany puste mówią trzy różne rzeczy", () => {
  it("brak stolików odsyła do konfiguracji giełdy", async () => {
    renderPanel(<MeetingStatsPanel eventId={WYDARZENIE} />);
    await screen.findByText(`${BAZA}.title`);
    expect(screen.getByText("adminEventMeetings.settings.readinessNoTables")).toBeTruthy();
  });

  it("brak dni giełdy ma SWOJE zdanie, inne niż brak stolików", async () => {
    renderPanel(<MeetingStatsPanel eventId={WYDARZENIE} />);
    await screen.findByText(`${BAZA}.title`);
    expect(screen.getByText("adminEventMeetings.settings.daysEmpty")).toBeTruthy();
  });

  it("pusta lista samotnych to DOBRA wiadomość i ma własne zdanie", async () => {
    // Trzeci stan pusty tego ekranu jest jedynym, który znaczy „wszystko gra";
    // wspólne „brak danych" skleiłoby go z dwoma poprzednimi.
    renderPanel(<MeetingStatsPanel eventId={WYDARZENIE} />);
    await screen.findByText(`${BAZA}.title`);
    expect(screen.getByText(`${BAZA}.lonelyEmpty`)).toBeTruthy();
  });

  it("rozkład po dniach wypisuje potwierdzone I zaproszone dla każdego dnia", async () => {
    h.stats.mockResolvedValue(
      statystyki({
        by_day: [
          { day: "2026-09-10", confirmed: 5, invited: 2, total: 7 },
          { day: "2026-09-11", confirmed: 0, invited: 0, total: 0 },
        ],
      }),
    );
    renderPanel(<MeetingStatsPanel eventId={WYDARZENIE} />);
    await screen.findByText(`${BAZA}.title`);

    expect(screen.getByText("2026-09-10")).toBeTruthy();
    expect(screen.getByText("2026-09-11")).toBeTruthy();
    expect(screen.queryByText("adminEventMeetings.settings.daysEmpty")).toBeNull();
  });

  it("dzień BEZ daty jest pomijany - lista Reacta bez klucza to błąd sortowania", async () => {
    h.stats.mockResolvedValue(
      statystyki({
        by_day: [
          { confirmed: 5, invited: 2 },
          { day: "2026-09-12", confirmed: 1, invited: 1 },
        ],
      }),
    );
    renderPanel(<MeetingStatsPanel eventId={WYDARZENIE} />);
    await screen.findByText(`${BAZA}.title`);

    expect(screen.getAllByText(/^2026-09-/).length).toBe(1);
  });
});

describe("MeetingStatsPanel - lista osób bez spotkania jest narzędziem, nie metryką", () => {
  it("wiersz niesie nazwisko, stanowisko, firmę i to, czy człowiek MA KIEDY się spotkać", async () => {
    h.stats.mockResolvedValue(
      statystyki({
        without_meeting: [
          osoba({ has_availability: true }),
          osoba({
            registration_id: "r-2",
            first_name: "Jan",
            last_name: "Nowak",
            job_title: null,
            company: "Beta",
            has_availability: false,
          }),
        ],
      }),
    );
    renderPanel(<MeetingStatsPanel eventId={WYDARZENIE} />);
    await screen.findByText(`${BAZA}.title`);

    expect(screen.getByText("Anna Kowalska")).toBeTruthy();
    expect(screen.getByText("Dyrektorka · ACME")).toBeTruthy();
    // Brak stanowiska nie zostawia wiszącej kropki - separator łączy tylko to,
    // co naprawdę jest.
    expect(screen.getByText("Beta")).toBeTruthy();
    expect(screen.getByText(`${BAZA}.lonelyHasAvailability`)).toBeTruthy();
    expect(screen.getByText(`${BAZA}.lonelyNoAvailability`)).toBeTruthy();
  });

  it("uczestnik BEZ imienia i nazwiska nie znika z listy roboczej", async () => {
    // Zapis bez nazwiska to najczęściej import - i to właśnie ta osoba
    // najpewniej zostanie sama, więc ma być widoczna.
    h.stats.mockResolvedValue(
      statystyki({
        without_meeting: [
          osoba({ first_name: null, last_name: null, job_title: null, company: "Gamma" }),
        ],
      }),
    );
    renderPanel(<MeetingStatsPanel eventId={WYDARZENIE} />);
    await screen.findByText(`${BAZA}.title`);

    expect(screen.getByText("Gamma")).toBeTruthy();
    expect(screen.queryByText(`${BAZA}.lonelyEmpty`)).toBeNull();
  });

  it("osoba BEZ identyfikatora zapisu jest pomijana", async () => {
    h.stats.mockResolvedValue(
      statystyki({
        without_meeting: [{ first_name: "Widmo", last_name: "Bezzapisu" }, osoba()],
      }),
    );
    renderPanel(<MeetingStatsPanel eventId={WYDARZENIE} />);
    await screen.findByText(`${BAZA}.title`);

    expect(screen.queryByText("Widmo Bezzapisu")).toBeNull();
    expect(screen.getByText("Anna Kowalska")).toBeTruthy();
  });
});

describe("MeetingStatsPanel - odwołanie spotkania PO akceptacji zwalnia stolik", () => {
  /**
   * Sonda montuje panel razem z mutacją zmiany stanu, bo to jedyny sposób,
   * żeby dowieść skutku CZĘŚCIOWEGO ograniczenia `event_meetings_table_no_overlap`
   * na ekranie: odwołane spotkanie przestaje zajmować miejsce (harness
   * `60_meetings.sql`, „ODWOLANE spotkanie zwalnia miejsce i termin"), więc
   * obciążenie stolika MUSI spaść po unieważnieniu gałęzi.
   */
  function Sonda({ eventId }: { eventId: string }) {
    const status = useSetMeetingStatus(eventId);
    return (
      <div>
        <button
          type="button"
          onClick={() =>
            status.mutate({ meetingId: "m-1", status: "cancelled", reason: "sala zajęta" })
          }
        >
          atrapa-odwolaj
        </button>
        <MeetingStatsPanel eventId={eventId} />
      </div>
    );
  }

  it("po odwołaniu statystyki są liczone PONOWNIE i miejsce przy stoliku wraca", async () => {
    h.stats
      .mockResolvedValueOnce(
        statystyki({
          confirmed: 1,
          cancelled: 0,
          tables: [stolik({ slots_taken: 16, slots_capacity: 16, utilisation_pct: 100 })],
        }),
      )
      .mockResolvedValue(
        statystyki({
          confirmed: 0,
          cancelled: 1,
          tables: [stolik({ slots_taken: 15, slots_capacity: 16, utilisation_pct: 94 })],
        }),
      );

    renderPanel(<Sonda eventId={WYDARZENIE} />);
    expect(await screen.findByText("100%")).toBeTruthy();

    fireEvent.click(screen.getByText("atrapa-odwolaj"));

    await waitFor(() => expect(screen.getByText("94%")).toBeTruthy());
    expect(h.setStatus).toHaveBeenCalledWith({
      meetingId: "m-1",
      status: "cancelled",
      reason: "sala zajęta",
    });
    expect(h.stats).toHaveBeenCalledTimes(2);
  });

  it("ODMOWA odwołania NIE przelicza statystyk - migający ekran sugerowałby sukces", async () => {
    // `meeting_not_active` wraca, gdy spotkanie już zostało odwołane albo
    // odbyte. Nic się nie zmieniło, więc odświeżanie byłoby pustym obiegiem,
    // a spadająca i wracająca liczba - fałszywym potwierdzeniem.
    h.setStatus.mockRejectedValue(
      new Error(
        "meeting_not_active: only an open invitation or an accepted meeting can be cancelled",
      ),
    );
    h.stats.mockResolvedValue(
      statystyki({
        tables: [stolik({ slots_taken: 16, slots_capacity: 16, utilisation_pct: 100 })],
      }),
    );

    renderPanel(<Sonda eventId={WYDARZENIE} />);
    expect(await screen.findByText("100%")).toBeTruthy();

    fireEvent.click(screen.getByText("atrapa-odwolaj"));

    await waitFor(() => expect(h.setStatus).toHaveBeenCalled());
    expect(h.stats).toHaveBeenCalledTimes(1);
    expect(screen.getByText("100%")).toBeTruthy();
  });
});

describe("MeetingStatsPanel - dostępność", () => {
  it("pełny ekran statystyk nie ma naruszeń axe", async () => {
    h.stats.mockResolvedValue(
      statystyki({
        tables: [stolik(), stolik({ table_id: "t-2", label: "Stolik 2", is_active: false })],
        by_day: [{ day: "2026-09-10", confirmed: 5, invited: 2, total: 7 }],
        without_meeting: [osoba(), osoba({ registration_id: "r-2", has_availability: false })],
      }),
    );
    const { container } = renderPanel(<MeetingStatsPanel eventId={WYDARZENIE} />);
    await screen.findByText(`${BAZA}.title`);

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("stan pusty i stan odmowy też nie mają naruszeń axe", async () => {
    const pusty = renderPanel(<MeetingStatsPanel eventId={WYDARZENIE} />);
    await screen.findByText(`${BAZA}.title`);
    const bezDanych = await axeViolations(pusty.container);
    expect(bezDanych, summarize(bezDanych)).toEqual([]);
    pusty.unmount();

    h.stats.mockRejectedValue(new Error("forbidden: editor role required"));
    const odmowa = renderPanel(<MeetingStatsPanel eventId={WYDARZENIE} />);
    await screen.findByText("adminEventMeetings.errors.forbidden");
    const zOdmowa = await axeViolations(odmowa.container);
    expect(zOdmowa, summarize(zOdmowa)).toEqual([]);
  });

  it("sekcje mają nagłówki - inaczej czytnik ogłasza trzy bezimienne listy", async () => {
    h.stats.mockResolvedValue(statystyki({ tables: [stolik()], without_meeting: [osoba()] }));
    const { container } = renderPanel(<MeetingStatsPanel eventId={WYDARZENIE} />);
    await screen.findByText(`${BAZA}.title`);

    const naglowki = within(container).getAllByRole("heading");
    const teksty = naglowki.map((node) => node.textContent);
    expect(teksty).toContain(`${BAZA}.title`);
    expect(teksty).toContain(`${BAZA}.tablesSection`);
    expect(teksty).toContain(`${BAZA}.byDaySection`);
    expect(teksty).toContain(`${BAZA}.lonelySection`);
  });
});
