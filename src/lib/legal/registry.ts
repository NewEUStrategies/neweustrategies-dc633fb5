// Rejestr dokumentów prawnych: klucz -> treść bazowa z kodu, ścieżka publiczna
// i etykiety PL/EN dla panelu.
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
import type { LegalDocContent, LegalDocKey } from "./types";

export interface LegalDocDefinition {
  key: LegalDocKey;
  path: string;
  labelPl: string;
  labelEn: string;
  baseline: LegalDocContent;
}

export const LEGAL_DOCS: Record<LegalDocKey, LegalDocDefinition> = {
  terms: {
    key: "terms",
    path: "/regulamin",
    labelPl: "Regulamin",
    labelEn: "Terms",
    baseline: TERMS_CONTENT,
  },
  privacy: {
    key: "privacy",
    path: "/polityka-prywatnosci",
    labelPl: "Polityka prywatności",
    labelEn: "Privacy policy",
    baseline: PRIVACY_CONTENT,
  },
  refunds: {
    key: "refunds",
    path: "/zwroty-i-reklamacje",
    labelPl: "Zwroty i reklamacje",
    labelEn: "Refunds",
    baseline: REFUNDS_CONTENT,
  },
  subscriptions: {
    key: "subscriptions",
    path: "/regulamin-subskrypcji-i-zakupow",
    labelPl: "Subskrypcje i zakupy",
    labelEn: "Subscriptions and purchases",
    baseline: SUBSCRIPTIONS_CONTENT,
  },
  rodo: {
    key: "rodo",
    path: "/rodo",
    labelPl: "RODO - Twoje prawa",
    labelEn: "GDPR - your rights",
    baseline: RODO_CONTENT,
  },
  privacy_governance: {
    key: "privacy_governance",
    path: "/zarzadzanie-polityka-prywatnosci",
    labelPl: "Zarządzanie polityką prywatności",
    labelEn: "Privacy policy governance",
    baseline: PRIVACY_GOVERNANCE_CONTENT,
  },
  data_processing: {
    key: "data_processing",
    path: "/polityka-przetwarzania-danych",
    labelPl: "Polityka przetwarzania danych",
    labelEn: "Data processing policy",
    baseline: DATA_PROCESSING_CONTENT,
  },
  communications: {
    key: "communications",
    path: "/komunikacja-i-marketing",
    labelPl: "Komunikacja i marketing",
    labelEn: "Communications and marketing",
    baseline: COMMUNICATIONS_CONTENT,
  },
  clubs: {
    key: "clubs",
    path: "/regulamin-klubow-dyskusyjnych",
    labelPl: "Regulamin klubów dyskusyjnych",
    labelEn: "Discussion club rules",
    baseline: CLUBS_CONTENT,
  },
  moderation: {
    key: "moderation",
    path: "/moderacja-komentarzy",
    labelPl: "Moderacja komentarzy i treści",
    labelEn: "Comment and content moderation",
    baseline: MODERATION_CONTENT,
  },
  events: {
    key: "events",
    path: "/regulamin-wydarzen-i-biletow",
    labelPl: "Wydarzenia, bilety i skanowanie",
    labelEn: "Events, tickets and scanning",
    baseline: EVENTS_CONTENT,
  },
  ai_transparency: {
    key: "ai_transparency",
    path: "/przejrzystosc-ai",
    labelPl: "Sztuczna inteligencja i przejrzystość",
    labelEn: "Artificial intelligence and transparency",
    baseline: AI_TRANSPARENCY_CONTENT,
  },
  statute: {
    key: "statute",
    path: "/statut",
    labelPl: "Statut i dane rejestrowe",
    labelEn: "Statute and registration details",
    baseline: STATUTE_CONTENT,
  },
};

export const LEGAL_DOC_LIST: readonly LegalDocDefinition[] = Object.values(LEGAL_DOCS);
