// Wiersze SPRZEDAŻOWE panelu wydarzeń: bilet, pakiet grupowy, miejsce w pakiecie.
//
// PO CO OSOBNY PLIK. Bilet ma trzydzieści sześć kolumn, pakiet dwadzieścia
// sześć. Formularz czyta z nich kilkanaście, ale atrapa węższa od sygnatury
// przestałaby się kompilować przy pierwszej nowej kolumnie - i to jest ZALETA,
// nie koszt. Wpisany do pliku testowego raz, przy drugim teście jest kopiowany,
// a przy trzecim któraś kopia ma inną cenę i nikt nie wie, która jest wzorcem.
//
// KSZTAŁT JEST Z SYGNATURY RPC, nie przepisany ręcznie: `EventTicketRow`,
// `EventPackageRow` i `EventPackageSeatRow` to aliasy na `Returns[number]`
// wygenerowanych typów.
//
// KOLUMNY NULL-OWALNE IDĄ ZA BAZĄ, NIE ZA GENERATOREM. Wygenerowane typy
// obiecują `string`/`number` także tam, gdzie kolumna jest NULL-owalna
// (`quota`, `invite_email`, `attendee_name`) - i front o tym WIE, bo ma na to
// jawne warunki (`row.quota === null`, `?? "-"`). Fixtura, która wstawiłaby
// w te miejsca pusty napis albo zero, testowałaby kształt, którego RPC nigdy
// nie odda, a prawdziwe gałęzie zostałyby nietknięte. Stąd dwie nazwane stałe
// niżej; pustego napisu używamy WYŁĄCZNIE tam, gdzie kolumna jest `NOT NULL`.
//
// KWOTY SĄ W GROSZACH - jedna jednostka w całym module. `price_cents: 1999`
// to 19,99 w kasie, a nie 1999 złotych.
import type { EventPackageRow, EventPackageSeatRow } from "@/lib/events/packagesApi";
import type { EventTicketRow } from "@/lib/events/registrationsApi";

/**
 * Kolumna NULL-owalna, którą generator typuje jako `number`.
 *
 * `quota` i `early_bird_price_cents` przychodzą z RPC jako `null` („bez limitu",
 * „bez ceny promocyjnej"), ale wygenerowany typ tego nie wie - `ticketDraft.ts`
 * ma na to jawny warunek i komentarz. Fixtura musi umieć oddać tę wartość,
 * inaczej testu „pusta pula to brak limitu, nie zero" nie da się napisać.
 */
const NULLOWALNA_LICZBA = null as unknown as number;

/**
 * Kolumna NULL-owalna, którą generator typuje jako `string`.
 *
 * Miejsce WOLNE nie ma ani nazwy uczestnika, ani adresu zaproszenia, ani
 * terminu ważności - PostgREST oddaje w tych kolumnach `null`, mimo że
 * wygenerowany typ obiecuje `string`. Front ma na to warunki (`?? "-"`,
 * `=== null`), więc fixtura musi umieć oddać właśnie `null`; pustego napisu
 * używamy tam, gdzie kolumna jest w bazie `NOT NULL DEFAULT ''`.
 */
const NULLOWALNY_NAPIS = null as unknown as string;

/** Identyfikatory w kształcie UUID - panel przekazuje je dalej do RPC. */
export const SALES_IDS = {
  event: "11111111-1111-4111-8111-111111111111",
  ticket: "aaaaaaaa-1111-4111-8111-111111111111",
  otherTicket: "aaaaaaaa-2222-4222-8222-222222222222",
  eventPackage: "bbbbbbbb-1111-4111-8111-111111111111",
  otherPackage: "bbbbbbbb-2222-4222-8222-222222222222",
  order: "cccccccc-1111-4111-8111-111111111111",
  seat: "dddddddd-1111-4111-8111-111111111111",
  otherSeat: "dddddddd-2222-4222-8222-222222222222",
} as const;

