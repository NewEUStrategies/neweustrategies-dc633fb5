// Domena katalogu rodzajow wydarzen: enumy przeplywu, etykiety i typy wierszy.
//
// DLACZEGO ENUMY ZYJA TUTAJ, A NIE W WYGENEROWANYCH TYPACH. Kolumny
// `events.format`, `registration_mode`, `registration_flow`, `guest_mode`
// i ich blizniaki `event_types.default_*` sa w bazie zwyklym `text` z CHECK-iem.
// Generator Supabase oddaje je jako `string`, wiec zawezenie MUSI zyc po stronie
// kodu - inaczej `Record<Enum, string>` nie ma nad czym domykac kompletnosci
// i mapa etykiet moze zapomniec o wariancie, ktory baza dopuszcza. To ten sam
// wzorzec i to samo uzasadnienie co `EVENT_KINDS` w `lib/admin/community.ts`.
//
// MAPY WSKAZUJA KLUCZE i18n, NIE NAPISY. Typ `Record<Enum, string>` wymusza
// pokrycie kazdego wariantu, a test slownika domyka druga polowe kontraktu -
// ze wskazany klucz naprawde istnieje w PL i EN.
//
// GRANICA WARSTW: zero Reacta, zero i18next, zero klienta Supabase (typy sa
// importowane WYLACZNIE jako typy). Modul jest liscien - wolno go zaimportowac
// z dowolnego miejsca, takze z testu jednostkowego bez DOM-u.
import type { Database } from "@/integrations/supabase/types";

// ---------------------------------------------------------------------------
// Przeplyw wydarzenia: cztery niezalezne osie
// ---------------------------------------------------------------------------

/** GDZIE sie dzieje. Rozdzielone od `kind`, ktore mowi CZYM jest wydarzenie. */
export const EVENT_FORMATS = ["onsite", "online", "hybrid"] as const;
export type EventFormat = (typeof EVENT_FORMATS)[number];

/** JAK sie zapisac. `none` = wydarzenie informacyjne, bez zapisow. */
export const EVENT_REGISTRATION_MODES = ["rsvp", "form", "external", "none"] as const;
export type EventRegistrationMode = (typeof EVENT_REGISTRATION_MODES)[number];

/** CZY zapis wymaga akceptacji organizatora. */
export const EVENT_REGISTRATION_FLOWS = ["instant", "approval"] as const;
export type EventRegistrationFlow = (typeof EVENT_REGISTRATION_FLOWS)[number];

/**
 * Co widzi osoba NIEZAREJESTROWANA na wydarzenie - nie: niezalogowana.
 * To rozroznienie jest istotne: uczestnik zalogowany, ktory nie zapisal sie na
 * to wydarzenie, jest dla niego gosciem.
 */
export const EVENT_GUEST_MODES = ["hidden", "teaser", "full"] as const;
export type EventGuestMode = (typeof EVENT_GUEST_MODES)[number];

export const EVENT_FORMAT_LABEL_KEYS: Record<EventFormat, string> = {
  onsite: "adminEvents.formats.onsite",
  online: "adminEvents.formats.online",
  hybrid: "adminEvents.formats.hybrid",
};

export const EVENT_REGISTRATION_MODE_LABEL_KEYS: Record<EventRegistrationMode, string> = {
  rsvp: "adminEvents.registrationModes.rsvp",
  form: "adminEvents.registrationModes.form",
  external: "adminEvents.registrationModes.external",
  none: "adminEvents.registrationModes.none",
};

export const EVENT_REGISTRATION_FLOW_LABEL_KEYS: Record<EventRegistrationFlow, string> = {
  instant: "adminEvents.registrationFlows.instant",
  approval: "adminEvents.registrationFlows.approval",
};

export const EVENT_GUEST_MODE_LABEL_KEYS: Record<EventGuestMode, string> = {
  hidden: "adminEvents.guestModes.hidden",
  teaser: "adminEvents.guestModes.teaser",
  full: "adminEvents.guestModes.full",
};

export function isEventFormat(value: string): value is EventFormat {
  return (EVENT_FORMATS as readonly string[]).includes(value);
}

export function isEventRegistrationMode(value: string): value is EventRegistrationMode {
  return (EVENT_REGISTRATION_MODES as readonly string[]).includes(value);
}

export function isEventRegistrationFlow(value: string): value is EventRegistrationFlow {
  return (EVENT_REGISTRATION_FLOWS as readonly string[]).includes(value);
}

export function isEventGuestMode(value: string): value is EventGuestMode {
  return (EVENT_GUEST_MODES as readonly string[]).includes(value);
}

/**
 * Zawezenie wartosci z bazy do enuma, z jawnym domyslnym wariantem.
 *
 * Kolumna jest `text` z CHECK-iem, wiec baza nie wpusci nic poza zbiorem - ale
 * kontrakt publicznej funkcji nie ma zalezec od cudzego CHECK-a (dokladnie ta
 * lekcja co w `eventKindLabel`). Wartosc poza zbiorem degraduje do domyslnej,
 * a nie wywraca renderu.
 */
export function asEventFormat(value: string | null | undefined): EventFormat {
  return value !== null && value !== undefined && isEventFormat(value) ? value : "onsite";
}

export function asEventRegistrationMode(value: string | null | undefined): EventRegistrationMode {
  return value !== null && value !== undefined && isEventRegistrationMode(value) ? value : "rsvp";
}

