// Katalog rodzajow wydarzen w panelu - REGULY, nie uklad.
//
// PO CO OSOBNY MODUL. Formularz katalogu ma osiemnascie pol i szesc regul, ktore
// decyduja, czy wpis wolno zapisac. Trzymane w ciele `onClick` te reguly nie maja
// testu (trzeba zamontowac Radixa, zeby sprawdzic warunek na liczbie), nie da sie
// ich ponownie uzyc w imporcie hurtowym i przy pierwszej poprawce rozjezdzaja sie
// z odpowiednikiem w drugim ekranie. Wzorzec i uzasadnienie: `adminTaxonomyCatalog.ts`
// dla katalogow klubowych - ten modul jest jego rodzenstwem, nie kopia (rodzaj
// wydarzenia niesie wartosci startowe, ktorych taksonomia klubu nie ma).
//
// SZESC REGUL, KTORE SA REGULAMI DANYCH, A NIE KOSMETYKA:
//
//   1. WYLACZENIE JEST OSOBNE OD USUNIECIA. Rodzaj uzywany przez wydarzenia NIE
//      moze zniknac (etykieta w archiwum przestalaby sie rozwiazywac), wiec
//      kasowanie dziala wylacznie przy ZEROWYM uzyciu. Rodzaj SYSTEMOWY nie
//      kasuje sie nigdy - nawet nieuzywany.
//   2. OBA JEZYKI SA WYMAGANE. Wpis z nazwa tylko po polsku wyglada na `/en/`
//      jak brak tresci, a nie jak brak tlumaczenia.
//   3. KLUCZ JEST NIEZMIENNY PO ZAPISIE i podaza za nazwa polska tylko DO
//      PIERWSZEGO tkniecia pola. Klucz zmieniony przy edycji osierocilby
//      wydarzenia czytajace legacy `events.kind`.
//   4. TRYB `external` WYMAGA ADRESU na poziomie WYDARZENIA, ale NIE na poziomie
//      katalogu: rodzaj mowi tylko "domyslnie rejestracja zewnetrzna", a adres
//      jest zawsze inny dla kazdej edycji. CHECK bazy pilnuje wydarzenia,
//      nie rodzaju - dlatego tej reguly TU NIE MA i to jest decyzja, nie luka.
//   5. LICZBY MAJA ZAKRESY Z BAZY. Pojemnosc > 0, czas trwania 5..10080 minut,
//      prog warstwy >= 0. Formularz odrzuca je PRZED zadaniem, bo odmowa CHECK-a
//      wraca jako `23514` bez wskazania pola.
//   6. ODMOWA BAZY MA DWIE DROGI. Duplikat klucza, rodzaj systemowy i rodzaj
//      w uzyciu to sytuacje, ktore administrator naprawia sam - dostaja zdanie
//      ze slownika. Kazdy inny blad jedzie SUROWYM tekstem z bazy, bo zamiana go
//      na ogolne "nie udalo sie" kasuje jedyna diagnostyke, jaka mamy.
//
// GRANICA WARSTW. Zero Reacta, zero i18next, zero klienta Supabase. Wychodza stad
// KLUCZE i18n i deskryptory, nigdy gotowy tekst.
import {
  isValidEventTypeKey,
  slugifyEventTypeKey,
  type EventFormat,
  type EventGuestMode,
  type EventRegistrationFlow,
  type EventRegistrationMode,
  type EventTypeAdminRow,
} from "@/lib/events/eventTypes";
import type { EventTypeUpsertInput } from "@/lib/events/eventTypesApi";

/**
 * Ikona rodzaju, gdy redaktor jej nie wybral albo wyczyscil.
 *
 * Stala zyje TUTAJ, a nie w komponencie, bo uzywaja jej trzy miejsca: pusta
 * wersja robocza, payload zapisu i selektor ikony (wyczyszczenie wraca do
 * domyslnej, zeby to, co redaktor widzi, bylo tym, co sie zapisze). Rozsypana
 * po trzech plikach dawala trzy rozne domyslne ikony.
 */
