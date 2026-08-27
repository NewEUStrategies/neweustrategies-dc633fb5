// Model sekcji publicznej strony wydarzenia (RPC `event_sections`).
//
// SEKCJE SĄ DANYMI, NIE UKŁADEM W KODZIE. Organizator włącza je, przestawia,
// nadpisuje nagłówek i zawęża widoczność (`event_page_sections`), a baza
// dokłada bramki gościa (`events.guest_mode`) i warstwy. Gdyby trasa układała
// sekcje sama, każde z tych ustawień byłoby martwe - a redakcja widziałaby
// w panelu przełącznik, który nic nie robi.
//
// ZAMEK NIE JEST BŁĘDEM. `lock_reason` mówi, CO ZROBIĆ: zaloguj się, zapisz
// się, podnieś warstwę. Dlatego zamknięta sekcja zostaje na stronie z kartą
// zaproszenia zamiast zniknąć - inaczej uczestnik nie wie nawet, że program
// wydarzenia istnieje.
//
// PUSTA SEKCJA TO CO INNEGO NIŻ ZAMKNIĘTA. `has_content` liczy baza (są sesje?
// są sponsorzy?), więc sekcja bez treści nie udaje zamkniętej i odwrotnie.
// `null` znaczy „ta sekcja nie ma pojęcia treści" - i od migracji 20260827130000
// dotyczy TRZECH sekcji: `materials` (źródła w bazie nie ma) oraz `map`
// i `contact`, których pustkę liczy front z tych samych kolumn, z których rysuje
// treść (`lib/events/eventPractical`). Stało tu „mapa, kontakt bez hosta" i był
// to opis reguły MARTWEJ: mapa czytała stare `events.location`, którego panel nie
// zapisuje, a kontakt - `events.host_user_id`, którego nie ustawia nic w całym
// repozytorium, więc oba oddawały `false` i UBIJAŁY swoją sekcję.
import type { Database } from "@/integrations/supabase/types";

type Fns = Database["public"]["Functions"];

/** Wiersz RPC - kształt WPROST z sygnatury, nie przepisany ręcznie. */
export type EventSectionRow = Fns["event_sections"]["Returns"][number];

/** Osiem sekcji z `_event_default_sections()` - słownik domknięty w bazie. */
export const EVENT_SECTION_KEYS = [
  "description",
  "registration",
  "agenda",
  "speakers",
  "sponsors",
  "materials",
  "map",
  "contact",
] as const;
export type EventSectionKey = (typeof EVENT_SECTION_KEYS)[number];

export const EVENT_SECTION_VISIBILITIES = [
  "public",
  "authenticated",
  "registered",
  "tier",
] as const;
export type EventSectionVisibility = (typeof EVENT_SECTION_VISIBILITIES)[number];

export const EVENT_SECTION_LOCK_REASONS = [
  "none",
  "auth_required",
  "registration_required",
  "tier_required",
] as const;
export type EventSectionLockReason = (typeof EVENT_SECTION_LOCK_REASONS)[number];

export interface EventSection {
  key: EventSectionKey;
  sortOrder: number;
  /** Nadpisanie redakcji albo `null` - wtedy nagłówek bierze się ze słownika. */
  headingPl: string | null;
  headingEn: string | null;
  visibility: EventSectionVisibility;
  minTierRank: number;
  isLocked: boolean;
  lockReason: EventSectionLockReason;
  /** `null` = sekcja bez pojęcia treści (RPC: `materials`, `map`, `contact`). */
  hasContent: boolean | null;
}

function isSectionKey(value: string): value is EventSectionKey {
  return (EVENT_SECTION_KEYS as readonly string[]).includes(value);
}

function visibilityOf(value: string | null): EventSectionVisibility {
  // Nieznana widoczność czytana jako najwęższa z możliwych: sekcja pokazana
  // za szeroko jest wyciekiem, sekcja pokazana za wąsko jest tylko niewygodą.
  return value !== null && (EVENT_SECTION_VISIBILITIES as readonly string[]).includes(value)
    ? (value as EventSectionVisibility)
    : "registered";
}

