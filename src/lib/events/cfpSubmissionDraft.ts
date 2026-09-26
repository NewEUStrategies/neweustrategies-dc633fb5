// Szkic FORMULARZA ZGŁOSZENIA wystąpienia (strona `/events/$slug/cfp-submit`).
//
// ODPOWIEDZI TRZYMAMY JAKO NAPISY I LISTY NAPISÓW - tak, jak oddaje je
// kontrolka (`RegistrationAnswerField`). Zamiana na typ pytania (tak/nie jako
// boolean, liczba jako liczba, wybór wielokrotny jako lista) dzieje się
// WYŁĄCZNIE w `cfpAnswersPayload`, tuż przed wysyłką. Dwa miejsca konwersji
// dawałyby dwa znaczenia napisu „false".
//
// WALIDACJA WYSŁANIA LUSTRZANA DO `event_cfp_submission_submit`: tytuł, streszczenie,
// forma, ścieżka, wymagane odpowiedzi, wspólprelegenci. Baza i tak odbije
// błędny ładunek, ale zdanie przy polu jest lepsze niż toast po odbiciu.
// Szkic (`event_cfp_submission_save`) przyjmuje stan NIEKOMPLETNY - wymaga
// tylko imienia i nazwiska przy pierwszym zapisie.
import type { Json } from "@/integrations/supabase/types";
import type { RegistrationFormField } from "@/lib/events/registrationFormSurface";
import type { CfpSpeakerRole, CfpTalkLanguage } from "@/lib/events/cfpEnums";
import type { CfpSubmissionSaveInput } from "@/lib/events/cfpPublicApi";
import type { CfpFieldDef, CfpMyPerson, CfpMySubmission, CfpPublic } from "@/lib/events/cfpSurface";

export const CFP_MAX_CO_SPEAKERS = 5;
export const CFP_MIN_ABSTRACT = 20;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/;

export interface CfpCoSpeakerDraft {
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string;
  companyText: string;
  role: CfpSpeakerRole;
}

export type CfpAnswerValue = string | string[];

export interface CfpSubmissionDraft {
  id: string | null;
  firstName: string;
  lastName: string;
  jobTitle: string;
  companyText: string;
  consentMarketing: boolean;
  role: CfpSpeakerRole;
  titlePl: string;
  titleEn: string;
  abstractPl: string;
  abstractEn: string;
  talkLanguage: CfpTalkLanguage;
  formatKey: string;
  trackId: string;
  topics: string;
  answers: Record<string, CfpAnswerValue>;
  coSpeakers: CfpCoSpeakerDraft[];
}

export type CfpSubmissionDraftField =
  | "firstName"
  | "lastName"
  | "title"
  | "abstract"
  | "format"
  | "track"
  | "coSpeakers"
  | `answer:${string}`;

export interface CfpSubmissionIssue {
  field: CfpSubmissionDraftField;
  messageKey: string;
}

function personPart(person: CfpMyPerson | null) {
  return {
    firstName: person?.firstName ?? "",
    lastName: person?.lastName ?? "",
    jobTitle: person?.jobTitle ?? "",
    companyText: person?.companyText ?? "",
    consentMarketing: person?.consentMarketing ?? false,
  };
}

export function emptyCfpSubmissionDraft(
  person: CfpMyPerson | null,
  lang: CfpTalkLanguage,
): CfpSubmissionDraft {
  return {
    id: null,
    ...personPart(person),
    role: "speaker",
    titlePl: "",
    titleEn: "",
    abstractPl: "",
    abstractEn: "",
    talkLanguage: lang,
    formatKey: "",
    trackId: "",
    topics: "",
    answers: {},
    coSpeakers: [],
  };
}

/** Wartość zapisana w bazie -> wartość kontrolki. */
export function answerToDraft(value: unknown): CfpAnswerValue {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "boolean") return value ? "true" : "";
  if (typeof value === "number") return String(value);
  return typeof value === "string" ? value : "";
}