export const EVENT_TYPE_DEFAULT_ICON = "CalendarDays";

/** Najkrotsza nazwa, jaka dopuszczamy w obu kolumnach jezykowych (CHECK bazy). */
export const EVENT_TYPE_MIN_NAME = 2;
/** Najdluzsza nazwa (CHECK `event_types_name_*_len`). */
export const EVENT_TYPE_MAX_NAME = 80;
/** Najdluzszy opis (CHECK `event_types_desc_*_len`). */
export const EVENT_TYPE_MAX_DESCRIPTION = 500;
/** Zakres czasu trwania z CHECK-a `event_types_duration_range`. */
export const EVENT_TYPE_MIN_DURATION = 5;
export const EVENT_TYPE_MAX_DURATION = 10080;

/**
 * Komunikat odmowy: albo KLUCZ slownika (sytuacja, ktora administrator naprawia
 * sam), albo goly tekst z bazy (wszystko inne - to jedyna diagnostyka, jaka mamy).
 */
export interface EventTypeFailure {
  key: string | null;
  text: string;
}

/** Wersja robocza wpisu katalogu - dokladnie to, co widzi formularz. */
export interface EventTypeDraft {
  /** `null` = wpis NOWY; wartosc = edycja istniejacego (klucz jest zamrozony). */
  id: string | null;
  key: string;
  namePl: string;
  nameEn: string;
  descriptionPl: string;
  descriptionEn: string;
  icon: string;
  /** Pusty napis = brak akcentu (kolumna jest NULL-owalna). */
  accentColor: string;
  defaultFormat: EventFormat;
  defaultRegistrationMode: EventRegistrationMode;
  defaultRegistrationFlow: EventRegistrationFlow;
  defaultGuestMode: EventGuestMode;
  /** Pusty napis = bez limitu; formularz nie ma jak pokazac `null` w polu liczby. */
  defaultCapacity: string;
  defaultDurationMinutes: string;
  defaultMinTierRank: number;
  defaultChathamHouse: boolean;
  requiresTicket: boolean;
  sortOrder: number;
  isActive: boolean;
  isSystem: boolean;
}

export const EMPTY_EVENT_TYPE_DRAFT: EventTypeDraft = {
  id: null,
  key: "",
  namePl: "",
  nameEn: "",
  descriptionPl: "",
  descriptionEn: "",
  icon: EVENT_TYPE_DEFAULT_ICON,
  accentColor: "",
  defaultFormat: "onsite",
  defaultRegistrationMode: "rsvp",
  defaultRegistrationFlow: "instant",
  defaultGuestMode: "teaser",
  defaultCapacity: "",
  defaultDurationMinutes: "",
  defaultMinTierRank: 0,
  defaultChathamHouse: false,
  requiresTicket: false,
  sortOrder: 100,
  isActive: true,
  isSystem: false,
};

/** Kolejnosc nowego wpisu: ostatni wiersz + 10; pusta lista startuje od 100. */
export function nextEventTypeSortOrder(rows: readonly { sort_order: number }[]): number {
  return (rows.at(-1)?.sort_order ?? 90) + 10;
}

/** Ile rodzajow jest wlaczonych - licznik nad lista, nie dlugosc listy. */
export function activeEventTypeCount(rows: readonly { is_active: boolean }[]): number {
  return rows.filter((row) => row.is_active).length;
}

/**
 * Czy przycisk usuniecia jest ODCIETY. Dwa niezalezne powody: wpis systemowy
 * (nigdy) i wpis w uzyciu (dopoki cokolwiek go uzywa).
 */
export function eventTypeDeleteBlocked(row: { is_system: boolean; events_count: number }): boolean {
  return row.is_system || row.events_count > 0;
}

/**
 * Czy wpis mozna PRZEPIAC na inny rodzaj. Ma sens tylko dla wpisu uzywanego -
 * przepiecie zera wydarzen jest operacja bez skutku, a przycisk bez skutku uczy
 * redaktora, ze przyciski nic nie robia.
 */
