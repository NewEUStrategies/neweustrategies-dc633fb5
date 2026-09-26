// Zamknięte zbiory NABORU PRELEGENTÓW - lustro CHECK-ów z migracji
// `20260926100000_event_cfp.sql`, jeden do jednego.
//
// OSOBNY, LEKKI MODUŁ. Te listy czyta i panel organizatora, i strona publiczna
// naboru, i panel prelegenta. Gdyby stały w `cfpApi.ts` (panel), trasa
// publiczna ciągnęłaby za sobą klienta RPC panelu i jego typy - a do chunku
// publicznego nie wolno wnosić niczego z panelu.
//
// KLUCZE ETYKIET SĄ MAPAMI `Record<Enum, "pełny.klucz">`, NIE szablonami.
// Bramka kluczy i18n widzi wyłącznie literały; klucz sklejany z wartości
// (`t(\`…statuses.${s}\`)`) przechodzi obok niej niezauważony, a brak jednej
// etykiety wychodzi dopiero na ekranie.

/** `event_cfp_settings_status_values`. */
export const CFP_STATUSES = ["draft", "open", "closed"] as const;
export type CfpStatus = (typeof CFP_STATUSES)[number];

/** Faza liczona w bazie (`_event_cfp_phase`) - nigdy z zegara przeglądarki. */
export const CFP_PHASES = ["none", "scheduled", "open", "closed"] as const;
export type CfpPhase = (typeof CFP_PHASES)[number];

/** `event_cfp_submissions_status_values`. */
export const CFP_SUBMISSION_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "changes_requested",
  "accepted",
  "waitlisted",
  "rejected",
  "withdrawn",
  "confirmed",
  "declined",
] as const;
export type CfpSubmissionStatus = (typeof CFP_SUBMISSION_STATUSES)[number];

/** Decyzje panelu poza przyjęciem (`admin_event_cfp_submission_decide`). */
export const CFP_DECISION_STATUSES = [
  "under_review",
  "changes_requested",
  "waitlisted",
  "rejected",
] as const;
export type CfpDecisionStatus = (typeof CFP_DECISION_STATUSES)[number];

/** Stany, z których organizator może jeszcze podjąć decyzję albo przyjąć. */
export const CFP_DECIDABLE_STATUSES: readonly CfpSubmissionStatus[] = [
  "submitted",
  "under_review",
  "changes_requested",
  "waitlisted",
  "rejected",
];

/** Stany, o których idzie mail do prelegenta (`admin_event_cfp_notify_payload`). */
export const CFP_NOTICES = ["accepted", "rejected", "changes_requested"] as const;
export type CfpNotice = (typeof CFP_NOTICES)[number];

/** `event_cfp_fields_field_type_values`. */
export const CFP_FIELD_TYPES = [
  "text",
  "textarea",
  "select",
  "multiselect",
  "checkbox",
  "url",
  "number",
] as const;
export type CfpFieldType = (typeof CFP_FIELD_TYPES)[number];

/** Typy pytań z listą opcji. */
export const CFP_CHOICE_FIELD_TYPES: readonly CfpFieldType[] = ["select", "multiselect"];

/** `event_cfp_submission_speakers_role_values` = role obsady sesji. */
export const CFP_SPEAKER_ROLES = ["speaker", "moderator", "panelist", "host"] as const;
export type CfpSpeakerRole = (typeof CFP_SPEAKER_ROLES)[number];

/** `event_cfp_reviews_recommendation_values`. */
export const CFP_RECOMMENDATIONS = ["accept", "maybe", "reject", "abstain"] as const;
export type CfpRecommendation = (typeof CFP_RECOMMENDATIONS)[number];

/** `event_cfp_submissions_talk_language_values`. */
export const CFP_TALK_LANGUAGES = ["pl", "en"] as const;
export type CfpTalkLanguage = (typeof CFP_TALK_LANGUAGES)[number];

/** `event_speaker_materials_kind_values`. */
export const SPEAKER_MATERIAL_KINDS = ["slides", "document", "video", "link"] as const;
export type SpeakerMaterialKind = (typeof SPEAKER_MATERIAL_KINDS)[number];

/** `event_speaker_materials_visibility_values`. */
export const SPEAKER_MATERIAL_VISIBILITIES = ["organizers", "registered", "public"] as const;
export type SpeakerMaterialVisibility = (typeof SPEAKER_MATERIAL_VISIBILITIES)[number];

/** Format szkicu sesji tworzonego przy przyjęciu = `event_sessions_format_values`. */
export const CFP_SESSION_FORMATS = ["onsite", "online", "hybrid"] as const;
export type CfpSessionFormat = (typeof CFP_SESSION_FORMATS)[number];

/** Zawężenie napisu z bazy do zbioru; wartość spoza zbioru = `fallback`. */
export function asOneOf<T extends string>(
  values: readonly T[],
  value: unknown,
  fallback: T,
): T {
  return typeof value === "string" && (values as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

// ----------------------------------------------------------------- etykiety

export const CFP_SUBMISSION_STATUS_LABEL_KEYS: Record<CfpSubmissionStatus, string> = {
  draft: "eventCfp.statuses.draft",
  submitted: "eventCfp.statuses.submitted",
  under_review: "eventCfp.statuses.under_review",
  changes_requested: "eventCfp.statuses.changes_requested",
  accepted: "eventCfp.statuses.accepted",
  waitlisted: "eventCfp.statuses.waitlisted",
  rejected: "eventCfp.statuses.rejected",
  withdrawn: "eventCfp.statuses.withdrawn",
  confirmed: "eventCfp.statuses.confirmed",
  declined: "eventCfp.statuses.declined",
};

export const CFP_SPEAKER_ROLE_LABEL_KEYS: Record<CfpSpeakerRole, string> = {
  speaker: "eventCfp.roles.speaker",
  moderator: "eventCfp.roles.moderator",
  panelist: "eventCfp.roles.panelist",
  host: "eventCfp.roles.host",
};

export const CFP_RECOMMENDATION_LABEL_KEYS: Record<CfpRecommendation, string> = {
  accept: "eventCfp.recommendations.accept",
  maybe: "eventCfp.recommendations.maybe",
  reject: "eventCfp.recommendations.reject",
  abstain: "eventCfp.recommendations.abstain",
};

export const CFP_TALK_LANGUAGE_LABEL_KEYS: Record<CfpTalkLanguage, string> = {
  pl: "eventCfp.languages.pl",
  en: "eventCfp.languages.en",
};

export const SPEAKER_MATERIAL_KIND_LABEL_KEYS: Record<SpeakerMaterialKind, string> = {
  slides: "eventCfp.materialKinds.slides",
  document: "eventCfp.materialKinds.document",
  video: "eventCfp.materialKinds.video",
  link: "eventCfp.materialKinds.link",
};

export const SPEAKER_MATERIAL_VISIBILITY_LABEL_KEYS: Record<SpeakerMaterialVisibility, string> = {
  organizers: "eventCfp.materialVisibility.organizers",
  registered: "eventCfp.materialVisibility.registered",
  public: "eventCfp.materialVisibility.public",
};

/**
 * Tekst dwujęzyczny z pary pól: język interfejsu, a przy pustym - drugi język.
 * Organizator nie zawsze wypełnia oba; pusty napis na ekranie byłby gorszy
 * od tekstu w drugim języku.
 */
export function localizedPair(lang: "pl" | "en", pl: string, en: string): string {
  return lang === "en" ? en || pl : pl || en;
}
