// Kontrakt tabeli `crm_consent_log` (niezmienny rejestr zgód RODO, migracja
// 20260630053403). Prawdziwe nazwy kolumn to `given`, `consent_version` i
// `consent_text` - warstwa CRM pytała wcześniej o `granted`/`version`/
// `text_excerpt`, a ponieważ błąd zapytania jest połykany, historia zgód
// znikała z osi czasu i z drawera bez żadnego komunikatu. Zestaw kolumn żyje
// TYLKO tutaj i jest przypięty do wygenerowanych typów bazy, więc literówka
// zapala się w tsc, a nie w produkcyjnym rejestrze zgód.
import type { Database } from "@/integrations/supabase/types";

export type ConsentLogRow = Database["public"]["Tables"]["crm_consent_log"]["Row"];

export const CONSENT_LOG_TIMELINE_COLUMNS = [
  "id",
  "consent_key",
  "given",
  "consent_version",
  "consent_text",
  "form_name",
  "created_at",
] as const satisfies readonly (keyof ConsentLogRow)[];

export const CONSENT_LOG_TIMELINE_SELECT = CONSENT_LOG_TIMELINE_COLUMNS.join(", ");

export type ConsentLogTimelineRow = Pick<
  ConsentLogRow,
  (typeof CONSENT_LOG_TIMELINE_COLUMNS)[number]
>;

// Oś czasu skraca treść zgody tak samo jak treść wiadomości z formularza -
// pełny tekst zostaje w rejestrze i w zakładce "Zgody".
export const CONSENT_TEXT_EXCERPT_LEN = 280;

export function consentExcerpt(text: string | null): string | null {
  if (!text) return null;
  return text.length > CONSENT_TEXT_EXCERPT_LEN ? text.slice(0, CONSENT_TEXT_EXCERPT_LEN) : text;
}