export function eventTypeReassignAvailable(
  row: { events_count: number },
  otherActiveCount: number,
): boolean {
  return row.events_count > 0 && otherActiveCount > 0;
}

export function eventTypeDraftFromRow(row: EventTypeAdminRow): EventTypeDraft {
  return {
    id: row.id,
    key: row.key,
    namePl: row.name_pl,
    nameEn: row.name_en,
    descriptionPl: row.description_pl,
    descriptionEn: row.description_en,
    icon: row.icon,
    accentColor: row.accent_color ?? "",
    defaultFormat: row.default_format as EventFormat,
    defaultRegistrationMode: row.default_registration_mode as EventRegistrationMode,
    defaultRegistrationFlow: row.default_registration_flow as EventRegistrationFlow,
    defaultGuestMode: row.default_guest_mode as EventGuestMode,
    defaultCapacity: row.default_capacity === null ? "" : String(row.default_capacity),
    defaultDurationMinutes:
      row.default_duration_minutes === null ? "" : String(row.default_duration_minutes),
    defaultMinTierRank: row.default_min_tier_rank,
    defaultChathamHouse: row.default_chatham_house,
    requiresTicket: row.requires_ticket,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    isSystem: row.is_system,
  };
}

export function newEventTypeDraft(rows: readonly { sort_order: number }[]): EventTypeDraft {
  return { ...EMPTY_EVENT_TYPE_DRAFT, sortOrder: nextEventTypeSortOrder(rows) };
}

/**
 * Klucz, ktory POJEDZIE do bazy. Nowy wpis normalizuje wpisana tresc, edycja
 * oddaje klucz bez zmiany.
 */
export function eventTypeSaveKey(draft: EventTypeDraft): string {
  return draft.id === null ? slugifyEventTypeKey(draft.key) : draft.key;
}

/**
 * Wersja robocza po zmianie nazwy polskiej. Klucz podaza za nazwa TYLKO dopoki
 * nikt go nie tknal - inaczej reczna poprawka klucza znikalaby przy kazdej
 * literze dopisanej do nazwy.
 */
export function eventTypeDraftWithNamePl(
  draft: EventTypeDraft,
  namePl: string,
  keyTouched: boolean,
): EventTypeDraft {
  return { ...draft, namePl, key: keyTouched ? draft.key : slugifyEventTypeKey(namePl) };
}