function lockReasonOf(value: string | null, isLocked: boolean): EventSectionLockReason {
  if (value !== null && (EVENT_SECTION_LOCK_REASONS as readonly string[]).includes(value)) {
    return value as EventSectionLockReason;
  }
  // Zamek bez nazwanego powodu nie może zniknąć - zostaje jako wymóg zapisu,
  // bo to jedyna odpowiedź, która nie obiecuje dostępu, którego nie ma.
  return isLocked ? "registration_required" : "none";
}

function textOrNull(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * Wiersze RPC -> uporządkowany model. Nieznany `section_key` wypada: front nie
 * ma dla niego ani nagłówka, ani renderera, więc pokazałby pustą ramkę.
 */
export function parseEventSections(rows: readonly EventSectionRow[] | null): EventSection[] {
  if (rows === null) return [];
  const out: EventSection[] = [];
  for (const row of rows) {
    const key = typeof row.section_key === "string" ? row.section_key : "";
    if (!isSectionKey(key)) continue;
    const isLocked = row.is_locked === true;
    out.push({
      key,
      sortOrder: typeof row.sort_order === "number" ? row.sort_order : 0,
      headingPl: textOrNull(row.heading_pl),
      headingEn: textOrNull(row.heading_en),
      visibility: visibilityOf(textOrNull(row.visibility)),
      minTierRank: typeof row.min_tier_rank === "number" ? row.min_tier_rank : 0,
      isLocked,
      lockReason: lockReasonOf(textOrNull(row.lock_reason), isLocked),
      hasContent: typeof row.has_content === "boolean" ? row.has_content : null,
    });
  }
  // Baza sortuje, ale kolejność jest częścią kontraktu widoku - domykamy ją
  // tutaj, żeby test komponentu nie zależał od porządku z sieci.
  return out.sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
}

export function findEventSection(
  sections: readonly EventSection[],
  key: EventSectionKey,
): EventSection | null {
  return sections.find((section) => section.key === key) ?? null;
}

/** Klucz nagłówka ze słownika - używany, gdy redakcja nic nie nadpisała. */
export function sectionHeadingKey(key: EventSectionKey): string {
  return `eventFront.sections.${key}.heading`;
}

/** Zdanie „nic tu jeszcze nie ma" - inne dla każdej sekcji, nie jedno globalne. */
export function sectionEmptyKey(key: EventSectionKey): string {
  return `eventFront.sections.${key}.empty`;
}

const LOCK_REASON_CAMEL: Record<EventSectionLockReason, string> = {
  none: "none",
  auth_required: "authRequired",
  registration_required: "registrationRequired",
  tier_required: "tierRequired",
};

/** Krótka etykieta powodu zamknięcia (plakietka przy nagłówku). */
export function lockReasonKey(reason: EventSectionLockReason): string {
  return `eventFront.lockReasons.${LOCK_REASON_CAMEL[reason]}`;
}

export interface SectionLockCopy {
  titleKey: string;
  bodyKey: string;
  actionKey: string;
}

/**
 * Karta zamka: tytuł, zdanie i NAZWA DZIAŁANIA. Trzy klucze zamiast jednego,
 * bo przycisk musi prowadzić gdzie indziej dla każdego powodu.
 */
export function sectionLockCopy(reason: EventSectionLockReason): SectionLockCopy | null {
  if (reason === "none") return null;
  const camel = LOCK_REASON_CAMEL[reason];
  return {
    titleKey: `eventFront.locks.${camel}.title`,
    bodyKey: `eventFront.locks.${camel}.body`,
    actionKey: `eventFront.locks.${camel}.action`,
  };
}

/**
 * Czy sekcja ma się w ogóle pojawić na stronie.
 *
 * Zamknięta pojawia się ZAWSZE (karta zaproszenia jest jej treścią), otwarta
 * tylko wtedy, gdy baza potwierdziła treść. Sekcja bez pojęcia treści
 * (`hasContent === null`) zostaje - o jej pustce decyduje własny renderer.
 */
export function shouldRenderSection(section: EventSection): boolean {
  return section.isLocked || section.hasContent !== false;
}
