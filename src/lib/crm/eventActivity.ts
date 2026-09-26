// Aktywność z modułu Wydarzeń na osi czasu CRM - typ „event".
//
// SKĄD SIĘ BIERZE. Moduł Wydarzeń NIE pisze do CRM z TypeScriptu. Każdy wpis
// powstaje w SQL jako wiersz `audit_log` z akcją `event.<funkcja>.<czasownik>`:
// dla OSOBY przez most `_event_person_crm_sync(..., p_audit_action, p_audit_meta)`
// (`entity_type 'crm_lead'`), dla FIRMY bezpośrednio z funkcji organizatora
// (`entity_type 'crm_company'`). Migracja 20260926090000 odrzuca w moście każdą
// akcję spoza przestrzeni `event.` - prefiks jest więc pewnym znakiem typu.
//
// KONTRAKT METADANYCH (pisze go wołający w SQL, czyta ten moduł):
//   { event_id, event_slug, event_title_pl, event_title_en,
//     summary_pl, summary_en, ...identyfikatory funkcji }
// `summary_*` to gotowe zdanie osi czasu w obu językach („Zgłoszenie wystąpienia
// na Kongres CEE 2026"). Oś czasu serwera wpisuje do `title` wersję polską
// (druk i eksport CSV są dziś polskie), a PEŁNE metadane zostają w `meta`, żeby
// widok wybrał zdanie w języku panelu.
//
// DLACZEGO OSOBNY TYP, A NIE „stage_change". Dotąd każdy wiersz audytu bez słowa
// „webhook" lądował na osi jako zmiana etapu - wpis „zgłosił wystąpienie" pod
// etykietą „Zmiana etapu" to nieprawda, której redaktor CRM nie ma jak rozpoznać.
//
// GRANICA WARSTW: zero Reacta i i18next - funkcje czyste, używane i przez
// serwer (budowa osi), i przez widoki (wybór języka, odnośnik do studia).
import { pickLocalized, type LocaleCode } from "@/lib/i18n/pickLocalized";

/** Przestrzeń akcji audytu należąca do modułu Wydarzeń. */
export const EVENT_ACTIVITY_ACTION_PREFIX = "event.";

/** Kształt `events.id` (uuid) - wszystko inne nie jest adresem studia. */
const EVENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Czy wiersz audytu opisuje aktywność z modułu Wydarzeń. */
export function isEventActivityAction(action: string): boolean {
  return action.startsWith(EVENT_ACTIVITY_ACTION_PREFIX);
}

/**
 * Zdanie wpisu w żądanym języku: `summary_<lang>`, potem drugi język, potem
 * `fallback` (zwykle surowa akcja). Metadane spoza kontraktu (tablica, napis,
 * `null`) degradują do `fallback`, nie rzucają - oś czasu ma się narysować
 * także dla wiersza zapisanego ręcznie albo przez starszy kod.
 */
export function eventActivitySummary(meta: unknown, lang: LocaleCode, fallback: string): string {
  return pickLocalized(asRecord(meta), "summary", lang, fallback);
}

/**
 * Identyfikator wydarzenia z metadanych albo `null`, gdy go nie ma albo nie ma
 * kształtu uuid. Z niego powstaje odnośnik do studia - napis wstawiony do
 * adresu bez sprawdzenia kształtu prowadziłby do przypadkowej trasy panelu.
 */
export function eventActivityEventId(meta: unknown): string | null {
  const value = asRecord(meta)?.event_id;
  return typeof value === "string" && EVENT_ID_PATTERN.test(value) ? value : null;
}