export function cfpSubmissionDraftFromItem(
  item: CfpMySubmission,
  person: CfpMyPerson | null,
): CfpSubmissionDraft {
  const primary = item.speakers.find((speaker) => speaker.isPrimary);
  return {
    id: item.id,
    ...personPart(person),
    role: primary?.role ?? "speaker",
    titlePl: item.titlePl,
    titleEn: item.titleEn,
    abstractPl: item.abstractPl,
    abstractEn: item.abstractEn,
    talkLanguage: item.talkLanguage,
    formatKey: item.formatKey ?? "",
    trackId: item.trackId ?? "",
    topics: item.topics.join(", "),
    answers: Object.fromEntries(
      Object.entries(item.answers).map(([key, value]) => [key, answerToDraft(value)]),
    ),
    coSpeakers: item.speakers
      .filter((speaker) => !speaker.isPrimary)
      .map((speaker) => ({
        firstName: speaker.firstName,
        lastName: speaker.lastName,
        email: speaker.email ?? "",
        jobTitle: speaker.jobTitle ?? "",
        companyText: speaker.companyText ?? "",
        role: speaker.role,
      })),
  };
}

export function emptyCoSpeakerDraft(): CfpCoSpeakerDraft {
  return { firstName: "", lastName: "", email: "", jobTitle: "", companyText: "", role: "speaker" };
}

/** Tematy z pola tekstowego: po przecinkach, bez pustych, bez powtórzeń. */
export function parseTopics(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((topic) => topic.trim())
        .filter((topic) => topic !== ""),
    ),
  ];
}

function isAnswered(field: CfpFieldDef, value: CfpAnswerValue | undefined): boolean {
  if (field.fieldType === "checkbox") return value === "true";
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === "string" && value.trim() !== "";
}

/** Odpowiedzi w typach pytań - dokładnie to, co przyjmuje `_event_cfp_clean_answers`. */
export function cfpAnswersPayload(
  fields: readonly CfpFieldDef[],
  answers: Record<string, CfpAnswerValue>,
): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const field of fields) {
    const value = answers[field.key];
    if (field.fieldType === "checkbox") {
      out[field.key] = value === "true";
    } else if (field.fieldType === "multiselect") {
      out[field.key] = Array.isArray(value) ? value : [];
    } else {
      const text = typeof value === "string" ? value.trim() : "";
      if (text === "") continue;
      out[field.key] =
        field.fieldType === "number" && !Number.isNaN(Number(text)) ? Number(text) : text;
    }
  }
  return out;
}

function coSpeakerIssues(draft: CfpSubmissionDraft, cfp: CfpPublic): boolean {
  if (draft.coSpeakers.length === 0) return false;
  if (!cfp.allowCoSpeakers || draft.coSpeakers.length > CFP_MAX_CO_SPEAKERS) return true;
  const emails = draft.coSpeakers
    .map((speaker) => speaker.email.trim().toLowerCase())
    .filter((email) => email !== "");
  if (new Set(emails).size !== emails.length) return true;
  return draft.coSpeakers.some(
    (speaker) =>
      speaker.firstName.trim() === "" ||
      speaker.lastName.trim() === "" ||
      (speaker.email.trim() !== "" && !EMAIL_PATTERN.test(speaker.email.trim())),
  );
}

/** Reguły zapisu SZKICU (stan niekompletny jest dozwolony). */
export function validateCfpDraftSave(draft: CfpSubmissionDraft): CfpSubmissionIssue[] {
  const issues: CfpSubmissionIssue[] = [];
  if (draft.firstName.trim() === "") {
    issues.push({ field: "firstName", messageKey: "eventCfp.submit.validation.firstName" });
  }
  if (draft.lastName.trim() === "") {
    issues.push({ field: "lastName", messageKey: "eventCfp.submit.validation.lastName" });
  }
  return issues;
}