export function asEventRegistrationFlow(value: string | null | undefined): EventRegistrationFlow {
  return value !== null && value !== undefined && isEventRegistrationFlow(value)
    ? value
    : "instant";
}

export function asEventGuestMode(value: string | null | undefined): EventGuestMode {
  return value !== null && value !== undefined && isEventGuestMode(value) ? value : "teaser";
}

// ---------------------------------------------------------------------------
// Wiersze katalogu - kształt WPROST z wygenerowanych typow RPC
// ---------------------------------------------------------------------------

type Fns = Database["public"]["Functions"];

/**
 * Wiersz katalogu w panelu. Kształt jest WYPROWADZONY z sygnatury RPC, a nie
 * przepisany rekcznie - przepisany rozjechalby sie z baza przy pierwszej
 * migracji, a bramka `check:db-row-casts` istnieje wlasnie po to, zeby tego
 * pilnowac.
 */
type EventTypeAdminRowRaw = Fns["admin_event_types_list"]["Returns"][number];

/**
 * Kolumny NULLOWALNE w `event_types`. Generator typów oddaje kolumny
 * `RETURNS TABLE` jako nie-NULL, co jest NIEPRAWDĄ dla tych sześciu (brak
 * koloru, pojemności czy czasu trwania to normalny stan wpisu). Zawężenie
 * trzymamy TUTAJ, żeby formularz i testy widziały ten sam kontrakt.
 */
export type EventTypeAdminRow = Omit<
  EventTypeAdminRowRaw,
  | "accent_color"
  | "default_capacity"
  | "default_duration_minutes"
  | "description_pl"
  | "description_en"
  | "icon"
> & {
  accent_color: string | null;
  default_capacity: number | null;
  default_duration_minutes: number | null;
  description_pl: string | null;
  description_en: string | null;
  icon: string | null;
};

/**
 * Wiersz publiczny (selekt w kreatorze, filtry na liscie wydarzen).
 *
 * TE SAME SZESC KOLUMN NULLOWALNYCH, co w `EventTypeAdminRow` wyzej - bo to ta
 * sama tabela, tylko czytana druga funkcja. Zawezenie stalo dotad WYLACZNIE po
 * stronie admina, wiec `EventCreateForm` porownywal `default_capacity === null`
 * na wartosci, ktorej typ deklarowal jako `number`: galaz „bez limitu miejsc"
 * w podgladzie dziedziczenia byla przez to TYPOWO NIEOSIAGALNA, a atrapa
 * wiersza musiala klamac rzutowaniem. `CHECK (default_capacity IS NULL OR
 * default_capacity > 0)` w `20260823120000` mowi wprost, ze NULL jest
 * poprawnym stanem wpisu.
 */
export type EventTypeOption = Omit<
  Fns["event_types_active"]["Returns"][number],
  | "accent_color"
  | "default_capacity"
  | "default_duration_minutes"
  | "description_pl"
  | "description_en"
  | "icon"
> & {
  accent_color: string | null;
  default_capacity: number | null;
  default_duration_minutes: number | null;
  description_pl: string | null;
  description_en: string | null;
  icon: string | null;
};

/** Klucz techniczny rodzaju musi przejsc CHECK `event_types_key_format`. */
export const EVENT_TYPE_KEY_PATTERN = /^[a-z][a-z0-9_]{1,48}$/;

export function isValidEventTypeKey(key: string): boolean {
  return EVENT_TYPE_KEY_PATTERN.test(key);
}

/**
 * Normalizacja nazwy na klucz techniczny. Diakrytyki sa ROZKLADANE, a nie
 * wycinane: "Śniadanie prasowe" ma dac `sniadanie_prasowe`, a nie `niadanie`.
 */
export function slugifyEventTypeKey(raw: string): string {
  const ascii = raw
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L");
  return ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 49);
}

/**
 * Nazwa rodzaju w jezyku interfejsu z pelnym fallbackiem.
 *
 * Kolejnosc: jezyk zadany -> drugi jezyk -> klucz techniczny. Ostatni krok
 * istnieje, zeby wiersz bez zadnej nazwy nie zniknal z listy (CHECK bazy tego
 * nie dopusci, ale lista musi umiec pokazac takze wiersz uszkodzony).
 */
export function eventTypeName(
  row: Pick<EventTypeAdminRow, "key" | "name_pl" | "name_en">,
  lang: "pl" | "en",
): string {
  const primary = lang === "en" ? row.name_en : row.name_pl;
  const secondary = lang === "en" ? row.name_pl : row.name_en;
  if (primary.trim() !== "") return primary;
  if (secondary.trim() !== "") return secondary;
  return row.key;
}

/**
 * Ile wydarzen uzywa rodzaju. Licznik jest suma, ale `admin_event_types_list`
 * oddaje ROZBICIE (wszystkie / opublikowane), bo blokada usuniecia i ostrzezenie
 * dla redaktora to dwie rozne informacje: "40 wydarzen" kontra "40 wydarzen,
 * z czego 12 zywych na produkcji".
 */
export function eventTypeUsage(
  row: Pick<EventTypeAdminRow, "events_count" | "published_events_count">,
): { total: number; published: number; drafts: number } {
  return {
    total: row.events_count,
    published: row.published_events_count,
    drafts: row.events_count - row.published_events_count,
  };
}
