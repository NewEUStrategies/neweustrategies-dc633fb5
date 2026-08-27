// Wiersz `PublicEvent` w kształcie, jaki oddaje `fetchPublicEventBySlug`.
//
// PO CO OSOBNY PLIK. Trasy publicznej strony wydarzenia (powłoka + przegląd +
// pięć zakładek) czytają JEDNĄ migawkę wydarzenia z tego samego klucza cache,
// więc test montujący którąkolwiek z nich potrzebuje pełnego wiersza - a pełny
// wiersz to trzydzieści kolumn. Wpisany w plik testowy raz, przy drugim teście
// jest kopiowany, a przy trzecim któraś kopia ma inne `status`.
//
// `src/test/events/fixtures.ts` NIE JEST TYM MIEJSCEM: tamten plik służy
// warstwie BILETOWEJ (łańcuch PostgREST, RPC liczników) i jego `eventRow` ma
// osiem kolumn zapytania tabelarycznego, nie kształt `PublicEvent`.
import type { PublicEvent } from "@/lib/community/publicQueries";

/** Wydarzenie PRZYSZŁE i bezpłatne - najuboższy wiersz, który strona rysuje. */
export function publicEventRow(overrides: Partial<PublicEvent> = {}): PublicEvent {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "kongres-strategii",
    title_pl: "Kongres Strategii Europejskich",
    title_en: "European Strategies Congress",
    description_pl: "Dwa dni rozmów o bezpieczeństwie gospodarczym.",
    description_en: "Two days on economic security.",
    // Data w przyszłości: `isPast` przełącza całą prawą kolumnę na bramkę
    // nagrania, a wtedy test o siatce mierzyłby inny stan strony.
    starts_at: "2099-09-15T08:00:00.000Z",
    ends_at: "2099-09-16T16:00:00.000Z",
    timezone: "Europe/Warsaw",
    location: "Hotel Bristol",
    kind: "conference",
    capacity: null,
    status: "published",
    chatham_house: false,
    cover_url: "https://cdn.example.test/cover.jpg",
    host_user_id: null,
    visibility: "public",
    min_tier_rank: 0,
    rsvp_opens_at: null,
    early_rsvp_rank: null,
    ticket_price_cents: null,
    ticket_currency: "PLN",
    format: "onsite",
    guest_mode: "full",
    street_address: "Krakowskie Przedmieście 42/44",
    city: "Warszawa",
    region: null,
    postal_code: "00-325",
    country: "PL",
    video_header_platform: null,
    video_header_id: null,
    social_hashtag: "kongresNES",
    support_email: "kontakt@example.test",
    languages: ["pl", "en"],
    branding: null,
    pages_display_mode: "list",
    published_at: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}