/** Reguły WYSŁANIA - lustro `event_cfp_submission_submit`. */
export function validateCfpDraftSubmit(
  draft: CfpSubmissionDraft,
  cfp: CfpPublic,
): CfpSubmissionIssue[] {
  const issues = validateCfpDraftSave(draft);
  if (draft.titlePl.trim().length < 2 && draft.titleEn.trim().length < 2) {
    issues.push({ field: "title", messageKey: "eventCfp.submit.validation.title" });
  }
  if (
    draft.abstractPl.trim().length < CFP_MIN_ABSTRACT &&
    draft.abstractEn.trim().length < CFP_MIN_ABSTRACT
  ) {
    issues.push({ field: "abstract", messageKey: "eventCfp.submit.validation.abstract" });
  }
  if (cfp.formats.length > 0 && !cfp.formats.some((format) => format.key === draft.formatKey)) {
    issues.push({ field: "format", messageKey: "eventCfp.submit.validation.format" });
  }
  if (cfp.tracks.length > 0 && !cfp.tracks.some((track) => track.id === draft.trackId)) {
    issues.push({ field: "track", messageKey: "eventCfp.submit.validation.track" });
  }
  for (const field of cfp.fields) {
    if (field.isRequired && !isAnswered(field, draft.answers[field.key])) {
      issues.push({
        field: `answer:${field.key}`,
        messageKey: "eventCfp.submit.validation.answer",
      });
    }
  }
  if (coSpeakerIssues(draft, cfp)) {
    issues.push({ field: "coSpeakers", messageKey: "eventCfp.submit.validation.coSpeakers" });
  }
  return issues;
}

export function cfpSubmissionSaveInput(
  draft: CfpSubmissionDraft,
  input: { slug: string; cfp: CfpPublic; notifyLang: "pl" | "en" },
): CfpSubmissionSaveInput {
  return {
    id: draft.id ?? undefined,
    slug: draft.id === null ? input.slug : undefined,
    speaker: {
      first_name: draft.firstName.trim(),
      last_name: draft.lastName.trim(),
      job_title: draft.jobTitle.trim(),
      company_text: draft.companyText.trim(),
      consent_marketing: draft.consentMarketing,
    },
    titlePl: draft.titlePl.trim(),
    titleEn: draft.titleEn.trim(),
    abstractPl: draft.abstractPl.trim(),
    abstractEn: draft.abstractEn.trim(),
    talkLanguage: draft.talkLanguage,
    notifyLang: input.notifyLang,
    formatKey: draft.formatKey === "" ? null : draft.formatKey,
    trackId: draft.trackId === "" ? null : draft.trackId,
    topics: parseTopics(draft.topics),
    answers: cfpAnswersPayload(input.cfp.fields, draft.answers),
    role: draft.role,
    coSpeakers: draft.coSpeakers.map((speaker) => ({
      first_name: speaker.firstName.trim(),
      last_name: speaker.lastName.trim(),
      email: speaker.email.trim() === "" ? null : speaker.email.trim().toLowerCase(),
      job_title: speaker.jobTitle.trim(),
      company_text: speaker.companyText.trim(),
      role: speaker.role,
    })),
  };
}

/**
 * Pytanie naboru w kształcie pola formularza zapisu - kontrolka
 * `RegistrationAnswerField` jest wspólna. Typ `url` naboru rysuje się jako pole
 * adresu https, którym w zapisach jest typ `file` (wrzutu plików świadomie nie ma).
 */
export function toRegistrationFormField(field: CfpFieldDef): RegistrationFormField {
  return {
    id: field.id,
    key: field.key,
    fieldType: field.fieldType === "url" ? "file" : field.fieldType,
    labelPl: field.labelPl,
    labelEn: field.labelEn,
    helpPl: field.helpPl,
    helpEn: field.helpEn,
    isRequired: field.isRequired,
    options: field.options,
  };
}