/** Liczba z pola tekstowego albo `null` dla pustki. NaN znaczy pustke, nie zero. */
export function optionalNumberValue(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Klucz i18n powodu odrzucenia albo `null`, gdy wersja robocza jest gotowa.
 *
 * Kolejnosc sprawdzen jest KOLEJNOSCIA CZYTANIA FORMULARZA (nazwy, klucz, potem
 * liczby), zeby pierwszy komunikat wskazywal pole najwyzej na ekranie - inaczej
 * redaktor poprawia dol formularza i nie widzi, ze gora nadal jest zla.
 */
export function eventTypeDraftIssue(draft: EventTypeDraft): string | null {
  const namePl = draft.namePl.trim();
  const nameEn = draft.nameEn.trim();
  if (namePl.length < EVENT_TYPE_MIN_NAME || nameEn.length < EVENT_TYPE_MIN_NAME) {
    return "adminEvents.types.errors.names";
  }
  if (namePl.length > EVENT_TYPE_MAX_NAME || nameEn.length > EVENT_TYPE_MAX_NAME) {
    return "adminEvents.types.errors.namesTooLong";
  }
  if (
    draft.descriptionPl.length > EVENT_TYPE_MAX_DESCRIPTION ||
    draft.descriptionEn.length > EVENT_TYPE_MAX_DESCRIPTION
  ) {
    return "adminEvents.types.errors.descriptionTooLong";
  }
  if (draft.id === null && !isValidEventTypeKey(eventTypeSaveKey(draft))) {
    return "adminEvents.types.errors.key";
  }

  const capacity = optionalNumberValue(draft.defaultCapacity);
  if (draft.defaultCapacity.trim() !== "" && (capacity === null || capacity <= 0)) {
    return "adminEvents.types.errors.capacity";
  }

  const duration = optionalNumberValue(draft.defaultDurationMinutes);
  if (
    draft.defaultDurationMinutes.trim() !== "" &&
    (duration === null || duration < EVENT_TYPE_MIN_DURATION || duration > EVENT_TYPE_MAX_DURATION)
  ) {
    return "adminEvents.types.errors.duration";
  }

  if (draft.defaultMinTierRank < 0) {
    return "adminEvents.types.errors.tierRank";
  }

  // Akcent jedzie do CSS jako zmienna, wiec CHECK bazy dopuszcza wylacznie
  // literal heksadecymalny. Pusty napis znaczy "bez akcentu" i jest poprawny.
  const accent = draft.accentColor.trim();
  if (accent !== "" && !/^#[0-9a-fA-F]{6}$/.test(accent)) {
    return "adminEvents.types.errors.accentColor";
  }

  return null;
}

/** Payload RPC. Nazwy i opisy jada PRZYCIETE - spacja na koncu nazwy to nie nazwa. */
export function eventTypeUpsertPayload(draft: EventTypeDraft): EventTypeUpsertInput {
  const accent = draft.accentColor.trim();
  return {
    id: draft.id,
    key: eventTypeSaveKey(draft),
    namePl: draft.namePl.trim(),
    nameEn: draft.nameEn.trim(),
    descriptionPl: draft.descriptionPl.trim(),
    descriptionEn: draft.descriptionEn.trim(),
    icon: draft.icon.trim() === "" ? EVENT_TYPE_DEFAULT_ICON : draft.icon.trim(),
    accentColor: accent === "" ? null : accent,
    defaultFormat: draft.defaultFormat,
    defaultRegistrationMode: draft.defaultRegistrationMode,
    defaultRegistrationFlow: draft.defaultRegistrationFlow,
    defaultGuestMode: draft.defaultGuestMode,
    defaultCapacity: optionalNumberValue(draft.defaultCapacity),
    defaultDurationMinutes: optionalNumberValue(draft.defaultDurationMinutes),
    defaultMinTierRank: draft.defaultMinTierRank,
    defaultChathamHouse: draft.defaultChathamHouse,
    requiresTicket: draft.requiresTicket,
    sortOrder: draft.sortOrder,
    isActive: draft.isActive,
  };
}

function failure(message: string, needle: string, key: string): EventTypeFailure | null {
  return message.includes(needle) ? { key, text: message } : null;
}

/**
 * Mapowanie odmowy zapisu. Duplikat klucza jest jedyna sytuacja, ktora
 * administrator naprawia sam - reszta jedzie surowa trescia z bazy.
 */
export function eventTypeSaveFailure(error: Error): EventTypeFailure {
  return (
    failure(error.message, "duplicate key", "adminEvents.types.errors.duplicate") ??
    failure(error.message, "invalid_key", "adminEvents.types.errors.key") ??
    failure(error.message, "invalid_names", "adminEvents.types.errors.names") ?? {
      key: null,
      text: error.message,
    }
  );
}

/**
 * Mapowanie odmowy usuniecia. Dwie rozpoznawane przyczyny, bo obie maja inne
 * wyjscie: rodzaj systemowy trzeba zostawic, rodzaj w uzyciu - przepiac.
 */
export function eventTypeDeleteFailure(error: Error): EventTypeFailure {
  return (
    failure(error.message, "event_type_in_use", "adminEvents.types.errors.inUse") ??
    failure(error.message, "event_type_system", "adminEvents.types.errors.system") ?? {
      key: null,
      text: error.message,
    }
  );
}

/** Mapowanie odmowy przepiecia. Ten sam kontrakt, inne przyczyny. */
export function eventTypeReassignFailure(error: Error): EventTypeFailure {
  return (
    failure(error.message, "invalid_target", "adminEvents.types.errors.sameTarget") ??
    failure(error.message, "not_found", "adminEvents.types.errors.notFound") ?? {
      key: null,
      text: error.message,
    }
  );
}
