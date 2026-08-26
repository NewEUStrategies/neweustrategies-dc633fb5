// Informacje praktyczne wydarzenia: co jest treścią sekcji `map`, a co `contact`.
//
// ── DLACZEGO DWIE SEKCJE, A NIE JEDNA KARTA „INFORMACJE PRAKTYCZNE" ────────
// Kusiło zebrać adres, języki, hashtag i adres wsparcia w jeden blok. Byłby to
// BŁĄD DOSTĘPU, nie kwestia gustu: `event_page_sections` trzyma osobną
// widoczność dla `map` i dla `contact`, a bramka gościa (`events.guest_mode`)
// ma wprost wariant „wszystko poza kontaktami" (`full`). Jeden blok musiałby
// wybrać jedną widoczność - a przy wyborze widoczności kontaktu adres sali
// zniknąłby gościowi, który dopiero rozważa przyjazd. Dlatego:
//   * `map`     -> adres strukturalny + odnośnik „pokaż na mapie",
//   * `contact` -> języki treści, hashtag, adres wsparcia.
// Języki treści stoją przy kontakcie świadomie: to odpowiedź na pytanie „w jakim
// języku się dogadam", a nie na pytanie „jak dojadę".
//
// PUSTA KARTA JEST GORSZA NIŻ BRAK KARTY, a decyzja o pustce musi zapaść ZANIM
// powstanie nagłówek sekcji (rysuje go `EventPageSections`). Dlatego predykat
// jest tutaj, w regule, a nie schowany w komponencie jako `return null` - tam
// zostawiłby na stronie samotny nagłówek „Dojazd" bez ani jednej linii.
//
// `has_content` Z BAZY TU NIE POMOŻE. RPC oddaje dla mapy i kontaktu `NULL`
// („sekcja bez pojęcia treści"), bo baza nie wie, czy adres złożony z pięciu
// nullowalnych kolumn jest pusty w sensie tego widoku. Pustkę liczy więc front -
// z tych samych kolumn, z których rysuje treść.
//
// GRANICA WARSTW: zero Reacta, zero i18next, zero klienta bazy.
import { eventAddressLine, type EventAddressParts } from "@/lib/events/eventAddress";

/** Sekcje, których treścią są kolumny wydarzenia, a nie osobne zapytanie. */
export const EVENT_PRACTICAL_SECTIONS = ["map", "contact"] as const;
export type EventPracticalSectionKey = (typeof EVENT_PRACTICAL_SECTIONS)[number];

/** Kolumny wydarzenia, z których składa się informacja praktyczna. */
export interface EventPracticalInfo extends EventAddressParts {
  /** Języki TREŚCI wydarzenia (ISO 639-1) - nie języki interfejsu. */
  languages: readonly string[];
  /** Hashtag BEZ krzyżyka - `#` dokłada prezentacja. */
  socialHashtag?: string | null;
  supportEmail?: string | null;
}

function trimmed(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Hashtag bez krzyżyka; pusty napis = organizator go nie podał. */
export function eventHashtag(info: EventPracticalInfo): string {
  return trimmed(info.socialHashtag).replace(/^#+/, "");
}

/**
 * Adres wsparcia albo pusty napis.
 *
 * WZORZEC TEN SAM, CO W WALIDACJI PANELU (`validateEventGeneralDraft`) - i to
 * nie jest ozdoba: `mailto:` przyjmuje nagłówki po `?` (`?bcc=`, `?subject=`),
 * więc napis z bazy, który nie jest adresem, jest wektorem doklejenia cudzego
 * odbiorcy. Adres spoza wzorca nie dostaje odnośnika i NIE LICZY SIĘ do treści
 * sekcji - inaczej karta „Kontakt" pojawiłaby się pusta.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function eventSupportEmail(info: EventPracticalInfo): string {
  const email = trimmed(info.supportEmail);
  return EMAIL_PATTERN.test(email) ? email : "";
}

/** Czy sekcja ma cokolwiek pokazać - patrz komentarz nagłówkowy tego pliku. */
export function hasPracticalContent(
  info: EventPracticalInfo,
  section: EventPracticalSectionKey,
): boolean {
  if (section === "map") return eventAddressLine(info) !== "";
  return info.languages.length > 0 || eventHashtag(info) !== "" || eventSupportEmail(info) !== "";
}

export function isEventPracticalSection(key: string): key is EventPracticalSectionKey {
  return (EVENT_PRACTICAL_SECTIONS as readonly string[]).includes(key);
}
