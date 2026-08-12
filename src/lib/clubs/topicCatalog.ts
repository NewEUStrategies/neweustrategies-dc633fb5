// Katalog obszarów tematycznych klubów - czysta logika, bez React i bez sieci.
//
// Do tej pory taksonomia była zaszyta w kodzie (`CLUB_TOPICS`) i w bazie
// (`club_topic_valid`). Katalog jest teraz danymi: redakcja dodaje własne
// obszary i wyłącza te, których nie używa, per organizacja. Ten moduł trzyma
// wyłącznie reguły, które muszą być identyczne po stronie formularza, filtra
// i etykiety - żeby chip w hubie, w klubie i w wątku mówił to samo.

import { areaLabel } from "@/lib/tracker/stages";
import { pickLocalized } from "@/lib/i18n/pickLocalized";

/** Wiersz katalogu widoczny publicznie (RPC `club_topics_active`). */
export interface ClubTopicOption {
  key: string;
  label_pl: string;
  label_en: string;
  sort_order: number;
}

/** Wiersz katalogu w panelu (RPC `admin_club_topics_list`). */
export interface ClubTopicAdminRow extends ClubTopicOption {
  id: string;
  is_active: boolean;
  is_system: boolean;
  clubs_count: number;
  threads_count: number;
}

/** Wartość sentinel dla "bez obszaru" - Radix Select nie przyjmuje "". */
export const CLUB_TOPIC_NONE = "none";

/** Wartość sentinel dla "wszystkie obszary" w filtrach. */
export const CLUB_TOPIC_ALL = "__all__";

export type ClubLang = "pl" | "en";

/**
 * Domyślna taksonomia. Zostaje w kodzie jako awaryjna lista dla przypadków,
 * w których katalog jeszcze się nie wczytał (SSR, pierwszy render) - dzięki
 * temu select nigdy nie jest pusty, a użytkownik nie widzi "brak obszarów"
 * przez ułamek sekundy.
 */
export const CLUB_TOPIC_FALLBACK: readonly ClubTopicOption[] = [
  {
    key: "geopolitics",
    label_pl: "Geopolityka i wojskowość",
    label_en: "Geopolitics and defence",
    sort_order: 10,
  },
  { key: "transport", label_pl: "Transport", label_en: "Transport", sort_order: 20 },
  { key: "energy", label_pl: "Energetyka", label_en: "Energy", sort_order: 30 },
  {
    key: "cybersecurity",
    label_pl: "Cyberbezpieczeństwo",
    label_en: "Cybersecurity",
    sort_order: 40,
  },
  { key: "technology", label_pl: "Technologie", label_en: "Technology", sort_order: 50 },
  { key: "finance", label_pl: "Finanse", label_en: "Finance", sort_order: 60 },
  { key: "economy", label_pl: "Gospodarka", label_en: "Economy", sort_order: 70 },
  { key: "diplomacy", label_pl: "Dyplomacja", label_en: "Diplomacy", sort_order: 80 },
  {
    key: "international_relations",
    label_pl: "Stosunki międzynarodowe",
    label_en: "International relations",
    sort_order: 90,
  },
  { key: "culture", label_pl: "Kultura", label_en: "Culture", sort_order: 100 },
] as const;

/** Kolejność: `sort_order`, remisy alfabetycznie po kluczu (determinizm). */
export function sortTopics(options: readonly ClubTopicOption[]): ClubTopicOption[] {
  return [...options].sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key));
}

/**
 * Etykieta obszaru. Kolejność źródeł jest celowa:
 * 1. katalog organizacji (redakcja mogła zmienić nazwę),
 * 2. lista awaryjna (katalog jeszcze nie dojechał),
 * 3. `areaLabel` - stare klucze spoza taksonomii nie znikają z UI.
 */
export function topicLabel(
  key: string,
  lang: ClubLang,
  catalog: readonly ClubTopicOption[] = [],
): string {
  const trimmed = key.trim();
  if (trimmed === "") return "";
  const hit =
    catalog.find((o) => o.key === trimmed) ?? CLUB_TOPIC_FALLBACK.find((o) => o.key === trimmed);
  // `pickLocalized`, nie recznie: obszar dodany z panelu i opisany tylko
  // po jednemu renderowal drugiemu jezykowi PUSTA plakietke obok tematu.
  if (hit !== undefined) return pickLocalized(hit, "label", lang);
  return areaLabel(trimmed, lang);
}

/** Normalizacja z formularza: pusty string i sentinele znaczą "brak". */
export function normalizeTopicValue(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === CLUB_TOPIC_NONE || trimmed === CLUB_TOPIC_ALL) return null;
  return trimmed;
}

/**
 * Opcje selecta dla konkretnej wartości. Jeśli wpis ma obszar, który redakcja
 * w międzyczasie wyłączyła, opcja wraca do listy - inaczej edycja klubu po
 * cichu skasowałaby przypisanie przy pierwszym zapisie.
 */
export function optionsWithCurrent(
  catalog: readonly ClubTopicOption[],
  current: string | null,
  lang: ClubLang,
): ClubTopicOption[] {
  const sorted = sortTopics(catalog);
  const key = normalizeTopicValue(current);
  if (key === null || sorted.some((o) => o.key === key)) return sorted;
  const label = topicLabel(key, lang, catalog);
  return [...sorted, { key, label_pl: label, label_en: label, sort_order: 9999 }];
}

/** Klucz techniczny z dowolnej nazwy - dla formularza dodawania obszaru. */
export function slugifyTopicKey(input: string): string {
  const map: Record<string, string> = {
    ą: "a",
    ć: "c",
    ę: "e",
    ł: "l",
    ń: "n",
    ó: "o",
    ś: "s",
    ź: "z",
    ż: "z",
  };
  const base = input
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (ch) => map[ch] ?? ch)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 49);
  return /^[a-z]/.test(base) ? base : `t_${base}`.slice(0, 49);
}

/** Zgodność klucza z ograniczeniem w bazie (`club_topics_key_format`). */
export function isValidTopicKey(key: string): boolean {
  return /^[a-z][a-z0-9_]{1,48}$/.test(key);
}
