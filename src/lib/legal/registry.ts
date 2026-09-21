// Rejestr dokumentów prawnych: klucz -> treść bazowa z kodu, ścieżka publiczna
// i etykiety PL/EN dla panelu.
//
// ŚCIEŻKI I ETYKIETY NIE ŻYJĄ TUTAJ. Czyta je `./documentIndex`, który nie
// importuje ani jednego pliku treści - dzięki temu przełącznik dokumentów,
// renderowany na każdej stronie prawnej, nie ciągnie za sobą trzynastu pełnych
// dokumentów. Ten moduł dokłada do indeksu wyłącznie `baseline`. Zależność
// biegnie rejestr -> indeks i nigdy odwrotnie.
import { AI_TRANSPARENCY_CONTENT } from "./content/aiTransparency";
import { CLUBS_CONTENT } from "./content/clubs";
import { COMMUNICATIONS_CONTENT } from "./content/communications";
import { DATA_PROCESSING_CONTENT } from "./content/dataProcessing";
import { EVENTS_CONTENT } from "./content/events";
import { MODERATION_CONTENT } from "./content/moderation";
import { PRIVACY_CONTENT } from "./content/privacy";
import { PRIVACY_GOVERNANCE_CONTENT } from "./content/privacyGovernance";
import { REFUNDS_CONTENT } from "./content/refunds";
import { RODO_CONTENT } from "./content/rodo";
import { STATUTE_CONTENT } from "./content/statute";
import { SUBSCRIPTIONS_CONTENT } from "./content/subscriptions";
import { TERMS_CONTENT } from "./content/terms";
import { legalDocIndexEntry } from "./documentIndex";
import type { LegalDocContent, LegalDocKey } from "./types";

export interface LegalDocDefinition {
  key: LegalDocKey;
  path: string;
  labelPl: string;
  labelEn: string;
  baseline: LegalDocContent;
}

/**
 * Składa definicję z wpisu indeksu i treści bazowej. `legalDocIndexEntry`
 * rzuca na nieznanym kluczu, więc brak wpisu w indeksie wywraca się przy
 * imporcie tego modułu - czyli w każdym teście, który dotyka rejestru.
 */
function define(key: LegalDocKey, baseline: LegalDocContent): LegalDocDefinition {
  const entry = legalDocIndexEntry(key);
  return {
    key,
    path: entry.path,
    labelPl: entry.labelPl,
    labelEn: entry.labelEn,
    baseline,
  };
}

export const LEGAL_DOCS: Record<LegalDocKey, LegalDocDefinition> = {
  terms: define("terms", TERMS_CONTENT),
  privacy: define("privacy", PRIVACY_CONTENT),
  refunds: define("refunds", REFUNDS_CONTENT),
  subscriptions: define("subscriptions", SUBSCRIPTIONS_CONTENT),
  rodo: define("rodo", RODO_CONTENT),
  privacy_governance: define("privacy_governance", PRIVACY_GOVERNANCE_CONTENT),
  data_processing: define("data_processing", DATA_PROCESSING_CONTENT),
  communications: define("communications", COMMUNICATIONS_CONTENT),
  clubs: define("clubs", CLUBS_CONTENT),
  moderation: define("moderation", MODERATION_CONTENT),
  events: define("events", EVENTS_CONTENT),
  ai_transparency: define("ai_transparency", AI_TRANSPARENCY_CONTENT),
  statute: define("statute", STATUTE_CONTENT),
};

export const LEGAL_DOC_LIST: readonly LegalDocDefinition[] = Object.values(LEGAL_DOCS);
