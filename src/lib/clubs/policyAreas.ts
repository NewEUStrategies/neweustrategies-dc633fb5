// Warstwa zgodności dla starej, zaszytej taksonomii obszarów tematycznych.
//
// Źródłem prawdy jest teraz katalog w bazie (`club_topics`) i moduł
// `topicCatalog.ts`. Ten plik zostaje, bo importuje go kilka miejsc, ale nie
// zawiera już własnej listy - inaczej obszar dodany w panelu byłby "nieznany"
// dla połowy aplikacji.

import {
  CLUB_TOPIC_FALLBACK,
  CLUB_TOPIC_NONE,
  normalizeTopicValue,
  topicLabel,
  type ClubLang,
  type ClubTopicOption,
} from "@/lib/clubs/topicCatalog";

export { CLUB_TOPIC_NONE };
export type ClubTopic = string;

/** Domyślne klucze - używane wyłącznie jako lista awaryjna. */
export const CLUB_TOPICS: readonly string[] = CLUB_TOPIC_FALLBACK.map((o) => o.key);

export function isClubTopic(value: string | null | undefined): value is string {
  if (value === null || value === undefined) return false;
  return value.trim() !== "";
}

export function normalizeClubTopic(value: string | null | undefined): string | null {
  return normalizeTopicValue(value);
}

/** Etykieta obszaru; `catalog` pozwala uwzględnić nazwy z panelu. */
export function clubTopicLabel(
  value: string,
  lang: ClubLang,
  _t?: (key: string) => string,
  catalog: readonly ClubTopicOption[] = [],
): string {
  return topicLabel(value, lang, catalog);
}
