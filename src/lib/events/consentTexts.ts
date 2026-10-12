// Teksty zgód formularza zapisu na wydarzenie - WERSJA, cele i kanały dowodu.
//
// DLACZEGO WERSJA. Napis checkboxa, który widzi uczestnik, żyje w i18n
// (`eventRegistration.consents.*`), a jego kopia - w bazie
// (`event_consent_texts`, migracja 20261012100100). Każdy wpis księgi zgód
// (`event_consent_records`) wskazuje wersję i język tekstu, więc art. 7 ust. 1
// RODO („administrator musi być w stanie wykazać") działa tylko wtedy, gdy ta
// stała mówi prawdę o tym, co formularz pokazał. Bramka
// `__tests__/eventConsentTexts.gate.test.ts` porównuje napisy i18n z ziarnem
// bieżącej wersji w migracjach: zmiana napisu bez nowej wersji (i bez nowego
// wiersza w bazie) czerwieni CI.
//
// NOWA WERSJA TEKSTU = trzy kroki w jednej zmianie: migracja z `retired_at`
// dla starych wierszy i INSERT nowych (PL i EN), nowy napis w i18n, podbicie
// tej stałej.
//
// Listy celów, statusów i kanałów odwzorowują CHECK-i tabeli
// `event_consent_records` (parytet pilnuje ta sama bramka).

/** Wersja tekstów zgód renderowanych dziś przez formularz zapisu. */
export const EVENT_CONSENT_TEXT_VERSION = 1;

export const EVENT_CONSENT_PURPOSES = ["data_processing", "marketing", "partner_sharing"] as const;
export type EventConsentPurpose = (typeof EVENT_CONSENT_PURPOSES)[number];

/**
 * Cele, które działają (projekcja, CRM, sponsorzy) wyłącznie po kanale
 * zweryfikowanym: konto z potwierdzonym adresem albo link z maila (DOI).
 */
export type EventConsentGrantPurpose = Exclude<EventConsentPurpose, "data_processing">;

export const EVENT_CONSENT_LANGS = ["pl", "en"] as const;
export type EventConsentLang = (typeof EVENT_CONSENT_LANGS)[number];

export const EVENT_CONSENT_STATUSES = ["pending", "confirmed", "withdrawn"] as const;
export type EventConsentStatus = (typeof EVENT_CONSENT_STATUSES)[number];

/** Kanał dowodu wpisu księgi (kolumna `evidence`). */
export const EVENT_CONSENT_EVIDENCES = [
  "registration_form",
  "verified_account",
  "email_double_opt_in",
  "manage_token",
  "account_settings",
  "unsubscribe_link",
  "legacy_single_opt_in",
] as const;
export type EventConsentEvidence = (typeof EVENT_CONSENT_EVIDENCES)[number];

const TEXT_KEYS = {
  data_processing: "eventRegistration.consents.dataProcessing",
  marketing: "eventRegistration.consents.marketing",
  partner_sharing: "eventRegistration.consents.partnerSharing",
} as const satisfies Record<EventConsentPurpose, string>;

export type EventConsentTextKey = (typeof TEXT_KEYS)[EventConsentPurpose];

/** Klucz i18n napisu checkboxa danego celu (wersja `EVENT_CONSENT_TEXT_VERSION`). */
export function eventConsentTextKey(purpose: EventConsentPurpose): EventConsentTextKey {
  return TEXT_KEYS[purpose];
}
