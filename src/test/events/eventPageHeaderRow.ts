// Wiersz `event_page_header()` w kształcie, jaki oddaje `fetchEventPageHeader`.
//
// PO CO OSOBNY PLIK. Nagłówek strony wydarzenia to JEDNO wywołanie i
// czterdzieści siedem kolumn - to on niesie tryb zapisów, przepływ, stan,
// bramki warstwy i Chatham House oraz własny status uczestnika. Test, który
// chce zobaczyć BLOK ZAPISÓW na przeglądzie, musi mieć go w całości (przy
// `null` trasa nie rysuje bloku wcale), a wpisany do pliku testowego raz jest
// przy drugim teście kopiowany, a przy trzecim któraś kopia ma inny
// `registration_state`.
//
// KSZTAŁT JEST Z SYGNATURY RPC, nie przepisany ręcznie: `EventPageHeader` to
// alias na `Returns[number]` wygenerowanych typów, więc dziewiąta kolumna
// dodana w migracji zaczerwieni ten plik, a nie test, który go używa.
//
// PUSTY NAPIS ZAMIAST `null`. Wygenerowane typy oddają kolumny nagłówka jako
// `string` (nie `string | null`), a część z nich jest w bazie nullowalna
// (`cancelled_at`, `external_registration_url`, `root_page_id`). Fixtura idzie
// za TYPEM - napis pusty jest tu zapisem „brak wartości" i tak go czyta front
// (`normalizedUrl` w `registrationSurface.ts` traktuje pustkę jako brak adresu).
import type { EventPageHeader } from "@/lib/community/publicQueries";

/**
 * Wydarzenie PRZYSZŁE, bezpłatne, z OTWARTYMI zapisami szybkim RSVP i bez
 * własnego zgłoszenia wołającego - najuboższy stan, w którym trasa przeglądu
 * rysuje blok zapisów (dla gościa wariantem „zaloguj się, żeby się zapisać").
 */
export function eventPageHeaderRow(overrides: Partial<EventPageHeader> = {}): EventPageHeader {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "kongres-strategii",
    title_pl: "Kongres Strategii Europejskich",
    title_en: "European Strategies Congress",
    description_pl: "Dwa dni rozmów o bezpieczeństwie gospodarczym.",
    description_en: "Two days on economic security.",
    starts_at: "2099-09-15T08:00:00.000Z",
    ends_at: "2099-09-16T16:00:00.000Z",
    timezone: "Europe/Warsaw",
    location: "Hotel Bristol",
    kind: "conference",
    format: "onsite",
    visibility: "public",
    cover_url: "https://cdn.example.test/cover.jpg",
    branding: null,
    published_at: "2026-08-01T10:00:00.000Z",
    cancelled_at: "",
    capacity: 0,
    seats_left: 100,
    chatham_house: false,
    chatham_house_locked: false,
    tier_locked: false,
    min_tier_rank: 0,
    viewer_tier_rank: 0,
    guest_mode: "full",
    has_ended: false,
    has_recording: false,
    has_stream: false,
    is_bookmarked: false,
    registration_mode: "rsvp",
    registration_flow: "instant",
    registration_state: "open",
    external_registration_url: "",
    my_registration_status: "none",
    my_rsvp_status: "cancelled",
    my_waitlist_position: 0,
    rsvp_opens_at: "",
    ticket_currency: "PLN",
    ticket_price_cents: 0,
    sessions_count: 0,
    speakers_count: 1,
    sponsors_count: 0,
    root_page_id: "",
    event_type_id: "",
    type_key: "conference",
    type_name_pl: "Konferencja",
    type_name_en: "Conference",
    type_icon: "",
    type_accent_color: "",
    ...overrides,
  };
}