/**
 * Bilet PŁATNY, aktywny, bez puli i bez okna sprzedaży - najuboższy wiersz,
 * który formularz otwiera w trybie edycji. Cena 19,99 (1999 groszy) jest
 * celowo NIEOKRĄGŁA: pomyłka o jedno zero w konwersji od razu widać w asercji.
 */
export function eventTicketRow(overrides: Partial<EventTicketRow> = {}): EventTicketRow {
  return {
    access_code_hint: "",
    availability: "on_sale",
    benefits_en: [],
    benefits_pl: [],
    created_at: "2026-08-01T10:00:00.000Z",
    currency: "PLN",
    current_phase: null,
    description_en: "",
    description_pl: "",
    early_bird_price_cents: NULLOWALNA_LICZBA,
    early_bird_until: "",
    effective_price_cents: 1999,
    event_id: SALES_IDS.event,
    group_id: "",
    group_name_en: "",
    group_name_pl: "",
    has_access_code: false,
    id: SALES_IDS.ticket,
    is_active: true,
    key: "vip_pass",
    min_tier_rank: 0,
    name_en: "VIP pass",
    name_pl: "Karnet VIP",
    pending_count: 0,
    price_cents: 1999,
    price_schedule: null,
    quota: NULLOWALNA_LICZBA,
    requires_approval: false,
    sales_from: "",
    sales_to: "",
    seats_left: 0,
    sold_count: 0,
    sort_order: 10,
    updated_at: "2026-08-02T10:00:00.000Z",
    waitlist_count: 0,
    waitlist_enabled: true,
    ...overrides,
  };
}

/** Pakiet firmowy na pięć miejsc, wskazujący bilet `SALES_IDS.ticket`. */
export function eventPackageRow(overrides: Partial<EventPackageRow> = {}): EventPackageRow {
  return {
    audience: "company",
    created_at: "2026-08-01T10:00:00.000Z",
    currency: "PLN",
    description_en: "",
    description_pl: "",
    event_id: SALES_IDS.event,
    id: SALES_IDS.eventPackage,
    is_active: true,
    key: "delegacja_5",
    min_tier_rank: 0,
    name_en: "Delegation of five",
    name_pl: "Delegacja pięcioosobowa",
    orders_count: 0,
    price_cents: 899_00,
    quota: NULLOWALNA_LICZBA,
    requires_verification: false,
    sales_from: "",
    sales_to: "",
    seats: 5,
    seats_assigned: 0,
    sold_count: 0,
    sort_order: 100,
    ticket_name_en: "VIP pass",
    ticket_name_pl: "Karnet VIP",
    ticket_type_id: SALES_IDS.ticket,
    updated_at: "2026-08-02T10:00:00.000Z",
    ...overrides,
  };
}

/**
 * Miejsce WOLNE - jeszcze bez zaproszenia i bez uczestnika.
 *
 * Wszystkie kolumny zaproszenia są tu `null`, bo tak wygląda świeżo utworzone
 * miejsce w bazie: `admin_event_package_order_create` wstawia same wiersze
 * z pulą, a nazwiska, adresy i terminy dopisuje dopiero zaproszenie.
 */
export function packageSeatRow(overrides: Partial<EventPackageSeatRow> = {}): EventPackageSeatRow {
  return {
    assigned_at: NULLOWALNY_NAPIS,
    attendee_name: NULLOWALNY_NAPIS,
    id: SALES_IDS.seat,
    invite_email: NULLOWALNY_NAPIS,
    invite_expires_at: NULLOWALNY_NAPIS,
    invite_name: NULLOWALNY_NAPIS,
    invite_sent_at: NULLOWALNY_NAPIS,
    package_order_id: SALES_IDS.order,
    registration_id: NULLOWALNY_NAPIS,
    registration_status: NULLOWALNY_NAPIS,
    revoked_at: NULLOWALNY_NAPIS,
    state: "free",
    ...overrides,
  };
}
