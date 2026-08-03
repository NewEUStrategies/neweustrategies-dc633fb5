// Test helper: uniwersalny, NIEPUSTY zestaw danych dla widgetów buildera.
//
// PO CO
// Widget listowy, którego zapytanie zwróciło pustą tablicę, wychodzi wczesnym
// `return` ("Brak wpisów spełniających kryteria.") i NIE dochodzi do gałęzi
// prezentacji. Test mierzący zachowanie renderera (bramka wierności ustawień)
// widziałby wtedy, że karuzela nie czyta `autoplay`, lista nie czyta `columns`,
// a slider nie czyta rozmiarów tytułu - i uznał sprawne ustawienia za martwe.
// Pusta odpowiedź mierzy stan pusty, nie funkcjonalność.
//
// Wiersz poniżej jest CELOWO nadzbiorem kolumn: warstwa zapytań selectuje różne
// podzbiory, a każdy renderer czyta tylko to, co zna. Nadmiarowe klucze są
// nieszkodliwe, brakujące - dawałyby fałszywy stan pusty.
//
// Wartości są jawnie testowe ("Stub …") i nie mogą przypominać danych próbki
// kontekstu wpisu (`PLACEHOLDER_POST_CTX`) - inaczej bramka wycieku próbki
// zaczęłaby zgłaszać trafienia z własnego stubu.

/** Jeden „wiersz wszystkiego”: post, kategoria, tag, wydarzenie, prelegent. */
export const UNIVERSAL_ROW: Readonly<Record<string, unknown>> = {
  // --- wspólne ---
  id: "stub-1",
  slug: "stub-1",
  created_at: "2026-01-01T09:00:00.000Z",
  updated_at: "2026-01-02T09:00:00.000Z",
  status: "published",
  sort_order: 1,
  position: 1,

  // --- posts ---
  title_pl: "Stub tytuł",
  title_en: "Stub title",
  excerpt_pl: "Stub zajawka.",
  excerpt_en: "Stub excerpt.",
  content_pl: "<p>Stub treść</p>",
  content_en: "<p>Stub body</p>",
  cover_image_url: "https://example.org/stub-cover.jpg",
  published_at: "2026-01-02T09:00:00.000Z",
  post_format: "standard",
  reading_time_min: 5,
  author_id: "stub-author",
  author_display_name: "Stub Author",
  author_avatar_url: "https://example.org/stub-avatar.jpg",
  author_slug: "stub-author",
  rating: 4,

  // --- taksonomie ---
  name: "Stub name",
  name_pl: "Stub nazwa",
  name_en: "Stub name",
  description_pl: "Stub opis.",
  description_en: "Stub description.",
  post_id: "stub-1",
  category_id: "stub-cat",
  tag_id: "stub-tag",

  // --- events ---
  starts_at: "2026-06-01T09:00:00.000Z",
  ends_at: "2026-06-01T11:00:00.000Z",
  kind: "webinar",
  location: "Stub location",
  timezone: "Europe/Warsaw",
  rsvp_count: 3,
  event_id: "stub-event",
  capacity: 50,

  // --- speakers / profile ---
  user_id: "stub-user",
  full_name: "Stub Speaker",
  display_name: "Stub Speaker",
  avatar_url: "https://example.org/stub-speaker.jpg",
  job_title: "Stub role",
  company: "Stub co.",
  bio_pl: "Stub bio.",
  bio_en: "Stub bio EN.",

  // --- media / storage ---
  url: "https://example.org/stub.jpg",
  file_url: "https://example.org/stub.mp3",
  duration_seconds: 120,

  // --- ads / plans ---
  price_cents: 1000,
  currency: "PLN",
  interval: "month",
};

/** Trzy wiersze - dość, żeby karuzele, siatki i paginacja miały co pokazać. */
export const UNIVERSAL_ROWS: ReadonlyArray<Readonly<Record<string, unknown>>> = [
  { ...UNIVERSAL_ROW, id: "stub-1", slug: "stub-1" },
  { ...UNIVERSAL_ROW, id: "stub-2", slug: "stub-2", title_pl: "Stub tytuł 2" },
  { ...UNIVERSAL_ROW, id: "stub-3", slug: "stub-3", title_pl: "Stub tytuł 3" },
];
