// Rejestr dokumentów prawnych: klucz -> treść bazowa z kodu, ścieżka publiczna
// i etykiety PL/EN dla panelu.
import { PRIVACY_CONTENT } from "./content/privacy";
import { REFUNDS_CONTENT } from "./content/refunds";
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
};

export const LEGAL_DOC_LIST: readonly LegalDocDefinition[] = Object.values(LEGAL_DOCS);
