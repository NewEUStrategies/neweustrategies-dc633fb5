// Słownik obszarów tematycznych klubów dyskusyjnych.
//
// Jedno miejsce prawdy po stronie klienta dla listy domkniętej w bazie przez
// funkcję `public.club_topic_valid()`. Kluby (kolumna `clubs.policy_area`)
// i wątki (`club_threads.topic`) korzystają z TEGO SAMEGO słownika - inaczej
// nawigacja po tematyce w hubie rozjeżdża się z filtrem wewnątrz klubu.
//
// Etykiety idą przez i18n (`club.topic.<key>`), a nie przez zaszyte stringi:
// PL i EN muszą pochodzić z bramki parytetu, żeby brak tłumaczenia oblewał CI,
// zamiast pokazywać surowy klucz.

export const CLUB_TOPICS = [
  "geopolitics",
  "transport",
  "energy",
  "cybersecurity",
  "technology",
  "finance",
  "economy",
  "diplomacy",
  "international_relations",
  "culture",
] as const;

export type ClubTopic = (typeof CLUB_TOPICS)[number];

/** Wartość sentinel dla "bez obszaru" - Radix Select nie przyjmuje "". */
export const CLUB_TOPIC_NONE = "none";

export function isClubTopic(value: string | null | undefined): value is ClubTopic {
  if (value === null || value === undefined) return false;
  return (CLUB_TOPICS as readonly string[]).includes(value);
}

/** Klucz i18n etykiety; dla wartości spoza słownika zwraca null. */
export function clubTopicI18nKey(value: string): string | null {
  return isClubTopic(value) ? `club.topic.${value}` : null;
}

/** Normalizacja z formularza: pusty string i sentinel znaczą "brak". */
export function normalizeClubTopic(value: string | null | undefined): ClubTopic | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === CLUB_TOPIC_NONE) return null;
  return isClubTopic(trimmed) ? trimmed : null;
}
