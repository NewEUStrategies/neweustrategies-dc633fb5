// Wiersze RPC STUDIA WYDARZENIA - jedni budownicy dla calego modulu.
//
// PO CO OSOBNY PLIK. Rama studia i kazdy jej ekran (pulpit, gotowosc, funkcje
// dodatkowe, sekcje modulowe) przyjmuja TEN SAM wiersz o 53 kolumnach, a polowa
// z nich czyta jeszcze te sama liste sesji. Kazda kopia budownika w pliku
// testowym to osobny kontrakt do rozjechania: kolumna dodana do sygnatury RPC
// przestaje kompilowac JEDEN plik zamiast pieciu, a to jest dokladnie ten
// sygnal, ktory ma dojsc do autora zmiany.
//
// KSZTALT BIERZEMY Z WYGENEROWANEGO TYPU (`Database["public"]["Functions"]`),
// a nie przepisujemy recznie - budownik wezszy od sygnatury przestalby sie
// kompilowac przy pierwszej nowej kolumnie i to jest ZALETA, nie koszt.
//
// RODO: zadnych prawdziwych danych osobowych, adresy wylacznie `example.org`.
import type { AdminEventDetailRow } from "@/lib/events/eventDetailApi";
import type { EventSessionRow } from "@/lib/events/sessionsApi";

/** Identyfikator w ksztalcie UUID - trasy studia rozpoznaja wydarzenie po nim. */
export const STUDIO_EVENT_ID = "3f1a0c8e-0000-4000-8000-000000000042";

/**
 * Wydarzenie OPUBLIKOWANE, stacjonarne, z komplementem pol wymaganych przez
 * checkliste gotowosci. Test, ktory chce braku, odejmuje go nadpisaniem - to
 * jest tansze i czytelniejsze niz doklejanie pol do pustego wiersza.
 */
export function adminEventDetailRow(
  overrides: Partial<AdminEventDetailRow> = {},
): AdminEventDetailRow {
  return {
    branding: {},
    cancelled_at: "",
    capacity: 0,
    chatham_house: false,
    city: "Warszawa",
    country: "Polska",
    cover_url: "https://cdn.example.org/kongres/okladka.jpg",
    created_at: "2026-05-01T10:00:00.000Z",
    description_en: "Energy security across Central Europe.",
    description_pl: "Bezpieczenstwo energetyczne Europy Srodkowej.",
    early_rsvp_rank: 0,
    ends_at: "2026-09-01T15:00:00.000Z",
    event_type_id: "",
    external_registration_url: "",
    features: {},
    format: "onsite",
    guest_mode: "full",
    has_recording: false,
    has_stream: false,
    home_design: "standard",
    id: STUDIO_EVENT_ID,
    join_url: "",
    kind: "in_person",
    languages: ["pl", "en"],
    location: "Centrum Konferencyjne",
    min_tier_rank: 0,
    pages_display_mode: "list",
    postal_code: "00-001",
    published_at: "2026-06-01T10:00:00.000Z",
    recording_url: "",
    region: "mazowieckie",
    registration_flow: "direct",
    registration_mode: "internal",
    root_page_id: "root",
    rsvp_opens_at: "",
    slug: "kongres-energetyczny",
    social_hashtag: "NES2026",
    starts_at: "2026-09-01T09:00:00.000Z",
    status: "published",
    street_address: "Aleje Jerozolimskie 1",
    support_email: "kontakt@example.org",
    ticket_currency: "PLN",
    ticket_price_cents: 0,
    timezone: "Europe/Warsaw",
    title_en: "Energy Congress",
    title_pl: "Kongres Energetyczny",
    type_accent_color: "",
    type_icon: "",
    type_key: "in_person",
    type_name_en: "",
    type_name_pl: "",
    updated_at: "2026-06-01T10:00:00.000Z",
    video_header_id: "",
    video_header_platform: "",
    visibility: "public",
    ...overrides,
  };
}

/**
 * Wiersz `admin_event_sessions_list` - 37 kolumn sygnatury RPC.
 *
 * Domyslnie sesja KOMPLETNA: opublikowana, z prelegentami i z sala. Checklista
 * gotowosci liczy BRAKI, wiec test, ktory chce braku, odejmuje go nadpisaniem -
 * inaczej kazdy przypadek zaczynalby od doklejania czterech pol.
 */
export function adminEventSessionRow(overrides: Partial<EventSessionRow> = {}): EventSessionRow {
  return {
    allow_overlap: false,
    cancelled_at: "",
    cancelled_count: 0,
    capacity: 0,
    chatham_house: false,
    children_count: 0,
    description_en: "",
    description_pl: "",
    duration_minutes: 60,
    ends_at: "2026-09-01T10:00:00.000Z",
    event_id: STUDIO_EVENT_ID,
    format: "onsite",
    has_recording: false,
    has_stream: false,
    id: "5a1c0000-0000-4000-8000-000000000001",
    is_private: false,
    min_tier_rank: 0,
    parent_session_id: "",
    published_at: "2026-06-01T10:00:00.000Z",
    registered_count: 0,
    requires_signup: false,
    room_capacity: 120,
    room_id: "6b2d0000-0000-4000-8000-000000000001",
    room_name: "Sala Glowna",
    seats_left: 0,
    sort_order: 0,
    speakers_count: 2,
    starts_at: "2026-09-01T09:00:00.000Z",
    status: "published",
    title_en: "Opening",
    title_pl: "Otwarcie",
    track_accent_color: "",
    track_id: "",
    track_key: "",
    track_name_en: "",
    track_name_pl: "",
    waitlist_count: 0,
    ...overrides,
  };
}
